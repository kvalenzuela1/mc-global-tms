/**
 * Shipper invoice eligibility (document matching).
 *
 * Requirement coverage:
 *   FR-BIL-01  A shipper invoice can be created only AFTER delivery evidence
 *              and required documents are present (document match).
 *   FR-FCT-01  A factoring-ready carrier settlement packet requires a signed
 *              rate confirmation, POD, and finance approval — packet only, no
 *              money movement.
 *
 * Source: build spec steps 10-11, Delivery Plan factoring workflow, Operating
 * Workflow "Deliver and collect evidence".
 */

import { LOAD_STATUS, type LoadStatus } from '../loads/lifecycle';

export interface InvoiceEligibilityInput {
  status: LoadStatus;
  hasSignedRateConfirmation: boolean;
  hasBol: boolean;
  hasPod: boolean;
  /** Any other documents the org policy marks required for this service type. */
  missingRequiredDocs: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

/** FR-BIL-01: Can Finance create a shipper invoice for this load? */
export function canCreateShipperInvoice(input: InvoiceEligibilityInput): EligibilityResult {
  const reasons: string[] = [];

  if (input.status !== LOAD_STATUS.DELIVERED) {
    reasons.push(`NOT_DELIVERED: load is "${input.status}", must be "delivered".`);
  }
  if (!input.hasPod) reasons.push('POD_MISSING: proof of delivery is required.');
  if (!input.hasBol) reasons.push('BOL_MISSING: bill of lading is required.');
  if (!input.hasSignedRateConfirmation) {
    reasons.push('RATECON_UNSIGNED: a signed rate confirmation is required.');
  }
  if (input.missingRequiredDocs.length > 0) {
    reasons.push(`DOCS_MISSING: ${input.missingRequiredDocs.join(', ')}.`);
  }

  return { eligible: reasons.length === 0, reasons };
}

export interface SettlementPacketInput {
  hasSignedRateConfirmation: boolean;
  hasPod: boolean;
  financeApproved: boolean;
}

/**
 * FR-FCT-01: Can a factoring-ready settlement packet be assembled?
 * Note: this authorizes PACKET CREATION only. No ACH/factoring API is called in
 * Phase 1 — enforced by the factoring adapter being a noop.
 */
export function canCreateSettlementPacket(input: SettlementPacketInput): EligibilityResult {
  const reasons: string[] = [];
  if (!input.hasSignedRateConfirmation) reasons.push('RATECON_UNSIGNED: signed rate confirmation required.');
  if (!input.hasPod) reasons.push('POD_MISSING: proof of delivery required.');
  if (!input.financeApproved) reasons.push('FINANCE_UNAPPROVED: finance must approve the payable.');
  return { eligible: reasons.length === 0, reasons };
}
