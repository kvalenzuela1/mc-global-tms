#!/usr/bin/env node
/**
 * Milestone 2 acceptance check, run against the live project.
 *
 *   node scripts/verify-rls.mjs
 *
 * Signs in as real users, then queries PostgREST with each user's own JWT — so
 * RLS is genuinely enforced. This is a stronger check than clicking through the
 * UI: it proves the *storage layer* withholds margin from a driver, rather than
 * proving the UI merely declines to render it.
 *
 * The SQL editor in the dashboard runs as superuser and bypasses RLS, which is
 * why this exists as a script rather than a .sql file.
 *
 * Exits non-zero if any assertion fails.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvLocal() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) fail('.env.local not found.');
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------ assertions --- */

const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const mark = passed ? '✓' : '✗';
  console.log(`    ${mark} ${name}${detail ? `\n        ${detail}` : ''}`);
}

/* --------------------------------------------------------------- client --- */

let SUPABASE_URL;
let ANON_KEY;

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    fail(`Sign-in failed for ${email} (HTTP ${res.status}): ` +
         `${body.error_description ?? body.msg ?? JSON.stringify(body)}\n` +
         `   Run \`npm run setup:supabase\` first, and check DEMO_USER_PASSWORD.`);
  }
  return body.access_token;
}

/** Query PostgREST as a specific signed-in user, so RLS applies to them. */
async function queryAs(token, path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(body) ? body : [], body };
}

/* ----------------------------------------------------------------- main --- */

const COMMERCIAL_KEYS = [
  'margin_amount_cents',
  'margin_percent',
  'shipper_price_cents',
  'carrier_linehaul_cents',
  'target_margin_percent',
];

async function main() {
  loadEnvLocal();
  SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const password = process.env.DEMO_USER_PASSWORD ?? '';

  if (!SUPABASE_URL || ANON_KEY.startsWith('PASTE_') || !ANON_KEY) {
    fail('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set in .env.local');
  }

  console.log('\n  FR-TEN / FR-MASK acceptance check');
  console.log(`  ${SUPABASE_URL}\n`);

  const broker = await signIn('dispatcher@mcglobalfreightllc.com', password);
  const driver = await signIn('driver@horizonfreight.example', password);
  const carrier = await signIn('dispatch@horizonfreight.example', password);

  // --- Broker: must SEE margin -------------------------------------------
  console.log('  Broker dispatcher (dispatcher@mcglobalfreightllc.com)');

  const brokerQuotes = await queryAs(broker, 'quotes?select=*');
  check(
    'FR-PR: broker can read the quotes table',
    brokerQuotes.rows.length > 0,
    brokerQuotes.rows.length === 0
      ? `got 0 rows (HTTP ${brokerQuotes.status}) — is the seed applied?`
      : `${brokerQuotes.rows.length} quote row(s)`,
  );

  const firstQuote = brokerQuotes.rows[0] ?? {};
  const marginVisible =
    firstQuote.margin_amount_cents !== undefined && firstQuote.margin_amount_cents !== null;
  check(
    'FR-MASK-01: broker SEES margin_amount_cents',
    marginVisible,
    marginVisible ? `margin = ${firstQuote.margin_amount_cents} cents` : 'margin field absent',
  );

  const brokerLoads = await queryAs(broker, 'loads?select=id,reference,status');
  check(
    'FR-LD-01: broker can read loads',
    brokerLoads.rows.length > 0,
    `${brokerLoads.rows.length} load(s): ${brokerLoads.rows.map((l) => l.reference).join(', ')}`,
  );

  // --- Driver: must NOT see margin ---------------------------------------
  console.log('\n  Driver (driver@horizonfreight.example)');

  const driverQuotes = await queryAs(driver, 'quotes?select=*');
  check(
    'FR-MASK-01: driver reads ZERO rows from quotes (RLS, storage layer)',
    driverQuotes.rows.length === 0,
    driverQuotes.rows.length === 0
      ? 'quotes table is empty for this user'
      : `LEAK — driver received ${driverQuotes.rows.length} quote row(s)`,
  );

  const driverLoads = await queryAs(driver, 'loads?select=*');
  check(
    'FR-TEN-02: driver CAN see their assigned load',
    driverLoads.rows.length > 0,
    `${driverLoads.rows.length} load(s) visible`,
  );

  const leakedKeys = [];
  for (const row of driverLoads.rows) {
    for (const key of COMMERCIAL_KEYS) {
      if (row[key] !== undefined && row[key] !== null) leakedKeys.push(key);
    }
    // commercial_snapshot is JSONB and is NOT traversed by maskCommercials —
    // it must therefore never reach a driver with pricing inside it.
    const snap = row.commercial_snapshot;
    if (snap && typeof snap === 'object') {
      for (const key of COMMERCIAL_KEYS) {
        if (snap[key] !== undefined) leakedKeys.push(`commercial_snapshot.${key}`);
      }
    }
  }
  check(
    'FR-MASK-01: no commercial field on any load row reaching the driver',
    leakedKeys.length === 0,
    leakedKeys.length === 0
      ? 'clean'
      : `LEAK via: ${[...new Set(leakedKeys)].join(', ')}`,
  );

  // --- Carrier: sees the load, never the margin ---------------------------
  console.log('\n  Carrier dispatch (dispatch@horizonfreight.example)');

  const carrierQuotes = await queryAs(carrier, 'quotes?select=*');
  check(
    'FR-MASK-01: carrier reads ZERO rows from quotes',
    carrierQuotes.rows.length === 0,
    carrierQuotes.rows.length === 0
      ? 'quotes table is empty for this user'
      : `LEAK — carrier received ${carrierQuotes.rows.length} row(s)`,
  );

  // --- Cross-tenant -------------------------------------------------------
  console.log('\n  Tenant isolation');

  const driverAudit = await queryAs(driver, 'audit_log?select=id');
  check(
    'FR-AUD-03: driver cannot read the audit log',
    driverAudit.rows.length === 0,
    driverAudit.rows.length === 0 ? 'no rows' : `LEAK — ${driverAudit.rows.length} row(s)`,
  );

  // --- Customers (0012): broker-org only ---------------------------------
  console.log('\n  Customers module (0012)');

  const brokerContacts = await queryAs(broker, 'customer_contacts?select=id');
  check(
    'CUS-01: broker can read customer_contacts',
    brokerContacts.rows.length > 0,
    brokerContacts.rows.length === 0
      ? `got 0 rows (HTTP ${brokerContacts.status}) — is the seed applied?`
      : `${brokerContacts.rows.length} contact(s)`,
  );
  const brokerLocations = await queryAs(broker, 'customer_locations?select=id');
  check(
    'CUS-01: broker can read customer_locations',
    brokerLocations.rows.length > 0,
    brokerLocations.rows.length === 0
      ? `got 0 rows (HTTP ${brokerLocations.status}) — is the seed applied?`
      : `${brokerLocations.rows.length} location(s)`,
  );

  const driverContacts = await queryAs(driver, 'customer_contacts?select=id');
  check(
    'CUS-01: driver reads ZERO customer_contacts (RLS)',
    driverContacts.rows.length === 0,
    driverContacts.rows.length === 0 ? 'no rows' : `LEAK — ${driverContacts.rows.length} row(s)`,
  );
  const carrierLocations = await queryAs(carrier, 'customer_locations?select=id');
  check(
    'CUS-01: carrier reads ZERO customer_locations (RLS)',
    carrierLocations.rows.length === 0,
    carrierLocations.rows.length === 0 ? 'no rows' : `LEAK — ${carrierLocations.rows.length} row(s)`,
  );

  /* ------------------------------------------------------------ summary --- */

  const failed = results.filter((r) => !r.passed);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);

  if (failed.length > 0) {
    console.log('\n  FAILED:');
    for (const f of failed) console.log(`    ✗ ${f.name}`);
    console.log('');
    process.exit(1);
  }

  console.log('\n  ✓ Broker sees margin. Driver and carrier do not. Verified end-to-end\n' +
              '    through auth -> RLS -> PostgREST with real user JWTs.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
