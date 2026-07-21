/**
 * FR-PR-05/06 — Pricing override policy (Milestone 3).
 *
 * Pure decision logic: when does a quote need an override, who may request one,
 * and who may approve it. Deliberately free of Next.js / Supabase imports so it
 * runs under `npm run test:offline` alongside calc.ts and lifecycle.ts.
 *
 * Two things worth knowing about the design:
 *
 * 1. The RBAC matrix grants `pricing:override` and `pricing:override_approve` to
 *    the *same* two roles (org_admin, broker_manager). Permissions alone
 *    therefore cannot produce a maker/checker split, so the separation-of-duties
 *    rule — an override may not be approved by the person who requested it — is
 *    enforced here, in the service layer. See `evaluateApproval`.
 *
 * 2. `computePricing` rejects a target margin of 1.0 or above, so a quote can
 *    never be "100% margin". The floor checks below guard the opposite end.
 */

import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import type { Role } from '@/lib/rbac/roles';
import type { PricingResult } from '@/lib/pricing/calc';

/* ------------------------------------------------------------------ policy --- */

export interface OverridePolicy {
  /** Realized margin below this fraction requires an approved override. */
  minMarginPercent: number;
  /** Minimum characters of justification required on the request. */
  minReasonLength: number;
}

export const DEFAULT_OVERRIDE_POLICY: OverridePolicy = {
  minMarginPercent: 0.12,
  minReasonLength: 12,
};

/* ----------------------------------------------------------------- reasons --- */

export const OVERRIDE_REASONS = {
  MARGIN_BELOW_FLOOR: 'MARGIN_BELOW_FLOOR',
  NEGATIVE_MARGIN: 'NEGATIVE_MARGIN',
  QUICK_PAY_BELOW_FACTORING: 'QUICK_PAY_BELOW_FACTORING',
} as const;

export type OverrideReason = (typeof OVERRIDE_REASONS)[keyof typeof OVERRIDE_REASONS];

export const OVERRIDE_REASON_LABELS: Record<OverrideReason, string> = {
  MARGIN_BELOW_FLOOR: 'Margin is below the configured floor',
  NEGATIVE_MARGIN: 'Shipper price is at or below carrier cost',
  QUICK_PAY_BELOW_FACTORING: 'Quick Pay fee is below factoring cost (negative spread)',
};

/* -------------------------------------------------------------- assessment --- */

export interface OverrideAssessment {
  /** True when this quote may not be issued without an approved override. */
  required: boolean;
  reasons: OverrideReason[];
}

/**
 * Decide whether a computed quote breaches policy.
 *
 * Note the ordering: a negative margin is reported on its own rather than also
 * tripping the floor, so the audit trail records the more serious finding
 * without a redundant second reason.
 */
export function assessOverride(
  pricing: PricingResult,
  policy: OverridePolicy = DEFAULT_OVERRIDE_POLICY,
): OverrideAssessment {
  const reasons: OverrideReason[] = [];

  if (pricing.marginAmountCents <= 0) {
    reasons.push(OVERRIDE_REASONS.NEGATIVE_MARGIN);
  } else if (pricing.marginPercent < policy.minMarginPercent) {
    reasons.push(OVERRIDE_REASONS.MARGIN_BELOW_FLOOR);
  }

  if (pricing.quickPaySpreadCents < 0) {
    reasons.push(OVERRIDE_REASONS.QUICK_PAY_BELOW_FACTORING);
  }

  return { required: reasons.length > 0, reasons };
}

/* ----------------------------------------------------------------- request --- */

export interface OverrideRequestInput {
  requestedByUserId: string;
  requesterRoles: Role[] | Role;
  reason: string;
  assessment: OverrideAssessment;
  policy?: OverridePolicy;
}

export interface OverrideDecision {
  ok: boolean;
  /** Machine-readable failure code; null when ok. */
  error: string | null;
  message: string | null;
}

const OK: OverrideDecision = { ok: true, error: null, message: null };

function deny(error: string, message: string): OverrideDecision {
  return { ok: false, error, message };
}

/**
 * Validate an override *request* before it is written to `quotes`.
 */
export function evaluateRequest({
  requesterRoles,
  reason,
  assessment,
  policy = DEFAULT_OVERRIDE_POLICY,
}: OverrideRequestInput): OverrideDecision {
  if (!can(requesterRoles, PERMISSIONS.PRICING_OVERRIDE)) {
    return deny('FORBIDDEN', 'You do not have permission to request a pricing override.');
  }

  if (!assessment.required) {
    return deny(
      'NOT_REQUIRED',
      'This quote is within policy; an override is not required.',
    );
  }

  const trimmed = reason.trim();
  if (trimmed.length < policy.minReasonLength) {
    return deny(
      'REASON_TOO_SHORT',
      `A written justification of at least ${policy.minReasonLength} characters is required.`,
    );
  }

  return OK;
}

/* ---------------------------------------------------------------- approval --- */

export interface OverrideApprovalInput {
  approverUserId: string;
  approverRoles: Role[] | Role;
  /** The user who requested the override. */
  requestedByUserId: string;
  /** Already-approved overrides must not be silently re-approved. */
  alreadyApprovedBy?: string | null;
}

/**
 * Validate an override *approval*.
 *
 * Enforces separation of duties: because org_admin and broker_manager both hold
 * request and approve permissions, the only thing preventing self-approval is
 * this check. Removing it would let one person unilaterally book a below-floor
 * load, which is exactly what FR-PR-06 exists to prevent.
 */
export function evaluateApproval({
  approverUserId,
  approverRoles,
  requestedByUserId,
  alreadyApprovedBy = null,
}: OverrideApprovalInput): OverrideDecision {
  if (!can(approverRoles, PERMISSIONS.PRICING_OVERRIDE_APPROVE)) {
    return deny('FORBIDDEN', 'You do not have permission to approve a pricing override.');
  }

  if (alreadyApprovedBy) {
    return deny('ALREADY_APPROVED', 'This override has already been approved.');
  }

  if (approverUserId === requestedByUserId) {
    return deny(
      'SELF_APPROVAL',
      'An override must be approved by someone other than the person who requested it.',
    );
  }

  return OK;
}

/**
 * Can this quote be attached to a load and moved to `quoted`?
 * An override that is required but unapproved blocks the transition.
 */
export function isQuoteReleasable(
  assessment: OverrideAssessment,
  overrideApprovedBy: string | null,
): boolean {
  if (!assessment.required) return true;
  return Boolean(overrideApprovedBy);
}
