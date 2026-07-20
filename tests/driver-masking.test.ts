/**
 * FR-MASK-01/02 — Commercial field masking for non-commercial roles.
 */
import { describe, it, expect } from 'vitest';
import { ROLES } from '@/lib/rbac/roles';
import { maskCommercials, maskCommercialsList } from '@/lib/masking/driver';

const loadRow = {
  id: 'LD-1045',
  origin: 'Newark, NJ',
  destination: 'Atlanta, GA',
  pickup_at: '2026-07-22T14:00:00Z',
  status: 'released_to_driver',
  shipper_price_cents: 243902,
  carrier_linehaul_cents: 200000,
  margin_amount_cents: 43902,
  quick_pay_fee_cents: 10000,
  invoice_amount_cents: 243902,
};

describe('driver / commercial masking', () => {
  it('FR-MASK-01: a driver receives operational fields only', () => {
    const masked = maskCommercials(loadRow, ROLES.DRIVER);
    expect(masked.origin).toBe('Newark, NJ');
    expect(masked.status).toBe('released_to_driver');
    expect('shipper_price_cents' in masked).toBe(false);
    expect('carrier_linehaul_cents' in masked).toBe(false);
    expect('margin_amount_cents' in masked).toBe(false);
    expect('quick_pay_fee_cents' in masked).toBe(false);
    expect('invoice_amount_cents' in masked).toBe(false);
  });

  it('FR-MASK-01: a broker manager keeps commercial fields', () => {
    const masked = maskCommercials(loadRow, ROLES.BROKER_MANAGER);
    expect(masked.margin_amount_cents).toBe(43902);
    expect(masked.shipper_price_cents).toBe(243902);
  });

  it('FR-MASK-02: masking never mutates the source record', () => {
    const clone = { ...loadRow };
    maskCommercials(loadRow, ROLES.DRIVER);
    expect(loadRow).toEqual(clone);
  });

  it('FR-MASK-01: shipper is also masked from carrier/broker margins', () => {
    const masked = maskCommercials(loadRow, ROLES.SHIPPER);
    expect('margin_amount_cents' in masked).toBe(false);
  });

  it('FR-MASK-01: list helper masks every row for a driver', () => {
    const masked = maskCommercialsList([loadRow, loadRow], ROLES.DRIVER);
    expect(masked).toHaveLength(2);
    expect(masked.every((m) => !('margin_amount_cents' in m))).toBe(true);
  });
});
