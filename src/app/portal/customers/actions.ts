'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import type { ActionResult } from '@/lib/actions/result';

/**
 * Customer CRUD (CUS-01 / §7.6). Every mutation follows the M3 server pattern:
 * requirePermission(CUSTOMER_MANAGE) -> RLS-bound client -> mutate -> writeAudit
 * -> revalidate. RLS (0012) already restricts these tables to broker-org
 * members; the permission check is the app-layer half of that defense in depth.
 */

const CUSTOMER_STATUSES = ['prospect', 'active', 'on_hold', 'inactive'] as const;
const CONTACT_ROLES = ['primary', 'billing', 'operations', 'receiving'] as const;

/** Parse a positive dollar amount to integer cents, or null when blank. */
function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export async function createCustomer(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim() || null;

  const { ctx } = await requirePermission(orgId, PERMISSIONS.CUSTOMER_MANAGE);
  if (!name) return { ok: false, error: 'Customer name is required.' };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('shippers')
    .insert({ org_id: orgId, name, code, status: 'active', created_by: ctx.userId })
    .select('id')
    .single();
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.CUSTOMER_CREATED,
    entityType: 'customer',
    entityId: data.id,
    after: { name, code },
  });

  revalidatePath('/portal/customers');
  return { ok: true };
}

export async function updateCustomer(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const shipperId = String(formData.get('shipperId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const status = String(formData.get('status') ?? '');
  const termsRaw = String(formData.get('paymentTermsDays') ?? '').trim();

  const { ctx } = await requirePermission(orgId, PERMISSIONS.CUSTOMER_MANAGE);
  if (!name) return { ok: false, error: 'Customer name is required.' };
  if (!CUSTOMER_STATUSES.includes(status as (typeof CUSTOMER_STATUSES)[number])) {
    return { ok: false, error: 'Invalid customer status.' };
  }
  const paymentTermsDays = termsRaw === '' ? 30 : Number(termsRaw);
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0) {
    return { ok: false, error: 'Payment terms must be a whole number of days.' };
  }

  const patch = {
    name,
    status,
    code: String(formData.get('code') ?? '').trim() || null,
    billing_email: String(formData.get('billingEmail') ?? '').trim() || null,
    payment_terms_days: paymentTermsDays,
    credit_limit_cents: dollarsToCents(String(formData.get('creditLimitDollars') ?? '')),
    tax_id: String(formData.get('taxId') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
  };

  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('shippers')
    .update(patch)
    .eq('id', shipperId)
    .eq('org_id', orgId);
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
    entityType: 'customer',
    entityId: shipperId,
    after: patch,
  });

  revalidatePath(`/portal/customers/${shipperId}`);
  revalidatePath('/portal/customers');
  return { ok: true };
}

export async function addContact(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const shipperId = String(formData.get('shipperId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim();

  const { ctx } = await requirePermission(orgId, PERMISSIONS.CUSTOMER_MANAGE);
  if (!shipperId) return { ok: false, error: 'Missing customer.' };
  if (!name) return { ok: false, error: 'Contact name is required.' };
  if (role !== '' && !CONTACT_ROLES.includes(role as (typeof CONTACT_ROLES)[number])) {
    return { ok: false, error: 'Invalid contact role.' };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('customer_contacts')
    .insert({
      org_id: orgId,
      shipper_id: shipperId,
      name,
      title: String(formData.get('title') ?? '').trim() || null,
      email: String(formData.get('email') ?? '').trim() || null,
      phone: String(formData.get('phone') ?? '').trim() || null,
      role: role || null,
      is_primary: formData.get('isPrimary') === 'on',
    })
    .select('id')
    .single();
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.CUSTOMER_CONTACT_ADDED,
    entityType: 'customer',
    entityId: shipperId,
    after: { contactId: data.id, name, role: role || null },
  });

  revalidatePath(`/portal/customers/${shipperId}`);
  return { ok: true };
}

export async function addLocation(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const shipperId = String(formData.get('shipperId') ?? '');
  const label = String(formData.get('label') ?? '').trim();

  const { ctx } = await requirePermission(orgId, PERMISSIONS.CUSTOMER_MANAGE);
  if (!shipperId) return { ok: false, error: 'Missing customer.' };
  if (!label) return { ok: false, error: 'A location label is required.' };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('customer_locations')
    .insert({
      org_id: orgId,
      shipper_id: shipperId,
      label,
      address_line1: String(formData.get('addressLine1') ?? '').trim() || null,
      address_line2: String(formData.get('addressLine2') ?? '').trim() || null,
      city: String(formData.get('city') ?? '').trim() || null,
      state: String(formData.get('state') ?? '').trim() || null,
      postal_code: String(formData.get('postalCode') ?? '').trim() || null,
      country: String(formData.get('country') ?? '').trim() || 'US',
      contact_name: String(formData.get('contactName') ?? '').trim() || null,
      contact_phone: String(formData.get('contactPhone') ?? '').trim() || null,
      hours: String(formData.get('hours') ?? '').trim() || null,
      appointment_required: formData.get('appointmentRequired') === 'on',
    })
    .select('id')
    .single();
  if (error) throw error;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.CUSTOMER_LOCATION_ADDED,
    entityType: 'customer',
    entityId: shipperId,
    after: { locationId: data.id, label },
  });

  revalidatePath(`/portal/customers/${shipperId}`);
  return { ok: true };
}
