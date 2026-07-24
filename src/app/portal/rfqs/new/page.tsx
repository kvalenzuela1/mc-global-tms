import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import { Breadcrumb } from '../../_components/breadcrumb';
import { RfqForm } from './rfq-form';

interface ShipperRow {
  id: string;
  name: string;
}

export default async function NewRfqPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.RFQ_CREATE)) {
    return <NotAuthorized />;
  }

  // A shipper submitting their own RFQ doesn't pick a shipper — they are one.
  const isShipper = active.role === ROLES.SHIPPER;
  let shippers: ShipperRow[] = [];
  if (!isShipper) {
    const supabase = await getServerSupabase();
    const { data } = await supabase
      .from('shippers')
      .select('id, name')
      .eq('org_id', active.orgId)
      .order('name');
    shippers = (data as ShipperRow[]) ?? [];
  }

  return (
    <div>
      <Breadcrumb trail={[{ label: 'RFQs', href: '/portal/rfqs' }, { label: 'New RFQ' }]} />

      <h1 className="text-2xl font-bold mt-3">New RFQ</h1>
      <p className="text-muted mt-1">Capture a shipper&apos;s request for quote.</p>

      <RfqForm orgId={active.orgId} shippers={shippers} hideShipperField={isShipper} />
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include creating RFQs.</p>
    </div>
  );
}
