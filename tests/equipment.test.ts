/**
 * FR-RFQ-03 (equipment): the trailer/equipment vocabulary is internally
 * consistent — every type has details, a known category, a non-empty
 * description — and the validator/grouping behave.
 */
import { describe, it, expect } from 'vitest';
import {
  EQUIPMENT_TYPES,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_TYPE_DETAILS,
  isValidEquipmentType,
  equipmentLabel,
  equipmentTypesByCategory,
} from '@/lib/rfqs/equipment';

describe('equipment types', () => {
  it('every equipment type has details with a known category and a description', () => {
    for (const t of EQUIPMENT_TYPES) {
      const def = EQUIPMENT_TYPE_DETAILS[t];
      expect(def.label.length > 0).toBe(true);
      expect(def.description.length > 0).toBe(true);
      expect((EQUIPMENT_CATEGORIES as readonly string[]).includes(def.category)).toBe(true);
    }
  });

  it('the nine expected trailer types are present', () => {
    expect(EQUIPMENT_TYPES).toHaveLength(9);
    expect(EQUIPMENT_TYPES).toContain('dry_van');
    expect(EQUIPMENT_TYPES).toContain('reefer');
    expect(EQUIPMENT_TYPES).toContain('rgn');
    expect(EQUIPMENT_TYPES).toContain('liquid_tanker');
  });

  it('isValidEquipmentType accepts known values and rejects others', () => {
    expect(isValidEquipmentType('dry_van')).toBe(true);
    expect(isValidEquipmentType('step_deck')).toBe(true);
    expect(isValidEquipmentType('hovercraft')).toBe(false);
    expect(isValidEquipmentType('')).toBe(false);
  });

  it('equipmentLabel humanises a known value and passes an unknown through', () => {
    expect(equipmentLabel('reefer')).toBe('Refrigerated (Reefer)');
    expect(equipmentLabel('made_up')).toBe('made_up');
  });

  it('grouping covers every type exactly once, across the three categories', () => {
    const groups = equipmentTypesByCategory();
    expect(groups).toHaveLength(3);
    const flattened = groups.flatMap((g) => g.types.map((t) => t.value));
    expect(flattened).toHaveLength(EQUIPMENT_TYPES.length);
    // enclosed holds exactly dry_van + reefer
    const enclosed = groups.find((g) => g.category === 'enclosed');
    expect(enclosed?.types.map((t) => t.value)).toEqual(['dry_van', 'reefer']);
  });
});
