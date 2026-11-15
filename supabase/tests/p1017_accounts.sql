-- p1017_accounts — pgTAP checks for 278_admin_pending_signup.sql + 279_p1017_accounts.sql: sample data per account,
-- deleting an account frees its email for every role and every way back in, the owner fixes roles and invite roles.
--
-- ROLLBACK-ONLY: one transaction that ends in ROLLBACK; its own users (p1017_*@example.invalid), never a real account.
-- Local run: `npm run test:sql -- supabase/tests/p1017_accounts.sql` (in-memory PGlite).
--
-- Cast: O owner admin, J admin, K admin, A agent, V VA, W VA 2, T test agent.

begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p1017_' || lower(u.n) || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'P1017 ' || u.n), now(), now()
  from (values
    ('a1017000-0000-4000-8000-00000000000a'::uuid, 'O', 'agent'),
    ('a1017000-0000-4000-8000-00000000000b'::uuid, 'J', 'agent'),
    ('a1017000-0000-4000-8000-00000000000c'::uuid, 'K', 'agent'),
    ('a1017000-0000-4000-8000-00000000000d'::uuid, 'A', 'agent'),
    ('a1017000-0000-4000-8000-00000000000e'::uuid, 'V', 'fulfillment'),
    ('a1017000-0000-4000-8000-00000000000f'::uuid, 'W', 'fulfillment'),
    ('a1017000-0000-4000-8000-000000000010'::uuid, 'T', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id in ('a1017000-0000-4000-8000-00000000000a', 'a1017000-0000-4000-8000-00000000000b', 'a1017000-0000-4000-8000-00000000000c');
update public.profiles set is_owner = (id = 'a1017000-0000-4000-8000-00000000000a') where role = 'admin';
update public.profiles set role = 'fulfillment' where id in ('a1017000-0000-4000-8000-00000000000e', 'a1017000-0000-4000-8000-00000000000f');
update public.profiles set is_test = true where id = 'a1017000-0000-4000-8000-000000000010';
-- Everyone else the replay made is switched off, so "the last admin" is only this cast.
update public.profiles set is_active = false where full_name not like 'P1017 %';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', '', true), set_config('role', 'postgres', true);
$$;
create function pg_temp.sees(p uuid) returns boolean language sql as $$
  select public.profile_sees_sample(x) from public.profiles x where x.id = p;
$$;

-- a. 278: an admin invite can be claimed (the staged sign-up takes 'admin')
insert into public.pending_signups (email, role) values ('p1017_new_admin@example.invalid', 'admin');
select is((select role from public.pending_signups where email = 'p1017_new_admin@example.invalid'), 'admin', 'a1 a sign-up can be staged as admin (claim-invite)');
delete from public.pending_signups where email = 'p1017_new_admin@example.invalid';

-- s. sample data is per account, decided by the server
select is(pg_temp.sees('a1017000-0000-4000-8000-000000000010'), true,  's1 the test agent sees sample');
select is(pg_temp.sees('a1017000-0000-4000-8000-00000000000d'), false, 's2 a real agent sees real');
select is(pg_temp.sees('a1017000-0000-4000-8000-00000000000e'), false, 's3 a real VA sees real');
select is(pg_temp.sees('a1017000-0000-4000-8000-00000000000b'), false, 's4 an admin defaults to real');
select pg_temp.as_user('a1017000-0000-4000-8000-00000000000d');
select is(public.my_data_view(), 'real', 's5 my_data_view for a real agent');
select throws_ok($$ select public.set_my_data_view('sample') $$, '42501', null, 's6 an agent cannot pick sample');
select throws_ok($$ update public.profiles set data_view = 'sample' where id = auth.uid() $$, '42501', null, 's7 nobody sets data_view straight on the table');
select pg_temp.as_user('a1017000-0000-4000-8000-000000000010');
select is(public.my_data_view(), 'sample', 's8 my_data_view for the test agent');
select pg_temp.as_user('a1017000-0000-4000-8000-00000000000b');
select is(public.set_my_data_view('sample'), 'sample', 's9 an admin picks sample for themself');
select is(public.my_data_view(), 'sample', 's10 and it sticks');
select is(public.set_my_data_view('real'), 'real', 's11 and back to real');
select pg_temp.as_server();
update public.app_settings set show_sample_data = true where id = 1;
select is(pg_temp.sees('a1017000-0000-4000-8000-00000000000d'), false, 's12 the company switch no longer shows sample to a real agent');

-- r. roles
select pg_temp.as_user('a1017000-0000-4000-8000-00000000000b');
select throws_ok($$ select public.admin_set_user_role('a1017000-0000-4000-8000-00000000000d', 'admin', true) $$, '42501', null, 'r1 a non-owner admin cannot make an admin');
select is(public.admin_set_user_role('a1017000-0000-4000-8000-00000000000d', 'fulfillment', true), 'fulfillment', 'r2 an admin still switches Agent to Fulfillment');
select throws_ok($$ select public.admin_set_user_role('a1017000-0000-4000-8000-00000000000a', 'agent', true) $$, '42501', null, 'r3 a non-owner admin cannot change the owner');
select throws_ok($$ select public.admin_set_user_role('a1017000-0000-4000-8000-00000000000c', 'agent', true) $$, '42501', null, 'r4 a non-owner admin cannot change another admin');
select pg_temp.as_user('a1017000-0000-4000-8000-00000000000a');
select is(public.admin_set_user_role('a1017000-0000-4000-8000-00000000000d', 'agent', true), 'agent', 'r5 owner: back to Agent');
select is(public.admin_set_user_role('a1017000-0000-4000-8000-00000000000e', 'admin', true), 'admin', 'r6 owner: a VA made Admin');
select is(public.admin_set_user_role('a1017000-0000-4000-8000-00000000000e', 'fulfillment', true), 'fulfillment', 'r7 owner: an admin made Fulfillment again');
select throws_ok($$ select public.admin_set_user_role('a1017000-0000-4000-8000-00000000000a', 'agent', true) $$, '42501', null, 'r8 the owner cannot change their own role');
select throws_ok($$ select public.admin_set_user_role('a1017000-0000-4000-8000-000000000010', 'admin', true) $$, '22023', null, 'r9 a test account keeps its role');
select throws_ok($$ select public.admin_set_user_role('a1017000-0000-4000-8000-00000000000d', 'owner', true) $$, '22023', null, 'r10 only the three roles');
select pg_temp.as_server();
select is((select role::text from public.profiles where id = 'a1017000-0000-4000-8000-00000000000e'), 'fulfillment', 'r11 the VA is Fulfillment in the table');
select ok((select count(*) from public.admin_audit_log where target_id::text = 'a1017000-0000-4000-8000-00000000000e' and new_values ? 'role') >= 2, 'r12 role changes are in the audit log');

-- i. a pending invite's role
insert into public.rep_invites (id, token, role, created_by, expires_at, channel, invited_email)
values ('b1017000-0000-4000-8000-000000000001', 'p1017tokA001', 'fulfillment', 'a1017000-0000-4000-8000-00000000000b', now() + interval '7 days', 'email', 'p1017_jordan@example.invalid'),
       ('b1017000-0000-4000-8000-000000000002', 'p1017tokA002', 'agent', 'a1017000-0000-4000-8000-00000000000b', now() + interval '7 days', null, null);
update public.rep_invites set used_at = now() where id = 'b1017000-0000-4000-8000-000000000002';
select pg_temp.as_user('a1017000-0000-4000-8000-00000000000b');
select throws_ok($$ select public.admin_set_invite_role('b1017000-0000-4000-8000-000000000001', 'admin') $$, '42501', null, 'i1 a non-owner admin cannot make an admin invite');
select is(public.admin_set_invite_role('b1017000-0000-4000-8000-000000000001', 'agent'), 'agent', 'i2 an admin changes Fulfillment to Agent on a pending invite');
select pg_temp.as_user('a1017000-0000-4000-8000-00000000000a');
select is(public.admin_set_invite_role('b1017000-0000-4000-8000-000000000001', 'admin'), 'admin', 'i3 the owner makes it an Admin invite');
select throws_ok($$ select public.admin_set_invite_role('b1017000-0000-4000-8000-000000000002', 'fulfillment') $$, '22023', null, 'i4 a used invite cannot change');
select pg_temp.as_server();
select is((select created_by from public.rep_invites where id = 'b1017000-0000-4000-8000-000000000001'), 'a1017000-0000-4000-8000-00000000000a'::uuid, 'i5 the owner is the admin invite''s sender (claim-invite accepts it)');
select ok((select count(*) from public.admin_audit_log where target_id::text = 'b1017000-0000-4000-8000-000000000001') >= 2, 'i6 invite role changes are in the audit log');

-- d. deleting frees the email (agent, VA, admin) and cancels invites to it
insert into public.rep_invites (id, token, role, created_by, expires_at, channel, invited_email)
values ('b1017000-0000-4000-8000-000000000003', 'p1017tokA003', 'agent', 'a1017000-0000-4000-8000-00000000000a', now() + interval '7 days', 'email', 'P1017_a@example.invalid');
select is((public.account_delete('a1017000-0000-4000-8000-00000000000d')->>'invites_cancelled')::int, 1, 'd1 deleting the agent cancels the open invite to their email');
select ok((select expires_at <= now() and used_at is null from public.rep_invites where id = 'b1017000-0000-4000-8000-000000000003'), 'd2 the invite row is kept (expired) for the audit trail');
select is((select email from public.profiles where id = 'a1017000-0000-4000-8000-00000000000d'), 'deleted-a1017000-0000-4000-8000-00000000000d@deleted.invalid', 'd3 the old record is anonymised');
-- what delete-account's soft delete does to the login (scrambles email + identities)
update auth.users set email = 'scrambled-a@example.invalid', deleted_at = now() where id = 'a1017000-0000-4000-8000-00000000000d';
select ok(not exists (select 1 from public.profiles where lower(email) = 'p1017_a@example.invalid' and deleted_at is null), 'd4 no live account holds the email (invite and Create account checks pass)');
-- Create account again with the same email (self sign-up stages it as an agent)
update public.app_settings set self_signup_open = true where id = 1;
insert into public.pending_signups (email, role, source) values ('p1017_a@example.invalid', 'agent', 'self');
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a1017000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'p1017_a@example.invalid',
        '{"provider":"email","providers":["email"]}', '{"full_name":"P1017 A again"}', now(), now());
select is((select role::text || '/' || signup_source || '/' || full_name from public.profiles where id = 'a1017000-0000-4000-8000-0000000000a2'), 'agent/self/P1017 A again', 'd5 Create account with the deleted email makes a fresh account');
select is((select count(*)::int from public.profiles where id = 'a1017000-0000-4000-8000-0000000000a2' and data_view is null and upline_id is null and coalesce(is_test, false) = false), 1, 'd6 the new account starts fresh');
-- …deleted again, then Google with the same email
select ok((public.account_delete('a1017000-0000-4000-8000-0000000000a2')->>'deleted')::boolean, 'd7 the new account can be deleted too');
update auth.users set email = 'scrambled-a2@example.invalid', deleted_at = now() where id = 'a1017000-0000-4000-8000-0000000000a2';
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a1017000-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated', 'p1017_a@example.invalid',
        '{"provider":"google","providers":["google"]}', '{"name":"P1017 A Google"}', now(), now());
select is((select role::text || '/' || signup_source from public.profiles where id = 'a1017000-0000-4000-8000-0000000000a3'), 'agent/self', 'd8 Google sign-in with the deleted email makes a fresh account');
update public.app_settings set self_signup_open = false where id = 1;
-- a deleted VA's email can be invited again and claimed
select ok((public.account_delete('a1017000-0000-4000-8000-00000000000f')->>'deleted')::boolean, 'd9 a VA deletes their account');
update auth.users set email = 'scrambled-w@example.invalid', deleted_at = now() where id = 'a1017000-0000-4000-8000-00000000000f';
insert into public.pending_signups (email, role) values ('p1017_w@example.invalid', 'fulfillment');
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a1017000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'p1017_w@example.invalid',
        '{"provider":"email","providers":["email"],"role":"fulfillment"}', '{"full_name":"P1017 W again"}', now(), now());
select is((select role::text from public.profiles where id = 'a1017000-0000-4000-8000-0000000000f2'), 'fulfillment', 'd10 re-inviting the deleted VA''s email works');
-- admins
select throws_ok($$ select public.account_delete('a1017000-0000-4000-8000-00000000000a') $$, '42501', null, 'd11 the owner account cannot be deleted');
select ok((public.account_delete('a1017000-0000-4000-8000-00000000000b')->>'deleted')::boolean, 'd12 an admin (not the owner) deletes their account');
update public.profiles set is_active = false where id = 'a1017000-0000-4000-8000-00000000000a';
select throws_ok($$ select public.account_delete('a1017000-0000-4000-8000-00000000000c') $$, '42501', null, 'd13 the last active admin cannot be deleted');
select ok(not has_function_privilege('authenticated', 'public.account_delete(uuid)', 'execute'), 'd14 account_delete is server-only');

select * from finish();
rollback;
