/**
 * Signed rate-confirmation PDF rendering.
 *
 * Requirement coverage:
 *   FR-RC-08  Render the accepted content_snapshot + signature evidence
 *             (src/lib/signatures/evidence.ts) into a real, storable PDF once
 *             a carrier signs — the last piece of M5's send/sign/release loop.
 *
 * No Next/Supabase imports — pure input in, PDF bytes out — so this is
 * testable under `npm run test:offline` alongside the other domain modules
 * (pricing/calc.ts, loads/lifecycle.ts, pricing/override.ts).
 *
 * Layout mirrors the HTML rate-confirmation view in
 * src/app/portal/ratecons/page.tsx (RateconDocument): broker/carrier
 * identity, shipment, rate, signature block, disclaimer. Only ASCII/Latin-1
 * punctuation is used (plain "-" rather than "->"/middle-dot/em-dash) since
 * pdf-lib's standard 14 fonts only support WinAnsi encoding.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export interface RateconPdfInput {
  reference: string;
  version: number;
  origin: string;
  destination: string;
  serviceType: string;
  carrierRateCents: number;
  freightDetails: string | null;
  pickupAt: string | null;
  broker: { name: string; mcNumber: string | null; dotNumber: string | null };
  carrier: { name: string; mcNumber: string | null; dotNumber: string | null };
  signature: {
    signerName: string;
    signerTitle: string | null;
    signedAt: string; // ISO — also drives the PDF's CreationDate/ModDate
    ipAddress: string | null;
    documentHash: string;
  };
  disclaimer: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TEXT_COLOR = rgb(0.11, 0.12, 0.1);

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderRateconPdf(input: RateconPdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  // Fixed, input-derived dates so output is deterministic — pdf-lib defaults
  // CreationDate/ModDate to wall-clock time otherwise.
  const signedAt = new Date(input.signature.signedAt);
  const stampDate = Number.isNaN(signedAt.getTime()) ? new Date(0) : signedAt;
  pdfDoc.setCreationDate(stampDate);
  pdfDoc.setModificationDate(stampDate);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawLine = (text: string, opts: { size?: number; bold?: boolean; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    page.drawText(text, { x: MARGIN, y, size, font: opts.bold ? bold : font, color: TEXT_COLOR });
    y -= opts.gap ?? size + 6;
  };

  const drawWrapped = (text: string, opts: { size?: number; lineGap?: number; trailingGap?: number } = {}) => {
    const size = opts.size ?? 9;
    for (const line of wrapText(text, font, size, CONTENT_WIDTH)) {
      drawLine(line, { size, gap: opts.lineGap ?? size + 3 });
    }
    y -= opts.trailingGap ?? 6;
  };

  drawLine(`Rate Confirmation ${input.reference} (v${input.version})`, { size: 16, bold: true, gap: 24 });

  drawLine('Broker', { size: 9, bold: true, gap: 13 });
  drawLine(input.broker.name || '-', { gap: 13 });
  drawLine(`MC# ${input.broker.mcNumber ?? '-'} - DOT# ${input.broker.dotNumber ?? '-'}`, { size: 9, gap: 20 });

  drawLine('Carrier', { size: 9, bold: true, gap: 13 });
  drawLine(input.carrier.name || '-', { gap: 13 });
  drawLine(`MC# ${input.carrier.mcNumber ?? '-'} - DOT# ${input.carrier.dotNumber ?? '-'}`, { size: 9, gap: 20 });

  drawLine('Shipment', { size: 9, bold: true, gap: 13 });
  drawLine(`${input.origin || '-'} to ${input.destination || '-'}`, { gap: 13 });
  drawLine(`Service / Equipment: ${input.serviceType || '-'}`, { size: 9, gap: 13 });
  drawLine(`Pickup: ${formatDate(input.pickupAt)}`, { size: 9, gap: 13 });
  if (input.freightDetails) {
    drawWrapped(`Freight: ${input.freightDetails}`, { size: 9 });
  } else {
    y -= 6;
  }

  drawLine('Carrier Rate', { size: 9, bold: true, gap: 13 });
  drawLine(formatCents(input.carrierRateCents), { size: 14, bold: true, gap: 24 });

  drawLine('Acceptance', { size: 9, bold: true, gap: 13 });
  drawLine(
    `Signed by ${input.signature.signerName}` +
      `${input.signature.signerTitle ? `, ${input.signature.signerTitle}` : ''} on ${formatDate(input.signature.signedAt)}`,
    { size: 9, gap: 13 },
  );
  drawLine(`IP address: ${input.signature.ipAddress ?? '-'}`, { size: 9, gap: 13 });
  drawLine(`Document hash (sha256): ${input.signature.documentHash}`, { size: 8, gap: 20 });

  drawWrapped(input.disclaimer, { size: 8 });

  return pdfDoc.save();
}
