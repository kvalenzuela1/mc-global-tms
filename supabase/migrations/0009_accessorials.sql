-- =============================================================================
-- 0009_accessorials.sql — Accessorial charges (FR-ACC-01/02).
--
-- An accessorial is an extra billable charge beyond the base linehaul rate:
-- detention (truck held past free time), layover (driver forced to stop
-- overnight), a lumper fee (third-party dock labor), or TONU (Truck Ordered
-- Not Used — the truck showed up but the freight wasn't ready).
--
-- This is deliberately just a record of a charge, not a payment — Phase 1
-- does not move money (see CLAUDE.md). It does not touch commercial_snapshot
-- or recompute quote/load margin; it's an additive line item that will feed
-- the invoice engine once that exists (M6), the same way `quotes` and
-- `rate_confirmations` are commercial data the broker org alone can see.
-- =============================================================================

create table accessorials (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  load_id      uuid not null references loads_data(id) on delete cascade,
  type         text not null check (type in ('detention','layover','lumper','tonu')),
  amount_cents bigint not null check (amount_cents > 0),
  billable_to  text not null check (billable_to in ('customer','carrier')),
  description  text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index accessorials_org_idx on accessorials(org_id);
create index accessorials_load_idx on accessorials(load_id);

alter table accessorials enable row level security;
alter table accessorials force row level security;

-- Same shape as quotes_all: COMMERCIAL, broker org only. Carriers/drivers
-- never see an accessorial charge through this table — if a carrier needs to
-- see "you're owed a detention fee," that's surfaced via the rate
-- confirmation/payment flow (M6+), not by relaxing this policy.
create policy accessorials_all on accessorials for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));
