/**
 * FR-CFG-03 — Versioned config resolver: platform -> organization -> exception.
 *
 * The `policies` table has been seeded since Milestone 1 but nothing has ever
 * read it; `DEFAULT_PRICING_CONFIG` was the only source of pricing config.
 * This resolves the most specific ACTIVE, already-effective row for a policy
 * key, given the rows a caller has already fetched. Pure and free of
 * Next/Supabase imports so it runs under `npm run test:offline`; the fetch
 * side lives in `policies.server.ts`.
 */

import type { PricingConfig } from '@/lib/pricing/calc';
import type { ComplianceThresholds } from '@/lib/compliance/gate';

export type PolicyScope = 'platform' | 'organization' | 'exception';

export interface PolicyRow {
  orgId: string | null;
  scope: PolicyScope;
  policyKey: string;
  version: number;
  value: Record<string, unknown>;
  /** ISO timestamp. */
  effectiveAt: string;
  isActive: boolean;
}

const SCOPE_RANK: Record<PolicyScope, number> = {
  platform: 0,
  organization: 1,
  exception: 2,
};

/**
 * Resolve the value of the most specific eligible row for `policyKey`.
 * Eligible = active and already effective (`effectiveAt <= now`). Among
 * eligible rows: exception beats organization beats platform; ties within a
 * scope break on the higher version, then the more recent `effectiveAt`.
 * Returns null when nothing eligible exists, so callers can fall back.
 */
export function resolvePolicyValue(
  rows: PolicyRow[],
  policyKey: string,
  now: string,
): Record<string, unknown> | null {
  const eligible = rows.filter(
    (r) => r.policyKey === policyKey && r.isActive && r.effectiveAt <= now,
  );
  if (eligible.length === 0) return null;

  const best = eligible.reduce((current, candidate) => {
    if (SCOPE_RANK[candidate.scope] !== SCOPE_RANK[current.scope]) {
      return SCOPE_RANK[candidate.scope] > SCOPE_RANK[current.scope] ? candidate : current;
    }
    if (candidate.version !== current.version) {
      return candidate.version > current.version ? candidate : current;
    }
    return candidate.effectiveAt > current.effectiveAt ? candidate : current;
  });

  return best.value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberArrayOr(value: unknown, fallback: number[]): number[] {
  if (Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return value;
  }
  return fallback;
}

/**
 * Resolve the `pricing` policy key into a `PricingConfig`, falling back to
 * `fallback` (normally `DEFAULT_PRICING_CONFIG`) field-by-field when a value
 * is missing or malformed, never only all-or-nothing.
 */
export function resolvePricingConfig(
  rows: PolicyRow[],
  fallback: PricingConfig,
  now: string = new Date().toISOString(),
): PricingConfig {
  const value = resolvePolicyValue(rows, 'pricing', now);
  if (!value) return fallback;
  return {
    targetMarginPercent: numberOr(value.target_margin_percent, fallback.targetMarginPercent),
    quickPayFeePercent: numberOr(value.quick_pay_fee_percent, fallback.quickPayFeePercent),
    factoringCostPercent: numberOr(value.factoring_cost_percent, fallback.factoringCostPercent),
  };
}

/**
 * Resolve the `compliance` policy key into `ComplianceThresholds`, falling
 * back to `fallback` (normally `DEFAULT_COMPLIANCE_THRESHOLDS`) field-by-field.
 */
export function resolveComplianceThresholds(
  rows: PolicyRow[],
  fallback: ComplianceThresholds,
  now: string = new Date().toISOString(),
): ComplianceThresholds {
  const value = resolvePolicyValue(rows, 'compliance', now);
  if (!value) return fallback;
  return {
    minAutoLiabilityCents: numberOr(value.min_auto_liability_cents, fallback.minAutoLiabilityCents),
    minCargoCents: numberOr(value.min_cargo_cents, fallback.minCargoCents),
    warnDays: numberArrayOr(value.warn_days, fallback.warnDays),
  };
}
