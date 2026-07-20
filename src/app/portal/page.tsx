import { getSessionContext } from '@/lib/tenant/context';
import { ROLE_LABELS } from '@/lib/rbac/roles';
import { permissionsFor } from '@/lib/rbac/permissions';

export default async function PortalOverview() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  const perms = permissionsFor(active.role);

  return (
    <div>
      <h1 className="text-2xl font-bold">Today at a glance</h1>
      <p className="text-muted mt-1">
        Signed in as {ctx?.email} · {ROLE_LABELS[active.role]} · {active.orgName}
      </p>

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">Your permissions (server-enforced)</h2>
        <p className="text-sm text-muted mt-1">
          Milestones 1 & 2 deliver the foundation. Operational screens are wired
          in Milestones 3–7. This confirms your role resolves to the correct
          capability set.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
          {perms.map((p) => (
            <li key={p} className="rounded-md bg-charcoal-800 px-3 py-1.5">
              {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
