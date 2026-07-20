/**
 * Load lifecycle state machine.
 *
 * Requirement coverage:
 *   FR-LD-01  Canonical Phase 1 status sequence (build spec).
 *   FR-LD-02  Transitions are validated by the service layer; illegal jumps
 *             are rejected and never persisted.
 *   FR-RC-05  "Released to Driver" cannot be reached until a signed rate
 *             confirmation exists (enforced in the release service via
 *             `requiresSignedRateConfirmation`).
 *
 * Source: build spec status sequence + Operating Workflow lifecycle table.
 */

export const LOAD_STATUS = {
  DRAFT: 'draft',
  QUOTED: 'quoted',
  BOOKED: 'booked',
  AWAITING_CARRIER_SIGNATURE: 'awaiting_carrier_signature',
  SIGNED_AWAITING_BROKER_RELEASE: 'signed_awaiting_broker_release',
  RELEASED_TO_DRIVER: 'released_to_driver',
  DRIVER_ACKNOWLEDGED: 'driver_acknowledged',
  DISPATCHED: 'dispatched',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  INVOICED: 'invoiced',
  CLOSED: 'closed',
} as const;

export type LoadStatus = (typeof LOAD_STATUS)[keyof typeof LOAD_STATUS];

/** Ordered canonical sequence. */
export const LOAD_STATUS_SEQUENCE: LoadStatus[] = [
  LOAD_STATUS.DRAFT,
  LOAD_STATUS.QUOTED,
  LOAD_STATUS.BOOKED,
  LOAD_STATUS.AWAITING_CARRIER_SIGNATURE,
  LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE,
  LOAD_STATUS.RELEASED_TO_DRIVER,
  LOAD_STATUS.DRIVER_ACKNOWLEDGED,
  LOAD_STATUS.DISPATCHED,
  LOAD_STATUS.IN_TRANSIT,
  LOAD_STATUS.DELIVERED,
  LOAD_STATUS.INVOICED,
  LOAD_STATUS.CLOSED,
];

/**
 * Allowed forward transitions. Phase 1 is strictly linear except that any
 * active load may be CANCELLED is intentionally NOT modeled here — cancellation
 * is a Phase 2 controlled flow. This keeps the pilot auditable and simple.
 */
const ALLOWED: Record<LoadStatus, LoadStatus[]> = {
  [LOAD_STATUS.DRAFT]: [LOAD_STATUS.QUOTED],
  [LOAD_STATUS.QUOTED]: [LOAD_STATUS.BOOKED],
  [LOAD_STATUS.BOOKED]: [LOAD_STATUS.AWAITING_CARRIER_SIGNATURE],
  [LOAD_STATUS.AWAITING_CARRIER_SIGNATURE]: [LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE],
  [LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE]: [LOAD_STATUS.RELEASED_TO_DRIVER],
  [LOAD_STATUS.RELEASED_TO_DRIVER]: [LOAD_STATUS.DRIVER_ACKNOWLEDGED],
  [LOAD_STATUS.DRIVER_ACKNOWLEDGED]: [LOAD_STATUS.DISPATCHED],
  [LOAD_STATUS.DISPATCHED]: [LOAD_STATUS.IN_TRANSIT],
  [LOAD_STATUS.IN_TRANSIT]: [LOAD_STATUS.DELIVERED],
  [LOAD_STATUS.DELIVERED]: [LOAD_STATUS.INVOICED],
  [LOAD_STATUS.INVOICED]: [LOAD_STATUS.CLOSED],
  [LOAD_STATUS.CLOSED]: [],
};

/** FR-LD-02: Is the transition legal in the Phase 1 lifecycle? */
export function canTransition(from: LoadStatus, to: LoadStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function nextStatuses(from: LoadStatus): LoadStatus[] {
  return [...(ALLOWED[from] ?? [])];
}

/**
 * FR-RC-05: The release step (SIGNED_AWAITING_BROKER_RELEASE -> RELEASED_TO_DRIVER)
 * requires a signed rate confirmation on record. The release service must pass
 * `hasSignedRateConfirmation`.
 */
export function requiresSignedRateConfirmation(to: LoadStatus): boolean {
  return to === LOAD_STATUS.RELEASED_TO_DRIVER;
}

export function isValidStatus(value: string): value is LoadStatus {
  return LOAD_STATUS_SEQUENCE.includes(value as LoadStatus);
}

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  [LOAD_STATUS.DRAFT]: 'Draft',
  [LOAD_STATUS.QUOTED]: 'Quoted',
  [LOAD_STATUS.BOOKED]: 'Booked',
  [LOAD_STATUS.AWAITING_CARRIER_SIGNATURE]: 'Awaiting Carrier Signature',
  [LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE]: 'Signed / Awaiting Broker Release',
  [LOAD_STATUS.RELEASED_TO_DRIVER]: 'Released to Driver',
  [LOAD_STATUS.DRIVER_ACKNOWLEDGED]: 'Driver Acknowledged',
  [LOAD_STATUS.DISPATCHED]: 'Dispatched',
  [LOAD_STATUS.IN_TRANSIT]: 'In Transit',
  [LOAD_STATUS.DELIVERED]: 'Delivered',
  [LOAD_STATUS.INVOICED]: 'Invoiced',
  [LOAD_STATUS.CLOSED]: 'Closed',
};
