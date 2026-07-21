/**
 * RFQ lifecycle state machine.
 *
 * Requirement coverage:
 *   FR-RFQ-01  Canonical Phase 1 status sequence: an RFQ starts OPEN and
 *              advances one step at a time as it's quoted, booked into a
 *              load, and finally closed out.
 *   FR-RFQ-02  Transitions are strictly forward and linear, same philosophy
 *              as `loads/lifecycle.ts` — Phase 1 has no "reopen" or
 *              "withdraw" flow, so this stays simple and auditable.
 *
 * Unlike loads, the RFQ status is not advanced by a direct user action on
 * this entity — it's a side effect of what happens to its linked quote/load
 * (see `createQuote`, `createLoadFromQuote`, `advanceLoadStatus`). This
 * module only defines what's legal; the actions guard their own UPDATEs
 * with a `.eq('status', <expected-from>)` WHERE clause so a stale read can
 * never regress or skip a stage.
 */

export const RFQ_STATUS = {
  OPEN: 'open',
  QUOTED: 'quoted',
  BOOKED: 'booked',
  CLOSED: 'closed',
} as const;

export type RfqStatus = (typeof RFQ_STATUS)[keyof typeof RFQ_STATUS];

/** Ordered canonical sequence. */
export const RFQ_STATUS_SEQUENCE: RfqStatus[] = [
  RFQ_STATUS.OPEN,
  RFQ_STATUS.QUOTED,
  RFQ_STATUS.BOOKED,
  RFQ_STATUS.CLOSED,
];

const ALLOWED: Record<RfqStatus, RfqStatus[]> = {
  [RFQ_STATUS.OPEN]: [RFQ_STATUS.QUOTED],
  [RFQ_STATUS.QUOTED]: [RFQ_STATUS.BOOKED],
  [RFQ_STATUS.BOOKED]: [RFQ_STATUS.CLOSED],
  [RFQ_STATUS.CLOSED]: [],
};

/** FR-RFQ-02: Is the transition legal in the Phase 1 lifecycle? */
export function canTransition(from: string, to: RfqStatus): boolean {
  return ALLOWED[from as RfqStatus]?.includes(to) ?? false;
}

export function isValidStatus(value: string): value is RfqStatus {
  return RFQ_STATUS_SEQUENCE.includes(value as RfqStatus);
}

export const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  [RFQ_STATUS.OPEN]: 'Open',
  [RFQ_STATUS.QUOTED]: 'Quoted',
  [RFQ_STATUS.BOOKED]: 'Booked',
  [RFQ_STATUS.CLOSED]: 'Closed',
};
