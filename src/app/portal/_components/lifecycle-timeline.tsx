/**
 * Horizontal progress rail for a linear record lifecycle.
 *
 * Extracted verbatim from the RFQ detail page's private `RfqTimeline`, made
 * generic over the stage list so loads, quotes, and rate confirmations get the
 * same rail rather than three near-identical copies. Both `loads/lifecycle.ts`
 * and `rfqs/lifecycle.ts` already export a `*_STATUS_SEQUENCE` and a
 * `*_STATUS_LABELS` in exactly the shape this takes.
 *
 * Deliberately does NOT know about status facets — it renders whatever ordered
 * sequence it is handed. A load's operational status is one rail; its rate
 * confirmation is a different one.
 */
export function LifecycleTimeline<T extends string>({
  sequence,
  labels,
  current,
}: {
  sequence: readonly T[];
  labels: Record<T, string>;
  current: T;
}) {
  const currentIndex = sequence.indexOf(current);

  return (
    <ol className="flex items-center" aria-label="Lifecycle progress">
      {sequence.map((stage, i) => {
        const reached = i <= currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <li key={stage} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-2">
              <span
                className={`h-3 w-3 rounded-full ${reached ? 'bg-copper-500' : 'bg-charcoal-600'}`}
                aria-hidden="true"
              />
              <span
                className={`text-xs whitespace-nowrap ${
                  isCurrent ? 'text-ink font-semibold' : 'text-muted'
                }`}
                // Screen readers get the state; sighted users get the colour.
                aria-current={isCurrent ? 'step' : undefined}
              >
                {labels[stage]}
              </span>
            </div>
            {i < sequence.length - 1 && (
              <div
                className={`h-px flex-1 mx-2 mb-5 ${i < currentIndex ? 'bg-copper-500' : 'bg-line'}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
