-- p929_test_accounts — pgTAP checks for supabase/migrations/p929_test_accounts.sql (Prompt 929): the test accounts are a
-- sandbox. A test agent's work only reaches test VAs, real work never reaches a test VA, the AI caller and GoHighLevel
-- never see a test agent's leads, test VAs can't be on a Deedstone number, and nobody signed in can change is_test.
--
-- RUN: `npm run test:sql -- supabase/tests/p929_test_accounts.sql` (PGlite, in memory). One transaction, rolled back.
-- Never run it against Ohvara's live database.
--
-- Cast: admin Z, real agent R, test agent T, real VA RV, test VA TV (both on shift all day today).

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p929_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.fname), now(), now()
  from (values
    ('d9290000-0000-4000-8000-000000000001'::uuid, 'admin_z', 'agent', 'Zed Admin'),
    ('d9290000-0000-4000-8000-000000000002'::uuid, 'agent_r', 'agent', 'Rae Real'),
    ('d9290000-0000-4000-8000-000000000003'::uuid, 'agent_t', 'agent', 'Tess Test'),
    ('e9290000-0000-4000-8000-000000000001'::uuid, 'va_real', 'fulfillment', 'Ria Real'),
    ('e9290000-0000-4000-8000-000000000002'::uuid, 'va_test', 'fulfillment', 'Tom Test')
  ) as u(id, n, role, fname);
update public.profiles set role = 'admin' where id = 'd9290000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where role::text in ('fulfillment', 'admin')
   and id not in ('d9290000-0000-4000-8000-000000000001', 'e9290000-0000-4000-8000-000000000001',
                  'e9290000-0000-4000-8000-000000000002');
insert into public.va_shifts (va_id, shift_date, starts, ends) values
  ('e9290000-0000-4000-8000-000000000001', public.va_today(), '00:00', '23:59'),
  ('e9290000-0000-4000-8000-000000000002', public.va_today(), '00:00', '23:59');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create or replace function public.route_desk_open(p_at timestamptz default now())
returns boolean language sql stable as $$ select true $$;

-- ── a. the flag ──────────────────────────────────────────────────────────────────────────────────────────────────
update public.profiles set is_test = true
 where id in ('d9290000-0000-4000-8000-000000000003', 'e9290000-0000-4000-8000-000000000002');
select ok((select is_demo and billing_exempt and not no_answer_sms_opt_in from public.profiles
            where id = 'd9290000-0000-4000-8000-000000000003'), 'a1 a test agent is on the demo side, never billed, never texts');
select ok((select is_demo from public.profiles where id = 'e9290000-0000-4000-8000-000000000002'), 'a2 the test VA is on the demo side');
select pg_temp.as_user('d9290000-0000-4000-8000-000000000003');
select throws_ok($$ update public.profiles set is_test = false where id = 'd9290000-0000-4000-8000-000000000003' $$,
  '42501', null, 'a3 a test agent cannot switch itself off');
select pg_temp.as_user('d9290000-0000-4000-8000-000000000001');
select throws_ok($$ update public.profiles set is_test = true where id = 'd9290000-0000-4000-8000-000000000002' $$,
  '42501', null, 'a4 an admin cannot change is_test from the app');
select pg_temp.as_owner();
select ok(public.profile_is_test('d9290000-0000-4000-8000-000000000003') and not public.profile_is_test('d9290000-0000-4000-8000-000000000002'),
  'a5 profile_is_test');

-- ── b. booked calls: a test agent's go to the test VA, a real agent's to the real VA ────────────────────────────────
insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, state, status, effective_date,
                             fulfillment_assigned, scheduled_call_at)
values ('b9290000-0000-4000-8000-000000000001', 'd9290000-0000-4000-8000-000000000003', 'Test', 'Client', '5125550190', 'TX',
        'In Effect', current_date, true, date_trunc('hour', now()) + interval '2 hours'),
       ('b9290000-0000-4000-8000-000000000002', 'd9290000-0000-4000-8000-000000000002', 'Real', 'Client', '5125550191', 'TX',
        'In Effect', current_date, true, date_trunc('hour', now()) + interval '3 hours');
select ok((select is_demo from public.policies where id = 'b9290000-0000-4000-8000-000000000001'), 'b1 a test agent''s policy is on the test side');
select is((select assigned_fulfillment_id from public.policies where id = 'b9290000-0000-4000-8000-000000000001'),
  'e9290000-0000-4000-8000-000000000002'::uuid, 'b2 a test agent''s booking goes to the test VA');
select is((select assigned_fulfillment_id from public.policies where id = 'b9290000-0000-4000-8000-000000000002'),
  'e9290000-0000-4000-8000-000000000001'::uuid, 'b3 a real agent''s booking goes to the real VA');

-- ── c. the call engine: two sides ────────────────────────────────────────────────────────────────────────────────
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, assigned_rep_id, created_at)
values ('c9290000-0000-4000-8000-000000000001', 'Tina Lead', 'Tina Lead', '+15125550181', 'TX', 'mortgage_protection', 'google',
        'd9290000-0000-4000-8000-000000000003', now()),
       ('c9290000-0000-4000-8000-000000000002', 'Rory Lead', 'Rory Lead', '+15125550182', 'TX', 'mortgage_protection', 'google',
        'd9290000-0000-4000-8000-000000000002', now());
select ok(public.lead_is_test('c9290000-0000-4000-8000-000000000001') and not public.lead_is_test('c9290000-0000-4000-8000-000000000002'),
  'c1 lead_is_test follows the agent');
select pg_temp.as_user('e9290000-0000-4000-8000-000000000001'); select public.va_beat('available');
select pg_temp.as_user('e9290000-0000-4000-8000-000000000002'); select public.va_beat('available');
select pg_temp.as_owner();
update public.va_presence set idle_since = now() - interval '30 minutes' where user_id = 'e9290000-0000-4000-8000-000000000002';
update public.va_presence set idle_since = now() - interval '5 minutes' where user_id = 'e9290000-0000-4000-8000-000000000001';
insert into public.call_queue (id, kind, priority, lead_id, phone, name, status)
values ('a9290000-0000-4000-8000-000000000002', 'new_lead', 1, 'c9290000-0000-4000-8000-000000000002', '+15125550182', 'Rory Lead', 'waiting');
select is(public.route_offer('a9290000-0000-4000-8000-000000000002'), 'e9290000-0000-4000-8000-000000000001'::uuid,
  'c2 a real lead rings the real VA even though the test VA has been free longer');
insert into public.call_queue (id, kind, priority, lead_id, phone, name, status)
values ('a9290000-0000-4000-8000-000000000001', 'new_lead', 1, 'c9290000-0000-4000-8000-000000000001', '+15125550181', 'Tina Lead', 'waiting');
select is(public.route_offer('a9290000-0000-4000-8000-000000000001'), 'e9290000-0000-4000-8000-000000000002'::uuid,
  'c3 a test agent''s lead rings only the test VA');

-- ── d. the lead desk ──────────────────────────────────────────────────────────────────────────────────────────────
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at)
values ('c9290000-0000-4000-8000-000000000003', 'Una Lead', 'Una Lead', '+15125550183', 'TX', 'policy_help', 'google', now());
select pg_temp.as_user('e9290000-0000-4000-8000-000000000002');
select throws_ok($$ select public.va_claim('c9290000-0000-4000-8000-000000000003') $$, '22023', null,
  'd1 the test VA cannot take a real lead from the desk');
select is((select count(*)::int from public.va_queue() q where q.lead_id = 'c9290000-0000-4000-8000-000000000003'), 0,
  'd2 a real lead is not on the test VA''s desk');
select pg_temp.as_user('e9290000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.va_queue() q where q.lead_id = 'c9290000-0000-4000-8000-000000000003'), 1,
  'd3 the real VA still sees it');
select pg_temp.as_owner();

-- ── e. Retell and VA pods ────────────────────────────────────────────────────────────────────────────────────────
update public.leads set qualifier_answers = jsonb_build_object('consent_at', now()::text)
 where id = 'c9290000-0000-4000-8000-000000000001';
select is((select reason from public.ai_caller_takes('c9290000-0000-4000-8000-000000000001')), 'test_account',
  'e1 the AI caller never calls a test agent''s lead');
insert into public.deedstone_numbers (id, phone, label) values ('f9290000-0000-4000-8000-000000000001', '+12145550929', 'Dallas 9');
select pg_temp.as_user('d9290000-0000-4000-8000-000000000001');
select throws_ok($$ select public.admin_set_number_pod('f9290000-0000-4000-8000-000000000001',
    array['e9290000-0000-4000-8000-000000000001', 'e9290000-0000-4000-8000-000000000002']::uuid[]) $$,
  '22023', 'Test accounts can''t be on a number', 'e2 a test VA cannot be on a Deedstone number');
select pg_temp.as_owner();

select * from finish();
rollback;
