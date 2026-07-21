-- =============================================================================
-- 0008_documents_storage.sql — Supabase Storage bucket + RLS for the
-- `documents` table's `storage_path` column (FR-DOC-01).
--
-- The `documents` Postgres table and its RLS have existed since 0001/0002,
-- built in anticipation of this feature but never wired to an actual Storage
-- bucket. This migration creates that bucket and mirrors the table's own
-- access predicate onto `storage.objects`, using the exact same
-- `app_is_member()` / `app_user_can_access_load()` helpers already defined —
-- so the tenant/role boundary is identical whether reading the Postgres row
-- or the underlying file.
--
-- Object path convention: `{org_id}/{load_id}/{uuid}-{filename}`. This pass
-- only covers load-scoped documents (bol/pod/receipt/other) — a purely
-- carrier-scoped document (e.g. COI with no load) has no carve-out here,
-- same limitation the `documents` table's own RLS already has.
--
-- Idempotent: bucket insert uses `on conflict do nothing`; policies are
-- dropped and recreated so this is safe to re-apply.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 4718592) -- 4.5MB, matching Vercel's own request body ceiling
on conflict (id) do nothing;

drop policy if exists documents_bucket_select on storage.objects;
create policy documents_bucket_select on storage.objects for select
  using (
    bucket_id = 'documents'
    and (
      app_is_member(((storage.foldername(name))[1])::uuid)
      or app_user_can_access_load(((storage.foldername(name))[2])::uuid)
    )
  );

drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (
      app_is_member(((storage.foldername(name))[1])::uuid)
      or app_user_can_access_load(((storage.foldername(name))[2])::uuid)
    )
  );
