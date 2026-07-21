import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { ROLE_LABELS } from '@/lib/rbac/roles';
import { PortalNav } from './_components/portal-nav';

/**
 * Portal shell. FR-RBAC-05: nav items are filtered by client-resolved
 * permissions (see PortalNav) — but the filter is cosmetic only; every route
 * re-checks permission server-side. FR-TEN-03: workspace selection is
 * honored here.
 */
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
  const initials = active.orgName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen grid grid-cols-[260px_1fr]">
      <aside className="bg-charcoal-900 border-r border-line p-5 flex flex-col sticky top-0 h-screen overflow-y-auto">
        <div className="flex items-center gap-3">
          <span className="avatar h-10 w-10 text-sm">{initials}</span>
          <div className="min-w-0">
            <p className="text-copper-400 font-bold leading-tight">M.C. Global</p>
            <p className="text-xs text-muted truncate">{active.orgName}</p>
          </div>
        </div>
        <p className="text-xs text-muted mt-2">{ROLE_LABELS[role]}</p>

        <PortalNav role={role} />

        <form action="/api/auth/signout" method="post" className="mt-auto pt-8">
          <button className="btn-secondary w-full py-1.5 text-xs">Sign out</button>
        </form>
      </aside>
      <section className="p-8">
        <div className="max-w-6xl mx-auto">{children}</div>
      </section>
    </div>
  );
}
