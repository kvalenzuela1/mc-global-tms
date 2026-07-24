import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, visibleMarginLines, PERMISSIONS } from '@/lib/rbac/permissions';
import { isInternalRole } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import { type LoadStatus } from '@/lib/loads/lifecycle';
import { computeLoadFinancials, resolveMarginPercents } from '@/lib/pricing/margin';
import { resolveOrgLoadMarginConfig } from '@/lib/config/policies.server';
import { StatusBadge, STATUS_FACET } from '../_components/status-badge';

interface LoadRow {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
  carrier_name: string | null;
}

interface LoadFinancialRow {
  id: string;
  shipper_cost_cents: number | null;
  broker_percent: number | null;
  dispatch_percent: number | null;
}

interface AccessorialRow {
  load_id: string;
  amount_cents: number;
}

export default async function LoadsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.LOAD_VIEW) && !can(active.role, PERMISSIONS.SHIPPER_TRACK)) {
    return <NotAuthorized />;
  }

  // FR-MASK-01: loads.commercial_snapshot is a JSONB blob maskCommercials()
  // does not traverse, and RLS lets a carrier/driver read the row it's
  // assigned to — RLS is row-level, not column-level, and every tenant user
  // maps to the same Postgres role, so column grants can't help either. The
  // `loads` view (migration 0006 — the real table is `loads_data`) nulls
  // commercial_snapshot at the storage layer for anyone who isn't a
  // broker-org member; showCommercials below is a UI-side belt-and-suspenders
  // check on top of that, not the only thing standing between a driver and
  // the margin.
  const showCommercials = isInternalRole(active.role);
  const vis = visibleMarginLines(active.role);
  const canCreate = can(active.role, PERMISSIONS.LOAD_CREATE);

  const supabase = await getServerSupabase();

  // No org_id filter: loads_api inherits loads_select's relationship-based
  // scoping (broker member / assigned carrier / assigned driver / shipper),
  // and for external roles active.orgId is THEIR org, not the broker
  // tenant's — filtering on it here would wrongly hide their loads.
  const { data: loadData, error } = await supabase
    .from('loads')
    .select('id, reference, origin, destination, status, carrier_name')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const loads = (loadData as unknown as LoadRow[]) ?? [];

  // Carrier Pay is visible to every internal role (dispatch-side). The masked
  // financial inputs come from the `load_financials` view (migration 0011),
  // and the org house default backstops any load with null percents (booked
  // pre-feature). The per-line breakdown lives on each load's detail page.
  const financialInputs = new Map<string, LoadFinancialRow>();
  let orgMarginDefault: Awaited<ReturnType<typeof resolveOrgLoadMarginConfig>> | null = null;
  if (vis.carrierPay) {
    orgMarginDefault = await resolveOrgLoadMarginConfig(active.orgId);
    const { data: finData } = await supabase
      .from('load_financials')
      .select('id, shipper_cost_cents, broker_percent, dispatch_percent');
    for (const row of (finData as LoadFinancialRow[]) ?? []) financialInputs.set(row.id, row);
  }
  function carrierPayCentsFor(l: LoadRow): number | null {
    const fin = financialInputs.get(l.id);
    if (!orgMarginDefault || !fin || typeof fin.shipper_cost_cents !== 'number' || fin.shipper_cost_cents <= 0) {
      return null;
    }
    const { brokerPercent, dispatchPercent } = resolveMarginPercents({
      load: { brokerPercent: fin.broker_percent, dispatchPercent: fin.dispatch_percent },
      orgDefault: orgMarginDefault,
    });
    return computeLoadFinancials({ shipperCostCents: fin.shipper_cost_cents, brokerPercent, dispatchPercent }).carrierPayCents;
  }

  // Accessorials are broker-org-commercial data (same RLS shape as quotes),
  // so this query naturally returns nothing for external roles — the
  // showCommercials gate on the UI below is belt-and-suspenders, same
  // reasoning as the Margin column just above it.
  const accessorialTotals = new Map<string, { count: number; totalCents: number }>();
  if (showCommercials) {
    const { data: accessorialData } = await supabase
      .from('accessorials')
      .select('load_id, amount_cents')
      .eq('org_id', active.orgId);
    for (const row of (accessorialData as AccessorialRow[]) ?? []) {
      const existing = accessorialTotals.get(row.load_id) ?? { count: 0, totalCents: 0 };
      accessorialTotals.set(row.load_id, {
        count: existing.count + 1,
        totalCents: existing.totalCents + row.amount_cents,
      });
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Loads</h1>
          <p className="text-muted mt-1">Booked freight and lifecycle status.</p>
        </div>
        {canCreate && (
          <Link href="/portal/loads/new" className="btn-copper px-4 py-2 whitespace-nowrap">
            Book a load
          </Link>
        )}
      </div>

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">All loads</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-muted text-left">
            <tr className="border-b border-line">
              <th className="pb-2">Reference</th>
              <th className="pb-2">Lane</th>
              <th className="pb-2">Carrier</th>
              <th className="pb-2">Status</th>
              {vis.carrierPay && <th className="pb-2">Carrier Pay</th>}
              {showCommercials && <th className="pb-2">Accessorials</th>}
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => {
              const carrierPay = vis.carrierPay ? carrierPayCentsFor(l) : null;
              return (
                <tr key={l.id} className="table-row border-t border-line">
                  <td className="py-2">
                    <Link href={`/portal/loads/${l.id}`} className="hover:text-copper-400">
                      {l.reference}
                    </Link>
                  </td>
                  <td className="py-2">
                    {l.origin} → {l.destination}
                  </td>
                  <td className="py-2">{l.carrier_name ?? '—'}</td>
                  <td className="py-2">
                    <StatusBadge facet={STATUS_FACET.LOAD} value={l.status} />
                  </td>
                  {vis.carrierPay && (
                    <td className="py-2 tabular-nums">
                      {typeof carrierPay === 'number' ? `$${(carrierPay / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </td>
                  )}
                  {showCommercials && (
                    <td className="py-2">
                      {(() => {
                        const totals = accessorialTotals.get(l.id);
                        return totals
                          ? `${totals.count} · $${(totals.totalCents / 100).toFixed(2)}`
                          : '—';
                      })()}
                    </td>
                  )}
                </tr>
              );
            })}
            {loads.length === 0 && (
              <tr>
                <td
                  colSpan={4 + (vis.carrierPay ? 1 : 0) + (showCommercials ? 1 : 0)}
                  className="py-8 text-muted text-center"
                >
                  No loads yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to loads.</p>
    </div>
  );
}
