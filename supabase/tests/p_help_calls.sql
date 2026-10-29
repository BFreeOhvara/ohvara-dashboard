-- p_help_calls — pgTAP checks for the help_calls row security in
-- 179_help_calls.sql (Roadmap Goal 9: the table holds live caller numbers, so
-- a VA reads only the calls they answered, an admin reads every call, and only
-- the service role writes).
--
-- RUN: `supabase test db` on a LOCAL stack only (supabase start, supabase db
-- reset). Everything runs in one transaction that is rolled back. Never run it
-- against Ohvara's live database (jjextitmbptoaolacocs), and never apply
-- migrations to it from here. 179 needs 152 (is_admin) applied first.
--
-- Cast: V1 and V2 (Fulfillment, active), V3 (Fulfillment, access off), agent A
-- (active), admin M. Sign-up only makes agent or Fulfillment accounts, so M is
-- seeded as an agent and turned into an admin as the table owner.
-- Calls (last two hex digits of the id):
--   c1 live, V1 answered      c2 live, V2 answered
--   c3 ringing, nobody yet    c4 ended, V3 answered

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_help_calls_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('dddddddd-dddd-4ddd-8ddd-000000000001'::uuid, 'va_one',  'fulfillment'),
    ('dddddddd-dddd-4ddd-8ddd-000000000002'::uuid, 'va_two',  'fulfillment'),
    ('dddddddd-dddd-4ddd-8ddd-000000000003'::uuid, 'va_off',  'fulfillment'),
    ('dddddddd-dddd-4ddd-8ddd-000000000004'::uuid, 'agent_a', 'agent'),
    ('dddddddd-dddd-4ddd-8ddd-000000000005'::uuid, 'admin_m', 'agent')
  ) as u(id, n, role);
update public.profiles set is_active = true
 where id in ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000002',
              'dddddddd-dddd-4ddd-8ddd-000000000004', 'dddddddd-dddd-4ddd-8ddd-000000000005');
update public.profiles set is_active = false
 where id = 'dddddddd-dddd-4ddd-8ddd-000000000003';
update public.profiles set role = 'admin'
 where id = 'dddddddd-dddd-4ddd-8ddd-000000000005';

insert into public.help_calls (id, call_sid, caller_number, tracking_number, va_id, status, answered_at, ended_at)
values
  ('dddddddd-dddd-4ddd-8ddd-0000000000c1', 'p_help_calls_c1', '+15125550201', '+15125550200', 'dddddddd-dddd-4ddd-8ddd-000000000001', 'live',    now(), null),
  ('dddddddd-dddd-4ddd-8ddd-0000000000c2', 'p_help_calls_c2', '+15125550202', '+15125550200', 'dddddddd-dddd-4ddd-8ddd-000000000002', 'live',    now(), null),
  ('dddddddd-dddd-4ddd-8ddd-0000000000c3', 'p_help_calls_c3', '+15125550203', '+15125550200', null,                                   'ringing', null,  null),
  ('dddddddd-dddd-4ddd-8ddd-0000000000c4', 'p_help_calls_c4', '+15125550204', '+15125550200', 'dddddddd-dddd-4ddd-8ddd-000000000003', 'ended',   now(), now());

-- ── a. Row security is on, and only the two select policies exist ───────────
select ok((select relrowsecurity from pg_class where oid = 'public.help_calls'::regclass),
          'a1 row level security is enabled on help_calls');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname) from pg_policies
    where schemaname = 'public' and tablename = 'help_calls'),
  array['help_calls_select_admin:SELECT', 'help_calls_select_own_va:SELECT']::text[],
  'a2 help_calls has exactly the two select policies and no write policy');

-- ── b. Each VA reads only the calls they answered ───────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-000000000001","role":"authenticated"}', true);
select is(
  (select array_agg(right(id::text, 2) order by id) from public.help_calls
    where id::text like 'dddddddd-dddd-4ddd-8ddd-0000000000%'),
  array['c1'],
  'b1 V1 sees exactly their own call');
select is((select count(*) from public.help_calls where id = 'dddddddd-dddd-4ddd-8ddd-0000000000c2'), 0::bigint,
          'b2 V1 cannot read the call V2 answered');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-000000000002","role":"authenticated"}', true);
select is(
  (select array_agg(right(id::text, 2) order by id) from public.help_calls
    where id::text like 'dddddddd-dddd-4ddd-8ddd-0000000000%'),
  array['c2'],
  'b3 V2 sees only their own call');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.help_calls where id::text like 'dddddddd-dddd-4ddd-8ddd-0000000000%'), 0::bigint,
          'b4 a Fulfillment login with access off sees no calls, not even the one they answered');
reset role;

-- ── c. An agent sees nothing; an admin sees every call ──────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-000000000004","role":"authenticated"}', true);
select is((select count(*) from public.help_calls where id::text like 'dddddddd-dddd-4ddd-8ddd-0000000000%'), 0::bigint,
          'c1 an agent sees no help calls');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-000000000005","role":"authenticated"}', true);
select is(
  (select array_agg(right(id::text, 2) order by id) from public.help_calls
    where id::text like 'dddddddd-dddd-4ddd-8ddd-0000000000%'),
  array['c1', 'c2', 'c3', 'c4'],
  'c2 an admin sees all four calls');
reset role;

-- ── d. A VA cannot write, not even to their own call ────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-000000000001","role":"authenticated"}', true);
select throws_ok($$ insert into public.help_calls (call_sid, va_id, status)
                    values ('p_help_calls_x1', 'dddddddd-dddd-4ddd-8ddd-000000000001', 'live') $$,
                 '42501', 'permission denied for table help_calls',
                 'd1 V1 cannot insert a call');
select throws_ok($$ update public.help_calls set status = 'ended', ended_at = now(), outcome = 'dropped'
                     where id = 'dddddddd-dddd-4ddd-8ddd-0000000000c1' $$,
                 '42501', 'permission denied for table help_calls',
                 'd2 V1 cannot update their own call');
select throws_ok($$ delete from public.help_calls where id = 'dddddddd-dddd-4ddd-8ddd-0000000000c1' $$,
                 '42501', 'permission denied for table help_calls',
                 'd3 V1 cannot delete their own call');
reset role;

select is(
  (select status || ':' || va_id::text || ':' || coalesce(outcome, '-') || ':' || (ended_at is null)
     from public.help_calls where id = 'dddddddd-dddd-4ddd-8ddd-0000000000c1'),
  'live:dddddddd-dddd-4ddd-8ddd-000000000001:-:true',
  'd4 V1''s call is unchanged after the refused update and delete');
select is(
  (select count(*) from public.help_calls where call_sid like 'p\_help\_calls\_%'), 4::bigint,
  'd5 still exactly the four seeded calls (the refused insert added nothing)');

-- ── e. Signed-out callers are refused ───────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from public.help_calls $$,
                 '42501', 'permission denied for table help_calls',
                 'e1 anon cannot read help_calls');
reset role;

select * from finish();
rollback;
