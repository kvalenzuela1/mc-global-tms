/**
 * Email templates for the "someone needs to act next" notifications.
 *
 * Pure string-building only — no Next/Supabase imports — so this runs under
 * `npm run test:offline` alongside pricing/calc.ts and the other domain
 * modules. Recipient resolution and sending live in notify.server.ts, which
 * imports these.
 *
 * Requirement coverage:
 *   FR-NOTIF-01  Each notification prompts the actual next actor (the
 *                permission-holder for the next step), not a vanity FYI —
 *                see notify.server.ts for which permission maps to which
 *                event.
 */

export interface EmailContent {
  subject: string;
  html: string;
  templateKey: string;
  templateVersion: string;
}

function wrap(body: string): string {
  return `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#1c1e1a">${body}</div>`;
}

export function overrideNeedsApprovalEmail(input: {
  lane: string;
  shipperPriceCents: number;
  marginPercent: number;
  reason: string;
}): EmailContent {
  const price = (input.shipperPriceCents / 100).toFixed(2);
  const margin = (input.marginPercent * 100).toFixed(1);
  return {
    subject: `Pricing override needs your approval — ${input.lane}`,
    html: wrap(
      `<p>A quote for <strong>${input.lane}</strong> breaches pricing policy and needs a second approver.</p>` +
        `<p>Shipper price: $${price} · Margin: ${margin}%</p>` +
        `<p>Reason given: ${input.reason}</p>` +
        `<p>Review it on the Pricing page.</p>`,
    ),
    templateKey: 'override_needs_approval',
    templateVersion: '1',
  };
}

export function loadBookedReadyForRateconEmail(input: {
  loadReference: string;
  lane: string;
  carrierName: string;
}): EmailContent {
  return {
    subject: `${input.loadReference} is booked — ready to send a rate confirmation`,
    html: wrap(
      `<p><strong>${input.loadReference}</strong> (${input.lane}) has been booked with <strong>${input.carrierName}</strong>.</p>` +
        `<p>Send the rate confirmation from the Rate Confirmations page.</p>`,
    ),
    templateKey: 'load_booked_ready_for_ratecon',
    templateVersion: '1',
  };
}

export function loadDeliveredReadyToInvoiceEmail(input: {
  loadReference: string;
  lane: string;
}): EmailContent {
  return {
    subject: `${input.loadReference} delivered — ready to invoice`,
    html: wrap(
      `<p><strong>${input.loadReference}</strong> (${input.lane}) has been marked delivered.</p>` +
        `<p>It's ready to invoice.</p>`,
    ),
    templateKey: 'load_delivered_ready_to_invoice',
    templateVersion: '1',
  };
}
