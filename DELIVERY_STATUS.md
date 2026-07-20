# Delivery Status — Milestones 1 & 2

**Date:** 2026-07-20 · **Pilot target:** 2026-08-20 (controlled demo) · Stack:
Next.js + Supabase (per approved build spec; supersedes the Auth0 note in the
source docs via the auth adapter).

## ✅ Complete and verified

| Area | Requirement IDs | Verification |
|---|---|---|
| Database schema + migrations (all domain tables) | FR-LD-01, FR-CFG-03, FR-SNAP-01 | Migrations apply cleanly to Postgres 16 |
| Deterministic seed / demo data | FR-SEED-01 | Loads 4 orgs, 7 memberships, LD-1045, RC-2048, signatures |
| Tenant isolation (RLS) | FR-TEN-01/02/04 | **Live** psql tests as non-superuser: cross-org read + write blocked |
| Commercial hiding at storage layer | FR-MASK-01 | Carrier/driver cannot read `quotes`; masking unit-tested |
| RBAC role/permission matrix | FR-RBAC-02/03/04 | 8 unit tests (roles union, superadmin isolation, sign/release) |
| Driver data masking | FR-MASK-01/02 | 5 unit tests (no mutation, list masking) |
| Append-only audit + auto-audit trigger | FR-AUD-01/02/03 | **Live**: transition auto-audited; UPDATE/DELETE blocked; read RBAC |
| Configurable pricing / Quick Pay | FR-PR-01..06 | 7 unit tests vs. proposal reference figures ($2,439.02 etc.) |
| Carrier compliance gate | FR-CMP-01/02/03 | 8 unit tests (expiry block, warn windows, conditional) |
| Signature evidence | FR-RC-06/07 | 6 unit tests (hash, consent required, disclaimer) |
| Load lifecycle state machine | FR-LD-01/02, FR-RC-05 | 7 unit tests (legal steps, no skips/reverse, release gate) |
| Invoice / settlement eligibility | FR-BIL-01, FR-FCT-01 | 6 unit tests (document match, no packet without approval) |
| Auth adapter + session middleware + route guard | FR-AUTH-01..04 | Code complete; runtime login needs a live Supabase project |

**Test result:** 48 pure-logic assertions PASS + 14 live DB (RLS/audit) checks
PASS. See `test-run.txt`.

## 🟡 Simulated / stubbed by design (Phase 1)

- **FMCSA authority lookup** — deterministic local **mock** adapter (no live
  QCMobile call). Interface ready for the real provider (FR-ADP-FMCSA-02).
- **Transactional email** — Resend adapter present but defaults to **noop** until
  `RESEND_API_KEY` is set. **No SMS** (out of scope).
- **Factoring** — packet assembly only; `submit()` **throws** (no money movement).
- **Tracking (GPS/ELD)** and **load boards (DAT/Truckstop)** — disabled adapters
  that throw if called. Internal check-calls are the source of truth.
- **e-signature** — evidence capture is implemented; PDF render + storage lands
  in Milestone 5. Not a legal e-signature (FR-RC-07).

## ⛔ Not yet built (later milestones, per delivery plan)

- **M3** RFQ/quote/load **UI + server actions** and pricing-override approval flow.
- **M4** Carrier compliance UI + FMCSA adapter wiring + assignment/release gate
  end-to-end.
- **M5** Rate-confirmation send → carrier e-sign → broker release → driver ack,
  signed-PDF generation, notifications, document center with real uploads.
- **M6** Milestones/POD, shipper invoice with document-match engine, factoring
  settlement packet UI, margin reporting/export.
- **M7** Full public marketing site, dashboards, usability pass, deployment.

## ⚠️ Environment caveat for this build
`npm install` could not run here — this session's network egress allowlist does
not include `registry.npmjs.org`, so Vitest / `next build` / `tsc` could not be
executed in-session. The domain logic and the entire DB/RLS/audit layer were
therefore verified with **Node's built-in test runner** (real source, no npm)
and **psql** against a live Postgres 16. Run `npm run test` and `npm run build`
in any environment with npm registry access to exercise the standard toolchain.

## Client decisions still needed (from delivery plan §7, by ~Jul 22)
Service definitions & required fields · rate-con + Quick Pay legal wording ·
confirmed Quick Pay % + factoring fee logic · factoring partner + packet format ·
carrier compliance thresholds/COI · pilot users & roles · email/SMS sender creds.
