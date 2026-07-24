/**
 * FR-CFG-03 — Versioned config resolver: platform -> organization -> exception.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePolicyValue,
  resolvePricingConfig,
  resolveComplianceThresholds,
  resolveLoadMarginConfig,
} from '@/lib/config/policy-resolver';
import { DEFAULT_PRICING_CONFIG } from '@/lib/pricing/calc';
import { DEFAULT_LOAD_MARGIN_CONFIG } from '@/lib/pricing/margin';
import { DEFAULT_COMPLIANCE_THRESHOLDS } from '@/lib/compliance/gate';

const NOW = '2026-07-20T00:00:00.000Z';

const PLATFORM = {
  orgId: null,
  scope: 'platform' as const,
  policyKey: 'pricing',
  version: 1,
  value: { target_margin_percent: 0.18, quick_pay_fee_percent: 0.05, factoring_cost_percent: 0.03 },
  effectiveAt: '2026-01-01T00:00:00.000Z',
  isActive: true,
};

const ORG = {
  orgId: 'org-1',
  scope: 'organization' as const,
  policyKey: 'pricing',
  version: 1,
  value: { target_margin_percent: 0.22 },
  effectiveAt: '2026-02-01T00:00:00.000Z',
  isActive: true,
};

const EXCEPTION = {
  orgId: 'org-1',
  scope: 'exception' as const,
  policyKey: 'pricing',
  version: 1,
  value: { target_margin_percent: 0.3 },
  effectiveAt: '2026-03-01T00:00:00.000Z',
  isActive: true,
};

describe('policy resolver', () => {
  it('FR-CFG-03: falls back to the platform default when nothing else is configured', () => {
    const value = resolvePolicyValue([PLATFORM], 'pricing', NOW);
    expect(value?.target_margin_percent).toBe(0.18);
  });

  it('FR-CFG-03: organization scope overrides platform', () => {
    const value = resolvePolicyValue([PLATFORM, ORG], 'pricing', NOW);
    expect(value?.target_margin_percent).toBe(0.22);
  });

  it('FR-CFG-03: exception scope overrides organization and platform', () => {
    const value = resolvePolicyValue([PLATFORM, ORG, EXCEPTION], 'pricing', NOW);
    expect(value?.target_margin_percent).toBe(0.3);
  });

  it('ignores inactive rows', () => {
    const value = resolvePolicyValue(
      [PLATFORM, { ...EXCEPTION, isActive: false }],
      'pricing',
      NOW,
    );
    expect(value?.target_margin_percent).toBe(0.18);
  });

  it('ignores rows not yet effective', () => {
    const future = { ...EXCEPTION, effectiveAt: '2027-01-01T00:00:00.000Z' };
    const value = resolvePolicyValue([PLATFORM, future], 'pricing', NOW);
    expect(value?.target_margin_percent).toBe(0.18);
  });

  it('returns null when no eligible row exists', () => {
    expect(resolvePolicyValue([], 'pricing', NOW)).toBeNull();
  });

  it('a higher version wins within the same scope', () => {
    const v2 = { ...PLATFORM, version: 2, value: { target_margin_percent: 0.2 } };
    const value = resolvePolicyValue([PLATFORM, v2], 'pricing', NOW);
    expect(value?.target_margin_percent).toBe(0.2);
  });

  it('FR-PR-05: resolvePricingConfig fills missing fields from the fallback', () => {
    const config = resolvePricingConfig([PLATFORM, ORG], DEFAULT_PRICING_CONFIG, NOW);
    expect(config.targetMarginPercent).toBe(0.22);
    expect(config.quickPayFeePercent).toBe(DEFAULT_PRICING_CONFIG.quickPayFeePercent);
    expect(config.factoringCostPercent).toBe(DEFAULT_PRICING_CONFIG.factoringCostPercent);
  });

  it('resolvePricingConfig falls back entirely when no policy rows exist', () => {
    const config = resolvePricingConfig([], DEFAULT_PRICING_CONFIG, NOW);
    expect(config).toEqual(DEFAULT_PRICING_CONFIG);
  });

  it('FR-CMP-01: resolveComplianceThresholds falls back entirely when no policy rows exist', () => {
    const thresholds = resolveComplianceThresholds([], DEFAULT_COMPLIANCE_THRESHOLDS, NOW);
    expect(thresholds).toEqual(DEFAULT_COMPLIANCE_THRESHOLDS);
  });

  it('FR-CMP-01/02: resolveComplianceThresholds reads the seeded compliance policy shape', () => {
    const compliancePolicy = {
      orgId: 'org-1',
      scope: 'organization' as const,
      policyKey: 'compliance',
      version: 1,
      value: { min_auto_liability_cents: 200_000_00, min_cargo_cents: 50_000_00, warn_days: [30, 14] },
      effectiveAt: '2026-01-01T00:00:00.000Z',
      isActive: true,
    };
    const thresholds = resolveComplianceThresholds([compliancePolicy], DEFAULT_COMPLIANCE_THRESHOLDS, NOW);
    expect(thresholds.minAutoLiabilityCents).toBe(200_000_00);
    expect(thresholds.minCargoCents).toBe(50_000_00);
    expect(thresholds.warnDays).toEqual([30, 14]);
  });

  it('resolveComplianceThresholds fills missing fields from the fallback', () => {
    const partial = {
      orgId: 'org-1',
      scope: 'organization' as const,
      policyKey: 'compliance',
      version: 1,
      value: { min_auto_liability_cents: 200_000_00 },
      effectiveAt: '2026-01-01T00:00:00.000Z',
      isActive: true,
    };
    const thresholds = resolveComplianceThresholds([partial], DEFAULT_COMPLIANCE_THRESHOLDS, NOW);
    expect(thresholds.minAutoLiabilityCents).toBe(200_000_00);
    expect(thresholds.minCargoCents).toBe(DEFAULT_COMPLIANCE_THRESHOLDS.minCargoCents);
    expect(thresholds.warnDays).toEqual(DEFAULT_COMPLIANCE_THRESHOLDS.warnDays);
  });
});

describe('FR-MGN-04: resolveLoadMarginConfig (org house default tier)', () => {
  it('returns the fallback when no load_margins policy exists', () => {
    const cfg = resolveLoadMarginConfig([], DEFAULT_LOAD_MARGIN_CONFIG, NOW);
    expect(cfg).toEqual({ brokerPercent: 0.18, dispatchPercent: 0.05 });
  });

  it('an org-scope row overrides the platform seed', () => {
    const platform = {
      orgId: null,
      scope: 'platform' as const,
      policyKey: 'load_margins',
      version: 1,
      value: { broker_percent: 0.18, dispatch_percent: 0.05 },
      effectiveAt: '2026-01-01T00:00:00.000Z',
      isActive: true,
    };
    const org = {
      orgId: 'org-1',
      scope: 'organization' as const,
      policyKey: 'load_margins',
      version: 1,
      value: { broker_percent: 0.2 },
      effectiveAt: '2026-02-01T00:00:00.000Z',
      isActive: true,
    };
    const cfg = resolveLoadMarginConfig([platform, org], DEFAULT_LOAD_MARGIN_CONFIG, NOW);
    // broker from the org row; dispatch falls back field-by-field to the seed
    expect(cfg.brokerPercent).toBe(0.2);
    expect(cfg.dispatchPercent).toBe(0.05);
  });
});
