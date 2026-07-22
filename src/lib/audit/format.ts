/**
 * Pure formatting helpers for rendering audit_log entries (see 0003_audit.sql).
 *
 * Requirement coverage:
 *   FR-AUD-03  An entry's before/after JSONB is rendered as a human-readable
 *              change summary — "status: booked → released_to_driver" — rather
 *              than a raw JSON blob, so the trail is reviewable at a glance.
 *
 * Pure (no Next/Supabase imports) so it's offline-testable. The audit page
 * owns actor/entity rendering (those need request context); the change-diff
 * logic lives here because it has real branching worth pinning down.
 */

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * A compact one-line diff of an audit entry's before/after state, plus an
 * override/action reason if the metadata carries one. Only changed keys are
 * shown; a key present only in `after` renders as a plain assignment.
 */
export function summarizeAuditChange(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  metadata?: Record<string, unknown> | null,
): string {
  const b = before ?? {};
  const a = after ?? {};
  const parts: string[] = [];

  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const bv = b[key];
    const av = a[key];
    if (JSON.stringify(bv) === JSON.stringify(av)) continue;
    parts.push(
      bv !== undefined && av !== undefined
        ? `${key}: ${formatValue(bv)} → ${formatValue(av)}`
        : `${key}: ${formatValue(av !== undefined ? av : bv)}`,
    );
  }

  const reason = metadata?.reason;
  if (typeof reason === 'string' && reason.trim() !== '') parts.push(`reason: ${reason}`);

  return parts.join(' · ');
}
