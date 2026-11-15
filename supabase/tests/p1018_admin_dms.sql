-- p1018_admin_dms — pgTAP checks for 280_admin_dms.sql: Messages, who sees whom (Brayden, Nov 15 15:49).
--   Admins: every admin, every VA, every paying agent, every conversation. VAs: Support, other VAs, client
--   conversations (any VA). Agents: Support and their own client conversations. Test and never-paid: nobody.
--
-- ROLLBACK-ONLY: one transaction that ends in ROLLBACK; makes its own users (p1018_*@example.invalid).
-- Local run: `npm run test:sql -- supabase/tests/p1018_admin_dms.sql` (in-memory PGlite).
--
-- Cast: Z admin (Brayden), J admin (brand new, billing none, like Jordan), TZ test admin, P paying agent (comped),
-- Q second paying agent, N never-paid sign-up, F VA, G second VA (just signed up), TV test VA.
-- Clients: CP (P's, assigned to F), CQ (Q's, assigned to G), CN (N's).

begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p1018_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'P1018 ' || u.n), now(), now()
  from (values
    ('b1018000-0000-4000-8000-00000000000a'::uuid, 'Z',  'agent'),
    ('b1018000-0000-4000-8000-00000000000b'::uuid, 'J',  'agent'),
    ('b1018000-0000-4000-8000-00000000000c'::uuid, 'TZ', 'agent'),
    ('b1018000-0000-4000-8000-00000000000d'::uuid, 'P',  'agent'),
    ('b1018000-0000-4000-8000-0000000000d2'::uuid, 'Q',  'agent'),
    ('b1018000-0000-4000-8000-00000000000e'::uuid, 'N',  'agent'),
    ('b1018000-0000-4000-8000-0000000000f1'::uuid, 'F',  'fulfillment'),
    ('b1018000-0000-4000-8000-0000000000f2'::uuid, 'G',  'fulfillment'),
    ('b1018000-0000-4000-8000-0000000000f3'::uuid, 'TV', 'fulfillment')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id in ('b1018000-0000-4000-8000-00000000000a', 'b1018000-0000-4000-8000-00000000000b', 'b1018000-0000-4000-8000-00000000000c');
update public.profiles set is_active = false where full_name not like 'P1018 %';
update public.profiles set role = 'fulfillment' where id in ('b1018000-0000-4000-8000-0000000000f1', 'b1018000-0000-4000-8000-0000000000f2', 'b1018000-0000-4000-8000-0000000000f3');
update public.profiles set is_active = true where full_name like 'P1018 %';
update public.profiles set billing_exempt = false, billing_status = 'none' where id in ('b1018000-0000-4000-8000-00000000000b', 'b1018000-0000-4000-8000-0000000000f2');
update public.profiles set billing_exempt = true where id in ('b1018000-0000-4000-8000-00000000000d', 'b1018000-0000-4000-8000-0000000000d2');
update public.profiles set billing_exempt = false, billing_status = 'none', signup_source = 'self' where id = 'b1018000-0000-4000-8000-00000000000e';
update public.profiles set is_test = true where id in ('b1018000-0000-4000-8000-00000000000c', 'b1018000-0000-4000-8000-0000000000f3');

insert into public.policies (id, agent_id, client_first_name, client_last_name, status, fulfillment_assigned, assigned_fulfillment_id, scheduled_call_at, fulfillment_stage) values
  ('c1018000-0000-4000-8000-0000000000a1', 'b1018000-0000-4000-8000-00000000000d', 'Cara', 'Pine',  'In Effect', true, 'b1018000-0000-4000-8000-0000000000f1', now() + interval '1 day', 'Pending'),
  ('c1018000-0000-4000-8000-0000000000a2', 'b1018000-0000-4000-8000-0000000000d2', 'Cole', 'Quinn', 'In Effect', true, 'b1018000-0000-4000-8000-0000000000f2', now() + interval '1 day', 'Pending'),
  ('c1018000-0000-4000-8000-0000000000a3', 'b1018000-0000-4000-8000-00000000000e', 'Cy',   'Noon',  'In Effect', true, 'b1018000-0000-4000-8000-0000000000f1', now() + interval '1 day', 'Pending');
insert into public.policy_messages (policy_id, sender_id, body) values
  ('c1018000-0000-4000-8000-0000000000a1', 'b1018000-0000-4000-8000-00000000000d', 'About Cara'),
  ('c1018000-0000-4000-8000-0000000000a2', 'b1018000-0000-4000-8000-0000000000d2', 'About Cole'),
  ('c1018000-0000-4000-8000-0000000000a3', 'b1018000-0000-4000-8000-00000000000e', 'About Cy');
-- old-style agent -> VA line and a VA pair with a message
insert into public.direct_messages (agent_id, peer_id, sender_id, body) values
  ('b1018000-0000-4000-8000-00000000000d', 'b1018000-0000-4000-8000-0000000000f1', 'b1018000-0000-4000-8000-00000000000d', 'old agent to VA'),
  ('b1018000-0000-4000-8000-0000000000f1', 'b1018000-0000-4000-8000-0000000000f2', 'b1018000-0000-4000-8000-0000000000f1', 'VA to VA');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
-- each of my lines as "<left>-<right>" by cast letter (SUP = Ohvara Support); clients as their first names
create function pg_temp.lines() returns text language sql as $$
  select coalesce(string_agg(x, ',' order by x), '') from (
    select case when peer_id is null then substr(agent_name, 7) || '-SUP'
                else substr(agent_name, 7) || '-' || substr(peer_name, 7) end as x
      from public.my_standing_threads()) s;
$$;
create function pg_temp.clients() returns text language sql as $$
  select coalesce(string_agg(client_first_name, ',' order by client_first_name), '') from public.my_message_threads();
$$;

-- a. Z (admin)
select pg_temp.as_user('b1018000-0000-4000-8000-00000000000a');
select is(pg_temp.lines(), 'F-G,F-SUP,G-SUP,P-SUP,Q-SUP,Z-J', 'a1 admin: the other admin, every VA and paying agent''s Support line, the VA pair with messages; no test or never-paid');
select is(pg_temp.clients(), 'Cara,Cole', 'a2 admin: every client conversation, never a never-paid agent''s');
select is((select unread_count from public.my_standing_threads() where peer_name = 'P1018 G'), 0, 'a3 a VA pair the admin only watches has no unread');
select is((select count(*)::int from public.direct_messages where agent_id = 'b1018000-0000-4000-8000-0000000000f1' and peer_id is not null), 1, 'a4 the admin can read the VA pair');
select throws_ok($$ insert into public.direct_messages (agent_id, peer_id, sender_id, body)
                    values ('b1018000-0000-4000-8000-0000000000f1', 'b1018000-0000-4000-8000-0000000000f2', 'b1018000-0000-4000-8000-00000000000a', 'x') $$,
                 '42501', null, 'a5 but cannot write into it');
select ok(not public.can_dm_thread('b1018000-0000-4000-8000-00000000000a', 'b1018000-0000-4000-8000-00000000000c'), 'a6 never a line with the test admin');
select lives_ok($$ insert into public.direct_messages (agent_id, peer_id, sender_id, body)
                   values ('b1018000-0000-4000-8000-00000000000a', 'b1018000-0000-4000-8000-00000000000b', 'b1018000-0000-4000-8000-00000000000a', 'Hi Jordan') $$,
                'a7 Z writes to J');
select lives_ok($$ insert into public.policy_messages (policy_id, sender_id, body)
                   values ('c1018000-0000-4000-8000-0000000000a2', 'b1018000-0000-4000-8000-00000000000a', 'admin note') $$,
                'a8 an admin can answer a client conversation');

-- b. J (the new admin) sees Z straight away, with the message unread
select pg_temp.as_user('b1018000-0000-4000-8000-00000000000b');
select is(pg_temp.lines(), 'F-G,F-SUP,G-SUP,P-SUP,Q-SUP,Z-J', 'b1 new admin: same list');
select is((select last_body from public.my_standing_threads() where peer_name = 'P1018 J'), 'Hi Jordan', 'b2 J sees Z''s message');
select is((select unread_count from public.my_standing_threads() where peer_name = 'P1018 J'), 1, 'b3 unread');
select lives_ok($$ insert into public.direct_messages (agent_id, peer_id, sender_id, body)
                   values ('b1018000-0000-4000-8000-00000000000a', 'b1018000-0000-4000-8000-00000000000b', 'b1018000-0000-4000-8000-00000000000b', 'Hey Brayden') $$,
                'b4 J answers');
select lives_ok($$ insert into public.direct_message_reads (agent_id, peer_key, profile_id, last_read_at)
                   values ('b1018000-0000-4000-8000-00000000000a', 'b1018000-0000-4000-8000-00000000000b', 'b1018000-0000-4000-8000-00000000000b', now() + interval '1 second') $$,
                'b5 J marks it read');
select is((select unread_count from public.my_standing_threads() where peer_name = 'P1018 J'), 0, 'b6 read clears the badge');

-- c. F (VA): Support, the other VA, client conversations; no agents, no test VA
select pg_temp.as_user('b1018000-0000-4000-8000-0000000000f1');
select is(pg_temp.lines(), 'F-G,F-SUP', 'c1 VA: Ohvara Support and the other VA only (no agents, no test VA)');
select is(pg_temp.clients(), 'Cara,Cole', 'c2 VA: every client conversation, including one assigned to another VA; never a never-paid agent''s');
select is((select unread_count from public.my_message_threads() where client_first_name = 'Cole'), 2, 'c3 the other VA''s client counts as unread for me too');
select lives_ok($$ insert into public.policy_messages (policy_id, sender_id, body)
                   values ('c1018000-0000-4000-8000-0000000000a2', 'b1018000-0000-4000-8000-0000000000f1', 'I can take this') $$,
                'c4 any VA can pick a client conversation up');
select is((select count(*)::int from public.direct_messages where agent_id = 'b1018000-0000-4000-8000-00000000000d' and peer_id is not null), 0, 'c5 the old agent line is not readable');
select throws_ok($$ insert into public.direct_messages (agent_id, peer_id, sender_id, body)
                    values ('b1018000-0000-4000-8000-00000000000d', 'b1018000-0000-4000-8000-0000000000f1', 'b1018000-0000-4000-8000-0000000000f1', 'x') $$,
                 '42501', null, 'c6 a VA cannot write to an agent directly');
select is((select count(*)::int from public.direct_messages where peer_id = 'b1018000-0000-4000-8000-00000000000b'), 0, 'c7 a VA cannot read the admin line');
select lives_ok($$ insert into public.direct_messages (agent_id, peer_id, sender_id, body)
                   values ('b1018000-0000-4000-8000-0000000000f1', null, 'b1018000-0000-4000-8000-0000000000f1', 'Hi support') $$,
                'c8 a VA writes to Ohvara Support');

-- d. G (VA, just signed up) sees F at once
select pg_temp.as_user('b1018000-0000-4000-8000-0000000000f2');
select is(pg_temp.lines(), 'F-G,G-SUP', 'd1 a new VA has the other VA from account creation');

-- e. P (paying agent): Support and own clients only
select pg_temp.as_user('b1018000-0000-4000-8000-00000000000d');
select is(pg_temp.lines(), 'P-SUP', 'e1 agent: only Ohvara Support (no VAs, no agents)');
select is(pg_temp.clients(), 'Cara', 'e2 agent: only their own client conversations');
select throws_ok($$ insert into public.direct_messages (agent_id, peer_id, sender_id, body)
                    values ('b1018000-0000-4000-8000-00000000000d', 'b1018000-0000-4000-8000-0000000000f1', 'b1018000-0000-4000-8000-00000000000d', 'x') $$,
                 '42501', null, 'e3 an agent cannot write to a VA directly');
select throws_ok($$ insert into public.policy_messages (policy_id, sender_id, body)
                    values ('c1018000-0000-4000-8000-0000000000a2', 'b1018000-0000-4000-8000-00000000000d', 'x') $$,
                 '42501', null, 'e4 nor into another agent''s client conversation');
select is((select count(*)::int from public.policy_messages where policy_id = 'c1018000-0000-4000-8000-0000000000a2'), 0, 'e5 nor read it');
select is((select count(*)::int from public.my_message_threads() where agent_id <> auth.uid()), 0, 'e6 an agent never gets another agent''s conversation');

-- f. Q (second paying agent) and N (never paid)
select pg_temp.as_user('b1018000-0000-4000-8000-0000000000d2');
select is(pg_temp.lines() || '|' || pg_temp.clients(), 'Q-SUP|Cole', 'f1 second agent: Support + own client');
select pg_temp.as_user('b1018000-0000-4000-8000-00000000000e');
select is(pg_temp.lines() || '|' || pg_temp.clients(), 'N-SUP|Cy', 'f2 a never-paid agent still has their own Support line and client');

-- g. test accounts
select pg_temp.as_user('b1018000-0000-4000-8000-00000000000c');
select is(pg_temp.lines(), 'F-G,F-SUP,G-SUP,P-SUP,Q-SUP', 'g1 the test admin has no line with a real admin (test accounts read sample info)');
select pg_temp.as_user('b1018000-0000-4000-8000-0000000000f3');
select is(pg_temp.lines(), 'TV-SUP', 'g2 the test VA keeps its Support line; no real VA pairs');

-- h. Ohvara Support: the admins see who wrote
select pg_temp.as_user('b1018000-0000-4000-8000-00000000000a');
select is((select last_body from public.my_standing_threads() where agent_name = 'P1018 F' and peer_id is null), 'Hi support', 'h1 the VA''s Support message reaches the admins');
select is((select sender_name from public.direct_messages where body = 'Hi support'), 'P1018 F', 'h2 with the real name of who wrote');
select is((select unread_count from public.my_standing_threads() where agent_name = 'P1018 F' and peer_id is null), 1, 'h3 unread for the admin');
reset role;
select ok(not has_function_privilege('authenticated', 'public.my_standing_threads_p1013()', 'execute'), 'h4 the unfiltered lines stay server-only');
select ok(not has_function_privilege('anon', 'public.admin_ghl_heard()', 'execute'), 'h5 anon cannot read the GoHighLevel checks');
select pg_temp.as_user('b1018000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.admin_ghl_heard() $$, '42501', null, 'h6 a VA cannot read the GoHighLevel checks');

select * from finish();
rollback;
