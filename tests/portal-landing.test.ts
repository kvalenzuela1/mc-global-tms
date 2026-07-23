/**
 * FR-UX-03 — role-aware portal landing.
 *
 * Every role must resolve to a real home screen. In particular, shipper and
 * driver must NOT fall through to the server-enforced permission list (a
 * developer diagnostic), which is what happened before this existed.
 */
import { describe, it, expect } from 'vitest';
import { ROLES } from '@/lib/rbac/roles';
import { resolveLandingKind, LANDING_KIND } from '@/lib/portal/landing';

describe('portal landing', () => {
  it('FR-UX-03: shipper lands on the shipper home, not the permission list', () => {
    expect(resolveLandingKind(ROLES.SHIPPER)).toBe(LANDING_KIND.SHIPPER);
  });

  it('FR-UX-03: driver lands on the mobile-app pointer, not the permission list', () => {
    expect(resolveLandingKind(ROLES.DRIVER)).toBe(LANDING_KIND.DRIVER);
  });

  it('FR-UX-03: broker roles get the operations dashboard', () => {
    expect(resolveLandingKind(ROLES.ORG_ADMIN)).toBe(LANDING_KIND.OPS);
    expect(resolveLandingKind(ROLES.BROKER_MANAGER)).toBe(LANDING_KIND.OPS);
    expect(resolveLandingKind(ROLES.BROKER_DISPATCHER)).toBe(LANDING_KIND.OPS);
  });

  it('FR-UX-03: carrier dispatch reaches the ops dashboard via load/ratecon view', () => {
    expect(resolveLandingKind(ROLES.CARRIER_DISPATCH)).toBe(LANDING_KIND.OPS);
  });

  it('FR-UX-03: a role with no ops surface falls back to the permission list', () => {
    // platform_superadmin holds no tenant-data permissions (separate console).
    expect(resolveLandingKind(ROLES.PLATFORM_SUPERADMIN)).toBe(LANDING_KIND.PERMISSIONS);
  });
});
