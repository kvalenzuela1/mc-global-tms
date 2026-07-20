/**
 * Supabase browser client (anon key only — RLS-enforced).
 * FR-CFG-02: only the public anon key is ever used in the browser.
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

export function getBrowserSupabase() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
