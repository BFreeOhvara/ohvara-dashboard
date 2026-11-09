-- p915_ghl_gaps — pgTAP checks for 253_ghl_gaps.sql (Prompt 915): agent codes and matching, the unmatched-lead push,
-- "campaign created" from GoHighLevel, campaign on/off claimed / retried / logged for ghl-push, the launch checks on the
-- server (Turn campaign on refused until they pass, a broken check pauses), Place test call, the VA day-off allowance.
-- RUN: node scripts/run-sql-tests.mjs supabase/tests/p915_ghl_gaps.sql
-- Local PGlite only; one transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p915_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.name), now(), now()
  from (values
    ('f9150000-0000-4000-8000-00000000000a'::uuid, 'admin', 'fulfillment', 'Ada Admin'),
    ('f9150000-0000-4000-8000-00000000000b'::uuid, 'owen',  'agent',       'Owen Fisher'),
    ('f9150000-0000-4000-8000-00000000000c'::uuid, 'owen2', 'agent',       'Owen Park'),
    ('f9150000-0000-4000-8000-00000000000d'::uuid, 'x',     'agent',       'X'),
    ('f9150000-0000-4000-8000-00000000000f'::uuid, 'va',    'fulfillment', 'Vera Vance')
  ) as u(id, n, role, name);
update public.profiles set role = 'admin', is_active = true where id = 'f9150000-0000-4000-8000-00000000000a';
update public.profiles set is_active = true where id in ('f9150000-0000-4000-8000-00000000000b', 'f9150000-0000-4000-8000-00000000000c',
  'f9150000-0000-4000-8000-00000000000d', 'f9150000-0000-4000-8000-00000000000f');

-- ── a. Agent codes ──────────────────────────────────────────────────────────
select is((select agent_code from public.profiles where id = 'f9150000-0000-4000-8000-00000000000b'), 'DS-OWEN', 'a1 Owen Fisher is DS-OWEN');
select is((select agent_code from public.profiles where id = 'f9150000-0000-4000-8000-00000000000c'), 'DS-OWE2', 'a2 a second Owen gets DS-OWE2');
select is((select agent_code from public.profiles where id = 'f9150000-0000-4000-8000-00000000000a'), null, 'a3 admins get no code');
update public.profiles set agent_code = 'DS-ZZZZ', full_name = 'Owen Changed' where id = 'f9150000-0000-4000-8000-00000000000b';
select is((select agent_code from public.profiles where id = 'f9150000-0000-4000-8000-00000000000b'), 'DS-OWEN', 'a4 a code never changes once given');
select is(public.agent_by_ref('DS-OWEN'), 'f9150000-0000-4000-8000-00000000000b'::uuid, 'a5 DS-OWEN matches');
select is(public.agent_by_ref(' ds-owen '), 'f9150000-0000-4000-8000-00000000000b'::uuid, 'a6 any case, spaces trimmed');
select is(public.agent_by_ref('OWEN'), 'f9150000-0000-4000-8000-00000000000b'::uuid, 'a7 "DS-" is optional');
select is(public.agent_by_ref('f9150000-0000-4000-8000-00000000000b'), 'f9150000-0000-4000-8000-00000000000b'::uuid, 'a8 the full agent ID matches');
select is(public.agent_by_ref('F9150000-0000-4000-8000-00000000000B'), 'f9150000-0000-4000-8000-00000000000b'::uuid, 'a9 the full ID in capitals matches');
select is(public.agent_by_ref('DS-NOPE'), null, 'a10 an unknown code matches no one');
select is(public.agent_by_ref('f9150000-0000-4000-8000-00000000000f'), null, 'a11 a VA''s ID matches no agent');
select ok(not has_function_privilege('authenticated', 'public.agent_by_ref(text)', 'execute'), 'a12 agent_by_ref is server-only');
select ok((select agent_code ~ '^DS-[0-9A-F]{4}$' from public.profiles where id = 'f9150000-0000-4000-8000-00000000000d')
          or (select agent_code is null from public.profiles where id = 'f9150000-0000-4000-8000-00000000000d'), 'a13 a name too short for a code waits (or gets a random one)');

-- ── b. Intake: code and full ID both route; unmatched pushes admins ────────
insert into public.agent_lead_settings (agent_id, active, states) values
  ('f9150000-0000-4000-8000-00000000000b', true, '{TX,OK,LA}'),
  ('f9150000-0000-4000-8000-00000000000c', true, '{TX,OK,LA}')
on conflict (agent_id) do update set active = excluded.active, states = excluded.states;
select is(public.ghl_intake_lead('{"intake_key":"p915-int-1","phone":"(214) 555-0101","state":"TX","agent_id":"DS-OWEN","is_test":"true"}')->>'routing',
          'matched', 'b1 a lead with DS-OWEN in the link is matched');
select is((select assigned_rep_id from public.leads l join public.lead_intake i on i.lead_id = l.id where i.intake_key = 'p915-int-1'),
          'f9150000-0000-4000-8000-00000000000b'::uuid, 'b2 and goes to Owen');
select is((select is_test from public.lead_intake where intake_key = 'p915-int-1'), true, 'b3 Meta''s test flag is kept');
select is(public.ghl_intake_lead('{"intake_key":"p915-int-2","phone":"(214) 555-0102","state":"TX","agent_id":"f9150000-0000-4000-8000-00000000000c"}')->>'agent_id',
          'f9150000-0000-4000-8000-00000000000c', 'b4 the full agent ID still matches');
select is(public.ghl_intake_lead('{"intake_key":"p915-int-3","phone":"(214) 555-0103","state":"TX","agent_id":"DS-NOPE"}')->>'routing',
          'unknown', 'b5 an unknown code is unmatched');
select is((select count(*)::int from public.notifications where type = 'lead_unmatched' and profile_id = 'f9150000-0000-4000-8000-00000000000a'),
          1, 'b6 the admin gets the unmatched push');
select is(public.ghl_intake_lead('{"intake_key":"p915-int-4","phone":"(214) 555-0104","state":"TX"}')->>'routing', 'missing', 'b7 no ref, no campaign: missing');
select is((select count(*)::int from public.notifications where type = 'lead_unmatched' and profile_id = 'f9150000-0000-4000-8000-00000000000a'), 2, 'b8 one push per unmatched lead');
select is((select count(*)::int from public.notifications n join public.profiles p on p.id = n.profile_id where n.type = 'lead_unmatched' and p.role::text <> 'admin'),
          0, 'b9 only admins hear about unmatched leads');

-- ── c. "Campaign created" from GoHighLevel ──────────────────────────────────
select is(public.ghl_campaign_created('{"agent_id":"DS-OWEN","campaign_id":"ghlc-owen-1","fb_campaign_id":"120210001","campaign_name":"Deedstone · Owen Fisher · DS-OWEN","lead_type":"booked_appointment"}')->>'agent_id',
          'f9150000-0000-4000-8000-00000000000b', 'c1 the campaign is saved on Owen');
select is((select link_ref || '|' || fb_campaign_id || '|' || lead_type from public.ghl_campaign_agents where campaign_id = 'ghlc-owen-1'),
          'DS-OWEN|120210001|appts', 'c2 with the link ref, the Meta ID and the lead type');
select is((select count(*)::int from public.agent_setup_ticks where agent_id = 'f9150000-0000-4000-8000-00000000000b' and step in ('campaign', 'mapped')),
          2, 'c3 Setup''s campaign and mapped steps are ticked');
select throws_ok($$select public.ghl_campaign_created('{"agent_id":"DS-NOPE","campaign_id":"ghlc-x"}')$$, '22023', null, 'c4 an unknown agent is refused');
select is(public.ghl_intake_lead('{"intake_key":"p915-int-5","phone":"(214) 555-0105","state":"TX","campaign_id":"120210001"}')->>'routing',
          'campaign', 'c5 a lead with only the Meta campaign ID routes by the campaign');
select ok(not has_function_privilege('authenticated', 'public.ghl_campaign_created(jsonb)', 'execute'), 'c6 campaign created is server-only');

-- ── d. Campaign on/off → GoHighLevel: claim, retry, log ─────────────────────
insert into public.agent_campaign_control (agent_id, lead_type, run, daily_budget_cents, cap_cents, reason)
values ('f9150000-0000-4000-8000-00000000000b', 'appts', true, 2000, 6000, 'funded');
create temp table p915_c1 as select * from public.ghl_claim_controls(10) where agent_id = 'f9150000-0000-4000-8000-00000000000b';
select is((select count(*)::int from p915_c1), 1, 'd1 the new row waits to be sent');
select is((select agent_code || '|' || campaign_id || '|' || run from p915_c1), 'DS-OWEN|ghlc-owen-1|true', 'd2 with the agent code, the campaign and on/off');
select is((select count(*)::int from public.ghl_claim_controls(10) where agent_id = 'f9150000-0000-4000-8000-00000000000b'), 0, 'd3 a claimed row is held (no double send)');
select lives_ok($$select public.ghl_control_result('f9150000-0000-4000-8000-00000000000b', 'appts', (select changed_at from p915_c1), false, 503, 'GHL hook: HTTP 503')$$,
                'd4 a failed send is settled');
select is((select push_attempts || '|' || push_error from public.agent_campaign_control where agent_id = 'f9150000-0000-4000-8000-00000000000b' and lead_type = 'appts'),
          '1|GHL hook: HTTP 503', 'd5 the failure is counted and kept for admin');
select ok((select push_next_at > now() from public.agent_campaign_control where agent_id = 'f9150000-0000-4000-8000-00000000000b' and lead_type = 'appts'),
          'd6 the retry waits');
update public.agent_campaign_control set push_next_at = now() - interval '1 minute' where agent_id = 'f9150000-0000-4000-8000-00000000000b';
select is((select attempt from public.ghl_claim_controls(10) where agent_id = 'f9150000-0000-4000-8000-00000000000b' and lead_type = 'appts'), 2, 'd7 the retry is attempt 2');
select ghl_control_result('f9150000-0000-4000-8000-00000000000b', 'appts', (select changed_at from p915_c1), true, 200, null, '{"run":true}');
select ok((select pushed_at >= changed_at and push_error is null and push_attempts = 0 from public.agent_campaign_control
            where agent_id = 'f9150000-0000-4000-8000-00000000000b' and lead_type = 'appts'), 'd8 a good send marks it pushed');
select is((select string_agg(ok::text, ',' order by id) from public.ghl_control_log where agent_id = 'f9150000-0000-4000-8000-00000000000b'),
          'false,true', 'd9 both tries are logged');
select is((select count(*)::int from public.ghl_claim_controls(10) where agent_id = 'f9150000-0000-4000-8000-00000000000b'), 0, 'd10 nothing left to send');
-- The agent pauses: the row says stop and is sent again.
insert into public.agent_lead_pause (agent_id, active) values ('f9150000-0000-4000-8000-00000000000b', true);
update public.agent_campaign_control set run = true, changed_at = clock_timestamp() where agent_id = 'f9150000-0000-4000-8000-00000000000b';
select is((select run::text || '|' || reason from public.ghl_claim_controls(10) where agent_id = 'f9150000-0000-4000-8000-00000000000b' and lead_type = 'appts'), 'false|paused by agent', 'd11 a pause is pushed as stop');
delete from public.agent_lead_pause where agent_id = 'f9150000-0000-4000-8000-00000000000b';
select ok(not has_function_privilege('authenticated', 'public.ghl_claim_controls(int)', 'execute'), 'd12 claiming is service-role only');
select ok(not has_table_privilege('anon', 'public.ghl_control_log', 'select'), 'd13 the log is closed to anon');

-- ── e. Launch checks on the server, Turn campaign on, Place test call, the gate ──
select is((select array_to_string(array(select jsonb_array_elements_text(public.agent_launch_checks('f9150000-0000-4000-8000-00000000000b')->'failed')), ',')),
          'profile,paid,testCall', 'e1 Owen fails profile, paid and the test call');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9150000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select throws_ok($$select public.admin_turn_campaign_on('f9150000-0000-4000-8000-00000000000b')$$, 'P0001', null, 'e2 Turn campaign on is refused while a check fails');
select is((public.admin_place_test_call('f9150000-0000-4000-8000-00000000000b')->>'asked')::int, 1, 'e3 Place test call asks the VAs');
reset role;
select is((select count(*)::int from public.notifications where type = 'va_test_call' and profile_id = 'f9150000-0000-4000-8000-00000000000f'),
          1, 'e4 the VA is told to call the test lead');
update public.agent_lead_settings set states = '{TX,OK,LA}' where agent_id = 'f9150000-0000-4000-8000-00000000000b';
update public.profiles set npn = '1234567', working_hours_start = '09:00', timezone = 'America/Chicago', billing_status = 'active'
 where id = 'f9150000-0000-4000-8000-00000000000b';
update public.leads set first_call_at = now(), first_call_by = 'va'
 where id = (select lead_id from public.lead_intake where intake_key = 'p915-int-1');
select is(public.agent_launch_checks('f9150000-0000-4000-8000-00000000000b')->>'ok', 'true', 'e5 every check passes now');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9150000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select lives_ok($$select public.admin_turn_campaign_on('f9150000-0000-4000-8000-00000000000b')$$, 'e6 Turn campaign on works');
select set_config('request.jwt.claims', '{"sub":"f9150000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select throws_ok($$select public.admin_turn_campaign_on('f9150000-0000-4000-8000-00000000000b')$$, '42501', null, 'e7 an agent can''t turn their own campaign on');
reset role;
select is((select state from public.agent_launch where agent_id = 'f9150000-0000-4000-8000-00000000000b'), 'on', 'e8 Owen is on');
select is((select count(*)::int from public.agent_setup_ticks where agent_id = 'f9150000-0000-4000-8000-00000000000b' and step = 'live'), 0, 'e8b turning it on doesn''t mark the ticket done');
select is((select count(*)::int from public.admin_audit_log where via in ('admin_turn_campaign_on', 'admin_place_test_call') and target_id = 'f9150000-0000-4000-8000-00000000000b'),
          2, 'e8c turn-on and the test call are in the audit log');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9150000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select lives_ok($$select public.admin_setup_tick('f9150000-0000-4000-8000-00000000000b', 'states', true)$$, 'e8d the States and spend tick saves on real data');
reset role;
-- The bridge on: the gate applies. Owen 2 isn't turned on, so his row says stop.
insert into public.agent_campaign_control (agent_id, lead_type, run, daily_budget_cents, cap_cents, reason)
values ('f9150000-0000-4000-8000-00000000000c', 'appts', true, 1000, 3000, 'funded');
select is((select run from public.agent_campaign_control where agent_id = 'f9150000-0000-4000-8000-00000000000c'), true, 'e9 with the bridge off the gate stays out of it');
update public.ghl_settings set enabled = true where id;
update public.agent_campaign_control set changed_at = clock_timestamp() where agent_id = 'f9150000-0000-4000-8000-00000000000c';
select is((select reason from public.agent_campaign_control where agent_id = 'f9150000-0000-4000-8000-00000000000c' and lead_type = 'appts'), 'not launched', 'e10 with the bridge on, a campaign not turned on stops');
-- A check breaks (the card fails): the sweep pauses Owen and tells admins.
update public.profiles set billing_status = 'past_due' where id = 'f9150000-0000-4000-8000-00000000000b';
select is(public.launch_checks_sweep(), 1, 'e11 the sweep pauses one campaign');
select is((select state || '|' || paused_key from public.agent_launch where agent_id = 'f9150000-0000-4000-8000-00000000000b'), 'paused|paid', 'e12 paused on the paid check');
select is((select count(*)::int from public.notifications where type = 'campaign_launch_paused' and profile_id = 'f9150000-0000-4000-8000-00000000000a'), 1, 'e13 admins hear');
select ok((select bool_and(not run and reason like 'launch check%') from public.agent_campaign_control where agent_id = 'f9150000-0000-4000-8000-00000000000b'),
          'e14 and the row says stop, ready to push');

-- ── f. VA days off: the monthly allowance, no approvals ─────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9150000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select lives_ok($$select public.va_request_day_off((date_trunc('month', current_date + 40) + interval '2 days')::date)$$, 'f1 a first day off books');
select lives_ok($$select public.va_request_day_off((date_trunc('month', current_date + 40) + interval '3 days')::date)$$, 'f2 a second one books');
select throws_ok($$select public.va_request_day_off((date_trunc('month', current_date + 40) + interval '4 days')::date)$$, 'P0001',
                 'You''ve used all 2 of your days off this month.', 'f3 a third at a 2-day allowance is refused');
select throws_ok($$insert into public.va_day_off_requests (va_id, off_date) values ('f9150000-0000-4000-8000-00000000000f', (date_trunc('month', current_date + 40) + interval '5 days')::date)$$,
                 'P0001', null, 'f4 a direct insert can''t get round it');
select is((select string_agg(status, ',') from public.va_day_off_requests where va_id = 'f9150000-0000-4000-8000-00000000000f'), 'approved,approved', 'f5 booked days need no approval');
reset role;

select * from finish();
rollback;
