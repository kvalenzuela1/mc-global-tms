import { STATUS_FACET, badgeClassFor, labelFor, type StatusFacet } from '@/lib/ui/status-tone';

export { STATUS_FACET };

/**
 * The one status badge. Colour and wording come from `lib/ui/status-tone.ts`
 * (pure, tested offline) — this is only the renderer, so there is exactly one
 * place to change how a status looks and exactly one place to test what it
 * means.
 *
 * Server component: no interactivity, so it stays out of the client bundle.
 */
export function StatusBadge({
  facet,
  value,
  className = '',
}: {
  facet: StatusFacet;
  value: string;
  className?: string;
}) {
  return (
    <span className={`${badgeClassFor(facet, value)} ${className}`.trim()}>
      {labelFor(facet, value)}
    </span>
  );
}
