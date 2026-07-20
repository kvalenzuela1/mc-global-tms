/**
 * Signature evidence capture.
 *
 * Requirement coverage:
 *   FR-RC-06  Capture signer identity, timestamp, IP/user agent (where
 *             available), consent text version, document version/hash, and an
 *             audit log entry.
 *   FR-RC-07  Do NOT claim legal e-signature compliance without legal review.
 *
 * This module builds the immutable evidence payload that is stored alongside a
 * rate-confirmation signature and hashed. The actual PDF render + storage lands
 * in Milestone 5; this defines the evidence contract and validation used
 * everywhere so it is consistent and testable now.
 */

import { createHash } from 'node:crypto';

/**
 * FR-RC-07: Non-binding notice persisted with every signature. The platform
 * records intent-to-sign evidence; it does not assert ESIGN/UETA compliance.
 */
export const ESIGN_DISCLAIMER =
  'This platform records electronic acceptance evidence for operational use. ' +
  'It does not assert legal e-signature (ESIGN/UETA) compliance; binding legal ' +
  'e-signature requires separate legal review.';

export interface SignatureEvidenceInput {
  signerUserId: string;
  signerName: string;
  signerTitle: string | null;
  orgId: string;
  documentId: string;
  documentVersion: number;
  /** Full document content used to compute the immutable hash. */
  documentContent: string;
  consentTextVersion: string;
  consentAccepted: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  /** Injected timestamp (ISO) so evidence is reproducible in tests. */
  signedAt: string;
}

export interface SignatureEvidence {
  signerUserId: string;
  signerName: string;
  signerTitle: string | null;
  orgId: string;
  documentId: string;
  documentVersion: number;
  documentHash: string; // sha256 hex of the accepted content
  consentTextVersion: string;
  ipAddress: string | null;
  userAgent: string | null;
  signedAt: string;
  disclaimerVersion: string;
}

export function hashDocument(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * FR-RC-06: Build a complete, validated evidence record. Throws if consent was
 * not explicitly accepted or required identity fields are missing — an
 * incomplete signature must never be persisted.
 */
export function buildSignatureEvidence(input: SignatureEvidenceInput): SignatureEvidence {
  if (!input.consentAccepted) {
    throw new Error('SIGNATURE_CONSENT_REQUIRED: explicit consent was not accepted.');
  }
  if (!input.signerUserId || !input.signerName) {
    throw new Error('SIGNATURE_IDENTITY_REQUIRED: signer identity is incomplete.');
  }
  if (!input.consentTextVersion) {
    throw new Error('SIGNATURE_CONSENT_VERSION_REQUIRED: consent text version is missing.');
  }
  if (!input.documentContent) {
    throw new Error('SIGNATURE_DOCUMENT_REQUIRED: document content is empty.');
  }
  return {
    signerUserId: input.signerUserId,
    signerName: input.signerName,
    signerTitle: input.signerTitle ?? null,
    orgId: input.orgId,
    documentId: input.documentId,
    documentVersion: input.documentVersion,
    documentHash: hashDocument(input.documentContent),
    consentTextVersion: input.consentTextVersion,
    ipAddress: input.ipAddress ?? null, // "where available"
    userAgent: input.userAgent ?? null,
    signedAt: input.signedAt,
    disclaimerVersion: 'v1',
  };
}
