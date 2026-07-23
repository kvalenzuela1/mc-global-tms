import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { LOAD_STATUS, type LoadStatus } from '@/lib/loads/lifecycle';
import { readSnapshotCents } from '@/lib/pricing/snapshot';
import { canCreateShipperInvoice } from '@/lib/finance/invoice-eligibility';
import { StatusBadge, STATUS_FACET } from '../_components/status-badge';

interface LoadRow {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
  commercial_snapshot: Record<string, unknown> | null;
}

// The finance view only cares about loads that have reached delivery — before
// that there is nothing to invoice. `delivered` is the actionable set;
// `invoiced`/`closed` are shown as already-billed so the list reconciles.
const FINANCE_STATUSES: LoadStatus[] = [
  LOAD_STATUS.DELIVERED,
  LOAD_STATUS.INVOICED,
  LOAD_STATUS.CLOSED,
];

function money(cents: number | undefined): string {
  return typeof cents === 'number' ? `$${(cents / 100).toFixed(2)}` : '—';
}

export default async function FinancePage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  // FR-BIL-01: invoicing is broker-org finance work. INVOICE_CREATE is held
  // only by org_admin / broker_manager — drivers, carriers and shippers never
  // reach this page (they also lack it in the nav). The route re-checks here
  // regardless of the nav filter (FR-RBAC-05).
  if (!can(active.role, PERMISSIONS.INVOICE_CREATE)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();

  const { data: loadData, error } = await supabase
    .from('loads')
    .select('id, reference, origin, destination, status, commercial_snapshot')
    .in('status', FINANCE_STATUSES)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const loads = (loadData as unknown as LoadRow[]) ?? [];
  const loadIds = loads.map((l) => l.id);

  // Document match: which loads have a BOL and a POD on file. Same append-only
  // documents table the Documents page reads; latest row per (load, type) is
  // irrelevant here — presence is all eligibility needs.
  const bolLoads = new Set<string>();
  const podLoads = new Set<string>();
  const signedRcLoads = new Set<string>();
  if (loadIds.length > 0) {
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .select('load_id, doc_type')
      .in('load_id', loadIds)
      .in('doc_type', ['bol', 'pod']);
    if (docError) throw docError;
    for (const d of (docData as { load_id: string; doc_type: string }[]) ?? []) {
      if (d.doc_type === 'bol') bolLoads.add(d.load_id);
      if (d.doc_type === 'pod') podLoads.add(d.load_id);
    }

    // A signed rate confirmation is the ratecon row for the load at status
    // 'signed' — same signal the ratecons page and the release gate use.
    const { data: rcData, error: rcError } = await supabase
      .from('ratecons')
      .select('load_id, status')
      .in('load_id', loadIds)
      .eq('status', 'signed');
    if (rcError) throw rcError;
    for (const rc of (rcData as { load_id: string }[]) ?? []) {
      signedRcLoads.add(rc.load_id);
    }
  }

  const rows = loads.map((l) => {
    const alreadyInvoiced =
      l.status === LOAD_STATUS.INVOICED || l.status === LOAD_STATUS.CLOSED;
    // missingRequiredDocs stays empty in the pilot: per-service-type required
    // docs are an open client decision (CLAUDE.md). BOL/POD/signed-RC are the
    // universal FR-BIL-01 gate and are wired.
    const eligibility = canCreateShipperInvoice({
      status: l.status,
      hasSignedRateConfirmation: signedRcLoads.has(l.id),
      hasBol: bolLoads.has(l.id),
      hasPod: podLoads.has(l.id),
      missingRequiredDocs: [],
    });
    return { load: l, alreadyInvoiced, eligibility };
  });

  const invoiceable = rows.filter((r) => !r.alreadyInvoiced && r.eligibility.eligible).length;
  const blocked = rows.filter((r) => !r.alreadyInvoiced && !r.eligibility.eligible).length;

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold">Invoicing</h1>
        <p className="text-muted mt-1">
          Delivered loads and their shipper-invoice readiness (FR-BIL-01: signed
          rate confirmation + BOL + POD on file).
        </p>
      </div>

      <div className="mt-6 flex gap-3 text-sm">
        <span className="panel px-4 py-2">
          <span className="font-semibold text-emerald-500">{invoiceable}</span> invoiceable
        </span>
        <span className="panel px-4 py-2">
          <span className="font-semibold text-amber-500">{blocked}</span> blocked
        </span>
      </div>

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">Delivered loads</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-muted text-left">
            <tr className="border-b border-line">
              <th className="pb-2">Reference</th>
              <th className="pb-2">Lane</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Shipper amount</th>
              <th className="pb-2">Invoice readiness</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ load: l, alreadyInvoiced, eligibility }) => {
              const amount = readSnapshotCents(
                l.commercial_snapshot,
                'shipperPriceCents',
                'shipper_price_cents',
              );
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
                  <td className="py-2">
                    <StatusBadge facet={STATUS_FACET.LOAD} value={l.status} />
                  </td>
                  <td className="py-2">{money(amount)}</td>
                  <td className="py-2">
                    {alreadyInvoiced ? (
                      <span className="text-muted">Invoiced</span>
                    ) : eligibility.eligible ? (
                      <span className="font-medium text-emerald-500">Invoiceable</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {eligibility.reasons.map((reason) => (
                          <li key={reason} className="text-amber-500">
                            {reason.slice(reason.indexOf(':') + 1).trim()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-muted text-center">
                  No delivered loads yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="text-muted mt-4 text-xs">
          Read-only for the pilot: this confirms document-match readiness. Invoice
          generation and export are post-pilot scope.
        </p>
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">
        Your role does not include invoicing access.
      </p>
    </div>
  );
}
