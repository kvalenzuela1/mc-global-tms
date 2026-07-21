'use server';

import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/guard';
import { getServerSupabase, getServiceRoleSupabase } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit/log';
import { nextRateconReference } from '@/lib/ratecons/reference';
import { renderRateconPdf } from '@/lib/ratecons/pdf';
import { LOAD_STATUS } from '@/lib/loads/lifecycle';
import { buildSignatureEvidence, hashDocument, ESIGN_DISCLAIMER } from '@/lib/signatures/evidence';
import { hashBytes } from '@/lib/documents/hash';
import { readSnapshotCents } from '@/lib/pricing/snapshot';
import { notifyPermissionHolders } from '@/lib/notifications/notify.server';
import { rateconReadyToSignEmail, rateconSignedReadyForReleaseEmail } from '@/lib/notifications/templates';
import type { ActionResult } from '@/lib/actions/result';

const UNIQUE_VIOLATION = '23505';
const MAX_REFERENCE_ATTEMPTS = 5;
const TEMPLATE_VERSION = 'ratecon-tmpl-v1';
const CONSENT_TEXT_VERSION = 'consent-v1';

interface BookedLoad {
  id: string;
  status: string;
  carrier_id: string | null;
  rfq_id: string | null;
  origin: string;
  destination: string;
  service_type: string;
  reference: string;
  commercial_snapshot: Record<string, unknown> | null;
}

/**
 * FR-RC-01/06: Send a rate confirmation for a booked load. The carrier-facing
 * content_snapshot deliberately carries only the carrier's own pay
 * (carrier_rate_cents) — never shipper_price/margin — so this document is
 * safe for the carrier to read in full (see loads/page.tsx's masking note).
 *
 * The snapshot's broker/carrier identity and shipment fields follow the
 * standard industry rate-confirmation layout (company + MC/DOT numbers on
 * both sides, lane, equipment/freight, pickup) — captured once at send time
 * per FR-SNAP-01's "immutable snapshot" convention, same as
 * loads.commercial_snapshot. Payment terms beyond the linehaul rate (Quick
 * Pay %, factoring language) are an open client decision (see CLAUDE.md) and
 * deliberately not included here.
 */
export async function sendRatecon(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const loadId = String(formData.get('loadId') ?? '');
  const { ctx } = await requirePermission(orgId, PERMISSIONS.RATECON_SEND);

  const supabase = await getServerSupabase();
  const { data: load, error: loadError } = await supabase
    .from('loads_data')
    .select('id, status, carrier_id, rfq_id, origin, destination, service_type, reference, commercial_snapshot')
    .eq('id', loadId)
    .eq('org_id', orgId)
    .single();
  if (loadError) throw loadError;
  const row = load as BookedLoad | null;
  if (!row) return { ok: false, error: 'Load not found.' };
  if (row.status !== LOAD_STATUS.BOOKED) {
    return { ok: false, error: 'Only a booked load can have a rate confirmation sent.' };
  }
  if (!row.carrier_id) {
    return { ok: false, error: 'Assign a carrier to this load before sending a rate confirmation.' };
  }

  const carrierRateCents = readSnapshotCents(
    row.commercial_snapshot,
    'carrierLinehaulCents',
    'carrier_linehaul_cents',
  );
  if (typeof carrierRateCents !== 'number') {
    return { ok: false, error: 'This load has no carrier rate on record.' };
  }

  const { data: broker, error: brokerError } = await supabase
    .from('organizations')
    .select('name, mc_number, dot_number')
    .eq('id', orgId)
    .single();
  if (brokerError) throw brokerError;

  const { data: carrier, error: carrierError } = await supabase
    .from('carriers')
    .select('name, mc_number, dot_number, carrier_org_id')
    .eq('id', row.carrier_id)
    .single();
  if (carrierError) throw carrierError;

  let freightDetails: string | null = null;
  let pickupAt: string | null = null;
  if (row.rfq_id) {
    const { data: rfq } = await supabase
      .from('rfqs')
      .select('freight_details, pickup_at')
      .eq('id', row.rfq_id)
      .maybeSingle();
    freightDetails = (rfq as { freight_details: string | null } | null)?.freight_details ?? null;
    pickupAt = (rfq as { pickup_at: string | null } | null)?.pickup_at ?? null;
  }

  const contentSnapshot = {
    reference: row.reference,
    origin: row.origin,
    destination: row.destination,
    service_type: row.service_type,
    carrier_rate_cents: carrierRateCents,
    broker: {
      name: broker.name,
      mc_number: broker.mc_number as string | null,
      dot_number: broker.dot_number as string | null,
    },
    carrier: {
      name: carrier.name,
      mc_number: carrier.mc_number as string | null,
      dot_number: carrier.dot_number as string,
    },
    freight_details: freightDetails,
    pickup_at: pickupAt,
  };
  const contentJson = JSON.stringify(contentSnapshot);

  let created: { id: string; reference: string } | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS && !created; attempt++) {
    const { data: existing, error: existingError } = await supabase
      .from('rate_confirmations')
      .select('reference')
      .eq('org_id', orgId);
    if (existingError) throw existingError;

    const reference = nextRateconReference(
      ((existing ?? []) as { reference: string }[]).map((r) => r.reference),
    );

    const { data, error } = await supabase
      .from('rate_confirmations')
      .insert({
        org_id: orgId,
        load_id: loadId,
        carrier_id: row.carrier_id,
        reference,
        version: 1,
        template_version: TEMPLATE_VERSION,
        status: 'sent',
        content_snapshot: contentSnapshot,
        content_hash: hashDocument(contentJson),
        sent_at: new Date().toISOString(),
      })
      .select('id, reference')
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        lastError = error;
        continue;
      }
      throw error;
    }
    created = data;
  }
  if (!created) throw lastError ?? new Error('Could not allocate a rate confirmation reference.');

  const { error: loadUpdateError } = await supabase
    .from('loads_data')
    .update({ status: LOAD_STATUS.AWAITING_CARRIER_SIGNATURE })
    .eq('id', loadId);
  if (loadUpdateError) throw loadUpdateError;

  await writeAudit({
    orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.RATECON_SENT,
    entityType: 'rate_confirmation',
    entityId: created.id,
    after: { reference: created.reference, loadId, carrierId: row.carrier_id },
  });

  // FR-NOTIF-01: tell whoever can actually sign it — if the carrier has no
  // portal org yet (carrier_org_id is null), there's nobody to notify.
  const carrierOrgId = (carrier as { carrier_org_id: string | null }).carrier_org_id;
  if (carrierOrgId) {
    await notifyPermissionHolders(
      carrierOrgId,
      PERMISSIONS.RATECON_SIGN,
      rateconReadyToSignEmail({
        rateconReference: created.reference,
        loadReference: row.reference,
        lane: `${row.origin} → ${row.destination}`,
      }),
    );
  }

  revalidatePath('/portal/ratecons');
  revalidatePath('/portal/loads');
  return { ok: true };
}

interface SignableRatecon {
  id: string;
  org_id: string;
  load_id: string;
  reference: string;
  status: string;
  version: number;
  content_snapshot: Record<string, unknown>;
}

/** Defensive shape for `content_snapshot` — same fields `sendRatecon` writes,
 * cast defensively since the column is untyped jsonb (mirrors the same
 * defensiveness `ratecons/page.tsx`'s `RateconContentSnapshot` already uses). */
interface RateconContentSnapshotShape {
  reference?: string;
  origin?: string;
  destination?: string;
  service_type?: string;
  carrier_rate_cents?: number;
  freight_details?: string | null;
  pickup_at?: string | null;
  broker?: { name?: string; mc_number?: string | null; dot_number?: string | null };
  carrier?: { name?: string; mc_number?: string | null; dot_number?: string | null };
}

/**
 * FR-RC-06/07: Carrier signs a sent rate confirmation. `rate_confirmations`
 * and `loads` RLS write policies are broker-org-only (`ratecons_write` /
 * `loads_write` both require app_is_member on the BROKER org), so a carrier
 * signer can never satisfy them directly — the status flip and the load
 * transition it triggers use the service-role client, same as writeAudit()
 * does, only after the app layer (requirePermission + the RLS-scoped read
 * below) has already established the signer is legitimately entitled to act
 * on this document.
 */
export async function signRatecon(formData: FormData): Promise<ActionResult> {
  const orgId = String(formData.get('orgId') ?? '');
  const rateconId = String(formData.get('rateconId') ?? '');
  const signerName = String(formData.get('signerName') ?? '').trim();
  const signerTitle = String(formData.get('signerTitle') ?? '').trim() || null;
  const consentAccepted = formData.get('consent') === 'on';

  const { ctx } = await requirePermission(orgId, PERMISSIONS.RATECON_SIGN);

  const supabase = await getServerSupabase();
  const { data: ratecon, error: rateconError } = await supabase
    .from('rate_confirmations')
    .select('id, org_id, load_id, reference, status, version, content_snapshot')
    .eq('id', rateconId)
    .single();
  if (rateconError) throw rateconError;
  const rc = ratecon as SignableRatecon | null;
  // A null row here means either it doesn't exist or RLS denied it (this
  // signer's org isn't the assigned carrier) — same message either way.
  if (!rc) return { ok: false, error: 'Rate confirmation not found.' };
  if (rc.status !== 'sent') {
    return { ok: false, error: 'This rate confirmation is not awaiting a signature.' };
  }

  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = requestHeaders.get('user-agent');

  let evidence;
  try {
    evidence = buildSignatureEvidence({
      signerUserId: ctx.userId,
      signerName,
      signerTitle,
      orgId: rc.org_id,
      documentId: rc.id,
      documentVersion: rc.version,
      documentContent: JSON.stringify(rc.content_snapshot),
      consentTextVersion: CONSENT_TEXT_VERSION,
      consentAccepted,
      ipAddress,
      userAgent,
      signedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature could not be recorded.';
    return { ok: false, error: message };
  }

  const { error: signatureError } = await supabase.from('signatures').insert({
    org_id: evidence.orgId,
    rate_confirmation_id: evidence.documentId,
    signer_user_id: evidence.signerUserId,
    signer_name: evidence.signerName,
    signer_title: evidence.signerTitle,
    document_version: evidence.documentVersion,
    document_hash: evidence.documentHash,
    consent_text_version: evidence.consentTextVersion,
    ip_address: evidence.ipAddress,
    user_agent: evidence.userAgent,
    disclaimer_version: evidence.disclaimerVersion,
    signed_at: evidence.signedAt,
  });
  if (signatureError) throw signatureError;

  const serviceRole = getServiceRoleSupabase();

  const { error: rateconUpdateError } = await serviceRole
    .from('rate_confirmations')
    .update({ status: 'signed' })
    .eq('id', rc.id);
  if (rateconUpdateError) throw rateconUpdateError;

  const { data: updatedLoad, error: loadUpdateError } = await serviceRole
    .from('loads_data')
    .update({ status: LOAD_STATUS.SIGNED_AWAITING_BROKER_RELEASE })
    .eq('id', rc.load_id)
    .eq('status', LOAD_STATUS.AWAITING_CARRIER_SIGNATURE)
    .select('id');
  if (loadUpdateError) throw loadUpdateError;
  if (!updatedLoad || updatedLoad.length === 0) {
    // The signature and rate_confirmation status are already committed —
    // this only means the load itself moved on unexpectedly (e.g. a
    // concurrent process). Surface it rather than pretending the release
    // gate is now satisfied when the load's own status disagrees.
    throw new Error(
      `Signed rate confirmation ${rc.id}, but load ${rc.load_id} was not in ${LOAD_STATUS.AWAITING_CARRIER_SIGNATURE}.`,
    );
  }

  await writeAudit({
    orgId: rc.org_id,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.RATECON_SIGNED,
    entityType: 'rate_confirmation',
    entityId: rc.id,
    after: { signerUserId: ctx.userId, signedAt: evidence.signedAt },
  });

  const snapshot = rc.content_snapshot as RateconContentSnapshotShape;

  // FR-RC-08: render + store the signed PDF. Best-effort — by this point the
  // signature (the actual FR-RC-06/07 legal evidence) and the ratecon/load
  // status transitions above are already durably committed, and nothing here
  // is unrecoverable (content_snapshot + the signatures row persist, so the
  // PDF can be regenerated later). Turning an already-successful signature
  // into a user-facing error over a rendering/storage failure would be
  // misleading, so this mirrors notifyPermissionHolders's "never block the
  // business transaction" convention — logged, not silent, since (unlike a
  // missed email) there's currently no other way to notice a missing PDF.
  try {
    const pdfBytes = await renderRateconPdf({
      reference: rc.reference,
      version: rc.version,
      origin: snapshot.origin ?? '',
      destination: snapshot.destination ?? '',
      serviceType: snapshot.service_type ?? '',
      carrierRateCents: snapshot.carrier_rate_cents ?? 0,
      freightDetails: snapshot.freight_details ?? null,
      pickupAt: snapshot.pickup_at ?? null,
      broker: {
        name: snapshot.broker?.name ?? '',
        mcNumber: snapshot.broker?.mc_number ?? null,
        dotNumber: snapshot.broker?.dot_number ?? null,
      },
      carrier: {
        name: snapshot.carrier?.name ?? '',
        mcNumber: snapshot.carrier?.mc_number ?? null,
        dotNumber: snapshot.carrier?.dot_number ?? null,
      },
      signature: {
        signerName: evidence.signerName,
        signerTitle: evidence.signerTitle,
        signedAt: evidence.signedAt,
        ipAddress: evidence.ipAddress,
        documentHash: evidence.documentHash,
      },
      disclaimer: ESIGN_DISCLAIMER,
    });

    // Same {org_id}/{load_id}/{uuid}-{filename} convention and bucket as
    // uploadDocument (documents/actions.ts) — doc_type/storage RLS is
    // already generic to org/load, not gated by doc type, so no new bucket
    // or policy is needed. serviceRole (not the RLS-bound client) for
    // consistency with the rest of this function, even though
    // documents_write RLS is broader than ratecons_write/loads_write and
    // might allow the RLS-bound client here too.
    const path = `${rc.org_id}/${rc.load_id}/${randomUUID()}-ratecon-${rc.id}.pdf`;
    const { error: uploadError } = await serviceRole.storage
      .from('documents')
      .upload(path, pdfBytes, { contentType: 'application/pdf' });
    if (uploadError) throw uploadError;

    const { data: docRow, error: docInsertError } = await serviceRole
      .from('documents')
      .insert({
        org_id: rc.org_id,
        load_id: rc.load_id,
        doc_type: 'ratecon_pdf',
        storage_path: path,
        file_hash: hashBytes(pdfBytes),
        uploaded_by: null,
      })
      .select('id')
      .single();
    if (docInsertError) {
      await serviceRole.storage.from('documents').remove([path]).catch(() => {});
      throw docInsertError;
    }

    await writeAudit({
      orgId: rc.org_id,
      actorUserId: ctx.userId,
      action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      entityType: 'document',
      entityId: docRow.id,
      after: { loadId: rc.load_id, docType: 'ratecon_pdf', storagePath: path, rateconId: rc.id },
    });
  } catch (err) {
    console.error(`signRatecon: PDF generation/storage failed for rate confirmation ${rc.id}`, err);
  }

  // FR-NOTIF-01: the load is now ready to release — tell whoever can do that.
  await notifyPermissionHolders(
    rc.org_id,
    PERMISSIONS.LOAD_RELEASE_DRIVER,
    rateconSignedReadyForReleaseEmail({
      loadReference: snapshot.reference ?? rc.reference,
      lane: `${snapshot.origin ?? ''} → ${snapshot.destination ?? ''}`,
      carrierName: snapshot.carrier?.name ?? '',
    }),
  );

  revalidatePath('/portal/ratecons');
  revalidatePath('/portal/loads');
  revalidatePath('/portal/documents');
  return { ok: true };
}
