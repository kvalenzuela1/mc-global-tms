-- =============================================================================
-- 0005_loads_reference_unique.sql — Guard rail for the LD-#### reference
-- generator (src/lib/loads/reference.ts).
--
-- `reference` has no DB sequence or default — the app computes the next
-- LD-#### number from existing rows and retries on conflict. A per-org unique
-- constraint is what makes that retry loop actually safe under concurrent
-- inserts instead of silently allowing two loads with the same reference.
-- =============================================================================

alter table loads
  add constraint loads_org_reference_unique unique (org_id, reference);
