'use server';

import { revalidatePath } from 'next/cache';
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
import { getCarrierComplianceResult } from '@/lib/compliance/policy.server';
import { evaluateComplianceOverride } from '@/lib/compliance/override';
import type { ComplianceResult } from '@/lib/compliance/gate';
import { RFQ_STATUS } from '@/lib/rfqs/lifecycle';
import { validateAccessorial } from '@/lib/accessorials/calc';
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
    .select('id, load_id, rfq_id, is_override, override_approved_by, pricing_snapshot')
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
        carrier_id: carrierId,
        service_type: 'trucking',
        reference,
        origin,
        destination,
        status: 'quoted',
        commercial_snapshot: bookable.pricing_snapshot,
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

  revalidatePath('/portal/loads');
  return { ok: true };
}

interface LoadRow {
  id: string;
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
    .select('id, status, carrier_id, rfq_id')
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

  revalidatePath('/portal/loads');
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
  return { ok: true };
}
