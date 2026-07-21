import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { createRfq } from './actions';

interface RfqRow {
  id: string;
  origin: string;
  destination: string;
  service_type: string;
  status: string;
  freight_details: string | null;
  pickup_at: string | null;
}

interface ShipperRow {
  id: string;
  name: string;
}

function rfqBadgeClass(status: string): string {
  return status === 'open' ? 'badge-warn' : 'badge-muted';
}

export default async function RfqsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.RFQ_VIEW)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();
  const { data: rfqs, error } = await supabase
    .from('rfqs')
    .select('id, origin, destination, service_type, status, freight_details, pickup_at')
    .eq('org_id', active.orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const canCreate = can(active.role, PERMISSIONS.RFQ_CREATE);
  let shippers: ShipperRow[] = [];
  if (canCreate) {
    const { data } = await supabase
      .from('shippers')
      .select('id, name')
      .eq('org_id', active.orgId)
      .order('name');
    shippers = (data as ShipperRow[]) ?? [];
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">RFQs & Quotes</h1>
      <p className="text-muted mt-1">Requests for quote from shippers.</p>

      {canCreate && (
        <ActionForm action={createRfq} className="panel mt-6 p-6 space-y-4 max-w-xl">
          <input type="hidden" name="orgId" value={active.orgId} />
          <h2 className="font-semibold">New RFQ</h2>
          <div>
            <label className="block text-sm mb-1">Shipper</label>
            <select name="shipperId" className="input">
              <option value="">— Unassigned —</option>
              {shippers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Origin</label>
              <input name="origin" required className="input" />
            </div>
            <div>
              <label className="block text-sm mb-1">Destination</label>
              <input name="destination" required className="input" />
            </div>
          </div>
          <div>
            <label className="block text-sm mb-1">Freight details</label>
            <input name="freightDetails" placeholder="18,000 lbs · 26 pallets" className="input" />
          </div>
          <div>
            <label className="block text-sm mb-1">Pickup date/time</label>
            <input type="datetime-local" name="pickupAt" className="input" />
          </div>
          <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
            Create RFQ
          </SubmitButton>
        </ActionForm>
      )}

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
                  <span className={`badge ${rfqBadgeClass(r.status)}`}>{r.status}</span>
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
