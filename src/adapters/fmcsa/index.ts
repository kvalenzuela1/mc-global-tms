/**
 * FMCSA provider adapter.
 *
 * Requirement coverage:
 *   FR-ADP-FMCSA-01  Provider-agnostic interface for carrier authority/insurance
 *                    lookups. Phase 1 ships a DETERMINISTIC local mock.
 *   FR-ADP-FMCSA-02  Future QCMobile provider is a drop-in (same interface).
 *
 * The compliance gate (src/lib/compliance/gate.ts) consumes the snapshot this
 * adapter returns; it never calls FMCSA directly.
 */

import type { AuthorityStatus } from '@/lib/compliance/gate';

export interface FmcsaAuthorityResult {
  dotNumber: string;
  legalName: string;
  authorityStatus: AuthorityStatus;
  outOfService: boolean;
  /** ISO date string. */
  fetchedAt: string;
  source: 'mock' | 'qcmobile';
}

export interface FmcsaAdapter {
  readonly name: string;
  lookupAuthority(dotNumber: string): Promise<FmcsaAuthorityResult>;
}

/**
 * Deterministic mock: same DOT number always yields the same result, derived
 * from the number itself so seed data + tests are reproducible with no network.
 */
export class MockFmcsaAdapter implements FmcsaAdapter {
  readonly name = 'mock';

  async lookupAuthority(dotNumber: string): Promise<FmcsaAuthorityResult> {
    const digits = dotNumber.replace(/\D/g, '');
    const n = Number(digits.slice(-2) || '0');
    // Deterministic buckets:
    //   ends 00-79 -> active/in-service
    //   ends 80-89 -> active but out-of-service (blocked)
    //   ends 90-99 -> not authorized (blocked)
    let authorityStatus: AuthorityStatus = 'active';
    let outOfService = false;
    if (n >= 90) authorityStatus = 'not_authorized';
    else if (n >= 80) outOfService = true;

    return {
      dotNumber,
      legalName: `Carrier DOT ${dotNumber}`,
      authorityStatus,
      outOfService,
      fetchedAt: new Date().toISOString(),
      source: 'mock',
    };
  }
}

export function getFmcsaAdapter(): FmcsaAdapter {
  const provider = process.env.FMCSA_PROVIDER ?? 'mock';
  switch (provider) {
    case 'mock':
      return new MockFmcsaAdapter();
    // case 'qcmobile': return new QcMobileFmcsaAdapter(process.env.FMCSA_WEBKEY!);
    default:
      return new MockFmcsaAdapter();
  }
}
