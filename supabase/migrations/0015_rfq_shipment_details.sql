-- =============================================================================
-- 0015_rfq_shipment_details.sql — Shipment-type-driven RFQ (FR-RFQ-04).
--
-- Adds the FTL / LTL / PTL axis and the structured fields each type needs, on
-- top of the flat freight-detail columns 0010 added and the equipment_type +
-- commodity columns 0014_rfq_freight_attrs already added (this migration does
-- NOT re-add those two — it builds on them). Guiding decisions:
--
--  * `shipment_type` is a NEW axis, orthogonal to `service_type`
--    (trucking/drayage/...) and to `equipment_type` (the trailer). NULLABLE:
--    RFQs created before this migration have no type, and the UI renders them
--    from their existing free-text origin/destination + 0010/0014 columns.
--
--  * Structured Ship From / Ship To addresses are ADDED, but the existing
--    `origin`/`destination` text columns are KEPT and populated by the server
--    with a "City, ST" display string, so every current reader (rfqs list,
--    detail, ratecons, loads, PDF) keeps working with no change.
--
--  * Column REUSE (no duplicate-meaning fields):
--      - FTL total weight / PTL weight  -> gross_weight_value (+ _unit)   [0010]
--      - PTL L/W/H                       -> length/width/height_value       [0010]
--      - FTL equipment                   -> equipment_type                  [0014]
--      - commodity (all types)           -> commodity                      [0014]
--    LTL freight is per-handling-unit, so it lives in the child table below.
--
--  * LTL handling units go in a child table `rfq_handling_units` (many per
--    RFQ) rather than JSONB — same "columns + check constraints, migrations
--    reproduce the DB" convention as 0010, so CI's throwaway-Postgres job
--    validates the per-unit constraints. Units are stored in INCHES + LB with
--    no unit selector, on purpose: the density -> NMFC freight-class calc is
--    only well-defined in consistent units (see freight-detail.ts
--    freightClassFromDensity).
--
--  * "Accessorials" here are REQUEST-TIME service flags (liftgate,
--    residential, ...), stored as booleans. They are unrelated to the
--    `accessorials` table (0009), which records billable charges
--    (detention/lumper/TONU) on a load. Kept deliberately separate.
-- =============================================================================

alter table rfqs
  add column shipment_type       text check (shipment_type in ('ftl','ltl','ptl')),

  -- Ship From (origin / shipper). city/state/zip are what rate a lane and are
  -- required by the app layer; name/address are optional at RFQ stage.
  add column ship_from_name       text,
  add column ship_from_address    text,
  add column ship_from_city       text,
  add column ship_from_state      text,
  add column ship_from_zip        text,
  -- Ship To (destination / consignee).
  add column ship_to_name         text,
  add column ship_to_address      text,
  add column ship_to_city         text,
  add column ship_to_state        text,
  add column ship_to_zip          text,

  add column reference_number     text,   -- shipper reference / PO (optional)

  -- Dates. pickup_at (0001) stays the pickup date/time; the window is a
  -- time-of-day appointment range on the pickup day; delivery_at is optional
  -- (a quote may just be "standard transit").
  add column pickup_window_start  time,
  add column pickup_window_end    time,
  add column delivery_at          timestamptz,

  -- Request-time accessorial service flags (NOT the 0009 billing table).
  add column acc_liftgate         boolean not null default false,
  add column acc_residential      boolean not null default false,
  add column acc_inside_pickup    boolean not null default false,
  add column acc_inside_delivery  boolean not null default false,
  add column acc_limited_access   boolean not null default false,

  -- Hazmat. un_number/hazmat_class required (app layer) only when is_hazmat.
  add column is_hazmat            boolean not null default false,
  add column un_number            text,
  add column hazmat_class         text check (hazmat_class is null or hazmat_class in ('1','2','3','4','5','6','7','8','9')),

  -- FTL. temperature_f is meaningful only for reefer (enforced app-side).
  add column temperature_f        numeric,
  add column trailer_size         text check (trailer_size in ('48','53')),

  -- Shared by FTL/PTL (LTL carries these per handling unit instead).
  add column pallet_count         integer check (pallet_count is null or pallet_count >= 0),
  add column stackable            boolean not null default false,

  -- PTL. Dimensions/weight reuse the 0010 single-value columns; linear feet is
  -- the PTL pricing basis, freight_description is the PTL commodity detail.
  add column linear_feet          numeric check (linear_feet is null or linear_feet >= 0),
  add column freight_description   text;

-- ------------------------------------------------------- rfq_handling_units --
-- LTL line items: one row per handling unit on the RFQ. Fixed to inches + lb
-- (no unit column) so density -> class is well-defined. freight_class is the
-- final value used (auto-calculated from density OR a manual override);
-- freight_class_is_override records which, so the calc isn't silently lost.
create table rfq_handling_units (
  id                       uuid primary key default gen_random_uuid(),
  rfq_id                   uuid not null references rfqs(id) on delete cascade,
  -- Denormalized from the parent RFQ so the broker-org RLS write check is a
  -- simple column test (same shape as every other table's policy).
  org_id                   uuid not null references organizations(id) on delete cascade,
  position                 integer not null default 0,   -- display order
  length_in                numeric not null check (length_in > 0),
  width_in                 numeric not null check (width_in > 0),
  height_in                numeric not null check (height_in > 0),
  weight_lb                numeric not null check (weight_lb > 0),
  unit_count               integer not null check (unit_count > 0),
  packaging_type           text not null check (packaging_type in ('pallet','crate','box','drum','tote')),
  freight_class            numeric(5,1) not null check (
    freight_class in (
      50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500
    )
  ),
  freight_class_is_override boolean not null default false,
  nmfc_code                text,
  stackable                boolean not null default false,
  created_at               timestamptz not null default now()
);
create index rfq_handling_units_rfq_idx on rfq_handling_units(rfq_id);
create index rfq_handling_units_org_idx on rfq_handling_units(org_id);

alter table rfq_handling_units enable row level security;
alter table rfq_handling_units force row level security;

-- Mirrors rfqs' own policies exactly: a shipper can SELECT the units of an RFQ
-- they can access (via the parent's shipper carve-out); only broker-org
-- members can write. A shipper submitting their OWN RFQ writes through the
-- service-role client (bypasses RLS), same wall as rfqs_write and the
-- createRfq shipper branch already handle.
create policy rfq_handling_units_select on rfq_handling_units for select
  using (
    exists (
      select 1 from rfqs r
      where r.id = rfq_handling_units.rfq_id
        and (app_is_member(r.org_id) or app_shipper_user_can_access(r.shipper_id))
    )
  );
create policy rfq_handling_units_write on rfq_handling_units for all
  using (app_is_member(org_id)) with check (app_is_member(org_id));
