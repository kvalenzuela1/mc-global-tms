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
  -- 'broker' = M.C. Global tenant; 'carrier'/'shipper' = external partner orgs.
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
