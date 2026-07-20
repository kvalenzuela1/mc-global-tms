/**
 * FR-RC-06/07 — Signature evidence capture + non-binding disclaimer.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSignatureEvidence,
  hashDocument,
  ESIGN_DISCLAIMER,
  type SignatureEvidenceInput,
} from '@/lib/signatures/evidence';

const base: SignatureEvidenceInput = {
  signerUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000004',
  signerName: 'Dana Cole',
  signerTitle: 'Dispatch Manager',
  orgId: '11111111-1111-1111-1111-111111111111',
  documentId: 'bbbb2048-0000-0000-0000-000000000001',
  documentVersion: 1,
  documentContent: 'RATE CONFIRMATION RC-2048 ... carrier rate $2,000.00',
  consentTextVersion: 'consent-v1',
  consentAccepted: true,
  ipAddress: '203.0.113.10',
  userAgent: 'Mozilla/5.0 (demo)',
  signedAt: '2026-07-18T09:05:00Z',
};

describe('signature evidence', () => {
  it('FR-RC-06: captures identity, timestamp, IP/UA, consent version, and document hash', () => {
    const ev = buildSignatureEvidence(base);
    expect(ev.signerUserId).toBe(base.signerUserId);
    expect(ev.signerName).toBe('Dana Cole');
    expect(ev.signedAt).toBe('2026-07-18T09:05:00Z');
    expect(ev.ipAddress).toBe('203.0.113.10');
    expect(ev.userAgent).toBe('Mozilla/5.0 (demo)');
    expect(ev.consentTextVersion).toBe('consent-v1');
    expect(ev.documentHash).toBe(hashDocument(base.documentContent));
    expect(ev.documentHash).toHaveLength(64); // sha256 hex
  });

  it('FR-RC-06: refuses to build evidence without explicit consent', () => {
    expect(() => buildSignatureEvidence({ ...base, consentAccepted: false })).toThrow(
      /SIGNATURE_CONSENT_REQUIRED/,
    );
  });

  it('FR-RC-06: refuses incomplete signer identity', () => {
    expect(() => buildSignatureEvidence({ ...base, signerName: '' })).toThrow(
      /SIGNATURE_IDENTITY_REQUIRED/,
    );
  });

  it('FR-RC-06: IP/UA are optional ("where available")', () => {
    const ev = buildSignatureEvidence({ ...base, ipAddress: null, userAgent: null });
    expect(ev.ipAddress).toBeNull();
    expect(ev.userAgent).toBeNull();
  });

  it('FR-RC-06: hash changes when document content changes', () => {
    const a = buildSignatureEvidence(base);
    const b = buildSignatureEvidence({ ...base, documentContent: base.documentContent + ' amended' });
    expect(a.documentHash).not.toBe(b.documentHash);
  });

  it('FR-RC-07: disclaimer does not claim legal e-signature compliance', () => {
    expect(ESIGN_DISCLAIMER.toLowerCase()).toContain('does not assert');
    expect(ESIGN_DISCLAIMER.toLowerCase()).toContain('legal review');
  });
});
