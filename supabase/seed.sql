-- =============================================================================
-- seed.sql — Deterministic demo data (fixed UUIDs, reproducible IDs).
--
-- Requirement coverage:
--   FR-SEED-01  Stable demo IDs + realistic data for repeatable demonstrations
--               and tests (Delivery Plan implementation guardrail).
--
-- Personas: broker owner/manager/dispatcher (M.C. Global), carrier dispatch +
-- driver (Horizon Freight), shipper (Summit Retail), and a SEPARATE rival
-- broker org used only to prove tenant isolation.
--
-- NOTE: user_id values correspond to Supabase auth.users ids. On a real
-- Supabase project, create these auth users (same UUIDs) via the Auth admin
-- API / dashboard; scripts/seed.mjs prints the mapping.
-- =============================================================================

-- Idempotent-ish: clear demo rows first (safe on a demo DB only).
truncate audit_log, settlements, invoices, milestones, documents, signatures,
         rate_confirmations, quotes, loads_data, rfqs, drivers, carrier_compliance,
         carriers, shippers, policies, memberships, organizations restart identity cascade;

-- Organizations --------------------------------------------------------------
insert into organizations (id, name, org_type, mc_number, dot_number) values
  ('11111111-1111-1111-1111-111111111111','M.C. Global Freight Solutions LLC','broker','MC-111111','DOT-111111'),
  ('22222222-2222-2222-2222-222222222222','Horizon Freight LLC','carrier','MC-222222','DOT-2222220'),
  ('33333333-3333-3333-3333-333333333333','Summit Retail Co.','shipper',null,null),
  ('99999999-9999-9999-9999-999999999999','Rival Brokerage Inc.','broker','MC-999999','DOT-999999');

-- Memberships (role assignments) ---------------------------------------------
insert into memberships (user_id, org_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001','11111111-1111-1111-1111-111111111111','org_admin'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002','11111111-1111-1111-1111-111111111111','broker_manager'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000003','11111111-1111-1111-1111-111111111111','broker_dispatcher'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000004','22222222-2222-2222-2222-222222222222','carrier_dispatch'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000005','22222222-2222-2222-2222-222222222222','driver'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000006','33333333-3333-3333-3333-333333333333','shipper'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000007','99999999-9999-9999-9999-999999999999','org_admin');

-- Configurable policies (FR-CFG-03 / FR-PR-05) -------------------------------
insert into policies (id, org_id, scope, policy_key, version, value) values
  ('cccccccc-0000-0000-0000-000000000001', null,
     'platform','pricing',1,
     '{"target_margin_percent":0.18,"quick_pay_fee_percent":0.05,"factoring_cost_percent":0.03}'),
  ('cccccccc-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
     'organization','pricing',1,
     '{"target_margin_percent":0.18,"quick_pay_fee_percent":0.05,"factoring_cost_percent":0.03}'),
  ('cccccccc-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
     'organization','compliance',1,
     '{"min_auto_liability_cents":100000000,"min_cargo_cents":10000000,"warn_days":[60,30,14,7]}');

-- Shippers -------------------------------------------------------------------
insert into shippers (id, org_id, shipper_org_id, name, margin_band) values
  ('55555555-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333','Summit Retail Co.','standard');

-- Carriers -------------------------------------------------------------------
-- Horizon: compliant/approved. Redline: expired insurance (blocked) — demo/test.
insert into carriers (id, org_id, carrier_org_id, name, dot_number, mc_number, status) values
  ('44444444-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222','Horizon Freight LLC','2222220','MC-222222','approved'),
  ('44444444-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
     null,'Redline Freight','7777790','MC-777779','conditional');

-- Carrier compliance snapshots -----------------------------------------------
insert into carrier_compliance
  (carrier_id, org_id, authority_status, out_of_service, insurance_expiry,
   auto_liability_cents, cargo_cents, required_docs_present, manual_review,
   fmcsa_source, fmcsa_fetched_at) values
  ('44444444-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     'active', false, '2026-12-31', 100000000, 10000000, true, 'approved',
     'mock','2026-07-17T12:00:00Z'),
  -- Redline: expired insurance + not authorized => release BLOCKED (FR-CMP-01)
  ('44444444-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
     'not_authorized', false, '2026-06-01', 100000000, 10000000, false, 'conditional',
     'mock','2026-07-17T12:00:00Z');

-- Drivers --------------------------------------------------------------------
insert into drivers (id, org_id, carrier_id, user_id, name, phone) values
  ('66666666-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '44444444-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-000000000005',
     'Marcus Reyes','+15550100');

-- RFQs -----------------------------------------------------------------------
insert into rfqs (id, org_id, shipper_id, service_type, origin, destination,
                  freight_details, pickup_at, status, created_by) values
  ('77777777-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '55555555-0000-0000-0000-000000000001','trucking','Newark, NJ','Atlanta, GA',
     '18,000 lbs · 26 pallets · 48 × 40 × 48','2026-07-22T14:00:00Z','open',
     'aaaaaaaa-aaaa-aaaa-aaaa-000000000003');

-- Loads ----------------------------------------------------------------------
-- LD-1045: booked to Horizon + driver Marcus. Status shows the signed/awaiting
-- release step so the release-gate demo is ready.
insert into loads_data (id, org_id, rfq_id, shipper_id, carrier_id, driver_id,
                   service_type, reference, origin, destination, status,
                   commercial_snapshot, created_by) values
  ('88888888-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '77777777-0000-0000-0000-000000000001','55555555-0000-0000-0000-000000000001',
     '44444444-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000001',
     'trucking','LD-1045','Newark, NJ','Atlanta, GA','signed_awaiting_broker_release',
     '{"carrier_linehaul_cents":200000,"shipper_price_cents":243902,"margin_amount_cents":43902,"target_margin_percent":0.18}',
     'aaaaaaaa-aaaa-aaaa-aaaa-000000000003');

-- Quote (commercial snapshot) — 18% margin on $2,000 linehaul -----------------
insert into quotes (id, org_id, load_id, rfq_id, carrier_linehaul_cents,
                    shipper_price_cents, margin_amount_cents, margin_percent,
                    target_margin_percent, quick_pay_fee_percent, quick_pay_fee_cents,
                    factoring_cost_percent, pricing_snapshot, created_by) values
  ('aaaa1111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '88888888-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000001',
     200000, 243902, 43902, 0.18000, 0.18000, 0.05000, 10000, 0.03000,
     '{"quick_pay_net_cents":190000,"factoring_advance_cents":194000,"quick_pay_spread_cents":4000}',
     'aaaaaaaa-aaaa-aaaa-aaaa-000000000002');

-- Rate confirmation RC-2048 (signed) -----------------------------------------
insert into rate_confirmations (id, org_id, load_id, carrier_id, reference, version,
                                template_version, status, content_snapshot, content_hash, sent_at) values
  ('bbbb2048-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '88888888-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000001',
     'RC-2048',1,'ratecon-tmpl-v1','signed',
     '{"carrier_rate_cents":200000,"origin":"Newark, NJ","destination":"Atlanta, GA"}',
     'seedhash2048','2026-07-18T09:00:00Z');

-- Signature evidence for RC-2048 (FR-RC-06) ----------------------------------
insert into signatures (org_id, rate_confirmation_id, signer_user_id, signer_name,
                        signer_title, document_version, document_hash,
                        consent_text_version, ip_address, user_agent, signed_at) values
  ('11111111-1111-1111-1111-111111111111','bbbb2048-0000-0000-0000-000000000001',
     'aaaaaaaa-aaaa-aaaa-aaaa-000000000004','Dana Cole','Dispatch Manager',1,
     'seedhash2048','consent-v1','203.0.113.10','Mozilla/5.0 (demo)','2026-07-18T09:05:00Z');
