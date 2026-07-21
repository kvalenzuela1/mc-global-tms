/**
 * FR-RFQ-01/02 — RFQ lifecycle state machine.
 */
import { describe, it, expect } from 'vitest';
import { RFQ_STATUS, RFQ_STATUS_SEQUENCE, canTransition, isValidStatus } from '@/lib/rfqs/lifecycle';

describe('rfq lifecycle', () => {
  it('FR-RFQ-01: canonical sequence is exactly open -> quoted -> booked -> closed', () => {
    expect(RFQ_STATUS_SEQUENCE).toEqual(['open', 'quoted', 'booked', 'closed']);
  });

  it('FR-RFQ-02: allows each legal forward step', () => {
    for (let i = 0; i < RFQ_STATUS_SEQUENCE.length - 1; i++) {
      expect(canTransition(RFQ_STATUS_SEQUENCE[i], RFQ_STATUS_SEQUENCE[i + 1])).toBe(true);
    }
  });

  it('FR-RFQ-02: rejects skipping a stage', () => {
    expect(canTransition(RFQ_STATUS.OPEN, RFQ_STATUS.BOOKED)).toBe(false);
    expect(canTransition(RFQ_STATUS.OPEN, RFQ_STATUS.CLOSED)).toBe(false);
  });

  it('FR-RFQ-02: rejects moving backwards', () => {
    expect(canTransition(RFQ_STATUS.BOOKED, RFQ_STATUS.QUOTED)).toBe(false);
  });

  it('FR-RFQ-02: closed is terminal', () => {
    expect(canTransition(RFQ_STATUS.CLOSED, RFQ_STATUS.BOOKED)).toBe(false);
  });

  it('isValidStatus recognizes only the four canonical values', () => {
    expect(isValidStatus('open')).toBe(true);
    expect(isValidStatus('booked')).toBe(true);
    expect(isValidStatus('pending_approval')).toBe(false);
    expect(isValidStatus('')).toBe(false);
  });
});
