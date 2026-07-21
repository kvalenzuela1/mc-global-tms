/**
 * FR-TEN-01 / FR-TEN-04 — Tenant isolation & relationship access (RLS).
 * These run against a real Postgres with RLS enforced as a non-superuser role.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appPool, adminPool, asUser, IDS, closePools } from './setup/db';

const RIVAL_LOAD = 'dddddddd-0000-0000-0000-0000000000ff';

beforeAll(async () => {
  // Ground truth: give the rival broker a load of its own.
  await adminPool.query(
    `insert into loads (id, org_id, service_type, reference, origin, destination, status)
     values ($1,$2,'trucking','RV-1','Dallas, TX','Reno, NV','draft')
     on conflict (id) do nothing`,
    [RIVAL_LOAD, IDS.org.rival],
  );
});

afterAll(async () => {
  await adminPool.query('delete from loads where id = $1', [RIVAL_LOAD]).catch(() => {});
  await closePools();
});

it('FR-TEN-01: a broker dispatcher sees only their org loads, never the rival org', async () => {
  const rows = await asUser(IDS.user.dispatcher, async (c) => {
    const r = await c.query('select id, org_id from loads');
    return r.rows;
  });
  const orgIds = new Set(rows.map((r) => r.org_id));
  expect(orgIds.has(IDS.org.mcg)).toBe(true);
  expect(orgIds.has(IDS.org.rival)).toBe(false);
  expect(rows.some((r) => r.id === IDS.load.ld1045)).toBe(true);
  expect(rows.some((r) => r.id === RIVAL_LOAD)).toBe(false);
});

it('FR-TEN-01: the rival admin cannot see MC Global loads', async () => {
  const rows = await asUser(IDS.user.rivalAdmin, async (c) => {
    const r = await c.query('select id from loads');
    return r.rows;
  });
  expect(rows.some((r) => r.id === RIVAL_LOAD)).toBe(true);
  expect(rows.some((r) => r.id === IDS.load.ld1045)).toBe(false);
});

it('FR-TEN-04: a carrier user sees only loads assigned to their carrier', async () => {
  const rows = await asUser(IDS.user.carrier, async (c) => {
    const r = await c.query('select id from loads');
    return r.rows;
  });
  expect(rows.map((r) => r.id)).toEqual([IDS.load.ld1045]);
});

it('FR-TEN-04: a driver sees only their own assigned load', async () => {
  const rows = await asUser(IDS.user.driver, async (c) => {
    const r = await c.query('select id from loads');
    return r.rows;
  });
  expect(rows.map((r) => r.id)).toEqual([IDS.load.ld1045]);
});

it('FR-MASK-01 (storage): a carrier user cannot read the commercial quotes table', async () => {
  const rows = await asUser(IDS.user.carrier, async (c) => {
    const r = await c.query('select id from quotes');
    return r.rows;
  });
  expect(rows).toHaveLength(0);
});

it('FR-TEN-01: WITH CHECK blocks writing a load into another org', async () => {
  await expect(
    asUser(IDS.user.dispatcher, async (c) => {
      await c.query(
        `insert into loads (org_id, service_type, reference, origin, destination, status)
         values ($1,'trucking','HACK','A','B','draft')`,
        [IDS.org.rival],
      );
    }),
  ).rejects.toThrow();
});

it('FR-TEN-02: rival admin cannot read MC Global memberships', async () => {
  const rows = await asUser(IDS.user.rivalAdmin, async (c) => {
    const r = await c.query('select user_id from memberships where org_id = $1', [IDS.org.mcg]);
    return r.rows;
  });
  expect(rows).toHaveLength(0);
});

// keep the app pool referenced for type clarity
void appPool;
