-- Local/CI compatibility shim (NOT applied on Supabase, where auth.uid() and
-- the authenticated/anon roles exist already).
-- Provides auth.uid() that reads the JWT subject from a session GUC so RLS
-- policies behave identically to Supabase during tests.
create schema if not exists auth;
create or replace function auth.uid()
  returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Every Supabase project has `authenticated`/`anon` Postgres roles out of the
-- box, which is why 0001-0003 never had to GRANT anything to them explicitly.
-- 0006 is the first migration to name `authenticated` directly (for the
-- `loads` view), so a bare local/CI Postgres needs these roles created first.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;
