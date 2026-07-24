import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { resolveOrgLoadMarginConfig } from '@/lib/config/policies.server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { updateOrgMarginDefault, updateCustomerMargin } from './actions';

interface ShipperRow {
  id: string;
  name: string;
  broker_percent: number | null;
  dispatch_percent: number | null;
}

/** decimal 0.18 -> "18" for a 0-100 number input; null/undefined -> ''. */
function toPercentInput(decimal: number | null | undefined): string {
  if (typeof decimal !== 'number' || !Number.isFinite(decimal)) return '';
  return String(Number((decimal * 100).toFixed(2)));
}

export default async function SettingsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  // MARGIN_CONFIG = Owner + Broker only. Dispatchers/carriers never reach here.
  if (!can(active.role, PERMISSIONS.MARGIN_CONFIG)) {
    return <NotAuthorized />;
  }

  const orgDefault = await resolveOrgLoadMarginConfig(active.orgId);

  const supabase = await getServerSupabase();
  const { data: shipperData, error } = await supabase
    .from('shippers')
    .select('id, name, broker_percent, dispatch_percent')
    .eq('org_id', active.orgId)
    .order('name');
  if (error) throw error;
  const shippers = (shipperData as ShipperRow[]) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-muted mt-1">Default margins applied to new loads. Owner and Broker can edit.</p>

      <div className="panel mt-6 p-6 max-w-xl">
        <h2 className="font-semibold">House default margins</h2>
        <p className="text-xs text-muted mt-1">
          Applied to every new load unless the customer or the load itself overrides them.
        </p>
        <ActionForm action={updateOrgMarginDefault} className="mt-4 space-y-4">
          <input type="hidden" name="orgId" value={active.orgId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Broker %</label>
              <input
                name="brokerPercent"
                type="number"
                step="0.01"
                min="0"
                max="100"
                required
                defaultValue={toPercentInput(orgDefault.brokerPercent)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Dispatch %</label>
              <input
                name="dispatchPercent"
                type="number"
                step="0.01"
                min="0"
                max="100"
                required
                defaultValue={toPercentInput(orgDefault.dispatchPercent)}
                className="input"
              />
            </div>
          </div>
          <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
            Save house default
          </SubmitButton>
        </ActionForm>
      </div>

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">Per-customer default margins</h2>
        <p className="text-xs text-muted mt-1">
          Overrides the house default for that customer&apos;s new loads. Leave a field blank to inherit.
        </p>
        {shippers.length === 0 ? (
          <p className="text-sm text-muted mt-4">No customers yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {shippers.map((s) => (
              <li key={s.id} className="border-t border-line pt-4">
                <ActionForm action={updateCustomerMargin} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="orgId" value={active.orgId} />
                  <input type="hidden" name="shipperId" value={s.id} />
                  <div className="min-w-[12rem] flex-1">
                    <span className="block text-sm font-medium">{s.name}</span>
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Broker %</label>
                    <input
                      name="brokerPercent"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      placeholder="inherit"
                      defaultValue={toPercentInput(s.broker_percent)}
                      className="input w-28"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Dispatch %</label>
                    <input
                      name="dispatchPercent"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      placeholder="inherit"
                      defaultValue={toPercentInput(s.dispatch_percent)}
                      className="input w-28"
                    />
                  </div>
                  <SubmitButton className="btn-copper px-3 py-2 text-sm" pendingLabel="…">
                    Save
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role cannot edit margin settings.</p>
    </div>
  );
}
