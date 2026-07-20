/**
 * Driver / non-commercial data masking.
 *
 * Requirement coverage:
 *   FR-MASK-01  Drivers see operational fields only — never rates, margin,
 *               invoices, settlements, or Quick Pay data.
 *   FR-MASK-02  Masking is applied server-side before serialization; the
 *               browser never receives masked values (QA Audit P0).
 *
 * This is a belt-and-suspenders layer on top of RLS + column-scoped queries:
 * even if a commercial field is accidentally selected, it is stripped here for
 * any subject lacking COMMERCIALS_VIEW.
 */

import { canSeeCommercials } from '../rbac/permissions';
import type { Role } from '../rbac/roles';

/** Fields that carry commercial / financial meaning and must be masked. */
export const COMMERCIAL_FIELDS = [
  'shipper_price',
  'shipper_price_cents',
  'carrier_linehaul',
  'carrier_linehaul_cents',
  'carrier_rate_cents',
  'margin_amount_cents',
  'margin_percent',
  'target_margin_percent',
  'quick_pay_fee_cents',
  'quick_pay_fee_percent',
  'quick_pay_net_cents',
  'factoring_fee_cents',
  'factoring_advance_cents',
  'quick_pay_spread_cents',
  'invoice_amount_cents',
  'settlement_amount_cents',
  'accessorial_total_cents',
] as const;

export type CommercialField = (typeof COMMERCIAL_FIELDS)[number];

const COMMERCIAL_FIELD_SET = new Set<string>(COMMERCIAL_FIELDS);

/**
 * FR-MASK-01/02: Remove every commercial field from a record unless the subject
 * may view commercials. Returns a shallow clone; never mutates the input.
 */
export function maskCommercials<T extends Record<string, unknown>>(
  record: T,
  roles: Role[] | Role,
): Partial<T> {
  if (canSeeCommercials(roles)) return { ...record };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!COMMERCIAL_FIELD_SET.has(key)) out[key] = value;
  }
  return out as Partial<T>;
}

export function maskCommercialsList<T extends Record<string, unknown>>(
  records: T[],
  roles: Role[] | Role,
): Partial<T>[] {
  return records.map((r) => maskCommercials(r, roles));
}

/** True if a field name is commercial (used by column-scoping helpers). */
export function isCommercialField(field: string): boolean {
  return COMMERCIAL_FIELD_SET.has(field);
}
