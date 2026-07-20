/**
 * FR-PR-01..06 — Configurable pricing + Quick Pay / factoring calculator.
 * Reference figures from the Client Proposal (Table 8) and Delivery Plan §3.
 */
import { describe, it, expect } from 'vitest';
import { computePricing, DEFAULT_PRICING_CONFIG } from '@/lib/pricing/calc';

describe('pricing calculator', () => {
  it('FR-PR-01: $2,000 linehaul at 18% margin => $2,439.02 shipper price', () => {
    const r = computePricing({
      carrierLinehaulCents: 200000,
      config: { targetMarginPercent: 0.18, quickPayFeePercent: 0.05, factoringCostPercent: 0.03 },
    });
    expect(r.shipperPriceCents).toBe(243902); // 2000 / 0.82
    expect(r.marginAmountCents).toBe(43902); // FR-PR-02 dollars
    expect(Math.round(r.marginPercent * 10000) / 10000).toBe(0.18); // realized ~18%
  });

  it('FR-PR-01: 12% margin => $2,272.73', () => {
    const r = computePricing({
      carrierLinehaulCents: 200000,
      config: { targetMarginPercent: 0.12, quickPayFeePercent: 0.05, factoringCostPercent: 0.03 },
    });
    expect(r.shipperPriceCents).toBe(227273);
  });

  it('FR-PR-03: Quick Pay defaults to 5% => carrier nets $1,900', () => {
    const r = computePricing({ carrierLinehaulCents: 200000, config: DEFAULT_PRICING_CONFIG });
    expect(r.quickPayFeeCents).toBe(10000);
    expect(r.quickPayNetCents).toBe(190000);
  });

  it('FR-PR-04: factoring advance uses factoring cost (3%) => $1,940', () => {
    const r = computePricing({ carrierLinehaulCents: 200000, config: DEFAULT_PRICING_CONFIG });
    expect(r.factoringAdvanceCents).toBe(194000);
    expect(r.quickPaySpreadCents).toBe(4000); // 5% - 3% of 2000
  });

  it('FR-PR-05: values are configurable, not hardcoded', () => {
    const r = computePricing({
      carrierLinehaulCents: 500000,
      config: { targetMarginPercent: 0.2, quickPayFeePercent: 0.04, factoringCostPercent: 0.025 },
    });
    expect(r.shipperPriceCents).toBe(625000); // 5000 / 0.8
    expect(r.quickPayFeeCents).toBe(20000); // 4% of 5000
  });

  it('FR-PR-06: warns when Quick Pay fee is below factoring cost', () => {
    const r = computePricing({
      carrierLinehaulCents: 200000,
      config: { targetMarginPercent: 0.18, quickPayFeePercent: 0.02, factoringCostPercent: 0.03 },
    });
    expect(r.quickPaySpreadCents).toBeLessThan(0);
    expect(r.warnings.some((w) => w.includes('QUICK_PAY_BELOW_FACTORING'))).toBe(true);
  });

  it('rejects out-of-range percentages', () => {
    expect(() =>
      computePricing({
        carrierLinehaulCents: 200000,
        config: { targetMarginPercent: 1.2, quickPayFeePercent: 0.05, factoringCostPercent: 0.03 },
      }),
    ).toThrow(RangeError);
  });
});
