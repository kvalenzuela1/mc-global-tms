/**
 * FR-CMP-01/04 — Carrier compliance override policy: only org_admin holds
 * COMPLIANCE_OVERRIDE (no maker/checker split possible), so this is a
 * single request-time decision, not a request+approval pair.
 */
import { describe, it, expect } from 'vitest';
import { ROLES } from '@/lib/rbac/roles';
import { evaluateComplianceOverride, MIN_OVERRIDE_REASON_LENGTH } from '@/lib/compliance/override';
import type { ComplianceResult } from '@/lib/compliance/gate';

const compliant: ComplianceResult = { allowed: true, blockingReasons: [], warnings: [] };
const blocked: ComplianceResult = {
  allowed: false,
  blockingReasons: ['AUTHORITY_NOT_ACTIVE: authority is "not_authorized".', 'DOCS_MISSING: required compliance documents are not on file.'],
  warnings: [],
};

describe('compliance override policy', () => {
  it('FR-CMP-01: an override cannot be requested for an already-compliant carrier', () => {
    const decision = evaluateComplianceOverride({
      requesterRoles: ROLES.ORG_ADMIN,
      reason: 'Backhaul lane, need this carrier today.',
      result: compliant,
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('NOT_REQUIRED');
  });

  it('FR-CMP-04: only org_admin may override a compliance block', () => {
    for (const role of [ROLES.BROKER_MANAGER, ROLES.BROKER_DISPATCHER, ROLES.CARRIER_DISPATCH, ROLES.DRIVER]) {
      const decision = evaluateComplianceOverride({
        requesterRoles: role,
        reason: 'Backhaul lane, need this carrier today.',
        result: blocked,
      });
      expect(decision.ok).toBe(false);
      expect(decision.error).toBe('FORBIDDEN');
    }
  });

  it('FR-CMP-04: org_admin may override with a sufficient justification', () => {
    const decision = evaluateComplianceOverride({
      requesterRoles: ROLES.ORG_ADMIN,
      reason: 'Backhaul lane, need this carrier today.',
      result: blocked,
    });
    expect(decision.ok).toBe(true);
    expect(decision.error).toBeNull();
  });

  it('a too-short justification is rejected', () => {
    const decision = evaluateComplianceOverride({
      requesterRoles: ROLES.ORG_ADMIN,
      reason: 'ok',
      result: blocked,
    });
    expect(decision.ok).toBe(false);
    expect(decision.error).toBe('REASON_TOO_SHORT');
    expect(decision.message).toContain(String(MIN_OVERRIDE_REASON_LENGTH));
  });

  it('multiple roles union their grants, same as can()', () => {
    const decision = evaluateComplianceOverride({
      requesterRoles: [ROLES.BROKER_DISPATCHER, ROLES.ORG_ADMIN],
      reason: 'Backhaul lane, need this carrier today.',
      result: blocked,
    });
    expect(decision.ok).toBe(true);
  });
});
