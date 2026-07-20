/**
 * Environment access + validation.
 *
 * Requirement coverage:
 *   FR-CFG-01  No secrets in code; all secrets come from the environment.
 *   FR-CFG-02  Service-role key is server-only and never bundled to the client.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

/** Public (browser-safe) config. */
export const publicEnv = {
  appUrl: optional('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  supabaseUrl: optional('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: optional('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
};

/** Server-only config. Access ONLY in server code. */
export const serverEnv = {
  get supabaseServiceRoleKey(): string {
    // FR-CFG-02: throws if accessed without configuration; never shipped to client.
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
  authProvider: optional('AUTH_PROVIDER', 'supabase'),
};

export function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error('Server-only module imported in the browser.');
  }
}
