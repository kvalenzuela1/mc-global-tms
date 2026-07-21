-- Local/CI compatibility shim (NOT applied on Supabase, where auth.uid(),
-- the authenticated/anon roles, and the storage schema all exist already).
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

-- A bare/CI Postgres has no Supabase Storage schema at all. 0008 is the
-- first migration to touch `storage.buckets`/`storage.objects`, so shim a
-- minimal version of both — just enough columns for that migration's DDL to
-- apply cleanly — plus `storage.foldername()`, mirroring Supabase's actual
-- implementation (split the object path on '/', drop the final segment).
create schema if not exists storage;
create table if not exists storage.buckets (
  id               text primary key,
  name             text not null,
  public           boolean not null default false,
  file_size_limit  bigint,
  created_at       timestamptz not null default now()
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
  returns text[] language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end;
$$;
