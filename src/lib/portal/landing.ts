import { ROLES, type Role } from '@/lib/rbac/roles';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';

// Which home screen a role sees at /portal. Pure (no Next/Supabase imports) so
// the routing decision stays offline-testable — the page component only renders
// what this resolves to.
export const LANDING_KIND = {
  OPS: 'ops',
  SHIPPER: 'shipper',
  DRIVER: 'driver',
  PERMISSIONS: 'permissions',
} as const;

export type LandingKind = (typeof LANDING_KIND)[keyof typeof LANDING_KIND];

// The operations dashboard is meaningful only for a role that can see at least
// one of its surfaces (RFQs, pricing, loads, or rate confirmations).
export function hasOpsDashboard(role: Role): boolean {
  return (
    can(role, PERMISSIONS.RFQ_VIEW) ||
    can(role, PERMISSIONS.PRICING_VIEW) ||
    can(role, PERMISSIONS.LOAD_VIEW) ||
    can(role, PERMISSIONS.RATECON_VIEW)
  );
}

// Shipper and driver get tailored screens even though neither qualifies for the
// ops dashboard: a shipper is a customer who tracks shipments and requests
// quotes, and a driver works from the dedicated mobile app — the web screen is
// only a pointer there, not a dashboard. Any other role with no ops surface
// (e.g. platform_superadmin, which operates in a separate console) falls back
// to the server-enforced permission list.
export function resolveLandingKind(role: Role): LandingKind {
  if (role === ROLES.SHIPPER) return LANDING_KIND.SHIPPER;
  if (role === ROLES.DRIVER) return LANDING_KIND.DRIVER;
  if (hasOpsDashboard(role)) return LANDING_KIND.OPS;
  return LANDING_KIND.PERMISSIONS;
}
