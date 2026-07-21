/**
 * FR-WF-01..05 — required-action engine.
 *
 * One test per blocker code in docs/WORKFLOW-REDESIGN.md §9, plus the
 * override-tier and resolver behaviour. Codes are the contract the detail
 * pages will key off, so each is asserted by code rather than by message.
 */
import { describe, it, expect } from 'vitest';
import {
  BLOCKER_CODES,
  WORKFLOW_ACTIONS,
  evaluateLoadActions,
  evaluateQuoteActions,
  evaluateRfqActions,
  primaryActionFor,
  type ActionAvailability,
  type LoadActionInput,
  type QuoteActionInput,
  type WorkflowAction,
} from '@/lib/workflow/actions-available';
import {
  resolveLoadRequiredAction,
  resolveQuoteRequiredAction,
  resolveRfqRequiredAction,
} from '@/lib/workflow/required-action';
import { LOAD_STATUS } from '@/lib/loads/lifecycle';

const NOW = new Date('2026-07-22T00:00:00.000Z');

/** A load with every gate satisfied — each test breaks exactly one thing. */
const CLEAN_LOAD: LoadActionInput = {
  status: LOAD_STATUS.BOOKED,
  carrier: {
    name: 'Horizon Freight LLC',
    suspended: false,
    compliance: { allowed: true, blockingReasons: [] },
    insuranceExpiry: '2027-01-01T00:00:00.000Z',
  },
  driverAssigned: true,
  rateconSigned: true,
  hasPickupAddress: true,
  hasDeliveryAddress: true,
  deliveryAppointmentRequired: false,
  deliveryAppointmentAt: null,
  receiverName: 'A. Receiver',
  hasPod: true,
  podVerified: true,
  hasCarrierInvoice: true,
  customerBillingEmail: 'ap@summitretail.example',
  customerPaymentTerms: 'NET30',
  openExceptionCount: 0,
  asOf: NOW,
};

const CLEAN_QUOTE: QuoteActionInput = {
  overrideStatus: 'none',
  accepted: true,
  validUntil: '2026-08-30T00:00:00.000Z',
  asOf: NOW,
};

function codesFor(actions: ActionAvailability[], action: WorkflowAction): string[] {
  const match = actions.find((a) => a.action === action);
  return (match?.blockers ?? []).map((b) => b.code);
}

function warningCodesFor(actions: ActionAvailability[], action: WorkflowAction): string[] {
  const match = actions.find((a) => a.action === action);
  return (match?.warnings ?? []).map((b) => b.code);
}

function isAvailable(actions: ActionAvailability[], action: WorkflowAction): boolean {
  return actions.find((a) => a.action === action)?.available === true;
}

describe('blocker codes — RFQ and quote', () => {
  it('FR-WF-01: RFQ_FREIGHT_INCOMPLETE blocks create quote when weight or class is missing', () => {
    const missingWeight = evaluateRfqActions({ weightLbs: null, freightClass: '70' });
    expect(codesFor(missingWeight, WORKFLOW_ACTIONS.CREATE_QUOTE)).toContain(
      BLOCKER_CODES.RFQ_FREIGHT_INCOMPLETE,
    );

    const missingClass = evaluateRfqActions({ weightLbs: 4200, freightClass: null });
    expect(codesFor(missingClass, WORKFLOW_ACTIONS.CREATE_QUOTE)).toContain(
      BLOCKER_CODES.RFQ_FREIGHT_INCOMPLETE,
    );

    const complete = evaluateRfqActions({ weightLbs: 4200, freightClass: '70' });
    expect(isAvailable(complete, WORKFLOW_ACTIONS.CREATE_QUOTE)).toBe(true);
  });

  it('FR-WF-01: QUOTE_OVERRIDE_PENDING blocks send quote until a manager approves', () => {
    const pending = evaluateQuoteActions({ ...CLEAN_QUOTE, overrideStatus: 'pending' });
    expect(codesFor(pending, WORKFLOW_ACTIONS.SEND_QUOTE)).toContain(
      BLOCKER_CODES.QUOTE_OVERRIDE_PENDING,
    );

    const approved = evaluateQuoteActions({ ...CLEAN_QUOTE, overrideStatus: 'approved' });
    expect(isAvailable(approved, WORKFLOW_ACTIONS.SEND_QUOTE)).toBe(true);
  });

  it('FR-WF-01: QUOTE_EXPIRED blocks conversion once valid_until has passed', () => {
    const expired = evaluateQuoteActions({ ...CLEAN_QUOTE, validUntil: '2026-07-01T00:00:00.000Z' });
    expect(codesFor(expired, WORKFLOW_ACTIONS.CONVERT_TO_LOAD)).toContain(
      BLOCKER_CODES.QUOTE_EXPIRED,
    );

    // Not yet populated (pre-C5 rows) must not read as expired.
    const noExpiry = evaluateQuoteActions({ ...CLEAN_QUOTE, validUntil: null });
    expect(isAvailable(noExpiry, WORKFLOW_ACTIONS.CONVERT_TO_LOAD)).toBe(true);
  });

  it('FR-WF-01: QUOTE_NOT_ACCEPTED blocks conversion until the customer accepts', () => {
    const unaccepted = evaluateQuoteActions({ ...CLEAN_QUOTE, accepted: false });
    expect(codesFor(unaccepted, WORKFLOW_ACTIONS.CONVERT_TO_LOAD)).toContain(
      BLOCKER_CODES.QUOTE_NOT_ACCEPTED,
    );
    expect(isAvailable(evaluateQuoteActions(CLEAN_QUOTE), WORKFLOW_ACTIONS.CONVERT_TO_LOAD)).toBe(
      true,
    );
  });
});

describe('blocker codes — carrier and release', () => {
  it('FR-WF-01: CARRIER_NOT_ASSIGNED blocks sending a rate confirmation', () => {
    const noCarrier = evaluateLoadActions({ ...CLEAN_LOAD, carrier: null });
    expect(codesFor(noCarrier, WORKFLOW_ACTIONS.SEND_RATECON)).toContain(
      BLOCKER_CODES.CARRIER_NOT_ASSIGNED,
    );
    expect(isAvailable(evaluateLoadActions(CLEAN_LOAD), WORKFLOW_ACTIONS.SEND_RATECON)).toBe(true);
  });

  it('FR-WF-03: CARRIER_NOT_COMPLIANT blocks assignment and is overrideable by org_admin', () => {
    const actions = evaluateLoadActions({
      ...CLEAN_LOAD,
      carrier: {
        ...CLEAN_LOAD.carrier!,
        compliance: { allowed: false, blockingReasons: ['AUTHORITY_NOT_ACTIVE'] },
      },
    });
    const assign = actions.find((a) => a.action === WORKFLOW_ACTIONS.ASSIGN_CARRIER);
    const blocker = assign?.blockers.find((b) => b.code === BLOCKER_CODES.CARRIER_NOT_COMPLIANT);
    expect(blocker?.overrideableBy).toBe('org_admin');
    // The reasons are carried through, not swallowed.
    expect(blocker?.message).toContain('AUTHORITY_NOT_ACTIVE');
  });

  it('FR-WF-03: CARRIER_SUSPENDED blocks assignment and is NOT overrideable', () => {
    const actions = evaluateLoadActions({
      ...CLEAN_LOAD,
      carrier: { ...CLEAN_LOAD.carrier!, suspended: true },
    });
    const assign = actions.find((a) => a.action === WORKFLOW_ACTIONS.ASSIGN_CARRIER);
    const blocker = assign?.blockers.find((b) => b.code === BLOCKER_CODES.CARRIER_SUSPENDED);
    expect(blocker?.overrideableBy).toBe(undefined);
    expect(assign?.available).toBe(false);
  });

  it('FR-WF-03: RATECON_NOT_SIGNED blocks release and is NOT overrideable', () => {
    const actions = evaluateLoadActions({ ...CLEAN_LOAD, rateconSigned: false });
    const release = actions.find((a) => a.action === WORKFLOW_ACTIONS.RELEASE_TO_DRIVER);
    const blocker = release?.blockers.find((b) => b.code === BLOCKER_CODES.RATECON_NOT_SIGNED);
    expect(blocker?.overrideableBy).toBe(undefined);
    expect(release?.available).toBe(false);
  });

  it('FR-WF-03: a booking-time compliance override does not carry forward to release', () => {
    // The M4 safety property: non-compliant + signed ratecon + driver assigned
    // still cannot release, and nothing on the release gate is overrideable.
    const actions = evaluateLoadActions({
      ...CLEAN_LOAD,
      carrier: {
        ...CLEAN_LOAD.carrier!,
        compliance: { allowed: false, blockingReasons: ['AUTHORITY_NOT_ACTIVE'] },
        insuranceExpiry: '2026-01-01T00:00:00.000Z',
      },
    });
    const release = actions.find((a) => a.action === WORKFLOW_ACTIONS.RELEASE_TO_DRIVER);
    expect(release?.available).toBe(false);
    expect(release?.blockers.filter((b) => b.overrideableBy !== undefined)).toHaveLength(0);
  });

  it('FR-WF-01: DRIVER_NOT_ASSIGNED blocks release to driver', () => {
    const actions = evaluateLoadActions({ ...CLEAN_LOAD, driverAssigned: false });
    expect(codesFor(actions, WORKFLOW_ACTIONS.RELEASE_TO_DRIVER)).toContain(
      BLOCKER_CODES.DRIVER_NOT_ASSIGNED,
    );
  });
});

describe('blocker codes — execution', () => {
  it('FR-WF-01: STOPS_INCOMPLETE blocks dispatch when either address is missing', () => {
    const noPickup = evaluateLoadActions({ ...CLEAN_LOAD, hasPickupAddress: false });
    expect(codesFor(noPickup, WORKFLOW_ACTIONS.DISPATCH)).toContain(
      BLOCKER_CODES.STOPS_INCOMPLETE,
    );

    const noDelivery = evaluateLoadActions({ ...CLEAN_LOAD, hasDeliveryAddress: false });
    expect(codesFor(noDelivery, WORKFLOW_ACTIONS.DISPATCH)).toContain(
      BLOCKER_CODES.STOPS_INCOMPLETE,
    );
  });

  it('FR-WF-01: APPOINTMENT_MISSING blocks delivery only when the customer requires one', () => {
    const required = evaluateLoadActions({
      ...CLEAN_LOAD,
      deliveryAppointmentRequired: true,
      deliveryAppointmentAt: null,
    });
    expect(codesFor(required, WORKFLOW_ACTIONS.MARK_DELIVERED)).toContain(
      BLOCKER_CODES.APPOINTMENT_MISSING,
    );

    const notRequired = evaluateLoadActions({ ...CLEAN_LOAD, deliveryAppointmentRequired: false });
    expect(isAvailable(notRequired, WORKFLOW_ACTIONS.MARK_DELIVERED)).toBe(true);
  });

  it('FR-WF-01: RECEIVER_UNCONFIRMED blocks delivery when no receiver is named', () => {
    const missing = evaluateLoadActions({ ...CLEAN_LOAD, receiverName: null });
    expect(codesFor(missing, WORKFLOW_ACTIONS.MARK_DELIVERED)).toContain(
      BLOCKER_CODES.RECEIVER_UNCONFIRMED,
    );

    // Whitespace is not a name.
    const blank = evaluateLoadActions({ ...CLEAN_LOAD, receiverName: '   ' });
    expect(codesFor(blank, WORKFLOW_ACTIONS.MARK_DELIVERED)).toContain(
      BLOCKER_CODES.RECEIVER_UNCONFIRMED,
    );
  });
});

describe('blocker codes — finance', () => {
  it('FR-WF-01: POD_MISSING blocks invoicing', () => {
    const actions = evaluateLoadActions({ ...CLEAN_LOAD, hasPod: false, podVerified: false });
    expect(codesFor(actions, WORKFLOW_ACTIONS.CREATE_INVOICE)).toContain(
      BLOCKER_CODES.POD_MISSING,
    );
  });

  it('FR-WF-01: POD_UNVERIFIED blocks invoicing, and does not double-report with POD_MISSING', () => {
    const unverified = evaluateLoadActions({ ...CLEAN_LOAD, hasPod: true, podVerified: false });
    expect(codesFor(unverified, WORKFLOW_ACTIONS.CREATE_INVOICE)).toEqual([
      BLOCKER_CODES.POD_UNVERIFIED,
    ]);

    // No POD at all reports only the missing code — "unverified" would be noise.
    const missing = evaluateLoadActions({ ...CLEAN_LOAD, hasPod: false, podVerified: false });
    expect(codesFor(missing, WORKFLOW_ACTIONS.CREATE_INVOICE)).toEqual([
      BLOCKER_CODES.POD_MISSING,
    ]);
  });

  it('FR-WF-01: BILLING_DATA_MISSING blocks invoicing without billing email or terms', () => {
    const noEmail = evaluateLoadActions({ ...CLEAN_LOAD, customerBillingEmail: null });
    expect(codesFor(noEmail, WORKFLOW_ACTIONS.CREATE_INVOICE)).toContain(
      BLOCKER_CODES.BILLING_DATA_MISSING,
    );

    const noTerms = evaluateLoadActions({ ...CLEAN_LOAD, customerPaymentTerms: null });
    expect(codesFor(noTerms, WORKFLOW_ACTIONS.CREATE_INVOICE)).toContain(
      BLOCKER_CODES.BILLING_DATA_MISSING,
    );
  });

  it('FR-WF-01: CARRIER_INVOICE_MISSING blocks settlement approval', () => {
    const actions = evaluateLoadActions({ ...CLEAN_LOAD, hasCarrierInvoice: false });
    expect(codesFor(actions, WORKFLOW_ACTIONS.APPROVE_SETTLEMENT)).toContain(
      BLOCKER_CODES.CARRIER_INVOICE_MISSING,
    );
  });

  it('FR-WF-01: OPEN_EXCEPTIONS blocks closing the load and reports the count', () => {
    const actions = evaluateLoadActions({ ...CLEAN_LOAD, openExceptionCount: 3 });
    const close = actions.find((a) => a.action === WORKFLOW_ACTIONS.CLOSE_LOAD);
    expect(close?.available).toBe(false);
    expect(close?.blockers[0]?.message).toContain('3 document or financial exceptions');
  });
});

describe('insurance expiry — the warning/blocking boundary', () => {
  it('FR-WF-02: INSURANCE_EXPIRING warns without disabling the action', () => {
    const actions = evaluateLoadActions({
      ...CLEAN_LOAD,
      carrier: { ...CLEAN_LOAD.carrier!, insuranceExpiry: '2026-08-05T00:00:00.000Z' },
    });
    expect(warningCodesFor(actions, WORKFLOW_ACTIONS.RELEASE_TO_DRIVER)).toContain(
      BLOCKER_CODES.INSURANCE_EXPIRING,
    );
    // A warning must never block — this is the distinction §9 draws.
    expect(isAvailable(actions, WORKFLOW_ACTIONS.RELEASE_TO_DRIVER)).toBe(true);
  });

  it('FR-WF-01: INSURANCE_EXPIRED blocks both release and dispatch', () => {
    const actions = evaluateLoadActions({
      ...CLEAN_LOAD,
      carrier: { ...CLEAN_LOAD.carrier!, insuranceExpiry: '2026-06-01T00:00:00.000Z' },
    });
    expect(codesFor(actions, WORKFLOW_ACTIONS.RELEASE_TO_DRIVER)).toContain(
      BLOCKER_CODES.INSURANCE_EXPIRED,
    );
    expect(codesFor(actions, WORKFLOW_ACTIONS.DISPATCH)).toContain(
      BLOCKER_CODES.INSURANCE_EXPIRED,
    );
  });

  it('FR-WF-02: expiry far in the future produces neither a warning nor a blocker', () => {
    const actions = evaluateLoadActions(CLEAN_LOAD);
    expect(warningCodesFor(actions, WORKFLOW_ACTIONS.RELEASE_TO_DRIVER)).toHaveLength(0);
    expect(codesFor(actions, WORKFLOW_ACTIONS.RELEASE_TO_DRIVER)).toHaveLength(0);
  });
});

describe('primaryActionFor', () => {
  it('FR-WF-04: every lifecycle status maps to an action except closed', () => {
    expect(primaryActionFor(LOAD_STATUS.BOOKED)).toBe(WORKFLOW_ACTIONS.SEND_RATECON);
    expect(primaryActionFor(LOAD_STATUS.AWAITING_CARRIER_SIGNATURE)).toBe(
      WORKFLOW_ACTIONS.RELEASE_TO_DRIVER,
    );
    expect(primaryActionFor(LOAD_STATUS.DELIVERED)).toBe(WORKFLOW_ACTIONS.CREATE_INVOICE);
    expect(primaryActionFor(LOAD_STATUS.INVOICED)).toBe(WORKFLOW_ACTIONS.CLOSE_LOAD);
    expect(primaryActionFor(LOAD_STATUS.CLOSED)).toBeNull();
  });
});

describe('resolveLoadRequiredAction', () => {
  it('FR-WF-05: a blocking gate disables the CTA and states the reason', () => {
    const action = resolveLoadRequiredAction({
      ...CLEAN_LOAD,
      status: LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE,
      driverAssigned: false,
    });
    expect(action.cta?.enabled).toBe(false);
    expect(action.cta?.reason).toBe('No driver assigned');
    expect(action.cta?.action).toBe(WORKFLOW_ACTIONS.RELEASE_TO_DRIVER);
  });

  it('FR-WF-05: a clear path enables the CTA with no reason', () => {
    const action = resolveLoadRequiredAction({
      ...CLEAN_LOAD,
      status: LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE,
    });
    expect(action.cta?.enabled).toBe(true);
    expect(action.cta?.reason).toBe(undefined);
    expect(action.blockers).toHaveLength(0);
  });

  it('FR-WF-04: awaiting signature names the carrier and the rate confirmation', () => {
    const action = resolveLoadRequiredAction({
      ...CLEAN_LOAD,
      status: LOAD_STATUS.AWAITING_CARRIER_SIGNATURE,
      rateconSigned: false,
      rateconReference: 'RC-2048',
    });
    expect(action.owner).toBe('carrier');
    expect(action.ownerName).toBe('Horizon Freight LLC');
    expect(action.next).toBe('Carrier must sign RC-2048');
  });

  it('FR-WF-04: a closed load has nothing outstanding and offers no CTA', () => {
    const action = resolveLoadRequiredAction({ ...CLEAN_LOAD, status: LOAD_STATUS.CLOSED });
    expect(action.next).toBe('Nothing outstanding');
    expect(action.cta).toBe(undefined);
    expect(action.blockers).toHaveLength(0);
  });

  it('FR-WF-04: delivered hands ownership to finance', () => {
    const action = resolveLoadRequiredAction({ ...CLEAN_LOAD, status: LOAD_STATUS.DELIVERED });
    expect(action.owner).toBe('finance');
    expect(action.stage).toBe('Delivered');
  });
});

describe('resolveRfqRequiredAction / resolveQuoteRequiredAction', () => {
  it('FR-WF-04: an incomplete RFQ is owned by the broker and blocked on freight details', () => {
    const action = resolveRfqRequiredAction({ weightLbs: null, freightClass: null });
    expect(action.owner).toBe('broker');
    expect(action.cta?.enabled).toBe(false);
    expect(action.blockers[0]?.code).toBe(BLOCKER_CODES.RFQ_FREIGHT_INCOMPLETE);
  });

  it('FR-WF-04: a sent, unaccepted quote is owned by the customer', () => {
    const action = resolveQuoteRequiredAction({
      ...CLEAN_QUOTE,
      accepted: false,
      sent: true,
      customerName: 'Summit Retail',
    });
    expect(action.owner).toBe('customer');
    expect(action.ownerName).toBe('Summit Retail');
    expect(action.cta?.enabled).toBe(false);
  });

  it('FR-WF-04: an unsent quote with a pending override is owned by the broker', () => {
    const action = resolveQuoteRequiredAction({
      ...CLEAN_QUOTE,
      overrideStatus: 'pending',
      sent: false,
    });
    expect(action.owner).toBe('broker');
    expect(action.stage).toBe('Override pending approval');
    expect(action.blockers[0]?.code).toBe(BLOCKER_CODES.QUOTE_OVERRIDE_PENDING);
  });
});
