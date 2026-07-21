/**
 * FR-RC-08 — signed rate-confirmation PDF rendering.
 */
import { describe, it, expect } from 'vitest';
import { renderRateconPdf, type RateconPdfInput } from '@/lib/ratecons/pdf';

const BASE_INPUT: RateconPdfInput = {
  reference: 'RC-2048',
  version: 1,
  origin: 'Newark, NJ',
  destination: 'Atlanta, GA',
  serviceType: 'Dry Van',
  carrierRateCents: 185000,
  freightDetails: 'FAK, 2 pallets, 4200 lbs',
  pickupAt: '2026-08-01T14:00:00.000Z',
  broker: { name: 'MC Global Freight Solutions LLC', mcNumber: 'MC123456', dotNumber: 'DOT7654321' },
  carrier: { name: 'Horizon Freight LLC', mcNumber: 'MC654321', dotNumber: 'DOT1234567' },
  signature: {
    signerName: 'Jane Carrier',
    signerTitle: 'Dispatcher',
    signedAt: '2026-07-21T09:30:00.000Z',
    ipAddress: '203.0.113.5',
    documentHash: 'a'.repeat(64),
  },
  disclaimer:
    'This platform records electronic acceptance evidence for operational use. It does not assert legal e-signature (ESIGN/UETA) compliance; binding legal e-signature requires separate legal review.',
};

describe('renderRateconPdf', () => {
  it('FR-RC-08: produces a real PDF (starts with the %PDF- magic header)', async () => {
    const bytes = await renderRateconPdf(BASE_INPUT);
    const header = Buffer.from(bytes.slice(0, 5)).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('FR-RC-08: produces a non-trivial document', async () => {
    const bytes = await renderRateconPdf(BASE_INPUT);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('FR-RC-08: is deterministic given identical input (fixed signedAt drives CreationDate/ModDate)', async () => {
    const a = await renderRateconPdf(BASE_INPUT);
    const b = await renderRateconPdf(BASE_INPUT);
    expect(a).toEqual(b);
  });

  it('FR-RC-08: tolerates missing optional fields (freight details, pickup, IP, MC/DOT numbers)', async () => {
    const input: RateconPdfInput = {
      ...BASE_INPUT,
      freightDetails: null,
      pickupAt: null,
      broker: { name: BASE_INPUT.broker.name, mcNumber: null, dotNumber: null },
      carrier: { name: BASE_INPUT.carrier.name, mcNumber: null, dotNumber: null },
      signature: { ...BASE_INPUT.signature, ipAddress: null },
    };
    const bytes = await renderRateconPdf(input);
    expect(Buffer.from(bytes.slice(0, 5)).toString('ascii')).toBe('%PDF-');
  });
});
