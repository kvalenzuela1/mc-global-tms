import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { StatusBadge, STATUS_FACET } from '../_components/status-badge';

/**
 * Quotes list (WORKFLOW-REDESIGN §1.2 / §6, task B5). Quotes were previously
 * reachable only by drilling into an RFQ; this is the browse view. Rows link to
 * /portal/quotes/[id]. Quotes are broker-org commercial data (RLS same shape as
 * pricing), so this is PRICING_VIEW-gated and org-scoped.
 *
 * Kept to the same simple-table shape as the RFQ/Loads lists for now; the richer
 * §6 affordances (filters, search, server-side pagination, saved views) aren't
 * on any list yet and are a separate, cross-list task.
 */

interface QuoteRow {
  id: string;
  status: string;
  shipper_price_cents: number;
  margin_amount_cents: number;
  margin_percent: number;
  is_override: boolean;
  load_id: string | null;
  created_at: string;
  rfqs: { origin: string; destination: string } | null;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function QuotesPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.PRICING_VIEW)) {
    return <NotAuthorized />;
  }

  const canCreate = can(active.role, PERMISSIONS.QUOTE_CREATE);
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('quotes')
    .select(
      'id, status, shipper_price_cents, margin_amount_cents, margin_percent, is_override, load_id, created_at, rfqs(origin, destination)',
    )
    .eq('org_id', active.orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const quotes = (data as unknown as QuoteRow[]) ?? [];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Quotes</h1>
          <p className="text-muted mt-1">Priced quotes across all RFQs, newest first.</p>
        </div>
        {canCreate && (
          <Link href="/portal/pricing" className="btn-copper px-4 py-2 whitespace-nowrap">
            New quote
          </Link>
        )}
      </div>

      <div className="panel mt-6 p-6">
        <table className="w-full text-sm">
          <thead className="text-muted text-left">
            <tr className="border-b border-line">
              <th className="pb-2">Lane</th>
              <th className="pb-2">Shipper price</th>
              <th className="pb-2">Margin</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const overridePending = q.is_override && q.status === 'pending_approval';
              return (
                <tr key={q.id} className="table-row border-t border-line">
                  <td className="py-2">
                    <Link href={`/portal/quotes/${q.id}`} className="hover:text-copper-400">
                      {q.rfqs ? `${q.rfqs.origin} → ${q.rfqs.destination}` : 'Ad-hoc quote'}
                    </Link>
                    {overridePending && (
                      <span
                        className="text-warn ml-2 inline-flex items-center gap-1 text-xs"
                        title="Pricing override awaiting approval"
                      >
                        <AlertTriangle size={12} strokeWidth={2} />
                        override
                      </span>
                    )}
                  </td>
                  <td className="py-2">{money(q.shipper_price_cents)}</td>
                  <td className="py-2">
                    {money(q.margin_amount_cents)}{' '}
                    <span className="text-muted">({(q.margin_percent * 100).toFixed(1)}%)</span>
                  </td>
                  <td className="py-2">
                    <StatusBadge facet={STATUS_FACET.QUOTE} value={q.status} />
                  </td>
                  <td className="py-2 text-muted">{new Date(q.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-muted text-center">
                  No quotes yet. Price an RFQ from the{' '}
                  <Link href="/portal/pricing" className="text-copper-400 hover:text-copper-300">
                    Margin Calculator
                  </Link>
                  .
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
      <p className="mt-2 text-muted text-sm">Your role does not include access to quotes.</p>
    </div>
  );
}
