-- =============================================================================
-- supabase_setup.sql — paste-and-run in the Supabase SQL editor.
-- Applies core schema + RLS + audit + Milestone 3 additions (migrations
-- 0001-0006) in one shot. auth.uid() already exists on Supabase, so NO local
-- shim is included.
-- =============================================================================

-- =============================================================================
-- 0001_core.sql — Core tenancy, identity, config, and domain schema.
--
-- Requirement coverage:
--   FR-TEN-01  organizations + memberships model multi-tenant isolation.
--   FR-CFG-03  Pricing/compliance/document/notification policy stored as
--              VERSIONED config records (no hardcoded commercial values).
--   FR-LD-01   Canonical load lifecycle status enum.
--   FR-SNAP-01 Immutable commercial snapshots (JSONB) on quotes/loads/ratecons/
--              invoices/settlements.
--
-- Money is stored in integer CENTS (bigint). Percentages are numeric(6,5) in
-- [0,1). Timestamps are timestamptz stored in UTC.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ------------------------------------------------------------------ helpers --
-- FR-TEN-02: membership/role helpers used by RLS. SECURITY DEFINER so they can
-- read memberships without tripping that table's own RLS (prevents recursion).
create or replace function app_current_user_id()
  returns uuid language sql stable as $$ select auth.uid() $$;

-- ------------------------------------------------------------ organizations --
create table organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- 'broker' = MC Global tenant; 'carrier'/'shipper' = external partner orgs.
  org_type     text not null check (org_type in ('broker','carrier','shipper')),
  mc_number    text,
  dot_number   text,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------- memberships --
-- FR-TEN-01/RBAC-01: a user's role is scoped to an organization. A user may
-- hold memberships in multiple orgs (authorized workspace switch).
create table memberships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,                 -- references auth.users(id) on Supabase
  org_id       uuid not null references organizations(id) on delete cascade,
  role         text not null check (role in (
                 'org_admin','broker_manager','broker_dispatcher',
                 'carrier_dispatch','driver','shipper','platform_superadmin')),
  created_at   timestamptz not null default now(),
  unique (user_id, org_id)
);
create index memberships_user_idx on memberships(user_id);
create index memberships_org_idx  on memberships(org_id);

create or replace function app_is_member(target_org uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function app_has_role(target_org uuid, roles text[])
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = any(roles)
  );
$$;

-- ------------------------------------------------------- versioned policies --
-- FR-CFG-03: configuration resolves platform default -> org policy -> exception
-- -> immutable snapshot. Stored as versioned rows; a change governs future work
-- only. `scope` distinguishes the resolution layer.
create table policies (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references organizations(id) on delete cascade, -- null = platform default
  scope        text not null check (scope in ('platform','organization','exception')),
  policy_key   text not null,                 -- e.g. 'pricing','quick_pay','compliance'
  version      int  not null default 1,
  value        jsonb not null,
  effective_at timestamptz not null default now(),
  is_active    boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index policies_lookup_idx on policies(org_id, policy_key, is_active);

-- ---------------------------------------------------------------- shippers --
create table shippers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade, -- broker tenant
  shipper_org_id uuid references organizations(id),  -- external shipper org (portal)
  name         text not null,
  margin_band  text,                          -- references a configured band
  created_at   timestamptz not null default now()
);
create index shippers_org_idx on shippers(org_id);

-- ---------------------------------------------------------------- carriers --
create table carriers (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade, -- broker tenant
  carrier_org_id uuid references organizations(id),  -- external carrier org (portal)
  name           text not null,
  dot_number     text not null,
  mc_number      text,
  -- FR-CMP-03: new carriers are Conditional until manual review approves them.
  status         text not null default 'conditional'
                 check (status in ('conditional','approved','suspended','rejected')),
  created_at     timestamptz not null default now()
);
create index carriers_org_idx on carriers(org_id);

-- FR-CMP-01/02: point-in-time compliance snapshot per carrier (fed by FMCSA
-- adapter + manual COI entry). Release gate reads the latest active row.
create table carrier_compliance (
  id                 uuid primary key default gen_random_uuid(),
  carrier_id         uuid not null references carriers(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  authority_status   text not null default 'unknown'
                     check (authority_status in ('active','inactive','not_authorized','unknown')),
  out_of_service     boolean not null default false,
  insurance_expiry   date,
  auto_liability_cents bigint,
  cargo_cents        bigint,
  required_docs_present boolean not null default false,
  manual_review      text not null default 'pending'
                     check (manual_review in ('approved','conditional','rejected','pending')),
  fmcsa_source       text,
  fmcsa_fetched_at   timestamptz,
  created_at         timestamptz not null default now()
);
create index carrier_compliance_carrier_idx on carrier_compliance(carrier_id);

-- ----------------------------------------------------------------- drivers --
create table drivers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade, -- broker tenant
  carrier_id   uuid not null references carriers(id) on delete cascade,
  user_id      uuid,                          -- linked auth user (driver login)
  name         text not null,
  phone        text,
  created_at   timestamptz not null default now()
);
create index drivers_carrier_idx on drivers(carrier_id);

-- -------------------------------------------------------------------- RFQs --
create table rfqs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  shipper_id   uuid references shippers(id),
  service_type text not null default 'trucking'
               check (service_type in ('trucking','drayage','cross_dock','warehousing','consulting')),
  origin       text not null,
  destination  text not null,
  freight_details text,                       -- descriptive (e.g. "18,000 lbs · 26 pallets")
  pickup_at    timestamptz,
  status       text not null default 'open',
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index rfqs_org_idx on rfqs(org_id);

-- ------------------------------------------------------------------- loads --
create table loads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  rfq_id        uuid references rfqs(id),
  shipper_id    uuid references shippers(id),
  carrier_id    uuid references carriers(id),
  driver_id     uuid references drivers(id),
  service_type  text not null default 'trucking',
  reference     text not null,                -- e.g. 'LD-1045'
  origin        text not null,
  destination   text not null,
  -- FR-LD-01: canonical status sequence.
  status        text not null default 'draft' check (status in (
                  'draft','quoted','booked','awaiting_carrier_signature',
                  'signed_awaiting_broker_release','released_to_driver',
                  'driver_acknowledged','dispatched','in_transit','delivered',
                  'invoiced','closed')),
  -- FR-SNAP-01: immutable commercial snapshot captured at acceptance.
  commercial_snapshot jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index loads_org_idx     on loads(org_id);
create index loads_carrier_idx on loads(carrier_id);
create index loads_status_idx  on loads(status);

-- ------------------------------------------------------------------ quotes --
create table quotes (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  load_id               uuid references loads(id) on delete cascade,
  rfq_id                uuid references rfqs(id),
  -- FR-PR-01/02: pricing snapshot (cents + percents) stored, never recomputed.
  carrier_linehaul_cents bigint not null,
  shipper_price_cents    bigint not null,
  margin_amount_cents    bigint not null,
  margin_percent         numeric(6,5) not null,
  target_margin_percent  numeric(6,5) not null,
  quick_pay_fee_percent  numeric(6,5) not null,
  quick_pay_fee_cents    bigint not null,
  factoring_cost_percent numeric(6,5) not null,
  pricing_snapshot       jsonb not null,
  -- FR-PR: override tracking
  is_override            boolean not null default false,
  override_reason        text,
  override_approved_by   uuid,
  created_by             uuid,
  created_at             timestamptz not null default now()
);
create index quotes_load_idx on quotes(load_id);

-- ------------------------------------------------------- rate confirmations --
create table rate_confirmations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  load_id       uuid not null references loads(id) on delete cascade,
  carrier_id    uuid not null references carriers(id),
  reference     text not null,                -- e.g. 'RC-2048'
  version       int not null default 1,
  template_version text not null,             -- versioned, lawyer-reviewed template id
  status        text not null default 'draft'
                check (status in ('draft','sent','signed','superseded')),
  -- FR-SNAP-01: locked commercial content the carrier accepts.
  content_snapshot jsonb not null,
  content_hash  text,                          -- sha256 of accepted content
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index ratecons_load_idx on rate_confirmations(load_id);

-- FR-RC-06: immutable signature evidence.
create table signatures (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  rate_confirmation_id uuid not null references rate_confirmations(id) on delete cascade,
  signer_user_id     uuid not null,
  signer_name        text not null,
  signer_title       text,
  document_version   int not null,
  document_hash      text not null,
  consent_text_version text not null,
  ip_address         text,
  user_agent         text,
  disclaimer_version text not null default 'v1',
  signed_at          timestamptz not null,
  created_at         timestamptz not null default now()
);
create index signatures_rc_idx on signatures(rate_confirmation_id);

-- --------------------------------------------------------------- documents --
create table documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  load_id      uuid references loads(id) on delete cascade,
  carrier_id   uuid references carriers(id),
  doc_type     text not null check (doc_type in ('bol','pod','coi','ratecon_pdf','receipt','other')),
  storage_path text,                           -- Supabase Storage object path
  file_hash    text,
  uploaded_by  uuid,
  created_at   timestamptz not null default now()
);
create index documents_load_idx on documents(load_id);

-- -------------------------------------------------------------- milestones --
create table milestones (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  load_id      uuid not null references loads(id) on delete cascade,
  kind         text not null check (kind in ('pickup','check_call','in_transit','delivery','exception')),
  note         text,
  occurred_at  timestamptz not null default now(),
  recorded_by  uuid,
  created_at   timestamptz not null default now()
);
create index milestones_load_idx on milestones(load_id);

-- ---------------------------------------------------------------- invoices --
create table invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  load_id       uuid not null references loads(id) on delete cascade,
  invoice_number text not null,
  amount_cents  bigint not null,
  -- FR-SNAP-01: immutable billing snapshot.
  snapshot      jsonb not null,
  status        text not null default 'issued' check (status in ('issued','paid','void')),
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index invoices_load_idx on invoices(load_id);

-- FR-FCT-01: factoring-ready settlement packet — NO money movement.
create table settlements (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  load_id            uuid not null references loads(id) on delete cascade,
  carrier_id         uuid not null references carriers(id),
  carrier_net_cents  bigint not null,
  quick_pay_fee_cents bigint not null,
  factoring_reference text,
  packet_snapshot    jsonb not null,
  status             text not null default 'packet_created'
                     check (status in ('packet_created','submitted','accepted','carrier_paid','reconciled')),
  finance_approved_by uuid,
  created_at         timestamptz not null default now()
);
create index settlements_load_idx on settlements(load_id);


-- =============================================================================
-- 0002_rls.sql — Row Level Security. Tenant isolation + relationship access.
--
-- Requirement coverage:
--   FR-TEN-01  A member of org A can never read/write org B's rows.
--   FR-TEN-04  Carriers see only loads assigned to their carrier; drivers see
--              only their own loads; shippers see only their own records.
--   FR-RBAC-05 RLS is defense-in-depth beneath the app-layer permission checks.
--
-- All helper predicates are SECURITY DEFINER to avoid RLS recursion when a
-- policy references another protected table.
-- =============================================================================

-- Access-relationship helpers ------------------------------------------------
create or replace function app_carrier_user_can_access(target_carrier uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from carriers c
    join memberships m on m.org_id = c.carrier_org_id
    where c.id = target_carrier and m.user_id = auth.uid()
  );
$$;

create or replace function app_driver_owns(target_driver uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from drivers d where d.id = target_driver and d.user_id = auth.uid()
  );
$$;

create or replace function app_shipper_user_can_access(target_shipper uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from shippers s
    join memberships m on m.org_id = s.shipper_org_id
    where s.id = target_shipper and m.user_id = auth.uid()
  );
$$;

-- FR-TEN-04: consolidated load-access predicate (broker OR carrier OR driver OR shipper).
create or replace function app_user_can_access_load(target_load uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loads l
    where l.id = target_load
      and (
        app_is_member(l.org_id)
        or (l.carrier_id is not null and app_carrier_user_can_access(l.carrier_id))
        or (l.driver_id  is not null and app_driver_owns(l.driver_id))
        or (l.shipper_id is not null and app_shipper_user_can_access(l.shipper_id))
      )
  );
$$;

-- Enable + FORCE RLS on every tenant table -----------------------------------
alter table organizations       enable row level security;
alter table memberships         enable row level security;
alter table policies            enable row level security;
alter table shippers            enable row level security;
alter table carriers            enable row level security;
alter table carrier_compliance  enable row level security;
alter table drivers             enable row level security;
alter table rfqs                enable row level security;
alter table loads               enable row level security;
alter table quotes              enable row level security;
alter table rate_confirmations  enable row level security;
alter table signatures          enable row level security;
alter table documents           enable row level security;
alter table milestones          enable row level security;
alter table invoices            enable row level security;
alter table settlements         enable row level security;

alter table organizations       force row level security;
alter table memberships         force row level security;
alter table policies            force row level security;
alter table shippers            force row level security;
alter table carriers            force row level security;
alter table carrier_compliance  force row level security;
alter table drivers             force row level security;
alter table rfqs                force row level security;
alter table loads               force row level security;
alter table quotes              force row level security;
alter table rate_confirmations  force row level security;
alter table signatures          force row level security;
alter table documents           force row level security;
alter table milestones          force row level security;
alter table invoices            force row level security;
alter table settlements         force row level security;

-- organizations: visible to members --------------------------------------------
create policy org_select on organizations for select using (app_is_member(id));

-- memberships: own rows, or org admin sees the org's memberships -----------------
create policy mem_select on memberships for select
  using (user_id = auth.uid() or app_has_role(org_id, array['org_admin']));
create policy mem_admin_write on memberships for all
  using (app_has_role(org_id, array['org_admin']))
  with check (app_has_role(org_id, array['org_admin']));

-- policies (config): members read; admins write --------------------------------
create policy pol_select on policies for select
  using (org_id is null or app_is_member(org_id));
create policy pol_admin_write on policies for all
  using (org_id is not null and app_has_role(org_id, array['org_admin']))
  with check (org_id is not null and app_has_role(org_id, array['org_admin']));

-- Generic org-scoped tables: broker members read + write -----------------------
create policy shippers_select on shippers for select
  using (app_is_member(org_id) or app_shipper_user_can_access(id));
create policy shippers_write on shippers for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

create policy carriers_select on carriers for select
  using (app_is_member(org_id) or app_carrier_user_can_access(id));
create policy carriers_write on carriers for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

create policy carrier_compliance_select on carrier_compliance for select
  using (app_is_member(org_id) or app_carrier_user_can_access(carrier_id));
create policy carrier_compliance_write on carrier_compliance for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

create policy drivers_select on drivers for select
  using (app_is_member(org_id) or app_carrier_user_can_access(carrier_id) or user_id = auth.uid());
create policy drivers_write on drivers for all
  using (app_is_member(org_id) or app_carrier_user_can_access(carrier_id))
  with check (app_is_member(org_id) or app_carrier_user_can_access(carrier_id));

create policy rfqs_select on rfqs for select
  using (app_is_member(org_id) or app_shipper_user_can_access(shipper_id));
create policy rfqs_write on rfqs for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

-- loads: FR-TEN-04 relationship access ------------------------------------------
create policy loads_select on loads for select
  using (
    app_is_member(org_id)
    or (carrier_id is not null and app_carrier_user_can_access(carrier_id))
    or (driver_id  is not null and app_driver_owns(driver_id))
    or (shipper_id is not null and app_shipper_user_can_access(shipper_id))
  );
create policy loads_write on loads for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

-- quotes/invoices/settlements: COMMERCIAL — broker org only (carriers/drivers
-- never see broker margin via these tables). FR-MASK-01 at the storage layer.
create policy quotes_all on quotes for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));
create policy invoices_all on invoices for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));
create policy settlements_all on settlements for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

-- rate confirmations: broker + the assigned carrier -----------------------------
create policy ratecons_select on rate_confirmations for select
  using (app_is_member(org_id) or app_carrier_user_can_access(carrier_id));
create policy ratecons_write on rate_confirmations for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

-- signatures: broker + the signing carrier (read); insert by carrier or broker --
create policy signatures_select on signatures for select
  using (app_is_member(org_id)
         or exists (select 1 from rate_confirmations rc
                    where rc.id = rate_confirmation_id
                      and app_carrier_user_can_access(rc.carrier_id)));
create policy signatures_insert on signatures for insert
  with check (app_is_member(org_id)
              or exists (select 1 from rate_confirmations rc
                         where rc.id = rate_confirmation_id
                           and app_carrier_user_can_access(rc.carrier_id)));

-- documents/milestones: anyone who can access the load --------------------------
create policy documents_select on documents for select
  using (app_is_member(org_id) or (load_id is not null and app_user_can_access_load(load_id)));
create policy documents_write on documents for all
  using (app_is_member(org_id) or (load_id is not null and app_user_can_access_load(load_id)))
  with check (app_is_member(org_id) or (load_id is not null and app_user_can_access_load(load_id)));

create policy milestones_select on milestones for select
  using (app_is_member(org_id) or app_user_can_access_load(load_id));
create policy milestones_write on milestones for all
  using (app_is_member(org_id) or app_user_can_access_load(load_id))
  with check (app_is_member(org_id) or app_user_can_access_load(load_id));


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


-- =============================================================================
-- 0006_loads_commercial_mask.sql — Storage-layer masking for
-- loads.commercial_snapshot (FR-MASK-01).
--
-- verify-rls.mjs proved RLS alone is not enough here: RLS is row-level, so
-- once a driver/carrier is granted visibility of a load row they're related
-- to (FR-TEN-04), PostgREST returns EVERY column on that row — including the
-- raw commercial_snapshot JSONB, which maskCommercials() does not traverse
-- (src/lib/masking/driver.ts). Column-level GRANT/REVOKE can't fix this
-- either: every tenant user maps to the same Postgres role (`authenticated`),
-- broker and driver alike. RLS cannot mask a column within a row it already
-- allows to be read, so the physical table is renamed and the public `loads`
-- name is reassigned to a view that nulls commercial_snapshot for anyone
-- outside the load's broker org.
--
-- `security_invoker = true` (Postgres 15+) makes the view run with the
-- CALLER's privileges/RLS against loads_data, not the view owner's — so
-- app_is_member() still resolves auth.uid() to the real requesting user, and
-- row visibility (broker/carrier/driver/shipper) is unchanged. App code that
-- legitimately needs full read/write access (the broker-only server actions
-- in src/app/portal/loads/actions.ts, all gated by requirePermission) targets
-- `loads_data` directly; every other reader — verify-rls.mjs, the loads list
-- page — goes through `loads`, which is now this view.
--
-- Idempotent by design: safe to re-apply against a database where this has
-- already run (e.g. `setup:supabase`'s own idempotency claim, or CI re-running
-- the full migration set without a reset in between).
-- =============================================================================

-- Rename the base table, but only if it hasn't already happened — on a second
-- run, `loads` is the view created below, not the ordinary table 0001 made.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'loads' and c.relkind = 'r'
  ) then
    alter table loads rename to loads_data;
  end if;
end
$$;

-- FR-TEN-04: re-point the load-access predicate at the renamed table. Indexes,
-- RLS policies, and triggers on the table itself followed the rename
-- automatically (Postgres tracks them by OID); this function is the only
-- place that named it explicitly.
create or replace function app_user_can_access_load(target_load uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loads_data l
    where l.id = target_load
      and (
        app_is_member(l.org_id)
        or (l.carrier_id is not null and app_carrier_user_can_access(l.carrier_id))
        or (l.driver_id  is not null and app_driver_owns(l.driver_id))
        or (l.shipper_id is not null and app_shipper_user_can_access(l.shipper_id))
      )
  );
$$;

create or replace view loads
  with (security_invoker = true) as
select
  l.id, l.org_id, l.rfq_id, l.shipper_id, l.carrier_id, l.driver_id,
  l.service_type, l.reference, l.origin, l.destination, l.status,
  case when app_is_member(l.org_id) then l.commercial_snapshot else null end as commercial_snapshot,
  c.name as carrier_name,
  l.created_by, l.created_at, l.updated_at
from loads_data l
left join carriers c on c.id = l.carrier_id;

grant select on loads to authenticated;


-- =============================================================================
-- 0007_ratecons_reference_unique.sql — Guard rail for the RC-#### reference
-- generator (src/lib/ratecons/reference.ts), mirroring migration 0005 for
-- loads.reference.
-- =============================================================================

alter table rate_confirmations
  add constraint ratecons_org_reference_unique unique (org_id, reference);
