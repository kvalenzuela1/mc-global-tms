/**
 * FR-PR-05/06 — Pricing override policy: when an override is required, who may
 * request it, and separation of duties on approval.
 */
import { describe, it, expect } from 'vitest';
import { ROLES } from '@/lib/rbac/roles';
import { computePricing, DEFAULT_PRICING_CONFIG } from '@/lib/pricing/calc';
import {
  assessOverride,
  evaluateRequest,
  evaluateApproval,
  isQuoteReleasable,
  OVERRIDE_REASONS,
  DEFAULT_OVERRIDE_POLICY,
} from '@/lib/pricing/override';

const MANAGER = 'user-manager-0001';
const ADMIN = 'user-admin-0001';

/** A healthy quote: 18% target margin, Quick Pay above factoring cost. */
const healthy = computePricing({
  carrierLinehaulCents: 200000,
  config: DEFAULT_PRICING_CONFIG,
});

/** Below the 12% floor. */
const thin = computePricing({
  carrierLinehaulCents: 200000,
  config: { targetMarginPercent: 0.05, quickPayFeePercent: 0.05, factoringCostPercent: 0.03 },
});

/** Zero margin — shipper price equals carrier cost. */
const zeroMargin = computePricing({
  carrierLinehaulCents: 200000,
  config: { targetMarginPercent: 0, quickPayFeePercent: 0.05, factoringCostPercent: 0.03 },
});

/** Healthy margin, but Quick Pay fee sits below factoring cost. */
const negativeSpread = computePricing({
  carrierLinehaulCents: 200000,
  config: { targetMarginPercent: 0.18, quickPayFeePercent: 0.02, factoringCostPercent: 0.05 },
});

describe('pricing override policy', () => {
  /* ---------------------------------------------------------- assessment --- */

  it('FR-PR-05: a quote within policy does not require an override', () => {
    const assessment = assessOverride(healthy);
    expect(assessment.required).toBe(false);
    expect(assessment.reasons).toHaveLength(0);
  });

  it('FR-PR-05: margin below the floor requires an override', () => {
    const assessment = assessOverride(thin);
    expect(assessment.required).toBe(true);
    expect(assessment.reasons).toContain(OVERRIDE_REASONS.MARGIN_BELOW_FLOOR);
  });

  it('FR-PR-05: zero margin reports NEGATIVE_MARGIN, not the floor breach', () => {
    const assessment = assessOverride(zeroMargin);
    expect(assessment.reasons).toContain(OVERRIDE_REASONS.NEGATIVE_MARGIN);
    expect(assessment.reasons).not.toContain(OVERRIDE_REASONS.MARGIN_BELOW_FLOOR);
  });

  it('FR-PR-06: a negative Quick Pay spread requires an override even at target margin', () => {
    const assessment = assessOverride(negativeSpread);
    expect(negativeSpread.quickPaySpreadCents).toBeLessThan(0);
    expect(assessment.required).toBe(true);
    expect(assessment.reasons).toContain(OVERRIDE_REASONS.QUICK_PAY_BELOW_FACTORING);
  });

  it('honours a custom floor', () => {
    const strict = { ...DEFAULT_OVERRIDE_POLICY, minMarginPercent: 0.25 };
    expect(assessOverride(healthy, strict).required).toBe(true);
    expect(assessOverride(healthy).required).toBe(false);
  });

  /* ------------------------------------------------------------- request --- */

  it('FR-PR-05: a broker dispatcher may not request an override', () => {
    const decision = evaluateRequest({
      requestedByUserId: 'user-dispatcher-0001',
      requesterRoles: ROLES.BROKER_DISPATCHER,
      reason: 'Backhaul lane, accepting thin margin to retain the customer.',
      assessment: assessOverride(thin),
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('FORBIDDEN');
  });

  it('FR-PR-05: a broker manager may request an override with justification', () => {
    const decision = evaluateRequest({
      requestedByUserId: MANAGER,
      requesterRoles: ROLES.BROKER_MANAGER,
      reason: 'Backhaul lane, accepting thin margin to retain the customer.',
      assessment: assessOverride(thin),
    });
    expect(decision.ok).toBe(true);
    expect(decision.error).toBeNull();
  });

  it('FR-PR-05: a too-short justification is rejected', () => {
    const decision = evaluateRequest({
      requestedByUserId: MANAGER,
      requesterRoles: ROLES.BROKER_MANAGER,
      reason: 'ok',
      assessment: assessOverride(thin),
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('REASON_TOO_SHORT');
  });

  it('an override cannot be requested for a quote that is within policy', () => {
    const decision = evaluateRequest({
      requestedByUserId: MANAGER,
      requesterRoles: ROLES.BROKER_MANAGER,
      reason: 'No policy breach here, should be refused.',
      assessment: assessOverride(healthy),
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('NOT_REQUIRED');
  });

  /* ------------------------------------------------------------ approval --- */

  it('FR-PR-06: separation of duties — the requester cannot approve their own override', () => {
    const decision = evaluateApproval({
      approverUserId: MANAGER,
      approverRoles: ROLES.BROKER_MANAGER,
      requestedByUserId: MANAGER,
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('SELF_APPROVAL');
  });

  it('FR-PR-06: a different authorised user can approve', () => {
    const decision = evaluateApproval({
      approverUserId: ADMIN,
      approverRoles: ROLES.ORG_ADMIN,
      requestedByUserId: MANAGER,
    });
    expect(decision.ok).toBe(true);
  });

  it('FR-PR-06: a broker dispatcher cannot approve an override', () => {
    const decision = evaluateApproval({
      approverUserId: 'user-dispatcher-0001',
      approverRoles: ROLES.BROKER_DISPATCHER,
      requestedByUserId: MANAGER,
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('FORBIDDEN');
  });

  it('FR-PR-06: a carrier or driver can never approve an override', () => {
    for (const role of [ROLES.CARRIER_DISPATCH, ROLES.DRIVER, ROLES.SHIPPER]) {
      const decision = evaluateApproval({
        approverUserId: 'user-external-0001',
        approverRoles: role,
        requestedByUserId: MANAGER,
      });
      expect(decision.ok).toBe(false);
      expect(decision.error).toBe('FORBIDDEN');
    }
  });

  it('an already-approved override is not re-approved', () => {
    const decision = evaluateApproval({
      approverUserId: ADMIN,
      approverRoles: ROLES.ORG_ADMIN,
      requestedByUserId: MANAGER,
      alreadyApprovedBy: 'user-someone-else',
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('ALREADY_APPROVED');
  });

  /* ----------------------------------------------------------- releasable --- */

  it('FR-PR-06: a quote needing an unapproved override cannot be released', () => {
    expect(isQuoteReleasable(assessOverride(thin), null)).toBe(false);
    expect(isQuoteReleasable(assessOverride(thin), ADMIN)).toBe(true);
    expect(isQuoteReleasable(assessOverride(healthy), null)).toBe(true);
  });
});
