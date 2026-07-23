'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { hashBytes } from '@/lib/documents/hash';
import type { ActionResult } from '@/lib/actions/result';

// Load-scoped only for now — 'coi' and 'ratecon_pdf' are left out: COI is
// carrier-scoped and documents_select/write RLS has no carrier_id carve-out
// (only org member or load access), and ratecon_pdf is meant to be
// system-generated once M5's real PDF generation exists, not manually
// uploaded. See supabase/migrations/0008_documents_storage.sql.
const DOC_TYPES = new Set(['bol', 'pod', 'receipt', 'other']);

// Real ceiling, not arbitrary: matches the bucket's own file_size_limit
// (0008_documents_storage.sql) and stays under Vercel's ~4.5MB serverless
// request body limit.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

interface AccessibleLoad {
  id: string;
  org_id: string;
  driver_id: string | null;
}

/**
 * Resolves the target load through the masked `loads` view — a null result
 * means either it doesn't exist or RLS denied it (this caller isn't related
 * to it), same ambiguous-on-purpose message either way as elsewhere in this
 * app. For a driver, additionally re-verifies the load is assigned to THEM
 * specifically (not just any load RLS happens to let them read), mirroring
 * driver/actions.ts's resolveOwnedLoad.
 */
async function resolveAccessibleLoad(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  role: string,
  userId: string,
  loadId: string,
): Promise<AccessibleLoad | null> {
  const { data: load, error } = await supabase
    .from('loads')
    .select('id, org_id, driver_id')
    .eq('id', loadId)
    .maybeSingle();
  if (error) throw error;
  const row = load as AccessibleLoad | null;
  if (!row) return null;

  if (role === ROLES.DRIVER) {
    const { data: driver } = await supabase
      .from('drivers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!driver || row.driver_id !== driver.id) return null;
  }
  return row;
}

/** Keeps the filename safe as a storage path segment — no extra "/" or exotic characters. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadDocument(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const docType = String(formData.get('docType') ?? '');
  const file = formData.get('file');

  const { ctx, membership } = await requirePermission(orgId, PERMISSIONS.DOCUMENT_UPLOAD);

  if (!DOC_TYPES.has(docType)) {
    return { ok: false, error: 'Invalid document type.' };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file to upload.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'File is too large — max 4MB.' };
  }

  const supabase = await getServerSupabase();
  const load = await resolveAccessibleLoad(supabase, membership.role, ctx.userId, loadId);
  if (!load) return { ok: false, error: 'Load not found.' };

  // load.org_id/load.id come straight from the DB (always real UUIDs, never
  // user-supplied path text) and the filename above is already stripped of
  // "/" — so a stray slash can't reach the path today. Asserting the UUID
  // shape here is defense-in-depth against that guarantee ever quietly
  // breaking in a future refactor, not a fix for a currently reachable bug.
  if (!UUID_RE.test(load.org_id) || !UUID_RE.test(load.id)) {
    throw new Error(`Unexpected non-UUID org/load id building a document path: ${load.org_id}/${load.id}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${load.org_id}/${load.id}/${randomUUID()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(path, bytes, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;

  const { data: inserted, error: insertError } = await supabase
    .from('documents')
    .insert({
      org_id: load.org_id,
      load_id: load.id,
      doc_type: docType,
      storage_path: path,
      file_hash: hashBytes(bytes),
      uploaded_by: ctx.userId,
    })
    .select('id')
    .single();
  if (insertError) {
    // The upload above already succeeded — without this, a failed insert
    // (e.g. a transient DB error) leaves an orphaned file with no record of
    // it anywhere. Best-effort: if the cleanup itself fails, the original
    // insert error is still what gets thrown, not swallowed.
    await supabase.storage.from('documents').remove([path]).catch(() => {});
    throw insertError;
  }

  await writeAudit({
    orgId: load.org_id,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
    entityType: 'document',
    entityId: inserted.id,
    after: { loadId: load.id, docType, storagePath: path },
  });

  revalidatePath('/portal/documents');
  return { ok: true };
}

// A document can only be verified/rejected while it is still pending review —
// not once it is already verified, rejected, superseded, or archived. The
// UPDATE carries this as a WHERE clause so a stale button is a no-op, not a
// silent re-decision.
const RESOLVABLE_STATUSES = ['uploaded', 'under_review'];

/** DOC-01 / D3: mark a document verified — the gate POD/insurance checks read. */
export async function verifyDocument(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const { ctx } = await requirePermission(orgId, PERMISSIONS.DOCUMENT_VERIFY);
  if (!documentId) return { ok: false, error: 'Missing document.' };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('documents')
    .update({ status: 'verified', verified_by: ctx.userId, verified_at: new Date().toISOString(), rejection_reason: null })
    .eq('id', documentId)
    .eq('org_id', orgId)
    .in('status', RESOLVABLE_STATUSES)
    .select('id, load_id');
  if (error) throw error;
  if (!data || data.length === 0) {
    return { ok: false, error: 'This document is no longer awaiting review — refresh and try again.' };
  }

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.DOCUMENT_VERIFIED,
    entityType: 'document',
    entityId: documentId,
    after: { status: 'verified' },
  });

  revalidatePath('/portal/documents');
  return { ok: true };
}

/** DOC-01 / D3: reject a document with a reason so re-upload is directed. */
export async function rejectDocument(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const { ctx } = await requirePermission(orgId, PERMISSIONS.DOCUMENT_VERIFY);
  if (!documentId) return { ok: false, error: 'Missing document.' };
  if (!reason) return { ok: false, error: 'A rejection reason is required so the sender knows what to fix.' };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('documents')
    .update({ status: 'rejected', rejection_reason: reason, verified_by: ctx.userId, verified_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('org_id', orgId)
    .in('status', RESOLVABLE_STATUSES)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    return { ok: false, error: 'This document is no longer awaiting review — refresh and try again.' };
  }

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.DOCUMENT_REJECTED,
    entityType: 'document',
    entityId: documentId,
    after: { status: 'rejected', reason },
  });

  revalidatePath('/portal/documents');
  return { ok: true };
}
