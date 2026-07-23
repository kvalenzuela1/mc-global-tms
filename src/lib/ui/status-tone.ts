/**
 * Status → visual tone + human label, for every status facet in the platform.
 *
 * Requirement coverage:
 *   FR-UX-01  One status vocabulary. A given semantic state renders the same
 *             colour on every screen, so colour is readable without context.
 *   FR-UX-02  Every raw DB status string has a human label; no screen shows
 *             `pending_approval` to a user.
 *
 * Why this lives in `src/lib` and not next to the component: it is pure (no
 * Next/React/Supabase imports), so it stays offline-testable — CLAUDE.md #8.
 * The component in `_components/status-badge.tsx` is a thin renderer over it.
 *
 * Before this module, seven pages each defined their own `*BadgeClass` helper
 * (`portal/page.tsx`, `loads/`, `ratecons/`, `carriers/`, `rfqs/`, `rfqs/[id]`,
 * `quotes/[id]`), three of them literal copy-paste duplicates. They had drifted:
 * a rejected quote and a suspended carrier both rendered in the same neutral
 * grey as an inactive-but-fine record, which reads as "nothing to see here" for
 * two states that are in fact failures.
 *
 * THE RULE, applied uniformly below:
 *   ok      settled / complete / passed a gate — nothing is owed
 *   warn    live and awaiting action from someone
 *   muted   passive: waiting on an external party, or not yet started
 *   danger  failed, refused, or blocked — needs a human decision to unblock
 */

import { LOAD_STATUS, LOAD_STATUS_LABELS, type LoadStatus } from '@/lib/loads/lifecycle';
import { RFQ_STATUS, RFQ_STATUS_LABELS, type RfqStatus } from '@/lib/rfqs/lifecycle';

export const STATUS_TONE = {
  OK: 'ok',
  WARN: 'warn',
  MUTED: 'muted',
  DANGER: 'danger',
} as const;

export type StatusTone = (typeof STATUS_TONE)[keyof typeof STATUS_TONE];

/**
 * The record axis a status belongs to. Named "facet" rather than "type"
 * because a single load carries several of these at once (operational status,
 * rate-confirmation status, compliance verdict) — they are not alternatives.
 */
export const STATUS_FACET = {
  LOAD: 'load',
  RFQ: 'rfq',
  QUOTE: 'quote',
  RATECON: 'ratecon',
  CARRIER: 'carrier',
  COMPLIANCE: 'compliance',
  CUSTOMER: 'customer',
} as const;

export type StatusFacet = (typeof STATUS_FACET)[keyof typeof STATUS_FACET];

interface ToneEntry {
  tone: StatusTone;
  label: string;
}

/**
 * A load is `warn` while it is in motion and someone owes it work, `ok` once it
 * has landed. `awaiting_carrier_signature` is `muted`, not `warn`: the ball is
 * in the carrier's court, and colouring the broker's own queue as "act now" for
 * something they cannot act on is exactly the noise that makes people stop
 * reading badges.
 */
const LOAD_TONES: Record<LoadStatus, StatusTone> = {
  [LOAD_STATUS.DRAFT]: STATUS_TONE.MUTED,
  [LOAD_STATUS.QUOTED]: STATUS_TONE.MUTED,
  [LOAD_STATUS.BOOKED]: STATUS_TONE.WARN,
  [LOAD_STATUS.AWAITING_CARRIER_SIGNATURE]: STATUS_TONE.MUTED,
  [LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE]: STATUS_TONE.WARN,
  [LOAD_STATUS.RELEASED_TO_DRIVER]: STATUS_TONE.MUTED,
  [LOAD_STATUS.DRIVER_ACKNOWLEDGED]: STATUS_TONE.WARN,
  [LOAD_STATUS.DISPATCHED]: STATUS_TONE.WARN,
  [LOAD_STATUS.IN_TRANSIT]: STATUS_TONE.WARN,
  [LOAD_STATUS.DELIVERED]: STATUS_TONE.OK,
  [LOAD_STATUS.INVOICED]: STATUS_TONE.OK,
  [LOAD_STATUS.CLOSED]: STATUS_TONE.OK,
};

/**
 * RFQ tones read "inverted" at first glance — `open` is warn, `closed` is ok —
 * but that is the rule working correctly: an open RFQ is unquoted work sitting
 * on a broker's desk, and a closed one is finished. This preserves the
 * behaviour the RFQ list already had, including its original comment.
 */
const RFQ_TONES: Record<RfqStatus, StatusTone> = {
  [RFQ_STATUS.OPEN]: STATUS_TONE.WARN, // needs a quote
  [RFQ_STATUS.QUOTED]: STATUS_TONE.MUTED, // waiting on the customer
  [RFQ_STATUS.BOOKED]: STATUS_TONE.WARN, // active load in motion
  [RFQ_STATUS.CLOSED]: STATUS_TONE.OK,
};

const QUOTE_TONES: Record<string, ToneEntry> = {
  draft: { tone: STATUS_TONE.MUTED, label: 'Draft' },
  pending_approval: { tone: STATUS_TONE.WARN, label: 'Pending approval' },
  approved: { tone: STATUS_TONE.OK, label: 'Approved' },
  rejected: { tone: STATUS_TONE.DANGER, label: 'Rejected' },
};

const RATECON_TONES: Record<string, ToneEntry> = {
  draft: { tone: STATUS_TONE.MUTED, label: 'Draft' },
  sent: { tone: STATUS_TONE.MUTED, label: 'Sent — awaiting signature' },
  signed: { tone: STATUS_TONE.OK, label: 'Signed' },
  superseded: { tone: STATUS_TONE.MUTED, label: 'Superseded' },
};

/**
 * `carriers.status` is the RELATIONSHIP status. It is deliberately independent
 * of the detailed compliance gate (see CLAUDE.md M4) — an "Approved" carrier can
 * still be refused assignment. The `COMPLIANCE` facet below is the one that
 * actually gates, and both are meant to be shown together.
 */
const CARRIER_TONES: Record<string, ToneEntry> = {
  conditional: { tone: STATUS_TONE.WARN, label: 'Conditional' },
  approved: { tone: STATUS_TONE.OK, label: 'Approved' },
  suspended: { tone: STATUS_TONE.DANGER, label: 'Suspended' },
  rejected: { tone: STATUS_TONE.DANGER, label: 'Rejected' },
};

const COMPLIANCE_TONES: Record<string, ToneEntry> = {
  compliant: { tone: STATUS_TONE.OK, label: 'Compliant' },
  blocked: { tone: STATUS_TONE.DANGER, label: 'Blocked' },
  unreviewed: { tone: STATUS_TONE.MUTED, label: 'Not yet reviewed' },
};

/** `shippers.status` — the customer-relationship state (see 0012_customers.sql). */
const CUSTOMER_TONES: Record<string, ToneEntry> = {
  prospect: { tone: STATUS_TONE.MUTED, label: 'Prospect' },
  active: { tone: STATUS_TONE.OK, label: 'Active' },
  on_hold: { tone: STATUS_TONE.WARN, label: 'On hold' },
  inactive: { tone: STATUS_TONE.MUTED, label: 'Inactive' },
};

/** Fallback for a status string this module does not know about. */
const UNKNOWN: StatusTone = STATUS_TONE.MUTED;

/**
 * FR-UX-01: the tone for a status. Unknown values fall back to `muted` rather
 * than throwing — a badge is not worth a 500, and an unstyled-but-legible badge
 * degrades better than a crashed page.
 */
export function toneFor(facet: StatusFacet, value: string): StatusTone {
  switch (facet) {
    case STATUS_FACET.LOAD:
      return LOAD_TONES[value as LoadStatus] ?? UNKNOWN;
    case STATUS_FACET.RFQ:
      return RFQ_TONES[value as RfqStatus] ?? UNKNOWN;
    case STATUS_FACET.QUOTE:
      return QUOTE_TONES[value]?.tone ?? UNKNOWN;
    case STATUS_FACET.RATECON:
      return RATECON_TONES[value]?.tone ?? UNKNOWN;
    case STATUS_FACET.CARRIER:
      return CARRIER_TONES[value]?.tone ?? UNKNOWN;
    case STATUS_FACET.COMPLIANCE:
      return COMPLIANCE_TONES[value]?.tone ?? UNKNOWN;
    case STATUS_FACET.CUSTOMER:
      return CUSTOMER_TONES[value]?.tone ?? UNKNOWN;
    default:
      return UNKNOWN;
  }
}

/**
 * FR-UX-02: the human label for a status. Unknown values are humanised
 * (`pending_approval` -> `Pending approval`) rather than shown raw, so a status
 * added in the database before it is added here still reads acceptably.
 */
export function labelFor(facet: StatusFacet, value: string): string {
  switch (facet) {
    case STATUS_FACET.LOAD:
      return LOAD_STATUS_LABELS[value as LoadStatus] ?? humanise(value);
    case STATUS_FACET.RFQ:
      return RFQ_STATUS_LABELS[value as RfqStatus] ?? humanise(value);
    case STATUS_FACET.QUOTE:
      return QUOTE_TONES[value]?.label ?? humanise(value);
    case STATUS_FACET.RATECON:
      return RATECON_TONES[value]?.label ?? humanise(value);
    case STATUS_FACET.CARRIER:
      return CARRIER_TONES[value]?.label ?? humanise(value);
    case STATUS_FACET.COMPLIANCE:
      return COMPLIANCE_TONES[value]?.label ?? humanise(value);
    case STATUS_FACET.CUSTOMER:
      return CUSTOMER_TONES[value]?.label ?? humanise(value);
    default:
      return humanise(value);
  }
}

/** `pending_approval` -> `Pending approval`. */
export function humanise(value: string): string {
  if (value.length === 0) return '';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The CSS class pair the badge component renders. */
export function badgeClassFor(facet: StatusFacet, value: string): string {
  return `badge badge-${toneFor(facet, value)}`;
}
