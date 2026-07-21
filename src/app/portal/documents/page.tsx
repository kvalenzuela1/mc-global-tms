import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { ROLES } from '@/lib/rbac/roles';
import { getServerSupabase } from '@/lib/supabase/server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { uploadDocument } from './actions';

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
}

interface DocumentDisplayRow {
  id: string;
  loadReference: string;
  docType: string;
  createdAt: string;
  downloadUrl: string | null;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  bol: 'Bill of Lading',
  pod: 'Proof of Delivery',
  receipt: 'Receipt',
  ratecon_pdf: 'Signed Rate Confirmation',
  other: 'Other',
};

const SIGNED_URL_TTL_SECONDS = 60;

export default async function DocumentsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active || !ctx) return null;

  const canUpload = can(active.role, PERMISSIONS.DOCUMENT_UPLOAD);
  const canView = can(active.role, PERMISSIONS.DOCUMENT_VIEW);
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
      .select('id, load_id, doc_type, storage_path, created_at')
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
          loadReference: d.load_id ? (loadRefById.get(d.load_id) ?? '—') : '—',
          docType: d.doc_type,
          createdAt: d.created_at,
          downloadUrl,
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
              <option value="bol">Bill of Lading</option>
              <option value="pod">Proof of Delivery</option>
              <option value="receipt">Receipt</option>
              <option value="other">Other</option>
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
                <th className="pb-2">Uploaded</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {documentRows.map((d) => (
                <tr key={d.id} className="table-row border-t border-line">
                  <td className="py-2">{d.loadReference}</td>
                  <td className="py-2">{DOC_TYPE_LABELS[d.docType] ?? d.docType}</td>
                  <td className="py-2">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="py-2">
                    {d.downloadUrl ? (
                      <a href={d.downloadUrl} className="text-copper-500 text-xs" target="_blank" rel="noreferrer">
                        Download
                      </a>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {documentRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-muted text-center">
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
