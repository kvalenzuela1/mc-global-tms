/**
 * FR-RFQ-03: structured freight-detail enums shared by the RFQ create form
 * (client) and `createRfq` (server) — kept free of Next/Supabase imports so
 * it stays offline-testable, same convention as `src/lib/rfqs/lifecycle.ts`.
 */

import { isValidEquipmentType } from './equipment';

export const PACKAGING_TYPES = ['pallet', 'crate', 'box', 'drum', 'tote'] as const;
export type PackagingType = (typeof PACKAGING_TYPES)[number];

export const PACKAGING_TYPE_LABELS: Record<PackagingType, string> = {
  pallet: 'Pallet',
  crate: 'Crate',
  box: 'Box',
  drum: 'Drum',
  tote: 'Tote',
};

export const WEIGHT_UNITS = ['lb', 'kg'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const DIMENSION_UNITS = ['in', 'cm'] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

/**
 * Real NMFC freight classes are a fixed set of 18 density tiers, not a
 * continuous "50 to 500" range. Source: NMFTA (National Motor Freight
 * Traffic Association), https://nmfta.org/standards/classification/nmfc/ —
 * the body that develops/publishes the NMFC standard.
 */
export const FREIGHT_CLASSES = [
  50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
] as const;
export type FreightClass = (typeof FREIGHT_CLASSES)[number];

export function isValidFreightClass(value: number): value is FreightClass {
  return (FREIGHT_CLASSES as readonly number[]).includes(value);
}

export function isValidPackagingType(value: string): value is PackagingType {
  return (PACKAGING_TYPES as readonly string[]).includes(value);
}

export function isValidWeightUnit(value: string): value is WeightUnit {
  return (WEIGHT_UNITS as readonly string[]).includes(value);
}

export function isValidDimensionUnit(value: string): value is DimensionUnit {
  return (DIMENSION_UNITS as readonly string[]).includes(value);
}

/**
 * NMFC item numbers aren't a fixed digit count in practice — they range
 * roughly 4-7 digits and often carry a sub-code suffix (e.g. "156600-01"),
 * so this deliberately doesn't pin an exact length or reject sub-codes.
 * It only catches obvious garbage (letters, punctuation) — digits,
 * whitespace, and hyphens only.
 *
 * If a stricter format is ever needed (e.g. a carrier integration that
 * requires a specific item-number shape), NMFTA's classification lookup
 * tool is the authoritative source to validate real item numbers against
 * rather than guessing a regex: https://classitplus.nmfta.org/ (see also
 * https://nmfta.org/standards/classification/nmfc/ for the standard itself).
 */
const NMFC_CODE_RE = /^[\d\s-]+$/;

export function isValidNmfcCode(value: string): boolean {
  return NMFC_CODE_RE.test(value);
}

// =============================================================================
// FR-RFQ-04: shipment-type-driven RFQ (FTL / LTL / PTL)
//
// A shipment type is a NEW axis, orthogonal to `service_type`
// (trucking/drayage/...) and to `equipment_type` (the trailer, single-sourced
// in ./equipment.ts). It selects which fields are relevant and drives the
// per-type validation contract below. Kept import-free of Next/Supabase so the
// whole validator stays offline-testable.
// =============================================================================

export const SHIPMENT_TYPES = ['ftl', 'ltl', 'ptl'] as const;
export type ShipmentType = (typeof SHIPMENT_TYPES)[number];

export const SHIPMENT_TYPE_LABELS: Record<ShipmentType, string> = {
  ftl: 'FTL — Full Truckload',
  ltl: 'LTL — Less Than Truckload',
  ptl: 'PTL — Partial Truckload',
};

export function isValidShipmentType(value: string): value is ShipmentType {
  return (SHIPMENT_TYPES as readonly string[]).includes(value);
}

export const TRAILER_SIZES = ['48', '53'] as const;
export type TrailerSize = (typeof TRAILER_SIZES)[number];

export function isValidTrailerSize(value: string): value is TrailerSize {
  return (TRAILER_SIZES as readonly string[]).includes(value);
}

/**
 * DOT/UN hazard classes (49 CFR §172.101). Stored as the top-level class
 * string ('1'..'9'); sub-divisions (1.1, 2.1, ...) are entered free-form in
 * the UN number / description rather than enumerated here.
 */
export const HAZMAT_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type HazmatClass = (typeof HAZMAT_CLASSES)[number];

export function isValidHazmatClass(value: string): value is HazmatClass {
  return (HAZMAT_CLASSES as readonly string[]).includes(value);
}

/** UN numbers are always exactly four digits (UN0001–UN3548 range). */
const UN_NUMBER_RE = /^\d{4}$/;
export function isValidUnNumber(value: string): boolean {
  return UN_NUMBER_RE.test(value);
}

/**
 * US ZIP: 5 digits or ZIP+4 (`12345` or `12345-6789`). RFQ addresses are US
 * domestic in Phase 1; if international lanes are added later this needs a
 * country-aware postal validator, not a looser regex.
 */
const ZIP_RE = /^\d{5}(-\d{4})?$/;
export function isValidZip(value: string): boolean {
  return ZIP_RE.test(value);
}

/** A strictly-positive finite number (weight, dimensions, pallets, linear ft). */
export function isPositiveNumber(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

/** A percentage in [0, 100]. No RFQ field uses it today; provided per spec. */
export function isValidPercent(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/**
 * Standard NMFC density-based classification. Density (lb/ft³) maps to exactly
 * the 18 values in FREIGHT_CLASSES. Bands are [low, high): e.g. density in
 * [1, 2) → class 400. Source: NMFTA density guidelines.
 */
const DENSITY_BANDS: ReadonlyArray<readonly [minDensity: number, cls: FreightClass]> = [
  [50, 50],
  [35, 55],
  [30, 60],
  [22.5, 65],
  [15, 70],
  [13.5, 77.5],
  [12, 85],
  [10.5, 92.5],
  [9, 100],
  [8, 110],
  [7, 125],
  [6, 150],
  [5, 175],
  [4, 200],
  [3, 250],
  [2, 300],
  [1, 400],
  [0, 500],
];

/**
 * Cubic feet from length × width × height in INCHES. LTL line items are fixed
 * to inches + lb precisely so this density math is well-defined (see the RFQ
 * form — the cm/kg selector is dropped for LTL units only).
 */
export function cubicFeetFromInches(lengthIn: number, widthIn: number, heightIn: number): number {
  return (lengthIn * widthIn * heightIn) / 1728;
}

/** Density in lb/ft³ from weight (lb) and dimensions (inches). */
export function densityLbPerCubicFoot(
  weightLb: number,
  lengthIn: number,
  widthIn: number,
  heightIn: number,
): number {
  const ft3 = cubicFeetFromInches(lengthIn, widthIn, heightIn);
  return ft3 > 0 ? weightLb / ft3 : 0;
}

/**
 * FR-RFQ-04: auto-calculate NMFC freight class from density. Returns null for
 * non-positive inputs (can't classify) — the caller then requires a manual
 * class. The result is always a member of FREIGHT_CLASSES.
 */
export function freightClassFromDensity(
  weightLb: number,
  lengthIn: number,
  widthIn: number,
  heightIn: number,
): FreightClass | null {
  if (!isPositiveNumber(weightLb) || !isPositiveNumber(lengthIn) || !isPositiveNumber(widthIn) || !isPositiveNumber(heightIn)) {
    return null;
  }
  const density = densityLbPerCubicFoot(weightLb, lengthIn, widthIn, heightIn);
  for (const [minDensity, cls] of DENSITY_BANDS) {
    if (density >= minDensity) return cls;
  }
  return 500;
}

// -----------------------------------------------------------------------------
// FR-RFQ-04: the single validation contract, shared by the RFQ form (client,
// for inline per-field errors) and `createRfq` (server, which never trusts the
// client and re-runs the exact same checks). Inputs arrive as strings (the
// shape a form / FormData yields); each field is validated only when it is
// relevant to the chosen shipment type. `todayIso` is injected ('YYYY-MM-DD')
// rather than read from the clock so the past-date rule is deterministic under
// the offline test runner (which can't mock time).
// -----------------------------------------------------------------------------

export interface HandlingUnitInput {
  lengthIn?: string | number | null;
  widthIn?: string | number | null;
  heightIn?: string | number | null;
  weightLb?: string | number | null;
  unitCount?: string | number | null;
  packagingType?: string | null;
  freightClass?: string | number | null;
  /** True when the user hand-picked the class instead of taking the density calc. */
  freightClassIsOverride?: boolean;
  nmfcCode?: string | null;
  stackable?: boolean;
}

export interface RfqValidationInput {
  shipmentType?: string | null;
  shipFromCity?: string | null;
  shipFromState?: string | null;
  shipFromZip?: string | null;
  shipToCity?: string | null;
  shipToState?: string | null;
  shipToZip?: string | null;
  pickupDate?: string | null;
  pickupWindowStart?: string | null;
  pickupWindowEnd?: string | null;
  deliveryDate?: string | null;
  commodity?: string | null;
  totalWeight?: string | number | null;
  isHazmat?: boolean;
  unNumber?: string | null;
  hazmatClass?: string | null;
  equipmentType?: string | null;
  temperatureF?: string | number | null;
  trailerSize?: string | null;
  palletCount?: string | number | null;
  lengthIn?: string | number | null;
  widthIn?: string | number | null;
  heightIn?: string | number | null;
  linearFeet?: string | number | null;
  freightDescription?: string | null;
  handlingUnits?: HandlingUnitInput[];
}

export interface RfqValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

const dateOnly = (s: string): string => s.slice(0, 10);
const isBlank = (v: unknown): boolean => v == null || String(v).trim() === '';

/**
 * Sum of (weight × unit count) across LTL handling units, in lb. Used to derive
 * the LTL total weight the DB stores — the total is never taken from a separate
 * client field for LTL (it would be free to contradict the items).
 */
export function ltlTotalWeightLb(units: HandlingUnitInput[]): number {
  return units.reduce((sum, u) => {
    const w = Number(u.weightLb);
    const c = Number(u.unitCount);
    if (!Number.isFinite(w) || w <= 0) return sum;
    return sum + w * (Number.isFinite(c) && c > 0 ? c : 1);
  }, 0);
}

export function validateRfqInput(input: RfqValidationInput, todayIso: string): RfqValidationResult {
  const e: Record<string, string> = {};
  const today = dateOnly(todayIso);

  const type = input.shipmentType ?? '';
  if (!isValidShipmentType(type)) {
    e.shipmentType = 'Select a shipment type.';
    return { ok: false, errors: e };
  }

  if (isBlank(input.shipFromCity)) e.shipFromCity = 'Origin city is required.';
  if (isBlank(input.shipFromState)) e.shipFromState = 'Origin state is required.';
  if (isBlank(input.shipFromZip)) e.shipFromZip = 'Origin ZIP is required.';
  else if (!isValidZip(String(input.shipFromZip).trim())) e.shipFromZip = 'Enter a valid ZIP (12345 or 12345-6789).';
  if (isBlank(input.shipToCity)) e.shipToCity = 'Destination city is required.';
  if (isBlank(input.shipToState)) e.shipToState = 'Destination state is required.';
  if (isBlank(input.shipToZip)) e.shipToZip = 'Destination ZIP is required.';
  else if (!isValidZip(String(input.shipToZip).trim())) e.shipToZip = 'Enter a valid ZIP (12345 or 12345-6789).';

  if (isBlank(input.pickupDate)) {
    e.pickupDate = 'Pickup date is required.';
  } else if (dateOnly(String(input.pickupDate)) < today) {
    e.pickupDate = 'Pickup date cannot be in the past.';
  }
  if (!isBlank(input.deliveryDate) && !isBlank(input.pickupDate)) {
    if (dateOnly(String(input.deliveryDate)) < dateOnly(String(input.pickupDate))) {
      e.deliveryDate = 'Delivery date cannot be before the pickup date.';
    }
  }
  if (!isBlank(input.pickupWindowStart) && !isBlank(input.pickupWindowEnd)) {
    if (String(input.pickupWindowEnd) < String(input.pickupWindowStart)) {
      e.pickupWindowEnd = 'Pickup window end cannot be before its start.';
    }
  }

  if (isBlank(input.commodity)) e.commodity = 'Commodity is required.';

  if (input.isHazmat) {
    if (isBlank(input.unNumber)) e.unNumber = 'UN number is required for hazmat.';
    else if (!isValidUnNumber(String(input.unNumber).trim())) e.unNumber = 'UN number must be four digits (e.g. 1203).';
    if (isBlank(input.hazmatClass)) e.hazmatClass = 'Hazard class is required for hazmat.';
    else if (!isValidHazmatClass(String(input.hazmatClass).trim())) e.hazmatClass = 'Select a valid hazard class (1–9).';
  }

  if (type === 'ftl') {
    if (isBlank(input.equipmentType)) e.equipmentType = 'Equipment type is required.';
    else if (!isValidEquipmentType(String(input.equipmentType).trim())) e.equipmentType = 'Select a valid equipment type.';
    if (isBlank(input.trailerSize)) e.trailerSize = 'Trailer size is required.';
    else if (!isValidTrailerSize(String(input.trailerSize).trim())) e.trailerSize = 'Select a valid trailer size.';
    // Temperature is required iff Reefer, and must be empty otherwise.
    if (input.equipmentType === 'reefer') {
      if (isBlank(input.temperatureF)) e.temperatureF = 'Temperature is required for a reefer.';
      else if (!Number.isFinite(Number(input.temperatureF))) e.temperatureF = 'Enter a valid temperature.';
    } else if (!isBlank(input.temperatureF)) {
      e.temperatureF = 'Temperature applies only to refrigerated equipment.';
    }
    if (!isBlank(input.palletCount) && !isPositiveNumber(input.palletCount)) e.palletCount = 'Pallet count must be a positive number.';
    if (isBlank(input.totalWeight)) e.totalWeight = 'Total weight is required.';
    else if (!isPositiveNumber(input.totalWeight)) e.totalWeight = 'Total weight must be a positive number.';
  } else if (type === 'ptl') {
    for (const [k, label] of [
      ['lengthIn', 'Length'],
      ['widthIn', 'Width'],
      ['heightIn', 'Height'],
    ] as const) {
      if (isBlank(input[k])) e[k] = `${label} is required.`;
      else if (!isPositiveNumber(input[k])) e[k] = `${label} must be a positive number.`;
    }
    if (isBlank(input.totalWeight)) e.totalWeight = 'Weight is required.';
    else if (!isPositiveNumber(input.totalWeight)) e.totalWeight = 'Weight must be a positive number.';
    if (isBlank(input.linearFeet)) e.linearFeet = 'Linear feet is required.';
    else if (!isPositiveNumber(input.linearFeet)) e.linearFeet = 'Linear feet must be a positive number.';
    if (!isBlank(input.palletCount) && !isPositiveNumber(input.palletCount)) e.palletCount = 'Pallet count must be a positive number.';
    if (isBlank(input.freightDescription)) e.freightDescription = 'Freight description is required.';
  } else if (type === 'ltl') {
    const units = input.handlingUnits ?? [];
    if (units.length === 0) {
      e.handlingUnits = 'Add at least one handling unit.';
    }
    units.forEach((u, i) => {
      const p = `units[${i}].`;
      for (const [k, label] of [
        ['lengthIn', 'Length'],
        ['widthIn', 'Width'],
        ['heightIn', 'Height'],
        ['weightLb', 'Weight'],
      ] as const) {
        if (isBlank(u[k])) e[p + k] = `${label} is required.`;
        else if (!isPositiveNumber(u[k])) e[p + k] = `${label} must be a positive number.`;
      }
      if (isBlank(u.unitCount)) e[p + 'unitCount'] = 'Unit count is required.';
      else if (!Number.isInteger(Number(u.unitCount)) || Number(u.unitCount) <= 0) e[p + 'unitCount'] = 'Unit count must be a positive whole number.';
      if (isBlank(u.packagingType)) e[p + 'packagingType'] = 'Packaging type is required.';
      else if (!isValidPackagingType(String(u.packagingType).trim())) e[p + 'packagingType'] = 'Select a valid packaging type.';
      if (isBlank(u.freightClass)) e[p + 'freightClass'] = 'Freight class is required.';
      else if (!isValidFreightClass(Number(u.freightClass))) e[p + 'freightClass'] = 'Select a valid freight class.';
      if (!isBlank(u.nmfcCode) && !isValidNmfcCode(String(u.nmfcCode).trim())) e[p + 'nmfcCode'] = 'NMFC code should contain only digits, spaces, or hyphens.';
    });
  }

  return { ok: Object.keys(e).length === 0, errors: e };
}
