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
