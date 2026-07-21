import Link from 'next/link';

/**
 * Public landing (placeholder for the full public website — Milestone 7).
 * Milestones 1 & 2 focus on the secure foundation; this page only proves the
 * charcoal/copper shell renders and links into the portal.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <p className="text-copper-400 font-semibold tracking-wide uppercase text-sm">
        MC Global Freight Solutions LLC
      </p>
      <h1 className="mt-3 text-4xl font-bold text-ink">
        Freight moves better with a partner who sees the whole route.
      </h1>
      <p className="mt-4 text-muted">
        Phase 1 controlled pilot — brokerage, dispatch, compliance, and
        settlement in one auditable workspace.
      </p>
      <div className="mt-8 flex gap-4">
        <Link href="/login" className="btn-copper px-5 py-2.5">
          Partner login
        </Link>
        <Link
          href="/portal"
          className="px-5 py-2.5 rounded-[10px] border border-line text-ink"
        >
          Open portal
        </Link>
      </div>
      <p className="mt-16 text-xs text-muted">
        Public marketing site (Home, Services, Request a Quote, Track Shipment,
        Carrier onboarding) is delivered in Milestone 7.
      </p>
    </main>
  );
}
