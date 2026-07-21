-- =============================================================================
-- 0010_rfq_freight_details.sql — Structured freight-detail fields on RFQs
-- (FR-RFQ-03). A carrier can't price a shipment off `freight_details`'s free
-- text alone — this adds packaging, piece/package counts, weight,
-- dimensions, and (domestic LTL/trucking) NMFC code + freight class,
-- alongside the existing free-text field, which is kept as-is.
--
-- Dimensions share ONE unit column, not three independent ones — a package's
-- length/width/height are always entered in the same unit together in
-- practice. Freight class is a fixed 18-value NMFC density scale (50, 55,
-- 60, ..., 500), not a continuous range.
--
-- length_value/width_value/height_value are each independently nullable BY
-- DESIGN, not an oversight: a broker may know only one dimension so far
-- (e.g. "it's about 96 inches long, exact W/H pending"). Requiring all
-- three together would block that legitimate partial-entry case, so no
-- all-or-nothing constraint is enforced here — the UI (new-rfq-modal.tsx)
-- and detail display (rfqs/[id]/page.tsx's formatDimensions) both handle a
-- partial fill explicitly rather than treating it as invalid.
-- =============================================================================

alter table rfqs
  add column packaging_type      text check (packaging_type in ('pallet','crate','box','drum','tote')),
  add column piece_count         integer check (piece_count is null or piece_count >= 0),
  add column package_count       integer check (package_count is null or package_count >= 0),
  add column gross_weight_value  numeric check (gross_weight_value is null or gross_weight_value >= 0),
  add column gross_weight_unit   text not null default 'lb' check (gross_weight_unit in ('lb','kg')),
  add column length_value        numeric check (length_value is null or length_value >= 0),
  add column width_value         numeric check (width_value is null or width_value >= 0),
  add column height_value        numeric check (height_value is null or height_value >= 0),
  add column dimension_unit      text not null default 'in' check (dimension_unit in ('in','cm')),
  add column nmfc_code           text,
  add column freight_class       numeric(5,1) check (
    freight_class is null or freight_class in (
      50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500
    )
  );
