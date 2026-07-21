import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { resolveOrgPricingConfig } from '@/lib/config/policies.server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { createQuote, approveOverride, rejectOverride } from './actions';

interface OpenRfq {
  id: string;
  origin: string;
  destination: string;
}

interface PendingQuote {
  id: string;
  rfq_id: string | null;
  carrier_linehaul_cents: number;
  shipper_price_cents: number;
  margin_amount_cents: number;
  margin_percent: number;
  override_reason: string | null;
  override_requested_by: string | null;
  created_at: string;
}

export default async function PricingPage() {
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

  const canApprove = can(active.role, PERMISSIONS.PRICING_OVERRIDE_APPROVE);
  let pending: PendingQuote[] = [];
  if (canApprove) {
    const { data } = await supabase
      .from('quotes')
      .select(
        'id, rfq_id, carrier_linehaul_cents, shipper_price_cents, margin_amount_cents, margin_percent, override_reason, override_requested_by, created_at',
      )
      .eq('org_id', active.orgId)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false });
    pending = (data as PendingQuote[]) ?? [];
  }

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
          <select name="rfqId" className="input">
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

      {canApprove && (
        <div className="panel mt-6 p-6">
          <h2 className="font-semibold">Overrides awaiting approval</h2>
          {pending.length === 0 && <p className="text-sm text-muted mt-2">Nothing pending.</p>}
          <ul className="mt-4 space-y-4">
            {pending.map((q) => {
              const isOwnRequest = q.override_requested_by === ctx?.userId;
              return (
                <li key={q.id} className="table-row border-t border-line pt-4 pb-2 -mx-2 px-2 rounded-lg text-sm">
                  <p>
                    Shipper price ${(q.shipper_price_cents / 100).toFixed(2)} · margin $
                    {(q.margin_amount_cents / 100).toFixed(2)} ({(q.margin_percent * 100).toFixed(1)}%)
                  </p>
                  <p className="text-muted mt-1">Reason: {q.override_reason}</p>
                  {isOwnRequest ? (
                    <p className="text-warn mt-2 text-xs">
                      You requested this override — a different manager or admin must approve it.
                    </p>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <ActionForm action={approveOverride}>
                        <input type="hidden" name="orgId" value={active.orgId} />
                        <input type="hidden" name="quoteId" value={q.id} />
                        <SubmitButton className="btn-copper px-3 py-1.5 text-xs" pendingLabel="…">
                          Approve
                        </SubmitButton>
                      </ActionForm>
                      <ActionForm action={rejectOverride}>
                        <input type="hidden" name="orgId" value={active.orgId} />
                        <input type="hidden" name="quoteId" value={q.id} />
                        <SubmitButton
                          className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-charcoal-700"
                          pendingLabel="…"
                        >
                          Reject
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
