/**
 * FR-RFQ-03: structured freight-detail enums shared by the RFQ create form
 * (client) and `createRfq` (server) — kept free of Next/Supabase imports so
 * it stays offline-testable, same convention as `src/lib/rfqs/lifecycle.ts`.
 */

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
 * continuous "50 to 500" range.
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
