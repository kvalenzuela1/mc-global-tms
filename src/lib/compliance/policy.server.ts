/**
 * Data-access side of the FR-CMP-01/02/03 compliance gate: fetch the latest
 * `carrier_compliance` row(s) and the org's compliance policy thresholds, and
 * run them through the pure `evaluateCarrierCompliance`. Kept separate from
 * `gate.ts` so the decision logic stays testable by `npm run test:offline`
 * without a Supabase client — mirrors `src/lib/config/policies.server.ts`.
 */

import { getServerSupabase } from '@/lib/supabase/server';
import {
  evaluateCarrierCompliance,
  DEFAULT_COMPLIANCE_THRESHOLDS,
  type CarrierComplianceSnapshot,
  type ComplianceResult,
  type AuthorityStatus,
  type ManualReviewState,
} from '@/lib/compliance/gate';
import { resolveComplianceThresholds, type PolicyRow, type PolicyScope } from '@/lib/config/policy-resolver';

interface PolicyRecord {
  org_id: string | null;
  scope: PolicyScope;
  policy_key: string;
  version: number;
  value: Record<string, unknown>;
  effective_at: string;
  is_active: boolean;
}

interface CarrierComplianceRecord {
  carrier_id: string;
  authority_status: AuthorityStatus;
  out_of_service: boolean;
  insurance_expiry: string | null;
  auto_liability_cents: number | null;
  cargo_cents: number | null;
  required_docs_present: boolean;
  manual_review: ManualReviewState;
  created_at: string;
}

function toSnapshot(row: CarrierComplianceRecord): CarrierComplianceSnapshot {
  return {
    authorityStatus: row.authority_status,
    outOfService: row.out_of_service,
    insuranceExpiry: row.insurance_expiry,
    autoLiabilityCents: row.auto_liability_cents,
    cargoCents: row.cargo_cents,
    requiredDocsPresent: row.required_docs_present,
    manualReview: row.manual_review,
  };
}

async function getOrgComplianceThresholds(orgId: string) {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('policies')
    .select('org_id, scope, policy_key, version, value, effective_at, is_active')
    .eq('policy_key', 'compliance')
    .eq('is_active', true)
    .or(`org_id.is.null,org_id.eq.${orgId}`);
  if (error) throw error;

  const rows: PolicyRow[] = ((data ?? []) as PolicyRecord[]).map((row) => ({
    orgId: row.org_id,
    scope: row.scope,
    policyKey: row.policy_key,
    version: row.version,
    value: row.value,
    effectiveAt: row.effective_at,
    isActive: row.is_active,
  }));
  return resolveComplianceThresholds(rows, DEFAULT_COMPLIANCE_THRESHOLDS);
}

/** Latest `carrier_compliance` row per carrier_id — the table is append-only. */
function latestByCarrier(rows: CarrierComplianceRecord[]): Map<string, CarrierComplianceRecord> {
  const latest = new Map<string, CarrierComplianceRecord>();
  for (const row of rows) {
    const current = latest.get(row.carrier_id);
    if (!current || row.created_at > current.created_at) {
      latest.set(row.carrier_id, row);
    }
  }
  return latest;
}

/** FR-CMP-01..03: compliance result for a single carrier, or null if never reviewed. */
export async function getCarrierComplianceResult(
  orgId: string,
  carrierId: string,
): Promise<ComplianceResult | null> {
  const supabase = await getServerSupabase();
  const [{ data, error }, thresholds] = await Promise.all([
    supabase
      .from('carrier_compliance')
      .select(
        'carrier_id, authority_status, out_of_service, insurance_expiry, auto_liability_cents, cargo_cents, required_docs_present, manual_review, created_at',
      )
      .eq('org_id', orgId)
      .eq('carrier_id', carrierId)
      .order('created_at', { ascending: false })
      .limit(1),
    getOrgComplianceThresholds(orgId),
  ]);
  if (error) throw error;
  const row = (data as CarrierComplianceRecord[] | null)?.[0];
  if (!row) return null;
  return evaluateCarrierCompliance(toSnapshot(row), new Date(), thresholds);
}

/** FR-CMP-01..03: compliance result for every carrier in the org, keyed by carrier_id. */
export async function getOrgComplianceResults(orgId: string): Promise<Map<string, ComplianceResult | null>> {
  const supabase = await getServerSupabase();
  const [{ data: carrierRows, error: carrierError }, { data: complianceRows, error: complianceError }, thresholds] =
    await Promise.all([
      supabase.from('carriers').select('id').eq('org_id', orgId),
      supabase
        .from('carrier_compliance')
        .select(
          'carrier_id, authority_status, out_of_service, insurance_expiry, auto_liability_cents, cargo_cents, required_docs_present, manual_review, created_at',
        )
        .eq('org_id', orgId),
      getOrgComplianceThresholds(orgId),
    ]);
  if (carrierError) throw carrierError;
  if (complianceError) throw complianceError;

  const latest = latestByCarrier((complianceRows as CarrierComplianceRecord[]) ?? []);
  const asOf = new Date();
  const results = new Map<string, ComplianceResult | null>();
  for (const carrier of (carrierRows as { id: string }[]) ?? []) {
    const row = latest.get(carrier.id);
    results.set(carrier.id, row ? evaluateCarrierCompliance(toSnapshot(row), asOf, thresholds) : null);
  }
  return results;
}
