/**
 * FR-NOTIF-01 — Email template content.
 */
import { describe, it, expect } from 'vitest';
import {
  overrideNeedsApprovalEmail,
  loadBookedReadyForRateconEmail,
  loadDeliveredReadyToInvoiceEmail,
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
});
