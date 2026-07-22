import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { approveOverride, rejectOverride } from '../pricing/actions';

/**
 * Approvals home (WORKFLOW-REDESIGN §1.2 / §18 D6). Consolidates the two
 * override surfaces:
 *
 *  - Pricing overrides awaiting a second approver — the maker/checker queue
 *    moved here from the Margin Calculator (§1.2). Actionable by
 *    PRICING_OVERRIDE_APPROVE holders; separation of duties is re-enforced in
 *    approveOverride() (evaluateApproval), not just hidden in the UI.
 *  - Compliance overrides — these have no pending state (only org_admin holds
 *    COMPLIANCE_OVERRIDE and it's applied inline at booking, M4). So they're
 *    shown read-only, for oversight, from the audit trail. The hard
 *    release-to-driver compliance gate is separate and non-overridable.
 */

interface PendingQuote {
  id: string;
  shipper_price_cents: number;
  margin_amount_cents: number;
  margin_percent: number;
  override_reason: string | null;
  override_requested_by: string | null;
  created_at: string;
  rfqs: { origin: string; destination: string } | null;
}

interface ComplianceOverrideRow {
  id: number;
  entity_id: string | null;
  actor_user_id: string | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export default async function ApprovalsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  const canApprovePricing = can(active.role, PERMISSIONS.PRICING_OVERRIDE_APPROVE);
  const canOverrideCompliance = can(active.role, PERMISSIONS.COMPLIANCE_OVERRIDE);
  if (!canApprovePricing && !canOverrideCompliance) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();

  let pending: PendingQuote[] = [];
  if (canApprovePricing) {
    const { data } = await supabase
      .from('quotes')
      .select(
        'id, shipper_price_cents, margin_amount_cents, margin_percent, override_reason, override_requested_by, created_at, rfqs(origin, destination)',
      )
      .eq('org_id', active.orgId)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false });
    pending = (data as unknown as PendingQuote[]) ?? [];
  }

  let complianceOverrides: ComplianceOverrideRow[] = [];
  if (canOverrideCompliance) {
    // 'compliance.override' === AUDIT_ACTIONS.COMPLIANCE_OVERRIDE; kept as a
    // literal so this page doesn't import the service-role audit writer.
    const { data } = await supabase
      .from('audit_log')
      .select('id, entity_id, actor_user_id, after_state, created_at')
      .eq('org_id', active.orgId)
      .eq('action', 'compliance.override')
      .order('created_at', { ascending: false })
      .limit(50);
    complianceOverrides = (data as ComplianceOverrideRow[]) ?? [];
  }

  const formatActor = (actorId: string | null): string => {
    if (!actorId) return 'System';
    if (actorId === ctx?.userId) return `${ctx?.email ?? 'You'} (you)`;
    return `${actorId.slice(0, 8)}…`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Approvals</h1>
      <p className="text-muted mt-1">
        Pricing overrides waiting on a second approver, and compliance overrides applied at booking.
      </p>

      {canApprovePricing && (
        <div className="panel mt-6 p-6">
          <h2 className="font-semibold">Pricing overrides awaiting approval</h2>
          {pending.length === 0 && <p className="text-sm text-muted mt-2">Nothing pending.</p>}
          <ul className="mt-4 space-y-4">
            {pending.map((q) => {
              const isOwnRequest = q.override_requested_by === ctx?.userId;
              return (
                <li
                  key={q.id}
                  className="table-row border-t border-line pt-4 pb-2 -mx-2 px-2 rounded-lg text-sm"
                >
                  <p className="font-medium">
                    {q.rfqs ? `${q.rfqs.origin} → ${q.rfqs.destination}` : 'Ad-hoc quote'}
                  </p>
                  <p className="mt-1">
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

      {canOverrideCompliance && (
        <div className="panel mt-6 p-6">
          <h2 className="font-semibold">Compliance overrides</h2>
          <p className="text-muted mt-1 text-xs">
            Loads booked despite a non-compliant carrier, applied at booking with a reason. Shown for
            review — the release-to-driver compliance gate is separate and non-overridable.
          </p>
          {complianceOverrides.length === 0 && (
            <p className="text-sm text-muted mt-3">No compliance overrides on record.</p>
          )}
          <ul className="mt-3 space-y-3">
            {complianceOverrides.map((o) => {
              const reason = typeof o.after_state?.reason === 'string' ? o.after_state.reason : null;
              return (
                <li key={o.id} className="border-t border-line pt-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    {o.entity_id ? (
                      <Link
                        href={`/portal/loads/${o.entity_id}`}
                        className="text-copper-400 hover:text-copper-300"
                      >
                        Load {o.entity_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span>Load</span>
                    )}
                    <time className="text-muted shrink-0 text-xs">
                      {new Date(o.created_at).toLocaleString()}
                    </time>
                  </div>
                  {reason && <p className="text-muted mt-1">Reason: {reason}</p>}
                  <p className="text-muted mt-0.5 text-xs">By {formatActor(o.actor_user_id)}</p>
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
      <p className="mt-2 text-muted text-sm">Your role does not include access to approvals.</p>
    </div>
  );
}
