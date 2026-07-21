/**
 * FR-ACC-01/02 — Accessorial charge validation.
 */
import { describe, it, expect } from 'vitest';
import {
  ACCESSORIAL_TYPE,
  BILLABLE_TO,
  isValidAccessorialType,
  isValidBillableTo,
  validateAccessorial,
} from '@/lib/accessorials/calc';

describe('accessorials', () => {
  it('FR-ACC-01: recognizes exactly the four canonical types', () => {
    expect(isValidAccessorialType('detention')).toBe(true);
    expect(isValidAccessorialType('layover')).toBe(true);
    expect(isValidAccessorialType('lumper')).toBe(true);
    expect(isValidAccessorialType('tonu')).toBe(true);
    expect(isValidAccessorialType('fuel_surcharge')).toBe(false);
    expect(isValidAccessorialType('')).toBe(false);
  });

  it('FR-ACC-02: recognizes exactly customer/carrier as billable parties', () => {
    expect(isValidBillableTo('customer')).toBe(true);
    expect(isValidBillableTo('carrier')).toBe(true);
    expect(isValidBillableTo('broker')).toBe(false);
  });

  it('FR-ACC-01/02: accepts a valid accessorial', () => {
    const result = validateAccessorial({
      type: ACCESSORIAL_TYPE.DETENTION,
      amountCents: 15000,
      billableTo: BILLABLE_TO.CUSTOMER,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown type', () => {
    const result = validateAccessorial({
      type: 'fuel_surcharge',
      amountCents: 5000,
      billableTo: BILLABLE_TO.CUSTOMER,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown billable-to party', () => {
    const result = validateAccessorial({
      type: ACCESSORIAL_TYPE.LUMPER,
      amountCents: 5000,
      billableTo: 'broker',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects zero, negative, and non-integer amounts', () => {
    expect(validateAccessorial({ type: ACCESSORIAL_TYPE.TONU, amountCents: 0, billableTo: BILLABLE_TO.CARRIER }).ok).toBe(false);
    expect(validateAccessorial({ type: ACCESSORIAL_TYPE.TONU, amountCents: -100, billableTo: BILLABLE_TO.CARRIER }).ok).toBe(false);
    expect(validateAccessorial({ type: ACCESSORIAL_TYPE.TONU, amountCents: 10.5, billableTo: BILLABLE_TO.CARRIER }).ok).toBe(false);
  });
});
