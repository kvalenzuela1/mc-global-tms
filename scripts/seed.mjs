#!/usr/bin/env node
/**
 * Load deterministic demo data (supabase/seed.sql) into DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(join(__dirname, '..', 'supabase', 'seed.sql'), 'utf8'));
  console.log('✓ Seed applied');
  console.log('\nDemo auth user IDs (create these in Supabase Auth with the same UUIDs):');
  console.log('  org_admin        aaaaaaaa-aaaa-aaaa-aaaa-000000000001  (M.C. Global)');
  console.log('  broker_manager   aaaaaaaa-aaaa-aaaa-aaaa-000000000002  (M.C. Global)');
  console.log('  broker_dispatcher aaaaaaaa-aaaa-aaaa-aaaa-000000000003 (M.C. Global)');
  console.log('  carrier_dispatch aaaaaaaa-aaaa-aaaa-aaaa-000000000004  (Horizon Freight)');
  console.log('  driver           aaaaaaaa-aaaa-aaaa-aaaa-000000000005  (Horizon Freight)');
  console.log('  shipper          aaaaaaaa-aaaa-aaaa-aaaa-000000000006  (Summit Retail)');
} finally {
  await client.end();
}
