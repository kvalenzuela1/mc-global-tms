import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { ROLE_LABELS } from '@/lib/rbac/roles';
import { can, permissionsFor, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { LOAD_STATUS, LOAD_STATUS_LABELS, type LoadStatus } from '@/lib/loads/lifecycle';

interface PriorityLoad {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
  carrier_name: string | null;
}

interface RecentRatecon {
  id: string;
  reference: string;
  status: string;
  content_snapshot: { origin?: string; destination?: string } | null;
}

const OK_STATUSES: LoadStatus[] = [LOAD_STATUS.DELIVERED, LOAD_STATUS.INVOICED, LOAD_STATUS.CLOSED];
const WARN_STATUSES: LoadStatus[] = [
  LOAD_STATUS.BOOKED,
  LOAD_STATUS.AWAITING_CARRIER_SIGNATURE,
  LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE,
];

function loadBadgeClass(status: LoadStatus): string {
  if (OK_STATUSES.includes(status)) return 'badge-ok';
  if (WARN_STATUSES.includes(status)) return 'badge-warn';
  return 'badge-muted';
}

function rateconBadgeClass(status: string): string {
  if (status === 'signed') return 'badge-ok';
  if (status === 'sent') return 'badge-warn';
  return 'badge-muted';
}

export default async function PortalOverview() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  const role = active.role;
  const canRfq = can(role, PERMISSIONS.RFQ_VIEW);
  const canPricing = can(role, PERMISSIONS.PRICING_VIEW);
  const canLoads = can(role, PERMISSIONS.LOAD_VIEW);
  const canRatecon = can(role, PERMISSIONS.RATECON_VIEW);
  const canSendRatecon = can(role, PERMISSIONS.RATECON_SEND);
  const canCreateRfq = can(role, PERMISSIONS.RFQ_CREATE);

  const hasDashboard = canRfq || canPricing || canLoads || canRatecon;

  if (!hasDashboard) {
    const perms = permissionsFor(role);
    return (
      <div>
        <h1 className="text-2xl font-bold">Today at a glance</h1>
        <p className="text-muted mt-1">
          Signed in as {ctx?.email} · {ROLE_LABELS[role]} · {active.orgName}
        </p>
        <div className="panel mt-6 p-6">
          <h2 className="font-semibold">Your permissions (server-enforced)</h2>
          <p className="text-sm text-muted mt-1">
            Your role does not include an operations dashboard. This confirms it
            resolves to the correct capability set.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {perms.map((p) => (
              <li key={p} className="rounded-md bg-charcoal-800 px-3 py-1.5">
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const supabase = await getServerSupabase();

  const tiles: { label: string; count: number; href: string }[] = [];

  if (canRfq) {
    const { count } = await supabase
      .from('rfqs')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', active.orgId)
      .eq('status', 'open');
    tiles.push({ label: 'Open RFQs', count: count ?? 0, href: '/portal/rfqs' });
  }

  if (canPricing) {
    const { count } = await supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', active.orgId)
      .eq('status', 'pending_approval');
    tiles.push({ label: 'Quotes awaiting approval', count: count ?? 0, href: '/portal/pricing' });
  }

  if (canSendRatecon) {
    const { count } = await supabase
      .from('loads_data')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', active.orgId)
      .eq('status', LOAD_STATUS.BOOKED)
      .not('carrier_id', 'is', null);
    tiles.push({ label: 'Booked, needs rate confirmation', count: count ?? 0, href: '/portal/ratecons' });
  }

  if (canRatecon) {
    // No org_id filter: RLS scopes rows to the broker org or the assigned
    // carrier, same reasoning as ratecons/page.tsx.
    const { count } = await supabase
      .from('rate_confirmations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent');
    tiles.push({ label: 'Awaiting carrier signature', count: count ?? 0, href: '/portal/ratecons' });
  }

  let priorityLoads: PriorityLoad[] = [];
  if (canLoads) {
    // No org_id filter: RLS's loads_select policy scopes rows by relationship
    // (broker member / assigned carrier / driver / shipper), same as
    // loads/page.tsx.
    const { data } = await supabase
      .from('loads')
      .select('id, reference, origin, destination, status, carrier_name')
      .not('status', 'in', `(${LOAD_STATUS.CLOSED},${LOAD_STATUS.INVOICED})`)
      .order('created_at', { ascending: false })
      .limit(6);
    priorityLoads = (data as PriorityLoad[]) ?? [];
  }

  let recentRatecons: RecentRatecon[] = [];
  if (canRatecon) {
    const { data } = await supabase
      .from('rate_confirmations')
      .select('id, reference, status, content_snapshot')
      .order('created_at', { ascending: false })
      .limit(5);
    recentRatecons = (data as RecentRatecon[]) ?? [];
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Operations overview</h1>
          <p className="text-muted mt-1">
            {today} · {ROLE_LABELS[role]} · {active.orgName}
          </p>
        </div>
        {canCreateRfq && (
          <Link href="/portal/rfqs" className="btn-copper px-4 py-2 text-sm whitespace-nowrap">
            + New RFQ
          </Link>
        )}
      </div>

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className="stat-tile p-5 block hover:border-copper-500/40">
              <p className="text-xs text-muted">{t.label}</p>
              <p className="text-3xl font-bold mt-2">{t.count}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        {canLoads && (
          <div className="panel p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Priority loads</h2>
              <Link href="/portal/loads" className="text-xs text-copper-400 hover:text-copper-300">
                View all →
              </Link>
            </div>
            {priorityLoads.length === 0 && (
              <p className="text-sm text-muted mt-3">No active loads right now.</p>
            )}
            <ul className="mt-3 space-y-3">
              {priorityLoads.map((l) => (
                <li key={l.id} className="border-t border-line pt-3 text-sm flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {l.reference} · {l.origin} → {l.destination}
                    </p>
                    <p className="text-muted text-xs mt-0.5">{l.carrier_name ?? 'No carrier assigned'}</p>
                  </div>
                  <span className={`badge ${loadBadgeClass(l.status)}`}>
                    {LOAD_STATUS_LABELS[l.status] ?? l.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canRatecon && (
          <div className="panel p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recent rate confirmations</h2>
              <Link href="/portal/ratecons" className="text-xs text-copper-400 hover:text-copper-300">
                Open →
              </Link>
            </div>
            {recentRatecons.length === 0 && (
              <p className="text-sm text-muted mt-3">None yet.</p>
            )}
            <ul className="mt-3 space-y-3">
              {recentRatecons.map((rc) => (
                <li key={rc.id} className="border-t border-line pt-3 text-sm flex items-center justify-between gap-3">
                  <p className="min-w-0">
                    {rc.reference} · {rc.content_snapshot?.origin} → {rc.content_snapshot?.destination}
                  </p>
                  <span className={`badge ${rateconBadgeClass(rc.status)}`}>{rc.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
