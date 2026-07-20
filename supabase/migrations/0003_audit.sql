-- =============================================================================
-- 0003_audit.sql — Append-only audit log.
--
-- Requirement coverage:
--   FR-AUD-01  Records load transitions, compliance actions, pricing overrides,
--              signatures, acknowledgements, documents, and invoices.
--   FR-AUD-02  APPEND-ONLY: UPDATE and DELETE are rejected by trigger. Not even
--              the table owner may mutate history (defense in depth).
--   FR-AUD-03  Actor identity, org, before/after JSONB, and request metadata.
-- =============================================================================

create table audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references organizations(id),
  actor_user_id uuid,                          -- null for system actions
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  before_state  jsonb,
  after_state   jsonb,
  metadata      jsonb not null default '{}'::jsonb,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index audit_org_idx     on audit_log(org_id, created_at desc);
create index audit_entity_idx  on audit_log(entity_type, entity_id);

-- FR-AUD-02: block any mutation of existing audit rows.
create or replace function audit_block_mutation()
  returns trigger language plpgsql as $$
begin
  raise exception 'AUDIT_APPEND_ONLY: % on audit_log is not permitted', tg_op;
end;
$$;

create trigger audit_no_update before update on audit_log
  for each row execute function audit_block_mutation();
create trigger audit_no_delete before delete on audit_log
  for each row execute function audit_block_mutation();

-- RLS: members with audit permission read their org's trail; inserts happen via
-- the service-role writer (bypasses RLS) so an action can never be un-audited.
alter table audit_log enable row level security;
alter table audit_log force row level security;

create policy audit_select on audit_log for select
  using (app_has_role(org_id, array['org_admin','broker_manager','platform_superadmin']));

-- No insert/update/delete policies for normal roles => denied under RLS.
-- The service-role connection (bypassrls) performs the append (see audit/log.ts).

-- ---------------------------------------------------------------------------
-- FR-AUD-01: DB-level safety net — auto-audit load status transitions even if a
-- write bypasses the service layer. The app writer adds richer context; this
-- guarantees no silent status change.
-- ---------------------------------------------------------------------------
create or replace function audit_load_transition()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into audit_log(org_id, actor_user_id, action, entity_type, entity_id,
                          before_state, after_state, metadata)
    values (new.org_id, auth.uid(), 'load.transition', 'load', new.id::text,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status),
            jsonb_build_object('source','db_trigger'));
  end if;
  return new;
end;
$$;

create trigger loads_audit_transition after update on loads
  for each row execute function audit_load_transition();

-- keep loads.updated_at fresh
create or replace function touch_updated_at()
  returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger loads_touch before update on loads
  for each row execute function touch_updated_at();
