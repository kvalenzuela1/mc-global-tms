'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase, getServiceRoleSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { LOAD_STATUS, canTransition, type LoadStatus } from '@/lib/loads/lifecycle';
import type { ActionResult } from '@/lib/actions/result';

const MILESTONE_KINDS = new Set(['pickup', 'check_call', 'in_transit', 'delivery', 'exception']);

interface OwnedLoad {
  id: string;
  org_id: string;
  status: LoadStatus;
  driver_id: string | null;
}

/**
 * `loads_write` RLS has no driver carve-out (see loads/page.tsx's masking
 * note) — a driver's own session can only ever SELECT its assigned load
 * (via the masked `loads` view, same as everywhere else a non-broker role
 * reads loads). Every action below re-resolves the driver's own `drivers`
 * row and re-checks it owns the target load rather than trusting the form's
 * loadId, then hands off to whichever client (RLS-scoped or service-role)
 * the actual write needs.
 */
async function resolveOwnedLoad(userId: string, loadId: string) {
  const supabase = await getServerSupabase();
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (driverError) throw driverError;
  if (!driver) return { supabase, load: null };

  const { data: load, error: loadError } = await supabase
    .from('loads')
    .select('id, org_id, status, driver_id')
    .eq('id', loadId)
    .maybeSingle();
  if (loadError) throw loadError;
  const row = load as OwnedLoad | null;
  if (!row || row.driver_id !== driver.id) return { supabase, load: null };
  return { supabase, load: row };
}

/**
 * FR-LD-02/FR-AUD-01: released_to_driver -> driver_acknowledged. Since
 * `loads_write` RLS is broker-org-only, the flip itself uses the
 * service-role client — same reasoning as `signRatecon` in
 * ratecons/actions.ts — only after requirePermission + the ownership check
 * above have confirmed this driver is legitimately entitled to act.
 */
export async function acknowledgeLoad(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const { ctx } = await requirePermission(orgId, PERMISSIONS.DRIVER_ACK);

  const { load } = await resolveOwnedLoad(ctx.userId, loadId);
  if (!load) return { ok: false, error: 'Load not found.' };
  if (!canTransition(load.status, LOAD_STATUS.DRIVER_ACKNOWLEDGED)) {
    return { ok: false, error: 'This load is not awaiting acknowledgement.' };
  }

  const serviceRole = getServiceRoleSupabase();
  const { data: updated, error } = await serviceRole
    .from('loads_data')
    .update({ status: LOAD_STATUS.DRIVER_ACKNOWLEDGED })
    .eq('id', load.id)
    .eq('status', LOAD_STATUS.RELEASED_TO_DRIVER)
    .select('id');
  if (error) throw error;
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'This load already moved on — refresh and try again.' };
  }

  await writeAudit({
    orgId: load.org_id,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.DRIVER_ACK,
    entityType: 'load',
    entityId: load.id,
    after: { status: LOAD_STATUS.DRIVER_ACKNOWLEDGED },
  });

  revalidatePath('/portal/driver');
  return { ok: true };
}

/**
 * `milestones_write` RLS already carves out `app_user_can_access_load`
 * (driver-owns-load included) — no service-role write needed here, unlike
 * acknowledgeLoad above.
 */
export async function recordMilestone(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const kind = String(formData.get('kind') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;
  const { ctx } = await requirePermission(orgId, PERMISSIONS.MILESTONE_RECORD);

  if (!MILESTONE_KINDS.has(kind)) {
    return { ok: false, error: 'Invalid milestone type.' };
  }

  const { supabase, load } = await resolveOwnedLoad(ctx.userId, loadId);
  if (!load) return { ok: false, error: 'Load not found.' };

  const { error } = await supabase.from('milestones').insert({
    org_id: load.org_id,
    load_id: load.id,
    kind,
    note,
    recorded_by: ctx.userId,
  });
  if (error) throw error;

  revalidatePath('/portal/driver');
  return { ok: true };
}
