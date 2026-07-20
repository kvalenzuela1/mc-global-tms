/**
 * FR-CMP-01/02/03 — Carrier compliance blocking.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateCarrierCompliance,
  type CarrierComplianceSnapshot,
} from '@/lib/compliance/gate';

const ASOF = new Date('2026-07-20T00:00:00Z');

const compliant: CarrierComplianceSnapshot = {
  authorityStatus: 'active',
  outOfService: false,
  insuranceExpiry: '2026-12-31',
  autoLiabilityCents: 1_000_000_00,
  cargoCents: 100_000_00,
  requiredDocsPresent: true,
  manualReview: 'approved',
};

describe('carrier compliance gate', () => {
  it('FR-CMP-01: a fully compliant carrier is allowed', () => {
    const r = evaluateCarrierCompliance(compliant, ASOF);
    expect(r.allowed).toBe(true);
    expect(r.blockingReasons).toHaveLength(0);
  });

  it('FR-CMP-01: expired insurance blocks assignment/release', () => {
    const r = evaluateCarrierCompliance(
      { ...compliant, insuranceExpiry: '2026-06-01' },
      ASOF,
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons.some((x) => x.startsWith('INSURANCE_EXPIRED'))).toBe(true);
  });

  it('FR-CMP-01: inactive/not-authorized authority blocks', () => {
    const r = evaluateCarrierCompliance({ ...compliant, authorityStatus: 'not_authorized' }, ASOF);
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons.some((x) => x.startsWith('AUTHORITY_NOT_ACTIVE'))).toBe(true);
  });

  it('FR-CMP-01: out-of-service indicator blocks', () => {
    const r = evaluateCarrierCompliance({ ...compliant, outOfService: true }, ASOF);
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons.some((x) => x.startsWith('OUT_OF_SERVICE'))).toBe(true);
  });

  it('FR-CMP-03: a carrier not cleared by manual review is blocked (conditional)', () => {
    const r = evaluateCarrierCompliance({ ...compliant, manualReview: 'conditional' }, ASOF);
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons.some((x) => x.startsWith('MANUAL_REVIEW_NOT_CLEARED'))).toBe(true);
  });

  it('FR-CMP-01: below-minimum coverage blocks', () => {
    const r = evaluateCarrierCompliance({ ...compliant, cargoCents: 50_00 }, ASOF);
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons.some((x) => x.startsWith('CARGO_BELOW_MIN'))).toBe(true);
  });

  it('FR-CMP-02: warns (does not block) inside the 30-day window', () => {
    const r = evaluateCarrierCompliance({ ...compliant, insuranceExpiry: '2026-08-10' }, ASOF);
    expect(r.allowed).toBe(true);
    expect(r.warnings.some((x) => x.startsWith('INSURANCE_EXPIRING'))).toBe(true);
  });

  it('FR-CMP-01: seeded Redline profile (expired + not authorized + docs missing) is blocked', () => {
    const redline: CarrierComplianceSnapshot = {
      authorityStatus: 'not_authorized',
      outOfService: false,
      insuranceExpiry: '2026-06-01',
      autoLiabilityCents: 1_000_000_00,
      cargoCents: 100_000_00,
      requiredDocsPresent: false,
      manualReview: 'conditional',
    };
    const r = evaluateCarrierCompliance(redline, ASOF);
    expect(r.allowed).toBe(false);
    expect(r.blockingReasons.length).toBeGreaterThanOrEqual(3);
  });
});
