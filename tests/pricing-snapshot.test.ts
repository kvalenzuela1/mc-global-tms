/**
 * commercial_snapshot readers must tolerate both the pricing engine's own
 * camelCase and older snake_case seed data — see loads/page.tsx and
 * portal/ratecons/actions.ts.
 */
import { describe, it, expect } from 'vitest';
import { readSnapshotCents } from '@/lib/pricing/snapshot';

describe('readSnapshotCents', () => {
  it('reads the camelCase key produced by computePricing()', () => {
    expect(readSnapshotCents({ marginAmountCents: 43902 }, 'marginAmountCents', 'margin_amount_cents')).toBe(
      43902,
    );
  });

  it('falls back to the snake_case key used by older seed data', () => {
    expect(readSnapshotCents({ margin_amount_cents: 43902 }, 'marginAmountCents', 'margin_amount_cents')).toBe(
      43902,
    );
  });

  it('prefers camelCase when both are present', () => {
    expect(
      readSnapshotCents(
        { marginAmountCents: 1, margin_amount_cents: 2 },
        'marginAmountCents',
        'margin_amount_cents',
      ),
    ).toBe(1);
  });

  it('returns undefined for a missing field or missing snapshot', () => {
    expect(readSnapshotCents({}, 'marginAmountCents', 'margin_amount_cents')).toBe(undefined);
    expect(readSnapshotCents(null, 'marginAmountCents', 'margin_amount_cents')).toBe(undefined);
  });

  it('ignores a non-numeric value rather than returning it', () => {
    expect(
      readSnapshotCents({ marginAmountCents: '43902' }, 'marginAmountCents', 'margin_amount_cents'),
    ).toBe(undefined);
  });
});
