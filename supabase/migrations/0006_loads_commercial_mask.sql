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
