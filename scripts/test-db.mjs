#!/usr/bin/env node
/**
 * Provision / tear down an isolated local Postgres test database with RLS.
 *
 *   node scripts/test-db.mjs up     # create db + non-superuser app role + schema + seed
 *   node scripts/test-db.mjs down   # drop the test database
 *
 * Tests connect as the NON-SUPERUSER role `app_user` so RLS is actually
 * enforced (superusers/table owners bypass RLS).
 *
 * Env:
 *   ADMIN_DATABASE_URL  superuser connection to the server (default postgres db)
 *   TEST_DB_NAME        default 'mc_global_tms_test'
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminUrl =
  process.env.ADMIN_DATABASE_URL ||
  'postgresql://postgres@localhost:5432/postgres';
const dbName = process.env.TEST_DB_NAME || 'mc_global_tms_test';
const appUser = 'app_user';
const appPass = 'app_user';

const action = process.argv[2] || 'up';

async function admin() {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  return c;
}

async function down() {
  const c = await admin();
  try {
    await c.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [dbName],
    );
    await c.query(`drop database if exists ${dbName}`);
    console.log(`✓ dropped ${dbName}`);
  } finally {
    await c.end();
  }
}

async function up() {
  // 1) (re)create database + app role via admin connection
  const c = await admin();
  try {
    await c.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [dbName],
    );
    await c.query(`drop database if exists ${dbName}`);
    await c.query(`create database ${dbName}`);
    const roleExists = await c.query(`select 1 from pg_roles where rolname = $1`, [appUser]);
    if (roleExists.rowCount === 0) {
      await c.query(`create role ${appUser} login password '${appPass}' nosuperuser nobypassrls`);
    } else {
      await c.query(`alter role ${appUser} nosuperuser nobypassrls`);
    }
  } finally {
    await c.end();
  }

  // 2) apply shim + migrations + seed as superuser inside the new db
  const dbUrl = adminUrl.replace(/\/[^/]*$/, `/${dbName}`);
  const s = new pg.Client({ connectionString: dbUrl });
  await s.connect();
  try {
    await s.query(readFileSync(join(__dirname, 'sql', 'local_auth_shim.sql'), 'utf8'));
    const migDir = join(__dirname, '..', 'supabase', 'migrations');
    for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
      await s.query(readFileSync(join(migDir, f), 'utf8'));
    }
    await s.query(readFileSync(join(__dirname, '..', 'supabase', 'seed.sql'), 'utf8'));

    // 3) grant the non-superuser role access (RLS still applies to it)
    await s.query(`grant usage on schema public to ${appUser}`);
    await s.query(`grant select, insert, update, delete on all tables in schema public to ${appUser}`);
    await s.query(`grant usage, select on all sequences in schema public to ${appUser}`);
    await s.query(`grant execute on all functions in schema public to ${appUser}`);
    await s.query(`grant usage on schema auth to ${appUser}`);
    await s.query(`grant execute on all functions in schema auth to ${appUser}`);
  } finally {
    await s.end();
  }

  console.log(`✓ test db ready: ${dbName}`);
  console.log(`  app role URL:   postgresql://${appUser}:${appPass}@localhost:5432/${dbName}`);
  console.log(`  admin URL:      ${dbUrl}`);
}

if (action === 'up') await up();
else if (action === 'down') await down();
else {
  console.error('unknown action; use up|down');
  process.exit(1);
}
