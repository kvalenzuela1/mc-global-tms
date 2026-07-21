/**
 * FR-RC-01 — RC-#### reference generation (no DB sequence/default).
 */
import { describe, it, expect } from 'vitest';
import { nextRateconReference, formatRateconReference } from '@/lib/ratecons/reference';

describe('rate confirmation reference generator', () => {
  it('starts at RC-0001 with no existing references', () => {
    expect(nextRateconReference([])).toBe('RC-0001');
  });

  it('increments past the highest existing reference', () => {
    expect(nextRateconReference(['RC-0001', 'RC-2048', 'RC-0042'])).toBe('RC-2049');
  });

  it('ignores references that do not match the RC-#### pattern', () => {
    expect(nextRateconReference(['RC-0005', 'legacy-ref', 'LD-1045'])).toBe('RC-0006');
  });

  it('does not zero-pad past 4 digits', () => {
    expect(formatRateconReference(10000)).toBe('RC-10000');
  });
});
