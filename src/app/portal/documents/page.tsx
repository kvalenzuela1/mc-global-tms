import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { StatusBadge, STATUS_FACET } from '../_components/status-badge';
import { uploadDocument, verifyDocument, rejectDocument } from './actions';
import { UPLOADABLE_DOC_TYPES, DOC_TYPE_LABELS } from '@/lib/documents/types';

interface LoadOption {
  id: string;
  reference: string;
  origin: string;
  destination: string;
}

interface DocumentRow {
  id: string;
  load_id: string | null;
  doc_type: string;
  storage_path: string | null;
  created_at: string;
  status: string;
  expires_at: string | null;
  rejection_reason: string | null;
}

interface DocumentDisplayRow {
  id: string;
  loadId: string | null;
  loadReference: string;
  docType: string;
  createdAt: string;
  downloadUrl: string | null;
  status: string;
  expiresAt: string | null;
  rejectionReason: string | null;
}

const SIGNED_URL_TTL_SECONDS = 60;

export default async function DocumentsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active || !ctx) return null;

  const canUpload = can(active.role, PERMISSIONS.DOCUMENT_UPLOAD);
  const canView = can(active.role, PERMISSIONS.DOCUMENT_VIEW);
  const canVerify = can(active.role, PERMISSIONS.DOCUMENT_VERIFY);
  if (!canUpload && !canView) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();

  let uploadLoads: LoadOption[] = [];
  if (canUpload) {
    if (active.role === ROLES.DRIVER) {
      const { data: driver } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', ctx.userId)
        .maybeSingle();
      if (driver) {
        const { data } = await supabase
          .from('loads')
          .select('id, reference, origin, destination')
          .eq('driver_id', driver.id)
          .order('created_at', { ascending: false });
        uploadLoads = (data as LoadOption[]) ?? [];
      }
    } else {
      // No org_id filter: same "let RLS scope it" convention as
      // loads/page.tsx — for carrier_dispatch this naturally narrows to
      // loads assigned to their carrier.
      const { data } = await supabase
        .from('loads')
        .select('id, reference, origin, destination')
        .order('created_at', { ascending: false });
      uploadLoads = (data as LoadOption[]) ?? [];
    }
  }

  let documentRows: DocumentDisplayRow[] = [];
  if (canView) {
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, load_id, doc_type, storage_path, created_at, status, expires_at, rejection_reason')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (docs as DocumentRow[]) ?? [];

    const loadIds = [...new Set(rows.map((d) => d.load_id).filter((id): id is string => id !== null))];
    let loadRefById = new Map<string, string>();
    if (loadIds.length > 0) {
      const { data: loadsData } = await supabase.from('loads').select('id, reference').in('id', loadIds);
      loadRefById = new Map(
        ((loadsData as { id: string; reference: string }[]) ?? []).map((l) => [l.id, l.reference]),
      );
    }

    documentRows = await Promise.all(
      rows.map(async (d) => {
        let downloadUrl: string | null = null;
        if (d.storage_path) {
          const { data: signed } = await supabase.storage
            .from('documents')
            .createSignedUrl(d.storage_path, SIGNED_URL_TTL_SECONDS);
          downloadUrl = signed?.signedUrl ?? null;
        }
        return {
          id: d.id,
          loadId: d.load_id,
          loadReference: d.load_id ? (loadRefById.get(d.load_id) ?? '—') : '—',
          docType: d.doc_type,
          createdAt: d.created_at,
          downloadUrl,
          status: d.status,
          expiresAt: d.expires_at,
          rejectionReason: d.rejection_reason,
        };
      }),
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Documents</h1>
      <p className="text-muted mt-1">Bills of lading, proof of delivery, receipts, and other load paperwork.</p>

      {canUpload && (
        <ActionForm action={uploadDocument} className="panel mt-6 p-6 space-y-4 max-w-xl">
          <input type="hidden" name="orgId" value={active.orgId} />
          <h2 className="font-semibold">Upload a document</h2>
          <div>
            <label className="block text-sm mb-1">Load</label>
            <select name="loadId" required className="input">
              <option value="">Select a load</option>
              {uploadLoads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.reference} · {l.origin} → {l.destination}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Document type</label>
            <select name="docType" required className="input">
              {UPLOADABLE_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">File (max 4MB)</label>
            <input type="file" name="file" required className="input" />
          </div>
          <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Uploading…">
            Upload
          </SubmitButton>
        </ActionForm>
      )}

      {canView && (
        <div className="panel mt-6 p-6">
          <h2 className="font-semibold">Documents</h2>
          <table className="mt-4 w-full text-sm">
            <thead className="text-muted text-left">
              <tr className="border-b border-line">
                <th className="pb-2">Load</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Uploaded</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {documentRows.map((d) => {
                const resolvable = d.status === 'uploaded' || d.status === 'under_review';
                return (
                  <tr key={d.id} className="table-row border-t border-line align-top">
                    <td className="py-2">
                      {d.loadId ? (
                        <Link href={`/portal/loads/${d.loadId}`} className="hover:text-copper-400">
                          {d.loadReference}
                        </Link>
                      ) : (
                        d.loadReference
                      )}
                    </td>
                    <td className="py-2">{DOC_TYPE_LABELS[d.docType] ?? d.docType}</td>
                    <td className="py-2">
                      <StatusBadge facet={STATUS_FACET.DOCUMENT} value={d.status} />
                      {d.expiresAt && (
                        <span className="text-muted ml-2 text-xs">
                          exp {new Date(d.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      {d.status === 'rejected' && d.rejectionReason && (
                        <p className="text-muted mt-1 text-xs">{d.rejectionReason}</p>
                      )}
                    </td>
                    <td className="py-2 whitespace-nowrap">{new Date(d.createdAt).toLocaleString()}</td>
                    <td className="py-2">
                      <div className="flex flex-col gap-2">
                        {d.downloadUrl ? (
                          <a href={d.downloadUrl} className="text-copper-500 text-xs" target="_blank" rel="noreferrer">
                            Download
                          </a>
                        ) : (
                          <span className="text-muted text-xs">—</span>
                        )}
                        {canVerify && resolvable && (
                          <div className="flex flex-wrap items-center gap-2">
                            <ActionForm action={verifyDocument}>
                              <input type="hidden" name="orgId" value={active.orgId} />
                              <input type="hidden" name="documentId" value={d.id} />
                              <SubmitButton className="btn-copper px-2 py-1 text-xs" pendingLabel="…">
                                Verify
                              </SubmitButton>
                            </ActionForm>
                            <ActionForm action={rejectDocument} className="flex items-center gap-1">
                              <input type="hidden" name="orgId" value={active.orgId} />
                              <input type="hidden" name="documentId" value={d.id} />
                              <input name="reason" required placeholder="reason" className="input w-28 py-0.5 text-xs" />
                              <SubmitButton
                                className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-charcoal-700"
                                pendingLabel="…"
                              >
                                Reject
                              </SubmitButton>
                            </ActionForm>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {documentRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-muted text-center">
                    No documents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to documents.</p>
    </div>
  );
}
