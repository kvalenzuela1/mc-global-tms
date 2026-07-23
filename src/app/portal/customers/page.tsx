import Link from 'next/link';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { StatusBadge, STATUS_FACET } from '../_components/status-badge';
import { createCustomer } from './actions';

/**
 * Customers list (CUS-01 / §7.6). `shippers` is the customer table — expanded
 * in 0012. CUSTOMER_VIEW-gated and org-scoped; the inline create form is
 * CUSTOMER_MANAGE-gated.
 */

interface CustomerRow {
  id: string;
  name: string;
  code: string | null;
  status: string;
  billing_email: string | null;
  payment_terms_days: number;
}

export default async function CustomersPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.CUSTOMER_VIEW)) {
    return <NotAuthorized />;
  }

  const canManage = can(active.role, PERMISSIONS.CUSTOMER_MANAGE);
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('shippers')
    .select('id, name, code, status, billing_email, payment_terms_days')
    .eq('org_id', active.orgId)
    .order('name');
  if (error) throw error;
  const customers = (data as CustomerRow[]) ?? [];

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-muted mt-1">Shippers you broker for — billing terms, contacts, and saved locations.</p>
      </div>

      {canManage && (
        <ActionForm action={createCustomer} className="panel mt-6 p-6 flex flex-wrap items-end gap-3">
          <input type="hidden" name="orgId" value={active.orgId} />
          <div className="flex-1 min-w-[12rem]">
            <label className="block text-sm mb-1">New customer name</label>
            <input name="name" required className="input" placeholder="e.g. Summit Retail" />
          </div>
          <div className="w-40">
            <label className="block text-sm mb-1">Code <span className="text-muted">(optional)</span></label>
            <input name="code" className="input" placeholder="SUMMIT" />
          </div>
          <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Adding…">
            Add customer
          </SubmitButton>
        </ActionForm>
      )}

      <div className="panel mt-6 p-6">
        <table className="w-full text-sm">
          <thead className="text-muted text-left">
            <tr className="border-b border-line">
              <th className="pb-2">Name</th>
              <th className="pb-2">Code</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Billing email</th>
              <th className="pb-2">Terms</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="table-row border-t border-line">
                <td className="py-2">
                  <Link href={`/portal/customers/${c.id}`} className="hover:text-copper-400">
                    {c.name}
                  </Link>
                </td>
                <td className="py-2 text-muted">{c.code ?? '—'}</td>
                <td className="py-2">
                  <StatusBadge facet={STATUS_FACET.CUSTOMER} value={c.status} />
                </td>
                <td className="py-2 text-muted">{c.billing_email ?? '—'}</td>
                <td className="py-2 text-muted">Net {c.payment_terms_days}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-muted text-center">
                  No customers yet{canManage ? ' — add your first one above.' : '.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to customers.</p>
    </div>
  );
}
