# M.C. Global Freight Solutions LLC — Phase 1 Logistics TMS

A cost-conscious, production-minded Transportation Management System for a
controlled brokerage pilot. **This drop is Milestones 1 & 2 only** (foundation +
auth/tenancy/RBAC/audit). Later milestones wire the operational screens on top of
this foundation.

> Source of truth: the approved prototype, client proposal, operating workflow,
> August 20 delivery plan, and prototype QA audit. Requirement IDs (e.g.
> `FR-RC-01`, `FR-TEN-01`) are embedded in code comments and tests so coverage is
> traceable.

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4** — server-side
  route handlers; no separate service.
- **Supabase** Postgres + Auth + Storage. Auth sits behind an **auth adapter** so
  Auth0 / enterprise SSO is a future drop-in (`src/lib/auth/adapter.ts`).
- **Resend** transactional email behind a **notification adapter** (noop default;
  no paid SMS in Phase 1).
- **FMCSA adapter** with a deterministic local **mock** (no network, reproducible).
- Disabled-by-design adapters for tracking (GPS/ELD), factoring execution, and
  load boards — **out of scope** in Phase 1, present as clean seams only.

Target launch cost < $100/month (Supabase free/pro + Resend free tier + Vercel
hobby/pro), excluding domain and developer tools.

## What is in this milestone

### Milestone 1 — Foundation
- Repo, architecture, and adapter seams (`src/adapters/*`, `src/lib/*`).
- Full database **schema + migrations** (`supabase/migrations/`): tenancy, roles,
  versioned config/policy, carriers + compliance, loads + canonical lifecycle,
  quotes (immutable pricing snapshot), rate confirmations + signatures,
  documents, milestones, invoices, factoring settlements, and the audit log.
- **Deterministic seed** with realistic demo data (`supabase/seed.sql`).
- `.env.example`, migrate/seed/reset scripts.

### Milestone 2 — Auth, tenant isolation, RBAC, audit
- Supabase Auth + session middleware + server-side route protection.
- **Tenant isolation** via Postgres **RLS** (`0002_rls.sql`) + server context
  resolution (`src/lib/tenant/context.ts`). A member of org A can never read or
  write org B's rows; carriers/drivers/shippers see only their related loads.
- **RBAC** role matrix + pure permission checks (`src/lib/rbac/*`), enforced
  server-side (the UI is never the gate).
- **Driver data masking** (`src/lib/masking/driver.ts`) — drivers never receive
  rates/margin/invoice/settlement fields.
- **Append-only audit log** (`0003_audit.sql`, `src/lib/audit/log.ts`) with a DB
  trigger that auto-audits load transitions and blocks UPDATE/DELETE of history.

Cross-cutting pure modules also included (schema-backed, used by later
milestones and covered by tests now): configurable **pricing/Quick Pay
calculator**, **carrier compliance gate**, **signature evidence**, **load
lifecycle** state machine, and **invoice/settlement eligibility**.

## Project layout

```
src/
  app/                 Next.js App Router (login, portal shell, api routes)
  lib/
    rbac/              roles + permission matrix + guards
    tenant/            server-side org/role resolution
    auth/              auth adapter + server guards
    audit/             append-only audit writer
    pricing/           configurable pricing + Quick Pay calc
    compliance/        carrier compliance gate
    signatures/        signature evidence capture
    finance/           invoice + settlement eligibility
    loads/             lifecycle state machine
    masking/           driver/commercial field masking
    supabase/          server/browser/middleware clients
  adapters/            fmcsa (mock), notifications (resend/noop), stubs (disabled)
supabase/
  migrations/          0001_core, 0002_rls, 0003_audit
  seed.sql             deterministic demo data
scripts/               migrate / seed / test-db / verify-db
tests/                 vitest suites (+ no-npm node fallback runner)
```

## Setup

```bash
cp .env.example .env.local     # fill in Supabase keys; NEVER commit secrets
npm install
```

### Database (Supabase)
1. Create a Supabase project. Put the URL + anon + service-role keys in
   `.env.local` and the Postgres connection string in `DATABASE_URL`.
2. Apply migrations (in order) via the Supabase SQL editor or CLI, or:
   ```bash
   npm run db:migrate        # applies supabase/migrations/*.sql to DATABASE_URL
   npm run db:seed           # loads deterministic demo data
   ```
   On Supabase, `auth.uid()` already exists — do **not** pass `--with-auth-shim`.
3. Create the demo auth users (same UUIDs printed by `db:seed`) via the Supabase
   Auth admin API/dashboard so logins map to the seeded memberships.

### Run
```bash
npm run dev                   # http://localhost:3000  (GET /api/health for a probe)
```

## Tests

```bash
npm run test:setup-db         # provision an isolated local Postgres test DB + app_user role
npm run test                  # vitest: pure logic + live RLS/audit (needs npm deps)
npm run test:teardown-db
```

Requirement-tagged suites: `rbac`, `driver-masking`, `pricing`,
`compliance-gate`, `signature-evidence`, `invoice-eligibility`, `lifecycle`
(pure), and `tenant-isolation`, `audit` (live Postgres w/ RLS enforced as a
non-superuser role).

### Offline verification (no npm registry access)
If the environment cannot install npm packages, the same guarantees are
verifiable with only Node + psql:
```bash
npm run test:offline          # runs the pure suites via Node's built-in runner
DB=mc_global_tms_test bash scripts/verify-db.sh   # live RLS + audit checks via psql
```

## Security model (defense in depth)
1. **Middleware** refreshes the session and blocks unauthenticated `/portal`.
2. **Server guards** (`requirePermission`) check auth + org membership +
   permission before any data access.
3. **RLS** is the backstop in the database itself — even a bug in the app layer
   cannot cross tenant boundaries.
4. **Masking** strips commercial fields for non-commercial roles before
   serialization.
5. **Audit** is append-only and cannot be altered, even by the table owner.

## Deployment (outline)
- **App:** Vercel (Next.js). Set all env vars from `.env.example` in the project
  settings. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- **DB/Auth/Storage:** Supabase managed. Apply migrations via CI or the CLI.
- **Email:** Resend domain + API key; set `NOTIFICATION_PROVIDER=resend`.
- Never commit `.env*`. Rotate the service-role key if exposed.

## Scope guardrails (Phase 1)
Out of scope and intentionally disabled: DAT/public load boards, GPS/ELD
telematics, direct ACH / payment processing, factoring API execution, EDI, rate
negotiation, AI rate prediction, native mobile apps. Each has a clean adapter
seam for a later phase.

## Legal note
Signature capture records electronic acceptance **evidence** (identity,
timestamp, IP/user agent where available, consent version, document
version/hash, audit entry). It does **not** assert legal e-signature
(ESIGN/UETA) compliance; that requires separate legal review (`FR-RC-07`).

## Status: complete / simulated / remaining
See `DELIVERY_STATUS.md`.
