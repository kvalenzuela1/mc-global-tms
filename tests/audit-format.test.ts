/**
 * FR-AUD-03 — audit entry change summaries are human-readable, showing only
 * what changed, with an optional reason from metadata.
 */
import { describe, it, expect } from 'vitest';
import { summarizeAuditChange } from '@/lib/audit/format';

describe('FR-AUD-03: summarizeAuditChange', () => {
  it('renders a status transition as before → after', () => {
    const out = summarizeAuditChange({ status: 'booked' }, { status: 'released_to_driver' });
    expect(out).toBe('status: booked → released_to_driver');
  });

  it('shows a key present only in after as a plain assignment', () => {
    const out = summarizeAuditChange(null, { reference: 'LD-0001', status: 'quoted' });
    expect(out).toContain('reference: LD-0001');
    expect(out).toContain('status: quoted');
  });

  it('omits keys that did not change', () => {
    const out = summarizeAuditChange(
      { status: 'booked', carrier: 'Horizon' },
      { status: 'released_to_driver', carrier: 'Horizon' },
    );
    expect(out).toBe('status: booked → released_to_driver');
  });

  it('appends a reason from metadata when present', () => {
    const out = summarizeAuditChange(
      { allowed: true },
      { allowed: false },
      { reason: 'insurance lapsed', source: 'app' },
    );
    expect(out).toContain('allowed: true → false');
    expect(out).toContain('reason: insurance lapsed');
  });

  it('returns an empty string when nothing changed and no reason', () => {
    expect(summarizeAuditChange({ status: 'closed' }, { status: 'closed' })).toBe('');
    expect(summarizeAuditChange(null, null)).toBe('');
  });

  it('ignores a blank reason', () => {
    expect(summarizeAuditChange(null, null, { reason: '   ' })).toBe('');
  });
});
