/**
 * FR-CFG-03 — Versioned config resolver: platform -> organization -> exception.
 */
import { describe, it, expect } from 'vitest';
import { resolvePolicyValue, resolvePricingConfig } from '@/lib/config/policy-resolver';
import { DEFAULT_PRICING_CONFIG } from '@/lib/pricing/calc';

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
});
