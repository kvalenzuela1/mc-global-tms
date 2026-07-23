/**
 * Append-only audit logging.
 *
 * Requirement coverage:
 *   FR-AUD-01  Audit every load transition, compliance action, pricing
 *              override, signature, acknowledgement, document, and invoice.
 *   FR-AUD-02  Audit rows are append-only (enforced by DB trigger — see
 *              migration 0004; no UPDATE/DELETE permitted).
 *   FR-AUD-03  Each entry records actor identity, org, action, entity, before/
 *              after context, and request metadata (IP/user agent).
 */

import { getServiceRoleSupabase } from '@/lib/supabase/server';

/** Canonical audited actions. Extend as milestones add flows. */
export const AUDIT_ACTIONS = {
  LOAD_TRANSITION: 'load.transition',
  RFQ_STATUS_CHANGED: 'rfq.status_changed',
  COMPLIANCE_CHECK: 'compliance.check',
  COMPLIANCE_OVERRIDE: 'compliance.override',
  PRICING_OVERRIDE: 'pricing.override',
  PRICING_OVERRIDE_REQUESTED: 'pricing.override_requested',
  PRICING_OVERRIDE_APPROVED: 'pricing.override_approved',
  RATECON_SENT: 'ratecon.sent',
  RATECON_SIGNED: 'ratecon.signed',
  DRIVER_ACK: 'driver.acknowledged',
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_VERIFIED: 'document.verified',
  DOCUMENT_REJECTED: 'document.rejected',
  ACCESSORIAL_ADDED: 'accessorial.added',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_CONTACT_ADDED: 'customer.contact_added',
  CUSTOMER_LOCATION_ADDED: 'customer.location_added',
  INVOICE_CREATED: 'invoice.created',
  SETTLEMENT_PACKET_CREATED: 'settlement.packet_created',
  ACCESS_DENIED: 'access.denied',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntryInput {
  orgId: string;
  actorUserId: string | null;
  action: AuditAction | string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * FR-AUD-01/03: Write one immutable audit entry. Uses the service-role client so
 * an audit record is never suppressed by RLS — but the entry always carries the
 * true org + actor so it remains tenant-attributable and reviewable.
 */
export async function writeAudit(entry: AuditEntryInput): Promise<void> {
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from('audit_log').insert({
    org_id: entry.orgId,
    actor_user_id: entry.actorUserId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    before_state: entry.before ?? null,
    after_state: entry.after ?? null,
    metadata: entry.metadata ?? {},
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ?? null,
  });
  if (error) throw error;
}
