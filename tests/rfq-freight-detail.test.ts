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
  isValidZip,
  isPositiveNumber,
  isValidPercent,
  isValidShipmentType,
  isValidHazmatClass,
  isValidUnNumber,
  freightClassFromDensity,
  ltlTotalWeightLb,
  validateRfqInput,
  FREIGHT_CLASSES,
  type RfqValidationInput,
} from '@/lib/rfqs/freight-detail';

const TODAY = '2026-07-24';

/** A fully-valid FTL input; individual tests break one field at a time. */
function baseFtl(): RfqValidationInput {
  return {
    shipmentType: 'ftl',
    shipFromCity: 'Dallas',
    shipFromState: 'TX',
    shipFromZip: '75001',
    shipToCity: 'Austin',
    shipToState: 'TX',
    shipToZip: '78701',
    pickupDate: '2026-08-01',
    commodity: 'Canned goods',
    totalWeight: '18000',
    equipmentType: 'dry_van',
    trailerSize: '53',
  };
}

function baseLtl(): RfqValidationInput {
  return {
    shipmentType: 'ltl',
    shipFromCity: 'Dallas',
    shipFromState: 'TX',
    shipFromZip: '75001',
    shipToCity: 'Austin',
    shipToState: 'TX',
    shipToZip: '78701',
    pickupDate: '2026-08-01',
    commodity: 'Boxed parts',
    handlingUnits: [
      {
        lengthIn: '48',
        widthIn: '40',
        heightIn: '48',
        weightLb: '500',
        unitCount: '1',
        packagingType: 'pallet',
        freightClass: '100',
      },
    ],
  };
}

function basePtl(): RfqValidationInput {
  return {
    shipmentType: 'ptl',
    shipFromCity: 'Dallas',
    shipFromState: 'TX',
    shipFromZip: '75001',
    shipToCity: 'Austin',
    shipToState: 'TX',
    shipToZip: '78701',
    pickupDate: '2026-08-01',
    commodity: 'Machinery',
    totalWeight: '9000',
    lengthIn: '96',
    widthIn: '48',
    heightIn: '60',
    linearFeet: '12',
    freightDescription: 'Palletized machine parts',
  };
}

const hasError = (input: RfqValidationInput, field: string): boolean =>
  field in validateRfqInput(input, TODAY).errors;

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

describe('rfq shipment-type enums & primitive validators (FR-RFQ-04)', () => {
  it('validates shipment type + hazmat enums (equipment lives in equipment.ts)', () => {
    expect(isValidShipmentType('ftl')).toBe(true);
    expect(isValidShipmentType('ltl')).toBe(true);
    expect(isValidShipmentType('ptl')).toBe(true);
    expect(isValidShipmentType('parcel')).toBe(false);
    expect(isValidHazmatClass('3')).toBe(true);
    expect(isValidHazmatClass('10')).toBe(false);
    expect(isValidUnNumber('1203')).toBe(true);
    expect(isValidUnNumber('12')).toBe(false);
    expect(isValidUnNumber('ABCD')).toBe(false);
  });

  it('validates US ZIP (5-digit and ZIP+4)', () => {
    expect(isValidZip('75001')).toBe(true);
    expect(isValidZip('75001-1234')).toBe(true);
    expect(isValidZip('7500')).toBe(false);
    expect(isValidZip('ABCDE')).toBe(false);
    expect(isValidZip('75001-12')).toBe(false);
  });

  it('positive-number and percent validators', () => {
    expect(isPositiveNumber('5')).toBe(true);
    expect(isPositiveNumber(0)).toBe(false);
    expect(isPositiveNumber('-1')).toBe(false);
    expect(isPositiveNumber('')).toBe(false);
    expect(isPositiveNumber('abc')).toBe(false);
    expect(isValidPercent('0')).toBe(true);
    expect(isValidPercent('100')).toBe(true);
    expect(isValidPercent('101')).toBe(false);
    expect(isValidPercent('-1')).toBe(false);
  });
});

describe('freight class from density (FR-RFQ-04)', () => {
  it('maps density through the standard NMFC bands to a valid class', () => {
    // 48×40×48 in = 53.33 ft³. 500 lb -> 9.375 pcf -> class 100.
    expect(freightClassFromDensity(500, 48, 40, 48)).toBe(100);
    // Very light -> < 1 pcf -> class 500.
    expect(freightClassFromDensity(10, 48, 40, 48)).toBe(500);
    // Very dense -> ≥ 50 pcf -> class 50.
    expect(freightClassFromDensity(5000, 48, 40, 48)).toBe(50);
    // Every result is a real NMFC class.
    expect((FREIGHT_CLASSES as readonly number[]).includes(freightClassFromDensity(500, 48, 40, 48) as number)).toBe(true);
  });

  it('returns null when inputs are non-positive (cannot classify)', () => {
    expect(freightClassFromDensity(0, 48, 40, 48)).toBe(null);
    expect(freightClassFromDensity(500, 0, 40, 48)).toBe(null);
  });

  it('sums LTL total weight as weight × count across units', () => {
    expect(
      ltlTotalWeightLb([
        { weightLb: '100', unitCount: '2' },
        { weightLb: '50', unitCount: '1' },
      ]),
    ).toBe(250);
  });
});

describe('validateRfqInput contract (FR-RFQ-04)', () => {
  it('requires a shipment type before anything else', () => {
    const r = validateRfqInput({ shipmentType: '' }, TODAY);
    expect(r.ok).toBe(false);
    expect('shipmentType' in r.errors).toBe(true);
  });

  it('accepts a fully-valid FTL / LTL / PTL input', () => {
    expect(validateRfqInput(baseFtl(), TODAY).ok).toBe(true);
    expect(validateRfqInput(baseLtl(), TODAY).ok).toBe(true);
    expect(validateRfqInput(basePtl(), TODAY).ok).toBe(true);
  });

  it('requires origin/destination city, state and a valid ZIP', () => {
    expect(hasError({ ...baseFtl(), shipFromCity: '' }, 'shipFromCity')).toBe(true);
    expect(hasError({ ...baseFtl(), shipToState: '' }, 'shipToState')).toBe(true);
    expect(hasError({ ...baseFtl(), shipFromZip: 'ABC' }, 'shipFromZip')).toBe(true);
  });

  it('rejects a pickup in the past and a delivery before pickup', () => {
    expect(hasError({ ...baseFtl(), pickupDate: '2026-07-01' }, 'pickupDate')).toBe(true);
    expect(hasError({ ...baseFtl(), deliveryDate: '2026-07-31' }, 'deliveryDate')).toBe(true);
    // Same-day delivery is allowed.
    expect(hasError({ ...baseFtl(), deliveryDate: '2026-08-01' }, 'deliveryDate')).toBe(false);
  });

  it('requires commodity for every type', () => {
    expect(hasError({ ...baseFtl(), commodity: '' }, 'commodity')).toBe(true);
  });

  it('requires UN number + hazard class only when hazmat is flagged', () => {
    expect(hasError({ ...baseFtl(), isHazmat: true }, 'unNumber')).toBe(true);
    expect(hasError({ ...baseFtl(), isHazmat: true }, 'hazmatClass')).toBe(true);
    expect(validateRfqInput({ ...baseFtl(), isHazmat: true, unNumber: '1203', hazmatClass: '3' }, TODAY).ok).toBe(true);
  });

  it('FTL: requires equipment + trailer, and temperature iff reefer', () => {
    expect(hasError({ ...baseFtl(), equipmentType: '' }, 'equipmentType')).toBe(true);
    expect(hasError({ ...baseFtl(), trailerSize: '' }, 'trailerSize')).toBe(true);
    // Reefer with no temperature -> error.
    expect(hasError({ ...baseFtl(), equipmentType: 'reefer' }, 'temperatureF')).toBe(true);
    // Non-reefer with a temperature -> error (temperature doesn't apply).
    expect(hasError({ ...baseFtl(), temperatureF: '34' }, 'temperatureF')).toBe(true);
    expect(validateRfqInput({ ...baseFtl(), equipmentType: 'reefer', temperatureF: '34' }, TODAY).ok).toBe(true);
  });

  it('PTL: requires dimensions, weight, linear feet and description', () => {
    expect(hasError({ ...basePtl(), linearFeet: '' }, 'linearFeet')).toBe(true);
    expect(hasError({ ...basePtl(), linearFeet: '-3' }, 'linearFeet')).toBe(true);
    expect(hasError({ ...basePtl(), lengthIn: '' }, 'lengthIn')).toBe(true);
    expect(hasError({ ...basePtl(), freightDescription: '' }, 'freightDescription')).toBe(true);
  });

  it('LTL: requires at least one unit and validates each unit', () => {
    expect(hasError({ ...baseLtl(), handlingUnits: [] }, 'handlingUnits')).toBe(true);
    const badUnit = { ...baseLtl(), handlingUnits: [{ ...baseLtl().handlingUnits![0], weightLb: '' }] };
    expect(hasError(badUnit, 'units[0].weightLb')).toBe(true);
    const badClass = { ...baseLtl(), handlingUnits: [{ ...baseLtl().handlingUnits![0], freightClass: '51' }] };
    expect(hasError(badClass, 'units[0].freightClass')).toBe(true);
  });
});
