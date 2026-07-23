import { STATUS_TONE, type StatusTone } from '@/lib/ui/status-tone';

// The broker dashboard's "Needs attention" worklist — the handful of things
// that are actively waiting on someone. Pure (no Next/Supabase imports) so the
// ordering + surfacing rules stay offline-testable; the page supplies the
// counts (each already permission-gated to 0 when the viewer can't act on it).

export interface AttentionCounts {
  carriersBlocked: number;
  documentsExpiringSoon: number;
  loadsAwaitingRelease: number;
  quotesPendingApproval: number;
  documentsAwaitingReview: number;
}

export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: StatusTone;
}

// Ordered by urgency (danger before warn). Zero-count rows are dropped so the
// panel is a real worklist: it shows only what needs action, and renders
// nothing at all when the desk is clear.
export function buildAttentionItems(counts: AttentionCounts): AttentionItem[] {
  const all: AttentionItem[] = [
    {
      key: 'carriers_blocked',
      label: 'Carriers blocked on compliance',
      count: counts.carriersBlocked,
      href: '/portal/carriers',
      tone: STATUS_TONE.DANGER,
    },
    {
      key: 'documents_expiring',
      label: 'Documents expiring soon',
      count: counts.documentsExpiringSoon,
      href: '/portal/documents',
      tone: STATUS_TONE.DANGER,
    },
    {
      key: 'loads_awaiting_release',
      label: 'Loads awaiting release to driver',
      count: counts.loadsAwaitingRelease,
      href: '/portal/loads',
      tone: STATUS_TONE.WARN,
    },
    {
      key: 'quotes_pending_approval',
      label: 'Quotes awaiting approval',
      count: counts.quotesPendingApproval,
      href: '/portal/approvals',
      tone: STATUS_TONE.WARN,
    },
    {
      key: 'documents_awaiting_review',
      label: 'Documents awaiting review',
      count: counts.documentsAwaitingReview,
      href: '/portal/documents',
      tone: STATUS_TONE.WARN,
    },
  ];
  return all.filter((item) => item.count > 0);
}
