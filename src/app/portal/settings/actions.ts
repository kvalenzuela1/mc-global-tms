'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase, getServiceRoleSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { validateMarginPercents } from '@/lib/pricing/margin';
import type { ActionResult } from '@/lib/actions/result';

/** Parse a 0-100 percent field into a decimal [0,1]; blank => null (inherit). */
function parsePercentField(raw: FormDataEntryValue | null): { ok: true; value: number | null } | { ok: false } {
  const s = String(raw ?? '').trim();
  if (s === '') return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false };
  return { ok: true, value: n / 100 };
}

/**
 * FR-MGN-04: set the ORG house default for the two margin percentages. Written
 * to the versioned `policies` table (policy_key 'load_margins', organization
 * scope) so the existing resolver picks it up over the platform seed.
 *
 * `policies` RLS (`pol_admin_write`) only lets org_admin write — but the client
 * requires the Broker role to edit defaults too, so this goes through the
 * service-role client AFTER an app-layer MARGIN_CONFIG gate, with org_id pinned
 * from the validated session (the same system-write pattern the ratecon flow
 * uses). It can only ever touch the caller's own org.
 */
export async function updateOrgMarginDefault(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const { ctx } = await requirePermission(orgId, PERMISSIONS.MARGIN_CONFIG);

  const brokerRaw = Number(formData.get('brokerPercent'));
  const dispatchRaw = Number(formData.get('dispatchPercent'));
  if (!Number.isFinite(brokerRaw) || !Number.isFinite(dispatchRaw)) {
    return { ok: false, error: 'Enter both a Broker % and a Dispatch %.' };
  }
  const brokerPercent = brokerRaw / 100;
  const dispatchPercent = dispatchRaw / 100;
  const validation = validateMarginPercents(brokerPercent, dispatchPercent);
  if (!validation.ok) return { ok: false, error: validation.error };

  const service = getServiceRoleSupabase();

  // Version + supersede: deactivate any current org-scope row, insert the next
  // version as the active one, so the change is auditable and reversible.
  const { data: existing, error: existingError } = await service
    .from('policies')
    .select('id, version, value')
    .eq('org_id', orgId)
    .eq('scope', 'organization')
    .eq('policy_key', 'load_margins')
    .order('version', { ascending: false });
  if (existingError) throw existingError;
  const rows = (existing as { id: string; version: number; value: Record<string, unknown> }[]) ?? [];
  const previous = rows.find(() => true) ?? null;
  const nextVersion = (previous?.version ?? 0) + 1;

  const activeIds = rows.map((r) => r.id);
  if (activeIds.length > 0) {
    const { error: deactivateError } = await service
      .from('policies')
      .update({ is_active: false })
      .in('id', activeIds);
    if (deactivateError) throw deactivateError;
  }

  const value = { broker_percent: brokerPercent, dispatch_percent: dispatchPercent };
  const { error: insertError } = await service.from('policies').insert({
    org_id: orgId,
    scope: 'organization',
    policy_key: 'load_margins',
    version: nextVersion,
    value,
    is_active: true,
    created_by: ctx.userId,
  });
  if (insertError) throw insertError;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.MARGIN_CONFIG_UPDATED,
    entityType: 'policy',
    entityId: null,
    before: previous?.value ?? null,
    after: { scope: 'organization', version: nextVersion, ...value },
  });

  revalidatePath('/portal/settings');
  revalidatePath('/portal/loads');
  return { ok: true };
}

/**
 * FR-MGN-04: set (or clear) a customer's per-shipper default percentages. These
 * live on the `shippers` row, whose RLS already lets any broker member write,
 * so this uses the normal RLS-bound client. A blank field clears the override,
 * falling the load back to the org house default.
 */
export async function updateCustomerMargin(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const shipperId = String(formData.get('shipperId') ?? '');
  const { ctx } = await requirePermission(orgId, PERMISSIONS.MARGIN_CONFIG);

  const broker = parsePercentField(formData.get('brokerPercent'));
  const dispatch = parsePercentField(formData.get('dispatchPercent'));
  if (!broker.ok || !dispatch.ok) {
    return { ok: false, error: 'Percentages must be between 0 and 100 (leave blank to inherit).' };
  }
  // If both are set, they still can't sum past 100%.
  if (broker.value !== null && dispatch.value !== null) {
    const validation = validateMarginPercents(broker.value, dispatch.value);
    if (!validation.ok) return { ok: false, error: validation.error };
  }

  const supabase = await getServerSupabase();
  const { data: before, error: beforeError } = await supabase
    .from('shippers')
    .select('broker_percent, dispatch_percent')
    .eq('id', shipperId)
    .eq('org_id', orgId)
    .single();
  if (beforeError) throw beforeError;
  if (!before) return { ok: false, error: 'Customer not found.' };

  const { error } = await supabase
    .from('shippers')
    .update({ broker_percent: broker.value, dispatch_percent: dispatch.value })
    .eq('id', shipperId)
    .eq('org_id', orgId);
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.MARGIN_CONFIG_UPDATED,
    entityType: 'shipper',
    entityId: shipperId,
    before,
    after: { broker_percent: broker.value, dispatch_percent: dispatch.value },
  });

  revalidatePath('/portal/settings');
  revalidatePath('/portal/loads');
  return { ok: true };
}
