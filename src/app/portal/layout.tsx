import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLE_LABELS } from '@/lib/rbac/roles';

/**
 * Portal shell. FR-RBAC-05: nav items are filtered by server-resolved
 * permissions — but the filter is cosmetic only; every route re-checks
 * permission server-side. FR-TEN-03: workspace selection is honored here.
 */
const NAV = [
  { href: '/portal', label: 'Overview', perm: null },
  { href: '/portal/rfqs', label: 'RFQs & Quotes', perm: PERMISSIONS.RFQ_VIEW },
  { href: '/portal/pricing', label: 'Margin Calculator', perm: PERMISSIONS.PRICING_VIEW },
  { href: '/portal/loads', label: 'Loads', perm: PERMISSIONS.LOAD_VIEW },
  { href: '/portal/ratecons', label: 'Rate Confirmations', perm: PERMISSIONS.RATECON_VIEW },
  { href: '/portal/carriers', label: 'Carrier Compliance', perm: PERMISSIONS.CARRIER_VIEW },
  { href: '/portal/driver', label: 'Driver Brief', perm: PERMISSIONS.DRIVER_BRIEF_VIEW },
  { href: '/portal/documents', label: 'Documents', perm: PERMISSIONS.DOCUMENT_VIEW },
  { href: '/portal/invoices', label: 'Invoices & Settlement', perm: PERMISSIONS.INVOICE_CREATE },
  { href: '/portal/admin', label: 'Admin Settings', perm: PERMISSIONS.ADMIN_CONFIG },
  { href: '/portal/audit', label: 'Audit Log', perm: PERMISSIONS.AUDIT_VIEW },
] as const;

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  // FR-TEN-03: if the user has memberships but hasn't picked a workspace, and
  // has more than one, send them to the workspace chooser (Milestone 2 stub).
  const active = ctx.active ?? ctx.memberships[0] ?? null;
  if (!active) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24">
        <div className="panel p-8">
          <h1 className="text-xl font-bold">No workspace assigned</h1>
          <p className="mt-2 text-muted text-sm">
            Your account is authenticated but not yet a member of any
            organization. Contact your administrator.
          </p>
        </div>
      </main>
    );
  }

  const role = active.role;
  const visible = NAV.filter((n) => n.perm === null || can(role, n.perm));

  return (
    <div className="min-h-screen grid grid-cols-[260px_1fr]">
      <aside className="bg-charcoal-900 border-r border-line p-5">
        <p className="text-copper-400 font-bold">M.C. Global</p>
        <p className="text-xs text-muted mt-1">{active.orgName}</p>
        <p className="text-xs text-muted">{ROLE_LABELS[role]}</p>
        <nav className="mt-6 space-y-1">
          {visible.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block px-3 py-2 rounded-lg text-sm hover:bg-charcoal-700"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <form action="/api/auth/signout" method="post" className="mt-8">
          <button className="text-xs text-muted hover:text-ink">Sign out</button>
        </form>
      </aside>
      <section className="p-8">{children}</section>
    </div>
  );
}
