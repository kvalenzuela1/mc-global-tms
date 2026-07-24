-- =============================================================================
-- 0011_load_margins.sql — Reference-model load financials
-- (Shipper Cost → Broker margin + Dispatch margin → Carrier Pay).
--
-- Replaces the single-margin display on loads with the two-margin waterfall the
-- client's reference model specifies. Only the *inputs* are stored — shipper
-- cost (cents) and the two percents — resolved per load with the fallback
-- chain load-override → customer(shipper) default → org house default →
-- platform seed. Carrier Pay and the margin dollars are ALWAYS recomputed
-- (src/lib/pricing/margin.ts), never stored, so a stale row can never
-- misreconcile.
--
-- Commercial masking (FR-MASK-01): the new columns are commercial data. Rather
-- than widen the `loads` view (0006) — which CI re-applies verbatim as its
-- idempotency check, so its column list must stay frozen — the masked columns
-- are exposed through a SEPARATE security_invoker view, `load_financials`,
-- which nulls them for anyone outside the broker org exactly like
-- commercial_snapshot. The broker-vs-dispatch split *within* the broker org is
-- app-layer (visibleMarginLines), because every broker-org user maps to one
-- Postgres role and RLS cannot tell a dispatcher from a manager (same
-- reasoning as the quote-override separation).
--
-- Idempotent: safe to re-apply (add column if not exists, drop constraint if
-- exists, create or replace view, guarded seed insert).
-- =============================================================================

-- 1. New tenant role: Invoicing (read-all loads + view both financials +
--    manage invoices/payables in M6). The role list is an inline CHECK, which
--    Postgres names memberships_role_check.
alter table memberships drop constraint if exists memberships_role_check;
alter table memberships add constraint memberships_role_check check (role in (
  'org_admin','broker_manager','broker_dispatcher',
  'carrier_dispatch','driver','shipper','platform_superadmin','invoicing'));

-- 2. Per-customer default rates. Nullable = "no customer-specific rate, fall
--    back to the org house default". Broker members can already write shippers
--    (shippers_write RLS), so the Broker role can maintain these directly.
alter table shippers add column if not exists broker_percent   numeric(6,5);
alter table shippers add column if not exists dispatch_percent numeric(6,5);

-- 3. Per-load inputs / overrides. shipper_cost_cents is the revenue billed to
--    the shipper (seeded from the booked quote's shipper price, editable).
--    The percents are nullable overrides over the resolved defaults.
alter table loads_data add column if not exists shipper_cost_cents bigint;
alter table loads_data add column if not exists broker_percent     numeric(6,5);
alter table loads_data add column if not exists dispatch_percent   numeric(6,5);

-- 4. Masked read surface for the per-load financial inputs. security_invoker =
--    true runs the view with the CALLER's RLS against loads_data, and the
--    case-when nulls the commercial columns for anyone who is not a member of
--    the load's broker org — so Shipper/Carrier/Driver never receive them.
--    Row visibility itself is unchanged (loads_data RLS still decides which
--    rows are returned); this view only column-masks.
create or replace view load_financials
  with (security_invoker = true) as
select
  l.id,
  l.org_id,
  case when app_is_member(l.org_id) then l.shipper_cost_cents else null end as shipper_cost_cents,
  case when app_is_member(l.org_id) then l.broker_percent     else null end as broker_percent,
  case when app_is_member(l.org_id) then l.dispatch_percent   else null end as dispatch_percent
from loads_data l;

grant select on load_financials to authenticated;

-- 5. Platform-scope system default for the two margins (org_id null = platform).
--    Guarded so a re-run doesn't stack duplicate seeds.
insert into policies (org_id, scope, policy_key, version, value, effective_at, is_active)
select null, 'platform', 'load_margins', 1,
       '{"broker_percent": 0.18, "dispatch_percent": 0.05}'::jsonb, now(), true
where not exists (
  select 1 from policies
  where org_id is null and scope = 'platform' and policy_key = 'load_margins'
);
