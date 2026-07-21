/**
 * FR-NOTIF-01 — Email template content.
 */
import { describe, it, expect } from 'vitest';
import {
  overrideNeedsApprovalEmail,
  loadBookedReadyForRateconEmail,
  loadDeliveredReadyToInvoiceEmail,
  rateconReadyToSignEmail,
  rateconSignedReadyForReleaseEmail,
} from '@/lib/notifications/templates';

describe('notification templates', () => {
  it('override-needs-approval includes the lane, price, margin, and reason', () => {
    const email = overrideNeedsApprovalEmail({
      lane: 'Newark, NJ → Atlanta, GA',
      shipperPriceCents: 250000,
      marginPercent: 0.09,
      reason: 'Customer is price-matching a competitor quote',
    });
    expect(email.subject).toContain('Newark, NJ → Atlanta, GA');
    expect(email.html).toContain('$2500.00');
    expect(email.html).toContain('9.0%');
    expect(email.html).toContain('Customer is price-matching a competitor quote');
    expect(email.templateKey).toBe('override_needs_approval');
  });

  it('load-booked email includes the reference, lane, and carrier', () => {
    const email = loadBookedReadyForRateconEmail({
      loadReference: 'LD-1051',
      lane: 'Elizabeth, NJ → Miami, FL',
      carrierName: 'Horizon Freight LLC',
    });
    expect(email.subject).toContain('LD-1051');
    expect(email.html).toContain('Elizabeth, NJ → Miami, FL');
    expect(email.html).toContain('Horizon Freight LLC');
    expect(email.templateKey).toBe('load_booked_ready_for_ratecon');
  });

  it('delivered email includes the reference and lane', () => {
    const email = loadDeliveredReadyToInvoiceEmail({
      loadReference: 'LD-1052',
      lane: 'Test → Test',
    });
    expect(email.subject).toContain('LD-1052');
    expect(email.subject).toContain('ready to invoice');
    expect(email.html).toContain('Test → Test');
    expect(email.templateKey).toBe('load_delivered_ready_to_invoice');
  });

  it('ratecon-ready-to-sign email includes the ratecon reference, load reference, and lane', () => {
    const email = rateconReadyToSignEmail({
      rateconReference: 'RC-2048',
      loadReference: 'LD-1051',
      lane: 'Elizabeth, NJ → Miami, FL',
    });
    expect(email.subject).toContain('RC-2048');
    expect(email.html).toContain('LD-1051');
    expect(email.html).toContain('Elizabeth, NJ → Miami, FL');
    expect(email.templateKey).toBe('ratecon_ready_to_sign');
  });

  it('ratecon-signed-ready-for-release email includes the load reference, lane, and carrier', () => {
    const email = rateconSignedReadyForReleaseEmail({
      loadReference: 'LD-1051',
      lane: 'Elizabeth, NJ → Miami, FL',
      carrierName: 'Horizon Freight LLC',
    });
    expect(email.subject).toContain('LD-1051');
    expect(email.subject).toContain('ready to release');
    expect(email.html).toContain('Elizabeth, NJ → Miami, FL');
    expect(email.html).toContain('Horizon Freight LLC');
    expect(email.templateKey).toBe('ratecon_signed_ready_for_release');
  });
});
