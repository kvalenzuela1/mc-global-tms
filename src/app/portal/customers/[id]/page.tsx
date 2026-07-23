import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { Breadcrumb } from '../../_components/breadcrumb';
import { ActionForm } from '../../_components/action-form';
import { SubmitButton } from '../../_components/submit-button';
import { StatusBadge, STATUS_FACET } from '../../_components/status-badge';
import { updateCustomer, addContact, addLocation } from '../actions';

interface CustomerDetail {
  id: string;
  name: string;
  code: string | null;
  status: string;
  billing_email: string | null;
  payment_terms_days: number;
  credit_limit_cents: number | null;
  tax_id: string | null;
  notes: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  is_primary: boolean;
}

interface LocationRow {
  id: string;
  label: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  hours: string | null;
  appointment_required: boolean;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'inactive', label: 'Inactive' },
];

const CONTACT_ROLE_OPTIONS = ['primary', 'billing', 'operations', 'receiving'];

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.CUSTOMER_VIEW)) {
    return <NotAuthorized />;
  }
  const canManage = can(active.role, PERMISSIONS.CUSTOMER_MANAGE);

  const supabase = await getServerSupabase();
  const { data: customerData, error } = await supabase
    .from('shippers')
    .select('id, name, code, status, billing_email, payment_terms_days, credit_limit_cents, tax_id, notes')
    .eq('id', id)
    .eq('org_id', active.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!customerData) notFound();
  const customer = customerData as CustomerDetail;

  const [{ data: contactData }, { data: locationData }] = await Promise.all([
    supabase
      .from('customer_contacts')
      .select('id, name, title, email, phone, role, is_primary')
      .eq('org_id', active.orgId)
      .eq('shipper_id', id)
      .order('is_primary', { ascending: false })
      .order('created_at'),
    supabase
      .from('customer_locations')
      .select('id, label, address_line1, city, state, postal_code, contact_name, contact_phone, hours, appointment_required')
      .eq('org_id', active.orgId)
      .eq('shipper_id', id)
      .order('created_at'),
  ]);
  const contacts = (contactData as ContactRow[]) ?? [];
  const locations = (locationData as LocationRow[]) ?? [];

  const creditLimitDollars =
    customer.credit_limit_cents != null ? (customer.credit_limit_cents / 100).toFixed(2) : '';

  return (
    <div>
      <Breadcrumb trail={[{ label: 'Customers', href: '/portal/customers' }, { label: customer.name }]} />

      <div className="flex items-start justify-between gap-4 mt-3">
        <h1 className="text-2xl font-bold">{customer.name}</h1>
        <StatusBadge facet={STATUS_FACET.CUSTOMER} value={customer.status} className="whitespace-nowrap" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        {/* -------------------------------------------------- details ------ */}
        <div className="panel p-6">
          <h2 className="font-semibold">Customer details</h2>
          {canManage ? (
            <ActionForm action={updateCustomer} className="mt-4 space-y-3">
              <input type="hidden" name="orgId" value={active.orgId} />
              <input type="hidden" name="shipperId" value={customer.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">Name</label>
                  <input name="name" required defaultValue={customer.name} className="input" />
                </div>
                <div>
                  <label className="block text-sm mb-1">Code</label>
                  <input name="code" defaultValue={customer.code ?? ''} className="input" />
                </div>
                <div>
                  <label className="block text-sm mb-1">Status</label>
                  <select name="status" defaultValue={customer.status} className="input">
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">Payment terms (days)</label>
                  <input
                    name="paymentTermsDays"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={customer.payment_terms_days}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Billing email</label>
                  <input name="billingEmail" type="email" defaultValue={customer.billing_email ?? ''} className="input" />
                </div>
                <div>
                  <label className="block text-sm mb-1">Credit limit (USD)</label>
                  <input name="creditLimitDollars" type="number" min="0" step="0.01" defaultValue={creditLimitDollars} className="input" />
                </div>
                <div>
                  <label className="block text-sm mb-1">Tax ID</label>
                  <input name="taxId" defaultValue={customer.tax_id ?? ''} className="input" />
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1">Notes</label>
                <textarea name="notes" rows={2} defaultValue={customer.notes ?? ''} className="input" />
              </div>
              <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Saving…">
                Save changes
              </SubmitButton>
            </ActionForm>
          ) : (
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Code" value={customer.code} />
              <Row label="Billing email" value={customer.billing_email} />
              <Row label="Payment terms" value={`Net ${customer.payment_terms_days}`} />
              <Row label="Credit limit" value={creditLimitDollars ? `$${creditLimitDollars}` : null} />
              <Row label="Tax ID" value={customer.tax_id} />
              <Row label="Notes" value={customer.notes} />
            </dl>
          )}
        </div>

        {/* ------------------------------------------------- contacts ------ */}
        <div className="panel p-6">
          <h2 className="font-semibold">Contacts</h2>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted mt-3">No contacts yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="border-t border-line pt-2">
                  <p className="font-medium">
                    {c.name}
                    {c.title ? <span className="text-muted"> · {c.title}</span> : ''}
                    {c.is_primary && <span className="text-copper-400 ml-2 text-xs">primary</span>}
                  </p>
                  <p className="text-muted text-xs">
                    {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <ActionForm action={addContact} className="mt-5 border-t border-line pt-4 space-y-3">
              <input type="hidden" name="orgId" value={active.orgId} />
              <input type="hidden" name="shipperId" value={customer.id} />
              <h3 className="text-sm font-semibold">Add a contact</h3>
              <div className="grid grid-cols-2 gap-3">
                <input name="name" required placeholder="Name" className="input" />
                <input name="title" placeholder="Title" className="input" />
                <input name="email" type="email" placeholder="Email" className="input" />
                <input name="phone" placeholder="Phone" className="input" />
                <select name="role" className="input" defaultValue="">
                  <option value="">Role (optional)</option>
                  {CONTACT_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input name="isPrimary" type="checkbox" /> Primary contact
                </label>
              </div>
              <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Adding…">
                Add contact
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {/* -------------------------------------------------- locations ------ */}
      <div className="panel p-6 mt-6">
        <h2 className="font-semibold">Locations</h2>
        {locations.length === 0 ? (
          <p className="text-sm text-muted mt-3">No saved locations yet.</p>
        ) : (
          <ul className="mt-3 grid md:grid-cols-2 gap-3 text-sm">
            {locations.map((l) => (
              <li key={l.id} className="border border-line rounded-lg p-3">
                <p className="font-medium">
                  {l.label}
                  {l.appointment_required && (
                    <span className="text-warn ml-2 text-xs">appt required</span>
                  )}
                </p>
                <p className="text-muted text-xs mt-1">
                  {[l.address_line1, [l.city, l.state].filter(Boolean).join(', '), l.postal_code]
                    .filter(Boolean)
                    .join(' · ') || 'No address on file'}
                </p>
                {(l.contact_name || l.hours) && (
                  <p className="text-muted text-xs mt-1">
                    {[l.contact_name, l.contact_phone, l.hours].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <ActionForm action={addLocation} className="mt-5 border-t border-line pt-4 space-y-3">
            <input type="hidden" name="orgId" value={active.orgId} />
            <input type="hidden" name="shipperId" value={customer.id} />
            <h3 className="text-sm font-semibold">Add a location</h3>
            <div className="grid grid-cols-2 gap-3">
              <input name="label" required placeholder="Label (e.g. Dallas DC)" className="input" />
              <input name="addressLine1" placeholder="Address line 1" className="input" />
              <input name="city" placeholder="City" className="input" />
              <input name="state" placeholder="State" className="input" />
              <input name="postalCode" placeholder="Postal code" className="input" />
              <input name="hours" placeholder="Hours (e.g. 8–5 M–F)" className="input" />
              <input name="contactName" placeholder="Site contact" className="input" />
              <input name="contactPhone" placeholder="Site phone" className="input" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input name="appointmentRequired" type="checkbox" /> Appointment required
            </label>
            <SubmitButton className="btn-copper px-4 py-2" pendingLabel="Adding…">
              Add location
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value ?? '—'}</dd>
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
