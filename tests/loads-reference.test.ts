/**
 * FR-LD-01 — LD-#### reference generation (no DB sequence/default).
 */
import { describe, it, expect } from 'vitest';
import { nextLoadReference, formatLoadReference } from '@/lib/loads/reference';

describe('load reference generator', () => {
  it('starts at LD-0001 with no existing references', () => {
    expect(nextLoadReference([])).toBe('LD-0001');
  });

  it('increments past the highest existing reference', () => {
    expect(nextLoadReference(['LD-0001', 'LD-1045', 'LD-0042'])).toBe('LD-1046');
  });

  it('ignores references that do not match the LD-#### pattern', () => {
    expect(nextLoadReference(['LD-0005', 'legacy-ref', 'RC-2048'])).toBe('LD-0006');
  });

  it('does not zero-pad past 4 digits', () => {
    expect(formatLoadReference(10000)).toBe('LD-10000');
  });

  it('is order-independent', () => {
    const forward = nextLoadReference(['LD-0001', 'LD-0002', 'LD-0003']);
    const shuffled = nextLoadReference(['LD-0003', 'LD-0001', 'LD-0002']);
    expect(forward).toBe(shuffled);
  });
});
