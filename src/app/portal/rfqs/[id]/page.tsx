import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { RFQ_STATUS_SEQUENCE, RFQ_STATUS_LABELS, type RfqStatus } from '@/lib/rfqs/lifecycle';

interface RfqDetail {
  id: string;
  origin: string;
  destination: string;
  service_type: string;
  status: RfqStatus;
  freight_details: string | null;
  pickup_at: string | null;
  created_at: string;
  shippers: { name: string } | null;
}

interface QuoteRow {
  id: string;
  status: string;
  shipper_price_cents: number;
  margin_amount_cents: number;
  margin_percent: number;
  is_override: boolean;
  override_reason: string | null;
  load_id: string | null;
  created_at: string;
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

function RfqTimeline({ status }: { status: RfqStatus }) {
  const currentIndex = RFQ_STATUS_SEQUENCE.indexOf(status);
  return (
    <div className="flex items-center">
      {RFQ_STATUS_SEQUENCE.map((stage, i) => (
        <div key={stage} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-2">
            <span
              className={`h-3 w-3 rounded-full ${i <= currentIndex ? 'bg-copper-500' : 'bg-charcoal-600'}`}
            />
            <span
              className={`text-xs whitespace-nowrap ${
                i === currentIndex ? 'text-ink font-semibold' : 'text-muted'
              }`}
            >
              {RFQ_STATUS_LABELS[stage]}
            </span>
          </div>
          {i < RFQ_STATUS_SEQUENCE.length - 1 && (
            <div className={`h-px flex-1 mx-2 mb-5 ${i < currentIndex ? 'bg-copper-500' : 'bg-line'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.RFQ_VIEW)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();
  const { data: rfq, error } = await supabase
    .from('rfqs')
    .select(
      'id, origin, destination, service_type, status, freight_details, pickup_at, created_at, shippers(name)',
    )
    .eq('id', id)
    .eq('org_id', active.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!rfq) notFound();
  const detail = rfq as unknown as RfqDetail;

  const { data: quoteData, error: quoteError } = await supabase
    .from('quotes')
    .select(
      'id, status, shipper_price_cents, margin_amount_cents, margin_percent, is_override, override_reason, load_id, created_at',
    )
    .eq('rfq_id', id)
    .eq('org_id', active.orgId)
    .order('created_at', { ascending: false });
  if (quoteError) throw quoteError;
  const quotes = (quoteData as QuoteRow[]) ?? [];

  const loadIds = quotes.map((q) => q.load_id).filter((v): v is string => v !== null);
  let loadsById = new Map<string, LoadRow>();
  if (loadIds.length > 0) {
    const { data: loadData, error: loadError } = await supabase
      .from('loads')
      .select('id, reference, status, carrier_name')
      .in('id', loadIds);
    if (loadError) throw loadError;
    loadsById = new Map(((loadData as LoadRow[]) ?? []).map((l) => [l.id, l]));
  }

  return (
    <div>
      <Link href="/portal/rfqs" className="text-sm text-muted hover:text-ink">
        ← Back to RFQs
      </Link>

      <div className="flex items-start justify-between gap-4 mt-3">
        <div>
          <h1 className="text-2xl font-bold">
            {detail.origin} → {detail.destination}
          </h1>
          <p className="text-muted mt-1">
            {detail.shippers?.name ?? 'No shipper assigned'} · {detail.service_type}
          </p>
        </div>
      </div>

      <div className="panel mt-6 p-6">
        <RfqTimeline status={detail.status} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <div className="panel p-6">
          <h2 className="font-semibold">RFQ details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Freight details</dt>
              <dd className="text-right">{detail.freight_details ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Pickup date/time</dt>
              <dd className="text-right">
                {detail.pickup_at ? new Date(detail.pickup_at).toLocaleString() : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Created</dt>
              <dd className="text-right">{new Date(detail.created_at).toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        <div className="panel p-6">
          <h2 className="font-semibold">Quotes</h2>
          {quotes.length === 0 && <p className="text-sm text-muted mt-2">No quotes yet.</p>}
          <ul className="mt-3 space-y-4">
            {quotes.map((q) => {
              const load = q.load_id ? loadsById.get(q.load_id) : null;
              return (
                <li key={q.id} className="table-row border-t border-line pt-3 pb-2 -mx-2 px-2 rounded-lg text-sm">
                  <Link href={`/portal/quotes/${q.id}`} className="flex items-center justify-between gap-3">
                    <p className="font-medium hover:text-copper-400">
                      ${(q.shipper_price_cents / 100).toFixed(2)} · margin $
                      {(q.margin_amount_cents / 100).toFixed(2)} ({(q.margin_percent * 100).toFixed(1)}%)
                    </p>
                    <span className={`badge ${quoteBadgeClass(q.status)}`}>{q.status}</span>
                  </Link>
                  {q.is_override && (
                    <p className="text-muted text-xs mt-1">Override: {q.override_reason}</p>
                  )}
                  {load && (
                    <p className="text-xs mt-1">
                      <Link href="/portal/loads" className="text-copper-400 hover:text-copper-300">
                        {load.reference}
                      </Link>{' '}
                      · {load.carrier_name ?? 'No carrier'} ·{' '}
                      <span className="text-muted">{load.status}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to RFQs.</p>
    </div>
  );
}
