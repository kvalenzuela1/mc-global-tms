/**
 * Auth adapter interface.
 *
 * Requirement coverage:
 *   FR-AUTH-01  Supabase Auth is the Phase 1 identity provider.
 *   FR-AUTH-02  A provider-agnostic adapter makes Auth0 / enterprise SSO a
 *               future drop-in without touching tenant/RBAC logic.
 *   FR-AUTH-03  SSO proves IDENTITY only; it never grants a role. Roles come
 *               from server-side org membership (see tenant/context.ts).
 *
 * Source: build spec "create an auth adapter for future Auth0/enterprise SSO"
 * + Proposal "Identity, Access, and SSO".
 */

export interface AuthIdentity {
  /** Stable provider user id (Supabase auth.users.id). */
  userId: string;
  email: string | null;
}

export interface AuthAdapter {
  readonly name: string;
  /** Resolve the current authenticated identity from the request context. */
  getIdentity(): Promise<AuthIdentity | null>;
  /** Sign the current session out. */
  signOut(): Promise<void>;
}
