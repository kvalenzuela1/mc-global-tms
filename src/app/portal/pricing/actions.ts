'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { computePricing } from '@/lib/pricing/calc';
import { resolveOrgPricingConfig } from '@/lib/config/policies.server';
import { assessOverride, evaluateRequest, evaluateApproval } from '@/lib/pricing/override';
import { RFQ_STATUS } from '@/lib/rfqs/lifecycle';
import type { ActionResult } from '@/lib/actions/result';

/**
 * FR-RFQ-02: a quote against an RFQ advances it OPEN -> QUOTED. Guarded by
 * `.eq('status', RFQ_STATUS.OPEN)` rather than a read-then-write, so this is
 * a no-op (not an error) if the RFQ has already moved past OPEN — e.g. a
 * second quote requested for the same RFQ after the first was rejected.
 */
async function advanceRfqToQuoted(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  orgId: string,
  actorUserId: string,
  rfqId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('rfqs')
    .update({ status: RFQ_STATUS.QUOTED })
    .eq('id', rfqId)
    .eq('status', RFQ_STATUS.OPEN)
    .select('id');
  if (error) throw error;
  // Only audit a real transition — `.select('id')` comes back empty on the
  // guarded no-op (RFQ already past OPEN), and a no-op isn't an event.
  if (data && data.length > 0) {
    await writeAudit({
      orgId,
      actorUserId,
      action: AUDIT_ACTIONS.RFQ_STATUS_CHANGED,
      entityType: 'rfq',
      entityId: rfqId,
      before: { status: RFQ_STATUS.OPEN },
      after: { status: RFQ_STATUS.QUOTED },
    });
  }
}

/**
 * Quote a lane and, when the quote breaches policy, request a pricing
 * override in the same step (FR-PR-05/06). `evaluateRequest` re-checks the
 * requester's permission and the policy breach server-side — the form never
 * gets to decide either on its own.
 */
export async function createQuote(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const { ctx, membership } = await requirePermission(orgId, PERMISSIONS.QUOTE_CREATE);

  const rfqId = String(formData.get('rfqId') ?? '') || null;
  const dollars = Number(formData.get('carrierLinehaulDollars'));
  const reason = String(formData.get('reason') ?? '');

  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { ok: false, error: 'Enter a valid carrier linehaul amount.' };
  }
  const carrierLinehaulCents = Math.round(dollars * 100);

  const config = await resolveOrgPricingConfig(orgId);
  const pricing = computePricing({ carrierLinehaulCents, config });
  const assessment = assessOverride(pricing);

  const supabase = await getServerSupabase();
  const base = {
    org_id: orgId,
    rfq_id: rfqId,
    carrier_linehaul_cents: pricing.carrierLinehaulCents,
    shipper_price_cents: pricing.shipperPriceCents,
    margin_amount_cents: pricing.marginAmountCents,
    margin_percent: pricing.marginPercent,
    target_margin_percent: pricing.targetMarginPercent,
    quick_pay_fee_percent: pricing.quickPayFeePercent,
    quick_pay_fee_cents: pricing.quickPayFeeCents,
    factoring_cost_percent: pricing.factoringCostPercent,
    pricing_snapshot: pricing,
    created_by: ctx.userId,
  };

  if (!assessment.required) {
    const { error } = await supabase
      .from('quotes')
      .insert({ ...base, is_override: false, status: 'approved' });
    if (error) throw error;
    if (rfqId) await advanceRfqToQuoted(supabase, orgId, ctx.userId, rfqId);
    revalidatePath('/portal/pricing');
    return { ok: true };
  }

  const decision = evaluateRequest({
    requestedByUserId: ctx.userId,
    requesterRoles: membership.role,
    reason,
    assessment,
  });
  if (!decision.ok) {
    return { ok: false, error: decision.message ?? decision.error ?? 'Override request denied.' };
  }

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      ...base,
      is_override: true,
      override_reason: reason.trim(),
      override_requested_by: ctx.userId,
      status: 'pending_approval',
    })
    .select('id')
    .single();
  if (error) throw error;
  if (rfqId) await advanceRfqToQuoted(supabase, orgId, ctx.userId, rfqId);

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.PRICING_OVERRIDE_REQUESTED,
    entityType: 'quote',
    entityId: data.id,
    after: { reason: reason.trim(), reasons: assessment.reasons },
  });

  revalidatePath('/portal/pricing');
  return { ok: true };
}

interface PendingQuote {
  id: string;
  override_requested_by: string | null;
  override_approved_by: string | null;
  status: string;
}

async function loadPendingQuote(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  orgId: string,
  quoteId: string,
): Promise<PendingQuote | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select('id, override_requested_by, override_approved_by, status')
    .eq('id', quoteId)
    .eq('org_id', orgId)
    .single();
  if (error) throw error;
  return data as PendingQuote | null;
}

/** FR-PR-06: separation of duties — enforced again here, not just in the UI. */
export async function approveOverride(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const quoteId = String(formData.get('quoteId') ?? '');
  const { ctx, membership } = await requirePermission(orgId, PERMISSIONS.PRICING_OVERRIDE_APPROVE);

  const supabase = await getServerSupabase();
  const quote = await loadPendingQuote(supabase, orgId, quoteId);
  if (!quote) return { ok: false, error: 'Quote not found.' };

  const decision = evaluateApproval({
    approverUserId: ctx.userId,
    approverRoles: membership.role,
    requestedByUserId: quote.override_requested_by ?? '',
    alreadyApprovedBy: quote.override_approved_by,
  });
  if (!decision.ok) {
    return { ok: false, error: decision.message ?? decision.error ?? 'Approval denied.' };
  }

  const { error } = await supabase
    .from('quotes')
    .update({
      override_approved_by: ctx.userId,
      override_approved_at: new Date().toISOString(),
      status: 'approved',
    })
    .eq('id', quoteId);
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.PRICING_OVERRIDE_APPROVED,
    entityType: 'quote',
    entityId: quoteId,
  });

  revalidatePath('/portal/pricing');
  return { ok: true };
}

export async function rejectOverride(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const quoteId = String(formData.get('quoteId') ?? '');
  const { ctx } = await requirePermission(orgId, PERMISSIONS.PRICING_OVERRIDE_APPROVE);

  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('quotes')
    .update({ status: 'rejected' })
    .eq('id', quoteId)
    .eq('org_id', orgId)
    .eq('status', 'pending_approval');
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.PRICING_OVERRIDE,
    entityType: 'quote',
    entityId: quoteId,
    metadata: { decision: 'rejected' },
  });

  revalidatePath('/portal/pricing');
  return { ok: true };
}
