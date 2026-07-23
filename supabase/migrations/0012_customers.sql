-- =============================================================================
-- 0012_customers.sql — Customers module (CUS-01 / WORKFLOW-REDESIGN §7.6, C4).
--
-- `shippers` had 6 columns and no UI. Everything §9 needs — billing, terms,
-- saved locations, contacts — needs a real customer record. This expands
-- `shippers` in place (it is already the FK target of rfqs/quotes, so no rename)
-- and adds contacts + locations as children.
--
-- RLS mirrors `shippers`: broker-org members only (`app_is_member(org_id)`),
-- with `force row level security` so not even the table owner bypasses it. Both
-- new tables are covered in scripts/verify-rls.mjs.
-- =============================================================================

alter table shippers
  add column code               text,
  add column status             text not null default 'active'
    check (status in ('prospect','active','on_hold','inactive')),
  add column billing_email      text,
  add column payment_terms_days int not null default 30,
  add column credit_limit_cents bigint,
  add column tax_id             text,
  add column notes              text,
  add column created_by         uuid,
  add column updated_at         timestamptz not null default now();

-- keep shippers.updated_at fresh (touch_updated_at() defined in 0003).
create trigger shippers_touch before update on shippers
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------ contacts --
create table customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  shipper_id   uuid not null references shippers(id) on delete cascade,
  name         text not null,
  title        text,
  email        text,
  phone        text,
  role         text check (role in ('primary','billing','operations','receiving')),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index customer_contacts_shipper_idx on customer_contacts(shipper_id);

-- ----------------------------------------------------------- locations --
create table customer_locations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  shipper_id     uuid not null references shippers(id) on delete cascade,
  label          text not null,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  country        text not null default 'US',
  contact_name   text,
  contact_phone  text,
  hours          text,
  appointment_required boolean not null default false,
  created_at     timestamptz not null default now()
);
create index customer_locations_shipper_idx on customer_locations(shipper_id);

-- ----------------------------------------------------------------- RLS --
alter table customer_contacts  enable row level security;
alter table customer_contacts  force  row level security;
alter table customer_locations enable row level security;
alter table customer_locations force  row level security;

create policy customer_contacts_select on customer_contacts for select
  using (app_is_member(org_id));
create policy customer_contacts_write on customer_contacts for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));

create policy customer_locations_select on customer_locations for select
  using (app_is_member(org_id));
create policy customer_locations_write on customer_locations for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));
