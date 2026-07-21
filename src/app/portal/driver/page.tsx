import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { LOAD_STATUS, type LoadStatus } from '@/lib/loads/lifecycle';
import { ActionForm } from '../_components/action-form';
import { StatusBadge, STATUS_FACET } from '../_components/status-badge';
import { SubmitButton } from '../_components/submit-button';
import { acknowledgeLoad, recordMilestone } from './actions';

interface DriverLoad {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
  carrier_name: string | null;
}

interface MilestoneRow {
  id: string;
  load_id: string;
  kind: string;
  note: string | null;
  occurred_at: string;
}

const MILESTONE_KIND_LABELS: Record<string, string> = {
  pickup: 'Pickup',
  check_call: 'Check call',
  in_transit: 'In transit',
  delivery: 'Delivery',
  exception: 'Exception',
};

export default async function DriverBriefPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active || !ctx) return null;

  if (!can(active.role, PERMISSIONS.DRIVER_BRIEF_VIEW)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, name')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (driverError) throw driverError;

  if (!driver) {
    return (
      <div className="panel p-8 max-w-lg">
        <h1 className="text-xl font-bold">No driver profile found</h1>
        <p className="mt-2 text-muted text-sm">
          Contact your dispatcher to link your account to a driver record.
        </p>
      </div>
    );
  }

  // Reads the masked `loads` view (never loads_data directly) — same
  // defense-in-depth as loads/page.tsx: a driver never sees commercial data
  // regardless of what this page's own code does or doesn't render.
  const { data: loadData, error: loadsError } = await supabase
    .from('loads')
    .select('id, reference, origin, destination, status, carrier_name')
    .eq('driver_id', driver.id)
    .order('created_at', { ascending: false });
  if (loadsError) throw loadsError;
  const loads = (loadData as unknown as DriverLoad[]) ?? [];

  const loadIds = loads.map((l) => l.id);
  const milestonesByLoad = new Map<string, MilestoneRow[]>();
  if (loadIds.length > 0) {
    const { data: milestoneData, error: milestonesError } = await supabase
      .from('milestones')
      .select('id, load_id, kind, note, occurred_at')
      .in('load_id', loadIds)
      .order('occurred_at', { ascending: false });
    if (milestonesError) throw milestonesError;
    for (const m of (milestoneData as MilestoneRow[]) ?? []) {
      const list = milestonesByLoad.get(m.load_id) ?? [];
      list.push(m);
      milestonesByLoad.set(m.load_id, list);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Driver Brief</h1>
      <p className="text-muted mt-1">Your assigned loads — {driver.name}.</p>

      <div className="mt-6 space-y-6">
        {loads.map((l) => {
          const history = milestonesByLoad.get(l.id) ?? [];
          return (
            <div key={l.id} className="panel p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{l.reference}</h2>
                  <p className="text-sm text-muted mt-0.5">
                    {l.origin} → {l.destination} · Carrier: {l.carrier_name ?? '—'}
                  </p>
                </div>
                <StatusBadge facet={STATUS_FACET.LOAD} value={l.status} />
              </div>

              {l.status === LOAD_STATUS.RELEASED_TO_DRIVER && (
                <ActionForm action={acknowledgeLoad} className="mt-4">
                  <input type="hidden" name="orgId" value={active.orgId} />
                  <input type="hidden" name="loadId" value={l.id} />
                  <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Acknowledging…">
                    Acknowledge load
                  </SubmitButton>
                </ActionForm>
              )}

              <ActionForm action={recordMilestone} className="mt-4 space-y-3 border-t border-line pt-4">
                <input type="hidden" name="orgId" value={active.orgId} />
                <input type="hidden" name="loadId" value={l.id} />
                <h3 className="text-sm font-semibold">Record a milestone</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select name="kind" required className="input">
                    <option value="">Select type</option>
                    {Object.entries(MILESTONE_KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input name="note" placeholder="Optional note" className="input" />
                </div>
                <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
                  Log milestone
                </SubmitButton>
              </ActionForm>

              {history.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <h3 className="text-sm font-semibold">History</h3>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {history.map((m) => (
                      <li key={m.id}>
                        {new Date(m.occurred_at).toLocaleString()} — {MILESTONE_KIND_LABELS[m.kind] ?? m.kind}
                        {m.note ? `: ${m.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}

        {loads.length === 0 && (
          <div className="panel p-8 text-center text-muted">No loads assigned to you yet.</div>
        )}
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to the Driver Brief.</p>
    </div>
  );
}
