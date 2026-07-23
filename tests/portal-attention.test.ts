/**
 * FR-UX-04 — the broker dashboard "Needs attention" worklist.
 */
import { describe, it, expect } from 'vitest';
import { buildAttentionItems, type AttentionCounts } from '@/lib/portal/attention';

const EMPTY: AttentionCounts = {
  carriersBlocked: 0,
  documentsExpiringSoon: 0,
  loadsAwaitingRelease: 0,
  quotesPendingApproval: 0,
  documentsAwaitingReview: 0,
};

describe('needs-attention worklist', () => {
  it('FR-UX-04: a clear desk produces an empty worklist', () => {
    expect(buildAttentionItems(EMPTY)).toEqual([]);
  });

  it('FR-UX-04: only positive counts surface, carrying their count', () => {
    const items = buildAttentionItems({ ...EMPTY, quotesPendingApproval: 3 });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('quotes_pending_approval');
    expect(items[0].count).toBe(3);
  });

  it('FR-UX-04: danger items rank above warn items', () => {
    const items = buildAttentionItems({
      ...EMPTY,
      carriersBlocked: 1,
      loadsAwaitingRelease: 2,
    });
    expect(items.map((i) => i.key)).toEqual(['carriers_blocked', 'loads_awaiting_release']);
    expect(items[0].tone).toBe('danger');
    expect(items[1].tone).toBe('warn');
  });

  it('FR-UX-04: every surfaced item links into the portal', () => {
    const items = buildAttentionItems({
      carriersBlocked: 1,
      documentsExpiringSoon: 1,
      loadsAwaitingRelease: 1,
      quotesPendingApproval: 1,
      documentsAwaitingReview: 1,
    });
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.href.startsWith('/portal/')).toBe(true);
    }
  });
});
