import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import { PACKAGING_TYPES, PACKAGING_TYPE_LABELS, FREIGHT_CLASSES } from '@/lib/rfqs/freight-detail';
import { Breadcrumb } from '../../_components/breadcrumb';
import { ActionForm } from '../../_components/action-form';
import { SubmitButton } from '../../_components/submit-button';
import { createRfq } from '../actions';

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

      <ActionForm action={createRfq} className="panel mt-6 p-6 space-y-4 max-w-2xl">
        <input type="hidden" name="orgId" value={active.orgId} />
        {!isShipper && (
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
        )}
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

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1">Packaging type</label>
            <select name="packagingType" className="input">
              <option value="">—</option>
              {PACKAGING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PACKAGING_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Piece count</label>
            <input type="number" min="0" step="1" name="pieceCount" className="input" />
          </div>
          <div>
            <label className="block text-sm mb-1">Package count</label>
            <input type="number" min="0" step="1" name="packageCount" className="input" />
          </div>
        </div>

        {/* step="0.01" (hundredths) suits typical freight weights/dimensions
            entered in lb/kg/in/cm — if a future need requires finer precision
            (e.g. lab-grade or very small parts), revisit this alongside the DB
            columns' `numeric` (unconstrained scale) storage, which already
            supports more decimal places than the UI currently allows in. */}
        <div>
          <label className="block text-sm mb-1">Gross weight</label>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0" step="0.01" name="grossWeightValue" className="input" />
            <select name="grossWeightUnit" defaultValue="lb" className="input">
              <option value="lb">LB</option>
              <option value="kg">KG</option>
            </select>
          </div>
        </div>

        {/* L/W/H are each independently optional by design (a broker may only
            know one dimension so far) — not a bug. See
            0010_rfq_freight_details.sql's header comment and
            rfqs/[id]/page.tsx's formatDimensions() for how a partial fill is
            displayed. No all-or-nothing validation is applied here or
            server-side. */}
        <div>
          <label className="block text-sm mb-1">Dimensions (L × W × H)</label>
          <div className="grid grid-cols-4 gap-2">
            <input type="number" min="0" step="0.01" name="lengthValue" placeholder="Length" className="input" />
            <input type="number" min="0" step="0.01" name="widthValue" placeholder="Width" className="input" />
            <input type="number" min="0" step="0.01" name="heightValue" placeholder="Height" className="input" />
            <select name="dimensionUnit" defaultValue="in" className="input">
              <option value="in">IN</option>
              <option value="cm">CM</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">NMFC code</label>
            <input
              name="nmfcCode"
              placeholder="e.g. 156600 or 156600-01"
              pattern="[\d\s-]+"
              title="Digits, spaces, or hyphens only"
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Freight class</label>
            <select name="freightClass" className="input">
              <option value="">—</option>
              {FREIGHT_CLASSES.map((c) => (
                <option key={c} value={c}>
                  Class {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">Pickup date/time</label>
          <input type="datetime-local" name="pickupAt" className="input" />
        </div>

        <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
          Create RFQ
        </SubmitButton>
      </ActionForm>
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
