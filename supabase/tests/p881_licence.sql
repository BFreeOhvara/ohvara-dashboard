-- p881_licence — pgTAP checks for p881_nipr_licence.sql: verified states only, the gate switch, the self-write
-- lock, NIPR results applied (verified / no life / lapse / other account / mismatch / registry down), the daily
-- expiry sweep and reminders, manual review, assign_lead, VA bookings and the targeting hand-off.
--
-- RUN: `npm run test:sql -- supabase/tests/p881_licence.sql` (PGlite, in memory). Never against live.
--
-- Cast: admin Z, agents A (Jane Doe), B, C, VA V.

begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p881_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a8810000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a8810000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Jane Doe'),
    ('a8810000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent', 'Bo Bee'),
    ('a8810000-0000-4000-8000-00000000000c'::uuid, 'agent_c', 'agent', 'Cy Sea'),
    ('a8810000-0000-4000-8000-0000000000f1'::uuid, 'va', 'fulfillment', 'Val Va')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin' where id = 'a8810000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true where id in ('a8810000-0000-4000-8000-00000000000a', 'a8810000-0000-4000-8000-00000000000b', 'a8810000-0000-4000-8000-00000000000c');
update public.profiles set role = 'fulfillment' where id = 'a8810000-0000-4000-8000-0000000000f1';
-- Only this test's agents take leads.
update public.agent_lead_settings set active = false;

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.lic(st text, active boolean, life boolean, exp date) returns jsonb language sql as $$
  select jsonb_build_object('state', st, 'active', active, 'life', life, 'expires_on', exp, 'number', 'L-' || st)
$$;

-- ── a. structure ────────────────────────────────────────────────────────────
select is((select gate_on from public.licence_settings), false, 'a1 the gate starts OFF');
select is((select not_taking from public.licence_settings), '{NY}'::text[], 'a2 New York is not taken (Q61)');
select ok(not has_function_privilege('authenticated', 'public.licence_apply_check(uuid, text, text, text, jsonb, boolean)', 'execute'), 'a3 only the function applies a check');
select ok(not has_function_privilege('authenticated', 'public.licence_daily_sweep()', 'execute'), 'a4 the sweep is server-only');
select ok(has_function_privilege('authenticated', 'public.my_licence()', 'execute'), 'a5 an agent reads their licence');
select is((select count(*)::int from public.notification_types where type like 'licence_%'), 4, 'a6 four licence notification types');

-- ── b. an agent can't verify themselves ─────────────────────────────────────
select pg_temp.as_user('a8810000-0000-4000-8000-00000000000a');
insert into public.agent_licenses (profile_id, state, expires_on, verified, life_active, source)
values ('a8810000-0000-4000-8000-00000000000a', 'tx', '2030-01-01', true, true, 'nipr');
select is((select verified from public.agent_licenses where profile_id = 'a8810000-0000-4000-8000-00000000000a' and state = 'TX'), false, 'b1 self-written row is never verified');
select is((select source from public.agent_licenses where profile_id = 'a8810000-0000-4000-8000-00000000000a' and state = 'TX'), 'self', 'b2 and is marked self');
update public.profiles set npn_status = 'verified' where id = 'a8810000-0000-4000-8000-00000000000a';
select pg_temp.as_owner();
select is((select npn_status from public.profiles where id = 'a8810000-0000-4000-8000-00000000000a'), 'unchecked', 'b3 an agent can''t set their own NPN status');
select pg_temp.as_user('a8810000-0000-4000-8000-00000000000a');
select is(public.licence_verified_states('a8810000-0000-4000-8000-00000000000a'), '{}'::text[], 'b4 no verified states yet');
select ok(public.licence_allows('a8810000-0000-4000-8000-00000000000a', 'TX'), 'b5 gate off: unverified TX still passes (nothing changes on apply)');
select ok(not public.licence_allows('a8810000-0000-4000-8000-00000000000a', 'NY'), 'b6 New York never passes');
select throws_ok($$ insert into public.agent_lead_settings (agent_id, active, states) values ('a8810000-0000-4000-8000-00000000000a', true, '{TX,NY}') $$,
  'P0001', null, 'b7 New York can''t be picked for leads');

-- ── c. NIPR verifies agent A ────────────────────────────────────────────────
select pg_temp.as_owner();
select is((public.licence_apply_check('a8810000-0000-4000-8000-00000000000a', '1234567', 'verified', 'JANE DOE', jsonb_build_array(
  pg_temp.lic('TX', true, true, current_date + 400), pg_temp.lic('FL', true, true, current_date + 20),
  pg_temp.lic('OH', true, false, current_date + 400), pg_temp.lic('IL', false, true, current_date - 3),
  pg_temp.lic('NY', true, true, current_date + 400))))->>'status', 'verified', 'c1 status verified');
select is(public.licence_verified_states('a8810000-0000-4000-8000-00000000000a'), '{FL,TX}'::text[], 'c2 only active life states, NY left out');
select is((select source from public.agent_licenses where profile_id = 'a8810000-0000-4000-8000-00000000000a' and state = 'TX'), 'nipr', 'c3 the self row became the NIPR row');
select is((select count(*)::int from public.agent_licenses where profile_id = 'a8810000-0000-4000-8000-00000000000a' and state = 'TX'), 1, 'c4 no duplicate TX row');
select ok(public.licence_ready('a8810000-0000-4000-8000-00000000000a'), 'c5 ready to launch');
select is((select states from public.agent_targeting_states where agent_id = 'a8810000-0000-4000-8000-00000000000a'), '{FL,TX}'::text[], 'c6 targeting hand-off has the verified states');
select ok(exists (select 1 from public.notifications where profile_id = 'a8810000-0000-4000-8000-00000000000a' and type = 'licence_verified'), 'c7 agent told it''s checked');

-- ── d. the gate on ──────────────────────────────────────────────────────────
update public.licence_settings set gate_on = true;
select ok(public.licence_allows('a8810000-0000-4000-8000-00000000000a', 'tx'), 'd1 verified TX passes');
select ok(not public.licence_allows('a8810000-0000-4000-8000-00000000000a', 'OH'), 'd2 OH (no life line) blocked');
select ok(not public.licence_allows('a8810000-0000-4000-8000-00000000000a', null), 'd3 unknown state blocked');
select ok(not public.licence_allows('a8810000-0000-4000-8000-00000000000b', 'TX'), 'd4 unchecked agent B blocked');
select pg_temp.as_user('a8810000-0000-4000-8000-00000000000a');
select lives_ok($$ insert into public.agent_lead_settings (agent_id, active, states) values ('a8810000-0000-4000-8000-00000000000a', true, '{TX,FL}') $$, 'd5 verified states can be picked');
select throws_ok($$ update public.agent_lead_settings set states = '{TX,FL,OH}' where agent_id = 'a8810000-0000-4000-8000-00000000000a' $$,
  'P0001', null, 'd6 an unverified state can''t be picked');
select pg_temp.as_owner();

-- leads: A takes TX; an OH lead finds nobody
insert into public.agent_lead_settings (agent_id, active, states) values ('a8810000-0000-4000-8000-00000000000b', true, '{OH,TX}');
update public.agent_lead_settings set states = '{OH,TX}' where agent_id = 'a8810000-0000-4000-8000-00000000000b';
insert into public.leads (id, state, lead_type, business_name) values
  ('a8810000-0000-4000-8000-0000000001a1', 'TX', 'mortgage_protection', 'p881 tx'),
  ('a8810000-0000-4000-8000-0000000001a2', 'OH', 'mortgage_protection', 'p881 oh');
select is(public.assign_lead('a8810000-0000-4000-8000-0000000001a1'), 'a8810000-0000-4000-8000-00000000000a'::uuid, 'd7 TX lead goes to the verified agent, not B');
select is(public.assign_lead('a8810000-0000-4000-8000-0000000001a2'), null, 'd8 OH lead: no verified agent, nobody gets it');

-- VA bookings
alter table public.policies disable trigger user;
alter table public.policies enable trigger policies_va_booking_licence;
select set_config('request.jwt.claims', json_build_object('sub', 'a8810000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text, true);
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, status, state, scheduled_call_at)
  values ('a8810000-0000-4000-8000-00000000000a', 'Ola', 'Hio', 'Submitted', 'OH', now() + interval '1 day') $$,
  'P0001', null, 'd9 a VA can''t book A in OH');
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, status, state, scheduled_call_at)
  values ('a8810000-0000-4000-8000-00000000000a', 'No', 'State', 'Submitted', null, now() + interval '1 day') $$,
  'P0001', 'Confirm the client''s state before booking.', 'd10 state unknown: confirm it first');
select lives_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, status, state, scheduled_call_at)
  values ('a8810000-0000-4000-8000-00000000000a', 'Tex', 'Ann', 'Submitted', 'TX', now() + interval '1 day') $$, 'd11 a VA books A in TX');
select pg_temp.as_owner();
select lives_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, status, state, scheduled_call_at)
  values ('a8810000-0000-4000-8000-00000000000a', 'Own', 'Sale', 'Submitted', 'OH', now() + interval '1 day') $$, 'd12 non-VA writes are not this trigger''s job');
alter table public.policies enable trigger user;

-- ── e. the daily re-check drops a state ─────────────────────────────────────
select public.licence_apply_check('a8810000-0000-4000-8000-00000000000a', '1234567', 'verified', 'JANE DOE', jsonb_build_array(
  pg_temp.lic('TX', false, true, current_date + 400), pg_temp.lic('FL', true, true, current_date + 20)), true);
select is(public.licence_verified_states('a8810000-0000-4000-8000-00000000000a'), '{FL}'::text[], 'e1 TX dropped');
select is((select lapse_reason from public.agent_licenses where profile_id = 'a8810000-0000-4000-8000-00000000000a' and state = 'TX'), 'nipr_inactive', 'e2 lapse recorded');
select ok(exists (select 1 from public.notifications where profile_id = 'a8810000-0000-4000-8000-00000000000a' and type = 'licence_lapsed'), 'e3 agent told');
select ok(exists (select 1 from public.notifications where profile_id = 'a8810000-0000-4000-8000-000000000001' and type = 'licence_lapsed'), 'e4 admin told');
select is((select states from public.agent_targeting_states where agent_id = 'a8810000-0000-4000-8000-00000000000a'), '{FL}'::text[], 'e5 targeting updated the same day');
select is((select states from public.agent_lead_settings where agent_id = 'a8810000-0000-4000-8000-00000000000a'), '{TX,FL}'::text[], 'e6 the agent''s pick is kept (comes back when renewed)');
select public.licence_apply_check('a8810000-0000-4000-8000-00000000000a', '1234567', 'registry_down', null, '[]', true);
select is(public.licence_verified_states('a8810000-0000-4000-8000-00000000000a'), '{FL}'::text[], 'e7 NIPR down never drops anything');

-- ── f. the expiry sweep and reminders ───────────────────────────────────────
select ok(public.licence_daily_sweep() >= 0, 'f1 sweep runs');
select ok(exists (select 1 from public.notifications where profile_id = 'a8810000-0000-4000-8000-00000000000a' and type = 'licence_expiring'
                  and dedupe_key like '%:30'), 'f2 FL (20 days) gets the 30-day reminder');
update public.agent_licenses set expires_on = current_date - 1 where profile_id = 'a8810000-0000-4000-8000-00000000000a' and state = 'FL';
select is(public.licence_daily_sweep(), 1, 'f3 expired FL lapses');
select is(public.licence_verified_states('a8810000-0000-4000-8000-00000000000a'), '{}'::text[], 'f4 nothing left');
select ok(not public.licence_ready('a8810000-0000-4000-8000-00000000000a') and exists (select 1 from public.profiles where id = 'a8810000-0000-4000-8000-00000000000a'),
  'f5 no leads, account kept');
select ok(exists (select 1 from public.notifications where profile_id = 'a8810000-0000-4000-8000-00000000000a' and type = 'licence_lapsed' and detail like '%paused%'), 'f6 told leads are paused');

-- ── g. other account, mismatch, no life line ────────────────────────────────
select is((public.licence_apply_check('a8810000-0000-4000-8000-00000000000b', '1234567', 'verified', 'JANE DOE', jsonb_build_array(pg_temp.lic('TX', true, true, null))))->>'status',
  'duplicate', 'g1 NPN verified on another account → duplicate');
select is(public.licence_verified_states('a8810000-0000-4000-8000-00000000000b'), '{}'::text[], 'g2 and nothing verified for B');
select ok(exists (select 1 from public.licence_reviews where profile_id = 'a8810000-0000-4000-8000-00000000000b' and reason = 'duplicate' and status = 'open'), 'g3 admin review opened');
select is((public.licence_apply_check('a8810000-0000-4000-8000-00000000000c', '7654321', 'no_life', 'CY SEA', jsonb_build_array(pg_temp.lic('GA', true, false, null))))->>'status',
  'no_life', 'g4 no active life licence');
select ok(not public.licence_ready('a8810000-0000-4000-8000-00000000000c'), 'g5 no life line: not ready');

-- ── h. manual review ────────────────────────────────────────────────────────
update public.profiles set npn = '5555555' where id = 'a8810000-0000-4000-8000-00000000000c';
select pg_temp.as_user('a8810000-0000-4000-8000-00000000000c');
select throws_ok($$ select public.licence_review_request('not_found', '{GA}', 'someone-else/licence.pdf', null) $$, '42501', null, 'h1 upload must be in your own folder');
select ok(public.licence_review_request('not_found', '{GA}', 'a8810000-0000-4000-8000-00000000000c/licence.pdf', 'New licence') is not null, 'h2 agent sends for review');
select pg_temp.as_user('a8810000-0000-4000-8000-000000000001');
select lives_ok($$ select public.admin_licence_review_decide((select id from public.licence_reviews where profile_id = 'a8810000-0000-4000-8000-00000000000c' and status = 'open'),
  true, jsonb_build_array(jsonb_build_object('state', 'GA', 'expires_on', (current_date + 300)::text))) $$, 'h3 admin approves GA');
select pg_temp.as_owner();
select is(public.licence_verified_states('a8810000-0000-4000-8000-00000000000c'), '{GA}'::text[], 'h4 GA verified by review');
select ok(public.licence_ready('a8810000-0000-4000-8000-00000000000c'), 'h5 ready after review');

select * from finish();
rollback;
