import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/tenant/context';
import { can, PERMISSIONS } from '@/lib/rbac/permissions';
import { getServerSupabase } from '@/lib/supabase/server';
import { Breadcrumb } from '../../../_components/breadcrumb';
import { LoadTimeline } from '../../../_components/load-timeline';

/**
 * Standalone operational-timeline route for a load (§10 AUD-02). Lives at its
 * own path rather than as a tab on the load detail page on purpose: the detail
 * page is being reworked in another branch, so a new subroute avoids colliding
 * with it. Once the §5 record-detail shell lands, `<LoadTimeline>` can be
 * lifted into a "Timeline" tab there — this route stays valid regardless.
 */
export default async function LoadTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getSessionContext();
  const active = ctx?.active ?? ctx?.memberships[0] ?? null;
  if (!active) return null;

  if (!can(active.role, PERMISSIONS.LOAD_VIEW) && !can(active.role, PERMISSIONS.SHIPPER_TRACK)) {
    return <NotAuthorized />;
  }

  const supabase = await getServerSupabase();
  // No org_id filter: relationship-based RLS scopes the `loads` view (same as
  // the loads list/detail). A row the caller can't access simply isn't returned.
  const { data: load, error } = await supabase
    .from('loads')
    .select('id, reference')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!load) notFound();
  const reference = (load as { reference: string }).reference;

  return (
    <div>
      <Breadcrumb
        trail={[
          { label: 'Loads', href: '/portal/loads' },
          { label: reference, href: `/portal/loads/${id}` },
          { label: 'Timeline' },
        ]}
      />

      <h1 className="text-2xl font-bold mt-3">{reference} · Timeline</h1>
      <p className="text-muted mt-1">
        Everything that has happened on this load, newest first — milestones, documents, rate
        confirmations, signatures, and (for audit roles) the audit trail.
      </p>

      <div className="panel mt-6 p-6">
        <LoadTimeline loadId={id} currentUserId={ctx?.userId} currentUserEmail={ctx?.email} />
      </div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="panel p-8 max-w-lg">
      <h1 className="text-xl font-bold">Not authorized</h1>
      <p className="mt-2 text-muted text-sm">Your role does not include access to loads.</p>
    </div>
  );
}
