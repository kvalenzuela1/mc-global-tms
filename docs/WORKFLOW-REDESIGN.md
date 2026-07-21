# MC Global Freight TMS — Navigation, Record-Detail, and Workflow Redesign

**Status:** proposal · **Author:** architecture review · **Date:** 2026-07-21
**Scope:** navigation, list→detail pattern, status architecture, data ownership,
synchronization, validation, RBAC surface, and a sequenced implementation plan.

> Read `CLAUDE.md` first. Every recommendation here is constrained by the nine
> non-negotiables in that file — especially #2 (`loads` is a security_invoker
> view over `loads_data`), #3 (quote RLS does not distinguish broker roles), and
> #9 (no money movement, no real e-signature, no SMS in Phase 1).

---

## 0. Correction to the brief's premise

The brief assumes the platform "already contains" RFQs, Quotes, Loads, Load
Board, Documents, Carriers, Customers, Dispatch, Tracking, Accounting, Invoices,
Payments, and Reports. It does not. Actual routes:

| Route | Exists | Kind | Detail page? |
|---|---|---|---|
| `/portal` | yes | dashboard | n/a |
| `/portal/rfqs` | yes | list + create modal | **yes** — `/portal/rfqs/[id]` |
| `/portal/quotes/[id]` | yes | detail only | detail exists, **no list** |
| `/portal/pricing` | yes | tool + approval queue | no |
| `/portal/loads` | yes | list + inline forms | **no** |
| `/portal/ratecons` | yes | list + inline forms | **no** |
| `/portal/carriers` | yes | list + inline forms | **no** |
| `/portal/documents` | yes | list | **no** |
| `/portal/driver` | yes | role-scoped worklist | no |
| `/portal/invoices` | **NO — 404** | nav link only | — |
| `/portal/admin` | **NO — 404** | nav link only | — |
| `/portal/audit` | **NO — 404** | nav link only | — |
| Load Board, Customers, Dispatch, Tracking, Accounting, Payments, Reports | **NO** | not built | — |

**Finding NAV-01 (Critical).** Three sidebar entries route to nonexistent pages.
`PortalNav` filters by permission, so an `org_admin` sees all three and every
one 404s. Fix before anything else: either build the page or remove the link.

Two structural observations that shape everything below:

- **There is no Customer (shipper) module at all.** `shippers` is a table with
  `name` and `margin_band` and no UI. RFQs reference `shipper_id`, but nothing
  creates a shipper except the seed script. This is the single biggest gap: the
  brief's section 9 ("customer information entered once should populate related
  RFQs, quotes, loads, invoices, documents") is currently impossible.
- **The one good detail page already exists.** `/portal/rfqs/[id]` is the
  pattern: server component, `getSessionContext()` → `can()` → org-scoped query
  → timeline → related records. Generalize *that*, don't invent a new pattern.

---

## 1. Recommended navigation

### 1.1 Current issues

| # | Issue | Severity |
|---|---|---|
| NAV-01 | `/portal/invoices`, `/portal/admin`, `/portal/audit` 404 | Critical |
| NAV-02 | "RFQs & Quotes" is one nav item but quotes have no list page — a quote is only reachable by first opening its RFQ | High |
| NAV-03 | "Margin Calculator" (`/portal/pricing`) is a *tool* and an *approval queue* sharing one route; the approval queue is work, the calculator is not | High |
| NAV-04 | "Rate Confirmations" is a top-level module, but a ratecon has no life independent of its load — it is a load sub-record | Medium |
| NAV-05 | "Carrier Compliance" names the sub-function, not the record. The module owns the carrier *record*; compliance is one tab of it | Medium |
| NAV-06 | "Driver Brief" is a role-specific worklist in the same list as broker modules; role-scoped homes should replace the dashboard for that role, not sit beside it | Medium |
| NAV-07 | No Customers module | Critical |
| NAV-08 | Documents is a flat global list with no per-record entry point | High |

### 1.2 Target sidebar

Grouped, permission-filtered, three tiers. **Main nav holds lists only.**

```
WORK
  Dashboard              /portal                  everyone (role-specific content)
  RFQs                   /portal/rfqs             RFQ_VIEW
  Quotes                 /portal/quotes           PRICING_VIEW        ← NEW list
  Loads                  /portal/loads            LOAD_VIEW | SHIPPER_TRACK
  Dispatch Board         /portal/dispatch         LOAD_TRANSITION     ← NEW (M7)

NETWORK
  Customers              /portal/customers        RFQ_VIEW            ← NEW
  Carriers               /portal/carriers         CARRIER_VIEW        (renamed)

FINANCE
  Invoices               /portal/invoices         INVOICE_CREATE      ← NEW (M6)
  Settlements            /portal/settlements      SETTLEMENT_CREATE   ← NEW (M6)

RECORDS
  Documents              /portal/documents        DOCUMENT_VIEW | DOCUMENT_UPLOAD
  Reports                /portal/reports          COMMERCIALS_VIEW    ← NEW (M7)

ADMIN
  Approvals              /portal/approvals        PRICING_OVERRIDE_APPROVE | COMPLIANCE_OVERRIDE
  Settings               /portal/admin            ADMIN_CONFIG
  Audit Log              /portal/audit            AUDIT_VIEW
```

**Demoted out of main nav:**

| Was | Becomes |
|---|---|
| Margin Calculator | A **panel inside Quote Detail** (`/portal/quotes/[id]` → Pricing tab) plus a standalone estimator at `/portal/quotes/new`. Its approval queue moves to **Approvals**. |
| Rate Confirmations | **Load Detail → Rate Confirmation tab**. Keep `/portal/ratecons` as a redirect for the carrier role only, whose entire job *is* the ratecon queue. |
| Driver Brief | Becomes the **driver's `/portal` dashboard**. `DRIVER_BRIEF_VIEW` should route the driver's root to the brief, not add a sidebar row. |
| Carrier Compliance | Renamed **Carriers**; compliance is a tab on Carrier Detail. |

**Rationale (business):** brokers navigate by *record*, not by *function*. A
dispatcher chasing a signature thinks "where is LD-1045", not "open the rate
confirmations module and find the row for LD-1045". Function-named modules force
the user to know which module holds the artifact they want; record-named modules
do not.

### 1.3 Four-tier information architecture

1. **Main nav modules** — own a list of records: RFQs, Quotes, Loads, Customers,
   Carriers, Documents, Invoices, Settlements, Dispatch Board, Reports.
2. **Record-detail tabs** — never in the sidebar: Stops, Rates, Carrier, Driver,
   Rate Confirmation, Tracking, Accessorials, Billing, Timeline, Audit.
3. **Dashboard widgets** — cross-record aggregates: my open RFQs, loads at risk,
   awaiting signature, documents expiring, approvals waiting on me.
4. **Settings/admin** — policy versions (`policies` table), org config,
   compliance thresholds, user & role management, audit log.

---

## 2. End-to-end lifecycle

The brief's 20-stage cycle, mapped to what this codebase actually models. Stages
marked ⛔ are Phase-1-forbidden (CLAUDE.md #9) and must render as disabled UI
with an explanatory tooltip, never as a working button.

| # | Stage | Module | Load status | Entry criteria | Exit criteria | Action / owner | Auto-created |
|---|---|---|---|---|---|---|---|
| 1 | RFQ intake | RFQs | — | customer + lane + service type | RFQ `open` | `createRfq` / shipper or broker | rfq |
| 2 | Pricing | Quotes | — | RFQ `open`, freight details sufficient | quote row exists | `createQuote` / dispatcher | quote; RFQ → `quoted` |
| 3 | Override approval | Approvals | — | quote `is_override` | quote `approved` | `approveOverride` / manager (≠ requester) | audit `pricing.override_approved` |
| 4 | Quote acceptance | Quotes | — | quote `approved` or non-override | — | `acceptQuote` **(new)** / broker records customer decision | quote `accepted` |
| 5 | Load creation | Loads | `draft`→`booked` | accepted quote, compliant carrier or override | load exists w/ reference | `createLoadFromQuote` / dispatcher | load, LD-####, RFQ → `booked` |
| 6 | Carrier sourcing | Loads → Carrier tab | `booked` | load exists | carrier_id set | assign / dispatcher | — |
| 7 | Rate confirmation | Loads → Ratecon tab | `awaiting_carrier_signature` | carrier assigned, compliant | RC sent | `sendRatecon` / dispatcher | rate_confirmation RC-#### |
| 8 | Carrier signature | Loads → Ratecon tab | `signed_awaiting_broker_release` | RC `sent` | RC `signed` | `signRatecon` / carrier_dispatch | signature evidence row |
| 9 | Driver assignment | Loads → Driver tab | (same) | RC `signed` | driver_id set | assign / dispatcher | — |
| 10 | Release / dispatch | Loads | `released_to_driver` | signed RC **and** carrier still compliant (hard gate) | released | `advanceLoadStatus` / dispatcher | driver notification |
| 11 | Driver ack | Driver brief | `driver_acknowledged` | released | acknowledged | `acknowledgeLoad` / driver | milestone |
| 12 | Dispatched | Loads | `dispatched` | acknowledged | — | `advanceLoadStatus` | — |
| 13 | Pickup / in transit | Loads → Tracking | `in_transit` | dispatched | pickup milestone | `recordMilestone` / driver | milestone `pickup` |
| 14 | Check calls | Loads → Tracking | `in_transit` | — | — | `recordMilestone` / driver or dispatcher | milestone `check_call` |
| 15 | Delivery | Loads → Tracking | `delivered` | in transit | delivery milestone | `recordMilestone` | milestone `delivery` |
| 16 | POD upload & verify | Documents / Load → Documents | `delivered` | delivered | POD `verified` | `uploadDocument` + `verifyDocument` **(new)** | document row |
| 17 | Customer invoice | Invoices | `invoiced` | POD verified, billing data complete | invoice `issued` | `createInvoice` **(new)** / manager | invoice row |
| 18 | Carrier settlement packet | Settlements | `invoiced` | invoice issued, carrier invoice on file | packet `packet_created` | `createSettlement` **(new)** | settlement row |
| 19 | ⛔ Customer payment | Invoices | — | — | — | **out of Phase 1** — record only, no money movement | — |
| 20 | ⛔ Carrier payment | Settlements | — | — | — | **out of Phase 1** — `submit()` throws by design | — |
| 21 | Reconciliation & closure | Loads | `closed` | no open document or financial exceptions | closed | `advanceLoadStatus` / manager | — |

**Gap G-01 (High).** There is no explicit **quote acceptance** step. Today
`createLoadFromQuote` conflates "customer said yes" with "create the operational
load". A quote that the customer rejected is indistinguishable from one never
sent. Add `quotes.status` values `sent`/`accepted`/`rejected`/`expired` and make
`createLoadFromQuote` require `status = 'accepted'`.

**Gap G-02 (High).** Stages 16–18 and 21 have no UI. `invoice-eligibility.ts`
exists and is tested but has **zero callers** — same situation `evaluateCarrierCompliance`
was in before M4. M6 is wiring, not new logic.

---

## 3. Status architecture

### 3.1 Current issues

**STAT-01 (Critical).** `loads.status` is a single 12-value linear enum doing the
work of six independent concerns. Booking, signature, dispatch, tracking,
document, and billing state are all forced onto one axis. Consequences already
visible in the code:

- `awaiting_carrier_signature` and `signed_awaiting_broker_release` are
  *document* states occupying *operational* status slots. `advanceLoadStatus`
  has to explicitly reject them ([loads/actions.ts](src/app/portal/loads/actions.ts)),
  and the loads list has to filter them out of the advance dropdown via a
  `MANAGED_ELSEWHERE` set ([loads/page.tsx:13-16](src/app/portal/loads/page.tsx#L13-L16)).
  That set is the smell: the enum is modelling two axes at once.
- A load cannot be "in transit **and** missing a POD **and** invoice-blocked" —
  the linear enum forces one answer.
- There is no cancellation path at all (`ALLOWED[CLOSED] = []`, no `cancelled`).

**STAT-02 (High).** `carriers.status` (`conditional`/`approved`/`suspended`/`rejected`)
is separate from the detailed compliance gate on purpose — but the UI shows both
and nothing explains which one blocks assignment. It's the *gate*, not
`carriers.status`, that blocks. Users will misread a green "Approved" badge as
"assignable".

**STAT-03 (Medium).** `quotes` has an `is_override` boolean plus a `status`
column added in 0004, but no commercial lifecycle (sent/accepted/rejected/expired).
`rate_confirmations.status` has no `rejected` — a carrier can only sign or ignore.

### 3.2 Recommended: one operational status + five status facets

Keep `loads.status` as the **operational** axis but shorten it. Move the other
concerns to their own columns, each with its own small enum. **This is additive** —
existing rows keep working, and `loads/lifecycle.ts` keeps its shape.

```
loads_data.status              operational   (draft→quoted→booked→dispatched→
                                              in_transit→delivered→closed
                                              + cancelled)
loads_data.booking_status      NEW  unassigned | sourcing | assigned | confirmed | fell_through
loads_data.ratecon_status      NEW  none | draft | sent | signed | superseded | rejected
loads_data.dispatch_status     NEW  not_ready | driver_assigned | released | acknowledged
loads_data.tracking_status     NEW  not_started | at_pickup | in_transit | at_delivery | delivered | exception
loads_data.billing_status      NEW  not_ready | ready | invoiced | paid | disputed
loads_data.carrier_pay_status  NEW  not_ready | packet_created | submitted | paid
loads_data.doc_status          DERIVED (view/function) complete | missing_required | expiring | rejected
loads_data.health              DERIVED on_track | at_risk | delayed | blocked | completed
```

`awaiting_carrier_signature` and `signed_awaiting_broker_release` **retire** from
`loads.status` and become `ratecon_status ∈ {sent, signed}` with
`dispatch_status = not_ready`. That deletes `MANAGED_ELSEWHERE` and the two
special-case rejections in `advanceLoadStatus`.

> **Migration warning.** `loads` is a view over `loads_data` and the status enum
> is a CHECK constraint on the base table. Dropping the two values requires
> (a) new columns + backfill, (b) recreate the view **with `security_invoker = true`**
> — CLAUDE.md #2, this has already caused a full cross-tenant leak once —
> (c) then relax the CHECK. Do it as `0011_load_status_facets.sql` in exactly
> that order, and re-run `npm run verify:rls` after.

### 3.3 Synchronization matrix

Rows = the event. Columns = what it must update. Every one of these is a
*server action side effect*, never a UI-side write.

| Event | RFQ | Quote | Load ops | booking | ratecon | dispatch | tracking | doc | billing |
|---|---|---|---|---|---|---|---|---|---|
| `createRfq` | `open` | — | — | — | — | — | — | — | — |
| `createQuote` | → `quoted` | `draft`/`pending_approval` | — | — | — | — | — | — | — |
| `approveOverride` | — | → `approved` | — | — | — | — | — | — | — |
| `rejectOverride` | — | → `rejected` | — | — | — | — | — | — | — |
| `sendQuote` *(new)* | — | → `sent` | — | — | — | — | — | — | — |
| `acceptQuote` *(new)* | — | → `accepted` | — | — | — | — | — | — | — |
| `createLoadFromQuote` | → `booked` | → `converted` | `booked` | `assigned` | `none` | `not_ready` | `not_started` | recompute | `not_ready` |
| `sendRatecon` | — | — | *(unchanged)* | `confirmed` | `sent` | — | — | recompute | — |
| `signRatecon` | — | — | *(unchanged)* | — | `signed` | `not_ready`→ready to release | — | recompute | — |
| assign driver *(new)* | — | — | — | — | — | `driver_assigned` | — | — | — |
| `advanceLoadStatus`→released | — | — | — | — | — | `released` | — | — | — |
| `acknowledgeLoad` | — | — | `dispatched` | — | — | `acknowledged` | — | — | — |
| `recordMilestone(pickup)` | — | — | `in_transit` | — | — | — | `at_pickup`→`in_transit` | — | — |
| `recordMilestone(delivery)` | — | — | `delivered` | — | — | — | `delivered` | — | `not_ready` |
| `uploadDocument(pod)` | — | — | — | — | — | — | — | recompute | — |
| `verifyDocument(pod)` *(new)* | — | — | — | — | — | — | — | `complete` | → `ready` |
| `createInvoice` *(new)* | — | — | `invoiced` | — | — | — | — | — | `invoiced` |
| `createSettlement` *(new)* | — | — | — | — | — | — | — | — | `carrier_pay = packet_created` |
| `closeLoad` *(new)* | → `closed` | — | `closed` | — | — | — | — | — | — |
| `cancelLoad` *(new)* | → `closed` | — | `cancelled` | `fell_through` | `superseded` | `not_ready` | `exception` | — | — |

**Rule: a facet is only ever written by the action that owns it.** Nothing may
set `ratecon_status` except the ratecon actions; nothing may set `tracking_status`
except milestone recording. Enforce it by keeping each facet's writes inside one
module and asserting it in a test (`FR-SYNC-01`).

---

## 4. Record ownership / source of truth

The brief's section 11 is the most important part of this document, because it is
where the current code is weakest.

| Data | Owner record | How it reaches other screens | Kind |
|---|---|---|---|
| Customer name, contacts, locations, credit | **Customer** (`shippers`, needs expansion) | FK + join | linked, read-only downstream |
| Carrier name, DOT/MC, authority, insurance | **Carrier** (`carriers` + `carrier_compliance`) | FK + join | linked, read-only downstream |
| Carrier compliance verdict | **latest `carrier_compliance` row** + org thresholds | `getCarrierComplianceResult()` | computed, never stored on load |
| Lane, commodity, dims, class | **RFQ** (`rfqs`, 0010 columns) | copied to load at creation | **snapshot** — see FLD-02 |
| Customer price, margin, fees | **accepted Quote** (`quotes.pricing_snapshot`) | copied to `loads.commercial_snapshot` | **immutable snapshot** |
| Carrier pay rate | **signed Rate Confirmation** (`content_snapshot`) | read via join | **immutable snapshot** |
| Accessorial charges | `accessorials` rows | join, summed | live |
| Driver name, phone | **Driver** (`drivers`) | FK + join | linked |
| Files | `documents` + Storage | join by `load_id`/`carrier_id` | linked |
| Invoice amounts | `invoices.snapshot` | — | immutable snapshot |
| Every status | its facet column | — | live |

**FLD-01 (High) — every field must render its provenance.** Add a shared
`<Field>` primitive that takes a `source` prop and renders a marker:

| Marker | Meaning | Editable? |
|---|---|---|
| 🔗 *(link icon)* | Linked from another record — click to open the owner | No, edit at source |
| ✎ | Owned by this record | Yes, per role/status |
| 📌 | Snapshot taken at *(timestamp)* — deliberately frozen | No |
| ⚑ | Snapshot **diverges** from the live source | No — but show both |
| ⚖︎ | Overrideable with reason + audit | Yes, with justification |

The ⚑ case matters: a load's `commercial_snapshot` is frozen at booking. If the
customer's rate agreement later changes, the load must keep the old number *and*
the UI must say so. Silently showing a stale number with no marker is how brokers
invoice the wrong amount.

**FLD-02 (High) — RFQ freight detail is not carried to the load.** Migration 0010
added packaging, weight, dimensions, NMFC, and class to `rfqs`. `loads` has
`origin`, `destination`, `service_type` and nothing else. So the dispatcher who
opens LD-1045 cannot see what is on the truck without navigating back to the RFQ,
and a load created without an RFQ has no freight data at all. Copy the freight
block onto `loads_data` at creation as a snapshot (📌), with a link back to the
RFQ (🔗).

**FLD-03 (Critical) — there is no stop model.** `origin` and `destination` are
`text`. That blocks: multi-stop loads, appointment times, receiver contact,
pickup/delivery number, and any "do not mark delivered without receiver
confirmation" rule (brief §18). Introduce `load_stops`:

```sql
create table load_stops (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  load_id uuid not null references loads_data(id) on delete cascade,
  sequence int not null,
  stop_type text not null check (stop_type in ('pickup','delivery','intermediate')),
  location_name text,
  address_line1 text, address_line2 text,
  city text, state text, postal_code text, country text not null default 'US',
  contact_name text, contact_phone text,
  appointment_start timestamptz, appointment_end timestamptz,
  appointment_required boolean not null default false,
  reference_number text,              -- PO / pickup # / delivery #
  arrived_at timestamptz, departed_at timestamptz,
  signed_by text,                     -- receiver name at delivery
  notes text,
  created_at timestamptz not null default now(),
  unique (load_id, sequence)
);
```

Keep `loads.origin`/`destination` as denormalized display columns derived from
stop 1 and stop N, so existing list queries don't break — but stops become the
source of truth (🔗 into the load's Stops tab).

---

## 5. The standard record-detail pattern

One layout, used by RFQ, Quote, Load, Carrier, Customer, Document, Invoice,
Settlement. Generalize from `/portal/rfqs/[id]`, which already has 80% of it.

```
┌─ Breadcrumb: Loads / LD-1045 ────────────────────────────────────────────┐
├─ HEADER (sticky) ────────────────────────────────────────────────────────┤
│ LD-1045  Chicago, IL → Dallas, TX                    [status facet chips]│
│ Summit Retail · Horizon Freight · Broker: J.Diaz · Dispatcher: M.Okafor  │
│ Created 12 Jul · Updated 4m ago · ⚠ POD missing · ⚠ Insurance exp. 14d   │
├─ ACTION BAR (sticky, status- and role-filtered) ─────────────────────────┤
│ [Send Rate Confirmation] [Assign Driver] [Upload Document]   [⋯ more]    │
├──────────────────────────────────┬───────────────────────────────────────┤
│ TABS                             │ RIGHT RAIL                            │
│ Overview│Stops│Freight│Carrier│…│ ▸ Next required action                 │
│                                  │ ▸ Blocking issues                     │
│  ...tab body...                  │ ▸ Missing fields / documents          │
│                                  │ ▸ Financial summary (perm-gated)      │
│                                  │ ▸ Related records                     │
│                                  │ ▸ Last activity                       │
└──────────────────────────────────┴───────────────────────────────────────┘
```

**Header** — record number, title, primary status, facet chips, both party
names (each a 🔗 link), assigned broker + dispatcher, created/updated, warnings,
breadcrumb.

**Action bar** — computed, never hardcoded per page. One pure function per record
type: `availableActions(record, role, facts) → Action[]`, where `facts` carries
things the DB knows (has signed ratecon, carrier compliant, POD verified). Pure
= offline-testable = CLAUDE.md #8. Disabled actions render **greyed with a
reason tooltip**, not hidden — hiding a button teaches the user nothing.

**Right rail** — the required-action engine (§9). It is the answer to "what do I
do next", and it is the highest-value single addition in this document.

**Tabs per record type:**

| Record | Tabs |
|---|---|
| RFQ | Overview · Freight · Stops · Quotes · Documents · Timeline · Audit |
| Quote | Overview · Pricing · Approval · Versions · Linked RFQ/Load · Timeline · Audit |
| Load | Overview · Stops · Freight · Customer · Carrier · Driver · Rate Confirmation · Tracking · Documents · Accessorials · Billing · Carrier Pay · Timeline · Audit |
| Carrier | Overview · Authority · Insurance · Compliance · Contacts · Drivers · Assigned Loads · Documents · Settlements · Timeline · Audit |
| Customer | Overview · Contacts · Locations · RFQs · Quotes · Loads · Invoices · Credit · Documents · Timeline · Audit |
| Document | Preview · Metadata · Versions · Linked record · Activity · Audit |
| Invoice | Overview · Line items · Linked load · Documents · Payments · Timeline · Audit |

**Tab rules:** a tab that would be empty renders an empty state with the action
that fills it ("No stops yet — Add pickup"), never a blank panel. Tabs whose
permission the role lacks are removed entirely, not shown-and-blocked.

---

## 6. List page specification

Applies to every list. Current lists have none of this.

| Element | Requirement |
|---|---|
| Primary link | Reference column (RFQ id, quote id, LD-####, RC-####, carrier name, doc name) is an anchor to `[id]` |
| Row click | Whole row navigates; nested links/buttons `stopPropagation` |
| Secondary links | Customer name → customer, carrier name → carrier, load ref → load |
| Status | Primary badge + facet chips; consistent colors platform-wide |
| Warnings | ⚠ icons for: missing required doc, expiring insurance, appointment missed, override pending, margin below floor |
| Owner | Assigned broker / dispatcher avatar |
| Updated | Relative time, sortable |
| Filters | Status facet, date range, customer, carrier, owner, service type |
| Search | Reference, customer, carrier, city, PO number |
| Sort | Any column; default = most urgent first, not created-desc |
| Saved views | Per user: "My loads", "Awaiting signature", "Missing POD", "Ready to invoice" |
| Bulk | Assign owner, export CSV, bulk document request (never bulk status change) |
| Pagination | Server-side, 50/page, URL-driven so a filtered list is shareable |
| Empty state | Explains the module + offers the create action |

**LST-01 (Critical).** No list except RFQs links anywhere. Loads, ratecons,
carriers, and documents are terminal. Fix order: **Loads → Carriers → Documents
→ Quotes → Ratecons**.

**LST-02 (High).** `/portal/loads` embeds create-load, advance-status, and
add-accessorial forms *inline in the list* ([loads/page.tsx](src/app/portal/loads/page.tsx),
360 lines). This is why the list can't be paginated or filtered — every row
carries a form. Move all three into Load Detail; the list keeps only a "New load"
button and a per-row quick-action menu.

**LST-03 (Medium).** Same problem, smaller, on `/portal/carriers` (203 lines) and
`/portal/ratecons` (297 lines).

---

## 7. Module specifications

### 7.1 RFQ

**List `/portal/rfqs`** — currently 123 lines, links to detail already ✅.
Add columns: customer, equipment/service, weight, class, pickup date, expiration,
assigned broker, RFQ status, **quote status** (the derived best-quote state),
warning chips. Add filters + search + saved views per §6.

**Detail `/portal/rfqs/[id]`** — exists, needs: action bar, right rail,
Documents tab, Timeline tab, Audit tab, and an editable form (today it is
100% read-only — there is **no way to edit an RFQ after creation**, RFQ-01,
High).

**Statuses.** Current enum is `open → quoted → booked → closed`. The brief asks
for a richer set. Recommendation: **keep the four-value operational enum** (it is
tested, linear, and auditable per CLAUDE.md) and add a separate
`rfqs.commercial_status` for the customer-facing states:

```
draft | submitted | under_review | pricing | quoted | sent | customer_reviewing
| accepted | rejected | expired | cancelled
```

plus `rfqs.expires_at`. `open` maps to `draft|submitted|under_review|pricing`;
`quoted` to `quoted|sent|customer_reviewing`; `booked` to `accepted`; `closed`
to `rejected|expired|cancelled`.

| RFQ commercial status | Buttons | Editable | Required to leave | Next |
|---|---|---|---|---|
| draft | Edit · Save · Submit · Delete | full | origin, destination, service_type, customer | submitted |
| submitted | Edit · Start Pricing · Cancel | full | — | under_review, cancelled |
| under_review | Create Quote · Request Info · Cancel | freight only | freight sufficient for pricing (see VAL-02) | pricing |
| pricing | Create Quote · Cancel | none | at least one quote | quoted |
| quoted | Send Quote · Revise · Cancel | none | quote `approved` if override | sent |
| sent | Resend · Revise Quote · Mark Accepted · Mark Rejected · Cancel | none | — | customer_reviewing, accepted, rejected |
| customer_reviewing | Mark Accepted · Mark Rejected · Revise · Extend Expiry | none | — | accepted, rejected, expired |
| accepted | Convert to Load · View Load | none | compliant carrier or override | (load created) |
| rejected / expired / cancelled | Duplicate · Reopen *(manager)* | none | reopen reason | draft |

### 7.2 Quote

**Decision: one record, two entry points.** Quotes are a **main module with a
list** *and* a tab inside RFQ Detail — both reading `quotes` by `rfq_id`. Never
two records. The RFQ tab is a filtered view of the same rows the list shows.

**QTE-01 (High).** There is no quote list page today; `/portal/quotes/[id]`
exists with no parent. Build `/portal/quotes`.

**QTE-02 (High).** `quotes` has no `version` column, but the brief and real
brokerage practice require revision history (customer negotiates, you re-quote).
Add `version int not null default 1` and `supersedes_quote_id uuid`. A revision
creates a **new row**, never an UPDATE — consistent with the append-only
convention already used by `carrier_compliance` ("no `is_current` flag, latest
row wins").

**Detail** — Quote number *(add `quotes.reference`, QT-####, mirroring
`loads/reference.ts` and `ratecons/reference.ts`)*, linked RFQ 🔗, customer 🔗,
lane 📌, customer price ✎, carrier cost estimate ✎, margin (computed),
fuel surcharge, accessorial estimates, validity period, terms, status, approval
block, version history.

**Pricing tab** hosts the margin calculator that today lives at `/portal/pricing`
— same `computePricing()` call, in context of the record it prices.

**Statuses:** `draft → pending_approval → approved → sent → viewed →
negotiating → accepted | rejected | expired | revised → converted | cancelled`.

**Acceptance → Load.** `acceptQuote` sets `accepted_at`, freezes
`pricing_snapshot`, then `createLoadFromQuote` copies that snapshot verbatim into
`loads.commercial_snapshot` (📌) and the RFQ freight block into the load's freight
columns (📌, per FLD-02). Note `readSnapshotCents` already tolerates both
camelCase and snake_case snapshot shapes — keep using it, do not re-normalize.

### 7.3 Loads — the central workspace

**Detail `/portal/loads/[id]` does not exist. This is the single highest-priority
build in the document.**

| Tab | Fields | Owner | Editable in | Editable by |
|---|---|---|---|---|
| Overview | reference 📌, lane 🔗stops, status facets, parties 🔗, dates, margin (perm-gated) | load | — | read-only |
| Stops | full `load_stops` editor, appointments, contacts, refs | load_stops ✎ | ≤ `in_transit` | dispatcher+ |
| Freight | packaging, pieces, weight, dims, NMFC, class | 📌 from RFQ, ✎ after | ≤ `booked` | dispatcher+ |
| Customer | name, contacts, billing terms, credit | 🔗 Customer | never here | — |
| Carrier | carrier 🔗, compliance verdict (computed), assignment reason, override block ⚖︎ | carriers | `booked` only | dispatcher+; override `org_admin` |
| Driver | driver 🔗, phone, equipment | drivers | after RC signed | dispatcher+ |
| Rate Confirmation | RC-####, version, status, content snapshot 📌, signature evidence, send/sign actions | rate_confirmations | per RC status | `RATECON_SEND` / `RATECON_SIGN` |
| Tracking | milestone feed, check calls, ETA, exceptions | milestones ✎ | `dispatched`..`delivered` | `MILESTONE_RECORD` |
| Documents | scoped `documents` list + upload + request | documents | any | `DOCUMENT_UPLOAD` |
| Accessorials | type, amount, billable_to, description | accessorials ✎ | ≤ `invoiced` | dispatcher+ |
| Billing | invoice status, eligibility verdict, invoice 🔗 | invoices | `delivered`+ | `INVOICE_CREATE` |
| Carrier Pay | settlement packet, quick pay fee 📌, status | settlements | `invoiced`+ | `SETTLEMENT_CREATE` |
| Timeline | merged event feed | derived | — | read-only |
| Audit | `audit_log` rows | audit | — | `AUDIT_VIEW` |

**LD-01 (Critical).** Driver assignment has **no UI**. `loads.driver_id` exists,
`drivers` exists, `/portal/driver` reads assigned loads — but nothing sets
`driver_id`. The driver flow is unreachable except via seed data.

**LD-02 (High).** No cancellation. Add `cancelled` to the enum with a mandatory
reason, permitted from any status before `invoiced`, audited.

**LD-03 (Medium).** `loads.updated_at` exists but nothing writes it. Add a
trigger in the same migration as the status facets.

### 7.4 Documents

**DOC-01 (Critical).** No document detail page, no `verification_status`, no
versioning, no expiry, no "required document" concept. The `documents` table has
9 columns and no lifecycle at all. Yet compliance depends on documents expiring
(insurance) and invoicing depends on documents being *verified* (POD).

Add `0012_document_lifecycle.sql`:

```sql
alter table documents
  add column name          text,
  add column version       int  not null default 1,
  add column supersedes_id uuid references documents(id),
  add column status        text not null default 'uploaded'
    check (status in ('requested','uploaded','under_review','verified',
                      'rejected','superseded','archived')),
  add column effective_date date,
  add column expires_at     date,
  add column verified_by    uuid,
  add column verified_at    timestamptz,
  add column rejection_reason text,
  add column mime_type     text,
  add column size_bytes    bigint;

create index documents_status_idx  on documents(org_id, status);
create index documents_expiry_idx  on documents(expires_at) where expires_at is not null;
```

Plus a `required_documents` policy (per service type / status) resolved through
the existing `policy-resolver.ts` platform→org→exception chain, so "what does
this load still need" is configuration, not code.

**Document sync rules (brief §7).** One table, many views. Never copy a file.

| Where it appears | Query | Guarantee |
|---|---|---|
| `/portal/documents` | all org docs | superset |
| Load → Documents tab | `where load_id = :id` | same rows |
| Carrier → Documents tab | `where carrier_id = :id` | same rows |
| Customer → Documents tab | via `load_id in (customer's loads)` | same rows |
| Invoice → Documents | via `load_id` | same rows |

A POD uploaded on the load *is already* the row the global list shows — that part
is right today. What is missing is the reverse: the global list does not say
which record a document belongs to, so a broker seeing a POD cannot get to its
load. Add the related-record link column.

**Exclusions to keep:** `coi` and `ratecon_pdf` stay out of manual upload
(documented reason in CLAUDE.md M5). COI belongs on the carrier record and
`documents_select` RLS has no carrier_id carve-out — **fix the RLS before
enabling COI upload**, do not work around it in the app layer.

### 7.5 Carriers

**Detail `/portal/carriers/[id]` does not exist** (CAR-01, High). The list page
carries every form inline.

Tabs: Overview · Authority · Insurance · Compliance · Contacts · Drivers ·
Assigned Loads · Documents · Settlements · Performance · Timeline · Audit.

**Statuses** — keep `carriers.status` (`conditional`/`approved`/`suspended`/`rejected`)
and *stop implying it gates assignment*. Render it as **"Relationship status"**
and render the compliance verdict beside it as **"Assignment eligibility"**:

| Relationship | Compliance gate | Can assign? |
|---|---|---|
| approved | pass | ✅ yes |
| approved | fail | ⚠ only with `org_admin` override + reason (audited) |
| conditional | pass | ⚠ override |
| suspended / rejected | any | ❌ never, no override |

That table should render *in the UI*, on the carrier header. The current design
shows a green Approved badge next to a carrier that the gate will refuse, and
the user only learns at submit time. The loads dropdown already annotates
compliance (M4) — carry the same annotation into the carrier record.

**CAR-02 (Medium).** Insurance expiry lives in `carrier_compliance.insurance_expiry`
but nothing surfaces "expires in 14 days". Add an expiring-soon warning to the
carrier list, carrier header, and every load assigned to that carrier.

### 7.6 Customers — net-new module

**CUS-01 (Critical).** `shippers` has 6 columns (`id, org_id, shipper_org_id,
name, margin_band, created_at`) and no UI. Everything the brief asks for in §9
needs a real customer record.

```sql
-- 0013_customers.sql
alter table shippers
  add column code            text,             -- customer short code
  add column status          text not null default 'active'
    check (status in ('prospect','active','on_hold','inactive')),
  add column billing_email   text,
  add column payment_terms_days int not null default 30,
  add column credit_limit_cents bigint,
  add column tax_id          text,
  add column notes           text,
  add column created_by      uuid,
  add column updated_at      timestamptz not null default now();

create table customer_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  shipper_id uuid not null references shippers(id) on delete cascade,
  name text not null, title text, email text, phone text,
  role text check (role in ('primary','billing','operations','receiving')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table customer_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  shipper_id uuid not null references shippers(id) on delete cascade,
  label text not null,
  address_line1 text, address_line2 text,
  city text, state text, postal_code text, country text not null default 'US',
  contact_name text, contact_phone text,
  hours text, appointment_required boolean not null default false,
  created_at timestamptz not null default now()
);
```

Both tables need RLS mirroring `shippers` (`app_is_member(org_id)`), and both
need adding to `verify-rls.mjs`.

**Payoff:** the RFQ form stops asking for free-text origin/destination and offers
the customer's saved locations; the load's stops prefill; the invoice's bill-to
comes from the customer, not retyped. That is the brief's "enter once" rule.

### 7.7 Invoices & Settlements (M6)

`invoices` and `settlements` tables exist and are RLS'd. `invoice-eligibility.ts`
is written and tested with zero callers. Needed:

- `/portal/invoices` list + `/portal/invoices/[id]` detail
- `createInvoice` server action gated on `evaluateInvoiceEligibility()`
- `/portal/settlements` + `createSettlement`; `submit()` **must keep throwing**
  (CLAUDE.md #9) and the UI must show it as "Phase 2", not as a broken button
- Payments: **record-only** in Phase 1. Model `invoices.status ∈ issued|paid|void`
  as a manual bookkeeping flag with an audit entry. Do not build a payments module
  that implies money movement.

---

## 8. Status-driven button matrix

Implemented as pure functions in `src/lib/<domain>/actions-available.ts` —
no Next/Supabase imports (CLAUDE.md #8), offline-testable, one test per row.

### Load

| Status / facet | Actions | Gate |
|---|---|---|
| `draft` | Edit · Add Stops · Delete | `LOAD_EDIT` |
| `booked`, booking=`unassigned` | Search Carrier · Assign Carrier | `LOAD_EDIT` |
| `booked`, carrier assigned, compliant | Send Rate Confirmation · Reassign Carrier | `RATECON_SEND` |
| `booked`, carrier assigned, **non-compliant** | Send RC *(disabled — "carrier fails compliance")* · Override & Assign ⚖︎ | override: `COMPLIANCE_OVERRIDE` (`org_admin` only) |
| ratecon=`sent` | Resend · Void & Revise · *(waiting on carrier)* | `RATECON_SEND` |
| ratecon=`sent` (carrier view) | Review · **Sign** · Decline | `RATECON_SIGN` |
| ratecon=`signed`, dispatch=`not_ready` | Assign Driver | `LOAD_EDIT` |
| ratecon=`signed`, driver assigned | **Release to Driver** | `LOAD_RELEASE_DRIVER` + hard compliance re-check |
| ratecon≠`signed` | Release *(disabled — "rate confirmation not signed")* | **non-overridable** |
| dispatch=`released` | *(waiting on driver ack)* · Resend · Recall | `LOAD_EDIT` |
| `dispatched` | Add Check Call · Report Delay · Update ETA | `MILESTONE_RECORD` |
| `in_transit` | Add Check Call · Report Delay · Update ETA · Add Accessorial · Mark Delivered | `MILESTONE_RECORD` / `LOAD_EDIT` |
| `delivered`, no POD | Upload POD · Request POD from Carrier | `DOCUMENT_UPLOAD` |
| `delivered`, POD uploaded | Verify POD · Reject POD | `DOCUMENT_VIEW` + review perm |
| `delivered`, POD verified | **Create Customer Invoice** · Add Accessorial | `INVOICE_CREATE` |
| `invoiced` | Create Settlement Packet · Record Payment · View Invoice | `SETTLEMENT_CREATE` |
| `invoiced`, no open exceptions | **Close Load** | `LOAD_TRANSITION` |
| any < `invoiced` | Cancel Load ⚖︎ *(reason required)* | `LOAD_EDIT` |
| `closed` | Duplicate · Archive · View Audit | — |

### Quote

| Status | Actions |
|---|---|
| draft | Edit · Save · Submit for Approval *(if override)* · Send · Delete |
| pending_approval | Approve · Reject · Recall — **approver ≠ requester**, `evaluateApproval()` |
| approved | Send to Customer · Revise |
| sent | Resend · Revise · Mark Viewed · Mark Accepted · Mark Rejected · Extend Expiry |
| negotiating | Revise *(new version)* · Mark Accepted · Mark Rejected |
| accepted | **Convert to Load** · View Load |
| rejected / expired | Duplicate · Revise |
| converted | View Load *(read-only)* |

### Document

| Status | Actions |
|---|---|
| requested | Upload · Cancel Request · Remind |
| uploaded | Preview · Download · Submit for Review · Replace · Delete |
| under_review | Verify · Reject *(reason)* · Request Correction |
| verified | Preview · Download · Upload New Version · Archive |
| rejected | Upload Corrected Version · View Reason |
| expiring / expired | Upload Renewal · Acknowledge |
| superseded / archived | Preview · Download · View Version History |

### Carrier

| Status | Actions |
|---|---|
| conditional | Refresh FMCSA · Record Compliance Review · Approve · Reject · Add Document |
| approved | Refresh FMCSA · Record Review · Suspend · Add Driver · View Loads |
| suspended | Reinstate *(review required)* · View History |
| rejected | Reopen *(`org_admin`, reason)* |

---

## 9. Required-action engine

The right rail on every detail page. One pure resolver per record type:

```ts
// src/lib/workflow/required-action.ts — no Next/Supabase imports
export interface RequiredAction {
  stage: string;              // "Awaiting carrier signature"
  next: string;               // "Carrier must sign RC-2048"
  owner: 'broker' | 'carrier' | 'driver' | 'customer' | 'finance';
  ownerName?: string;
  dueAt?: string;
  blockers: Blocker[];        // hard stops
  warnings: Blocker[];        // soft
  cta?: { label: string; action: string; enabled: boolean; reason?: string };
}
export interface Blocker {
  code: string;               // stable, testable
  message: string;
  severity: 'blocking' | 'warning';
  fixHref?: string;           // deep link to the tab that fixes it
}
```

Blocker codes to implement first (each maps to a real rule already in the code
or named in brief §18):

| Code | Message | Blocks |
|---|---|---|
| `RFQ_FREIGHT_INCOMPLETE` | Weight and class required before pricing | create quote |
| `QUOTE_OVERRIDE_PENDING` | Pricing override awaiting manager approval | send quote |
| `QUOTE_EXPIRED` | Quote expired {date} | convert to load |
| `QUOTE_NOT_ACCEPTED` | Customer has not accepted this quote | convert to load |
| `CARRIER_NOT_ASSIGNED` | No carrier assigned | send rate confirmation |
| `CARRIER_NOT_COMPLIANT` | {carrier} fails compliance: {reasons} | assign (override: `org_admin`) |
| `CARRIER_SUSPENDED` | Carrier is suspended | assign — **no override** |
| `RATECON_NOT_SIGNED` | Rate confirmation not signed | release to driver — **no override** |
| `DRIVER_NOT_ASSIGNED` | No driver assigned | release to driver |
| `STOPS_INCOMPLETE` | Pickup or delivery address missing | dispatch |
| `APPOINTMENT_MISSING` | Delivery appointment required by customer | mark delivered |
| `RECEIVER_UNCONFIRMED` | Receiver name required at delivery | mark delivered |
| `POD_MISSING` | Proof of delivery not uploaded | create invoice |
| `POD_UNVERIFIED` | POD uploaded but not verified | create invoice |
| `BILLING_DATA_MISSING` | Customer billing email / terms missing | create invoice |
| `CARRIER_INVOICE_MISSING` | Carrier invoice not on file | approve settlement |
| `INSURANCE_EXPIRING` | {carrier} insurance expires in {n} days | *(warning)* |
| `INSURANCE_EXPIRED` | {carrier} insurance expired {date} | release, dispatch |
| `OPEN_EXCEPTIONS` | {n} document or financial exceptions open | close load |

**Two override tiers, and the distinction is the point:**

- **Overrideable** (`⚖︎`, reason mandatory, audited): compliance failure at
  *booking* time. Already implemented for `createLoadFromQuote`.
- **Non-overridable** (hard): unsigned rate confirmation at *release*, and
  compliance failure at *release*. CLAUDE.md M4 records that this was verified
  independently — a booking-time override deliberately does **not** carry
  forward. Do not add an override path here; that is the safety property.

---

## 10. Timeline & audit

`audit_log` exists (0003) and `writeAudit()` is the established pattern. Two
things are missing.

**AUD-01 (High).** No audit UI. `/portal/audit` is a dead nav link and
`AUDIT_VIEW` is granted to three roles who cannot use it.

**AUD-02 (High).** Timeline ≠ audit log. The audit log is the legal record;
the timeline is the operational story. Build the timeline as a **union view**
over: `audit_log`, `milestones`, `documents` (created/verified),
`rate_confirmations` (sent), `signatures` (signed), `invoices`, `settlements`.

```sql
create or replace view load_timeline with (security_invoker = true) as
  select load_id, occurred_at, 'milestone' as source, kind as event, note as detail, recorded_by as actor from milestones
  union all
  select load_id, created_at, 'document', 'document.'||doc_type, name, uploaded_by from documents where load_id is not null
  union all
  select entity_id::uuid, created_at, 'audit', action, null, actor_user_id from audit_log where entity_type = 'load'
  -- … ratecons, signatures, invoices, settlements
;
```

> `security_invoker = true` is **mandatory** on every new view. Omitting it on
> the `loads` view is the exact bug 0006 was written to fix.

Every event renders: timestamp · actor · action · before → after · source ·
reason · related record link. The audit log is append-only — no UPDATE or DELETE
policy exists on `audit_log` and none should be added.

---

## 11. Role & permission matrix (surface changes)

Existing permissions cover most of this. Additions needed:

| New permission | Roles | Why |
|---|---|---|
| `CUSTOMER_VIEW` / `CUSTOMER_MANAGE` | org_admin, broker_manager, broker_dispatcher (view only) | new Customers module |
| `DOCUMENT_VERIFY` | org_admin, broker_manager | POD/COI verification is a control, not an upload |
| `QUOTE_SEND` | org_admin, broker_manager, broker_dispatcher | separates "price it" from "commit it to the customer" |
| `LOAD_CANCEL` | org_admin, broker_manager | cancellation must not be a dispatcher action |
| `DRIVER_ASSIGN` | org_admin, broker_manager, broker_dispatcher | today implied by `LOAD_EDIT` |

**RBAC-01 (High).** `INVOICE_CREATE` and `SETTLEMENT_CREATE` are granted but no
route consumes them; `AUDIT_VIEW` likewise. Permissions that grant nothing are a
liability — a reviewer assumes the capability is protected when it is absent.

**RBAC-02 (Critical, standing).** Per CLAUDE.md #3, `quotes` RLS is one org-wide
`FOR ALL` policy. Every new pricing surface (quote list, quote detail, revisions,
approvals) **must** call `requirePermission()` in its own server action. RLS will
not catch a missing check. Add a test per new action asserting a dispatcher is
refused `PRICING_OVERRIDE_APPROVE`.

**RBAC-03 (High).** `evaluateApproval()`'s approver ≠ requester rule must be
re-applied to any new approval flow (document verification, cancellation,
settlement approval). Reuse the function; do not reimplement.

---

## 12. Form & validation matrix

Selected high-risk rules. Full field dictionary in §13.

| Form | Rule | Enforced where | Severity |
|---|---|---|---|
| RFQ create | origin, destination, service_type required | action + DB NOT NULL | ✅ exists |
| RFQ create | customer required *(new)* | action | High |
| RFQ create | pickup_at ≥ today | action | Medium |
| RFQ freight | `freight_class` ∈ NMFC 18 valid classes | 0010 CHECK ✅ | ✅ |
| RFQ freight | weight required before quoting | new resolver | High |
| Quote | `margin_percent` < 1 | `computePricing` ✅ | ✅ |
| Quote | below floor ⇒ `is_override`, reason required | `pricing/override.ts` ✅ | ✅ |
| Quote approval | approver ≠ requester | `evaluateApproval()` ✅ | ✅ |
| Quote → Load | quote must be `accepted` and not expired | **missing** | High |
| Load create | carrier compliant or `org_admin` override + reason | `compliance/gate.ts` ✅ | ✅ |
| Load stops | ≥1 pickup and ≥1 delivery | new | High |
| Load stops | `sequence` unique per load, contiguous | DB unique + action | Medium |
| Mark delivered | delivery timestamp + receiver name | new | High |
| Release to driver | signed RC + carrier compliant | `loads/actions.ts` ✅ hard | ✅ |
| Document upload | ≤ 4MB (Vercel body limit) | ✅ exists | ✅ |
| Document verify | verifier ≠ uploader | new, reuse `evaluateApproval` | Medium |
| Invoice create | `evaluateInvoiceEligibility()` passes | logic ✅, **no caller** | High |
| Close load | no open document/financial exceptions | new | Medium |
| Money everywhere | integer cents, never float | convention ✅ | ✅ |

**VAL-01 (High).** All validation currently lives in server actions returning
`ActionResult`. There is **no client-side validation and no unsaved-change
warning** — `ActionForm`/`SubmitButton` post and hope. For multi-section record
forms this is a real usability failure; a 20-field stop editor must not lose data
to a round-trip rejection.

**VAL-02 (Medium).** "Freight sufficient to price" is not defined anywhere.
Define it once as a pure predicate (`isQuotableFreight(rfq)`) and use it in the
RFQ right rail, the create-quote button's enabled state, and `createQuote`'s
server-side guard.

---

## 13. Field dictionary (new & changed fields)

Existing columns are documented in the migrations; this covers what to add.
Type · Req · Default · Owner · Editable-by · Editable-when · Source marker.

### `loads_data` additions

| Field | Type | Req | Default | Editable by | When | Marker |
|---|---|---|---|---|---|---|
| `booking_status` | text enum | yes | `unassigned` | system | on carrier assign | ✎ system |
| `ratecon_status` | text enum | yes | `none` | system | ratecon actions only | ✎ system |
| `dispatch_status` | text enum | yes | `not_ready` | system | release/ack | ✎ system |
| `tracking_status` | text enum | yes | `not_started` | system | milestones | ✎ system |
| `billing_status` | text enum | yes | `not_ready` | system | invoice actions | ✎ system |
| `carrier_pay_status` | text enum | yes | `not_ready` | system | settlement actions | ✎ system |
| `assigned_broker_id` | uuid | no | creator | manager | any pre-close | ✎ |
| `assigned_dispatcher_id` | uuid | no | creator | manager | any pre-close | ✎ |
| `cancelled_at` / `cancelled_by` / `cancel_reason` | tstz/uuid/text | no | null | `LOAD_CANCEL` | pre-invoice | ⚖︎ |
| `packaging_type`…`freight_class` | *(mirror of 0010 RFQ block)* | no | from RFQ | dispatcher | ≤ `booked` | 📌 then ✎ |
| `equipment_type` | text enum `van｜reefer｜flatbed｜stepdeck｜container｜other` | no | from RFQ | dispatcher | ≤ `booked` | ✎ |
| `temperature_min_f` / `max_f` | int | cond. | null | dispatcher | ≤ `booked` | ✎ — **required when `equipment_type='reefer'`** |
| `updated_at` | tstz | yes | now() | trigger | always | ✎ system |

### `quotes` additions

| Field | Type | Req | Notes |
|---|---|---|---|
| `reference` | text | yes | QT-####, unique per org — mirror `loads/reference.ts` retry loop + unique index (see 0005/0007) |
| `version` | int | yes | default 1; revision = new row |
| `supersedes_quote_id` | uuid | no | FK self |
| `valid_until` | date | no | drives `expired` |
| `sent_at` / `viewed_at` / `accepted_at` / `rejected_at` | tstz | no | commercial lifecycle |
| `rejection_reason` | text | no | required when rejected |
| `terms` | text | no | from policy default |

### `rfqs` additions

`commercial_status` (text enum), `expires_at` (tstz), `assigned_broker_id` (uuid),
`priority` (text `standard｜urgent｜hot`), `customer_reference` (text — the
customer's own PO/shipment number, searchable).

### Conditional-field rules (progressive disclosure)

| Trigger | Reveals | Required? |
|---|---|---|
| `equipment_type = reefer` | temperature range, continuous/cycle | yes |
| `equipment_type = flatbed｜stepdeck` | tarps, straps, oversize dims | oversize only if > legal |
| `service_type = drayage` | container #, chassis, port, LFD, per-diem | container # yes |
| `service_type = warehousing` | storage dates, pallet positions | yes |
| freight class entered | NMFC code | recommended (garbage-check already in 0010 work) |
| stop has `appointment_required` | appointment window | yes |
| `is_override` on quote | override reason | yes |
| carrier fails gate | override reason | yes, `org_admin` only |
| document rejected | rejection reason | yes |

---

## 14. Record relationship map

```
organizations ─┬─ memberships ─ users
               ├─ shippers (CUSTOMER) ─┬─ customer_contacts
               │                       ├─ customer_locations
               │                       └─ rfqs ─┬─ quotes ─┐
               │                                └─ loads ←─┘ (rfq_id, quote-derived snapshot)
               └─ carriers ─┬─ carrier_compliance (append-only, latest wins)
                            ├─ drivers ─ loads.driver_id
                            └─ loads.carrier_id

loads_data ─┬─ load_stops            (NEW — source of truth for lane)
            ├─ rate_confirmations ─ signatures
            ├─ milestones
            ├─ documents  ─ (also carrier_id for COI)
            ├─ accessorials
            ├─ invoices
            └─ settlements

audit_log ─ (entity_type, entity_id) → any of the above
```

**Cardinality rules that must be enforced:**

- RFQ 1—N quotes; only **one** quote may be `accepted` per RFQ (partial unique
  index `where status = 'accepted'`).
- Quote 1—0..1 load. `loads.rfq_id` exists; **add `loads.quote_id`** — today the
  link is only quote→load, so from a load you cannot find the quote that priced
  it without a reverse scan. (REL-01, High.)
- Load 1—N rate confirmations, but only one non-`superseded` at a time.
- Load 1—0..1 invoice in Phase 1 (no partial billing).
- Document belongs to exactly one of load / carrier / customer — add a CHECK.

---

## 15. RFQ → Load conversion flow (canonical)

```
RFQ (open)
  └─ createQuote ─────────────► quote v1 (draft)
       │                          │
       │ margin < floor?          ├─ yes ─► pending_approval ─► approveOverride
       │                          │            (approver ≠ requester, audited)
       │                          └─ no ──► approved
       ▼
     sendQuote ──────────────► quote (sent) + RFQ.commercial_status = sent
       │
       ├─ customer negotiates ─► createQuote(supersedes v1) ─► v2 …
       ├─ customer rejects ────► quote rejected, RFQ closed
       ├─ valid_until passes ──► quote expired  (scheduled job or lazy on read)
       └─ customer accepts ────► acceptQuote ─► quote accepted
                                     │
                                     ▼
                              createLoadFromQuote
     PRECONDITIONS (all server-side, all audited on failure):
       · quote.status = 'accepted'                        ← NEW
       · quote not expired                                ← NEW
       · no other accepted quote on this RFQ              ← NEW
       · carrier compliant  OR  org_admin override+reason ← exists ✅
       · RFQ has quotable freight                         ← NEW (isQuotableFreight)
     EFFECTS (single transaction where possible):
       · loads_data row, reference LD-#### (retry loop, unique idx 0005) ✅
       · commercial_snapshot ← quote.pricing_snapshot (📌 verbatim) ✅
       · freight block ← RFQ 0010 columns (📌)                        ← NEW
       · load_stops seeded from RFQ origin/destination + customer locations ← NEW
       · quote.status → 'converted', quote.load_id set ✅
       · rfqs.status open→quoted→booked (guarded .eq('status', from)) ✅
       · audit: load.created, quote.converted
                                     ▼
                              Load (booked)
```

The three preconditions marked NEW are the substance of Gap G-01. Everything else
already works.

---

## 16. Related-record navigation rules

1. Every foreign key rendered in the UI is a link. No exceptions.
2. Links open the **record**, not a filtered list. `LD-1045` → `/portal/loads/[id]`,
   never `/portal/loads?q=LD-1045`. (Three places today do the wrong thing:
   [rfqs/[id]/page.tsx:245](src/app/portal/rfqs/[id]/page.tsx#L245) and
   [quotes/[id]/page.tsx:175](src/app/portal/quotes/[id]/page.tsx#L175) both link
   a specific load reference to the bare `/portal/loads` list.)
3. Breadcrumbs reflect the path taken: `Customers / Summit Retail / Loads / LD-1045`
   when arriving from the customer, `Loads / LD-1045` when arriving from the list.
4. Related-record panels show count + status, not just a name.
5. Deep links into tabs: `/portal/loads/[id]?tab=documents` — required so a
   blocker's `fixHref` can point at the exact place the problem is fixed.
6. Back-navigation preserves list filters (filters live in the URL).

---

## 17. UX requirements

| # | Requirement | Current state |
|---|---|---|
| UX-01 | Clickable rows everywhere | ❌ only RFQs |
| UX-02 | Breadcrumbs | ❌ ad-hoc "← Back to RFQs" text link |
| UX-03 | Consistent detail layout | ⚠ one page, no shared component |
| UX-04 | Sticky header + action bar | ❌ |
| UX-05 | Status badges — one color system across all facets | ⚠ per-page `badgeClass` helpers duplicated in 4 files |
| UX-06 | Progress indicator | ⚠ `RfqTimeline` exists on RFQ only — extract as shared `<LifecycleTimeline>` |
| UX-07 | Missing-info warnings | ❌ |
| UX-08 | Unsaved-change warning | ❌ |
| UX-09 | Confirm dialogs on destructive/irreversible actions | ❌ — send ratecon, release to driver, cancel, void all fire immediately |
| UX-10 | Tooltips on logistics terms (NMFC, TONU, accessorial, LFD, detention) | ❌ |
| UX-11 | Empty states with the next action | ⚠ "No quotes yet." with no CTA |
| UX-12 | Role-based buttons with disabled+reason, not hidden | ⚠ mixed |
| UX-13 | Responsive / mobile | ⚠ dispatcher and driver screens are used in the field — driver brief must be mobile-first |
| UX-14 | Accessible labels, focus order, keyboard nav on tabs | unverified |
| UX-15 | Progressive disclosure per §13 conditional rules | ❌ |

**UX-05 concretely:** `loadBadgeClass`, `quoteBadgeClass`, and equivalents in the
carriers and ratecons pages each invent their own mapping. Extract
`src/app/portal/_components/status-badge.tsx` with one `Record<facet, Record<value, tone>>`
map. A dispatcher must be able to read color the same way on every screen.

---

## 18. Developer implementation plan

Sequenced so each step is independently shippable and each ends at the
CLAUDE.md definition of done (offline tests · typecheck · build · `verify:rls` ·
migration applied · FR-tagged test).

### Phase A — stop the bleeding (1–2 days) · **Critical**

| Task | Files | Notes |
|---|---|---|
| A1 | Remove or stub the three 404 nav links | `portal-nav.tsx` | one-line fix, do it today |
| A2 | Shared `<StatusBadge>`, `<LifecycleTimeline>`, `<Breadcrumb>` | `_components/` | extracted from existing RFQ page |
| A3 | Fix load links that point at the list | `rfqs/[id]`, `quotes/[id]` | blocked on B1 |

### Phase B — the record-detail spine (1–2 weeks) · **Critical**

| Task | Deliverable |
|---|---|
| B1 | `/portal/loads/[id]` — Overview, Carrier, Rate Confirmation, Documents, Timeline tabs. Move the inline forms out of the list. |
| B2 | `<RecordDetailShell>` — header, sticky action bar, tabs, right rail. Every later detail page uses it. |
| B3 | `src/lib/workflow/required-action.ts` + `actions-available.ts` — **pure**, no Next/Supabase, blocker codes from §9, one test per code. Add to `test:offline` list (CLAUDE.md #7). |
| B4 | `/portal/carriers/[id]` and `/portal/documents/[id]` on the same shell |
| B5 | `/portal/quotes` list; make every list row clickable per §6 |

### Phase C — model corrections (1–2 weeks) · **High**

| Task | Migration | Risk |
|---|---|---|
| C1 | Status facet columns + backfill + recreate `loads` view **with `security_invoker`** + relax CHECK | `0011_load_status_facets.sql` | **highest-risk migration in the plan** — 0006's leak is the precedent. Re-run `verify:rls` before and after. |
| C2 | `load_stops` + backfill from `origin`/`destination` text | `0012_load_stops.sql` | keep denormalized columns |
| C3 | Document lifecycle columns + `required_documents` policy | `0013_document_lifecycle.sql` | |
| C4 | Customers: `shippers` expansion + contacts + locations + RLS + `verify-rls` coverage | `0014_customers.sql` | |
| C5 | Quote lifecycle: reference, version, valid_until, accept/reject | `0015_quote_lifecycle.sql` | |
| C6 | `loads.quote_id`, `updated_at` trigger, partial unique on accepted quote | `0016_relationships.sql` | |

### Phase D — close the workflow gaps (1–2 weeks) · **High**

D1 driver assignment UI · D2 `acceptQuote`/`sendQuote`/`rejectQuote` +
conversion preconditions · D3 document verify/reject/version · D4 load
cancellation · D5 `/portal/audit` + `load_timeline` view · D6 `/portal/approvals`
consolidating pricing + compliance overrides.

### Phase E — M6 finance (per existing milestone plan) · **Medium**

E1 `/portal/invoices` + `createInvoice` wired to the already-tested
`evaluateInvoiceEligibility()` · E2 `/portal/settlements` (packet only —
`submit()` keeps throwing) · E3 margin reporting & export.

### Phase F — M7 polish · **Low–Medium**

Dispatch board, reports, saved views, mobile driver views, tooltips,
accessibility audit, marketing site.

### Cross-cutting rules for every phase

1. New pure logic goes in `src/lib/**` with **no Next/Supabase imports** and a
   test naming its FR ID; add the file to `package.json`'s `test:offline` list or
   it silently never runs.
2. No TS enums / decorators / namespaces anywhere reachable from a test — the
   offline runner strips types (`--experimental-strip-types`). Use `as const`.
3. Every new server action follows the M3 pattern: `requireUser()` → active org →
   `requirePermission()` → RLS-bound client → mutate → `writeAudit()` →
   `revalidatePath()`.
4. Every new view carries `with (security_invoker = true)`.
5. Every new table gets RLS, `force row level security`, and a line in
   `verify-rls.mjs`.
6. Money stays integer cents; percents stay decimals in [0,1).

---

## 19. Recommendation register

| ID | Issue | Correction | Business reason | Modules | Data | UI | Backend | Migration | Pri |
|---|---|---|---|---|---|---|---|---|---|
| NAV-01 | 3 nav links 404 | remove/build | credibility | nav | none | trivial | none | no | **Critical** |
| LST-01 | lists are terminal | detail pages | can't work a record | all | none | large | routes | no | **Critical** |
| LD-01 | no driver assignment UI | assignment form | driver flow unreachable | loads | none | small | action | no | **Critical** |
| CUS-01 | no customer module | build it | "enter once" impossible | all | new tables | large | actions+RLS | 0014 | **Critical** |
| STAT-01 | one enum, six concerns | status facets | can't express real state | loads+ | new cols | medium | state machine | 0011 | **Critical** |
| FLD-03 | no stop model | `load_stops` | no multi-stop, no appointments | loads | new table | medium | actions | 0012 | **Critical** |
| DOC-01 | no doc lifecycle | status+version+expiry | POD/COI controls | docs, compliance, finance | new cols | medium | actions | 0013 | **High** |
| G-01 | no quote acceptance | quote commercial lifecycle | converting unaccepted quotes | quotes, loads | new cols | medium | actions | 0015 | **High** |
| FLD-01 | no field provenance | `<Field source>` | wrong-number invoicing | all | none | medium | none | no | **High** |
| FLD-02 | freight not carried to load | snapshot at creation | dispatcher can't see the freight | rfq, loads | new cols | small | action | 0011 | **High** |
| REL-01 | no `loads.quote_id` | add FK | can't trace pricing from a load | loads, quotes | new col | small | queries | 0016 | **High** |
| AUD-01 | no audit UI | `/portal/audit` | `AUDIT_VIEW` grants nothing | audit | none | small | query | no | **High** |
| AUD-02 | no timeline | union view | no operational story | all | view | medium | view | 0016 | **High** |
| RBAC-01 | permissions with no surface | build or drop | false sense of control | rbac | none | — | — | no | **High** |
| VAL-01 | no client validation / unsaved warning | form layer | data loss on long forms | all | none | medium | none | no | **High** |
| LST-02/03 | forms embedded in lists | move to detail | blocks filtering & paging | loads, carriers, ratecons | none | medium | none | no | **High** |
| NAV-03 | pricing tool ≠ approval queue | split | approvals are work | pricing | none | medium | routes | no | **High** |
| CAR-01 | no carrier detail | build it | compliance history unreadable | carriers | none | medium | queries | no | **High** |
| STAT-02 | two carrier statuses, unexplained | label + eligibility table | users misread assignability | carriers, loads | none | small | none | no | **Medium** |
| CAR-02 | insurance expiry invisible | warning chips | dispatch on expired insurance | carriers, loads | none | small | query | no | **Medium** |
| LD-02 | no cancellation | `cancelled` + reason | real loads fall through | loads | enum | small | action | 0011 | **Medium** |
| QTE-02 | no quote versions | version rows | negotiation history lost | quotes | new cols | medium | actions | 0015 | **Medium** |
| UX-05 | duplicated badge maps | shared component | inconsistent color = misread | all | none | small | none | no | **Medium** |
| UX-09 | no confirm dialogs | add on irreversible | accidental release/send | all | none | small | none | no | **Medium** |
| NAV-04/05/06 | function-named modules | record-named nav | navigate by record | nav | none | small | none | no | **Medium** |
| UX-10/15 | no tooltips, no progressive disclosure | add | new dispatchers guess | all | none | medium | none | no | **Low** |

---

## 20. What this document deliberately does not do

- **No money movement, no real e-signature, no SMS.** Settlement `submit()` keeps
  throwing; tracking and load-board adapters keep throwing. Where the brief asks
  for Payments and a Load Board, the recommendation is a *record* of a payment and
  a *placeholder*, clearly labelled Phase 2 in the UI.
- **No relaxing of RLS to make a UI easier.** The COI-on-carrier case (§7.4) is
  the live example: fix `documents_select` properly or leave COI out.
- **No new status enum values on `loads` without the facet migration.** Adding
  another value to the linear enum is how the current problem was created.
