-- =============================================================================
-- 0004_quote_status.sql — Full pricing-override approval state (Milestone 3).
--
-- 0001_core.sql gave quotes is_override/override_reason/override_approved_by,
-- but not who REQUESTED the override, WHEN it was approved, or the quote's own
-- lifecycle status. Without these the maker/checker flow in
-- src/lib/pricing/override.ts (evaluateRequest/evaluateApproval) has nowhere
-- to persist its decision.
-- =============================================================================

alter table quotes
  add column override_requested_by uuid,
  add column override_approved_at  timestamptz,
  add column status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','rejected'));
