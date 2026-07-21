/**
 * Required-action resolver — the right rail on every detail page.
 *
 * Requirement coverage:
 *   FR-WF-04  Every record answers "what happens next, and who owns it"
 *             in one place, rather than the user inferring it from a status
 *             chip.
 *   FR-WF-05  The CTA is disabled with a stated reason when a blocking gate
 *             applies; warnings are shown without disabling it.
 *
 * Source: docs/WORKFLOW-REDESIGN.md §9.
 *
 * Pure: no Next/Supabase imports. Depends on actions-available.ts one way
 * only — that file owns the blocker vocabulary, this one owns the narrative
 * wrapped around it.
 */

import { LOAD_STATUS, LOAD_STATUS_LABELS, type LoadStatus } from '../loads/lifecycle';
import {
  evaluateLoadActions,
  evaluateQuoteActions,
  evaluateRfqActions,
  primaryActionFor,
  WORKFLOW_ACTIONS,
  type ActionAvailability,
  type Blocker,
  type LoadActionInput,
  type QuoteActionInput,
  type RfqActionInput,
  type WorkflowAction,
} from './actions-available';

export type { Blocker, BlockerCode, BlockerSeverity } from './actions-available';
export { BLOCKER_CODES } from './actions-available';

export type ActionOwner = 'broker' | 'carrier' | 'driver' | 'customer' | 'finance';

export interface RequiredActionCta {
  label: string;
  action: WorkflowAction;
  enabled: boolean;
  /** Why it is disabled — the first blocking gate's message. */
  reason?: string;
}

export interface RequiredAction {
  /** Where the record is, in the user's words. */
  stage: string;
  /** What has to happen next. */
  next: string;
  owner: ActionOwner;
  ownerName?: string;
  dueAt?: string;
  blockers: Blocker[];
  warnings: Blocker[];
  cta?: RequiredActionCta;
}

const ACTION_LABELS: Record<WorkflowAction, string> = {
  [WORKFLOW_ACTIONS.CREATE_QUOTE]: 'Create quote',
  [WORKFLOW_ACTIONS.SEND_QUOTE]: 'Send quote',
  [WORKFLOW_ACTIONS.CONVERT_TO_LOAD]: 'Convert to load',
  [WORKFLOW_ACTIONS.ASSIGN_CARRIER]: 'Assign carrier',
  [WORKFLOW_ACTIONS.SEND_RATECON]: 'Send rate confirmation',
  [WORKFLOW_ACTIONS.RELEASE_TO_DRIVER]: 'Release to driver',
  [WORKFLOW_ACTIONS.DISPATCH]: 'Dispatch',
  [WORKFLOW_ACTIONS.MARK_DELIVERED]: 'Mark delivered',
  [WORKFLOW_ACTIONS.CREATE_INVOICE]: 'Create invoice',
  [WORKFLOW_ACTIONS.APPROVE_SETTLEMENT]: 'Approve settlement',
  [WORKFLOW_ACTIONS.CLOSE_LOAD]: 'Close load',
};

function find(actions: ActionAvailability[], action: WorkflowAction): ActionAvailability {
  const match = actions.find((a) => a.action === action);
  // Every evaluator returns a fixed action set, so this is unreachable in
  // practice — treat a miss as "nothing known blocks it" rather than throwing
  // into a page render.
  return match ?? { action, available: true, blockers: [], warnings: [] };
}

function ctaFor(availability: ActionAvailability): RequiredActionCta {
  const first = availability.blockers[0];
  return {
    label: ACTION_LABELS[availability.action],
    action: availability.action,
    enabled: availability.available,
    ...(first ? { reason: first.message } : {}),
  };
}

/** FR-WF-04: what an RFQ needs before it can be priced. */
export function resolveRfqRequiredAction(input: RfqActionInput): RequiredAction {
  const createQuote = find(evaluateRfqActions(input), WORKFLOW_ACTIONS.CREATE_QUOTE);
  return {
    stage: 'Awaiting pricing',
    next: createQuote.available
      ? 'Price this RFQ and send a quote'
      : 'Complete the freight details before pricing',
    owner: 'broker',
    blockers: createQuote.blockers,
    warnings: createQuote.warnings,
    cta: ctaFor(createQuote),
  };
}

export interface QuoteRequiredActionInput extends QuoteActionInput {
  /** Set once the quote has been sent to the customer. */
  sent: boolean;
  customerName?: string;
}

/** FR-WF-04: whether a quote is waiting on us, an approver, or the customer. */
export function resolveQuoteRequiredAction(input: QuoteRequiredActionInput): RequiredAction {
  const actions = evaluateQuoteActions(input);
  const send = find(actions, WORKFLOW_ACTIONS.SEND_QUOTE);
  const convert = find(actions, WORKFLOW_ACTIONS.CONVERT_TO_LOAD);

  if (!input.sent) {
    // An override pending approval is the one case where the quote is blocked
    // on a second manager rather than on the customer.
    const owner: ActionOwner = 'broker';
    return {
      stage: input.overrideStatus === 'pending' ? 'Override pending approval' : 'Draft',
      next: send.available ? 'Send this quote to the customer' : 'A manager must approve the pricing override',
      owner,
      blockers: send.blockers,
      warnings: send.warnings,
      cta: ctaFor(send),
    };
  }

  return {
    stage: input.accepted ? 'Accepted' : 'Awaiting customer acceptance',
    next: convert.available
      ? 'Convert this quote to a load'
      : 'Customer must accept before this becomes a load',
    owner: input.accepted ? 'broker' : 'customer',
    ...(input.customerName ? { ownerName: input.customerName } : {}),
    ...(input.validUntil ? { dueAt: input.validUntil } : {}),
    blockers: convert.blockers,
    warnings: convert.warnings,
    cta: ctaFor(convert),
  };
}

/** Who the load is waiting on at each stage — drives the right rail's "owner". */
function ownerForStatus(status: LoadStatus): ActionOwner {
  switch (status) {
    case LOAD_STATUS.AWAITING_CARRIER_SIGNATURE:
      return 'carrier';
    case LOAD_STATUS.RELEASED_TO_DRIVER:
    case LOAD_STATUS.DRIVER_ACKNOWLEDGED:
    case LOAD_STATUS.DISPATCHED:
    case LOAD_STATUS.IN_TRANSIT:
      return 'driver';
    case LOAD_STATUS.DELIVERED:
    case LOAD_STATUS.INVOICED:
      return 'finance';
    default:
      return 'broker';
  }
}

export interface LoadRequiredActionInput extends LoadActionInput {
  /** RC-####, for the "Carrier must sign RC-2048" phrasing in §9. */
  rateconReference?: string;
}

/** FR-WF-04/05: the load's right rail — stage, next step, owner, gates, CTA. */
export function resolveLoadRequiredAction(input: LoadRequiredActionInput): RequiredAction {
  const actions = evaluateLoadActions(input);
  const primary = primaryActionFor(input.status);
  const stage = LOAD_STATUS_LABELS[input.status];
  const owner = ownerForStatus(input.status);

  if (primary === null) {
    // Closed: nothing is owed, so no CTA and no gates to report.
    return { stage, next: 'Nothing outstanding', owner, blockers: [], warnings: [] };
  }

  const availability = find(actions, primary);
  const next =
    input.status === LOAD_STATUS.AWAITING_CARRIER_SIGNATURE && input.rateconReference
      ? `Carrier must sign ${input.rateconReference}`
      : ACTION_LABELS[primary];

  return {
    stage,
    next,
    owner,
    ...(input.carrier && owner === 'carrier' ? { ownerName: input.carrier.name } : {}),
    blockers: availability.blockers,
    warnings: availability.warnings,
    cta: ctaFor(availability),
  };
}
