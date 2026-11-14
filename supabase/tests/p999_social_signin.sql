-- p999_social_signin — pgTAP checks for 274_social_signin.sql: Google / Apple sign-ups follow the sign-up switch,
-- an email sign-up straight to Auth is still refused, the terms step, the durable rate limit, and the admin
-- "real agents" check. ROLLBACK-ONLY, test users p999_*@example.invalid. Local: `npm run test:sql -- supabase/tests/p999_social_signin.sql`.

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create temp table u (id uuid, n text) on commit drop;
insert into u values ('99900000-0000-4000-8000-000000000001', 'g_closed'), ('99900000-0000-4000-8000-000000000002', 'g_open'),
  ('99900000-0000-4000-8000-000000000003', 'a_open'), ('99900000-0000-4000-8000-000000000004', 'mail'),
  ('99900000-0000-4000-8000-000000000005', 'admin'), ('99900000-0000-4000-8000-000000000006', 'busy');
grant select on u to authenticated;

create or replace function pg_temp.mk(p_id uuid, p_n text, p_app jsonb, p_user jsonb) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', 'p999_' || p_n || '@example.invalid', p_app, p_user, now(), now())
$$;

-- ── a. Google / Apple follow the switch ─────────────────────────────────────
update public.app_settings set self_signup_open = false where id = 1;
select throws_ok($$ select pg_temp.mk('99900000-0000-4000-8000-000000000001', 'g_closed', '{"provider":"google","providers":["google"]}', '{"full_name":"G Closed"}') $$,
  '42501', NULL, 'a1 Google sign-up refused while sign-up is off');

update public.app_settings set self_signup_open = true where id = 1;
select lives_ok($$ select pg_temp.mk('99900000-0000-4000-8000-000000000002', 'g_open', '{"provider":"google","providers":["google"]}', '{"name":"Gina Open"}') $$,
  'a2 Google sign-up works while sign-up is on');
select is((select role::text || '/' || signup_source || '/' || full_name from public.profiles where id = '99900000-0000-4000-8000-000000000002'),
  'agent/self/Gina Open', 'a3 it is a self-signup agent, named from Google');
select ok((select terms_accepted_at is null from public.profiles where id = '99900000-0000-4000-8000-000000000002'), 'a4 terms not yet accepted');
select lives_ok($$ select pg_temp.mk('99900000-0000-4000-8000-000000000003', 'a_open', '{"provider":"apple","providers":["apple"]}', '{}') $$,
  'a5 Apple sign-up works while sign-up is on');
select is((select full_name from public.profiles where id = '99900000-0000-4000-8000-000000000003'), 'p999_a_open@example.invalid', 'a6 no name from Apple: the email stands in');
select throws_ok($$ select pg_temp.mk('99900000-0000-4000-8000-000000000004', 'mail', '{"provider":"email","providers":["email"]}', '{"iss":"https://accounts.google.com","full_name":"Sneaky"}') $$,
  '42501', NULL, 'a7 an email sign-up straight to Auth is still refused, even claiming Google in user_metadata');
select throws_ok($$ select pg_temp.mk('99900000-0000-4000-8000-000000000004', 'mail', '{"provider":"email","providers":["email"],"role":"admin"}', '{}') $$,
  '42501', NULL, 'a8 no admin accounts from a sign-up');

-- ── b. Terms step ───────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.accept_signup_terms(text)', 'execute'), 'b1 anon cannot accept terms');
select set_config('request.jwt.claims', '{"sub":"99900000-0000-4000-8000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);
select is(public.accept_signup_terms('2026-10-30'), true, 'b2 the new agent accepts the terms');
select is(public.accept_signup_terms('2099-01-01'), false, 'b3 a second call changes nothing');
reset role;
select is((select terms_version from public.profiles where id = '99900000-0000-4000-8000-000000000002'), '2026-10-30', 'b4 the version stuck');

-- ── c. Rate limit ───────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.rate_hit(text, text, integer, integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.rate_hit(text, text, integer, integer)', 'execute'), 'c1 only the service role can count');
select is(array[public.rate_hit('t', 'k', 2, 60), public.rate_hit('t', 'k', 2, 60), public.rate_hit('t', 'k', 2, 60)], array[false, false, true], 'c2 the third hit of max 2 is over');
select is(public.rate_hit('t', 'other', 2, 60), false, 'c3 keys are counted apart');

-- ── d. Real agents ──────────────────────────────────────────────────────────
select pg_temp.mk('99900000-0000-4000-8000-000000000006', 'busy', '{"provider":"google","providers":["google"]}', '{}');
update public.profiles set billing_exempt = true where id = '99900000-0000-4000-8000-000000000006';
insert into public.pending_signups (email, role) values ('p999_admin@example.invalid', 'fulfillment');
select pg_temp.mk('99900000-0000-4000-8000-000000000005', 'admin', '{"provider":"email"}', '{}');
update public.profiles set role = 'admin' where id = '99900000-0000-4000-8000-000000000005';
select ok(not has_function_privilege('anon', 'public.admin_agent_activity()', 'execute'), 'd1 anon cannot read activity');
select set_config('request.jwt.claims', '{"sub":"99900000-0000-4000-8000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);
select throws_ok($$ select * from public.admin_agent_activity() $$, '42501', NULL, 'd2 an agent cannot read it');
select set_config('request.jwt.claims', '{"sub":"99900000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is((select paying or active from public.admin_agent_activity() a where a.agent_id = '99900000-0000-4000-8000-000000000002'), false,
  'd3 a sign-up that did nothing is neither paying nor active');
select is((select paying from public.admin_agent_activity() a where a.agent_id = '99900000-0000-4000-8000-000000000006'), true,
  'd4 a comped agent counts as paying');
reset role;

select * from finish();
rollback;
