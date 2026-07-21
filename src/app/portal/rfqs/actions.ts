'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase, getServiceRoleSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import {
  isValidPackagingType,
  isValidWeightUnit,
  isValidDimensionUnit,
  isValidFreightClass,
} from '@/lib/rfqs/freight-detail';
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

  const packagingType = String(formData.get('packagingType') ?? '').trim() || null;
  if (packagingType && !isValidPackagingType(packagingType)) {
    return { ok: false, error: 'Invalid packaging type.' };
  }

  const pieceCountRaw = formData.get('pieceCount');
  const pieceCount = pieceCountRaw ? Number(pieceCountRaw) : null;
  if (pieceCountRaw && (!Number.isInteger(pieceCount) || (pieceCount as number) < 0)) {
    return { ok: false, error: 'Piece count must be a non-negative whole number.' };
  }

  const packageCountRaw = formData.get('packageCount');
  const packageCount = packageCountRaw ? Number(packageCountRaw) : null;
  if (packageCountRaw && (!Number.isInteger(packageCount) || (packageCount as number) < 0)) {
    return { ok: false, error: 'Package count must be a non-negative whole number.' };
  }

  const grossWeightValueRaw = formData.get('grossWeightValue');
  const grossWeightValue = grossWeightValueRaw ? Number(grossWeightValueRaw) : null;
  if (grossWeightValueRaw && (!Number.isFinite(grossWeightValue) || (grossWeightValue as number) < 0)) {
    return { ok: false, error: 'Enter a valid gross weight.' };
  }
  const grossWeightUnit = String(formData.get('grossWeightUnit') ?? 'lb');
  if (!isValidWeightUnit(grossWeightUnit)) {
    return { ok: false, error: 'Invalid weight unit.' };
  }

  const lengthValueRaw = formData.get('lengthValue');
  const lengthValue = lengthValueRaw ? Number(lengthValueRaw) : null;
  const widthValueRaw = formData.get('widthValue');
  const widthValue = widthValueRaw ? Number(widthValueRaw) : null;
  const heightValueRaw = formData.get('heightValue');
  const heightValue = heightValueRaw ? Number(heightValueRaw) : null;
  for (const [raw, value] of [
    [lengthValueRaw, lengthValue],
    [widthValueRaw, widthValue],
    [heightValueRaw, heightValue],
  ] as const) {
    if (raw && (!Number.isFinite(value) || (value as number) < 0)) {
      return { ok: false, error: 'Enter valid dimensions.' };
    }
  }
  const dimensionUnit = String(formData.get('dimensionUnit') ?? 'in');
  if (!isValidDimensionUnit(dimensionUnit)) {
    return { ok: false, error: 'Invalid dimension unit.' };
  }

  const nmfcCode = String(formData.get('nmfcCode') ?? '').trim() || null;

  const freightClassRaw = formData.get('freightClass');
  const freightClass = freightClassRaw ? Number(freightClassRaw) : null;
  if (freightClassRaw && !isValidFreightClass(freightClass as number)) {
    return { ok: false, error: 'Invalid freight class.' };
  }

  const freightDetailFields = {
    packaging_type: packagingType,
    piece_count: pieceCount,
    package_count: packageCount,
    gross_weight_value: grossWeightValue,
    gross_weight_unit: grossWeightUnit,
    length_value: lengthValue,
    width_value: widthValue,
    height_value: heightValue,
    dimension_unit: dimensionUnit,
    nmfc_code: nmfcCode,
    freight_class: freightClass,
  };

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
      ...freightDetailFields,
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
    ...freightDetailFields,
  });
  if (error) throw error;

  revalidatePath('/portal/rfqs');
  return { ok: true };
}
