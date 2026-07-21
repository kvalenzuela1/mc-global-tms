/**
 * Tenant/session context resolution.
 *
 * Requirement coverage:
 *   FR-TEN-02  Org membership + role are resolved SERVER-SIDE from the database,
 *              never from identity-provider claims (Proposal: "identity-provider
 *              claims never replace server-side tenant and role authorization").
 *   FR-TEN-03  A user may belong to multiple orgs; the active workspace is an
 *              authorized context switch, not a self-service role picker.
 *   FR-RBAC-06 The resolved role drives every permission decision.
 */

import { getServerSupabase } from '@/lib/supabase/server';
import { isValidRole, type Role } from '@/lib/rbac/roles';

export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
}

export interface SessionContext {
  userId: string;
  email: string | null;
  memberships: Membership[];
  /** The active workspace (org + role), or null if the user chose none yet. */
  active: Membership | null;
}

/**
 * FR-TEN-02: Resolve the full session context from Supabase auth + the
 * memberships table (which is itself RLS-protected to the requesting user).
 */
export async function getSessionContext(activeOrgId?: string): Promise<SessionContext | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('memberships')
    .select('org_id, role, organizations(name)')
    .eq('user_id', user.id);

  if (error) throw error;

  // supabase-js has no generated Database type here, so it can't tell this is
  // a many-to-one embed (each membership has exactly one org) and infers
  // `organizations` as an array; the row PostgREST actually returns is a
  // single nullable object.
  interface MembershipRow {
    org_id: string;
    role: string;
    organizations: { name: string } | null;
  }
  const rows = (data ?? []) as unknown as MembershipRow[];

  const memberships: Membership[] = rows
    .filter((m) => isValidRole(m.role))
    .map((m) => ({
      orgId: m.org_id,
      orgName: m.organizations?.name ?? 'Unknown',
      role: m.role as Role,
    }));

  // FR-TEN-03: active workspace must be one the user actually belongs to.
  let active: Membership | null = null;
  if (activeOrgId) {
    active = memberships.find((m) => m.orgId === activeOrgId) ?? null;
  } else if (memberships.length === 1) {
    active = memberships[0];
  }

  return { userId: user.id, email: user.email ?? null, memberships, active };
}
