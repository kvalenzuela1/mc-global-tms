import Link from 'next/link';

/**
 * Record-detail breadcrumb (UX-02).
 *
 * Replaces the ad-hoc "← Back to X" text links, which only ever pointed at one
 * hardcoded destination and gave no sense of where the record sat. A breadcrumb
 * does both jobs: it goes back, and it says what "back" is.
 *
 * The trail is passed in rather than derived from the pathname, because the
 * meaningful path is not always the URL path — a load reached from a customer
 * should read `Customers / Summit Retail / LD-1045` even though the URL is
 * `/portal/loads/[id]`.
 */
export interface Crumb {
  label: string;
  href?: string; // omitted on the final (current) crumb
}

export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm text-muted">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-2">
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className="hover:text-ink transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span className={isLast ? 'text-ink' : undefined} aria-current={isLast ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden="true" className="text-charcoal-600">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
