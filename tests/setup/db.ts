/**
 * Test DB harness. Provides:
 *   - appPool:   connects as NON-SUPERUSER `app_user` (RLS ENFORCED).
 *   - adminPool: superuser (ground-truth setup + assertions, RLS bypassed).
 *   - asUser():  runs a callback with the Supabase-style JWT subject set so RLS
 *                policies resolve auth.uid() to that user.
 *
 * Requires `npm run test:setup-db` first (scripts/test-db.mjs up).
 */
import pg from 'pg';

const DB = process.env.TEST_DB_NAME || 'mc_global_tms_test';
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ||
  `postgresql://app_user:app_user@localhost:5432/${DB}`;
const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ||
  `postgresql://postgres@localhost:5432/${DB}`;

export const appPool = new pg.Pool({ connectionString: APP_URL, max: 5 });
export const adminPool = new pg.Pool({ connectionString: ADMIN_URL, max: 3 });

/** Fixed seed IDs (mirror supabase/seed.sql). */
export const IDS = {
  org: {
    mcg: '11111111-1111-1111-1111-111111111111',
    horizon: '22222222-2222-2222-2222-222222222222',
    summit: '33333333-3333-3333-3333-333333333333',
    rival: '99999999-9999-9999-9999-999999999999',
  },
  user: {
    admin: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    manager: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
    dispatcher: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
    carrier: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000004',
    driver: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000005',
    shipper: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000006',
    rivalAdmin: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000007',
  },
  load: { ld1045: '88888888-0000-0000-0000-000000000001' },
  carrier: {
    horizon: '44444444-0000-0000-0000-000000000001',
    redline: '44444444-0000-0000-0000-000000000002',
  },
  ratecon: { rc2048: 'bbbb2048-0000-0000-0000-000000000001' },
} as const;

/**
 * Run `fn` as the given user with RLS active. Uses a transaction so the JWT
 * claim is set locally and cleaned up automatically.
 */
export async function asUser<T>(
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await appPool.end();
  await adminPool.end();
}
