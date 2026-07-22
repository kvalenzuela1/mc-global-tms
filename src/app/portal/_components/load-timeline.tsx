import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Operational timeline for one load (WORKFLOW-REDESIGN §10, AUD-02), reading
 * the `load_timeline` view (0011). Async server component so it can be dropped
 * into any load surface — a detail-page tab, a standalone route — without
 * threading data through the parent.
 *
 * The view is `security_invoker`, so this query is already RLS-scoped to the
 * caller: they see only their loads' events, and audit rows only if they hold
 * an audit role. No extra masking is needed here.
 */

interface TimelineRow {
  occurred_at: string;
  source: string;
  event: string;
  detail: string | null;
  actor_id: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  milestone: 'Milestone',
  document: 'Document',
  audit: 'Audit',
  ratecon: 'Rate confirmation',
  signature: 'Signature',
};

/** Turn a dotted event code into a readable phrase: "ratecon.sent" → "Ratecon sent". */
function formatEvent(event: string): string {
  const cleaned = event.replace(/[._]/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export async function LoadTimeline({
  loadId,
  currentUserId,
  currentUserEmail,
}: {
  loadId: string;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
}) {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('load_timeline')
    .select('occurred_at, source, event, detail, actor_id')
    .eq('load_id', loadId)
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  const rows = (data as TimelineRow[]) ?? [];

  const formatActor = (actorId: string | null): string => {
    if (!actorId) return 'System';
    if (actorId === currentUserId) return `${currentUserEmail ?? 'You'} (you)`;
    return `${actorId.slice(0, 8)}…`;
  };

  if (rows.length === 0) {
    return <p className="text-muted text-sm">No activity recorded on this load yet.</p>;
  }

  return (
    <ol className="relative space-y-4">
      {rows.map((r, i) => (
        <li key={`${r.occurred_at}-${r.source}-${i}`} className="border-l-2 border-line pl-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{formatEvent(r.event)}</p>
            <time className="text-muted shrink-0 text-xs">
              {new Date(r.occurred_at).toLocaleString()}
            </time>
          </div>
          <p className="text-muted mt-0.5 text-xs">
            {SOURCE_LABELS[r.source] ?? r.source} · {formatActor(r.actor_id)}
            {r.detail ? ` · ${r.detail}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}
