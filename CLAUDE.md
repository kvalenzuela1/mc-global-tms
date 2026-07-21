# M.C. Global Freight TMS — working guide for Claude

Phase 1 logistics TMS, controlled pilot. Read this before touching anything;
it encodes constraints that are invisible in the code and expensive to discover.

**Stack:** Next.js 15 (App Router, RSC) · Supabase (Auth + Postgres + RLS) ·
Tailwind 4 · TypeScript strict · Vitest + a dependency-free offline runner.

**Supabase project:** `osmnbzwcjbiyindcctbz` (ap-southeast-2)

---

## Non-negotiable constraints

These have each already caused a failure. Do not relearn them.

1. **Never create a root `app/` directory.** Next.js prefers root `app/` over
   `src/app/` and silently ignores the latter. A legacy Vite marketing site
   lived there and shadowed the entire TMS; it has been moved to a sibling
   directory outside this repo entirely (not `_legacy/` — nothing related to
   it belongs in version control). CI fails the build if `./app` reappears.

2. **`loads` is a view, not a table.** The base table is `loads_data`. The view
   nulls `commercial_snapshot` for non-members and must keep
   `security_invoker = true` — without it the view runs as its owner and
   **bypasses RLS entirely**, exposing every tenant's loads. See
   `supabase/migrations/0006_loads_commercial_mask.sql`.

3. **RLS on `quotes` does not distinguish broker roles.** It is a single
   org-wide `FOR ALL` policy, so any member of the broker org — including a
   dispatcher — can read and write it at the database level. Pricing and
   override separation is enforced **only** in the application layer via
   `can()` / `requirePermission()`. Removing an app-layer check silently opens a
   hole that RLS will not catch.

4. **`pricing:override` and `pricing:override_approve` are held by the same two
   roles** (`org_admin`, `broker_manager`). RBAC therefore cannot express
   maker/checker. `evaluateApproval()` in `src/lib/pricing/override.ts` enforces
   "approver ≠ requester". Keep it, and keep its test.

5. **`maskCommercials()` does not traverse JSONB.** It strips top-level keys
   only. Any nested `pricing_snapshot` / `commercial_snapshot` must be handled
   at the storage layer.

6. **Offline test runner has a limited shim** (`tests/_node/vitest-shim.mjs`).
   No `expect.any`, `toBeTruthy`, `toBeDefined`, `beforeEach`, or `vi` mocking.
   Node runs tests with `--experimental-strip-types`, so **no TS enums,
   decorators, namespaces, or parameter properties** anywhere reachable from a
   test. Use `as const` objects instead of enums.

7. **New test files must be added to the `test:offline` script list in
   `package.json`** or they silently never run.

8. **Keep domain logic free of Next/Supabase imports** so it stays offline-
   testable. Pattern to follow: `pricing/calc.ts`, `loads/lifecycle.ts`,
   `pricing/override.ts`.

9. **No money movement, no real e-signature, no SMS in Phase 1.** Factoring
   `submit()` throws by design. Tracking and load-board adapters throw if
   called. Do not "helpfully" implement them.

---

## Layout

```
src/app/            Next.js App Router — the actual product
  login/            only client component in the app
  portal/           authenticated shell; nav is permission-filtered
src/lib/
  rbac/             roles.ts, permissions.ts — pure, start here
  auth/guard.ts     requireUser(), requirePermission(orgId, perm)
  tenant/context.ts getSessionContext() -> { userId, memberships, active }
  supabase/         server.ts (RLS-bound) vs service-role (bypasses RLS)
  pricing/          calc.ts (money math), override.ts (policy)
  masking/driver.ts commercial field stripping
  audit/log.ts      writeAudit()
supabase/migrations/
scripts/            setup-supabase.mjs, verify-rls.mjs
tests/              *.test.ts
```

(The old Vite marketing site is not in this repo — see constraint 1.)

## The server-side pattern

Every mutation follows this. There was no precedent before M3; this is it.

```ts
'use server';

export async function doThing(input: Input) {
  const ctx = await requireUser();
  const active = ctx.active ?? ctx.memberships[0] ?? null;
  if (!active) throw new AuthError('No workspace', 403);

  const { membership } = await requirePermission(active.orgId, PERMISSIONS.X);
  const supabase = await getServerSupabase();   // RLS applies

  // ... mutate ...

  await writeAudit({
    orgId: membership.orgId,
    actorUserId: ctx.userId,
    action: AUDIT_ACTIONS.Y,
    entityType: 'load',
    entityId: id,
    before, after,
  });

  revalidatePath('/portal/...');
}
```

Money is **integer cents** everywhere. Percents are decimals in `[0, 1)` —
`computePricing` rejects `>= 1`.

---

## Milestones

M1–M2 complete (foundation, auth, tenant isolation, RBAC, audit).
Pilot target: 2026-08-20.

### M3 — RFQ / quote / load UI + pricing override approval  ✅ complete
- [x] `src/lib/pricing/override.ts` + tests (policy core, maker/checker)
- [x] `0004_quote_status.sql` — `override_requested_by`, `override_approved_at`,
      quote `status`
- [x] `0005_loads_reference_unique.sql` — makes the LD-#### retry loop safe
- [x] `0006_loads_commercial_mask.sql` — `loads` becomes a security_invoker view
      over `loads_data`, nulling `commercial_snapshot` outside the broker org
- [x] `/portal/rfqs`, `/portal/pricing`, `/portal/loads` + server actions
- [x] `src/lib/loads/reference.ts` — LD-#### generator
- [x] `src/lib/config/policy-resolver.ts` — platform → org → exception
- [x] `pricing.override_requested` / `pricing.override_approved` audit actions

Verified: 77 offline tests green; all six migrations applied to the live
project; `verify:rls` is what surfaced the `commercial_snapshot` leak that
0006 fixes.

### M4 — Carrier compliance  ← current
FMCSA adapter wiring (mock stays default), compliance UI, assignment/release
gate end-to-end.

### M5 — Rate confirmation lifecycle  🟡 core loop done, rest not started
- [x] `src/lib/ratecons/reference.ts` — RC-#### generator
- [x] `0007_ratecons_reference_unique.sql`
- [x] `/portal/ratecons` + `sendRatecon`/`signRatecon` server actions: broker
      sends (booked → awaiting_carrier_signature), carrier signs using the
      existing `buildSignatureEvidence()` (system-level status flips use the
      service-role client — `ratecons_write`/`loads_write` RLS is
      broker-org-only, so a carrier signer can never satisfy them directly),
      load auto-advances to signed_awaiting_broker_release, which unblocks the
      existing release-to-driver gate in `loads/actions.ts`.
- [x] `advanceLoadStatus` now rejects `awaiting_carrier_signature` and
      `signed_awaiting_broker_release` — those two are system-driven
      consequences of the ratecon flow, not a generic manual advance.
- [x] `src/lib/pricing/snapshot.ts` (`readSnapshotCents`) — `commercial_snapshot`
      readers must tolerate both the pricing engine's camelCase
      (`computePricing()`'s actual output, what every current writer stores)
      and the snake_case older hand-written seed data used — this is what was
      making the Loads page margin column silently show "—" for any
      newly-created load.
- [ ] Signed PDF generation, notifications, document centre with real uploads
      — not started. "Electronic rate confirmations" as a checklist item
      means the send→sign→release loop, which is what's done; the rest is
      real remaining scope, not polish.

Verified end-to-end in a real browser: quote → book → advance to booked →
send rate confirmation (dispatcher) → sign (carrier) → load auto-advances →
release to driver (dispatcher) — plus driver still blocked from
`/portal/ratecons` entirely (no RATECON_VIEW).

### M6 — Milestones / POD / finance
Shipper invoice with document-match engine, factoring settlement packet UI,
margin reporting and export.

### M7 — Marketing site, dashboards, usability, deployment.

---

## Definition of done, every milestone

1. `npm run test:offline` green (63 tests as of M3 start)
2. `npm run typecheck` clean
3. `npm run build` succeeds
4. `npm run verify:rls` green — proves broker sees margin, driver does not,
   through real JWTs rather than the UI
5. Any schema change committed as a numbered migration in
   `supabase/migrations/`, and applied to the live project. **The repo must
   reproduce the database** — CI's `migrations` job applies the real
   migration files to a throwaway Postgres for exactly this reason.
6. New behaviour has a test naming its FR ID (`FR-PR-06: ...`)

## Commands

```bash
npm run test:offline    # no dependencies needed — always works
npm run typecheck
npm run setup:supabase  # idempotent: schema + 6 demo users + seed
npm run verify:rls      # the M2 acceptance check
npm run dev
```

Demo users share `DEMO_USER_PASSWORD` from `.env.local`:
`owner@` / `manager@` / `dispatcher@mcglobalfreightllc.com`,
`dispatch@` / `driver@horizonfreight.example`, `buyer@summitretail.example`.

## Deployment

Vercel, functions pinned to `syd1` via `vercel.json` — the Supabase project is
in `ap-southeast-2` and RSC makes sequential DB round trips, so co-location is
the main performance lever. Vercel's Git integration handles deploys; do not add
a deploy workflow, it would double-build. Full runbook, environment variable
table, and the Supabase redirect-URL setup are in `DEPLOYMENT.md`.

Two things that bite:
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Server-side env only, never
  `NEXT_PUBLIC_*` — that prefix inlines values into the browser bundle.
- Preview deployments share the production Supabase project. Clicking around a
  preview writes real pilot data.

## Open client decisions (blocking parts of M4–M6)

Service definitions and required fields · rate-con and Quick Pay legal wording ·
confirmed Quick Pay % and factoring fee logic · factoring partner and packet
format · carrier compliance thresholds / COI · pilot users and roles ·
email sender credentials.
