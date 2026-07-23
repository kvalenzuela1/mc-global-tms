/**
 * Customer vocabulary shared by the server actions and the UI, mirroring the
 * CHECK constraints in 0012_customers.sql. The database stays the source of
 * truth; these keep the TypeScript side single-sourced so the actions' guards
 * and the form's options can't drift apart. Pure — no Next/Supabase imports.
 */

export const CUSTOMER_STATUSES = ['prospect', 'active', 'on_hold', 'inactive'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  prospect: 'Prospect',
  active: 'Active',
  on_hold: 'On hold',
  inactive: 'Inactive',
};

export const CONTACT_ROLES = ['primary', 'billing', 'operations', 'receiving'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
