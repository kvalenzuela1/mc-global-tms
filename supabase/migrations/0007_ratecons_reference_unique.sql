-- =============================================================================
-- 0007_ratecons_reference_unique.sql — Guard rail for the RC-#### reference
-- generator (src/lib/ratecons/reference.ts), mirroring migration 0005 for
-- loads.reference.
-- =============================================================================

alter table rate_confirmations
  add constraint ratecons_org_reference_unique unique (org_id, reference);
