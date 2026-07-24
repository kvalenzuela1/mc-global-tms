'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { nextLoadReference } from '@/lib/loads/reference';
import {
  canTransition,
  requiresSignedRateConfirmation,
  LOAD_STATUS,
  type LoadStatus,
} from '@/lib/loads/lifecycle';
import { isQuoteReleasable } from '@/lib/pricing/override';
import { resolveMarginPercents, validateMarginInputs } from '@/lib/pricing/margin';
import { resolveOrgLoadMarginConfig } from '@/lib/config/policies.server';
import { getCarrierComplianceResult } from '@/lib/compliance/policy.server';
import { evaluateComplianceOverride } from '@/lib/compliance/override';
import type { ComplianceResult } from '@/lib/compliance/gate';
import { RFQ_STATUS } from '@/lib/rfqs/lifecycle';
import { validateAccessorial } from '@/lib/accessorials/calc';
import { notifyPermissionHolders } from '@/lib/notifications/notify.server';
import { loadBookedReadyForRateconEmail, loadDeliveredReadyToInvoiceEmail } from '@/lib/notifications/templates';
import type { ActionResult } from '@/lib/actions/result';

const NOT_REVIEWED_RESULT: ComplianceResult = {
  allowed: false,
  blockingReasons: ['NOT_REVIEWED: this carrier has not been compliance-reviewed yet.'],
  warnings: [],
};

const UNIQUE_VIOLATION = '23505';
const MAX_REFERENCE_ATTEMPTS = 5;

interface BookableQuote {
  id: string;
  load_id: string | null;
  rfq_id: string | null;
  is_override: boolean;
  override_approved_by: string | null;
  shipper_price_cents: number;
  pricing_snapshot: Record<string, unknown>;
}

/**
 * Book a load from an already-approved quote. `reference` has no DB default
 * (see migration 0005), so the next LD-#### is computed here and the insert
 * is retried on a unique-constraint conflict from a concurrent booking.
 */
export async function createLoadFromQuote(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const quoteId = String(formData.get('quoteId') ?? '');
  const carrierId = String(formData.get('carrierId') ?? '') || null;
  const origin = String(formData.get('origin') ?? '').trim();
  const destination = String(formData.get('destination') ?? '').trim();

  const { ctx, membership } = await requirePermission(orgId, PERMISSIONS.LOAD_CREATE);

  if (!origin || !destination) {
    return { ok: false, error: 'Origin and destination are required.' };
  }

  const supabase = await getServerSupabase();
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('id, load_id, rfq_id, is_override, override_approved_by, shipper_price_cents, pricing_snapshot')
    .eq('id', quoteId)
    .eq('org_id', orgId)
    .single();
  if (quoteError) throw quoteError;
  const bookable = quote as BookableQuote | null;
  if (!bookable) return { ok: false, error: 'Quote not found.' };
  if (bookable.load_id) return { ok: false, error: 'This quote is already attached to a load.' };
  if (!isQuoteReleasable({ required: bookable.is_override, reasons: [] }, bookable.override_approved_by)) {
    return { ok: false, error: 'This quote needs an approved override before it can be booked.' };
  }

  // FR-MGN-01/04: seed the load's reference-model financials. Shipper Cost is
  // the quote's shipper price; the two percentages resolve customer(shipper)
  // default → org house default → platform seed (a per-load override can be
  // set later on the load detail page). Carrier Pay is never stored — it's
  // recomputed everywhere from these inputs.
  let shipperId: string | null = null;
  let customerRates: { brokerPercent: number | null; dispatchPercent: number | null } | null = null;
  if (bookable.rfq_id) {
    const { data: rfq, error: rfqShipperError } = await supabase
      .from('rfqs')
      .select('shipper_id')
      .eq('id', bookable.rfq_id)
      .maybeSingle();
    if (rfqShipperError) throw rfqShipperError;
    shipperId = (rfq as { shipper_id: string | null } | null)?.shipper_id ?? null;
  }
  if (shipperId) {
    const { data: shipper, error: shipperError } = await supabase
      .from('shippers')
      .select('broker_percent, dispatch_percent')
      .eq('id', shipperId)
      .maybeSingle();
    if (shipperError) throw shipperError;
    const s = shipper as { broker_percent: number | null; dispatch_percent: number | null } | null;
    if (s) customerRates = { brokerPercent: s.broker_percent, dispatchPercent: s.dispatch_percent };
  }
  const orgDefault = await resolveOrgLoadMarginConfig(orgId);
  const seededPercents = resolveMarginPercents({ customer: customerRates, orgDefault });
  const shipperCostCents = bookable.shipper_price_cents;

  // FR-CMP-01/04: a carrier must be compliant to be assigned to a load.
  // Override is a business decision made once, at booking time — the release
  // gate below stays a hard, non-overridable check.
  let complianceOverride: { blockingReasons: string[]; reason: string } | null = null;
  if (carrierId) {
    const complianceResult = (await getCarrierComplianceResult(orgId, carrierId)) ?? NOT_REVIEWED_RESULT;
    if (!complianceResult.allowed) {
      const overrideRequested = formData.get('complianceOverride') === 'on';
      const overrideReason = String(formData.get('complianceOverrideReason') ?? '');
      if (!overrideRequested) {
        return {
          ok: false,
          error: `This carrier is not compliant: ${complianceResult.blockingReasons.join(' ')}`,
        };
      }
      const decision = evaluateComplianceOverride({
        requesterRoles: membership.role,
        reason: overrideReason,
        result: complianceResult,
      });
      if (!decision.ok) {
        return { ok: false, error: decision.message ?? decision.error ?? 'Compliance override denied.' };
      }
      complianceOverride = { blockingReasons: complianceResult.blockingReasons, reason: overrideReason.trim() };
    }
  }

  let created: { id: string; reference: string } | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS && !created; attempt++) {
    const { data: existing, error: existingError } = await supabase
      .from('loads_data')
      .select('reference')
      .eq('org_id', orgId);
    if (existingError) throw existingError;

    const reference = nextLoadReference(((existing ?? []) as { reference: string }[]).map((r) => r.reference));

    const { data, error } = await supabase
      .from('loads_data')
      .insert({
        org_id: orgId,
        rfq_id: bookable.rfq_id,
        shipper_id: shipperId,
        carrier_id: carrierId,
        service_type: 'trucking',
        reference,
        origin,
        destination,
        status: 'quoted',
        commercial_snapshot: bookable.pricing_snapshot,
        shipper_cost_cents: shipperCostCents,
        broker_percent: seededPercents.brokerPercent,
        dispatch_percent: seededPercents.dispatchPercent,
        created_by: ctx.userId,
      })
      .select('id, reference')
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        lastError = error;
        continue;
      }
      throw error;
    }
    created = data;
  }
  if (!created) throw lastError ?? new Error('Could not allocate a load reference.');

  const { error: linkError } = await supabase
    .from('quotes')
    .update({ load_id: created.id })
    .eq('id', quoteId);
  if (linkError) throw linkError;

  // FR-RFQ-02: booking a quote into a load advances its RFQ QUOTED -> BOOKED,
  // same guarded-UPDATE pattern as advanceRfqToQuoted (pricing/actions.ts) —
  // a no-op if the RFQ isn't at QUOTED for whatever reason.
  if (bookable.rfq_id) {
    const { data: rfqUpdated, error: rfqError } = await supabase
      .from('rfqs')
      .update({ status: RFQ_STATUS.BOOKED })
      .eq('id', bookable.rfq_id)
      .eq('status', RFQ_STATUS.QUOTED)
      .select('id');
    if (rfqError) throw rfqError;
    if (rfqUpdated && rfqUpdated.length > 0) {
      await writeAudit({
        orgId,
        actorUserId: ctx.userId,
        action: AUDIT_ACTIONS.RFQ_STATUS_CHANGED,
        entityType: 'rfq',
        entityId: bookable.rfq_id,
        before: { status: RFQ_STATUS.QUOTED },
        after: { status: RFQ_STATUS.BOOKED },
      });
    }
  }

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.LOAD_TRANSITION,
    entityType: 'load',
    entityId: created.id,
    after: { status: 'quoted', reference: created.reference, quoteId },
  });

  if (complianceOverride) {
    await writeAudit({
      orgId,
      actorUserId: ctx.userId,
      action: AUDIT_ACTIONS.COMPLIANCE_OVERRIDE,
      entityType: 'load',
      entityId: created.id,
      after: { carrierId, ...complianceOverride },
    });
  }

  // FR-NOTIF-01: booking a load is what makes sending a rate confirmation the
  // next real step — tell whoever can send one, rather than leaving it to be
  // noticed on the Loads page.
  let carrierName = 'the assigned carrier';
  if (carrierId) {
    const { data: carrier } = await supabase.from('carriers').select('name').eq('id', carrierId).maybeSingle();
    if (carrier) carrierName = carrier.name;
  }
  await notifyPermissionHolders(
    orgId,
    PERMISSIONS.RATECON_SEND,
    loadBookedReadyForRateconEmail({
      loadReference: created.reference,
      lane: `${origin} → ${destination}`,
      carrierName,
    }),
  );

  // Land the broker on the load they just booked — its detail page is where
  // the next steps (send rate confirmation, advance status) live. redirect()
  // throws NEXT_REDIRECT, so nothing after it runs and the ActionResult return
  // is never reached on the success path.
  revalidatePath('/portal/loads');
  redirect(`/portal/loads/${created.id}`);
}

interface LoadRow {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
  carrier_id: string | null;
  rfq_id: string | null;
}

/** FR-LD-02/FR-RC-05/FR-CMP-01: only a legal next status, gated on a signed rate-con and carrier compliance where required. */
export async function advanceLoadStatus(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const to = String(formData.get('to') ?? '') as LoadStatus;

  const { ctx } = await requirePermission(orgId, PERMISSIONS.LOAD_TRANSITION);

  const supabase = await getServerSupabase();
  const { data: load, error: loadError } = await supabase
    .from('loads_data')
    .select('id, reference, origin, destination, status, carrier_id, rfq_id')
    .eq('id', loadId)
    .eq('org_id', orgId)
    .single();
  if (loadError) throw loadError;
  const row = load as LoadRow | null;
  if (!row) return { ok: false, error: 'Load not found.' };

  const from = row.status;
  if (!canTransition(from, to)) {
    return { ok: false, error: `Cannot move a load from "${from}" to "${to}".` };
  }

  // These two steps are system-driven consequences of the rate-confirmation
  // flow (sendRatecon/signRatecon in portal/ratecons/actions.ts), not a
  // generic manual advance — sending the wrong one here would flip the load's
  // status without the rate confirmation that's supposed to accompany it.
  if (to === LOAD_STATUS.AWAITING_CARRIER_SIGNATURE) {
    return { ok: false, error: 'Send a rate confirmation from Rate Confirmations to advance this load.' };
  }
  if (to === LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE) {
    return { ok: false, error: 'This step happens automatically once the carrier signs the rate confirmation.' };
  }

  if (requiresSignedRateConfirmation(to)) {
    const { data: signed, error: rcError } = await supabase
      .from('rate_confirmations')
      .select('id')
      .eq('load_id', loadId)
      .eq('status', 'signed')
      .limit(1)
      .maybeSingle();
    if (rcError) throw rcError;
    if (!signed) {
      return {
        ok: false,
        error: 'This load needs a signed rate confirmation before it can be released to the driver.',
      };
    }

    // FR-CMP-01: the release-to-driver gate is a hard, non-overridable
    // compliance check — a booking-time override (createLoadFromQuote) does
    // not carry forward here. A carrier's compliance can change between
    // booking and release (e.g. insurance expiring), so it is re-checked now.
    if (!row.carrier_id) {
      return { ok: false, error: 'This load has no carrier assigned.' };
    }
    const complianceResult = (await getCarrierComplianceResult(orgId, row.carrier_id)) ?? NOT_REVIEWED_RESULT;
    if (!complianceResult.allowed) {
      return {
        ok: false,
        error: `Cannot release to driver — carrier is not compliant: ${complianceResult.blockingReasons.join(' ')}`,
      };
    }
  }

  const { error } = await supabase.from('loads_data').update({ status: to }).eq('id', loadId);
  if (error) throw error;

  // FR-RFQ-02: the load reaching its own final status (CLOSED) is what
  // advances the RFQ BOOKED -> CLOSED — everything between BOOKED and here
  // (signature, release, transit, delivery, invoicing) is load-internal detail
  // the RFQ's four-stage view doesn't need to track.
  if (to === LOAD_STATUS.CLOSED && row.rfq_id) {
    const { data: rfqUpdated, error: rfqError } = await supabase
      .from('rfqs')
      .update({ status: RFQ_STATUS.CLOSED })
      .eq('id', row.rfq_id)
      .eq('status', RFQ_STATUS.BOOKED)
      .select('id');
    if (rfqError) throw rfqError;
    if (rfqUpdated && rfqUpdated.length > 0) {
      await writeAudit({
        orgId,
        actorUserId: ctx.userId,
        action: AUDIT_ACTIONS.RFQ_STATUS_CHANGED,
        entityType: 'rfq',
        entityId: row.rfq_id,
        before: { status: RFQ_STATUS.BOOKED },
        after: { status: RFQ_STATUS.CLOSED },
      });
    }
  }

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.LOAD_TRANSITION,
    entityType: 'load',
    entityId: loadId,
    before: { status: from },
    after: { status: to },
  });

  // FR-NOTIF-01: delivered is what makes invoicing the next real step —
  // tell whoever can create an invoice, rather than leaving it to be
  // noticed later.
  if (to === LOAD_STATUS.DELIVERED) {
    await notifyPermissionHolders(
      orgId,
      PERMISSIONS.INVOICE_CREATE,
      loadDeliveredReadyToInvoiceEmail({
        loadReference: row.reference,
        lane: `${row.origin} → ${row.destination}`,
      }),
    );
  }

  revalidatePath('/portal/loads');
  revalidatePath(`/portal/loads/${loadId}`);
  return { ok: true };
}

/**
 * FR-ACC-01/02: record an accessorial charge against a load — detention,
 * layover, a lumper fee, or TONU. This is a record of a charge, not a
 * payment (Phase 1 does not move money): it doesn't touch the load's
 * commercial_snapshot or recompute margin, it's an additive line item for
 * the invoice engine to pick up once that exists (M6).
 */
export async function addAccessorial(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const type = String(formData.get('type') ?? '');
  const billableTo = String(formData.get('billableTo') ?? '');
  const dollars = Number(formData.get('amountDollars'));
  const description = String(formData.get('description') ?? '').trim() || null;

  const { ctx } = await requirePermission(orgId, PERMISSIONS.LOAD_EDIT);

  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { ok: false, error: 'Enter a valid amount.' };
  }
  const amountCents = Math.round(dollars * 100);

  const validation = validateAccessorial({ type, amountCents, billableTo, description: description ?? undefined });
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('accessorials')
    .insert({
      org_id: orgId,
      load_id: loadId,
      type,
      amount_cents: amountCents,
      billable_to: billableTo,
      description,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.ACCESSORIAL_ADDED,
    entityType: 'load',
    entityId: loadId,
    after: { accessorialId: data.id, type, amountCents, billableTo },
  });

  revalidatePath('/portal/loads');
  revalidatePath(`/portal/loads/${loadId}`);
  return { ok: true };
}

interface LoadMarginRow {
  shipper_cost_cents: number | null;
  broker_percent: number | null;
  dispatch_percent: number | null;
}

/**
 * FR-MGN-03/04: set the per-load override of Shipper Cost and the two
 * percentages. Gated by MARGIN_CONFIG (Owner + Broker only — dispatchers can
 * view but never edit), validated through the shared `validateMarginInputs`,
 * and audited before/after. Carrier Pay is not written — it's recomputed from
 * these inputs wherever the load is displayed.
 */
export async function editLoadMargins(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const shipperCostDollars = Number(formData.get('shipperCostDollars'));
  const brokerPercentInput = Number(formData.get('brokerPercent'));
  const dispatchPercentInput = Number(formData.get('dispatchPercent'));

  const { ctx } = await requirePermission(orgId, PERMISSIONS.MARGIN_CONFIG);

  if (!Number.isFinite(shipperCostDollars) || !Number.isFinite(brokerPercentInput) || !Number.isFinite(dispatchPercentInput)) {
    return { ok: false, error: 'Enter Shipper Cost, Broker %, and Dispatch %.' };
  }
  // UI collects percents on the 0-100 scale; store/compute as decimals [0,1].
  const shipperCostCents = Math.round(shipperCostDollars * 100);
  const brokerPercent = brokerPercentInput / 100;
  const dispatchPercent = dispatchPercentInput / 100;

  const validation = validateMarginInputs({ shipperCostCents, brokerPercent, dispatchPercent });
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const supabase = await getServerSupabase();
  const { data: before, error: beforeError } = await supabase
    .from('loads_data')
    .select('shipper_cost_cents, broker_percent, dispatch_percent')
    .eq('id', loadId)
    .eq('org_id', orgId)
    .single();
  if (beforeError) throw beforeError;
  if (!before) return { ok: false, error: 'Load not found.' };

  const { error } = await supabase
    .from('loads_data')
    .update({ shipper_cost_cents: shipperCostCents, broker_percent: brokerPercent, dispatch_percent: dispatchPercent })
    .eq('id', loadId)
    .eq('org_id', orgId);
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.LOAD_MARGIN_UPDATED,
    entityType: 'load',
    entityId: loadId,
    before: before as LoadMarginRow,
    after: { shipper_cost_cents: shipperCostCents, broker_percent: brokerPercent, dispatch_percent: dispatchPercent },
  });

  revalidatePath('/portal/loads');
  revalidatePath(`/portal/loads/${loadId}`);
  return { ok: true };
}
