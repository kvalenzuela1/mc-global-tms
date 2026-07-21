import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { getOrgComplianceResults } from '@/lib/compliance/policy.server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { createCarrier, setCarrierStatus, refreshFmcsaCheck, updateComplianceReview } from './actions';

interface CarrierRow {
  id: string;
  name: string;
  dot_number: string;
  mc_number: string | null;
  status: string;
}

function statusBadgeClass(status: string): string {
  if (status === 'approved') return 'badge-ok';
  if (status === 'conditional') return 'badge-warn';
  return 'badge-muted'; // suspended / rejected
}

export default async function CarriersPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.CARRIER_VIEW)) {
    return <NotAuthorized />;
  }

  const canManage = can(active.role, PERMISSIONS.CARRIER_MANAGE);
  const canReview = can(active.role, PERMISSIONS.COMPLIANCE_REVIEW);

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('carriers')
    .select('id, name, dot_number, mc_number, status')
    .eq('org_id', active.orgId)
    .order('name');
  if (error) throw error;
  const carriers = (data as CarrierRow[]) ?? [];

  const complianceResults = await getOrgComplianceResults(active.orgId);

  return (
    <div>
      <h1 className="text-2xl font-bold">Carrier Compliance</h1>
      <p className="text-muted mt-1">
        Authority, insurance, and manual review status behind the assignment and release gates.
      </p>

      {canManage && (
        <ActionForm action={createCarrier} className="panel mt-6 p-6 space-y-4 max-w-xl">
          <input type="hidden" name="orgId" value={active.orgId} />
          <h2 className="font-semibold">Add a carrier</h2>
          <div>
            <label className="block text-sm mb-1">Name</label>
            <input name="name" required className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">DOT number</label>
              <input name="dotNumber" required className="input" />
            </div>
            <div>
              <label className="block text-sm mb-1">MC number</label>
              <input name="mcNumber" className="input" />
            </div>
          </div>
          <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Adding…">
            Add carrier
          </SubmitButton>
        </ActionForm>
      )}

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">Carriers</h2>
        {carriers.length === 0 && <p className="text-sm text-muted mt-2">No carriers yet.</p>}
        <ul className="mt-4 space-y-5">
          {carriers.map((c) => {
            const result = complianceResults.get(c.id) ?? null;
            return (
              <li key={c.id} className="border-t border-line pt-4 text-sm">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-medium">
                      {c.name} <span className="text-muted font-normal">· DOT {c.dot_number}</span>
                      {c.mc_number ? <span className="text-muted font-normal"> · {c.mc_number}</span> : null}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={`badge ${statusBadgeClass(c.status)}`}>{c.status}</span>
                      {result === null ? (
                        <span className="badge badge-muted">not yet reviewed</span>
                      ) : result.allowed ? (
                        <span className="badge badge-ok">compliant</span>
                      ) : (
                        <span className="badge badge-warn">blocked ({result.blockingReasons.length})</span>
                      )}
                    </div>
                    {result && result.blockingReasons.length > 0 && (
                      <ul className="mt-2 text-xs text-muted list-disc list-inside space-y-0.5">
                        {result.blockingReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    {result && result.warnings.length > 0 && (
                      <ul className="mt-2 text-xs text-copper-300 list-disc list-inside space-y-0.5">
                        {result.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex gap-2">
                      {(['approved', 'suspended', 'rejected'] as const)
                        .filter((s) => s !== c.status)
                        .map((s) => (
                          <ActionForm key={s} action={setCarrierStatus}>
                            <input type="hidden" name="orgId" value={active.orgId} />
                            <input type="hidden" name="carrierId" value={c.id} />
                            <input type="hidden" name="status" value={s} />
                            <SubmitButton className="btn-secondary px-3 py-1.5 text-xs capitalize" pendingLabel="…">
                              {s === 'approved' ? 'Approve' : s === 'suspended' ? 'Suspend' : 'Reject'}
                            </SubmitButton>
                          </ActionForm>
                        ))}
                    </div>
                  )}
                </div>

                {canReview && (
                  <div className="mt-4 grid md:grid-cols-2 gap-4">
                    <ActionForm action={refreshFmcsaCheck}>
                      <input type="hidden" name="orgId" value={active.orgId} />
                      <input type="hidden" name="carrierId" value={c.id} />
                      <SubmitButton className="btn-secondary px-3 py-1.5 text-xs" pendingLabel="Checking…">
                        Refresh FMCSA authority check
                      </SubmitButton>
                    </ActionForm>

                    <ActionForm action={updateComplianceReview} className="space-y-2">
                      <input type="hidden" name="orgId" value={active.orgId} />
                      <input type="hidden" name="carrierId" value={c.id} />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs mb-1 text-muted">Insurance expiry</label>
                          <input type="date" name="insuranceExpiry" className="input text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs mb-1 text-muted">Manual review</label>
                          <select name="manualReview" defaultValue="pending" className="input text-sm">
                            <option value="pending">Pending</option>
                            <option value="conditional">Conditional</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs mb-1 text-muted">Auto liability (USD)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            name="autoLiabilityDollars"
                            className="input text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs mb-1 text-muted">Cargo coverage (USD)</label>
                          <input type="number" step="0.01" min="0" name="cargoDollars" className="input text-sm" />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <input type="checkbox" name="requiredDocsPresent" />
                        Required documents on file
                      </label>
                      <SubmitButton className="btn-copper px-3 py-1.5 text-xs" pendingLabel="Saving…">
                        Save compliance review
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to carrier compliance.</p>
    </div>
  );
}
