/**
 * Carrier compliance gate — release/assignment blocking.
 *
 * Requirement coverage:
 *   FR-CMP-01  Block booking/assignment/release when FMCSA authority is not
 *              active, insurance is expired/missing, required docs are missing,
 *              or manual review is not cleared.
 *   FR-CMP-02  Warn at 60/30/14/7 days before insurance expiry; block at expiry.
 *   FR-CMP-03  New carriers remain CONDITIONAL until manual review is approved.
 *
 * Source: Client Proposal compliance baseline + Operating Workflow exception
 * gates + build spec step 3/4. Live FMCSA lookups arrive via the FMCSA adapter
 * (Milestone 4); this pure evaluator consumes an already-fetched snapshot so it
 * is deterministic and unit-testable.
 */

export type AuthorityStatus = 'active' | 'inactive' | 'not_authorized' | 'unknown';
export type ManualReviewState = 'approved' | 'conditional' | 'rejected' | 'pending';

export interface CarrierComplianceSnapshot {
  authorityStatus: AuthorityStatus;
  outOfService: boolean;
  /** ISO date string for insurance expiry, or null if none on file. */
  insuranceExpiry: string | null;
  autoLiabilityCents: number | null;
  cargoCents: number | null;
  requiredDocsPresent: boolean;
  manualReview: ManualReviewState;
}

export interface ComplianceThresholds {
  minAutoLiabilityCents: number; // e.g. $1,000,000
  minCargoCents: number; // e.g. $100,000
  warnDays: number[]; // e.g. [60,30,14,7]
}

export const DEFAULT_COMPLIANCE_THRESHOLDS: ComplianceThresholds = {
  minAutoLiabilityCents: 1_000_000_00,
  minCargoCents: 100_000_00,
  warnDays: [60, 30, 14, 7],
};

export interface ComplianceResult {
  allowed: boolean;
  blockingReasons: string[];
  warnings: string[];
}

/**
 * FR-CMP-01..03: Evaluate whether a carrier may be assigned/released.
 * `asOf` is injected (not read from a clock) so results are reproducible in
 * tests and seed demonstrations.
 */
export function evaluateCarrierCompliance(
  snap: CarrierComplianceSnapshot,
  asOf: Date,
  thresholds: ComplianceThresholds = DEFAULT_COMPLIANCE_THRESHOLDS,
): ComplianceResult {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  // Authority
  if (snap.authorityStatus !== 'active') {
    blockingReasons.push(`AUTHORITY_NOT_ACTIVE: authority is "${snap.authorityStatus}".`);
  }
  if (snap.outOfService) {
    blockingReasons.push('OUT_OF_SERVICE: carrier has an out-of-service indicator.');
  }

  // Manual review (FR-CMP-03)
  if (snap.manualReview === 'rejected') {
    blockingReasons.push('MANUAL_REVIEW_REJECTED: compliance review rejected this carrier.');
  } else if (snap.manualReview !== 'approved') {
    blockingReasons.push(
      `MANUAL_REVIEW_NOT_CLEARED: carrier is "${snap.manualReview}" (must be approved).`,
    );
  }

  // Documents
  if (!snap.requiredDocsPresent) {
    blockingReasons.push('DOCS_MISSING: required compliance documents are not on file.');
  }

  // Insurance limits
  if (snap.autoLiabilityCents == null || snap.autoLiabilityCents < thresholds.minAutoLiabilityCents) {
    blockingReasons.push('AUTO_LIABILITY_BELOW_MIN: auto liability below required minimum.');
  }
  if (snap.cargoCents == null || snap.cargoCents < thresholds.minCargoCents) {
    blockingReasons.push('CARGO_BELOW_MIN: cargo coverage below required minimum.');
  }

  // Insurance expiry (FR-CMP-02)
  if (!snap.insuranceExpiry) {
    blockingReasons.push('INSURANCE_MISSING: no insurance expiry on file.');
  } else {
    const expiry = new Date(snap.insuranceExpiry + 'T00:00:00Z');
    const days = Math.floor((expiry.getTime() - asOf.getTime()) / 86_400_000);
    if (days < 0) {
      blockingReasons.push(`INSURANCE_EXPIRED: insurance expired ${-days} day(s) ago.`);
    } else {
      const triggered = thresholds.warnDays
        .filter((w) => days <= w)
        .sort((a, b) => a - b)[0];
      if (triggered !== undefined) {
        warnings.push(`INSURANCE_EXPIRING: ${days} day(s) to expiry (<= ${triggered}-day window).`);
      }
    }
  }

  return { allowed: blockingReasons.length === 0, blockingReasons, warnings };
}
