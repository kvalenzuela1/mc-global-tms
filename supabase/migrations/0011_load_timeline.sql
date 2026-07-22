-- =============================================================================
-- 0011_load_timeline.sql — Operational timeline for a load (WORKFLOW-REDESIGN
-- §10, AUD-02).
--
-- The audit_log is the legal record; the timeline is the operational story of a
-- load, unioned from the places events actually happen: milestones, documents,
-- the audit trail, rate confirmations, and signatures. Invoices/settlements are
-- M6 and deliberately left out until those flows exist.
--
--   security_invoker = true is MANDATORY (same rule as the loads view in 0006 —
--   omitting it there is the exact bug that leaked commercial data). With it,
--   each leg is read under the *querying* user's RLS: a broker member sees their
--   loads' events, and the audit leg — whose audit_select policy is limited to
--   org_admin / broker_manager / platform_superadmin — simply returns nothing
--   for roles without it, so no restricted history leaks through the union.
-- =============================================================================

create or replace view load_timeline with (security_invoker = true) as
  select
    load_id,
    occurred_at,
    'milestone'::text                      as source,
    ('milestone.' || kind)::text           as event,
    note                                   as detail,
    recorded_by                            as actor_id
  from milestones

  union all
  select
    load_id,
    created_at,
    'document'::text,
    ('document.' || doc_type)::text,
    storage_path,
    uploaded_by
  from documents
  where load_id is not null

  union all
  select
    entity_id::uuid,
    created_at,
    'audit'::text,
    action::text,
    null::text,
    actor_user_id
  from audit_log
  where entity_type = 'load' and entity_id is not null

  union all
  select
    load_id,
    coalesce(sent_at, created_at),
    'ratecon'::text,
    ('ratecon.' || status)::text,
    reference,
    null::uuid
  from rate_confirmations

  union all
  select
    rc.load_id,
    s.signed_at,
    'signature'::text,
    'ratecon.signed'::text,
    s.signer_name,
    s.signer_user_id
  from signatures s
  join rate_confirmations rc on rc.id = s.rate_confirmation_id;

comment on view load_timeline is
  'Operational event stream per load (§10 AUD-02). security_invoker: each leg '
  'is RLS-scoped to the querying user; the audit leg self-restricts to audit '
  'roles. Append-only sources; no writes go through this view.';
