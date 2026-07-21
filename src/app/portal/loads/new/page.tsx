import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { getOrgComplianceResults } from '@/lib/compliance/policy.server';
import { Breadcrumb } from '../../_components/breadcrumb';
import { ActionForm } from '../../_components/action-form';
import { SubmitButton } from '../../_components/submit-button';
import { createLoadFromQuote } from '../actions';

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

export default async function NewLoadPage({
  searchParams,
}: {
  searchParams: Promise<{ quoteId?: string }>;
}) {
  const { quoteId } = await searchParams;

  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.LOAD_CREATE)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();

  const { data: quoteData } = await supabase
    .from('quotes')
    .select('id, shipper_price_cents, is_override, rfqs(origin, destination)')
    .eq('org_id', active.orgId)
    .is('load_id', null)
    .eq('status', 'approved');
  const bookableQuotes = (quoteData as unknown as BookableQuoteRow[]) ?? [];

  const { data: carrierData } = await supabase
    .from('carriers')
    .select('id, name')
    .eq('org_id', active.orgId)
    .order('name');
  const carriers = (carrierData as CarrierRow[]) ?? [];

  // Annotate the dropdown so a broker sees a blocked carrier before
  // submitting, rather than only after the assignment gate refuses it.
  const results = await getOrgComplianceResults(active.orgId);
  const carrierCompliance = new Map(
    carriers.map((c) => [c.id, results.get(c.id)?.allowed ?? false]),
  );

  // The ?quoteId= preselect is a URL param, so it's only honoured if it names
  // a quote that is actually bookable for this org (approved, not yet booked).
  // A stale or hand-edited id just falls through to "no preselection" — the
  // server action re-validates regardless (createLoadFromQuote).
  const preselectedQuoteId = bookableQuotes.some((q) => q.id === quoteId) ? quoteId : undefined;
  const canOverrideCompliance = can(active.role, PERMISSIONS.COMPLIANCE_OVERRIDE);

  return (
    <div>
      <Breadcrumb
        trail={[{ label: 'Loads', href: '/portal/loads' }, { label: 'Book a load' }]}
      />

      <h1 className="text-2xl font-bold mt-3">Book a load</h1>
      <p className="text-muted mt-1">Turn an approved quote into a load and assign a carrier.</p>

      {bookableQuotes.length === 0 ? (
        <div className="panel mt-6 p-6 max-w-xl">
          <p className="text-sm text-muted">
            No approved quotes are waiting to be booked. Approve a quote first, or check{' '}
            <Link href="/portal/rfqs" className="text-copper-400 hover:text-copper-300">
              RFQs &amp; Quotes
            </Link>
            .
          </p>
        </div>
      ) : (
        <ActionForm action={createLoadFromQuote} className="panel mt-6 p-6 space-y-4 max-w-xl">
          <input type="hidden" name="orgId" value={active.orgId} />
          <div>
            <label className="block text-sm mb-1">Quote</label>
            <select name="quoteId" required defaultValue={preselectedQuoteId ?? ''} className="input">
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
            <select name="carrierId" required className="input">
              <option value="">Select a carrier</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {carrierCompliance.get(c.id) ? '' : ' — blocked (see Carrier Compliance)'}
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
          {canOverrideCompliance && (
            <div className="rounded-lg border border-line p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="complianceOverride" />
                Override a blocked carrier&apos;s compliance status
              </label>
              <textarea
                name="complianceOverrideReason"
                rows={2}
                placeholder="Required if overriding — why is this carrier acceptable anyway?"
                className="input text-sm"
              />
            </div>
          )}
          <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Booking…">
            Create load
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include booking loads.</p>
    </div>
  );
}
