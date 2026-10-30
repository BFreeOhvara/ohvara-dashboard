-- p_my_incoming_transfer — pgTAP checks for public.my_incoming_transfer() in
-- 182_my_incoming_transfer.sql (the in-portal live-transfer ring): an agent
-- gets only their own 'transferring' call from the last 2 minutes, only while
-- on duty, with a first name or 'New caller' and never the phone number.
--
-- RUN: `npm run test:sql` (local PGlite) or `supabase test db` on a LOCAL
-- stack only. Everything runs in one transaction that is rolled back. Never run
-- it against Ohvara's live database (jjextitmbptoaolacocs), and never apply
-- migrations to it from here. Needs 174 (agent_duty) and 179 (help_calls).
--
-- Cast: agents A and B (active), VA V (Fulfillment, active).
-- Calls (last two hex digits of the id):
--   t1 transferring to A, 30s ago, lead 'Dana Sample'
--   t2 transferring to B, 30s ago, lead with no name
--   t3 transferring to A, 5 min ago (stale)
--   t4 live (not transferring) with A as the transfer agent

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_my_incoming_transfer_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('eeeeeeee-eeee-4eee-8eee-00000000000a'::uuid, 'agent_a', 'agent'),
    ('eeeeeeee-eeee-4eee-8eee-00000000000b'::uuid, 'agent_b', 'agent'),
    ('eeeeeeee-eeee-4eee-8eee-00000000000f'::uuid, 'va_v',    'fulfillment')
  ) as u(id, n, role);
update public.profiles set is_active = true
 where id in ('eeeeeeee-eeee-4eee-8eee-00000000000a', 'eeeeeeee-eeee-4eee-8eee-00000000000b',
              'eeeeeeee-eeee-4eee-8eee-00000000000f');

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at)
values
  ('eeeeeeee-eeee-4eee-8eee-0000000000d1', 'Dana Sample', '  Dana Sample ', '+15125559101', 'TX', 'policy_help', 'google', now()),
  ('eeeeeeee-eeee-4eee-8eee-0000000000d2', '+15125559102', null,           '+15125559102', 'TX', 'policy_help', 'google', now());

insert into public.help_calls (id, call_sid, caller_number, tracking_number, va_id, status, transfer_agent_id, lead_id, transfer_started_at)
values
  ('eeeeeeee-eeee-4eee-8eee-0000000000c1', 'p_mit_t1', '+15125559101', '+15125559100', 'eeeeeeee-eeee-4eee-8eee-00000000000f', 'transferring',
   'eeeeeeee-eeee-4eee-8eee-00000000000a', 'eeeeeeee-eeee-4eee-8eee-0000000000d1', now() - interval '30 seconds'),
  ('eeeeeeee-eeee-4eee-8eee-0000000000c2', 'p_mit_t2', '+15125559102', '+15125559100', 'eeeeeeee-eeee-4eee-8eee-00000000000f', 'transferring',
   'eeeeeeee-eeee-4eee-8eee-00000000000b', 'eeeeeeee-eeee-4eee-8eee-0000000000d2', now() - interval '30 seconds'),
  ('eeeeeeee-eeee-4eee-8eee-0000000000c3', 'p_mit_t3', '+15125559103', '+15125559100', 'eeeeeeee-eeee-4eee-8eee-00000000000f', 'transferring',
   'eeeeeeee-eeee-4eee-8eee-00000000000a', null, now() - interval '5 minutes'),
  ('eeeeeeee-eeee-4eee-8eee-0000000000c4', 'p_mit_t4', '+15125559104', '+15125559100', 'eeeeeeee-eeee-4eee-8eee-00000000000f', 'live',
   'eeeeeeee-eeee-4eee-8eee-00000000000a', null, now() - interval '10 seconds');

-- A and B on duty (as the table owner: no signed-in user, so the guard skips the role check).
insert into public.agent_duty (agent_id, on_duty)
values ('eeeeeeee-eeee-4eee-8eee-00000000000a', true), ('eeeeeeee-eeee-4eee-8eee-00000000000b', true);

-- ── a. Grants: signed-in users only ─────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.my_incoming_transfer()', 'execute'),
          'a1 anon cannot call my_incoming_transfer');
select ok(has_function_privilege('authenticated', 'public.my_incoming_transfer()', 'execute'),
          'a2 authenticated can call my_incoming_transfer');

-- ── b. Agent A on duty: only their fresh transferring call, first name only ─
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-00000000000a","role":"authenticated"}', true);
select is((select array_agg(right(help_call_id::text, 2)) from public.my_incoming_transfer()), array['c1'],
          'b1 A gets exactly their fresh transferring call (not the stale one, not the live one, not B''s)');
select is((select caller_label from public.my_incoming_transfer()), 'Dana',
          'b2 caller_label is the lead''s first name');
select ok((select bool_and(caller_label !~ '[0-9]') from public.my_incoming_transfer()),
          'b3 caller_label carries no digits');
reset role;

-- ── c. Agent B: no name on the lead, so 'New caller', never the number ──────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-00000000000b","role":"authenticated"}', true);
select is((select caller_label from public.my_incoming_transfer()), 'New caller',
          'c1 a lead with no name reads New caller');
select is((select right(help_call_id::text, 2) from public.my_incoming_transfer()), 'c2',
          'c2 B gets only their own call');
reset role;

-- ── d. Off duty: nothing ────────────────────────────────────────────────────
update public.agent_duty set on_duty = false where agent_id = 'eeeeeeee-eeee-4eee-8eee-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-00000000000a","role":"authenticated"}', true);
select is((select count(*) from public.my_incoming_transfer()), 0::bigint,
          'd1 A gets nothing while not on duty');
reset role;

-- ── e. The VA and a signed-out caller get nothing ───────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-00000000000f","role":"authenticated"}', true);
select is((select count(*) from public.my_incoming_transfer()), 0::bigint,
          'e1 a VA gets nothing (not the transfer agent)');
reset role;

select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.my_incoming_transfer()), 0::bigint,
          'e2 no signed-in user gets nothing');

select * from finish();
rollback;
