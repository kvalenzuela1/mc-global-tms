import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { RFQ_STATUS_SEQUENCE, RFQ_STATUS_LABELS, type RfqStatus } from '@/lib/rfqs/lifecycle';
import { PACKAGING_TYPE_LABELS, type PackagingType } from '@/lib/rfqs/freight-detail';
import { Breadcrumb } from '../../_components/breadcrumb';
import { LifecycleTimeline } from '../../_components/lifecycle-timeline';
import { StatusBadge, STATUS_FACET } from '../../_components/status-badge';

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
  packaging_type: PackagingType | null;
  piece_count: number | null;
  package_count: number | null;
  gross_weight_value: number | null;
  gross_weight_unit: string;
  length_value: number | null;
  width_value: number | null;
  height_value: number | null;
  dimension_unit: string;
  nmfc_code: string | null;
  freight_class: number | null;
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

/**
 * L/W/H are optional independently (a broker may only know the length so
 * far) — showing "123 × — × —" for a partial entry reads like missing data
 * rather than an intentional partial measurement, so a partial fill gets
 * explicit L/W/H labels instead of the compact "×" form.
 */
function formatDimensions(detail: RfqDetail): string {
  const { length_value: l, width_value: w, height_value: h, dimension_unit: unit } = detail;
  if (l == null && w == null && h == null) return '—';
  if (l != null && w != null && h != null) {
    return `${l} × ${w} × ${h} ${unit.toUpperCase()}`;
  }
  const parts: string[] = [];
  if (l != null) parts.push(`L ${l}`);
  if (w != null) parts.push(`W ${w}`);
  if (h != null) parts.push(`H ${h}`);
  return `${parts.join(', ')} ${unit.toUpperCase()}`;
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
      'id, origin, destination, service_type, status, freight_details, pickup_at, created_at, shippers(name), ' +
        'packaging_type, piece_count, package_count, gross_weight_value, gross_weight_unit, ' +
        'length_value, width_value, height_value, dimension_unit, nmfc_code, freight_class',
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
      <Breadcrumb
        trail={[
          { label: 'RFQs', href: '/portal/rfqs' },
          { label: `${detail.origin} → ${detail.destination}` },
        ]}
      />

      <div className="flex items-start justify-between gap-4 mt-3">
        <div>
          <h1 className="text-2xl font-bold">
            {detail.origin} → {detail.destination}
          </h1>
          <p className="text-muted mt-1">
            {detail.shippers?.name ?? 'No shipper assigned'} · {detail.service_type}
          </p>
        </div>
        <StatusBadge facet={STATUS_FACET.RFQ} value={detail.status} className="whitespace-nowrap" />
      </div>

      <div className="panel mt-6 p-6">
        <LifecycleTimeline
          sequence={RFQ_STATUS_SEQUENCE}
          labels={RFQ_STATUS_LABELS}
          current={detail.status}
        />
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
              <dt className="text-muted">Packaging</dt>
              <dd className="text-right">
                {detail.packaging_type ? PACKAGING_TYPE_LABELS[detail.packaging_type] : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Pieces / Packages</dt>
              <dd className="text-right">
                {detail.piece_count ?? '—'} / {detail.package_count ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Gross weight</dt>
              <dd className="text-right">
                {detail.gross_weight_value != null
                  ? `${detail.gross_weight_value} ${detail.gross_weight_unit.toUpperCase()}`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Dimensions (L × W × H)</dt>
              <dd className="text-right">{formatDimensions(detail)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">NMFC code</dt>
              <dd className="text-right">{detail.nmfc_code ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Freight class</dt>
              <dd className="text-right">{detail.freight_class != null ? `Class ${detail.freight_class}` : '—'}</dd>
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
                    <StatusBadge facet={STATUS_FACET.QUOTE} value={q.status} />
                  </Link>
                  {q.is_override && (
                    <p className="text-muted text-xs mt-1">Override: {q.override_reason}</p>
                  )}
                  {load && (
                    <p className="text-xs mt-1">
                      <Link href={`/portal/loads/${load.id}`} className="text-copper-400 hover:text-copper-300">
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
