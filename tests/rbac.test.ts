/**
 * FR-RBAC-03/04 + FR-MASK-01 — Permission matrix decisions.
 */
import { describe, it, expect } from 'vitest';
import { ROLES } from '@/lib/rbac/roles';
import { can, canSeeCommercials, PERMISSIONS } from '@/lib/rbac/permissions';

describe('RBAC permission matrix', () => {
  it('CUS-01: broker roles can view and manage customers; non-brokers cannot', () => {
    for (const role of [ROLES.ORG_ADMIN, ROLES.BROKER_MANAGER, ROLES.BROKER_DISPATCHER]) {
      expect(can(role, PERMISSIONS.CUSTOMER_VIEW)).toBe(true);
      expect(can(role, PERMISSIONS.CUSTOMER_MANAGE)).toBe(true);
    }
    // A shipper can raise RFQs but must not read or edit the broker's customer book.
    expect(can(ROLES.SHIPPER, PERMISSIONS.CUSTOMER_VIEW)).toBe(false);
    expect(can(ROLES.DRIVER, PERMISSIONS.CUSTOMER_MANAGE)).toBe(false);
    expect(can(ROLES.CARRIER_DISPATCH, PERMISSIONS.CUSTOMER_VIEW)).toBe(false);
  });

  it('DOC-01: broker roles can verify documents; carrier/driver cannot', () => {
    for (const role of [ROLES.ORG_ADMIN, ROLES.BROKER_MANAGER, ROLES.BROKER_DISPATCHER]) {
      expect(can(role, PERMISSIONS.DOCUMENT_VERIFY)).toBe(true);
    }
    // Carriers/drivers upload documents but must not verify them.
    expect(can(ROLES.CARRIER_DISPATCH, PERMISSIONS.DOCUMENT_VERIFY)).toBe(false);
    expect(can(ROLES.DRIVER, PERMISSIONS.DOCUMENT_VERIFY)).toBe(false);
  });

  it('FR-RBAC-04: broker manager can approve pricing overrides', () => {
    expect(can(ROLES.BROKER_MANAGER, PERMISSIONS.PRICING_OVERRIDE_APPROVE)).toBe(true);
  });

  it('FR-RBAC-04: broker dispatcher cannot approve pricing overrides', () => {
    expect(can(ROLES.BROKER_DISPATCHER, PERMISSIONS.PRICING_OVERRIDE_APPROVE)).toBe(false);
  });

  it('FR-MASK-01: driver cannot view commercials, pricing, ratecons, or invoices', () => {
    expect(canSeeCommercials(ROLES.DRIVER)).toBe(false);
    expect(can(ROLES.DRIVER, PERMISSIONS.PRICING_VIEW)).toBe(false);
    expect(can(ROLES.DRIVER, PERMISSIONS.RATECON_VIEW)).toBe(false);
    expect(can(ROLES.DRIVER, PERMISSIONS.INVOICE_CREATE)).toBe(false);
    expect(can(ROLES.DRIVER, PERMISSIONS.SETTLEMENT_CREATE)).toBe(false);
  });

  it('FR-RBAC-03: driver retains operational permissions', () => {
    expect(can(ROLES.DRIVER, PERMISSIONS.DRIVER_ACK)).toBe(true);
    expect(can(ROLES.DRIVER, PERMISSIONS.MILESTONE_RECORD)).toBe(true);
  });

  it('FR-RBAC-04: only carrier dispatch can sign a rate confirmation', () => {
    expect(can(ROLES.CARRIER_DISPATCH, PERMISSIONS.RATECON_SIGN)).toBe(true);
    expect(can(ROLES.BROKER_MANAGER, PERMISSIONS.RATECON_SIGN)).toBe(false);
    expect(can(ROLES.DRIVER, PERMISSIONS.RATECON_SIGN)).toBe(false);
  });

  it('FR-RBAC-04: only brokers/admin can release a load to the driver', () => {
    expect(can(ROLES.BROKER_DISPATCHER, PERMISSIONS.LOAD_RELEASE_DRIVER)).toBe(true);
    expect(can(ROLES.ORG_ADMIN, PERMISSIONS.LOAD_RELEASE_DRIVER)).toBe(true);
    expect(can(ROLES.CARRIER_DISPATCH, PERMISSIONS.LOAD_RELEASE_DRIVER)).toBe(false);
  });

  it('FR-RBAC-02: platform superadmin has no tenant data permissions', () => {
    expect(can(ROLES.PLATFORM_SUPERADMIN, PERMISSIONS.LOAD_VIEW)).toBe(false);
    expect(can(ROLES.PLATFORM_SUPERADMIN, PERMISSIONS.COMMERCIALS_VIEW)).toBe(false);
  });

  it('FR-RBAC-04: multiple roles union their grants', () => {
    expect(can([ROLES.DRIVER, ROLES.BROKER_MANAGER], PERMISSIONS.INVOICE_CREATE)).toBe(true);
  });

  it('FR-RBAC-04: shipper is limited to RFQ + tracking + document view', () => {
    expect(can(ROLES.SHIPPER, PERMISSIONS.RFQ_CREATE)).toBe(true);
    expect(can(ROLES.SHIPPER, PERMISSIONS.SHIPPER_TRACK)).toBe(true);
    expect(can(ROLES.SHIPPER, PERMISSIONS.LOAD_CREATE)).toBe(false);
    expect(can(ROLES.SHIPPER, PERMISSIONS.COMMERCIALS_VIEW)).toBe(false);
  });
});
