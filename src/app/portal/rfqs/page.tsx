import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import { RFQ_STATUS, RFQ_STATUS_LABELS, type RfqStatus } from '@/lib/rfqs/lifecycle';
import { NewRfqModal } from './new-rfq-modal';

interface RfqRow {
  id: string;
  origin: string;
  destination: string;
  service_type: string;
  status: RfqStatus;
  freight_details: string | null;
  pickup_at: string | null;
}

interface ShipperRow {
  id: string;
  name: string;
}

function rfqBadgeClass(status: RfqStatus): string {
  if (status === RFQ_STATUS.CLOSED) return 'badge-ok';
  if (status === RFQ_STATUS.QUOTED) return 'badge-muted';
  return 'badge-warn'; // open (needs a quote), booked (active load in motion)
}

export default async function RfqsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.RFQ_VIEW) && !can(active.role, PERMISSIONS.RFQ_CREATE)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();
  // No org_id filter: for a shipper, active.orgId is THEIR own org, not the
  // broker tenant rfqs.org_id stores — RLS's app_shipper_user_can_access
  // carve-out scopes it correctly instead (same "let RLS scope it" pattern
  // as loads/page.tsx).
  const { data: rfqs, error } = await supabase
    .from('rfqs')
    .select('id, origin, destination, service_type, status, freight_details, pickup_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const canCreate = can(active.role, PERMISSIONS.RFQ_CREATE);
  const isShipper = active.role === ROLES.SHIPPER;
  let shippers: ShipperRow[] = [];
  if (canCreate && !isShipper) {
    const { data } = await supabase
      .from('shippers')
      .select('id, name')
      .eq('org_id', active.orgId)
      .order('name');
    shippers = (data as ShipperRow[]) ?? [];
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">RFQs & Quotes</h1>
          <p className="text-muted mt-1">Requests for quote from shippers.</p>
        </div>
        {canCreate && (
          <NewRfqModal orgId={active.orgId} shippers={shippers} hideShipperField={isShipper} />
        )}
      </div>

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">Open RFQs</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-muted text-left">
            <tr className="border-b border-line">
              <th className="pb-2">Lane</th>
              <th className="pb-2">Service</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Pickup</th>
            </tr>
          </thead>
          <tbody>
            {((rfqs as RfqRow[]) ?? []).map((r) => (
              <tr key={r.id} className="table-row border-t border-line">
                <td className="py-2">
                  {r.origin} → {r.destination}
                </td>
                <td className="py-2">{r.service_type}</td>
                <td className="py-2">
                  <span className={`badge ${rfqBadgeClass(r.status)}`}>
                    {RFQ_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
                <td className="py-2">{r.pickup_at ? new Date(r.pickup_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {(rfqs ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-muted text-center">
                  No RFQs yet.
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
      <p className="mt-2 text-muted text-sm">Your role does not include access to RFQs.</p>
    </div>
  );
}
