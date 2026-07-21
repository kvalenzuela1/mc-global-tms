/**
 * FR-CMP-01/04 — Carrier compliance override policy (Milestone 4).
 *
 * Pure decision logic, sibling to `src/lib/pricing/override.ts` and
 * deliberately shaped the same way: `pricing:override`/`pricing:override_approve`
 * are held by two roles (needing a maker/checker split), but
 * `COMPLIANCE_OVERRIDE` is held only by `org_admin` — there is no second role
 * to check against, so there is no approval step here, only a single
 * request-time decision. The override applies at carrier ASSIGNMENT
 * (booking) only; the final release-to-driver gate is a hard, non-overridable
 * check (see `src/app/portal/loads/actions.ts`).
 */

import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import type { Role } from '@/lib/rbac/roles';
import type { ComplianceResult } from './gate';

/** Matches the minimum justification length already established for pricing overrides. */
export const MIN_OVERRIDE_REASON_LENGTH = 12;

export interface ComplianceOverrideInput {
  requesterRoles: Role[] | Role;
  reason: string;
  result: ComplianceResult;
}

export interface OverrideDecision {
  ok: boolean;
  /** Machine-readable failure code; null when ok. */
  error: string | null;
  message: string | null;
}

const OK: OverrideDecision = { ok: true, error: null, message: null };

function deny(error: string, message: string): OverrideDecision {
  return { ok: false, error, message };
}

/**
 * Validate a request to book a non-compliant carrier anyway.
 */
export function evaluateComplianceOverride({
  requesterRoles,
  reason,
  result,
}: ComplianceOverrideInput): OverrideDecision {
  if (result.allowed) {
    return deny('NOT_REQUIRED', 'This carrier is already compliant; no override is needed.');
  }

  if (!can(requesterRoles, PERMISSIONS.COMPLIANCE_OVERRIDE)) {
    return deny('FORBIDDEN', 'You do not have permission to override a compliance block.');
  }

  const trimmed = reason.trim();
  if (trimmed.length < MIN_OVERRIDE_REASON_LENGTH) {
    return deny(
      'REASON_TOO_SHORT',
      `A written justification of at least ${MIN_OVERRIDE_REASON_LENGTH} characters is required.`,
    );
  }

  return OK;
}
