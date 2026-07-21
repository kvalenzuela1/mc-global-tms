/**
 * Supabase server client (cookie-bound, RLS-enforced).
 *
 * Requirement coverage:
 *   FR-TEN-01  Server requests run as the authenticated user so Postgres RLS
 *              applies. The anon/authenticated key path NEVER bypasses RLS.
 *   FR-CFG-02  The service-role client (RLS bypass) is isolated and used only
 *              for trusted server tasks (migrations, superadmin console, audit
 *              writes that must not be blocked by RLS).
 */

import { cookies } from 'next/headers';
import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/**
 * RLS-enforced client bound to the request's auth cookies. Use for ALL normal
 * tenant data access.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  const setAll: SetAllCookies = (cookiesToSet) => {
    try {
      cookiesToSet.forEach(({ name, value, options }) =>
        cookieStore.set(name, value, options),
      );
    } catch {
      // Called from a Server Component; middleware refreshes the session.
    }
  };
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll,
    },
  });
}

/**
 * Service-role client — BYPASSES RLS. FR-CFG-02: strictly server-only, used only
 * for trusted operations. Never expose the returned client to a browser path.
 */
export function getServiceRoleSupabase() {
  return createClient(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
