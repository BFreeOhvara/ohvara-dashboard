-- p916_deedstone — pgTAP checks for supabase/migrations/255_deedstone_numbers.sql (Prompt 916): the Deedstone
-- number pool (fill to the limit, sticky, hot warning), connect-your-phone codes, an agent's Call checks, calls in
-- finding the right agent, and admin Settings → Deedstone numbers.
--
-- RUN: `npm run test:sql -- supabase/tests/p916_deedstone.sql` (PGlite, in memory). One transaction, rolled back.
-- Never run it against Ohvara's live database.
--
-- Cast: admin Z, agents A B C D (active), VA V.

begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p916_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('d9160000-0000-4000-8000-000000000001'::uuid, 'admin_z', 'agent'),
    ('d9160000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent'),
    ('d9160000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent'),
    ('d9160000-0000-4000-8000-00000000000c'::uuid, 'agent_c', 'agent'),
    ('d9160000-0000-4000-8000-00000000000d'::uuid, 'agent_d', 'agent'),
    ('d9160000-0000-4000-8000-00000000000e'::uuid, 'agent_e', 'agent'),
    ('e9160000-0000-4000-8000-000000000001'::uuid, 'va_v', 'fulfillment')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'd9160000-0000-4000-8000-000000000001';
update public.profiles set is_active = true, timezone = 'UTC' where id::text like 'd916%' or id::text like 'e916%';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
-- 'ZZ' is a test state open all day in UTC; desk hours pinned open.
insert into public.state_call_rules (state, tz, call_start, call_end) values ('ZZ', array['UTC'], '00:00', '23:59:59');
create or replace function public.route_desk_open(p_at timestamptz default now())
returns boolean language sql stable as $$ select true $$;

-- ── a. structure, access ──────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'deedstone_numbers', 'a1 deedstone_numbers exists');
select has_table('public', 'deedstone_agent_lines', 'a2 deedstone_agent_lines exists');
select has_table('public', 'deedstone_calls', 'a3 deedstone_calls exists');
select is((select deedstone_daily_limit from public.app_settings where id = 1), 120, 'a4 limit defaults to 120');
select is((select count(*)::int from public.notification_types where type = 'deedstone_number_hot'), 1, 'a5 hot notification type');
select ok(not has_function_privilege('authenticated', 'public.deedstone_from(uuid, text, text)', 'execute'), 'a6 deedstone_from is service-only');
select ok(not has_function_privilege('authenticated', 'public.deedstone_call_begin(uuid, uuid, uuid)', 'execute'), 'a7 call_begin is service-only');
select ok(not has_function_privilege('anon', 'public.my_deedstone_phone()', 'execute'), 'a8 anon can''t read phones');
select ok(has_function_privilege('authenticated', 'public.deedstone_code_confirm(text)', 'execute'), 'a9 agents confirm codes');

-- ── b. admin: numbers ─────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('d9160000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.admin_deedstone_numbers() $$, '42501', null, 'b1 an agent can''t see the pool');
select throws_ok($$ select public.admin_deedstone_number_save(null, '2145550001') $$, '42501', null, 'b2 an agent can''t add a number');
select is((select count(*)::int from public.deedstone_numbers), 0, 'b3 an agent reads no numbers (RLS)');
select pg_temp.as_user('d9160000-0000-4000-8000-000000000001');
select is((public.admin_deedstone_numbers() ->> 'add_number')::boolean, true, 'b4 empty pool says add a number');
select is((public.admin_deedstone_number_save(null, '(214) 555-0001', 'Dallas 1')).phone, '+12145550001', 'b5 admin adds a number (E.164)');
select is((select caller_name from public.deedstone_numbers where phone = '+12145550001'), 'DEEDSTONE INS', 'b6 caller name defaults to DEEDSTONE INS');
select ok((public.admin_deedstone_number_save(null, '2145550002', 'Dallas 2')).id is not null, 'b7 second number');
select throws_ok($$ select public.admin_deedstone_number_save(null, '555') $$, '22023', null, 'b8 a bad number is refused');
select is((public.admin_deedstone_settings(60, 30) ->> 'daily_limit')::int, 60, 'b9 admin sets the limit (60 → two agents a number)');
select pg_temp.as_owner();

-- ── c. pool: fill, sticky, hot ────────────────────────────────────────────────────────────────────────────────
select is(public.deedstone_from('d9160000-0000-4000-8000-00000000000a') ->> 'phone', '+12145550001', 'c1 A gets the first number');
select is(public.deedstone_from('d9160000-0000-4000-8000-00000000000b') ->> 'phone', '+12145550001', 'c2 B fills the first number (30+30 = 60)');
select is(public.deedstone_from('d9160000-0000-4000-8000-00000000000c') ->> 'phone', '+12145550002', 'c3 C gets the next number');
select is(public.deedstone_from('d9160000-0000-4000-8000-00000000000a', 'agent_call', 'x') ->> 'phone', '+12145550001', 'c4 A keeps their number');
select is((select count(*)::int from public.deedstone_number_use), 1, 'c5 only a kind logs a call');
select is(public.deedstone_from(null), null, 'c6 no agent, no number');
select is(public.deedstone_from('d9160000-0000-4000-8000-00000000000d') ->> 'phone', '+12145550002', 'c7 D fills the second number');
select is((select count(*)::int from public.notifications where type = 'deedstone_number_hot' and profile_id = 'd9160000-0000-4000-8000-000000000001'), 0, 'c7b no warning while a number has room');
-- E: both numbers full → least loaded (a tie: the first), and admins told.
select is(public.deedstone_from('d9160000-0000-4000-8000-00000000000e') ->> 'phone', '+12145550001', 'c8a every number full → least loaded');
select is((select count(*)::int from public.notifications where type = 'deedstone_number_hot' and profile_id = 'd9160000-0000-4000-8000-000000000001'), 1, 'c8 admin told every number is full');
-- 54 calls today on number 1 → 90% of 60 → hot (1 so far + 52 + the 54th).
insert into public.deedstone_number_use (number_id, kind, agent_id)
select (select id from public.deedstone_numbers where phone = '+12145550001'), 'va_call', 'd9160000-0000-4000-8000-00000000000a'
  from generate_series(1, 52);
select ok(public.deedstone_from('d9160000-0000-4000-8000-00000000000b', 'va_call') is not null, 'c9 the 54th call');
select is((select count(*)::int from public.notifications where type = 'deedstone_number_hot' and profile_id = 'd9160000-0000-4000-8000-000000000001'), 2, 'c10 admin told the number runs hot');
select ok(public.deedstone_from('d9160000-0000-4000-8000-00000000000b', 'va_call') is not null, 'c11 the 55th call');
select is((select count(*)::int from public.notifications where type = 'deedstone_number_hot' and profile_id = 'd9160000-0000-4000-8000-000000000001'), 2, 'c12 hot told once a day');
select pg_temp.as_user('d9160000-0000-4000-8000-000000000001');
select is((select (n ->> 'today')::int from jsonb_array_elements(public.admin_deedstone_numbers() -> 'numbers') n
            where n ->> 'phone' = '+12145550001'), 54 + 1, 'c13 admin sees calls today per number');
select is((select (n ->> 'hot')::boolean from jsonb_array_elements(public.admin_deedstone_numbers() -> 'numbers') n
            where n ->> 'phone' = '+12145550001'), true, 'c14 admin sees it hot');
select is(jsonb_array_length((public.admin_deedstone_numbers() -> 'numbers') -> 0 -> 'days'), 7, 'c15 seven days per number');
-- Turning a number off moves its agents the next time they call.
select ok((public.admin_deedstone_number_save((select id from public.deedstone_numbers where phone = '+12145550002'),
          '2145550002', 'Dallas 2', null, null, false)).active = false, 'c16 admin turns a number off');
select pg_temp.as_owner();
select is(public.deedstone_from('d9160000-0000-4000-8000-00000000000c') ->> 'phone', '+12145550001', 'c17 its agent moves to an active number');

-- ── d. connect your phone ─────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.deedstone_code_begin('d9160000-0000-4000-8000-00000000000a', '12') $$, '22023', null, 'd1 a bad phone is refused');
select throws_ok($$ select public.deedstone_code_begin('e9160000-0000-4000-8000-000000000001', '2145550100') $$, '42501', null, 'd2 only agents');
create temp table code_a as select public.deedstone_code_begin('d9160000-0000-4000-8000-00000000000a', '(214) 555-0100') as c;
grant select on code_a to authenticated;
select ok((select c from code_a) ~ '^[0-9]{6}$', 'd3 a 6-digit code');
select pg_temp.as_user('d9160000-0000-4000-8000-00000000000a');
select is((public.my_deedstone_phone() ->> 'pending')::boolean, true, 'd4 Settings shows a code is on its way');
select is(public.deedstone_code_confirm((select lpad(((c::int + 1) % 1000000)::text, 6, '0') from code_a)) ->> 'reason',
          'wrong_code', 'd5 a wrong code is refused');
select is((public.deedstone_code_confirm((select c from code_a))) ->> 'ok', 'true', 'd6 the right code connects the phone');
select is(public.my_deedstone_phone() ->> 'phone', '+12145550100', 'd7 Settings shows the connected phone');
select ok(public.my_deedstone_phone() ->> 'number' is null, 'd8 the agent never sees their Deedstone number');
select pg_temp.as_owner();
select public.deedstone_code_begin('d9160000-0000-4000-8000-00000000000b', '2145550200');
select public.deedstone_code_begin('d9160000-0000-4000-8000-00000000000b', '2145550200');
select public.deedstone_code_begin('d9160000-0000-4000-8000-00000000000b', '2145550200');
select throws_ok($$ select public.deedstone_code_begin('d9160000-0000-4000-8000-00000000000b', '2145550200') $$, 'P0001', 'too_many', 'd9 at most 3 code calls an hour');

-- ── e. an agent's Call ────────────────────────────────────────────────────────────────────────────────────────
insert into public.leads (id, lead_type, phone, state, contact_name, business_name, assigned_rep_id, qualifier_answers) values
  ('a9160000-0000-4000-8000-000000000001', 'mortgage_protection', '+12145550301', 'ZZ', 'Lou Lead', 'Lou Lead',
   'd9160000-0000-4000-8000-00000000000a', '{"consent_at":"2026-11-07T10:00:00Z"}'),
  ('a9160000-0000-4000-8000-000000000002', 'mortgage_protection', '+12145550302', 'ZZ', 'Nora Noconsent', 'Nora Noconsent',
   'd9160000-0000-4000-8000-00000000000a', '{}'),
  ('a9160000-0000-4000-8000-000000000003', 'mortgage_protection', '+12145550303', 'ZZ', 'Bo Other', 'Bo Other',
   'd9160000-0000-4000-8000-00000000000b', '{"consent_at":"2026-11-07T10:00:00Z"}');
select is(public.deedstone_call_begin('d9160000-0000-4000-8000-00000000000a', 'a9160000-0000-4000-8000-000000000003', null) ->> 'reason',
          'not_yours', 'e1 another agent''s lead is refused');
select is(public.deedstone_call_begin('d9160000-0000-4000-8000-00000000000a', 'a9160000-0000-4000-8000-000000000002', null) ->> 'reason',
          'no_consent', 'e2 pre-dial: no consent');
select is(public.deedstone_call_begin('d9160000-0000-4000-8000-00000000000b', 'a9160000-0000-4000-8000-000000000003', null) ->> 'reason',
          'no_agent_phone', 'e3 Call needs a connected phone');
create temp table call_a as
  select public.deedstone_call_begin('d9160000-0000-4000-8000-00000000000a', 'a9160000-0000-4000-8000-000000000001', null) as r;
select is((select r ->> 'from' from call_a), '+12145550001', 'e4 the client sees the agent''s Deedstone number');
select is((select r ->> 'agent_phone' from call_a), '+12145550100', 'e5 the agent''s own phone rings first');
select is(public.deedstone_call_begin('d9160000-0000-4000-8000-00000000000a', 'a9160000-0000-4000-8000-000000000001', null) ->> 'reason',
          'busy', 'e6 one call at a time');
select is(public.deedstone_call_connect((select (r ->> 'call_id')::uuid from call_a)) ->> 'client_phone', '+12145550301', 'e7 pressing 1 dials the client');
select is((select count(*)::int from public.call_attempts where phone = '+12145550301'), 1, 'e8 the attempt counts toward the cap');
select pg_temp.as_user('d9160000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.deedstone_calls), 0, 'e9 another agent can''t read the call');
select pg_temp.as_owner();

-- ── f. calls in ───────────────────────────────────────────────────────────────────────────────────────────────
insert into public.agent_working_hours (agent_id, weekday, start_time, end_time)
select 'd9160000-0000-4000-8000-00000000000a', d, '00:00', '23:59:59' from generate_series(1, 7) d;
select is(public.deedstone_inbound_start('CA1', '+12145550301', '+12145550001') ->> 'phone', '+12145550100', 'f1 a known caller rings their agent''s phone');
select is(public.deedstone_inbound_done('CA1'), false, 'f2 the agent didn''t press 1 → the VA desk');
select is((select routed from public.deedstone_inbound where call_sid = 'CA1'), 'va', 'f3 marked for the VAs');
select public.deedstone_inbound_start('CA2', '+12145550301', '+12145550001');
select public.deedstone_inbound_took('CA2');
select is(public.deedstone_inbound_done('CA2'), true, 'f4 the agent took it');
select is((public.deedstone_inbound_start('CA3', '+19725559999', '+12145550001') ->> 'agent')::boolean, false, 'f5 an unknown caller goes to a VA');
select is((public.deedstone_inbound_start('CA4', '+12145550303', '+12145550001') ->> 'agent')::boolean, false, 'f6 an agent with no connected phone → a VA');
delete from public.agent_working_hours where agent_id = 'd9160000-0000-4000-8000-00000000000a';
select is((public.deedstone_inbound_start('CA5', '+12145550301', '+12145550001') ->> 'agent')::boolean, false, 'f7 outside the agent''s hours → a VA');

select * from finish();
rollback;
