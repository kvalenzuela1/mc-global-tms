'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { getFmcsaAdapter } from '@/adapters/fmcsa';
import type { AuthorityStatus, ManualReviewState } from '@/lib/compliance/gate';
import type { ActionResult } from '@/lib/actions/result';

const CARRIER_STATUSES = ['conditional', 'approved', 'suspended', 'rejected'] as const;
const MANUAL_REVIEW_STATES = ['approved', 'conditional', 'rejected', 'pending'] as const;

/** FR-CMP-03: a new carrier starts `conditional` — the schema's own default. */
export async function createCarrier(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const dotNumber = String(formData.get('dotNumber') ?? '').trim();
  const mcNumber = String(formData.get('mcNumber') ?? '').trim() || null;

  const { ctx } = await requirePermission(orgId, PERMISSIONS.CARRIER_MANAGE);

  if (!name || !dotNumber) {
    return { ok: false, error: 'Carrier name and DOT number are required.' };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('carriers')
    .insert({ org_id: orgId, name, dot_number: dotNumber, mc_number: mcNumber })
    .select('id')
    .single();
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.COMPLIANCE_CHECK,
    entityType: 'carrier',
    entityId: data.id,
    after: { name, dotNumber, mcNumber, status: 'conditional' },
    metadata: { event: 'carrier_created' },
  });

  revalidatePath('/portal/carriers');
  revalidatePath('/portal/loads');
  return { ok: true };
}

/** Coarse, broker-set administrative flag — independent of the detailed compliance gate. */
export async function setCarrierStatus(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const carrierId = String(formData.get('carrierId') ?? '');
  const status = String(formData.get('status') ?? '');

  const { ctx } = await requirePermission(orgId, PERMISSIONS.CARRIER_MANAGE);

  if (!CARRIER_STATUSES.includes(status as (typeof CARRIER_STATUSES)[number])) {
    return { ok: false, error: 'Invalid carrier status.' };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('carriers')
    .update({ status })
    .eq('id', carrierId)
    .eq('org_id', orgId);
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.COMPLIANCE_CHECK,
    entityType: 'carrier',
    entityId: carrierId,
    after: { status },
    metadata: { event: 'carrier_status_set' },
  });

  revalidatePath('/portal/carriers');
  revalidatePath('/portal/loads');
  return { ok: true };
}

interface LatestComplianceRow {
  insurance_expiry: string | null;
  auto_liability_cents: number | null;
  cargo_cents: number | null;
  required_docs_present: boolean;
  manual_review: ManualReviewState;
  authority_status: AuthorityStatus;
  out_of_service: boolean;
  fmcsa_source: string | null;
  fmcsa_fetched_at: string | null;
}

async function getLatestComplianceRow(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  orgId: string,
  carrierId: string,
): Promise<LatestComplianceRow | null> {
  const { data, error } = await supabase
    .from('carrier_compliance')
    .select(
      'insurance_expiry, auto_liability_cents, cargo_cents, required_docs_present, manual_review, authority_status, out_of_service, fmcsa_source, fmcsa_fetched_at',
    )
    .eq('org_id', orgId)
    .eq('carrier_id', carrierId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data as LatestComplianceRow[] | null)?.[0] ?? null;
}

/**
 * FR-ADP-FMCSA-01: refresh authority/out-of-service from the FMCSA adapter.
 * `carrier_compliance` is append-only (no `is_current` flag — latest row
 * wins), so this inserts a NEW row rather than updating, carrying forward
 * whichever fields the FMCSA adapter doesn't cover (insurance/coverage/docs/
 * manual review) unchanged from the previous row.
 */
export async function refreshFmcsaCheck(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const carrierId = String(formData.get('carrierId') ?? '');

  const { ctx } = await requirePermission(orgId, PERMISSIONS.COMPLIANCE_REVIEW);

  const supabase = await getServerSupabase();
  const { data: carrier, error: carrierError } = await supabase
    .from('carriers')
    .select('id, dot_number')
    .eq('id', carrierId)
    .eq('org_id', orgId)
    .single();
  if (carrierError) throw carrierError;
  if (!carrier) return { ok: false, error: 'Carrier not found.' };

  const result = await getFmcsaAdapter().lookupAuthority(carrier.dot_number);
  const previous = await getLatestComplianceRow(supabase, orgId, carrierId);

  const { error } = await supabase.from('carrier_compliance').insert({
    org_id: orgId,
    carrier_id: carrierId,
    authority_status: result.authorityStatus,
    out_of_service: result.outOfService,
    insurance_expiry: previous?.insurance_expiry ?? null,
    auto_liability_cents: previous?.auto_liability_cents ?? null,
    cargo_cents: previous?.cargo_cents ?? null,
    required_docs_present: previous?.required_docs_present ?? false,
    manual_review: previous?.manual_review ?? 'pending',
    fmcsa_source: result.source,
    fmcsa_fetched_at: result.fetchedAt,
  });
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.COMPLIANCE_CHECK,
    entityType: 'carrier',
    entityId: carrierId,
    after: { authorityStatus: result.authorityStatus, outOfService: result.outOfService, source: result.source },
    metadata: { event: 'fmcsa_refresh' },
  });

  revalidatePath('/portal/carriers');
  return { ok: true };
}

/**
 * FR-CMP-01/02/03: the manual side of a compliance review — insurance,
 * coverage, required docs, and the reviewer's approved/conditional/rejected
 * call. Inserts a new row, carrying forward authority/out-of-service/FMCSA
 * fields unchanged (this action never touches them).
 */
export async function updateComplianceReview(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const carrierId = String(formData.get('carrierId') ?? '');
  const insuranceExpiry = String(formData.get('insuranceExpiry') ?? '').trim() || null;
  const autoLiabilityDollars = formData.get('autoLiabilityDollars');
  const cargoDollars = formData.get('cargoDollars');
  const requiredDocsPresent = formData.get('requiredDocsPresent') === 'on';
  const manualReview = String(formData.get('manualReview') ?? '');

  const { ctx } = await requirePermission(orgId, PERMISSIONS.COMPLIANCE_REVIEW);

  if (!MANUAL_REVIEW_STATES.includes(manualReview as (typeof MANUAL_REVIEW_STATES)[number])) {
    return { ok: false, error: 'Invalid manual review value.' };
  }

  const autoLiabilityCents = autoLiabilityDollars ? Math.round(Number(autoLiabilityDollars) * 100) : null;
  const cargoCents = cargoDollars ? Math.round(Number(cargoDollars) * 100) : null;
  if (autoLiabilityDollars && !Number.isFinite(autoLiabilityCents)) {
    return { ok: false, error: 'Enter a valid auto liability amount.' };
  }
  if (cargoDollars && !Number.isFinite(cargoCents)) {
    return { ok: false, error: 'Enter a valid cargo coverage amount.' };
  }

  const supabase = await getServerSupabase();
  const previous = await getLatestComplianceRow(supabase, orgId, carrierId);

  const { error } = await supabase.from('carrier_compliance').insert({
    org_id: orgId,
    carrier_id: carrierId,
    authority_status: previous?.authority_status ?? 'unknown',
    out_of_service: previous?.out_of_service ?? false,
    fmcsa_source: previous?.fmcsa_source ?? null,
    fmcsa_fetched_at: previous?.fmcsa_fetched_at ?? null,
    insurance_expiry: insuranceExpiry,
    auto_liability_cents: autoLiabilityCents,
    cargo_cents: cargoCents,
    required_docs_present: requiredDocsPresent,
    manual_review: manualReview,
  });
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.COMPLIANCE_CHECK,
    entityType: 'carrier',
    entityId: carrierId,
    after: { insuranceExpiry, autoLiabilityCents, cargoCents, requiredDocsPresent, manualReview },
    metadata: { event: 'manual_review' },
  });

  revalidatePath('/portal/carriers');
  revalidatePath('/portal/loads');
  return { ok: true };
}
