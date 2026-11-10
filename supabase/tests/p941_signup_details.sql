-- p941_signup_details — pgTAP checks for 264_signup_details.sql: the locked (unpaid) agent saves their sign-up details
-- before paying; nothing half-saves; the gate lists what's missing; the ticket facts carry the sign-up; the launch
-- checks are the seven plain keys. ROLLBACK-ONLY: makes its own test users (p941_*@example.invalid), never reads a
-- real account. Local: `npm run test:sql -- supabase/tests/p941_signup_details.sql` (PGlite, no network).

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into public.pending_signups (email, role, source, terms_version, terms_accepted_at)
values ('p941_locked@example.invalid', 'agent', 'self', '2026-10-30', now()),
       ('p941_paid@example.invalid', 'agent', 'self', '2026-10-30', now());
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p941_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values ('94100000-0000-4000-8000-000000000001'::uuid, 'locked'),
               ('94100000-0000-4000-8000-000000000002'::uuid, 'paid')) u(id, n);
update public.profiles set is_active = true where id in ('94100000-0000-4000-8000-000000000001', '94100000-0000-4000-8000-000000000002');
insert into public.agent_billing_plans (agent_id, setup_paid_at) values ('94100000-0000-4000-8000-000000000002', now())
on conflict (agent_id) do update set setup_paid_at = now();

-- ── a. before anything is saved ─────────────────────────────────────────────
select is(public.signup_details_missing('94100000-0000-4000-8000-000000000001'), array['states', 'licence', 'timezone', 'hours'],
          'a1 a new sign-up is missing states, licence, time zone and hours');
select ok(not has_function_privilege('authenticated', 'public.signup_details_missing(uuid)', 'execute'), 'a2 agents cannot call the gate');
select ok(has_function_privilege('service_role', 'public.signup_details_missing(uuid)', 'execute'), 'a3 the service role can');
select ok(not has_function_privilege('anon', 'public.save_signup_details(jsonb)', 'execute'), 'a4 anon cannot save');
select ok(not has_function_privilege('authenticated', 'public.agent_launch_facts(uuid)', 'execute'), 'a5 facts stay closed to agents');

-- ── b. as the locked agent ──────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"94100000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), true, 'b1 the test agent is a locked self-signup');

create temp table good on commit drop as select jsonb_build_object(
  'states', jsonb_build_array('tx', 'OK', 'LA'), 'licensed', true, 'timezone', 'America/Chicago',
  'working_hours', jsonb_build_array(jsonb_build_object('weekday', 1, 'start', '09:00', 'end', '17:00'),
                                     jsonb_build_object('weekday', 2, 'start', '08:30', 'end', '18:00')),
  'live_transfers', true, 'live_transfer_phone', '+15125550142') as p;

select throws_ok($$ select public.save_signup_details((select p from good) || '{"states": ["TX", "OK"]}') $$, '22023', 'Pick 3 to 10 states', 'b2 two states refused');
select throws_ok($$ select public.save_signup_details((select p from good) || '{"states": ["TX", "OK", "NY"]}') $$, '22023', 'We aren''t taking NY yet', 'b3 New York refused');
select throws_ok($$ select public.save_signup_details((select p from good) || '{"licensed": false}') $$, '22023', NULL, 'b4 no licence tick refused');
select throws_ok($$ select public.save_signup_details((select p from good) || '{"timezone": "Mars/Base"}') $$, '22023', 'Pick your time zone', 'b5 bad time zone refused');
select throws_ok($$ select public.save_signup_details((select p from good) || '{"working_hours": []}') $$, '22023', 'Set the hours you take calls', 'b6 no hours refused');
select throws_ok($$ select public.save_signup_details((select p from good) || '{"live_transfer_phone": "555"}') $$, '22023', NULL, 'b7 live transfers need a real phone');
select throws_ok($$ select public.save_signup_details((select p from good) - 'live_transfers') $$, '22023', 'Say whether you take live transfers', 'b8 live transfers yes/no required');
select throws_ok($$ select public.save_signup_details((select p from good) || '{"extra": 1}') $$, '22023', 'Unknown detail: extra', 'b9 unknown keys refused');
select is((select count(*)::int from public.agent_working_hours where agent_id = auth.uid()), 0, 'b10 nothing half-saved after refusals');

select lives_ok($$ select public.save_signup_details((select p from good)) $$, 'b11 a complete sign-up saves while locked');
select is((public.my_signup_details() ->> 'missing'), '[]', 'b12 nothing missing now');
select is((public.my_signup_details() -> 'states'), '["LA", "OK", "TX"]'::jsonb, 'b13 states saved upper-case, sorted');
select is((public.my_signup_details() ->> 'licensed')::boolean, true, 'b14 licence tick saved');
select is((public.my_signup_details() ->> 'timezone'), 'America/Chicago', 'b15 time zone saved');
select is(jsonb_array_length(public.my_signup_details() -> 'workingHours'), 2, 'b16 two days of hours');
select is((public.my_signup_details() ->> 'phone'), '+15125550142', 'b17 transfer phone saved');
select throws_ok($$ insert into public.agent_lead_settings (agent_id, states) values (auth.uid(), '{TX}') on conflict (agent_id) do update set states = '{TX}' $$,
                 '42501', NULL, 'b18 the locked guard still blocks a direct write');
select lives_ok($$ select public.save_signup_details((select p from good) || '{"live_transfers": false, "live_transfer_phone": null}') $$, 'b19 appointments only saves');
select is((public.my_signup_details() ->> 'liveTransfers')::boolean, false, 'b20 no live transfers clears the phone');
reset role;

-- ── c. the ticket facts and the plain checks ────────────────────────────────
select is(public.agent_launch_facts('94100000-0000-4000-8000-000000000001') -> 'launch' ->> 'licence', 'true', 'c1 the tick counts as the licence');
select is(public.agent_launch_facts('94100000-0000-4000-8000-000000000001') -> 'signup' ->> 'tz', 'America/Chicago', 'c2 the sign-up block carries the time zone');
select is(jsonb_array_length(public.agent_launch_facts('94100000-0000-4000-8000-000000000001') -> 'signup' -> 'hours'), 2, 'c3 and the hours by day');
select is(public.agent_launch_checks('94100000-0000-4000-8000-000000000001') -> 'failed', '["paid", "link", "testLead", "testCall"]'::jsonb,
          'c4 seven plain keys: states and hours pass, paid/link/test lead/test call fail (appointments only: no app check)');
select is(public.launch_check_words('profile'), 'States picked', 'c5 an old paused key still reads in words');

-- ── d. after paying, the pre-payment save is closed ─────────────────────────
select set_config('request.jwt.claims', '{"sub":"94100000-0000-4000-8000-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.save_signup_details((select p from good)) $$, 'P0001', 'You''ve already signed up. Change these in Settings.', 'd1 a paid agent changes these in Settings');
reset role;

select * from finish();
rollback;
