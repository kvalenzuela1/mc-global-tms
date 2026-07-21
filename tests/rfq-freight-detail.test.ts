/**
 * FR-RFQ-03 — structured RFQ freight-detail enums.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidFreightClass,
  isValidPackagingType,
  isValidWeightUnit,
  isValidDimensionUnit,
  isValidNmfcCode,
  FREIGHT_CLASSES,
} from '@/lib/rfqs/freight-detail';

describe('rfq freight detail', () => {
  it('FR-RFQ-03: freight class is a fixed 18-value NMFC scale, not a continuous range', () => {
    expect(FREIGHT_CLASSES).toHaveLength(18);
    expect(isValidFreightClass(50)).toBe(true);
    expect(isValidFreightClass(77.5)).toBe(true);
    expect(isValidFreightClass(500)).toBe(true);
  });

  it('FR-RFQ-03: rejects freight classes outside the fixed scale', () => {
    expect(isValidFreightClass(51)).toBe(false);
    expect(isValidFreightClass(0)).toBe(false);
    expect(isValidFreightClass(600)).toBe(false);
  });

  it('FR-RFQ-03: validates packaging type against the fixed enum', () => {
    expect(isValidPackagingType('pallet')).toBe(true);
    expect(isValidPackagingType('crate')).toBe(true);
    expect(isValidPackagingType('shrink-wrap')).toBe(false);
  });

  it('FR-RFQ-03: validates weight and dimension units', () => {
    expect(isValidWeightUnit('lb')).toBe(true);
    expect(isValidWeightUnit('kg')).toBe(true);
    expect(isValidWeightUnit('oz')).toBe(false);
    expect(isValidDimensionUnit('in')).toBe(true);
    expect(isValidDimensionUnit('cm')).toBe(true);
    expect(isValidDimensionUnit('mm')).toBe(false);
  });

  it('FR-RFQ-03: NMFC code accepts digits/spaces/hyphens, including sub-codes, without pinning a digit count', () => {
    expect(isValidNmfcCode('156600')).toBe(true);
    expect(isValidNmfcCode('16030-1')).toBe(true);
    expect(isValidNmfcCode('1234')).toBe(true);
    expect(isValidNmfcCode('156600 01')).toBe(true);
  });

  it('FR-RFQ-03: NMFC code rejects obvious garbage', () => {
    expect(isValidNmfcCode('abc')).toBe(false);
    expect(isValidNmfcCode('156600!!!')).toBe(false);
    expect(isValidNmfcCode('')).toBe(false);
  });
});
