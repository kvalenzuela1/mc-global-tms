import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';

interface QuoteDetail {
  id: string;
  rfq_id: string | null;
  load_id: string | null;
  status: string;
  carrier_linehaul_cents: number;
  shipper_price_cents: number;
  margin_amount_cents: number;
  margin_percent: number;
  target_margin_percent: number;
  quick_pay_fee_percent: number;
  quick_pay_fee_cents: number;
  factoring_cost_percent: number;
  is_override: boolean;
  override_reason: string | null;
  override_approved_at: string | null;
  created_at: string;
  rfqs: { origin: string; destination: string } | null;
}

interface LoadRow {
  id: string;
  reference: string;
  status: string;
  carrier_name: string | null;
}

function quoteBadgeClass(status: string): string {
  if (status === 'approved') return 'badge-ok';
  if (status === 'pending_approval') return 'badge-warn';
  return 'badge-muted';
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.PRICING_VIEW)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();
  const { data: quote, error } = await supabase
    .from('quotes')
    .select(
      `id, rfq_id, load_id, status, carrier_linehaul_cents, shipper_price_cents,
       margin_amount_cents, margin_percent, target_margin_percent,
       quick_pay_fee_percent, quick_pay_fee_cents, factoring_cost_percent,
       is_override, override_reason, override_approved_at, created_at,
       rfqs(origin, destination)`,
    )
    .eq('id', id)
    .eq('org_id', active.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!quote) notFound();
  const detail = quote as unknown as QuoteDetail;

  let load: LoadRow | null = null;
  if (detail.load_id) {
    const { data: loadData, error: loadError } = await supabase
      .from('loads')
      .select('id, reference, status, carrier_name')
      .eq('id', detail.load_id)
      .maybeSingle();
    if (loadError) throw loadError;
    load = (loadData as LoadRow | null) ?? null;
  }

  return (
    <div>
      {detail.rfq_id ? (
        <Link href={`/portal/rfqs/${detail.rfq_id}`} className="text-sm text-muted hover:text-ink">
          ← Back to RFQ
        </Link>
      ) : (
        <Link href="/portal/rfqs" className="text-sm text-muted hover:text-ink">
          ← Back to RFQs
        </Link>
      )}

      <div className="flex items-start justify-between gap-4 mt-3">
        <div>
          <h1 className="text-2xl font-bold">
            {detail.rfqs ? `${detail.rfqs.origin} → ${detail.rfqs.destination}` : 'Quote'}
          </h1>
          <p className="text-muted mt-1">
            {money(detail.shipper_price_cents)} shipper price · created{' '}
            {new Date(detail.created_at).toLocaleString()}
          </p>
        </div>
        <span className={`badge ${quoteBadgeClass(detail.status)} whitespace-nowrap`}>{detail.status}</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <div className="panel p-6">
          <h2 className="font-semibold">Pricing breakdown</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Carrier linehaul</dt>
              <dd>{money(detail.carrier_linehaul_cents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Shipper price</dt>
              <dd>{money(detail.shipper_price_cents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Margin</dt>
              <dd>
                {money(detail.margin_amount_cents)} ({pct(detail.margin_percent)})
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Target margin</dt>
              <dd>{pct(detail.target_margin_percent)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Quick Pay fee</dt>
              <dd>
                {money(detail.quick_pay_fee_cents)} ({pct(detail.quick_pay_fee_percent)})
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Factoring cost</dt>
              <dd>{pct(detail.factoring_cost_percent)}</dd>
            </div>
          </dl>
        </div>

        <div className="panel p-6">
          <h2 className="font-semibold">Override & load</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Pricing override</dt>
              <dd>{detail.is_override ? 'Yes' : 'No'}</dd>
            </div>
            {detail.is_override && (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Reason</dt>
                  <dd className="text-right">{detail.override_reason ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Approved</dt>
                  <dd>
                    {detail.override_approved_at
                      ? new Date(detail.override_approved_at).toLocaleString()
                      : 'Not yet'}
                  </dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-4 border-t border-line pt-3">
              <dt className="text-muted">Load</dt>
              <dd className="text-right">
                {load ? (
                  <>
                    <Link href="/portal/loads" className="text-copper-400 hover:text-copper-300">
                      {load.reference}
                    </Link>{' '}
                    · {load.carrier_name ?? 'No carrier'} · {load.status}
                  </>
                ) : (
                  'Not booked yet'
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to pricing.</p>
    </div>
  );
}
