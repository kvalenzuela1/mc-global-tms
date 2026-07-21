/**
 * RC-#### reference generator for `rate_confirmations.reference`.
 *
 * Requirement coverage:
 *   FR-RC-01  Every rate confirmation has a human-readable reference
 *             (e.g. "RC-2048").
 *
 * Mirrors `src/lib/loads/reference.ts` (LD-####) — kept as its own small,
 * independently-testable module per domain rather than a shared generic
 * "prefixed reference" abstraction for just two call sites.
 */

const REFERENCE_PATTERN = /^RC-(\d+)$/;

const MIN_DIGITS = 4;

export function formatRateconReference(n: number): string {
  return `RC-${String(n).padStart(MIN_DIGITS, '0')}`;
}

export function nextRateconReference(existingReferences: string[]): string {
  const highest = existingReferences.reduce((max, ref) => {
    const match = REFERENCE_PATTERN.exec(ref);
    if (!match) return max;
    const n = Number(match[1]);
    return n > max ? n : max;
  }, 0);
  return formatRateconReference(highest + 1);
}
