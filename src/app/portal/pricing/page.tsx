import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { resolveOrgPricingConfig } from '@/lib/config/policies.server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { createQuote } from './actions';

interface OpenRfq {
  id: string;
  origin: string;
  destination: string;
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ rfq?: string }>;
}) {
  const { rfq: rfqParam } = await searchParams;
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.PRICING_VIEW)) {
    return <NotAuthorized />;
  }

  const config = await resolveOrgPricingConfig(active.orgId);
  const supabase = await getServerSupabase();

  const { data: rfqData } = await supabase
    .from('rfqs')
    .select('id, origin, destination')
    .eq('org_id', active.orgId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  const rfqs = (rfqData as OpenRfq[]) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold">Margin Calculator</h1>
      <p className="text-muted mt-1">
        Active pricing policy: {(config.targetMarginPercent * 100).toFixed(1)}% target margin ·{' '}
        {(config.quickPayFeePercent * 100).toFixed(1)}% Quick Pay ·{' '}
        {(config.factoringCostPercent * 100).toFixed(1)}% factoring cost.
      </p>

      <ActionForm action={createQuote} className="panel mt-6 p-6 space-y-4 max-w-xl">
        <input type="hidden" name="orgId" value={active.orgId} />
        <div>
          <label className="block text-sm mb-1">Link to RFQ (optional)</label>
          <select name="rfqId" className="input" defaultValue={rfqParam ?? ''}>
            <option value="">— None —</option>
            {rfqs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.origin} → {r.destination}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Carrier linehaul (USD)</label>
          <input
            name="carrierLinehaulDollars"
            type="number"
            step="0.01"
            min="0"
            required
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">
            Override justification <span className="text-muted">(required only if the quote breaches policy)</span>
          </label>
          <textarea name="reason" rows={2} className="input" />
        </div>
        <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Calculating…">
          Quote it
        </SubmitButton>
      </ActionForm>

      <p className="text-muted mt-4 text-sm">
        A quote that breaches policy needs a second approver — those requests now live in{' '}
        <Link href="/portal/approvals" className="text-copper-400 hover:text-copper-300">
          Approvals
        </Link>
        .
      </p>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to pricing.</p>
    </div>
  );
}
