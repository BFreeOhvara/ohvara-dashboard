-- p1013_hidden_accounts — pgTAP checks for 276_hidden_accounts.sql: test accounts and agents who signed up but never
-- paid are invisible to everyone else (staff directory, Messages lines, people lists), in the database.
--
-- ROLLBACK-ONLY: one transaction that ends in ROLLBACK; it makes its own users (p1013_*@example.invalid) and never
-- touches a real account. Local run: `npm run test:sql -- supabase/tests/p1013_hidden_accounts.sql` (in-memory PGlite).
--
-- Cast: Z admin, P paying agent (comped), Q paid-before agent (canceled), N non-paying sign-up, F real VA, G real VA 2,
-- TA test agent, TV test VA.

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p1013_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'P1013 ' || u.n), now(), now()
  from (values
    ('a1013000-0000-4000-8000-00000000000a'::uuid, 'Z',  'agent'),
    ('a1013000-0000-4000-8000-00000000000b'::uuid, 'P',  'agent'),
    ('a1013000-0000-4000-8000-00000000000c'::uuid, 'Q',  'agent'),
    ('a1013000-0000-4000-8000-00000000000d'::uuid, 'N',  'agent'),
    ('a1013000-0000-4000-8000-00000000000e'::uuid, 'TA', 'agent'),
    ('a1013000-0000-4000-8000-0000000000f1'::uuid, 'F',  'fulfillment'),
    ('a1013000-0000-4000-8000-0000000000f2'::uuid, 'G',  'fulfillment'),
    ('a1013000-0000-4000-8000-0000000000f3'::uuid, 'TV', 'fulfillment')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'a1013000-0000-4000-8000-00000000000a';
-- Everyone else the replay made is switched off, so the counts below are only this cast.
update public.profiles set is_active = false where full_name not like 'P1013 %';
update public.profiles set role = 'fulfillment' where id in ('a1013000-0000-4000-8000-0000000000f1', 'a1013000-0000-4000-8000-0000000000f2', 'a1013000-0000-4000-8000-0000000000f3');
update public.profiles set is_active = true where full_name like 'P1013 %';
update public.profiles set billing_exempt = true where id = 'a1013000-0000-4000-8000-00000000000b';
update public.profiles set billing_status = 'canceled' where id = 'a1013000-0000-4000-8000-00000000000c';
update public.profiles set billing_exempt = false, billing_status = 'none', signup_source = 'self' where id = 'a1013000-0000-4000-8000-00000000000d';
update public.profiles set is_test = true where id in ('a1013000-0000-4000-8000-00000000000e', 'a1013000-0000-4000-8000-0000000000f3');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;

-- a. who is listed (as the owner)
select is(public.profile_listed('a1013000-0000-4000-8000-00000000000b'), true,  'a1 a comped agent is listed');
select is(public.profile_listed('a1013000-0000-4000-8000-00000000000c'), true,  'a2 an agent who paid before is listed');
select is(public.profile_listed('a1013000-0000-4000-8000-00000000000d'), false, 'a3 a sign-up who never paid is not listed');
select is(public.profile_listed('a1013000-0000-4000-8000-00000000000e'), false, 'a4 the test agent is not listed');
select is(public.profile_listed('a1013000-0000-4000-8000-0000000000f3'), false, 'a5 the test VA is not listed');
select is(public.profile_listed('a1013000-0000-4000-8000-0000000000f1'), true,  'a6 a real VA is listed');
select ok(not has_function_privilege('authenticated', 'public.my_standing_threads_p1013()', 'execute'), 'a7 the unfiltered Messages lines are server-only');
select ok(not has_function_privilege('authenticated', 'public.admin_list_profiles_p1013()', 'execute'), 'a8 the unfiltered people list is server-only');
select ok(not has_function_privilege('anon', 'public.my_standing_threads()', 'execute'), 'a9 anon cannot list Messages lines');

-- b. a real VA
select pg_temp.as_user('a1013000-0000-4000-8000-0000000000f1');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.profiles where full_name like 'P1013 %'), 'F,G,P,Q,Z', 'b1 VA directory: no test account, no non-paying sign-up');
select is((select coalesce(string_agg(distinct substr(agent_name, 7), ',' order by substr(agent_name, 7)), '') from public.my_standing_threads() where agent_id <> auth.uid() and agent_role = 'agent'), '', 'b2 VA Messages: no agent lines at all (P1018: VAs and agents talk in client conversations)');
select is((select coalesce(string_agg(distinct substr(case when agent_id = auth.uid() then peer_name else agent_name end, 7), ',' order by substr(case when agent_id = auth.uid() then peer_name else agent_name end, 7)), '') from public.my_standing_threads() where agent_role = 'fulfillment' and peer_id is not null),
          'G', 'b3 VA to VA lines: never the test VA');
select is((select count(*)::int from public.my_standing_threads() where peer_key = 'admin'), 1, 'b4 VA keeps the Ohvara Support line');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.va_agent_roster()), 'P,Q', 'b5 the VA agent list: listed agents only');
reset role;

-- c. a paying agent
select pg_temp.as_user('a1013000-0000-4000-8000-00000000000b');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.profiles where full_name like 'P1013 %'), 'F,G,P,Q,Z', 'c1 agent directory: no test account, no non-paying sign-up');
select is((select coalesce(string_agg(distinct substr(peer_name, 7), ',' order by substr(peer_name, 7)), '') from public.my_standing_threads() where peer_id is not null), '', 'c2 agent Messages: no VA lines (P1018)');
select is((select count(*)::int from public.my_standing_threads() where peer_key = 'admin'), 1, 'c3 agent keeps the Ohvara Support line');
reset role;

-- d. the admin
select pg_temp.as_user('a1013000-0000-4000-8000-00000000000a');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.profiles where full_name like 'P1013 %'), 'F,G,N,P,Q,Z', 'd1 admin directory: non-paying sign-up readable (for its one place), test accounts not');
select is((select coalesce(string_agg(distinct substr(agent_name, 7), ',' order by substr(agent_name, 7)), '') from public.my_standing_threads()), 'F,G,P,Q', 'd2 admin Messages: no test account, no empty line for a non-paying sign-up');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.admin_list_profiles() where full_name like 'P1013 %'), 'F,G,N,P,Q,Z', 'd3 admin people list: no test account');
select is((select listed from public.admin_agent_activity() where agent_id = 'a1013000-0000-4000-8000-00000000000d'), false, 'd4 the non-paying sign-up is marked not listed');
select is((select listed from public.admin_agent_activity() where agent_id = 'a1013000-0000-4000-8000-00000000000b'), true, 'd5 a paying agent is listed');
select is((select count(*)::int from public.admin_agent_activity() where agent_id = 'a1013000-0000-4000-8000-00000000000e'), 0, 'd6 the test agent is not in the activity list');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.va_shifts_today()), '', 'd7 nobody on the rota today (no shifts), and no error');
reset role;

-- e. the non-paying sign-up writes to Ohvara Support: the admin sees that line, nobody else sees them
insert into public.direct_messages (agent_id, peer_id, sender_id, body)
values ('a1013000-0000-4000-8000-00000000000d', null, 'a1013000-0000-4000-8000-00000000000d', 'Help, my card was declined');
insert into public.direct_messages (agent_id, peer_id, sender_id, body)
values ('a1013000-0000-4000-8000-00000000000e', null, 'a1013000-0000-4000-8000-00000000000e', 'test ping');
select pg_temp.as_user('a1013000-0000-4000-8000-00000000000a');
select is((select coalesce(string_agg(distinct substr(agent_name, 7), ',' order by substr(agent_name, 7)), '') from public.my_standing_threads()), 'F,G,N,P,Q', 'e1 admin sees the sign-up''s support message, never the test account''s');
select is((select unread_count from public.my_standing_threads() where agent_id = 'a1013000-0000-4000-8000-00000000000d'), 1, 'e2 and it counts as unread');
reset role;
select pg_temp.as_user('a1013000-0000-4000-8000-0000000000f1');
select is((select count(*)::int from public.my_standing_threads() where agent_id = 'a1013000-0000-4000-8000-00000000000d'), 0, 'e3 a VA still never sees the sign-up');
reset role;

-- f. the hidden accounts themselves still work
select pg_temp.as_user('a1013000-0000-4000-8000-00000000000e');
select is((select count(*)::int from public.profiles where id = auth.uid()), 1, 'f1 the test agent reads its own profile');
reset role;
select pg_temp.as_user('a1013000-0000-4000-8000-00000000000d');
select is((select count(*)::int from public.profiles where id = auth.uid()), 1, 'f2 the sign-up reads its own profile');
select is((select count(*)::int from public.my_standing_threads() where peer_key = 'admin'), 1, 'f3 the sign-up keeps its Ohvara Support line');
reset role;
select pg_temp.as_user('a1013000-0000-4000-8000-0000000000f3');
select is((select count(*)::int from public.profiles where id = auth.uid()), 1, 'f4 the test VA reads its own profile');
select is((select count(*)::int from public.va_agent_roster() where id = 'a1013000-0000-4000-8000-00000000000e'), 0, 'f5 roster: the test agent is not listed even to a test VA (sample info there)');
reset role;

-- g. the moment the sign-up pays, they show normally
update public.profiles set billing_status = 'active' where id = 'a1013000-0000-4000-8000-00000000000d';
select pg_temp.as_user('a1013000-0000-4000-8000-0000000000f1');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.profiles where full_name like 'P1013 %'), 'F,G,N,P,Q,Z', 'g1 paid: the VA reads them');
select is((select coalesce(string_agg(distinct substr(full_name, 7), ',' order by substr(full_name, 7)), '') from public.va_agent_roster()), 'N,P,Q', 'g2 paid: on the VA agent list');
select is((select count(*)::int from public.my_standing_threads() where agent_id = 'a1013000-0000-4000-8000-00000000000d'), 0, 'g3 paid: still no direct line with a VA (P1018)');
reset role;
select pg_temp.as_user('a1013000-0000-4000-8000-00000000000a');
select is((select listed from public.admin_agent_activity() where agent_id = 'a1013000-0000-4000-8000-00000000000d'), true, 'g4 paid: listed for the admin');
reset role;

-- h. the same rule in the other lists
select ok(exists (select 1 from pg_proc where proname = 'on_duty_agents_p1013'), 'h1 on duty wrapped');
select ok(exists (select 1 from pg_proc where proname = 'team_activity_p1013'), 'h2 team feed wrapped');
select ok(exists (select 1 from pg_proc where proname = 'agent_activity_feed_p1013'), 'h3 activity feed wrapped');
select ok(exists (select 1 from pg_proc where proname = 'va_shift_week_p1013'), 'h4 VA rota wrapped');

select * from finish();
rollback;
