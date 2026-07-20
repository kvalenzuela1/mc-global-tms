/**
 * Server-side authorization guards.
 *
 * Requirement coverage:
 *   FR-RBAC-05  Every protected server action verifies auth + org membership +
 *               permission BEFORE returning data. The UI is never the gate.
 *   FR-AUD-04   A denied action is auditable via AUDIT_ACTIONS.ACCESS_DENIED.
 */

import { getSessionContext, type SessionContext, type Membership } from '@/lib/tenant/context';
import { can, type Permission } from '@/lib/rbac/permissions';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Require an authenticated user. Throws AuthError(401) otherwise. */
export async function requireUser(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new AuthError('Not authenticated', 401);
  return ctx;
}

/**
 * FR-RBAC-05: Require an authenticated user with an active membership in
 * `orgId` and, optionally, a specific permission. Returns the active membership.
 */
export async function requirePermission(
  orgId: string,
  permission?: Permission,
): Promise<{ ctx: SessionContext; membership: Membership }> {
  const ctx = await requireUser();
  const membership = ctx.memberships.find((m) => m.orgId === orgId);
  if (!membership) {
    throw new AuthError('Not a member of this organization', 403);
  }
  if (permission && !can(membership.role, permission)) {
    throw new AuthError(`Missing permission: ${permission}`, 403);
  }
  return { ctx, membership };
}
