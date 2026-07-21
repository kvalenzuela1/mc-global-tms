/**
 * LD-#### reference generator for `loads.reference`.
 *
 * Requirement coverage:
 *   FR-LD-01  Every load has a human-readable reference (e.g. "LD-1045").
 *
 * `reference` has no DB default and no backing sequence, so the next number is
 * computed from the org's existing references. Pure and free of Next/Supabase
 * imports so it runs under `npm run test:offline`; the data-access side (fetch
 * existing references, insert, retry on unique-constraint conflict) lives in
 * the loads server actions, which pair this with the
 * `loads_org_reference_unique` constraint from migration 0005.
 */

const REFERENCE_PATTERN = /^LD-(\d+)$/;

/** Lowest number of digits a generated reference is padded to. */
const MIN_DIGITS = 4;

export function formatLoadReference(n: number): string {
  return `LD-${String(n).padStart(MIN_DIGITS, '0')}`;
}

/**
 * Given every existing reference (any org, any format), return the next
 * LD-#### reference. Unrecognized references are ignored rather than
 * rejected, so hand-entered or legacy references never break generation.
 */
export function nextLoadReference(existingReferences: string[]): string {
  const highest = existingReferences.reduce((max, ref) => {
    const match = REFERENCE_PATTERN.exec(ref);
    if (!match) return max;
    const n = Number(match[1]);
    return n > max ? n : max;
  }, 0);
  return formatLoadReference(highest + 1);
}
