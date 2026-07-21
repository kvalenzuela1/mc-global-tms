import { getServiceRoleSupabase } from '@/lib/supabase/server';
import { can, type Permission } from '@/lib/rbac/permissions';
import type { Role } from '@/lib/rbac/roles';
import { getNotificationAdapter } from '@/adapters/notifications';
import type { EmailContent } from './templates';

interface MembershipRow {
  user_id: string;
  role: Role;
}

/**
 * Resolve the email addresses of every member of `orgId` who holds
 * `permission` — the recipients are whoever should act next, never the
 * acting user themselves. Requires the service-role client for two
 * reasons: RLS on `memberships` (`mem_select`) only lets a non-admin see
 * their own row, and email addresses live in Supabase's managed
 * `auth.users`, reachable only through the Admin API.
 */
async function getEmailsWithPermission(orgId: string, permission: Permission): Promise<string[]> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase.from('memberships').select('user_id, role').eq('org_id', orgId);
  if (error) throw error;

  const holders = ((data as MembershipRow[]) ?? []).filter((m) => can(m.role, permission));
  const emails: string[] = [];
  for (const holder of holders) {
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(holder.user_id);
    if (userError || !userData.user?.email) continue;
    emails.push(userData.user.email);
  }
  return emails;
}

/**
 * FR-NOTIF-01: send `content` to every member of `orgId` holding
 * `permission`. Never throws — by the time this runs, the quote/load
 * mutation that triggered it has already succeeded, and a notification
 * failure must never roll that back or surface as an error to the caller.
 */
export async function notifyPermissionHolders(
  orgId: string,
  permission: Permission,
  content: EmailContent,
): Promise<void> {
  try {
    const emails = await getEmailsWithPermission(orgId, permission);
    if (emails.length === 0) return;
    const adapter = getNotificationAdapter();
    await Promise.all(
      emails.map((to) =>
        adapter.sendEmail({ to, ...content }).catch(() => {
          // Best-effort per recipient — one failed send shouldn't stop the rest.
        }),
      ),
    );
  } catch {
    // Best-effort overall — never throw into the caller's business transaction.
  }
}
