/**
 * Permission matrix + capability checks — SERVER-SIDE source of truth.
 *
 * Requirement coverage:
 *   FR-RBAC-03  Every capability is a named permission mapped to roles.
 *   FR-RBAC-04  `can()` is a pure, deterministic decision function; UI never
 *               decides access on its own (QA Audit P0: "UI-only RBAC").
 *   FR-MASK-01  Driver data masking is expressed as an explicit deny of
 *               commercial-visibility permissions.
 *
 * These checks are the application-layer guard. They compose with Postgres RLS
 * (defense in depth): RLS restricts WHICH ROWS a tenant can touch; permissions
 * restrict WHICH ACTIONS a role can take.
 */

import { ROLES, type Role } from './roles';

export const PERMISSIONS = {
  // Loads & lifecycle
  LOAD_VIEW: 'load:view',
  LOAD_CREATE: 'load:create',
  LOAD_EDIT: 'load:edit',
  LOAD_TRANSITION: 'load:transition',
  LOAD_RELEASE_DRIVER: 'load:release_driver',

  // RFQ / quotes / pricing
  RFQ_VIEW: 'rfq:view',
  RFQ_CREATE: 'rfq:create',
  QUOTE_CREATE: 'quote:create',
  PRICING_VIEW: 'pricing:view',
  PRICING_OVERRIDE: 'pricing:override',
  PRICING_OVERRIDE_APPROVE: 'pricing:override_approve',

  // Commercial visibility (rates, margin, invoices, settlement, Quick Pay)
  COMMERCIALS_VIEW: 'commercials:view',

  // Carriers & compliance
  CARRIER_VIEW: 'carrier:view',
  CARRIER_MANAGE: 'carrier:manage',
  COMPLIANCE_REVIEW: 'compliance:review',
  COMPLIANCE_OVERRIDE: 'compliance:override',

  // Rate confirmation & signatures
  RATECON_SEND: 'ratecon:send',
  RATECON_SIGN: 'ratecon:sign',
  RATECON_VIEW: 'ratecon:view',

  // Driver operations
  DRIVER_BRIEF_VIEW: 'driver:brief_view',
  DRIVER_ACK: 'driver:ack',

  // Milestones & documents
  MILESTONE_RECORD: 'milestone:record',
  DOCUMENT_UPLOAD: 'document:upload',
  DOCUMENT_VIEW: 'document:view',

  // Finance
  INVOICE_CREATE: 'invoice:create',
  SETTLEMENT_CREATE: 'settlement:create',

  // Admin & audit
  ADMIN_CONFIG: 'admin:config',
  AUDIT_VIEW: 'audit:view',

  // Shipper self-service
  SHIPPER_TRACK: 'shipper:track',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Role → permission set. Absence of a permission is an implicit deny.
 * FR-MASK-01: DRIVER intentionally lacks COMMERCIALS_VIEW / PRICING_VIEW /
 * RATECON_VIEW / INVOICE_* / SETTLEMENT_* — drivers never see money data.
 */
const MATRIX: Record<Role, Permission[]> = {
  [ROLES.ORG_ADMIN]: [
    PERMISSIONS.LOAD_VIEW, PERMISSIONS.LOAD_CREATE, PERMISSIONS.LOAD_EDIT,
    PERMISSIONS.LOAD_TRANSITION, PERMISSIONS.LOAD_RELEASE_DRIVER,
    PERMISSIONS.RFQ_VIEW, PERMISSIONS.RFQ_CREATE, PERMISSIONS.QUOTE_CREATE,
    PERMISSIONS.PRICING_VIEW, PERMISSIONS.PRICING_OVERRIDE,
    PERMISSIONS.PRICING_OVERRIDE_APPROVE, PERMISSIONS.COMMERCIALS_VIEW,
    PERMISSIONS.CARRIER_VIEW, PERMISSIONS.CARRIER_MANAGE,
    PERMISSIONS.COMPLIANCE_REVIEW, PERMISSIONS.COMPLIANCE_OVERRIDE,
    PERMISSIONS.RATECON_SEND, PERMISSIONS.RATECON_VIEW,
    PERMISSIONS.MILESTONE_RECORD, PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_VIEW, PERMISSIONS.INVOICE_CREATE,
    PERMISSIONS.SETTLEMENT_CREATE, PERMISSIONS.ADMIN_CONFIG,
    PERMISSIONS.AUDIT_VIEW,
  ],
  [ROLES.BROKER_MANAGER]: [
    PERMISSIONS.LOAD_VIEW, PERMISSIONS.LOAD_CREATE, PERMISSIONS.LOAD_EDIT,
    PERMISSIONS.LOAD_TRANSITION, PERMISSIONS.LOAD_RELEASE_DRIVER,
    PERMISSIONS.RFQ_VIEW, PERMISSIONS.RFQ_CREATE, PERMISSIONS.QUOTE_CREATE,
    PERMISSIONS.PRICING_VIEW, PERMISSIONS.PRICING_OVERRIDE,
    PERMISSIONS.PRICING_OVERRIDE_APPROVE, PERMISSIONS.COMMERCIALS_VIEW,
    PERMISSIONS.CARRIER_VIEW, PERMISSIONS.CARRIER_MANAGE,
    PERMISSIONS.COMPLIANCE_REVIEW,
    PERMISSIONS.RATECON_SEND, PERMISSIONS.RATECON_VIEW,
    PERMISSIONS.MILESTONE_RECORD, PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_VIEW, PERMISSIONS.INVOICE_CREATE,
    PERMISSIONS.SETTLEMENT_CREATE, PERMISSIONS.AUDIT_VIEW,
  ],
  [ROLES.BROKER_DISPATCHER]: [
    PERMISSIONS.LOAD_VIEW, PERMISSIONS.LOAD_CREATE, PERMISSIONS.LOAD_EDIT,
    PERMISSIONS.LOAD_TRANSITION, PERMISSIONS.LOAD_RELEASE_DRIVER,
    PERMISSIONS.RFQ_VIEW, PERMISSIONS.RFQ_CREATE, PERMISSIONS.QUOTE_CREATE,
    PERMISSIONS.PRICING_VIEW, PERMISSIONS.COMMERCIALS_VIEW,
    PERMISSIONS.CARRIER_VIEW, PERMISSIONS.COMPLIANCE_REVIEW,
    PERMISSIONS.RATECON_SEND, PERMISSIONS.RATECON_VIEW,
    PERMISSIONS.MILESTONE_RECORD, PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_VIEW,
  ],
  [ROLES.CARRIER_DISPATCH]: [
    PERMISSIONS.LOAD_VIEW, PERMISSIONS.RATECON_VIEW, PERMISSIONS.RATECON_SIGN,
    PERMISSIONS.MILESTONE_RECORD, PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_VIEW,
    // Carrier CAN see the rate on their own rate confirmation (their pay),
    // but never broker margin or shipper invoice — enforced by field scoping.
    PERMISSIONS.COMMERCIALS_VIEW,
  ],
  [ROLES.DRIVER]: [
    // Operational only. NO commercials, NO pricing, NO ratecon, NO invoice.
    PERMISSIONS.DRIVER_BRIEF_VIEW, PERMISSIONS.DRIVER_ACK,
    PERMISSIONS.MILESTONE_RECORD, PERMISSIONS.DOCUMENT_UPLOAD,
  ],
  [ROLES.SHIPPER]: [
    PERMISSIONS.RFQ_CREATE, PERMISSIONS.SHIPPER_TRACK,
    PERMISSIONS.DOCUMENT_VIEW,
  ],
  [ROLES.PLATFORM_SUPERADMIN]: [
    // Operates only in the separate console; no tenant data permissions here.
    PERMISSIONS.AUDIT_VIEW,
  ],
};

const MATRIX_SETS: Record<Role, Set<Permission>> = Object.fromEntries(
  Object.entries(MATRIX).map(([role, perms]) => [role, new Set(perms)]),
) as Record<Role, Set<Permission>>;

/**
 * FR-RBAC-04: Pure permission decision. Returns true iff any of the subject's
 * roles grants the permission. Multiple roles union their grants.
 */
export function can(roles: Role[] | Role, permission: Permission): boolean {
  const list = Array.isArray(roles) ? roles : [roles];
  return list.some((r) => MATRIX_SETS[r]?.has(permission) ?? false);
}

export function permissionsFor(role: Role): Permission[] {
  return [...(MATRIX[role] ?? [])];
}

/**
 * FR-MASK-01: Convenience predicate used by masking + query scoping.
 * A subject that cannot view commercials must never receive rate/margin/
 * invoice/settlement fields.
 */
export function canSeeCommercials(roles: Role[] | Role): boolean {
  return can(roles, PERMISSIONS.COMMERCIALS_VIEW);
}
