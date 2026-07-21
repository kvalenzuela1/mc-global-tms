'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { nextLoadReference } from '@/lib/loads/reference';
import { canTransition, requiresSignedRateConfirmation, type LoadStatus } from '@/lib/loads/lifecycle';
import { isQuoteReleasable } from '@/lib/pricing/override';
import type { ActionResult } from '@/lib/actions/result';

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

  const { ctx } = await requirePermission(orgId, PERMISSIONS.LOAD_CREATE);

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

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.LOAD_TRANSITION,
    entityType: 'load',
    entityId: created.id,
    after: { status: 'quoted', reference: created.reference, quoteId },
  });

  revalidatePath('/portal/loads');
  return { ok: true };
}

interface LoadRow {
  id: string;
  status: LoadStatus;
}

/** FR-LD-02/FR-RC-05: only a legal next status, gated on a signed rate-con where required. */
export async function advanceLoadStatus(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const to = String(formData.get('to') ?? '') as LoadStatus;

  const { ctx } = await requirePermission(orgId, PERMISSIONS.LOAD_TRANSITION);

  const supabase = await getServerSupabase();
  const { data: load, error: loadError } = await supabase
    .from('loads_data')
    .select('id, status')
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
  }

  const { error } = await supabase.from('loads_data').update({ status: to }).eq('id', loadId);
  if (error) throw error;

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
