-- Local/CI compatibility shim (NOT applied on Supabase, where auth.uid() exists).
-- Provides auth.uid() that reads the JWT subject from a session GUC so RLS
-- policies behave identically to Supabase during tests.
create schema if not exists auth;
create or replace function auth.uid()
  returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
