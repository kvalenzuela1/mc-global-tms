# Supabase setup + end-to-end verification

Project ref: `osmnbzwcjbiyindcctbz` → `https://osmnbzwcjbiyindcctbz.supabase.co`

## Quick path (three commands)

```bash
# 1. Fill the three placeholders in .env.local (already created for you):
#    NEXT_PUBLIC_SUPABASE_ANON_KEY   Settings -> API -> anon / public
#    SUPABASE_SERVICE_ROLE_KEY       Settings -> API -> service_role
#    DATABASE_URL                    Settings -> Database -> Connection string (URI)

npm install
npm run setup:supabase   # schema + six demo users + seed data
npm run verify:rls       # proves broker sees margin, driver does not
npm run dev              # http://localhost:3000/login
```

`setup:supabase` is idempotent — re-run it freely. It applies
`supabase_setup.sql`, creates the six demo users email-confirmed via the Admin
API, then applies `supabase_seed_by_email.sql`, which binds the seed rows to
those users by email.

If port 5432 is blocked on your network, use the **Session pooler** URI from
Settings → Database instead of the direct connection string.

## The six demo users

All share `DEMO_USER_PASSWORD` from `.env.local`.

| Email | Becomes |
|---|---|
| owner@mcglobalfreightllc.com | Org Admin (MC Global) |
| manager@mcglobalfreightllc.com | Broker Manager |
| dispatcher@mcglobalfreightllc.com | Broker Dispatcher |
| dispatch@horizonfreight.example | Carrier Dispatch (Horizon) |
| driver@horizonfreight.example | Driver (Horizon) |
| buyer@summitretail.example | Shipper (Summit) |

## Why `verify:rls` rather than clicking through the UI

The Milestone 2 acceptance criterion is that a **broker sees margin and a driver
does not**. Checking that in the browser only proves the UI declined to render
it. `verify:rls` signs in as each persona, then queries PostgREST with that
user's own JWT, so row-level security is genuinely enforced — it proves the
*storage layer* withholds margin. It asserts:

- broker reads the `quotes` table and `margin_amount_cents` is present
- driver reads **zero** rows from `quotes` (different org, no RLS escape hatch)
- driver *can* read their assigned load, and no commercial field appears on it —
  including inside the `commercial_snapshot` JSONB, which `maskCommercials()`
  does **not** traverse
- carrier likewise reads zero quote rows
- driver cannot read `audit_log`

Note the dashboard SQL editor runs as superuser and **bypasses RLS**, so it
cannot be used to verify any of this.

## Manual fallback

If you'd rather not run the script: SQL Editor → paste `supabase_setup.sql` →
Run. Then Authentication → Users → Add user for each of the six above (mark
email-confirmed). Then SQL Editor → paste `supabase_seed_by_email.sql` → Run.
It fails with a clear message if any user is missing.
