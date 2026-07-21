import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { readSnapshotCents } from '@/lib/pricing/snapshot';
import { ActionForm } from '../_components/action-form';
import { SubmitButton } from '../_components/submit-button';
import { sendRatecon, signRatecon } from './actions';

interface BookedLoadRow {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  commercial_snapshot: Record<string, unknown> | null;
}

interface RateconContentSnapshot {
  origin?: string;
  destination?: string;
  service_type?: string;
  carrier_rate_cents?: number;
  freight_details?: string | null;
  pickup_at?: string | null;
  broker?: { name?: string; mc_number?: string | null; dot_number?: string | null };
  carrier?: { name?: string; mc_number?: string | null; dot_number?: string | null };
}

interface RateconRow {
  id: string;
  reference: string;
  status: string;
  content_snapshot: RateconContentSnapshot | null;
}

interface SignatureRow {
  rate_confirmation_id: string;
  signer_name: string;
  signer_title: string | null;
  signed_at: string;
}

function rateconBadgeClass(status: string): string {
  if (status === 'signed') return 'badge-ok';
  if (status === 'sent') return 'badge-warn';
  return 'badge-muted';
}

export default async function RateconsPage() {
  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.RATECON_VIEW)) {
    return <NotAuthorized />;
  }

  const canSend = can(active.role, PERMISSIONS.RATECON_SEND);
  const canSign = can(active.role, PERMISSIONS.RATECON_SIGN);

  const supabase = await getServerSupabase();

  let bookedLoads: BookedLoadRow[] = [];
  if (canSend) {
    const { data } = await supabase
      .from('loads_data')
      .select('id, reference, origin, destination, commercial_snapshot')
      .eq('org_id', active.orgId)
      .eq('status', 'booked')
      .not('carrier_id', 'is', null)
      .order('created_at', { ascending: false });
    bookedLoads = (data as BookedLoadRow[]) ?? [];
  }

  // No org_id filter: RLS's ratecons_select policy already scopes rows to
  // the broker org (member) or the assigned carrier, same reasoning as the
  // loads list page.
  const { data: rateconData, error } = await supabase
    .from('rate_confirmations')
    .select('id, reference, status, content_snapshot')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const ratecons = (rateconData as RateconRow[]) ?? [];

  const signatureByRatecon = new Map<string, SignatureRow>();
  if (ratecons.length > 0) {
    const { data: signatureData } = await supabase
      .from('signatures')
      .select('rate_confirmation_id, signer_name, signer_title, signed_at')
      .in(
        'rate_confirmation_id',
        ratecons.map((rc) => rc.id),
      );
    for (const s of (signatureData as SignatureRow[]) ?? []) {
      signatureByRatecon.set(s.rate_confirmation_id, s);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Rate Confirmations</h1>
      <p className="text-muted mt-1">Send terms to a carrier and capture their electronic signature.</p>

      {canSend && (
        <div className="panel mt-6 p-6">
          <h2 className="font-semibold">Booked loads awaiting a rate confirmation</h2>
          {bookedLoads.length === 0 && (
            <p className="text-sm text-muted mt-2">Nothing to send right now.</p>
          )}
          <ul className="mt-4 space-y-3">
            {bookedLoads.map((l) => {
              const carrierRateCents = readSnapshotCents(
                l.commercial_snapshot,
                'carrierLinehaulCents',
                'carrier_linehaul_cents',
              );
              return (
              <li
                key={l.id}
                className="table-row border-t border-line pt-3 pb-2 -mx-2 px-2 rounded-lg text-sm flex items-center justify-between gap-4"
              >
                <div>
                  <p>
                    {l.reference} · {l.origin} → {l.destination}
                  </p>
                  <p className="text-muted text-xs mt-1">
                    Carrier rate:{' '}
                    {typeof carrierRateCents === 'number'
                      ? `$${(carrierRateCents / 100).toFixed(2)}`
                      : '—'}
                  </p>
                </div>
                <ActionForm action={sendRatecon}>
                  <input type="hidden" name="orgId" value={active.orgId} />
                  <input type="hidden" name="loadId" value={l.id} />
                  <SubmitButton className="btn-copper px-3 py-1.5 text-xs" pendingLabel="Sending…">
                    Send rate confirmation
                  </SubmitButton>
                </ActionForm>
              </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="panel mt-6 p-6">
        <h2 className="font-semibold">{canSend ? 'All rate confirmations' : 'Your rate confirmations'}</h2>
        {ratecons.length === 0 && <p className="text-sm text-muted mt-2">None yet.</p>}
        <ul className="mt-4 space-y-4">
          {ratecons.map((rc) => (
            <li key={rc.id} className="table-row border-t border-line pt-4 pb-2 -mx-2 px-2 rounded-lg text-sm">
              <div className="flex items-center justify-between gap-4">
                <p>
                  {rc.reference} · {rc.content_snapshot?.origin} → {rc.content_snapshot?.destination}
                  {typeof rc.content_snapshot?.carrier_rate_cents === 'number'
                    ? ` · $${(rc.content_snapshot.carrier_rate_cents / 100).toFixed(2)}`
                    : ''}
                </p>
                <span className={`badge ${rateconBadgeClass(rc.status)}`}>{rc.status}</span>
              </div>

              <RateconDocument snapshot={rc.content_snapshot} reference={rc.reference} signature={signatureByRatecon.get(rc.id)} />

              {canSign && rc.status === 'sent' && (
                <ActionForm action={signRatecon} className="mt-3 space-y-3 max-w-md">
                  <input type="hidden" name="orgId" value={active.orgId} />
                  <input type="hidden" name="rateconId" value={rc.id} />
                  <div>
                    <label className="block text-sm mb-1">Your name</label>
                    <input name="signerName" required className="input" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Your title</label>
                    <input name="signerTitle" className="input" />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-muted">
                    <input type="checkbox" name="consent" className="mt-0.5" />
                    <span>
                      I have reviewed these terms and agree to accept this rate confirmation
                      electronically. This is not a legal e-signature (ESIGN/UETA) — it records
                      acceptance evidence for operational use.
                    </span>
                  </label>
                  <SubmitButton className="btn-copper px-3 py-1.5 text-xs" pendingLabel="Signing…">
                    Sign
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Standard industry rate-confirmation layout (broker/carrier identity blocks,
 * shipment details, rate line, signature) — modeled on the field structure
 * used by most brokerages (TQL's format among them), not any single broker's
 * proprietary template. Payment terms beyond the linehaul rate (Quick Pay %,
 * factoring language, detention) are an open client decision (see CLAUDE.md)
 * and are intentionally left out rather than invented.
 */
function RateconDocument({
  snapshot,
  reference,
  signature,
}: {
  snapshot: RateconContentSnapshot | null;
  reference: string;
  signature: SignatureRow | undefined;
}) {
  if (!snapshot) return null;
  const rate =
    typeof snapshot.carrier_rate_cents === 'number'
      ? `$${(snapshot.carrier_rate_cents / 100).toFixed(2)}`
      : '—';

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-copper-500">View rate confirmation</summary>
      <div className="mt-3 rounded-lg border border-line p-4 text-sm space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div>
            <p className="font-semibold">{snapshot.broker?.name ?? 'MC Global Freight'}</p>
            <p className="text-xs text-muted mt-0.5">
              MC# {snapshot.broker?.mc_number ?? '—'} · DOT# {snapshot.broker?.dot_number ?? '—'}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold">Rate Confirmation {reference}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted uppercase tracking-wide">Carrier</p>
            <p className="mt-1">{snapshot.carrier?.name ?? '—'}</p>
            <p className="text-xs text-muted">
              MC# {snapshot.carrier?.mc_number ?? '—'} · DOT# {snapshot.carrier?.dot_number ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase tracking-wide">Equipment / Service</p>
            <p className="mt-1">{snapshot.service_type ?? '—'}</p>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted uppercase tracking-wide">Shipment</p>
          <p className="mt-1">
            {snapshot.origin} → {snapshot.destination}
          </p>
          <p className="text-xs text-muted mt-0.5">
            Pickup: {snapshot.pickup_at ? new Date(snapshot.pickup_at).toLocaleString() : '—'}
          </p>
          {snapshot.freight_details && (
            <p className="text-xs text-muted mt-0.5">Freight: {snapshot.freight_details}</p>
          )}
        </div>

        <div className="border-t border-line pt-3 flex items-center justify-between">
          <p className="text-xs text-muted uppercase tracking-wide">Carrier Rate</p>
          <p className="font-semibold">{rate}</p>
        </div>

        <div className="border-t border-line pt-3">
          <p className="text-xs text-muted uppercase tracking-wide">Acceptance</p>
          {signature ? (
            <p className="mt-1 text-xs">
              Signed by {signature.signer_name}
              {signature.signer_title ? `, ${signature.signer_title}` : ''} on{' '}
              {new Date(signature.signed_at).toLocaleString()}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">Awaiting carrier signature.</p>
          )}
        </div>
      </div>
    </details>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to rate confirmations.</p>
    </div>
  );
}
