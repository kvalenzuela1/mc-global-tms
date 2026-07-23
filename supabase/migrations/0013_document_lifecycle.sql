-- =============================================================================
-- 0013_document_lifecycle.sql — Document lifecycle (DOC-01 / WORKFLOW-REDESIGN
-- §7.4, C3).
--
-- `documents` had no status, version, or expiry — yet compliance depends on
-- documents expiring (insurance) and invoicing depends on a POD being
-- *verified*. This adds the lifecycle columns + indexes. RLS is unchanged: the
-- existing documents_select / documents_write policies (0002) already scope by
-- load access and cover the new columns.
--
-- Existing rows backfill to status 'uploaded' (the pre-lifecycle meaning of a
-- row that exists) and version 1, so nothing already uploaded becomes invalid.
-- =============================================================================

alter table documents
  add column name             text,
  add column version          int  not null default 1,
  add column supersedes_id    uuid references documents(id),
  add column status           text not null default 'uploaded'
    check (status in ('requested','uploaded','under_review','verified',
                      'rejected','superseded','archived')),
  add column effective_date   date,
  add column expires_at       date,
  add column verified_by      uuid,
  add column verified_at      timestamptz,
  add column rejection_reason text,
  add column mime_type        text,
  add column size_bytes       bigint;

create index documents_status_idx on documents(org_id, status);
create index documents_expiry_idx on documents(expires_at) where expires_at is not null;
