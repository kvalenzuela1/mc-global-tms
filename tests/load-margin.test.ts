/**
 * FR-MGN-01..04 — Load financial model (Shipper Cost → Broker → Dispatch →
 * Carrier Pay), the single shared formula + its fallback resolution.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLoadFinancials,
  validateMarginInputs,
  validateMarginPercents,
  validateShipperCostCents,
  resolveMarginPercents,
  DEFAULT_LOAD_MARGIN_CONFIG,
} from '@/lib/pricing/margin';

describe('FR-MGN-01/02: computeLoadFinancials matches the reference model', () => {
  it('reproduces the client sample exactly ($2,000 / 18% / 5% / $1,540)', () => {
    const f = computeLoadFinancials({
      shipperCostCents: 200_000,
      brokerPercent: 0.18,
      dispatchPercent: 0.05,
    });
    expect(f.shipperCostCents).toBe(200_000);
    expect(f.brokerMarginCents).toBe(36_000); // -$360.00
    expect(f.dispatchMarginCents).toBe(10_000); // -$100.00
    expect(f.carrierPayCents).toBe(154_000); // $1,540.00
  });

  it('Carrier Pay always reconciles: cost - broker - dispatch', () => {
    for (const cost of [200_000, 100_033, 1, 999_999, 50_000]) {
      const f = computeLoadFinancials({
        shipperCostCents: cost,
        brokerPercent: 0.18,
        dispatchPercent: 0.05,
      });
      expect(f.brokerMarginCents + f.dispatchMarginCents + f.carrierPayCents).toBe(cost);
      // every stored figure is a whole number of cents
      expect(Number.isInteger(f.brokerMarginCents)).toBe(true);
      expect(Number.isInteger(f.dispatchMarginCents)).toBe(true);
      expect(Number.isInteger(f.carrierPayCents)).toBe(true);
    }
  });

  it('rounds each margin to the nearest cent independently', () => {
    // 1000.33 * 18% = 180.0594 -> $180.06 ; * 5% = 50.0165 -> $50.02
    const f = computeLoadFinancials({
      shipperCostCents: 100_033,
      brokerPercent: 0.18,
      dispatchPercent: 0.05,
    });
    expect(f.brokerMarginCents).toBe(18_006);
    expect(f.dispatchMarginCents).toBe(5_002);
    expect(f.carrierPayCents).toBe(100_033 - 18_006 - 5_002);
  });

  it('allows the boundary where broker + dispatch = 100% (Carrier Pay 0)', () => {
    const f = computeLoadFinancials({
      shipperCostCents: 200_000,
      brokerPercent: 0.6,
      dispatchPercent: 0.4,
    });
    expect(f.carrierPayCents).toBe(0);
  });
});

describe('FR-MGN-03: validation', () => {
  it('rejects a non-positive or non-integer shipper cost', () => {
    expect(validateShipperCostCents(0).ok).toBe(false);
    expect(validateShipperCostCents(-100).ok).toBe(false);
    expect(validateShipperCostCents(100.5).ok).toBe(false);
    expect(validateShipperCostCents(200_000).ok).toBe(true);
  });

  it('rejects percentages outside 0-100%', () => {
    expect(validateMarginPercents(-0.01, 0.05).ok).toBe(false);
    expect(validateMarginPercents(1.01, 0).ok).toBe(false);
    expect(validateMarginPercents(0.18, 0.05).ok).toBe(true);
  });

  it('rejects broker % + dispatch % exceeding 100%', () => {
    const r = validateMarginPercents(0.7, 0.4);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('exceed 100%');
  });

  it('computeLoadFinancials throws on invalid input', () => {
    expect(() =>
      computeLoadFinancials({ shipperCostCents: 0, brokerPercent: 0.18, dispatchPercent: 0.05 }),
    ).toThrow();
    expect(() =>
      computeLoadFinancials({ shipperCostCents: 200_000, brokerPercent: 0.8, dispatchPercent: 0.3 }),
    ).toThrow();
  });

  it('validateMarginInputs gates cost before percents', () => {
    expect(validateMarginInputs({ shipperCostCents: 0, brokerPercent: 0.18, dispatchPercent: 0.05 }).ok).toBe(false);
    expect(validateMarginInputs({ shipperCostCents: 200_000, brokerPercent: 0.18, dispatchPercent: 0.05 }).ok).toBe(true);
  });
});

describe('FR-MGN-04: resolveMarginPercents fallback chain', () => {
  const system = DEFAULT_LOAD_MARGIN_CONFIG; // { 0.18, 0.05 }

  it('falls back to the system default when nothing else is set', () => {
    expect(resolveMarginPercents({ systemDefault: system })).toEqual({
      brokerPercent: 0.18,
      dispatchPercent: 0.05,
    });
  });

  it('org house default beats the system default', () => {
    const r = resolveMarginPercents({
      orgDefault: { brokerPercent: 0.2, dispatchPercent: 0.06 },
      systemDefault: system,
    });
    expect(r).toEqual({ brokerPercent: 0.2, dispatchPercent: 0.06 });
  });

  it('customer default beats org, load override beats customer', () => {
    const r = resolveMarginPercents({
      load: { brokerPercent: 0.25, dispatchPercent: null },
      customer: { brokerPercent: 0.22, dispatchPercent: 0.07 },
      orgDefault: { brokerPercent: 0.2, dispatchPercent: 0.06 },
      systemDefault: system,
    });
    // broker: load override wins; dispatch: load is null -> customer wins
    expect(r).toEqual({ brokerPercent: 0.25, dispatchPercent: 0.07 });
  });

  it('resolves each field independently (partial customer override)', () => {
    const r = resolveMarginPercents({
      customer: { brokerPercent: 0.3, dispatchPercent: null },
      orgDefault: { brokerPercent: 0.2, dispatchPercent: 0.09 },
      systemDefault: system,
    });
    expect(r).toEqual({ brokerPercent: 0.3, dispatchPercent: 0.09 });
  });
});
