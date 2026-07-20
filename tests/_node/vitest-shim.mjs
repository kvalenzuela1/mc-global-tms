/**
 * Minimal Vitest-compatible shim over node:test + node:assert.
 *
 * Lets the exact `*.test.ts` suites (written against the `vitest` API) run under
 * the Node built-in test runner WITHOUT installing npm packages. It implements
 * only the matchers the suites use. In a normal environment `npm run test`
 * (real Vitest) runs the same files unchanged.
 */
import { test, describe as ndescribe, before, after } from 'node:test';
import assert from 'node:assert/strict';

export const describe = (name, fn) => ndescribe(name, fn);
export const it = (name, fn) => test(name, fn);
export const beforeAll = (fn) => before(fn);
export const afterAll = (fn) => after(fn);

function makeExpect(received, negated = false) {
  const check = (pass, msg) => {
    if (negated) pass = !pass;
    assert.ok(pass, msg);
  };
  const api = {
    toBe: (e) => check(Object.is(received, e), `expected ${fmt(received)} ${negated ? 'not ' : ''}to be ${fmt(e)}`),
    toEqual: (e) => {
      let pass = true;
      try { assert.deepStrictEqual(received, e); } catch { pass = false; }
      check(pass, `expected ${fmt(received)} ${negated ? 'not ' : ''}to equal ${fmt(e)}`);
    },
    toMatchObject: (e) => {
      const pass = Object.entries(e).every(([k, v]) => {
        try { assert.deepStrictEqual(received?.[k], v); return true; } catch { return false; }
      });
      check(pass, `expected ${fmt(received)} to match ${fmt(e)}`);
    },
    toHaveLength: (n) => check(received?.length === n, `expected length ${received?.length} ${negated ? 'not ' : ''}to be ${n}`),
    toContain: (s) => check(received?.includes(s), `expected ${fmt(received)} to contain ${fmt(s)}`),
    toBeNull: () => check(received === null, `expected ${fmt(received)} to be null`),
    toBeLessThan: (n) => check(received < n, `expected ${received} < ${n}`),
    toBeGreaterThan: (n) => check(received > n, `expected ${received} > ${n}`),
    toBeGreaterThanOrEqual: (n) => check(received >= n, `expected ${received} >= ${n}`),
    toThrow: (re) => {
      let threw = false, err;
      try { received(); } catch (e) { threw = true; err = e; }
      let pass = threw;
      if (pass && re instanceof RegExp) pass = re.test(String(err?.message ?? err));
      check(pass, `expected function to throw ${re ?? ''}`);
    },
  };
  api.rejects = {
    toThrow: async (re) => {
      let threw = false, err;
      try { await received; } catch (e) { threw = true; err = e; }
      let pass = threw;
      if (pass && re instanceof RegExp) pass = re.test(String(err?.message ?? err));
      check(pass, `expected promise to reject ${re ?? ''}`);
    },
  };
  return api;
}

function fmt(v) {
  try { return typeof v === 'string' ? `"${v}"` : JSON.stringify(v); } catch { return String(v); }
}

export function expect(received) {
  const api = makeExpect(received, false);
  api.not = makeExpect(received, true);
  return api;
}

export default { describe, it, expect, beforeAll, afterAll };
