/**
 * FR-AUD-01/02/03 — Append-only audit log + auto-audit of load transitions +
 * audit read RBAC.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPool, asUser, IDS, closePools } from './setup/db';

const AUDIT_LOAD = 'eeeeeeee-0000-0000-0000-0000000000aa';

beforeAll(async () => {
  await adminPool.query(
    `insert into loads (id, org_id, service_type, reference, origin, destination, status)
     values ($1,$2,'trucking','AUD-1','X','Y','dispatched')
     on conflict (id) do nothing`,
    [AUDIT_LOAD, IDS.org.mcg],
  );
});

afterAll(async () => {
  await adminPool.query('delete from audit_log where entity_id = $1', [AUDIT_LOAD]).catch(() => {});
  await adminPool.query('delete from loads where id = $1', [AUDIT_LOAD]).catch(() => {});
  await closePools();
});

it('FR-AUD-01: a load status change auto-writes an audit entry with actor + before/after', async () => {
  await asUser(IDS.user.dispatcher, async (c) => {
    await c.query('update loads set status = $2 where id = $1', [AUDIT_LOAD, 'in_transit']);
  });
  const { rows } = await adminPool.query(
    `select action, actor_user_id, before_state, after_state from audit_log
     where entity_type='load' and entity_id=$1 order by id desc limit 1`,
    [AUDIT_LOAD],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].action).toBe('load.transition');
  expect(rows[0].actor_user_id).toBe(IDS.user.dispatcher);
  expect(rows[0].before_state).toMatchObject({ status: 'dispatched' });
  expect(rows[0].after_state).toMatchObject({ status: 'in_transit' });
});

it('FR-AUD-02: audit rows cannot be updated (append-only)', async () => {
  await expect(
    adminPool.query(`update audit_log set action = 'tamper' where entity_id = $1`, [AUDIT_LOAD]),
  ).rejects.toThrow(/AUDIT_APPEND_ONLY/);
});

it('FR-AUD-02: audit rows cannot be deleted (append-only)', async () => {
  await expect(
    adminPool.query(`delete from audit_log where entity_id = $1`, [AUDIT_LOAD]),
  ).rejects.toThrow(/AUDIT_APPEND_ONLY/);
});

it('FR-AUD-03: only privileged roles can read the org audit trail', async () => {
  const asDriver = await asUser(IDS.user.driver, async (c) => {
    const r = await c.query('select id from audit_log where org_id = $1', [IDS.org.mcg]);
    return r.rows;
  });
  expect(asDriver).toHaveLength(0);

  const asAdmin = await asUser(IDS.user.admin, async (c) => {
    const r = await c.query('select id from audit_log where org_id = $1', [IDS.org.mcg]);
    return r.rows;
  });
  expect(asAdmin.length).toBeGreaterThan(0);
});
