/**
 * Equipment / trailer type vocabulary — the kind of trailer a load needs.
 * A new dimension alongside `service_type` and the freight-detail enums; kept
 * free of Next/Supabase imports so it stays offline-testable, same convention
 * as `freight-detail.ts`.
 *
 * The DB CHECK constraint (whichever migration adds an `equipment_type` column)
 * is the storage source of truth; this module single-sources the TS side and
 * carries the human labels + descriptions the UI shows.
 */

export const EQUIPMENT_CATEGORIES = ['enclosed', 'open_deck', 'specialized'] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  enclosed: 'Standard Enclosed Trailers',
  open_deck: 'Open-Deck Trailers',
  specialized: 'Specialized Commercial Trailers',
};

export const EQUIPMENT_TYPES = [
  'dry_van',
  'reefer',
  'flatbed',
  'step_deck',
  'double_drop',
  'conestoga',
  'rgn',
  'dry_bulk_tanker',
  'liquid_tanker',
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export interface EquipmentTypeDef {
  label: string;
  category: EquipmentCategory;
  description: string;
}

export const EQUIPMENT_TYPE_DETAILS: Record<EquipmentType, EquipmentTypeDef> = {
  dry_van: {
    label: 'Dry Van',
    category: 'enclosed',
    description:
      'The most common 53-ft enclosed trailer, for non-perishable boxed goods, electronics, clothing, and palletized freight.',
  },
  reefer: {
    label: 'Refrigerated (Reefer)',
    category: 'enclosed',
    description:
      'A temperature-controlled insulated trailer with a cooling system, for perishable food, beverages, medical supplies, and pharmaceuticals.',
  },
  flatbed: {
    label: 'Standard Flatbed',
    category: 'open_deck',
    description:
      'An open 48- or 53-ft platform with no sides or roof, for steel, lumber, construction materials, and large machinery.',
  },
  step_deck: {
    label: 'Step Deck (Drop Deck)',
    category: 'open_deck',
    description:
      'A flatbed with a lowered deck profile, to haul taller loads that exceed standard height limits without permits.',
  },
  double_drop: {
    label: 'Double Drop / Lowboy',
    category: 'open_deck',
    description:
      'A deck that sits very low to the ground, for oversized industrial machinery and heavy construction equipment.',
  },
  conestoga: {
    label: 'Conestoga',
    category: 'specialized',
    description:
      'A flatbed with a rolling tarp system that slides open and closed — weather protection without manual tarping.',
  },
  rgn: {
    label: 'Removable Gooseneck (RGN)',
    category: 'specialized',
    description:
      'A heavy-duty open trailer whose front detaches, so large wheeled or tracked vehicles can drive directly onto the deck.',
  },
  dry_bulk_tanker: {
    label: 'Dry Bulk Tanker',
    category: 'specialized',
    description:
      'A tank trailer for loose dry materials like cement, flour, sugar, and plastic pellets, moved by pneumatic pressure.',
  },
  liquid_tanker: {
    label: 'Liquid Tanker',
    category: 'specialized',
    description:
      'A cylindrical trailer for bulk liquids — chemicals, petroleum products, or food-grade liquids like milk.',
  },
};

export function isValidEquipmentType(value: string): value is EquipmentType {
  return (EQUIPMENT_TYPES as readonly string[]).includes(value);
}

export function equipmentLabel(value: string): string {
  return isValidEquipmentType(value) ? EQUIPMENT_TYPE_DETAILS[value].label : value;
}

/** Equipment types grouped by category, preserving category + type order. */
export function equipmentTypesByCategory(): {
  category: EquipmentCategory;
  label: string;
  types: { value: EquipmentType; def: EquipmentTypeDef }[];
}[] {
  return EQUIPMENT_CATEGORIES.map((category) => ({
    category,
    label: EQUIPMENT_CATEGORY_LABELS[category],
    types: EQUIPMENT_TYPES.filter((t) => EQUIPMENT_TYPE_DETAILS[t].category === category).map(
      (value) => ({ value, def: EQUIPMENT_TYPE_DETAILS[value] }),
    ),
  }));
}
