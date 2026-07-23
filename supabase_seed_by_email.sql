-- =============================================================================
-- supabase_seed_by_email.sql — seed for a LIVE Supabase project.
--
-- Unlike supabase/seed.sql (which hard-codes user IDs for local tests), this
-- version maps memberships to REAL Supabase auth users by email, because
-- Supabase assigns its own UUIDs when you create users.
--
-- BEFORE running this, create these 6 users in Authentication -> Users
-- (any password; you'll log in with them):
--   owner@mcglobalfreightllc.com        -> org_admin        (MC Global)
--   manager@mcglobalfreightllc.com      -> broker_manager   (MC Global)
--   dispatcher@mcglobalfreightllc.com   -> broker_dispatcher(MC Global)
--   dispatch@horizonfreight.example     -> carrier_dispatch (Horizon Freight)
--   driver@horizonfreight.example       -> driver           (Horizon Freight)
--   buyer@summitretail.example          -> shipper          (Summit Retail)
--
-- Then run this whole file in the SQL editor. It is safe to re-run.
-- =============================================================================

-- Fail early if the users are missing.
do $$
declare missing text;
begin
  select string_agg(e, ', ') into missing from (
    select unnest(array[
      'owner@mcglobalfreightllc.com','manager@mcglobalfreightllc.com',
      'dispatcher@mcglobalfreightllc.com','dispatch@horizonfreight.example',
      'driver@horizonfreight.example','buyer@summitretail.example']) e
  ) x where not exists (select 1 from auth.users u where u.email = x.e);
  if missing is not null then
    raise exception 'Create these auth users first: %', missing;
  end if;
end $$;

truncate audit_log, settlements, invoices, milestones, documents, signatures,
         rate_confirmations, quotes, loads_data, rfqs, drivers, carrier_compliance,
         carriers, shippers, policies, memberships, organizations restart identity cascade;

insert into organizations (id, name, org_type, mc_number, dot_number) values
  ('11111111-1111-1111-1111-111111111111','MC Global Freight Solutions LLC','broker','MC-111111','DOT-111111'),
  ('22222222-2222-2222-2222-222222222222','Horizon Freight LLC','carrier','MC-222222','DOT-2222220'),
  ('33333333-3333-3333-3333-333333333333','Summit Retail Co.','shipper',null,null);

-- Memberships mapped to real auth users by email
insert into memberships (user_id, org_id, role)
select u.id, m.org_id, m.role from (values
  ('owner@mcglobalfreightllc.com',      '11111111-1111-1111-1111-111111111111'::uuid, 'org_admin'),
  ('manager@mcglobalfreightllc.com',    '11111111-1111-1111-1111-111111111111'::uuid, 'broker_manager'),
  ('dispatcher@mcglobalfreightllc.com', '11111111-1111-1111-1111-111111111111'::uuid, 'broker_dispatcher'),
  ('dispatch@horizonfreight.example',   '22222222-2222-2222-2222-222222222222'::uuid, 'carrier_dispatch'),
  ('driver@horizonfreight.example',     '22222222-2222-2222-2222-222222222222'::uuid, 'driver'),
  ('buyer@summitretail.example',        '33333333-3333-3333-3333-333333333333'::uuid, 'shipper')
) as m(email, org_id, role)
join auth.users u on u.email = m.email;

insert into policies (id, org_id, scope, policy_key, version, value) values
  ('cccccccc-0000-0000-0000-000000000001', null,'platform','pricing',1,
     '{"target_margin_percent":0.18,"quick_pay_fee_percent":0.05,"factoring_cost_percent":0.03}'),
  ('cccccccc-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','organization','pricing',1,
     '{"target_margin_percent":0.18,"quick_pay_fee_percent":0.05,"factoring_cost_percent":0.03}'),
  ('cccccccc-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','organization','compliance',1,
     '{"min_auto_liability_cents":100000000,"min_cargo_cents":10000000,"warn_days":[60,30,14,7]}');

insert into shippers (id, org_id, shipper_org_id, name, margin_band) values
  ('55555555-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333','Summit Retail Co.','standard');

-- Customer contacts + locations (0012). Children of shippers via FK, so the
-- `truncate ... shippers cascade` above clears them on re-seed. Their presence
-- makes the CUS-01 RLS checks in verify-rls.mjs real (broker sees, driver does not).
insert into customer_contacts (org_id, shipper_id, name, title, email, role, is_primary) values
  ('11111111-1111-1111-1111-111111111111','55555555-0000-0000-0000-000000000001',
     'Dana Cole','Logistics Manager','dana@summitretail.example','operations', true);

insert into customer_locations
  (org_id, shipper_id, label, address_line1, city, state, postal_code, appointment_required) values
  ('11111111-1111-1111-1111-111111111111','55555555-0000-0000-0000-000000000001',
     'Atlanta DC','1200 Fulfillment Way','Atlanta','GA','30336', true);

insert into carriers (id, org_id, carrier_org_id, name, dot_number, mc_number, status) values
  ('44444444-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222','Horizon Freight LLC','2222220','MC-222222','approved'),
  ('44444444-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
     null,'Redline Freight','7777790','MC-777779','conditional');

insert into carrier_compliance
  (carrier_id, org_id, authority_status, out_of_service, insurance_expiry,
   auto_liability_cents, cargo_cents, required_docs_present, manual_review, fmcsa_source, fmcsa_fetched_at) values
  ('44444444-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     'active', false, '2026-12-31', 100000000, 10000000, true, 'approved','mock','2026-07-17T12:00:00Z'),
  ('44444444-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
     'not_authorized', false, '2026-06-01', 100000000, 10000000, false, 'conditional','mock','2026-07-17T12:00:00Z');

insert into drivers (id, org_id, carrier_id, user_id, name, phone)
select '66666666-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
       '44444444-0000-0000-0000-000000000001', u.id, 'Marcus Reyes','+15550100'
from auth.users u where u.email = 'driver@horizonfreight.example';

insert into rfqs (id, org_id, shipper_id, service_type, origin, destination, freight_details, pickup_at, status) values
  ('77777777-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '55555555-0000-0000-0000-000000000001','trucking','Newark, NJ','Atlanta, GA',
     '18,000 lbs · 26 pallets · 48 × 40 × 48','2026-07-22T14:00:00Z','open');

insert into loads_data (id, org_id, rfq_id, shipper_id, carrier_id, driver_id, service_type,
                   reference, origin, destination, status, commercial_snapshot) values
  ('88888888-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '77777777-0000-0000-0000-000000000001','55555555-0000-0000-0000-000000000001',
     '44444444-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000001',
     'trucking','LD-1045','Newark, NJ','Atlanta, GA','signed_awaiting_broker_release',
     '{"carrier_linehaul_cents":200000,"shipper_price_cents":243902,"margin_amount_cents":43902,"target_margin_percent":0.18}');

insert into quotes (id, org_id, load_id, rfq_id, carrier_linehaul_cents, shipper_price_cents,
                    margin_amount_cents, margin_percent, target_margin_percent, quick_pay_fee_percent,
                    quick_pay_fee_cents, factoring_cost_percent, pricing_snapshot) values
  ('aaaa1111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '88888888-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000001',
     200000, 243902, 43902, 0.18000, 0.18000, 0.05000, 10000, 0.03000,
     '{"quick_pay_net_cents":190000,"factoring_advance_cents":194000,"quick_pay_spread_cents":4000}');

insert into rate_confirmations (id, org_id, load_id, carrier_id, reference, version,
                                template_version, status, content_snapshot, content_hash, sent_at) values
  ('bbbb2048-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
     '88888888-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000001',
     'RC-2048',1,'ratecon-tmpl-v1','signed',
     '{"carrier_rate_cents":200000,"origin":"Newark, NJ","destination":"Atlanta, GA"}',
     'seedhash2048','2026-07-18T09:00:00Z');

insert into signatures (org_id, rate_confirmation_id, signer_user_id, signer_name, signer_title,
                        document_version, document_hash, consent_text_version, ip_address, user_agent, signed_at)
select '11111111-1111-1111-1111-111111111111','bbbb2048-0000-0000-0000-000000000001',
       u.id,'Dana Cole','Dispatch Manager',1,'seedhash2048','consent-v1',
       '203.0.113.10','Mozilla/5.0 (demo)','2026-07-18T09:05:00Z'
from auth.users u where u.email = 'dispatch@horizonfreight.example';
