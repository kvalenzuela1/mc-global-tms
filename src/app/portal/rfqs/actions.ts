'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase, getServiceRoleSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import type { ActionResult } from '@/lib/actions/result';

/**
 * FIRST server action in the repo — establishes the pattern every later
 * mutation (pricing, loads, ...) follows: requirePermission -> getServerSupabase
 * -> mutate -> revalidatePath. `orgId` comes from a hidden field set from the
 * server-resolved active workspace, but requirePermission re-validates
 * membership + permission for it regardless, so a tampered value just 403s.
 *
 * A shipper submitting their own RFQ is a different case, split out below:
 * `orgId` for them is their OWN org, not the broker tenant `rfqs.org_id`
 * must carry, and `rfqs_write` RLS has no shipper insert carve-out at all
 * (broker-org-only, same wall `signRatecon` in ratecons/actions.ts already
 * solved for carriers) — so that branch resolves the broker's org id itself
 * and writes through the service-role client instead.
 */
export async function createRfq(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const { ctx, membership } = await requirePermission(orgId, PERMISSIONS.RFQ_CREATE);

  const serviceType = String(formData.get('serviceType') ?? 'trucking');
  const origin = String(formData.get('origin') ?? '').trim();
  const destination = String(formData.get('destination') ?? '').trim();
  const freightDetails = String(formData.get('freightDetails') ?? '').trim() || null;
  const pickupAt = String(formData.get('pickupAt') ?? '') || null;

  if (!origin || !destination) {
    return { ok: false, error: 'Origin and destination are required.' };
  }

  if (membership.role === ROLES.SHIPPER) {
    const supabase = await getServerSupabase();
    const { data: shipper, error: shipperError } = await supabase
      .from('shippers')
      .select('id, org_id')
      .eq('shipper_org_id', orgId)
      .maybeSingle();
    if (shipperError) throw shipperError;
    if (!shipper) {
      return { ok: false, error: 'No shipper profile found. Contact your broker to link your account.' };
    }

    const serviceRole = getServiceRoleSupabase();
    const { error } = await serviceRole.from('rfqs').insert({
      org_id: shipper.org_id,
      shipper_id: shipper.id,
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

  const shipperId = String(formData.get('shipperId') ?? '') || null;
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
