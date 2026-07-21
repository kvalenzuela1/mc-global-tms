'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import type { ActionResult } from '@/lib/actions/result';

/**
 * FIRST server action in the repo — establishes the pattern every later
 * mutation (pricing, loads, ...) follows: requirePermission -> getServerSupabase
 * -> mutate -> revalidatePath. `orgId` comes from a hidden field set from the
 * server-resolved active workspace, but requirePermission re-validates
 * membership + permission for it regardless, so a tampered value just 403s.
 */
export async function createRfq(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const { ctx } = await requirePermission(orgId, PERMISSIONS.RFQ_CREATE);

  const shipperId = String(formData.get('shipperId') ?? '') || null;
  const serviceType = String(formData.get('serviceType') ?? 'trucking');
  const origin = String(formData.get('origin') ?? '').trim();
  const destination = String(formData.get('destination') ?? '').trim();
  const freightDetails = String(formData.get('freightDetails') ?? '').trim() || null;
  const pickupAt = String(formData.get('pickupAt') ?? '') || null;

  if (!origin || !destination) {
    return { ok: false, error: 'Origin and destination are required.' };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.from('rfqs').insert({
    org_id: orgId,
    shipper_id: shipperId,
    service_type: serviceType,
    origin,
    destination,
    freight_details: freightDetails,
    pickup_at: pickupAt,
    status: 'open',
    created_by: ctx.userId,
  });
  if (error) throw error;

  revalidatePath('/portal/rfqs');
  return { ok: true };
}
