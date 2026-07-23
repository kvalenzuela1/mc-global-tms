/**
 * FR-UX-01/02 — one status vocabulary across every screen.
 */
import { describe, it, expect } from 'vitest';
import {
  STATUS_FACET,
  STATUS_TONE,
  toneFor,
  labelFor,
  humanise,
  badgeClassFor,
} from '@/lib/ui/status-tone';
import { LOAD_STATUS_SEQUENCE } from '@/lib/loads/lifecycle';
import { RFQ_STATUS_SEQUENCE } from '@/lib/rfqs/lifecycle';

describe('status tone', () => {
  it('FR-UX-01: every canonical load status has a tone and a label', () => {
    for (const status of LOAD_STATUS_SEQUENCE) {
      const tone = toneFor(STATUS_FACET.LOAD, status);
      expect([STATUS_TONE.OK, STATUS_TONE.WARN, STATUS_TONE.MUTED, STATUS_TONE.DANGER].includes(tone)).toBe(true);
      expect(labelFor(STATUS_FACET.LOAD, status).length > 0).toBe(true);
    }
  });

  it('FR-UX-01: every canonical RFQ status has a tone and a label', () => {
    for (const status of RFQ_STATUS_SEQUENCE) {
      const tone = toneFor(STATUS_FACET.RFQ, status);
      expect([STATUS_TONE.OK, STATUS_TONE.WARN, STATUS_TONE.MUTED, STATUS_TONE.DANGER].includes(tone)).toBe(true);
      expect(labelFor(STATUS_FACET.RFQ, status).length > 0).toBe(true);
    }
  });

  it('FR-UX-01: settled states are ok on every facet', () => {
    expect(toneFor(STATUS_FACET.LOAD, 'closed')).toBe(STATUS_TONE.OK);
    expect(toneFor(STATUS_FACET.RFQ, 'closed')).toBe(STATUS_TONE.OK);
    expect(toneFor(STATUS_FACET.QUOTE, 'approved')).toBe(STATUS_TONE.OK);
    expect(toneFor(STATUS_FACET.RATECON, 'signed')).toBe(STATUS_TONE.OK);
    expect(toneFor(STATUS_FACET.CARRIER, 'approved')).toBe(STATUS_TONE.OK);
    expect(toneFor(STATUS_FACET.COMPLIANCE, 'compliant')).toBe(STATUS_TONE.OK);
    expect(toneFor(STATUS_FACET.CUSTOMER, 'active')).toBe(STATUS_TONE.OK);
  });

  it('FR-UX-01/02: customer relationship states carry tone + label', () => {
    expect(toneFor(STATUS_FACET.CUSTOMER, 'on_hold')).toBe(STATUS_TONE.WARN);
    expect(toneFor(STATUS_FACET.CUSTOMER, 'prospect')).toBe(STATUS_TONE.MUTED);
    expect(labelFor(STATUS_FACET.CUSTOMER, 'on_hold')).toBe('On hold');
    expect(toneFor(STATUS_FACET.CUSTOMER, 'nonsense')).toBe(STATUS_TONE.MUTED);
  });

  it('FR-UX-01/02: document lifecycle states carry tone + label', () => {
    expect(toneFor(STATUS_FACET.DOCUMENT, 'verified')).toBe(STATUS_TONE.OK);
    expect(toneFor(STATUS_FACET.DOCUMENT, 'rejected')).toBe(STATUS_TONE.DANGER);
    expect(toneFor(STATUS_FACET.DOCUMENT, 'uploaded')).toBe(STATUS_TONE.WARN);
    expect(labelFor(STATUS_FACET.DOCUMENT, 'verified')).toBe('Verified');
    expect(toneFor(STATUS_FACET.DOCUMENT, 'nonsense')).toBe(STATUS_TONE.MUTED);
  });

  it('FR-UX-01: failure states are danger, not muted', () => {
    // The regression this module exists to fix: a rejected quote and a
    // suspended carrier both used to render in the same neutral grey as an
    // idle-but-fine record.
    expect(toneFor(STATUS_FACET.QUOTE, 'rejected')).toBe(STATUS_TONE.DANGER);
    expect(toneFor(STATUS_FACET.CARRIER, 'suspended')).toBe(STATUS_TONE.DANGER);
    expect(toneFor(STATUS_FACET.CARRIER, 'rejected')).toBe(STATUS_TONE.DANGER);
    expect(toneFor(STATUS_FACET.COMPLIANCE, 'blocked')).toBe(STATUS_TONE.DANGER);
  });

  it('FR-UX-01: a status awaiting an external party is muted, not warn', () => {
    // The broker cannot act on either of these; warn is reserved for work the
    // viewer can actually pick up.
    expect(toneFor(STATUS_FACET.LOAD, 'awaiting_carrier_signature')).toBe(STATUS_TONE.MUTED);
    expect(toneFor(STATUS_FACET.RATECON, 'sent')).toBe(STATUS_TONE.MUTED);
  });

  it('FR-UX-01: work the broker owes is warn', () => {
    expect(toneFor(STATUS_FACET.LOAD, 'signed_awaiting_broker_release')).toBe(STATUS_TONE.WARN);
    expect(toneFor(STATUS_FACET.RFQ, 'open')).toBe(STATUS_TONE.WARN);
    expect(toneFor(STATUS_FACET.QUOTE, 'pending_approval')).toBe(STATUS_TONE.WARN);
  });

  it('FR-UX-01: an unknown status degrades to muted rather than throwing', () => {
    expect(toneFor(STATUS_FACET.LOAD, 'teleported')).toBe(STATUS_TONE.MUTED);
    expect(toneFor(STATUS_FACET.CARRIER, '')).toBe(STATUS_TONE.MUTED);
  });

  it('FR-UX-02: raw snake_case never reaches the user', () => {
    expect(labelFor(STATUS_FACET.QUOTE, 'pending_approval')).toBe('Pending approval');
    expect(labelFor(STATUS_FACET.LOAD, 'in_transit')).toBe('In Transit');
    // Unknown values are humanised too, so a status added in the database
    // before it is added here still reads acceptably.
    expect(labelFor(STATUS_FACET.LOAD, 'lost_at_sea')).toBe('Lost at sea');
  });

  it('humanise handles the empty string', () => {
    expect(humanise('')).toBe('');
  });

  it('badgeClassFor emits the base class plus exactly one tone class', () => {
    expect(badgeClassFor(STATUS_FACET.CARRIER, 'approved')).toBe('badge badge-ok');
    expect(badgeClassFor(STATUS_FACET.CARRIER, 'suspended')).toBe('badge badge-danger');
  });
});
