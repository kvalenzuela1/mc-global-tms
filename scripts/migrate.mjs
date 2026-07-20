#!/usr/bin/env node
/**
 * Apply SQL migrations in lexical order against DATABASE_URL.
 *
 * Usage:
 *   node scripts/migrate.mjs                 # apply migrations
 *   node scripts/migrate.mjs --reset         # drop + recreate public schema first
 *   node scripts/migrate.mjs --with-auth-shim# apply local auth.uid() shim first
 *
 * On Supabase, run migrations via the Supabase CLI or paste them in order;
 * do NOT pass --with-auth-shim (auth.uid() already exists there).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'supabase', 'migrations');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const withShim = args.includes('--with-auth-shim');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  if (reset) {
    console.log('• Resetting public schema');
    await client.query('drop schema if exists public cascade; create schema public;');
  }
  if (withShim) {
    console.log('• Applying local auth shim');
    await client.query(readFileSync(join(__dirname, 'sql', 'local_auth_shim.sql'), 'utf8'));
  }
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    console.log(`• Applying ${f}`);
    await client.query(readFileSync(join(migrationsDir, f), 'utf8'));
  }
  console.log('✓ Migrations applied');
} finally {
  await client.end();
}
