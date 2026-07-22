import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { summarizeAuditChange } from '@/lib/audit/format';

/**
 * FR-AUD-01: the audit trail UI. `writeAudit()` has logged every mutation since
 * M1, and AUDIT_VIEW is granted to org_admin / broker_manager /
 * platform_superadmin, but there was nowhere to read it back (WORKFLOW-REDESIGN
 * §10, AUD-01). This is that page — read-only by construction: audit_log has no
 * UPDATE/DELETE policy and a trigger rejects mutation even for the owner.
 *
 * The audit_select RLS policy scopes rows to orgs where the viewer holds one of
 * those three roles — exactly the set AUDIT_VIEW maps to — so this can()
 * check and the DB policy agree. The org_id filter is belt-and-suspenders.
 */

interface AuditRow {
  id: number;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  'load.transition': 'Load status changed',
  'rfq.status_changed': 'RFQ status changed',
  'compliance.check': 'Compliance checked',
  'compliance.override': 'Compliance overridden',
  'pricing.override': 'Pricing overridden',
  'pricing.override_requested': 'Pricing override requested',
  'pricing.override_approved': 'Pricing override approved',
  'ratecon.sent': 'Rate confirmation sent',
  'ratecon.signed': 'Rate confirmation signed',
  'driver.acknowledged': 'Driver acknowledged',
  'document.uploaded': 'Document uploaded',
  'accessorial.added': 'Accessorial added',
  'invoice.created': 'Invoice created',
  'settlement.packet_created': 'Settlement packet created',
  'access.denied': 'Access denied',
};

/** Deep link to the entity a row is about, when a detail route exists for it. */
function entityHref(type: string, id: string | null): string | null {
  if (!id) return null;
  switch (type) {
    case 'load':
      return `/portal/loads/${id}`;
    case 'rfq':
      return `/portal/rfqs/${id}`;
    case 'quote':
      return `/portal/quotes/${id}`;
    default:
      return null;
  }
}

export default async function AuditPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.AUDIT_VIEW)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, actor_user_id, action, entity_type, entity_id, before_state, after_state, metadata, created_at')
    .eq('org_id', active.orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data as AuditRow[]) ?? [];

  // Actor identity: there is no profiles table yet, so beyond the current user
  // (resolvable from the session) we can only show a short id. Resolving all
  // actors to emails is a follow-up once a profiles/users table lands.
  const formatActor = (actorUserId: string | null): string => {
    if (!actorUserId) return 'System';
    if (actorUserId === ctx?.userId) return `${ctx?.email ?? 'You'} (you)`;
    return `${actorUserId.slice(0, 8)}…`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Audit trail</h1>
      <p className="text-muted mt-1">
        Every recorded change in your organization, newest first. Append-only — entries can never be
        edited or deleted.
      </p>

      <div className="panel mt-6 p-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted text-left">
            <tr className="border-b border-line">
              <th className="pb-2 pr-4 whitespace-nowrap">When</th>
              <th className="pb-2 pr-4">Action</th>
              <th className="pb-2 pr-4">Entity</th>
              <th className="pb-2 pr-4">Actor</th>
              <th className="pb-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = entityHref(r.entity_type, r.entity_id);
              const summary = summarizeAuditChange(r.before_state, r.after_state, r.metadata);
              const source = typeof r.metadata?.source === 'string' ? r.metadata.source : null;
              return (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-muted">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 font-medium">
                    {ACTION_LABELS[r.action] ?? r.action}
                    {source === 'db_trigger' && (
                      <span className="text-muted ml-2 text-xs">(system)</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {href ? (
                      <Link href={href} className="text-copper-400 hover:text-copper-300">
                        {r.entity_type} {r.entity_id ? `#${r.entity_id.slice(0, 8)}` : ''}
                      </Link>
                    ) : (
                      <span className="text-muted">
                        {r.entity_type}
                        {r.entity_id ? ` ${r.entity_id.slice(0, 8)}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatActor(r.actor_user_id)}</td>
                  <td className="py-2 text-muted">{summary || '—'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-muted text-center">
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to the audit trail.</p>
    </div>
  );
}
