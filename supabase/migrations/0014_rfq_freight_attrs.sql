-- =============================================================================
-- 0014_rfq_freight_attrs.sql — Equipment/trailer type + commodity on RFQs.
--
-- Two demand-side attributes the RFQ lacked:
--   equipment_type — the trailer the freight needs (dry van, reefer, flatbed…).
--                    CHECK mirrors EQUIPMENT_TYPES in src/lib/rfqs/equipment.ts
--                    (that module is the TS source of truth; this is the guard).
--   commodity      — what is actually being hauled ("frozen poultry", "steel
--                    coils"). Distinct from the free-text `freight_details`
--                    handling notes, and what drives equipment choice.
--
-- Both nullable (existing RFQs predate them) and set on the RFQ detail page
-- (rfqs/[id]). RLS unchanged — the existing rfqs policies cover the columns.
-- =============================================================================

alter table rfqs
  add column equipment_type text
    check (equipment_type is null or equipment_type in
      ('dry_van','reefer','flatbed','step_deck','double_drop',
       'conestoga','rgn','dry_bulk_tanker','liquid_tanker')),
  add column commodity text;
