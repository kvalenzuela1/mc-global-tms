/**
 * Which actions a record offers right now, and what is stopping each one.
 *
 * Requirement coverage:
 *   FR-WF-01  Every gate that blocks an action is a stable, testable code
 *             rather than a string assembled at the call site.
 *   FR-WF-02  Blocking and warning severities are distinct: a warning is
 *             surfaced but never disables the action.
 *   FR-WF-03  Two override tiers — an overrideable gate names who may
 *             override it; a hard gate can never be overridden by anyone.
 *
 * Source: docs/WORKFLOW-REDESIGN.md §9 (blocker table + override tiers).
 *
 * Pure: no Next/Supabase imports, `asOf` is injected rather than read from a
 * clock, so results are reproducible. The blocker vocabulary lives here rather
 * than in required-action.ts because a blocker is a property of an *action*;
 * required-action.ts imports from this file and never the other way round, so
 * there is no import cycle to survive `--experimental-strip-types`.
 */

import { LOAD_STATUS, type LoadStatus } from '../loads/lifecycle';

export const BLOCKER_CODES = {
  RFQ_FREIGHT_INCOMPLETE: 'RFQ_FREIGHT_INCOMPLETE',
  QUOTE_OVERRIDE_PENDING: 'QUOTE_OVERRIDE_PENDING',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_NOT_ACCEPTED: 'QUOTE_NOT_ACCEPTED',
  CARRIER_NOT_ASSIGNED: 'CARRIER_NOT_ASSIGNED',
  CARRIER_NOT_COMPLIANT: 'CARRIER_NOT_COMPLIANT',
  CARRIER_SUSPENDED: 'CARRIER_SUSPENDED',
  RATECON_NOT_SIGNED: 'RATECON_NOT_SIGNED',
  DRIVER_NOT_ASSIGNED: 'DRIVER_NOT_ASSIGNED',
  STOPS_INCOMPLETE: 'STOPS_INCOMPLETE',
  APPOINTMENT_MISSING: 'APPOINTMENT_MISSING',
  RECEIVER_UNCONFIRMED: 'RECEIVER_UNCONFIRMED',
  POD_MISSING: 'POD_MISSING',
  POD_UNVERIFIED: 'POD_UNVERIFIED',
  BILLING_DATA_MISSING: 'BILLING_DATA_MISSING',
  CARRIER_INVOICE_MISSING: 'CARRIER_INVOICE_MISSING',
  INSURANCE_EXPIRING: 'INSURANCE_EXPIRING',
  INSURANCE_EXPIRED: 'INSURANCE_EXPIRED',
  OPEN_EXCEPTIONS: 'OPEN_EXCEPTIONS',
} as const;

export type BlockerCode = (typeof BLOCKER_CODES)[keyof typeof BLOCKER_CODES];

export type BlockerSeverity = 'blocking' | 'warning';

export interface Blocker {
  code: BlockerCode;
  message: string;
  severity: BlockerSeverity;
  /** Deep link to the tab that fixes it, once the detail routes exist (B1/B4). */
  fixHref?: string;
  /**
   * Role that may override this blocker with an audited reason. Absent means
   * hard — §9's non-overridable tier, and the safety property M4 verified:
   * a booking-time compliance override deliberately does not carry forward to
   * release. Never add a role here without a matching server-side check.
   */
  overrideableBy?: 'org_admin';
}

export const WORKFLOW_ACTIONS = {
  CREATE_QUOTE: 'create_quote',
  SEND_QUOTE: 'send_quote',
  CONVERT_TO_LOAD: 'convert_to_load',
  ASSIGN_CARRIER: 'assign_carrier',
  SEND_RATECON: 'send_ratecon',
  RELEASE_TO_DRIVER: 'release_to_driver',
  DISPATCH: 'dispatch',
  MARK_DELIVERED: 'mark_delivered',
  CREATE_INVOICE: 'create_invoice',
  APPROVE_SETTLEMENT: 'approve_settlement',
  CLOSE_LOAD: 'close_load',
} as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[keyof typeof WORKFLOW_ACTIONS];

export interface ActionAvailability {
  action: WorkflowAction;
  /** True only when nothing blocking remains. Warnings never disable. */
  available: boolean;
  blockers: Blocker[];
  warnings: Blocker[];
}

function blocking(code: BlockerCode, message: string, extra?: Partial<Blocker>): Blocker {
  return { code, message, severity: 'blocking', ...extra };
}

function warning(code: BlockerCode, message: string, extra?: Partial<Blocker>): Blocker {
  return { code, message, severity: 'warning', ...extra };
}

function availability(action: WorkflowAction, found: Blocker[]): ActionAvailability {
  const blockers = found.filter((b) => b.severity === 'blocking');
  const warnings = found.filter((b) => b.severity === 'warning');
  return { action, available: blockers.length === 0, blockers, warnings };
}

/** Whole days from `asOf` to `iso`; negative once the date has passed. */
function daysUntil(iso: string, asOf: Date): number | null {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const MS_PER_DAY = 86_400_000;
  return Math.floor((target.getTime() - asOf.getTime()) / MS_PER_DAY);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// RFQ
// ---------------------------------------------------------------------------

export interface RfqActionInput {
  /** Both are required before the RFQ can be priced (§9, FLD-02). */
  weightLbs: number | null;
  freightClass: string | null;
}

export function evaluateRfqActions(input: RfqActionInput): ActionAvailability[] {
  const found: Blocker[] = [];
  if (input.weightLbs == null || input.freightClass == null) {
    found.push(
      blocking(BLOCKER_CODES.RFQ_FREIGHT_INCOMPLETE, 'Weight and class required before pricing'),
    );
  }
  return [availability(WORKFLOW_ACTIONS.CREATE_QUOTE, found)];
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export interface QuoteActionInput {
  /** 'pending' means requested but not yet approved by a second manager. */
  overrideStatus: 'none' | 'pending' | 'approved';
  accepted: boolean;
  /** ISO date; null means the quote lifecycle columns aren't populated yet (C5). */
  validUntil: string | null;
  asOf: Date;
}

export function evaluateQuoteActions(input: QuoteActionInput): ActionAvailability[] {
  const sendFound: Blocker[] = [];
  if (input.overrideStatus === 'pending') {
    sendFound.push(
      blocking(
        BLOCKER_CODES.QUOTE_OVERRIDE_PENDING,
        'Pricing override awaiting manager approval',
      ),
    );
  }

  const convertFound: Blocker[] = [];
  if (input.validUntil !== null) {
    const days = daysUntil(input.validUntil, input.asOf);
    if (days !== null && days < 0) {
      convertFound.push(
        blocking(BLOCKER_CODES.QUOTE_EXPIRED, `Quote expired ${formatDate(input.validUntil)}`),
      );
    }
  }
  if (!input.accepted) {
    convertFound.push(
      blocking(BLOCKER_CODES.QUOTE_NOT_ACCEPTED, 'Customer has not accepted this quote'),
    );
  }

  return [
    availability(WORKFLOW_ACTIONS.SEND_QUOTE, sendFound),
    availability(WORKFLOW_ACTIONS.CONVERT_TO_LOAD, convertFound),
  ];
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export interface LoadCarrierInput {
  name: string;
  suspended: boolean;
  /**
   * Result of `evaluateCarrierCompliance` for this carrier. Passed in rather
   * than recomputed so the gate the UI shows and the gate the server action
   * enforces can never diverge.
   */
  compliance: { allowed: boolean; blockingReasons: string[] } | null;
  /** ISO date; null means no insurance record on file. */
  insuranceExpiry: string | null;
}

export interface LoadActionInput {
  status: LoadStatus;
  /** Null when no carrier is assigned yet. */
  carrier: LoadCarrierInput | null;
  driverAssigned: boolean;
  rateconSigned: boolean;
  hasPickupAddress: boolean;
  hasDeliveryAddress: boolean;
  /** Customer requires a booked delivery appointment for this load. */
  deliveryAppointmentRequired: boolean;
  deliveryAppointmentAt: string | null;
  receiverName: string | null;
  hasPod: boolean;
  podVerified: boolean;
  hasCarrierInvoice: boolean;
  customerBillingEmail: string | null;
  customerPaymentTerms: string | null;
  openExceptionCount: number;
  asOf: Date;
  /** Warn this many days before insurance expiry. Mirrors the compliance gate. */
  insuranceWarnDays?: number;
}

const DEFAULT_INSURANCE_WARN_DAYS = 60;

/** INSURANCE_EXPIRED (blocking) / INSURANCE_EXPIRING (warning), or neither. */
function insuranceBlocker(input: LoadActionInput): Blocker | null {
  const carrier = input.carrier;
  if (!carrier || carrier.insuranceExpiry === null) return null;
  const days = daysUntil(carrier.insuranceExpiry, input.asOf);
  if (days === null) return null;
  if (days < 0) {
    return blocking(
      BLOCKER_CODES.INSURANCE_EXPIRED,
      `${carrier.name} insurance expired ${formatDate(carrier.insuranceExpiry)}`,
    );
  }
  if (days <= (input.insuranceWarnDays ?? DEFAULT_INSURANCE_WARN_DAYS)) {
    return warning(
      BLOCKER_CODES.INSURANCE_EXPIRING,
      `${carrier.name} insurance expires in ${days} days`,
    );
  }
  return null;
}

export function evaluateLoadActions(input: LoadActionInput): ActionAvailability[] {
  const insurance = insuranceBlocker(input);
  const carrier = input.carrier;

  // Assign — the one overrideable tier in §9, and only at booking time.
  const assign: Blocker[] = [];
  if (carrier) {
    if (carrier.suspended) {
      assign.push(blocking(BLOCKER_CODES.CARRIER_SUSPENDED, 'Carrier is suspended'));
    }
    if (carrier.compliance && !carrier.compliance.allowed) {
      assign.push(
        blocking(
          BLOCKER_CODES.CARRIER_NOT_COMPLIANT,
          `${carrier.name} fails compliance: ${carrier.compliance.blockingReasons.join('; ')}`,
          { overrideableBy: 'org_admin' },
        ),
      );
    }
  }

  const sendRatecon: Blocker[] = [];
  if (!carrier) {
    sendRatecon.push(blocking(BLOCKER_CODES.CARRIER_NOT_ASSIGNED, 'No carrier assigned'));
  }

  // Release — hard tier. A booking-time override does not carry forward, so
  // compliance is re-checked here with no overrideableBy.
  const release: Blocker[] = [];
  if (!input.rateconSigned) {
    release.push(blocking(BLOCKER_CODES.RATECON_NOT_SIGNED, 'Rate confirmation not signed'));
  }
  if (!input.driverAssigned) {
    release.push(blocking(BLOCKER_CODES.DRIVER_NOT_ASSIGNED, 'No driver assigned'));
  }
  if (insurance) release.push(insurance);

  const dispatch: Blocker[] = [];
  if (!input.hasPickupAddress || !input.hasDeliveryAddress) {
    dispatch.push(
      blocking(BLOCKER_CODES.STOPS_INCOMPLETE, 'Pickup or delivery address missing'),
    );
  }
  if (insurance) dispatch.push(insurance);

  const delivered: Blocker[] = [];
  if (input.deliveryAppointmentRequired && input.deliveryAppointmentAt === null) {
    delivered.push(
      blocking(BLOCKER_CODES.APPOINTMENT_MISSING, 'Delivery appointment required by customer'),
    );
  }
  if (input.receiverName === null || input.receiverName.trim() === '') {
    delivered.push(
      blocking(BLOCKER_CODES.RECEIVER_UNCONFIRMED, 'Receiver name required at delivery'),
    );
  }

  const invoice: Blocker[] = [];
  if (!input.hasPod) {
    invoice.push(blocking(BLOCKER_CODES.POD_MISSING, 'Proof of delivery not uploaded'));
  } else if (!input.podVerified) {
    // Only meaningful once a POD exists — POD_MISSING already covers the rest.
    invoice.push(blocking(BLOCKER_CODES.POD_UNVERIFIED, 'POD uploaded but not verified'));
  }
  if (input.customerBillingEmail === null || input.customerPaymentTerms === null) {
    invoice.push(
      blocking(BLOCKER_CODES.BILLING_DATA_MISSING, 'Customer billing email / terms missing'),
    );
  }

  const settlement: Blocker[] = [];
  if (!input.hasCarrierInvoice) {
    settlement.push(
      blocking(BLOCKER_CODES.CARRIER_INVOICE_MISSING, 'Carrier invoice not on file'),
    );
  }

  const close: Blocker[] = [];
  if (input.openExceptionCount > 0) {
    close.push(
      blocking(
        BLOCKER_CODES.OPEN_EXCEPTIONS,
        `${input.openExceptionCount} document or financial exceptions open`,
      ),
    );
  }

  return [
    availability(WORKFLOW_ACTIONS.ASSIGN_CARRIER, assign),
    availability(WORKFLOW_ACTIONS.SEND_RATECON, sendRatecon),
    availability(WORKFLOW_ACTIONS.RELEASE_TO_DRIVER, release),
    availability(WORKFLOW_ACTIONS.DISPATCH, dispatch),
    availability(WORKFLOW_ACTIONS.MARK_DELIVERED, delivered),
    availability(WORKFLOW_ACTIONS.CREATE_INVOICE, invoice),
    availability(WORKFLOW_ACTIONS.APPROVE_SETTLEMENT, settlement),
    availability(WORKFLOW_ACTIONS.CLOSE_LOAD, close),
  ];
}

/** The action a load in `status` is currently working towards, if any. */
export function primaryActionFor(status: LoadStatus): WorkflowAction | null {
  switch (status) {
    case LOAD_STATUS.DRAFT:
    case LOAD_STATUS.QUOTED:
      return WORKFLOW_ACTIONS.ASSIGN_CARRIER;
    case LOAD_STATUS.BOOKED:
      return WORKFLOW_ACTIONS.SEND_RATECON;
    case LOAD_STATUS.AWAITING_CARRIER_SIGNATURE:
    case LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE:
      return WORKFLOW_ACTIONS.RELEASE_TO_DRIVER;
    case LOAD_STATUS.RELEASED_TO_DRIVER:
    case LOAD_STATUS.DRIVER_ACKNOWLEDGED:
      return WORKFLOW_ACTIONS.DISPATCH;
    case LOAD_STATUS.DISPATCHED:
    case LOAD_STATUS.IN_TRANSIT:
      return WORKFLOW_ACTIONS.MARK_DELIVERED;
    case LOAD_STATUS.DELIVERED:
      return WORKFLOW_ACTIONS.CREATE_INVOICE;
    case LOAD_STATUS.INVOICED:
      return WORKFLOW_ACTIONS.CLOSE_LOAD;
    case LOAD_STATUS.CLOSED:
      return null;
    default:
      return null;
  }
}
