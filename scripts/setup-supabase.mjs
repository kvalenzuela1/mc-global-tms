#!/usr/bin/env node
/**
 * One-command Supabase bootstrap for the Phase 1 pilot.
 *
 *   node scripts/setup-supabase.mjs            # full run
 *   node scripts/setup-supabase.mjs --users    # only create/repair auth users
 *   node scripts/setup-supabase.mjs --no-schema
 *
 * Replaces the manual dashboard clicking in SETUP_SUPABASE.md. Every step is
 * idempotent, so re-running is safe.
 *
 *   1. apply supabase_setup.sql   (schema + RLS + audit)
 *   2. create the six demo auth users, email-confirmed, via the Admin API
 *   3. apply supabase_seed_by_email.sql (binds seed rows to those users)
 *
 * Deliberately dependency-free apart from `pg` (already a devDependency), so it
 * works on a fresh clone with only `npm install`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ env --- */

/** Minimal .env parser — avoids a dotenv dependency. */
function loadEnvLocal() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) die('.env.local not found. Copy .env.example and fill it in.');

  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('PASTE_')) {
    die(`${name} is missing or still a placeholder in .env.local.\n` +
        `   Fill it from https://supabase.com/dashboard/project/osmnbzwcjbiyindcctbz`);
  }
  return value;
}

function die(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- users --- */

/**
 * The six pilot personas. `email` is the join key the seed SQL uses, so these
 * strings must match supabase_seed_by_email.sql exactly.
 */
const DEMO_USERS = [
  { email: 'owner@mcglobalfreightllc.com',      becomes: 'Org Admin (M.C. Global)' },
  { email: 'manager@mcglobalfreightllc.com',    becomes: 'Broker Manager' },
  { email: 'dispatcher@mcglobalfreightllc.com', becomes: 'Broker Dispatcher' },
  { email: 'dispatch@horizonfreight.example',   becomes: 'Carrier Dispatch (Horizon)' },
  { email: 'driver@horizonfreight.example',     becomes: 'Driver (Horizon)' },
  { email: 'buyer@summitretail.example',        becomes: 'Shipper (Summit)' },
];

async function adminFetch(url, serviceKey, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function createDemoUsers(supabaseUrl, serviceKey, password) {
  console.log('\n  Creating demo auth users');

  // Page through existing users so re-runs update rather than fail.
  const existing = new Map();
  for (let page = 1; ; page += 1) {
    const { ok, body, status } = await adminFetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`,
      serviceKey,
    );
    if (!ok) die(`Could not list users (HTTP ${status}): ${JSON.stringify(body)}`);
    const users = body.users ?? [];
    for (const u of users) existing.set(u.email?.toLowerCase(), u.id);
    if (users.length < 1000) break;
  }

  const results = [];
  for (const user of DEMO_USERS) {
    const known = existing.get(user.email.toLowerCase());

    if (known) {
      // Reset the password + confirm the email so a half-created user is repaired.
      const { ok, body, status } = await adminFetch(
        `${supabaseUrl}/auth/v1/admin/users/${known}`,
        serviceKey,
        { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) },
      );
      if (!ok) die(`Could not update ${user.email} (HTTP ${status}): ${JSON.stringify(body)}`);
      console.log(`    ~ ${user.email.padEnd(36)} exists — password reset`);
      results.push({ ...user, id: known, created: false });
      continue;
    }

    const { ok, body, status } = await adminFetch(
      `${supabaseUrl}/auth/v1/admin/users`,
      serviceKey,
      {
        method: 'POST',
        body: JSON.stringify({ email: user.email, password, email_confirm: true }),
      },
    );
    if (!ok) die(`Could not create ${user.email} (HTTP ${status}): ${JSON.stringify(body)}`);
    console.log(`    + ${user.email.padEnd(36)} created`);
    results.push({ ...user, id: body.id, created: true });
  }

  return results;
}

/* ------------------------------------------------------------------ sql --- */

async function runSqlFile(client, relPath) {
  const candidates = [join(ROOT, relPath), join(ROOT, 'supabase', relPath)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) die(`SQL file not found: ${relPath}`);

  const sql = readFileSync(path, 'utf8');
  process.stdout.write(`    · ${relPath} … `);
  try {
    await client.query(sql);
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    die(`${relPath} failed:\n     ${err.message}`);
  }
}

/* ----------------------------------------------------------------- main --- */

async function main() {
  const args = new Set(process.argv.slice(2));
  const usersOnly = args.has('--users');
  const skipSchema = args.has('--no-schema') || usersOnly;
  const skipSeed = args.has('--no-seed') || usersOnly;

  loadEnvLocal();
  const supabaseUrl = required('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const password = required('DEMO_USER_PASSWORD');

  console.log(`\n  M.C. Global Freight — Supabase bootstrap`);
  console.log(`  ${supabaseUrl}`);

  let client = null;
  if (!skipSchema || !skipSeed) {
    const databaseUrl = required('DATABASE_URL');
    let pg;
    try {
      ({ default: pg } = await import('pg'));
    } catch {
      die('The `pg` package is not installed. Run `npm install` first.');
    }
    client = new pg.Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
    } catch (err) {
      die(`Could not connect to Postgres: ${err.message}\n` +
          `   Check DATABASE_URL. If your network blocks port 5432, use the\n` +
          `   Session pooler URI from Settings -> Database.`);
    }
  }

  if (!skipSchema) {
    console.log('\n  Applying schema (idempotent)');
    await runSqlFile(client, 'supabase_setup.sql');
  }

  await createDemoUsers(supabaseUrl, serviceKey, password);

  if (!skipSeed) {
    console.log('\n  Seeding demo data');
    await runSqlFile(client, 'supabase_seed_by_email.sql');
  }

  if (client) await client.end();

  console.log(`\n  ✓ Done. Demo password: ${password}`);
  console.log(`\n  Next:  npm run verify:rls     # prove broker sees margin, driver does not`);
  console.log(`         npm run dev            # http://localhost:3000/login\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
