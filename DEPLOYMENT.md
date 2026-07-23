# Deployment — Vercel

Target: controlled pilot, 2026-08-20.

## Why Vercel, and why `syd1`

Vercel builds this repo with no adapter or build changes. The one setting that
actually matters is the region: your Supabase project is in `ap-southeast-2`
(Sydney), and React Server Components make several **sequential** database
round trips per page render. Compute in the US against a database in Sydney
pays trans-Pacific latency on every one of those trips, and it compounds within
a single request. `vercel.json` pins functions to `syd1` for that reason. If you
ever move the database, move the region with it.

---

## 1. Push to GitHub

There is no remote yet. From the repo root:

```bash
git add -A
git commit -m "M3 complete: RFQ/quote/load UI, override approval, CI"
gh repo create mc-global-tms --private --source=. --push
```

(Or use GitHub Desktop → Add Existing Repository → Publish, private.)

Keep it **private**. The repo contains client delivery documents, and
`.env.local` is gitignored — confirm it stays that way with
`git check-ignore -v .env.local` before the first push.

## 2. Connect Vercel

Vercel dashboard → Add New → Project → import the repo. It detects Next.js and
reads `vercel.json`. Vercel's own Git integration handles deploys — push a
branch and you get a preview URL, merge to `master` and it goes to production.
No deploy workflow file is needed, and adding one would double-build.

The repo's default branch is `master` — set Vercel's Production Branch to
`master` (Project → Settings → Git). It defaults to the repo default, so this
is usually already correct, but confirm it rather than assume `main`.

## 3. Environment variables

Vercel dashboard → Project → Settings → Environment Variables.

| Variable | Environments | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | `https://osmnbzwcjbiyindcctbz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development | Publishable key. Safe in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | **Bypasses RLS.** Server-only. Never rename it to `NEXT_PUBLIC_*` — that prefix inlines the value into the browser bundle and would hand every visitor full database access. |
| `FMCSA_PROVIDER` | all | `mock` |
| `NOTIFICATION_PROVIDER` | all | `noop` |
| `FACTORING_PROVIDER` | all | `noop` |
| `FEATURE_LOAD_BOARD_SYNC` | all | `off` |
| `FEATURE_TRACKING_TELEMATICS` | all | `off` |
| `FEATURE_FACTORING_API` | all | `off` |

**Not needed:** `DATABASE_URL` and `TEST_DATABASE_URL` are used only by
`scripts/` (setup, seed, tests). The running app never reads them, so leaving
them out of Vercel reduces the blast radius if the project is ever compromised.

**Also not needed:** `NEXT_PUBLIC_APP_URL`. The signout route now redirects
against the incoming request origin, so it is correct on production and on
every uniquely-named preview deployment without configuration.

## 4. Supabase auth redirect URLs — do not skip this

This is the most common Supabase + Vercel failure: everything builds, then
login silently fails to come back.

Supabase dashboard → Authentication → URL Configuration:

- **Site URL:** your production domain, e.g. `https://mc-global-tms.vercel.app`
- **Redirect URLs:** add both
  - `https://mc-global-tms.vercel.app/**`
  - `https://mc-global-tms-*.vercel.app/**` ← wildcard for preview deployments

Without the second entry, previews build fine but nobody can log in to them.

## 5. Gate merges on CI

`.github/workflows/ci.yml` runs the offline tests, typecheck, build, and a
migration-apply check. Make it binding:

GitHub → Settings → Branches → Add rule for `master` → Require status checks to
pass → select **Domain logic (offline)**, **Typecheck and build**, and
**Migrations apply cleanly**.

Vercel will still build previews for failing PRs — that's intended, previews are
for looking at. The branch rule is what stops broken code reaching production.

## 6. Verify after the first deploy

```bash
npm run verify:rls     # still points at the same Supabase project
```

Then on the deployed URL, confirm the pilot acceptance criterion by hand:
log in as `dispatcher@mcglobalfreightllc.com` (sees Loads, Margin Calculator)
and as `driver@horizonfreight.example` (Driver Brief only, no pricing).

---

## Known risk: previews share the production database

Preview deployments point at the same Supabase project as production, because
there is only one. Anyone clicking around a preview writes to real pilot data —
creating loads, approving overrides, appending audit rows.

For a six-user controlled pilot that is acceptable, and worth knowing rather
than discovering. If it becomes a problem before go-live, the fix is Supabase
branching (a per-PR ephemeral database), which is a paid feature and would mean
wiring branch credentials into Vercel preview env vars. Don't take that on
during pilot week.

## Rollback

Vercel keeps every deployment. Dashboard → Deployments → pick the last good one
→ Promote to Production. Instant, no rebuild.

Note this rolls back **code only** — applied database migrations stay applied.
If a release includes a destructive migration, it needs a paired down-migration
before you ship it, not after.
