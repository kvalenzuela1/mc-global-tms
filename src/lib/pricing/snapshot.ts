/**
 * Reads a field out of a `commercial_snapshot` / `pricing_snapshot` JSONB
 * blob, tolerant of two naming conventions that both exist in this database:
 * the pricing engine's own camelCase (`computePricing()`'s `PricingResult`,
 * what every current writer stores) and the snake_case used by older
 * hand-written seed data. Prefer camelCase in new writers; this exists so a
 * reader doesn't silently show "—" for perfectly good older data instead of
 * the actual figure.
 */
export function readSnapshotCents(
  snapshot: Record<string, unknown> | null | undefined,
  camelKey: string,
  snakeKey: string,
): number | undefined {
  if (!snapshot) return undefined;
  const camel = snapshot[camelKey];
  if (typeof camel === 'number') return camel;
  const snake = snapshot[snakeKey];
  if (typeof snake === 'number') return snake;
  return undefined;
}
