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
    if (userError || !userData.user?.email) {
      // A membership row whose user has no reachable email is a data problem,
      // not a normal skip — it means somebody who should have been told wasn't.
      console.warn(
        `notifyPermissionHolders: no email for user ${holder.user_id} (org ${orgId}, ${permission})`,
        userError ?? null,
      );
      continue;
    }
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
    if (emails.length === 0) {
      // Nobody in the org holds the permission (or none of them have an email).
      // Silent by design for the caller, but an operator needs to see it — the
      // next step in the workflow now has nobody waiting on it.
      console.warn(
        `notifyPermissionHolders: no recipients hold ${permission} in org ${orgId} — "${content.subject}" not sent`,
      );
      return;
    }
    const adapter = getNotificationAdapter();
    if (adapter.name === 'noop') {
      // Expected until NOTIFICATION_PROVIDER/RESEND_API_KEY are set (blocked on
      // the open "email sender credentials" decision). Say so once per batch
      // rather than reporting an undelivered send per recipient below — nothing
      // is broken, the feature just isn't switched on yet.
      console.warn(
        `notifyPermissionHolders: no email provider configured — "${content.subject}" not sent to ${emails.length} recipient(s) (org ${orgId}, ${permission})`,
      );
      return;
    }
    await Promise.all(
      emails.map((to) =>
        adapter
          .sendEmail({ to, ...content })
          .then((result) => {
            // A provider rejection is a returned `delivered: false`, not a
            // throw — ResendNotificationAdapter swallows a non-2xx response
            // that way, and the noop adapter always reports undelivered. So
            // the catch below alone would never fire for the most likely
            // real failure: a bad API key or a rejected sender domain.
            if (!result.delivered) {
              console.error(
                `notifyPermissionHolders: ${adapter.name} did not deliver to ${to} (org ${orgId}, ${permission}, "${content.subject}")`,
              );
            }
          })
          .catch((err: unknown) => {
            // Best-effort per recipient — one failed send shouldn't stop the rest,
            // but each failure is logged so ops can tell who was never reached.
            console.error(
              `notifyPermissionHolders: send threw for ${to} (org ${orgId}, ${permission}, "${content.subject}")`,
              err,
            );
          }),
      ),
    );
  } catch (err) {
    // Best-effort overall — never throw into the caller's business transaction.
    console.error(
      `notifyPermissionHolders: could not resolve recipients for ${permission} in org ${orgId} — "${content.subject}" not sent`,
      err,
    );
  }
}
