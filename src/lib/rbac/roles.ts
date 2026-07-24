/**
 * RBAC role definitions for the MC Global Freight TMS.
 *
 * Requirement coverage:
 *   FR-RBAC-01  Enumerated, server-enforced roles.
 *   FR-RBAC-02  Platform Superadmin is a SEPARATE console scope, never a
 *               tenant role, and never granted by SSO/identity claims alone.
 *
 * Source of truth: Client Proposal "Roles and Governance" + Operating Workflow
 * "Identity, Access, and SSO". Roles below map 1:1 to the build spec.
 */

export const ROLES = {
  /** Organization Owner/Admin — full org configuration + audit review. */
  ORG_ADMIN: 'org_admin',
  /** Broker Manager — quoting, margin approvals, bookings. */
  BROKER_MANAGER: 'broker_manager',
  /** Broker Dispatcher — assignments, milestones, release-to-driver. */
  BROKER_DISPATCHER: 'broker_dispatcher',
  /** Carrier Admin/Dispatch — acts only on loads assigned to their carrier. */
  CARRIER_DISPATCH: 'carrier_dispatch',
  /** Driver — operational fields only; never rates/margin/settlement. */
  DRIVER: 'driver',
  /** Shipper — sees only their own records. */
  SHIPPER: 'shipper',
  /** Invoicing — internal finance staff: read-all loads, view both margin
   *  sides, manage invoices/payables. No settings/user-management, no
   *  quoting/booking, no margin-config editing. */
  INVOICING: 'invoicing',
  /** Platform Superadmin — separate operator console, cross-tenant, audited. */
  PLATFORM_SUPERADMIN: 'platform_superadmin',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: Role[] = Object.values(ROLES);

/** Roles that belong to the MC Global brokerage (internal staff). */
export const INTERNAL_ROLES: Role[] = [
  ROLES.ORG_ADMIN,
  ROLES.BROKER_MANAGER,
  ROLES.BROKER_DISPATCHER,
  ROLES.INVOICING,
];

/** Roles that belong to an external partner org (carrier / driver / shipper). */
export const EXTERNAL_ROLES: Role[] = [
  ROLES.CARRIER_DISPATCH,
  ROLES.DRIVER,
  ROLES.SHIPPER,
];

/**
 * FR-RBAC-02: The platform superadmin never operates inside a tenant workspace.
 * It is resolved through a separate console and is intentionally excluded from
 * the tenant membership model.
 */
export const PLATFORM_ROLES: Role[] = [ROLES.PLATFORM_SUPERADMIN];

export function isInternalRole(role: Role): boolean {
  return INTERNAL_ROLES.includes(role);
}

export function isExternalRole(role: Role): boolean {
  return EXTERNAL_ROLES.includes(role);
}

export function isValidRole(value: string): value is Role {
  return (ALL_ROLES as string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.ORG_ADMIN]: 'Organization Owner / Admin',
  [ROLES.BROKER_MANAGER]: 'Broker Manager',
  [ROLES.BROKER_DISPATCHER]: 'Broker Dispatcher',
  [ROLES.CARRIER_DISPATCH]: 'Carrier Admin / Dispatch',
  [ROLES.DRIVER]: 'Driver',
  [ROLES.SHIPPER]: 'Shipper',
  [ROLES.INVOICING]: 'Invoicing',
  [ROLES.PLATFORM_SUPERADMIN]: 'Platform Superadmin',
};
