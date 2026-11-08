-- p858_admin_engine — pgTAP checks for 232_admin_engine_slots.sql (Prompt 858):
-- lead intake routes by the agent ID in the ad link (unknown / missing / inactive / out-of-state go to
-- Unassigned), saves once per intake key, folds a repeat phone onto the first lead; admin Assign to…
-- is admin-only and audit-logged; campaign → agent map, ad spend and cost-per numbers are admin-only;
-- the ad spend switches default OFF and the ledger is never fed while billing is off.
--
-- RUN: node scripts/run-sql-tests.mjs supabase/functions/ghl-ad-spend/sql
-- Local PGlite only; one transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p858_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('f8580000-0000-4000-8000-00000000000a'::uuid, 'admin', 'agent'),
    ('f8580000-0000-4000-8000-00000000000b'::uuid, 'agent', 'agent'),
    ('f8580000-0000-4000-8000-00000000000c'::uuid, 'idle',  'agent'),
    ('f8580000-0000-4000-8000-00000000000f'::uuid, 'va',    'fulfillment')
  ) as u(id, n, role);
update public.profiles set role = 'admin', is_active = true where id = 'f8580000-0000-4000-8000-00000000000a';
update public.profiles set is_active = true where id in ('f8580000-0000-4000-8000-00000000000b', 'f8580000-0000-4000-8000-00000000000f');
update public.profiles set is_active = false where id = 'f8580000-0000-4000-8000-00000000000c';
insert into public.agent_lead_settings (agent_id, active, states) values ('f8580000-0000-4000-8000-00000000000b', true, '{TX,OK}')
  on conflict (agent_id) do update set active = true, states = '{TX,OK}';

-- ── a. defaults and grants ──────────────────────────────────────────────────
select is((select ad_spend_enabled from public.ghl_settings), false, 'a1 the ad spend pull defaults OFF');
select is((select ad_spend_bills_agents from public.ghl_settings), false, 'a2 billing agents from spend defaults OFF');
select is((select show_sample_data from public.app_settings limit 1), true, 'a3 Show sample data defaults ON');
select ok(not has_function_privilege('authenticated', 'public.ghl_intake_lead(jsonb)', 'execute'), 'a4 intake is service-role only');
select ok(not has_function_privilege('anon', 'public.ghl_intake_lead(jsonb)', 'execute'), 'a5 anon cannot post a lead');
select ok(has_function_privilege('service_role', 'public.ghl_intake_lead(jsonb)', 'execute'), 'a6 the service role can post a lead');
select ok(not has_function_privilege('authenticated', 'public.ghl_ad_spend_save(jsonb, text, text)', 'execute'), 'a7 spend save is service-role only');
select ok(not has_column_privilege('authenticated', 'public.ghl_settings', 'ad_spend_last_status', 'update'), 'a8 admins cannot fake the spend sync status');
select ok(not has_function_privilege('anon', 'public.admin_assign_lead(uuid, uuid)', 'execute'), 'a9 anon cannot assign');

-- ── b. intake routing ───────────────────────────────────────────────────────
select is(public.ghl_intake_lead('{"intake_key":"k-match-1","agent_id":"f8580000-0000-4000-8000-00000000000b","lead_type":"booked_appointment","meta_option":"form_page","first_name":"Ann","last_name":"One","phone":"(512) 555-8101","state":"tx","campaign_id":"cmp-1"}'::jsonb)->>'routing',
          'matched', 'b1 a known, active agent licensed for the state gets the lead');
select is((select assigned_rep_id from public.leads where phone = '+15125558101'), 'f8580000-0000-4000-8000-00000000000b'::uuid, 'b2 ...and it is on their Leads');
select is((select inbound_product from public.leads where phone = '+15125558101'), 'booked_appointment', 'b3 the agent sees the lead type');
select is((select meta_option from public.lead_intake where intake_key = 'k-match-1'), 'form_page', 'b4 the Meta option is kept for admin');
select is(public.ghl_intake_lead('{"intake_key":"k-live-1","agent_id":"f8580000-0000-4000-8000-00000000000b","lead_type":"live_call","first_name":"Bo","phone":"+15125558102","state":"OK"}'::jsonb)->>'routing',
          'matched', 'b5 a live call routes too');
select is((select lead_type from public.leads where phone = '+15125558102'), 'policy_help', 'b6 live call = policy_help (live_call product)');
select is(public.ghl_intake_lead('{"intake_key":"k-miss-1","lead_type":"booked_appointment","first_name":"Cy","phone":"+15125558103","state":"TX"}'::jsonb)->>'routing',
          'missing', 'b7 no agent ID: missing');
select is(public.ghl_intake_lead('{"intake_key":"k-unk-1","agent_id":"agent-42","first_name":"Di","phone":"+15125558104","state":"TX"}'::jsonb)->>'routing',
          'unknown', 'b8 a malformed agent ID: unknown');
select is(public.ghl_intake_lead('{"intake_key":"k-unk-2","agent_id":"f8580000-0000-4000-8000-00000000000f","first_name":"Ed","phone":"+15125558105","state":"TX"}'::jsonb)->>'routing',
          'unknown', 'b9 a VA''s ID is not an agent: unknown');
select is(public.ghl_intake_lead('{"intake_key":"k-off-1","agent_id":"f8580000-0000-4000-8000-00000000000c","first_name":"Flo","phone":"+15125558106","state":"TX"}'::jsonb)->>'routing',
          'inactive', 'b10 an inactive agent: inactive');
select is(public.ghl_intake_lead('{"intake_key":"k-st-1","agent_id":"f8580000-0000-4000-8000-00000000000b","first_name":"Gus","phone":"+15125558107","state":"FL"}'::jsonb)->>'routing',
          'unlicensed', 'b11 a state the agent does not take: unlicensed');
select is((select count(*)::int from public.leads where phone in ('+15125558103', '+15125558104', '+15125558105', '+15125558106', '+15125558107') and assigned_rep_id is null),
          5, 'b12 every one of those lands unassigned (never round-robined)');

-- ── c. once and only once ───────────────────────────────────────────────────
select is(public.ghl_intake_lead('{"intake_key":"k-match-1","agent_id":"f8580000-0000-4000-8000-00000000000b","first_name":"Ann","phone":"+15125558101","state":"TX"}'::jsonb)->>'duplicate',
          'true', 'c1 the same intake key again is a duplicate');
select is(public.ghl_intake_lead('{"intake_key":"k-match-2","agent_id":"f8580000-0000-4000-8000-00000000000b","first_name":"Ann","phone":"512-555-8101","state":"TX"}'::jsonb)->>'routing',
          'duplicate', 'c2 the same phone inside 30 days with a new key is a duplicate');
select is((select count(*)::int from public.leads where phone = '+15125558101'), 1, 'c3 ...and still one lead');
select is((select count(*)::int from public.lead_intake where lead_id = (select id from public.leads where phone = '+15125558101')), 2, 'c4 both deliveries are logged on it');
select throws_ok($$select public.ghl_intake_lead('{"intake_key":"k-bad-1","first_name":"Hal","phone":"12","state":"TX"}'::jsonb)$$, '22023', null, 'c5 a bad phone is refused');
select throws_ok($$select public.ghl_intake_lead('{"first_name":"Ivy","phone":"+15125558109","state":"TX"}'::jsonb)$$, '22004', null, 'c6 no intake key is refused');
select throws_ok($$select public.ghl_intake_lead('{"intake_key":"k-bad-2","lead_type":"cold","phone":"+15125558110"}'::jsonb)$$, '22023', null, 'c7 an unknown lead type is refused');

-- ── d. Unassigned and Assign to… ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f8580000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.admin_unassigned_leads()), 0, 'd1 an agent sees no Unassigned lane');
select is((select count(*)::int from public.lead_intake), 0, 'd2 an agent cannot read intake (Meta option, ad IDs)');
select throws_ok($$select public.admin_assign_lead((select lead_id from public.lead_intake limit 1), 'f8580000-0000-4000-8000-00000000000b')$$, '42501', null, 'd3 an agent cannot assign');
select set_config('request.jwt.claims', '{"sub":"f8580000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.admin_unassigned_leads() where routing in ('missing', 'unknown', 'inactive', 'unlicensed')), 5, 'd4 admin sees the five in Unassigned with why');
select lives_ok($$select public.admin_assign_lead((select lead_id from public.admin_unassigned_leads() where routing = 'missing'), 'f8580000-0000-4000-8000-00000000000b')$$, 'd5 admin assigns one');
select throws_ok($$select public.admin_assign_lead((select lead_id from public.admin_unassigned_leads() limit 1), 'f8580000-0000-4000-8000-00000000000c')$$, '22023', null, 'd6 not to an inactive agent');
reset role;
select is((select assigned_rep_id from public.leads where phone = '+15125558103'), 'f8580000-0000-4000-8000-00000000000b'::uuid, 'd7 the lead is now the agent''s');
select is((select routing from public.lead_intake where intake_key = 'k-miss-1'), 'assigned', 'd8 intake shows it was assigned by hand');
select ok(exists (select 1 from public.admin_audit_log where via = 'admin_assign_lead' and action = 'route_lead' and actor = 'f8580000-0000-4000-8000-00000000000a'), 'd9 the assignment is audit-logged with who');

-- ── e. campaigns, spend and costs ───────────────────────────────────────────
select is(public.ghl_ad_spend_save('[{"campaign_id":"cmp-1","campaign_name":"Agent Bee — MP","date":"2026-11-07","spend_cents":12345,"impressions":4000,"clicks":120,"leads":6}]'::jsonb, 'ok')->>'unmapped',
          '1', 'e1 a new campaign arrives unmapped');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f8580000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select lives_ok($$select public.admin_map_campaign('cmp-1', 'f8580000-0000-4000-8000-00000000000b', 'appts')$$, 'e2 admin maps campaign → agent');
select is((select spend_cents from public.admin_ad_costs('2026-11-01', '2026-11-30') where agent_id = 'f8580000-0000-4000-8000-00000000000b'), 12345::bigint, 'e3 spend already pulled follows the mapping');
select set_config('request.jwt.claims', '{"sub":"f8580000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.ad_spend_daily) + (select count(*)::int from public.ghl_campaign_agents) + (select count(*)::int from public.admin_ad_costs('2026-11-01', '2026-11-30')),
          0, 'e4 an agent sees no spend, campaigns or costs');
reset role;
select is(public.ghl_ad_spend_save('[{"campaign_id":"cmp-1","date":"2026-11-07","spend_cents":13000,"impressions":4100,"clicks":125,"leads":7}]'::jsonb, 'ok')->>'billed',
          '0', 'e5 billing off: the lead-spend ledger is never fed');
select is((select spend_cents from public.ad_spend_daily where campaign_id = 'cmp-1' and spend_date = '2026-11-07'), 13000::bigint, 'e6 a re-pull of the day replaces its numbers (no double count)');

-- ── f. Setup ticks and Mark live ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f8580000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select throws_ok($$select public.admin_setup_tick('f8580000-0000-4000-8000-00000000000b', 'campaign', true)$$, '42501', null, 'f1 an agent cannot tick setup');
select set_config('request.jwt.claims', '{"sub":"f8580000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select lives_ok($$select public.admin_setup_tick('f8580000-0000-4000-8000-00000000000b', 'campaign', true)$$, 'f2 admin ticks Meta campaign created');
select throws_ok($$select public.admin_setup_tick('f8580000-0000-4000-8000-00000000000b', 'live', true)$$, '22023', null, 'f3 Live only through Mark live');
select lives_ok($$select public.admin_mark_live('f8580000-0000-4000-8000-00000000000b')$$, 'f4 admin marks the agent live');
reset role;
select ok((select active from public.agent_lead_settings where agent_id = 'f8580000-0000-4000-8000-00000000000b')
          and exists (select 1 from public.admin_audit_log where via = 'admin_mark_live'), 'f5 live = taking leads, audit-logged');

select * from finish();
rollback;
