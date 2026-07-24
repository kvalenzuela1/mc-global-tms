/**
 * Data-access side of the FR-CFG-03 config resolver: fetch active `policies`
 * rows (RLS-scoped to platform + the caller's org) and resolve them with the
 * pure logic in `policy-resolver.ts`. Kept separate from that file so the
 * decision logic stays testable by `npm run test:offline` without a Supabase
 * client.
 */

import { getServerSupabase } from '@/lib/supabase/server';
import { DEFAULT_PRICING_CONFIG, type PricingConfig } from '@/lib/pricing/calc';
import { DEFAULT_LOAD_MARGIN_CONFIG, type LoadMarginConfig } from '@/lib/pricing/margin';
import {
  resolvePricingConfig,
  resolveLoadMarginConfig,
  type PolicyRow,
  type PolicyScope,
} from '@/lib/config/policy-resolver';

interface PolicyRecord {
  org_id: string | null;
  scope: PolicyScope;
  policy_key: string;
  version: number;
  value: Record<string, unknown>;
  effective_at: string;
  is_active: boolean;
}

async function getActivePolicyRows(orgId: string, policyKey: string): Promise<PolicyRow[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('policies')
    .select('org_id, scope, policy_key, version, value, effective_at, is_active')
    .eq('policy_key', policyKey)
    .eq('is_active', true)
    .or(`org_id.is.null,org_id.eq.${orgId}`);
  if (error) throw error;

  return ((data ?? []) as PolicyRecord[]).map((row) => ({
    orgId: row.org_id,
    scope: row.scope,
    policyKey: row.policy_key,
    version: row.version,
    value: row.value,
    effectiveAt: row.effective_at,
    isActive: row.is_active,
  }));
}

/** FR-CFG-03/FR-PR-05: resolve the effective pricing config for an org. */
export async function resolveOrgPricingConfig(orgId: string): Promise<PricingConfig> {
  const rows = await getActivePolicyRows(orgId, 'pricing');
  return resolvePricingConfig(rows, DEFAULT_PRICING_CONFIG);
}

/**
 * FR-MGN-04: resolve the org house default for the two load-margin percentages
 * (platform seed → org-scope row). Per-customer and per-load overrides sit on
 * top of this via `resolveMarginPercents`.
 */
export async function resolveOrgLoadMarginConfig(orgId: string): Promise<LoadMarginConfig> {
  const rows = await getActivePolicyRows(orgId, 'load_margins');
  return resolveLoadMarginConfig(rows, DEFAULT_LOAD_MARGIN_CONFIG);
}
