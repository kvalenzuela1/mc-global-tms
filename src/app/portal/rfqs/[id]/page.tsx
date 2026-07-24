import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { RFQ_STATUS, RFQ_STATUS_SEQUENCE, RFQ_STATUS_LABELS, type RfqStatus } from '@/lib/rfqs/lifecycle';
import {
  PACKAGING_TYPE_LABELS,
  SHIPMENT_TYPE_LABELS,
  type PackagingType,
  type ShipmentType,
} from '@/lib/rfqs/freight-detail';
import { equipmentLabel, equipmentTypesByCategory } from '@/lib/rfqs/equipment';
import { resolveRfqRequiredAction } from '@/lib/workflow/required-action';
import { Breadcrumb } from '../../_components/breadcrumb';
import { ActionForm } from '../../_components/action-form';
import { SubmitButton } from '../../_components/submit-button';
import { LifecycleTimeline } from '../../_components/lifecycle-timeline';
import { RequiredActionRail } from '../../_components/required-action-rail';
import { StatusBadge, STATUS_FACET } from '../../_components/status-badge';
import { setRfqFreight } from './actions';

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
  equipment_type: string | null;
  commodity: string | null;
  // FR-RFQ-04 shipment-type fields
  shipment_type: ShipmentType | null;
  ship_from_name: string | null;
  ship_from_address: string | null;
  ship_from_city: string | null;
  ship_from_state: string | null;
  ship_from_zip: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  reference_number: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  delivery_at: string | null;
  acc_liftgate: boolean;
  acc_residential: boolean;
  acc_inside_pickup: boolean;
  acc_inside_delivery: boolean;
  acc_limited_access: boolean;
  is_hazmat: boolean;
  un_number: string | null;
  hazmat_class: string | null;
  temperature_f: number | null;
  trailer_size: string | null;
  pallet_count: number | null;
  stackable: boolean;
  linear_feet: number | null;
  freight_description: string | null;
}

interface HandlingUnitRow {
  id: string;
  position: number;
  length_in: number;
  width_in: number;
  height_in: number;
  weight_lb: number;
  unit_count: number;
  packaging_type: PackagingType;
  freight_class: number;
  freight_class_is_override: boolean;
  nmfc_code: string | null;
  stackable: boolean;
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
  const canManage = can(active.role, PERMISSIONS.RFQ_CREATE);

  const supabase = await getServerSupabase();
  const { data: rfq, error } = await supabase
    .from('rfqs')
    .select(
      'id, origin, destination, service_type, status, freight_details, pickup_at, created_at, shippers(name), ' +
        'packaging_type, piece_count, package_count, gross_weight_value, gross_weight_unit, ' +
        'length_value, width_value, height_value, dimension_unit, nmfc_code, freight_class, ' +
        'equipment_type, commodity, ' +
        'shipment_type, ship_from_name, ship_from_address, ship_from_city, ship_from_state, ship_from_zip, ' +
        'ship_to_name, ship_to_address, ship_to_city, ship_to_state, ship_to_zip, ' +
        'reference_number, pickup_window_start, pickup_window_end, delivery_at, ' +
        'acc_liftgate, acc_residential, acc_inside_pickup, acc_inside_delivery, acc_limited_access, ' +
        'is_hazmat, un_number, hazmat_class, temperature_f, trailer_size, ' +
        'pallet_count, stackable, linear_feet, freight_description',
    )
    .eq('id', id)
    .eq('org_id', active.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!rfq) notFound();
  const detail = rfq as unknown as RfqDetail;

  // LTL freight lives in the child table; other types have none.
  let handlingUnits: HandlingUnitRow[] = [];
  if (detail.shipment_type === 'ltl') {
    const { data: unitData, error: unitError } = await supabase
      .from('rfq_handling_units')
      .select(
        'id, position, length_in, width_in, height_in, weight_lb, unit_count, packaging_type, freight_class, freight_class_is_override, nmfc_code, stackable',
      )
      .eq('rfq_id', id)
      .order('position', { ascending: true });
    if (unitError) throw unitError;
    handlingUnits = (unitData as HandlingUnitRow[]) ?? [];
  }

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

  // §9 required-action rail. The RFQ resolver only describes the create-quote
  // step, so it's meaningful only while the RFQ is still open — once quoted or
  // booked, "what's next" belongs to the quote/load, reachable from the list.
  const requiredAction =
    detail.status === RFQ_STATUS.OPEN
      ? resolveRfqRequiredAction({
          weightLbs: detail.gross_weight_value,
          freightClass: detail.freight_class != null ? String(detail.freight_class) : null,
        })
      : null;

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
            {detail.shipment_type ? ` · ${SHIPMENT_TYPE_LABELS[detail.shipment_type]}` : ''}
          </p>
        </div>
        <StatusBadge facet={STATUS_FACET.RFQ} value={detail.status} className="whitespace-nowrap" />
      </div>

      <div className={`mt-6 grid gap-6 ${requiredAction ? 'lg:grid-cols-[1fr_320px]' : ''}`}>
        <div className="min-w-0 space-y-6">
          <div className="panel p-6">
            <LifecycleTimeline
              sequence={RFQ_STATUS_SEQUENCE}
              labels={RFQ_STATUS_LABELS}
              current={detail.status}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
        <div className="panel p-6">
          <h2 className="font-semibold">RFQ details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {detail.shipment_type && (
              <>
                <Row label="Ship From" value={formatAddress(detail.ship_from_name, detail.ship_from_city, detail.ship_from_state, detail.ship_from_zip)} />
                <Row label="Ship To" value={formatAddress(detail.ship_to_name, detail.ship_to_city, detail.ship_to_state, detail.ship_to_zip)} />
                <Row label="Reference / PO" value={detail.reference_number} />
                {(detail.pickup_window_start || detail.pickup_window_end) && (
                  <Row label="Pickup window" value={`${detail.pickup_window_start ?? '—'} – ${detail.pickup_window_end ?? '—'}`} />
                )}
                <Row label="Delivery date" value={detail.delivery_at ? new Date(detail.delivery_at).toLocaleDateString() : null} />
                {detail.shipment_type === 'ftl' && (
                  <>
                    <Row label="Trailer size" value={detail.trailer_size ? `${detail.trailer_size} ft` : null} />
                    {detail.equipment_type === 'reefer' && (
                      <Row label="Temperature" value={detail.temperature_f != null ? `${detail.temperature_f} °F` : null} />
                    )}
                    <Row label="Pallets" value={detail.pallet_count} />
                    <Row label="Stackable" value={detail.stackable ? 'Yes' : 'No'} />
                  </>
                )}
                {detail.shipment_type === 'ptl' && (
                  <>
                    <Row label="Linear feet" value={detail.linear_feet} />
                    <Row label="Pallets" value={detail.pallet_count} />
                    <Row label="Freight description" value={detail.freight_description} />
                    <Row label="Stackable" value={detail.stackable ? 'Yes' : 'No'} />
                  </>
                )}
                <Row label="Accessorials" value={activeAccessorials(detail)} />
                <Row
                  label="Hazmat"
                  value={detail.is_hazmat ? `Yes · UN ${detail.un_number ?? '—'} · Class ${detail.hazmat_class ?? '—'}` : 'No'}
                />
              </>
            )}
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
              <dt className="text-muted">Equipment</dt>
              <dd className="text-right">{detail.equipment_type ? equipmentLabel(detail.equipment_type) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Commodity</dt>
              <dd className="text-right">{detail.commodity ?? '—'}</dd>
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

          {detail.shipment_type === 'ltl' && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">Handling units</h3>
              {handlingUnits.length === 0 ? (
                <p className="text-sm text-muted mt-1">No handling units recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {handlingUnits.map((u, i) => (
                    <li key={u.id} className="text-sm border-t border-line pt-2">
                      <p className="font-medium">
                        Unit {i + 1} · {u.unit_count} × {PACKAGING_TYPE_LABELS[u.packaging_type]}
                      </p>
                      <p className="text-muted text-xs">
                        {u.length_in} × {u.width_in} × {u.height_in} in · {u.weight_lb} lb · Class {u.freight_class}
                        {u.freight_class_is_override ? ' (manual)' : ' (auto)'}
                        {u.nmfc_code ? ` · NMFC ${u.nmfc_code}` : ''}
                        {u.stackable ? ' · stackable' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canManage && (
            <ActionForm action={setRfqFreight} className="mt-6 border-t border-line pt-4 space-y-3">
              <input type="hidden" name="orgId" value={active.orgId} />
              <input type="hidden" name="rfqId" value={detail.id} />
              <h3 className="text-sm font-semibold">Equipment & commodity</h3>
              <div>
                <label className="block text-sm mb-1">Equipment type</label>
                <select name="equipmentType" className="input" defaultValue={detail.equipment_type ?? ''}>
                  <option value="">— None —</option>
                  {equipmentTypesByCategory().map((group) => (
                    <optgroup key={group.category} label={group.label}>
                      {group.types.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.def.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Commodity</label>
                <input
                  name="commodity"
                  defaultValue={detail.commodity ?? ''}
                  placeholder="e.g. Frozen poultry, steel coils"
                  className="input"
                />
              </div>
              <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </ActionForm>
          )}
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
        {requiredAction && <RequiredActionRail action={requiredAction} rfqId={detail.id} />}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value ?? '—'}</dd>
    </div>
  );
}

function formatAddress(name: string | null, city: string | null, state: string | null, zip: string | null): string {
  const line = [city, state].filter(Boolean).join(', ');
  const withZip = [line, zip].filter(Boolean).join(' ');
  return [name, withZip].filter(Boolean).join(' · ') || '—';
}

function activeAccessorials(detail: RfqDetail): string {
  const on: string[] = [];
  if (detail.acc_liftgate) on.push('Liftgate');
  if (detail.acc_residential) on.push('Residential');
  if (detail.acc_inside_pickup) on.push('Inside pickup');
  if (detail.acc_inside_delivery) on.push('Inside delivery');
  if (detail.acc_limited_access) on.push('Limited access');
  return on.length ? on.join(', ') : 'None';
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to RFQs.</p>
    </div>
  );
}
