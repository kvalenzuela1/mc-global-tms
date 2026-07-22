import Link from 'next/link';
import { AlertTriangle, TriangleAlert, ArrowRight } from 'lucide-react';
import { WORKFLOW_ACTIONS, type WorkflowAction } from '@/lib/workflow/actions-available';
import type { RequiredAction, ActionOwner } from '@/lib/workflow/required-action';

/**
 * The right rail from WORKFLOW-REDESIGN.md §5/§9 — "what do I do next, who owns
 * it, and what's blocking it" for one record. Presentational only; the caller
 * feeds it a `RequiredAction` computed by the pure resolver.
 *
 * The CTA links only to actions with a real Phase-1 route (see `ctaRouteFor`).
 * Actions the pilot doesn't implement yet (send-quote, invoicing, …) render as
 * guidance text with no button — a disabled/absent link beats one that 404s.
 * A blocked-but-routable CTA renders greyed with its reason, never hidden (§5:
 * "hiding a button teaches the user nothing").
 */

const OWNER_LABELS: Record<ActionOwner, string> = {
  broker: 'Broker',
  carrier: 'Carrier',
  driver: 'Driver',
  customer: 'Customer',
  finance: 'Finance',
};

/** Route that performs `action`, or null when the pilot has no page for it. */
function ctaRouteFor(action: WorkflowAction, rfqId?: string | null): string | null {
  switch (action) {
    case WORKFLOW_ACTIONS.CREATE_QUOTE:
      return rfqId ? `/portal/pricing?rfq=${rfqId}` : '/portal/pricing';
    case WORKFLOW_ACTIONS.CONVERT_TO_LOAD:
    case WORKFLOW_ACTIONS.ASSIGN_CARRIER:
    case WORKFLOW_ACTIONS.RELEASE_TO_DRIVER:
    case WORKFLOW_ACTIONS.DISPATCH:
      return '/portal/loads';
    case WORKFLOW_ACTIONS.SEND_RATECON:
      return '/portal/ratecons';
    default:
      // send_quote, mark_delivered, create_invoice, approve_settlement,
      // close_load — no Phase-1 destination; guidance-only.
      return null;
  }
}

export function RequiredActionRail({
  action,
  rfqId,
  hideCta = false,
}: {
  action: RequiredAction;
  /** Context for the CTA deep-link (only the RFQ needs it today). */
  rfqId?: string | null;
  /**
   * Suppress the CTA entirely, keeping only the stage / next / owner / blockers
   * narrative. Used on the load detail page, where the existing "Advance
   * status" form is the real control and a rail button would just duplicate it
   * — the rail's value there is explaining *why* an advance is or isn't allowed.
   */
  hideCta?: boolean;
}) {
  const cta = action.cta;
  const href = cta ? ctaRouteFor(cta.action, rfqId) : null;
  const showLink = Boolean(!hideCta && cta && cta.enabled && href);

  return (
    <aside className="panel p-5 lg:sticky lg:top-6">
      <p className="text-muted text-xs font-semibold uppercase tracking-wide">Next required action</p>
      <p className="mt-1 text-xs text-muted">{action.stage}</p>
      <p className="mt-2 font-semibold leading-snug">{action.next}</p>

      <p className="text-muted mt-2 text-xs">
        Owner: <span className="text-ink">{OWNER_LABELS[action.owner]}</span>
        {action.ownerName ? ` · ${action.ownerName}` : ''}
        {action.dueAt ? ` · due ${new Date(action.dueAt).toLocaleDateString()}` : ''}
      </p>

      {showLink && href && (
        <Link href={href} className="btn-copper mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm">
          {cta!.label}
          <ArrowRight size={14} strokeWidth={2} />
        </Link>
      )}
      {!hideCta && cta && !cta.enabled && (
        <div className="mt-4">
          <span className="inline-block cursor-not-allowed rounded-lg border border-line px-3 py-1.5 text-sm text-muted opacity-60">
            {cta.label}
          </span>
          {cta.reason && <p className="text-warn mt-1.5 text-xs">{cta.reason}</p>}
        </div>
      )}

      {action.blockers.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
            <AlertTriangle size={13} strokeWidth={2} />
            Blocking
          </p>
          <ul className="mt-2 space-y-1.5">
            {action.blockers.map((b) => (
              <li key={b.code} className="text-xs text-ink">
                {b.message}
                {b.overrideableBy && (
                  <span className="text-muted"> · overrideable by {b.overrideableBy.replace('_', ' ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {action.warnings.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-warn">
            <TriangleAlert size={13} strokeWidth={2} />
            Warnings
          </p>
          <ul className="mt-2 space-y-1.5">
            {action.warnings.map((b) => (
              <li key={b.code} className="text-xs text-muted">
                {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
