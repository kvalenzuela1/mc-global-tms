import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { isInternalRole } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import {
  LOAD_STATUS,
  LOAD_STATUS_LABELS,
  LOAD_STATUS_SEQUENCE,
  nextStatuses,
  type LoadStatus,
} from '@/lib/loads/lifecycle';
import { readSnapshotCents } from '@/lib/pricing/snapshot';
import { getCarrierComplianceResult } from '@/lib/compliance/policy.server';
import { type ComplianceResult } from '@/lib/compliance/gate';
import { resolveLoadRequiredAction } from '@/lib/workflow/required-action';
import {
  ACCESSORIAL_TYPE,
  ACCESSORIAL_TYPE_LABELS,
  BILLABLE_TO,
  BILLABLE_TO_LABELS,
} from '@/lib/accessorials/calc';
import { Breadcrumb } from '../../_components/breadcrumb';
import { ActionForm } from '../../_components/action-form';
import { SubmitButton } from '../../_components/submit-button';
import { LifecycleTimeline } from '../../_components/lifecycle-timeline';
import { RequiredActionRail } from '../../_components/required-action-rail';
import { StatusBadge, STATUS_FACET } from '../../_components/status-badge';
import { advanceLoadStatus, addAccessorial } from '../actions';

// The rail is shown only for the window where the §9 load resolver maps
// faithfully to a real Phase-1 next step. Draft/quoted are excluded — the
// resolver's next step there is "assign carrier", but this app books a load
// (with a carrier already attached) straight into 'quoted' and advances it to
// 'booked' via the on-page form, so the resolver would mislead. Delivered
// onward is M6 (invoicing/settlement) with no route yet.
const RAIL_STATUSES = new Set<LoadStatus>([
  LOAD_STATUS.BOOKED,
  LOAD_STATUS.AWAITING_CARRIER_SIGNATURE,
  LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE,
  LOAD_STATUS.RELEASED_TO_DRIVER,
  LOAD_STATUS.DRIVER_ACKNOWLEDGED,
  LOAD_STATUS.DISPATCHED,
  LOAD_STATUS.IN_TRANSIT,
]);

// These two steps only happen through the rate-confirmation flow
// (sendRatecon/signRatecon) — offering them in the generic advance dropdown
// would just error (see loads/actions.ts's advanceLoadStatus guard).
const MANAGED_ELSEWHERE = new Set<LoadStatus>([
  LOAD_STATUS.AWAITING_CARRIER_SIGNATURE,
  LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE,
]);

interface LoadDetail {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
  commercial_snapshot: Record<string, unknown> | null;
  carrier_id: string | null;
  carrier_name: string | null;
  driver_id: string | null;
  rfq_id: string | null;
  created_at: string;
}

interface AccessorialRow {
  id: string;
  type: string;
  amount_cents: number;
  billable_to: string;
  description: string | null;
  created_at: string;
}

interface SourceQuoteRow {
  id: string;
  rfq_id: string | null;
  margin_amount_cents: number;
  margin_percent: number;
}

export default async function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.LOAD_VIEW) && !can(active.role, PERMISSIONS.SHIPPER_TRACK)) {
    return <NotAuthorized />;
  }

  const showCommercials = isInternalRole(active.role);
  const canAdvance = can(active.role, PERMISSIONS.LOAD_TRANSITION);
  const canEditAccessorials = can(active.role, PERMISSIONS.LOAD_EDIT);

  const supabase = await getServerSupabase();

  // No org_id filter: same relationship-based RLS scoping as the loads list —
  // for external roles active.orgId is their own org, not the broker tenant's.
  const { data: loadData, error } = await supabase
    .from('loads')
    .select(
      'id, reference, origin, destination, status, commercial_snapshot, carrier_id, carrier_name, driver_id, rfq_id, created_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!loadData) notFound();
  const load = loadData as unknown as LoadDetail;

  // Accessorials + source quote + carrier compliance are all broker-org
  // commercial data (same RLS shape as quotes) — the showCommercials gate is
  // belt-and-suspenders on top of that, same reasoning as the loads list.
  let accessorials: AccessorialRow[] = [];
  let sourceQuote: SourceQuoteRow | null = null;
  let carrierAllowed: boolean | null = null;
  let compliance: ComplianceResult | null = null;
  let carrierStatus: string | null = null;
  let rateconSigned = false;
  if (showCommercials) {
    const { data: accessorialData } = await supabase
      .from('accessorials')
      .select('id, type, amount_cents, billable_to, description, created_at')
      .eq('org_id', active.orgId)
      .eq('load_id', id)
      .order('created_at', { ascending: false });
    accessorials = (accessorialData as AccessorialRow[]) ?? [];

    const { data: quoteData } = await supabase
      .from('quotes')
      .select('id, rfq_id, margin_amount_cents, margin_percent')
      .eq('org_id', active.orgId)
      .eq('load_id', id)
      .maybeSingle();
    sourceQuote = (quoteData as SourceQuoteRow | null) ?? null;

    if (load.carrier_id) {
      compliance = (await getCarrierComplianceResult(active.orgId, load.carrier_id)) ?? null;
      carrierAllowed = compliance?.allowed ?? false;
      const { data: carrierRow } = await supabase
        .from('carriers')
        .select('status')
        .eq('id', load.carrier_id)
        .maybeSingle();
      carrierStatus = (carrierRow as { status: string } | null)?.status ?? null;
    }

    // Same signed-rate-con check advanceLoadStatus gates release on — so the
    // rail's RATECON_NOT_SIGNED blocker and the server enforcement agree.
    const { data: signedRc } = await supabase
      .from('rate_confirmations')
      .select('id')
      .eq('load_id', id)
      .eq('status', 'signed')
      .limit(1)
      .maybeSingle();
    rateconSigned = Boolean(signedRc);
  }

  const margin = showCommercials
    ? readSnapshotCents(load.commercial_snapshot, 'marginAmountCents', 'margin_amount_cents')
    : undefined;
  const accessorialTotalCents = accessorials.reduce((sum, a) => sum + a.amount_cents, 0);

  const rawNext = nextStatuses(load.status);
  const next = rawNext.filter((s) => !MANAGED_ELSEWHERE.has(s));
  const isManagedElsewhere = rawNext.length > 0 && next.length === 0;

  // The RFQ crumb prefers the source quote's rfq_id, falling back to the
  // load's own — a load booked from a quote has both; a directly-created one
  // may only have the latter.
  const rfqId = sourceQuote?.rfq_id ?? load.rfq_id;

  // §9 required-action rail. Shown to internal roles only (same gate as the
  // carrier-compliance data it depends on) and only across the status window
  // where the resolver maps faithfully (RAIL_STATUSES).
  const requiredAction =
    showCommercials && RAIL_STATUSES.has(load.status)
      ? resolveLoadRequiredAction({
          status: load.status,
          carrier: load.carrier_id
            ? {
                name: load.carrier_name ?? 'Assigned carrier',
                suspended: carrierStatus === 'suspended',
                compliance: compliance
                  ? { allowed: compliance.allowed, blockingReasons: compliance.blockingReasons }
                  : null,
                // Coverage adequacy is already reflected in `compliance`; the
                // standalone expiry-date warning isn't separately surfaced here.
                insuranceExpiry: null,
              }
            : null,
          driverAssigned: load.driver_id !== null,
          rateconSigned,
          hasPickupAddress: load.origin.trim() !== '',
          hasDeliveryAddress: load.destination.trim() !== '',
          // Facts the Phase-1 schema doesn't model yet are passed satisfied so
          // the rail matches what advanceLoadStatus actually enforces (legal
          // transition + signed rate-con + carrier compliance at release).
          // Gating on structured stops, appointments, POD and billing is future
          // work as those fields land (M6).
          deliveryAppointmentRequired: false,
          deliveryAppointmentAt: null,
          receiverName: 'n/a',
          hasPod: true,
          podVerified: true,
          hasCarrierInvoice: true,
          customerBillingEmail: 'n/a',
          customerPaymentTerms: 'n/a',
          openExceptionCount: 0,
          asOf: new Date(),
        })
      : null;

  return (
    <div>
      <Breadcrumb
        trail={[{ label: 'Loads', href: '/portal/loads' }, { label: load.reference }]}
      />

      <div className="flex items-start justify-between gap-4 mt-3">
        <div>
          <h1 className="text-2xl font-bold">{load.reference}</h1>
          <p className="text-muted mt-1">
            {load.origin} → {load.destination} · {load.carrier_name ?? 'No carrier assigned'}
          </p>
        </div>
        <StatusBadge facet={STATUS_FACET.LOAD} value={load.status} className="whitespace-nowrap" />
      </div>

      <div className={`mt-6 grid gap-6 ${requiredAction ? 'lg:grid-cols-[1fr_320px]' : ''}`}>
        <div className="min-w-0 space-y-6">
          <div className="panel p-6 overflow-x-auto">
            <LifecycleTimeline
              sequence={LOAD_STATUS_SEQUENCE}
              labels={LOAD_STATUS_LABELS}
              current={load.status}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
        <div className="panel p-6">
          <h2 className="font-semibold">Load details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Lane</dt>
              <dd className="text-right">
                {load.origin} → {load.destination}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Carrier</dt>
              <dd className="text-right">
                {load.carrier_name ?? '—'}
                {carrierAllowed !== null && (
                  <span className={`ml-2 text-xs ${carrierAllowed ? 'text-muted' : 'text-danger'}`}>
                    {carrierAllowed ? 'Compliant' : 'Blocked'}
                  </span>
                )}
              </dd>
            </div>
            {showCommercials && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Margin</dt>
                <dd className="text-right">
                  {typeof margin === 'number' ? `$${(margin / 100).toFixed(2)}` : '—'}
                  {sourceQuote && (
                    <span className="text-muted"> ({(sourceQuote.margin_percent * 100).toFixed(1)}%)</span>
                  )}
                </dd>
              </div>
            )}
            {showCommercials && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Source quote</dt>
                <dd className="text-right">
                  {sourceQuote ? (
                    <Link
                      href={`/portal/quotes/${sourceQuote.id}`}
                      className="text-copper-400 hover:text-copper-300"
                    >
                      View quote
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            )}
            {rfqId && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">RFQ</dt>
                <dd className="text-right">
                  <Link href={`/portal/rfqs/${rfqId}`} className="text-copper-400 hover:text-copper-300">
                    View RFQ
                  </Link>
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Created</dt>
              <dd className="text-right">{new Date(load.created_at).toLocaleString()}</dd>
            </div>
          </dl>

          {canAdvance && (
            <div className="mt-6 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">Advance status</h3>
              {next.length > 0 ? (
                <ActionForm action={advanceLoadStatus} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="orgId" value={active.orgId} />
                  <input type="hidden" name="loadId" value={load.id} />
                  <select name="to" className="input py-1 text-sm">
                    {next.map((s) => (
                      <option key={s} value={s}>
                        {LOAD_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <SubmitButton className="btn-copper px-3 py-1 text-sm" pendingLabel="…">
                    Advance
                  </SubmitButton>
                </ActionForm>
              ) : isManagedElsewhere ? (
                <p className="mt-2 text-sm text-muted">
                  The next step happens through{' '}
                  <Link href="/portal/ratecons" className="text-copper-400 hover:text-copper-300">
                    Rate Confirmations
                  </Link>
                  .
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted">This load has reached its final status.</p>
              )}
            </div>
          )}
        </div>

        {showCommercials && (
          <div className="panel p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold">Accessorials</h2>
              <span className="text-sm text-muted">
                {accessorials.length} · ${(accessorialTotalCents / 100).toFixed(2)}
              </span>
            </div>

            {accessorials.length === 0 ? (
              <p className="text-sm text-muted mt-3">No accessorial charges on this load.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {accessorials.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 border-t border-line pt-2"
                  >
                    <div>
                      <p className="font-medium">{ACCESSORIAL_TYPE_LABELS[a.type as keyof typeof ACCESSORIAL_TYPE_LABELS] ?? a.type}</p>
                      <p className="text-xs text-muted">
                        Billable to {BILLABLE_TO_LABELS[a.billable_to as keyof typeof BILLABLE_TO_LABELS] ?? a.billable_to}
                        {a.description ? ` · ${a.description}` : ''}
                      </p>
                    </div>
                    <span className="whitespace-nowrap">${(a.amount_cents / 100).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}

            {canEditAccessorials && (
              <ActionForm action={addAccessorial} className="mt-6 border-t border-line pt-4 space-y-3">
                <input type="hidden" name="orgId" value={active.orgId} />
                <input type="hidden" name="loadId" value={load.id} />
                <h3 className="text-sm font-semibold">Add a charge</h3>
                <p className="text-xs text-muted -mt-1">
                  Detention, layover, a lumper fee, or TONU — a billable charge beyond the base rate.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm mb-1">Type</label>
                    <select name="type" required className="input">
                      {Object.values(ACCESSORIAL_TYPE).map((t) => (
                        <option key={t} value={t}>
                          {ACCESSORIAL_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Billable to</label>
                    <select name="billableTo" required className="input">
                      {Object.values(BILLABLE_TO).map((b) => (
                        <option key={b} value={b}>
                          {BILLABLE_TO_LABELS[b]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm mb-1">Amount (USD)</label>
                  <input name="amountDollars" type="number" step="0.01" min="0.01" required className="input" />
                </div>
                <div>
                  <label className="block text-sm mb-1">Description</label>
                  <input name="description" placeholder="e.g. 3 hrs detention at pickup" className="input" />
                </div>
                <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Adding…">
                  Add charge
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
          </div>
        </div>
        {requiredAction && <RequiredActionRail action={requiredAction} hideCta />}
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to loads.</p>
    </div>
  );
}
