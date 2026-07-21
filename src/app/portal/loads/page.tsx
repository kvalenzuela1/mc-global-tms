import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { isInternalRole } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import { LOAD_STATUS, LOAD_STATUS_LABELS, nextStatuses, type LoadStatus } from '@/lib/loads/lifecycle';
import { readSnapshotCents } from '@/lib/pricing/snapshot';

// These two steps only happen through the rate-confirmation flow
// (sendRatecon/signRatecon) — offering them in the generic advance dropdown
// would just error (see loads/actions.ts's advanceLoadStatus guard).
const MANAGED_ELSEWHERE = new Set<LoadStatus>([
  LOAD_STATUS.AWAITING_CARRIER_SIGNATURE,
  LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE,
]);
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { createLoadFromQuote, advanceLoadStatus } from './actions';

interface LoadRow {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: LoadStatus;
  commercial_snapshot: Record<string, unknown> | null;
  carrier_name: string | null;
}

interface BookableQuoteRow {
  id: string;
  shipper_price_cents: number;
  is_override: boolean;
  rfqs: { origin: string; destination: string } | null;
}

interface CarrierRow {
  id: string;
  name: string;
}

export default async function LoadsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.LOAD_VIEW)) {
    return <NotAuthorized />;
  }

  // FR-MASK-01: loads.commercial_snapshot is a JSONB blob maskCommercials()
  // does not traverse, and RLS lets a carrier/driver read the row it's
  // assigned to — RLS is row-level, not column-level, and every tenant user
  // maps to the same Postgres role, so column grants can't help either. The
  // `loads` view (migration 0006 — the real table is `loads_data`) nulls
  // commercial_snapshot at the storage layer for anyone who isn't a
  // broker-org member; showCommercials below is a UI-side belt-and-suspenders
  // check on top of that, not the only thing standing between a driver and
  // the margin.
  const showCommercials = isInternalRole(active.role);
  const canCreate = can(active.role, PERMISSIONS.LOAD_CREATE);
  const canAdvance = can(active.role, PERMISSIONS.LOAD_TRANSITION);

  const supabase = await getServerSupabase();

  // No org_id filter: loads_api inherits loads_select's relationship-based
  // scoping (broker member / assigned carrier / assigned driver / shipper),
  // and for external roles active.orgId is THEIR org, not the broker
  // tenant's — filtering on it here would wrongly hide their loads.
  const { data: loadData, error } = await supabase
    .from('loads')
    .select('id, reference, origin, destination, status, commercial_snapshot, carrier_name')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const loads = (loadData as unknown as LoadRow[]) ?? [];

  let bookableQuotes: BookableQuoteRow[] = [];
  let carriers: CarrierRow[] = [];
  if (canCreate) {
    const { data: quoteData } = await supabase
      .from('quotes')
      .select('id, shipper_price_cents, is_override, rfqs(origin, destination)')
      .eq('org_id', active.orgId)
      .is('load_id', null)
      .eq('status', 'approved');
    bookableQuotes = (quoteData as unknown as BookableQuoteRow[]) ?? [];

    const { data: carrierData } = await supabase
      .from('carriers')
      .select('id, name')
      .eq('org_id', active.orgId)
      .order('name');
    carriers = (carrierData as CarrierRow[]) ?? [];
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Loads</h1>
      <p className="text-muted mt-1">Booked freight and lifecycle status.</p>

      {canCreate && (
        <ActionForm action={createLoadFromQuote} className="panel mt-6 p-6 space-y-4 max-w-xl">
          <input type="hidden" name="orgId" value={active.orgId} />
          <h2 className="font-semibold">Book a load from an approved quote</h2>
          <div>
            <label className="block text-sm mb-1">Quote</label>
            <select
              name="quoteId"
              required
              className="w-full rounded-lg bg-charcoal-800 border border-line px-3 py-2"
            >
              <option value="">Select an approved, unbooked quote</option>
              {bookableQuotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.rfqs?.origin} → {q.rfqs?.destination} · ${(q.shipper_price_cents / 100).toFixed(2)}
                  {q.is_override ? ' (override approved)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Carrier</label>
            <select
              name="carrierId"
              required
              className="w-full rounded-lg bg-charcoal-800 border border-line px-3 py-2"
            >
              <option value="">Select a carrier</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Origin</label>
              <input
                name="origin"
                required
                className="w-full rounded-lg bg-charcoal-800 border border-line px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Destination</label>
              <input
                name="destination"
                required
                className="w-full rounded-lg bg-charcoal-800 border border-line px-3 py-2"
              />
            </div>
          </div>
          <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Booking…">
            Create load
          </SubmitButton>
        </ActionForm>
      )}

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">All loads</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-muted text-left">
            <tr>
              <th className="pb-2">Reference</th>
              <th className="pb-2">Lane</th>
              <th className="pb-2">Carrier</th>
              <th className="pb-2">Status</th>
              {showCommercials && <th className="pb-2">Margin</th>}
              {canAdvance && <th className="pb-2">Advance</th>}
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => {
              const rawNext = nextStatuses(l.status);
              const next = rawNext.filter((s) => !MANAGED_ELSEWHERE.has(s));
              const isManagedElsewhere = rawNext.length > 0 && next.length === 0;
              const margin = showCommercials
                ? readSnapshotCents(l.commercial_snapshot, 'marginAmountCents', 'margin_amount_cents')
                : undefined;
              return (
                <tr key={l.id} className="border-t border-line">
                  <td className="py-2">{l.reference}</td>
                  <td className="py-2">
                    {l.origin} → {l.destination}
                  </td>
                  <td className="py-2">{l.carrier_name ?? '—'}</td>
                  <td className="py-2">{LOAD_STATUS_LABELS[l.status] ?? l.status}</td>
                  {showCommercials && (
                    <td className="py-2">
                      {typeof margin === 'number' ? `$${(margin / 100).toFixed(2)}` : '—'}
                    </td>
                  )}
                  {canAdvance && (
                    <td className="py-2">
                      {next.length > 0 ? (
                        <ActionForm action={advanceLoadStatus} className="inline-flex items-center gap-2">
                          <input type="hidden" name="orgId" value={active.orgId} />
                          <input type="hidden" name="loadId" value={l.id} />
                          <select
                            name="to"
                            className="rounded-md bg-charcoal-800 border border-line px-2 py-1 text-xs"
                          >
                            {next.map((s) => (
                              <option key={s} value={s}>
                                {LOAD_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          <SubmitButton className="btn-copper px-2 py-1 text-xs" pendingLabel="…">
                            Go
                          </SubmitButton>
                        </ActionForm>
                      ) : isManagedElsewhere ? (
                        <span className="text-muted text-xs">Via Rate Confirmations</span>
                      ) : (
                        <span className="text-muted text-xs">Final</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {loads.length === 0 && (
              <tr>
                <td colSpan={showCommercials ? 5 : 4} className="py-4 text-muted">
                  No loads yet.
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
      <p className="mt-2 text-muted text-sm">Your role does not include access to loads.</p>
    </div>
  );
}
