// Uploadable document categories for the load-scoped documents feature.
//
// Single source of truth: the upload action validates against this list and
// the Documents page renders its dropdown + labels from it, so the two can
// never drift. Kept as a pure module (no Next/Supabase imports) so it stays
// offline-testable, per the repo's testing convention.
//
// 'coi' and 'ratecon_pdf' remain valid at the DB level (documents doc_type
// CHECK constraint) but are deliberately NOT user-uploadable: COI is
// carrier-scoped and the documents RLS has no carrier_id carve-out (only org
// member / load access), and ratecon_pdf is system-generated, not manually
// uploaded. See supabase/migrations/0008_documents_storage.sql and
// 0014_documents_lumper_scale.sql.
export const UPLOADABLE_DOC_TYPES = [
  'bol',
  'pod',
  'receipt',
  'lumper',
  'scale_ticket',
  'other',
] as const;

export type UploadableDocType = (typeof UPLOADABLE_DOC_TYPES)[number];

// Display labels for every doc_type that can surface in the UI — the uploadable
// set plus the system-generated 'ratecon_pdf', which is shown in the documents
// table but never offered in the upload dropdown.
export const DOC_TYPE_LABELS: Record<string, string> = {
  bol: 'Bill of Lading',
  pod: 'Proof of Delivery',
  receipt: 'Receipt',
  lumper: 'Lumper Receipt',
  scale_ticket: 'Scale Ticket',
  ratecon_pdf: 'Signed Rate Confirmation',
  other: 'Other',
};

export function isUploadableDocType(value: string): value is UploadableDocType {
  return (UPLOADABLE_DOC_TYPES as readonly string[]).includes(value);
}
