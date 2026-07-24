'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase, getServiceRoleSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import {
  validateRfqInput,
  ltlTotalWeightLb,
  isValidDimensionUnit,
  isValidWeightUnit,
  type RfqValidationInput,
  type HandlingUnitInput,
} from '@/lib/rfqs/freight-detail';
import type { ActionResult } from '@/lib/actions/result';

/**
 * FIRST server action in the repo — establishes the pattern every later
 * mutation (pricing, loads, ...) follows: requirePermission -> getServerSupabase
 * -> mutate -> revalidatePath. `orgId` comes from a hidden field set from the
 * server-resolved active workspace, but requirePermission re-validates
 * membership + permission for it regardless, so a tampered value just 403s.
 *
 * FR-RFQ-04: the RFQ is now shipment-type-driven (FTL/LTL/PTL). The client
 * validates for inline errors, but this re-runs the EXACT same
 * `validateRfqInput` contract — client input is never trusted. LTL handling
 * units arrive as one JSON hidden field (there is no array-input precedent in
 * this app; a single JSON field keeps parsing trivial and unambiguous). On
 * success both branches redirect to the new RFQ's detail page (redirect()
 * throws NEXT_REDIRECT, so nothing after it runs).
 *
 * A shipper submitting their own RFQ is a different case, split out below:
 * `orgId` for them is their OWN org, not the broker tenant `rfqs.org_id` must
 * carry, and `rfqs_write` RLS has no shipper insert carve-out at all
 * (broker-org-only) — so that branch resolves the broker's org id itself and
 * writes through the service-role client. The child `rfq_handling_units` write
 * follows the same wall, so it uses the same client.
 */
export async function createRfq(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const { ctx, membership } = await requirePermission(orgId, PERMISSIONS.RFQ_CREATE);

  const str = (name: string): string => String(formData.get(name) ?? '').trim();
  const strOrNull = (name: string): string | null => str(name) || null;
  const numOrNull = (name: string): number | null => {
    const raw = str(name);
    return raw ? Number(raw) : null;
  };
  const bool = (name: string): boolean => {
    const v = str(name);
    return v === 'true' || v === 'on' || v === '1';
  };

  const shipmentType = str('shipmentType');
  const isHazmat = bool('isHazmat');

  // Parse LTL handling units from the single JSON hidden field.
  let handlingUnits: HandlingUnitInput[] = [];
  const unitsRaw = str('handlingUnits');
  if (unitsRaw) {
    try {
      const parsed = JSON.parse(unitsRaw);
      if (Array.isArray(parsed)) handlingUnits = parsed as HandlingUnitInput[];
    } catch {
      return { ok: false, error: 'Could not read the handling units. Please re-enter them.' };
    }
  }

  const validationInput: RfqValidationInput = {
    shipmentType,
    shipFromCity: str('shipFromCity'),
    shipFromState: str('shipFromState'),
    shipFromZip: str('shipFromZip'),
    shipToCity: str('shipToCity'),
    shipToState: str('shipToState'),
    shipToZip: str('shipToZip'),
    pickupDate: str('pickupDate'),
    pickupWindowStart: str('pickupWindowStart'),
    pickupWindowEnd: str('pickupWindowEnd'),
    deliveryDate: str('deliveryDate'),
    commodity: str('commodity'),
    totalWeight: str('totalWeight'),
    isHazmat,
    unNumber: str('unNumber'),
    hazmatClass: str('hazmatClass'),
    equipmentType: str('equipmentType'),
    temperatureF: str('temperatureF'),
    trailerSize: str('trailerSize'),
    palletCount: str('palletCount'),
    lengthIn: str('lengthIn'),
    widthIn: str('widthIn'),
    heightIn: str('heightIn'),
    linearFeet: str('linearFeet'),
    freightDescription: str('freightDescription'),
    handlingUnits,
  };

  // Inject "today" as a YYYY-MM-DD string so the validator stays pure and the
  // past-date rule is deterministic. Server clock is the authority — the client
  // can't backdate a pickup by lying about "now".
  const todayIso = new Date().toISOString().slice(0, 10);
  const validation = validateRfqInput(validationInput, todayIso);
  if (!validation.ok) {
    return { ok: false, error: Object.values(validation.errors)[0] ?? 'Please correct the highlighted fields.' };
  }

  // Units for storage are always inches + lb (see migration 0015).
  const dimensionUnit = shipmentType === 'ltl' ? 'in' : str('dimensionUnit') || 'in';
  if (!isValidDimensionUnit(dimensionUnit)) return { ok: false, error: 'Invalid dimension unit.' };
  const grossWeightUnit = shipmentType === 'ltl' ? 'lb' : str('grossWeightUnit') || 'lb';
  if (!isValidWeightUnit(grossWeightUnit)) return { ok: false, error: 'Invalid weight unit.' };

  // Derived gross weight: entered for FTL/PTL, summed from the units for LTL
  // (never a separate, contradictable client field for LTL).
  const grossWeightValue =
    shipmentType === 'ltl' ? ltlTotalWeightLb(handlingUnits) : numOrNull('totalWeight');

  // Keep origin/destination populated as a "City, ST" display string so every
  // existing reader (list, detail, ratecons, loads) is unaffected by the move
  // to structured addresses.
  const origin = `${str('shipFromCity')}, ${str('shipFromState')}`;
  const destination = `${str('shipToCity')}, ${str('shipToState')}`;

  const rfqRecord = {
    service_type: str('serviceType') || 'trucking',
    shipment_type: shipmentType,
    origin,
    destination,
    ship_from_name: strOrNull('shipFromName'),
    ship_from_address: strOrNull('shipFromAddress'),
    ship_from_city: str('shipFromCity'),
    ship_from_state: str('shipFromState'),
    ship_from_zip: str('shipFromZip'),
    ship_to_name: strOrNull('shipToName'),
    ship_to_address: strOrNull('shipToAddress'),
    ship_to_city: str('shipToCity'),
    ship_to_state: str('shipToState'),
    ship_to_zip: str('shipToZip'),
    commodity: str('commodity'),
    reference_number: strOrNull('referenceNumber'),
    freight_details: null as string | null,
    pickup_at: strOrNull('pickupDate'),
    pickup_window_start: strOrNull('pickupWindowStart'),
    pickup_window_end: strOrNull('pickupWindowEnd'),
    delivery_at: strOrNull('deliveryDate'),
    acc_liftgate: bool('accLiftgate'),
    acc_residential: bool('accResidential'),
    acc_inside_pickup: bool('accInsidePickup'),
    acc_inside_delivery: bool('accInsideDelivery'),
    acc_limited_access: bool('accLimitedAccess'),
    is_hazmat: isHazmat,
    un_number: isHazmat ? strOrNull('unNumber') : null,
    hazmat_class: isHazmat ? strOrNull('hazmatClass') : null,
    // FTL (equipment_type is shared vocab from 0014; only set for FTL here).
    equipment_type: shipmentType === 'ftl' ? strOrNull('equipmentType') : null,
    temperature_f: shipmentType === 'ftl' && str('equipmentType') === 'reefer' ? numOrNull('temperatureF') : null,
    trailer_size: shipmentType === 'ftl' ? strOrNull('trailerSize') : null,
    // FTL/PTL shared
    pallet_count: shipmentType === 'ltl' ? null : numOrNull('palletCount'),
    stackable: shipmentType === 'ltl' ? false : bool('stackable'),
    // PTL (dims/weight reuse the 0010 single-value columns)
    length_value: shipmentType === 'ptl' ? numOrNull('lengthIn') : null,
    width_value: shipmentType === 'ptl' ? numOrNull('widthIn') : null,
    height_value: shipmentType === 'ptl' ? numOrNull('heightIn') : null,
    dimension_unit: dimensionUnit,
    linear_feet: shipmentType === 'ptl' ? numOrNull('linearFeet') : null,
    freight_description: shipmentType === 'ptl' ? strOrNull('freightDescription') : null,
    gross_weight_value: grossWeightValue,
    gross_weight_unit: grossWeightUnit,
    status: 'open',
    created_by: ctx.userId,
  };

  const unitRows = (orgIdForUnits: string, rfqId: string) =>
    handlingUnits.map((u, i) => ({
      rfq_id: rfqId,
      org_id: orgIdForUnits,
      position: i,
      length_in: Number(u.lengthIn),
      width_in: Number(u.widthIn),
      height_in: Number(u.heightIn),
      weight_lb: Number(u.weightLb),
      unit_count: Number(u.unitCount),
      packaging_type: String(u.packagingType),
      freight_class: Number(u.freightClass),
      freight_class_is_override: Boolean(u.freightClassIsOverride),
      nmfc_code: u.nmfcCode ? String(u.nmfcCode).trim() : null,
      stackable: Boolean(u.stackable),
    }));

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
    const { data: created, error } = await serviceRole
      .from('rfqs')
      .insert({ ...rfqRecord, org_id: shipper.org_id, shipper_id: shipper.id })
      .select('id')
      .single();
    if (error) throw error;

    if (shipmentType === 'ltl' && handlingUnits.length > 0) {
      const { error: unitError } = await serviceRole
        .from('rfq_handling_units')
        .insert(unitRows(shipper.org_id, created.id));
      if (unitError) {
        // Don't leave an RFQ with no freight behind if the child insert fails.
        await serviceRole.from('rfqs').delete().eq('id', created.id);
        throw unitError;
      }
    }

    revalidatePath('/portal/rfqs');
    redirect(`/portal/rfqs/${created.id}`);
  }

  const shipperId = strOrNull('shipperId');
  const supabase = await getServerSupabase();
  const { data: created, error } = await supabase
    .from('rfqs')
    .insert({ ...rfqRecord, org_id: orgId, shipper_id: shipperId })
    .select('id')
    .single();
  if (error) throw error;

  if (shipmentType === 'ltl' && handlingUnits.length > 0) {
    const { error: unitError } = await supabase
      .from('rfq_handling_units')
      .insert(unitRows(orgId, created.id));
    if (unitError) {
      await supabase.from('rfqs').delete().eq('id', created.id);
      throw unitError;
    }
  }

  revalidatePath('/portal/rfqs');
  redirect(`/portal/rfqs/${created.id}`);
}
