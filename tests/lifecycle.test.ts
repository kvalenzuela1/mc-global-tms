/**
 * FR-LD-01/02 + FR-RC-05 — Load lifecycle state machine + rate-con smoke path.
 */
import { describe, it, expect } from 'vitest';
import {
  LOAD_STATUS,
  LOAD_STATUS_SEQUENCE,
  canTransition,
  requiresSignedRateConfirmation,
} from '@/lib/loads/lifecycle';

describe('load lifecycle', () => {
  it('FR-LD-01: canonical sequence is exactly the Phase 1 status list', () => {
    expect(LOAD_STATUS_SEQUENCE).toEqual([
      'draft',
      'quoted',
      'booked',
      'awaiting_carrier_signature',
      'signed_awaiting_broker_release',
      'released_to_driver',
      'driver_acknowledged',
      'dispatched',
      'in_transit',
      'delivered',
      'invoiced',
      'closed',
    ]);
  });

  it('FR-LD-02: allows each legal forward step', () => {
    for (let i = 0; i < LOAD_STATUS_SEQUENCE.length - 1; i++) {
      expect(canTransition(LOAD_STATUS_SEQUENCE[i], LOAD_STATUS_SEQUENCE[i + 1])).toBe(true);
    }
  });

  it('FR-LD-02: rejects skipping a stage', () => {
    expect(canTransition(LOAD_STATUS.DRAFT, LOAD_STATUS.BOOKED)).toBe(false);
    expect(canTransition(LOAD_STATUS.BOOKED, LOAD_STATUS.RELEASED_TO_DRIVER)).toBe(false);
  });

  it('FR-LD-02: rejects moving backwards', () => {
    expect(canTransition(LOAD_STATUS.DELIVERED, LOAD_STATUS.IN_TRANSIT)).toBe(false);
  });

  it('FR-LD-02: closed is terminal', () => {
    expect(canTransition(LOAD_STATUS.CLOSED, LOAD_STATUS.INVOICED)).toBe(false);
  });

  it('FR-RC-05: releasing to a driver requires a signed rate confirmation', () => {
    expect(requiresSignedRateConfirmation(LOAD_STATUS.RELEASED_TO_DRIVER)).toBe(true);
    expect(requiresSignedRateConfirmation(LOAD_STATUS.IN_TRANSIT)).toBe(false);
  });

  it('FR-RC-05 (smoke): full rate-confirmation happy path is walkable step by step', () => {
    // Draft -> ... -> Closed, one legal step at a time (mirrors the workflow).
    let ok = true;
    for (let i = 0; i < LOAD_STATUS_SEQUENCE.length - 1; i++) {
      ok = ok && canTransition(LOAD_STATUS_SEQUENCE[i], LOAD_STATUS_SEQUENCE[i + 1]);
    }
    expect(ok).toBe(true);
  });
});
