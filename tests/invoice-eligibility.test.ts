/**
 * FR-BIL-01 / FR-FCT-01 — Invoice eligibility (document match) + settlement packet.
 */
import { describe, it, expect } from 'vitest';
import {
  canCreateShipperInvoice,
  canCreateSettlementPacket,
} from '@/lib/finance/invoice-eligibility';
import { LOAD_STATUS } from '@/lib/loads/lifecycle';

describe('shipper invoice eligibility', () => {
  const ok = {
    status: LOAD_STATUS.DELIVERED,
    hasSignedRateConfirmation: true,
    hasBol: true,
    hasPod: true,
    missingRequiredDocs: [] as string[],
  };

  it('FR-BIL-01: eligible only when delivered with signed RC + BOL + POD', () => {
    expect(canCreateShipperInvoice(ok).eligible).toBe(true);
  });

  it('FR-BIL-01: not eligible before delivery', () => {
    const r = canCreateShipperInvoice({ ...ok, status: LOAD_STATUS.IN_TRANSIT });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('NOT_DELIVERED'))).toBe(true);
  });

  it('FR-BIL-01: not eligible without POD', () => {
    const r = canCreateShipperInvoice({ ...ok, hasPod: false });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('POD_MISSING'))).toBe(true);
  });

  it('FR-BIL-01: not eligible with missing required docs', () => {
    const r = canCreateShipperInvoice({ ...ok, missingRequiredDocs: ['lumper_receipt'] });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('DOCS_MISSING'))).toBe(true);
  });
});

describe('factoring settlement packet', () => {
  it('FR-FCT-01: packet requires signed RC + POD + finance approval', () => {
    expect(
      canCreateSettlementPacket({
        hasSignedRateConfirmation: true,
        hasPod: true,
        financeApproved: true,
      }).eligible,
    ).toBe(true);
  });

  it('FR-FCT-01: blocked without finance approval', () => {
    const r = canCreateSettlementPacket({
      hasSignedRateConfirmation: true,
      hasPod: true,
      financeApproved: false,
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('FINANCE_UNAPPROVED'))).toBe(true);
  });
});
