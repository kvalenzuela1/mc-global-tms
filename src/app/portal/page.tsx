import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { ROLE_LABELS, isInternalRole } from '@/lib/rbac/roles';
import { can, permissionsFor, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { LOAD_STATUS, LOAD_STATUS_LABELS, LOAD_STATUS_SEQUENCE, type LoadStatus } from '@/lib/loads/lifecycle';
import { RFQ_STATUS_LABELS, RFQ_STATUS_SEQUENCE, type RfqStatus } from '@/lib/rfqs/lifecycle';
import { ACCESSORIAL_TYPE_LABELS, type AccessorialType } from '@/lib/accessorials/calc';
import { getOrgComplianceResults } from '@/lib/compliance/policy.server';
import { StatusBadge, STATUS_FACET } from './_components/status-badge';
import { badgeClassFor } from '@/lib/ui/status-tone';
import { resolveLandingKind, LANDING_KIND } from '@/lib/portal/landing';

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

export default async function PortalOverview() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  const role = active.role;

  // FR-UX-03: route each role to a real home screen. Shipper and driver get
  // tailored landings instead of falling through to the permission list.
  const landing = resolveLandingKind(role);
  if (landing === LANDING_KIND.DRIVER) {
    return <DriverAppHome orgName={active.orgName} />;
  }
  if (landing === LANDING_KIND.SHIPPER) {
    return <ShipperHome orgName={active.orgName} />;
  }

  const canRfq = can(role, PERMISSIONS.RFQ_VIEW);
  const canPricing = can(role, PERMISSIONS.PRICING_VIEW);
  const canLoads = can(role, PERMISSIONS.LOAD_VIEW);
  const canRatecon = can(role, PERMISSIONS.RATECON_VIEW);
  const canSendRatecon = can(role, PERMISSIONS.RATECON_SEND);
  const canCreateRfq = can(role, PERMISSIONS.RFQ_CREATE);

  if (landing === LANDING_KIND.PERMISSIONS) {
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

  // FR-KPI-01: operations snapshot — RFQ funnel, load-status breakdown,
  // accessorial exceptions (30d), carrier compliance. Read-only rollups off
  // data that already exists; no new mutations. Dollar figures and carrier
  // compliance are gated the same way the rest of the portal already gates
  // commercial/compliance visibility (showCommercials / CARRIER_VIEW), not a
  // new permission.
  const showCommercials = isInternalRole(role);
  const canViewCarriers = can(role, PERMISSIONS.CARRIER_VIEW);

  const rfqFunnel: Record<string, number> = {};
  if (canRfq) {
    const { data } = await supabase.from('rfqs').select('status').eq('org_id', active.orgId);
    for (const row of (data as { status: string }[]) ?? []) {
      rfqFunnel[row.status] = (rfqFunnel[row.status] ?? 0) + 1;
    }
  }

  const loadStatusCounts: Record<string, number> = {};
  if (canLoads) {
    const { data } = await supabase.from('loads_data').select('status').eq('org_id', active.orgId);
    for (const row of (data as { status: string }[]) ?? []) {
      loadStatusCounts[row.status] = (loadStatusCounts[row.status] ?? 0) + 1;
    }
  }

  let accessorialBreakdown: { type: AccessorialType; count: number; totalCents: number }[] = [];
  if (showCommercials) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('accessorials')
      .select('type, amount_cents')
      .eq('org_id', active.orgId)
      .gte('created_at', thirtyDaysAgo);
    const byType = new Map<AccessorialType, { count: number; totalCents: number }>();
    for (const row of (data as { type: AccessorialType; amount_cents: number }[]) ?? []) {
      const existing = byType.get(row.type) ?? { count: 0, totalCents: 0 };
      byType.set(row.type, { count: existing.count + 1, totalCents: existing.totalCents + row.amount_cents });
    }
    accessorialBreakdown = Array.from(byType.entries()).map(([type, v]) => ({ type, ...v }));
  }

  let carrierCompliance: { compliant: number; blocked: number } | null = null;
  if (canViewCarriers) {
    const results = await getOrgComplianceResults(active.orgId);
    let compliant = 0;
    let blocked = 0;
    for (const result of results.values()) {
      if (result?.allowed) compliant++;
      else blocked++;
    }
    carrierCompliance = { compliant, blocked };
  }

  const hasOpsSnapshot = canRfq || canLoads || showCommercials || canViewCarriers;

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
                <li
                  key={l.id}
                  className="table-row border-t border-line pt-3 pb-1 -mx-2 px-2 rounded-lg text-sm flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {l.reference} · {l.origin} → {l.destination}
                    </p>
                    <p className="text-muted text-xs mt-0.5">{l.carrier_name ?? 'No carrier assigned'}</p>
                  </div>
                  <StatusBadge facet={STATUS_FACET.LOAD} value={l.status} />
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
                <li
                  key={rc.id}
                  className="table-row border-t border-line pt-3 pb-1 -mx-2 px-2 rounded-lg text-sm flex items-center justify-between gap-3"
                >
                  <p className="min-w-0">
                    {rc.reference} · {rc.content_snapshot?.origin} → {rc.content_snapshot?.destination}
                  </p>
                  <StatusBadge facet={STATUS_FACET.RATECON} value={rc.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {hasOpsSnapshot && (
        <div className="panel p-6 mt-6">
          <h2 className="font-semibold">Operations at a glance</h2>
          <p className="text-xs text-muted mt-1">Last 30 days where noted · read-only rollup</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-4">
            {canRfq && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">RFQ funnel</p>
                <dl className="mt-2 space-y-1 text-sm">
                  {RFQ_STATUS_SEQUENCE.map((status: RfqStatus) => (
                    <div key={status} className="flex justify-between gap-3">
                      <dt className="text-muted">{RFQ_STATUS_LABELS[status]}</dt>
                      <dd className="tabular-nums">{rfqFunnel[status] ?? 0}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {canLoads && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Loads by status</p>
                <dl className="mt-2 space-y-1 text-sm">
                  {LOAD_STATUS_SEQUENCE.filter((status) => (loadStatusCounts[status] ?? 0) > 0).map((status) => (
                    <div key={status} className="flex justify-between gap-3">
                      <dt className="text-muted">{LOAD_STATUS_LABELS[status]}</dt>
                      <dd className="tabular-nums">{loadStatusCounts[status]}</dd>
                    </div>
                  ))}
                  {Object.keys(loadStatusCounts).length === 0 && <p className="text-muted">No loads yet.</p>}
                </dl>
              </div>
            )}

            {showCommercials && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Accessorial exceptions</p>
                <dl className="mt-2 space-y-1 text-sm">
                  {accessorialBreakdown.map((row) => (
                    <div key={row.type} className="flex justify-between gap-3">
                      <dt className="text-muted">{ACCESSORIAL_TYPE_LABELS[row.type]}</dt>
                      <dd className="tabular-nums">
                        {row.count} · ${(row.totalCents / 100).toFixed(2)}
                      </dd>
                    </div>
                  ))}
                  {accessorialBreakdown.length === 0 && <p className="text-muted">None in the last 30 days.</p>}
                </dl>
              </div>
            )}

            {canViewCarriers && carrierCompliance && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Carrier compliance</p>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Compliant</dt>
                    <dd className="tabular-nums">
                      <span className={badgeClassFor(STATUS_FACET.COMPLIANCE, 'compliant')}>
                        {carrierCompliance.compliant}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Blocked</dt>
                    <dd className="tabular-nums">
                      <span className={badgeClassFor(STATUS_FACET.COMPLIANCE, 'blocked')}>
                        {carrierCompliance.blocked}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ShipperShipment {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
}

/**
 * Shipper home — the customer's tracking surface + a path to request a quote.
 * RLS scopes `loads` to this shipper's own shipments (app_shipper_user_can_access)
 * and the masked view nulls commercial_snapshot for non-broker orgs, so no rate
 * or margin leaks here.
 */
async function ShipperHome({ orgName }: { orgName: string }) {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from('loads')
    .select('id, reference, origin, destination, status')
    .order('created_at', { ascending: false })
    .limit(12);
  const shipments = (data as ShipperShipment[]) ?? [];

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Your shipments</h1>
          <p className="text-muted mt-1">
            {today} · {orgName}
          </p>
        </div>
        <Link href="/portal/rfqs/new" className="btn-copper px-4 py-2 text-sm whitespace-nowrap">
          + Request a quote
        </Link>
      </div>

      <div className="panel p-6 mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Tracking</h2>
          <Link href="/portal/documents" className="text-xs text-copper-400 hover:text-copper-300">
            Documents →
          </Link>
        </div>
        {shipments.length === 0 ? (
          <p className="text-sm text-muted mt-3">
            No shipments yet. Request a quote to get one moving.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {shipments.map((s) => (
              <li
                key={s.id}
                className="table-row border-t border-line pt-3 pb-1 -mx-2 px-2 rounded-lg text-sm flex items-center justify-between gap-3"
              >
                <p className="min-w-0 font-medium">
                  {s.reference} · {s.origin} → {s.destination}
                </p>
                <StatusBadge facet={STATUS_FACET.LOAD} value={s.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Driver home — a pointer, not a dashboard. Drivers work from the dedicated
 * mobile app (check-in/out, POD scanning, GPS); the web portal is for office
 * staff. Until the app ships, the Driver Brief remains their working surface.
 */
function DriverAppHome({ orgName }: { orgName: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">Welcome</h1>
      <p className="text-muted mt-1">Driver · {orgName}</p>
      <div className="panel p-6 mt-6 max-w-xl">
        <h2 className="font-semibold">Your loads live in the driver app</h2>
        <p className="text-sm text-muted mt-2">
          A dedicated MC Global driver app is on the way — check-in and check-out,
          document scanning, and load details, built for the road rather than the
          desk.
        </p>
        <p className="text-sm text-muted mt-3">
          In the meantime, your current assignment and paperwork are in your Driver
          Brief.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/portal/driver" className="btn-copper px-4 py-2 text-sm">
            Open Driver Brief
          </Link>
          <Link
            href="/portal/documents"
            className="rounded-[10px] border border-line px-4 py-2 text-sm text-ink"
          >
            Upload a document
          </Link>
        </div>
      </div>
    </div>
  );
}
