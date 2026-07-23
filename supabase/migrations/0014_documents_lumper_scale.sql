-- =============================================================================
-- 0014_documents_lumper_scale.sql — add 'lumper' and 'scale_ticket' document
-- types.
--
-- Carriers need to file lumper receipts and scale tickets as first-class
-- document types. Previously these could only be captured as 'receipt'/'other'
-- (or, for lumpers, as a billing accessorial with no supporting document).
-- This widens the documents.doc_type CHECK constraint to admit them.
--
-- Additive only — it permits new values, it does not touch existing rows, so
-- no data migration is needed. The permitted set stays a superset of what the
-- app offers for upload: 'coi' and 'ratecon_pdf' remain valid at the DB level
-- but are still not user-uploadable (see src/lib/documents/types.ts).
-- =============================================================================

alter table documents drop constraint if exists documents_doc_type_check;

alter table documents add constraint documents_doc_type_check
  check (doc_type in ('bol','pod','coi','ratecon_pdf','receipt','lumper','scale_ticket','other'));
