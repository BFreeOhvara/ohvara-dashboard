-- p924_client_line — pgTAP checks for supabase/migrations/258_client_line.sql (Prompt 924): a call to a Deedstone
-- number rings the VA who last talked with the caller, then the number's pod, then any free VA; client texts become a
-- task and a drafted reply; the check is the day after the draft; a save call that can't be saved closes the client
-- with the reason; one set of hours.
--
-- RUN: `npm run test:sql -- supabase/tests/p924_client_line.sql` (PGlite, in memory). One transaction, rolled back.
-- Never run it against Ohvara's live database.
--
-- Cast: admin Z, agent G, VAs V1 V2 V3 (on shift all day today). Number N has the pod V2, V3.

begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p924_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.fname), now(), now()
  from (values
    ('d9240000-0000-4000-8000-000000000001'::uuid, 'admin_z', 'agent', 'Zed Admin'),
    ('d9240000-0000-4000-8000-000000000002'::uuid, 'agent_g', 'agent', 'Gail Agent'),
    ('e9240000-0000-4000-8000-000000000001'::uuid, 'va_one', 'fulfillment', 'Vera One'),
    ('e9240000-0000-4000-8000-000000000002'::uuid, 'va_two', 'fulfillment', 'Sarah Two'),
    ('e9240000-0000-4000-8000-000000000003'::uuid, 'va_three', 'fulfillment', 'Tia Three')
  ) as u(id, n, role, fname);
update public.profiles set role = 'admin' where id = 'd9240000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where role::text in ('fulfillment', 'admin')
   and id not in ('d9240000-0000-4000-8000-000000000001', 'e9240000-0000-4000-8000-000000000001',
                  'e9240000-0000-4000-8000-000000000002', 'e9240000-0000-4000-8000-000000000003');
insert into public.va_shifts (va_id, shift_date, starts, ends) values
  ('e9240000-0000-4000-8000-000000000001', public.va_today(), '00:00', '23:59'),
  ('e9240000-0000-4000-8000-000000000002', public.va_today(), '00:00', '23:59'),
  ('e9240000-0000-4000-8000-000000000003', public.va_today(), '00:00', '23:59');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create or replace function public.route_desk_open(p_at timestamptz default now())
returns boolean language sql stable as $$ select true $$;

insert into public.deedstone_numbers (id, phone, label) values
  ('c9240000-0000-4000-8000-000000000001', '+12145550900', 'Dallas 1'),
  ('c9240000-0000-4000-8000-000000000002', '+12145550901', 'Dallas 2');
insert into public.deedstone_agent_lines (agent_id, number_id) values
  ('d9240000-0000-4000-8000-000000000002', 'c9240000-0000-4000-8000-000000000001');

-- ── a. the pod ───────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('d9240000-0000-4000-8000-000000000002');
select throws_ok($$ select public.admin_set_number_pod('c9240000-0000-4000-8000-000000000001', array['e9240000-0000-4000-8000-000000000002', 'e9240000-0000-4000-8000-000000000003']::uuid[]) $$,
  '42501', null, 'a1 an agent cannot set a pod');
select pg_temp.as_user('d9240000-0000-4000-8000-000000000001');
select throws_ok($$ select public.admin_set_number_pod('c9240000-0000-4000-8000-000000000001', array['e9240000-0000-4000-8000-000000000002']::uuid[]) $$,
  '22023', 'A number needs 2 or 3 VAs', 'a2 one VA is not a pod');
select throws_ok($$ select public.admin_set_number_pod('c9240000-0000-4000-8000-000000000001', array['e9240000-0000-4000-8000-000000000002', 'd9240000-0000-4000-8000-000000000002']::uuid[]) $$,
  '22023', 'Only VAs can be on a number', 'a3 only VAs');
select is(public.admin_set_number_pod('c9240000-0000-4000-8000-000000000001', array['e9240000-0000-4000-8000-000000000002', 'e9240000-0000-4000-8000-000000000003']::uuid[]) ->> 'ok',
  'true', 'a4 admin sets V2, V3 on N');
select is((select count(*)::int from public.deedstone_number_vas where number_id = 'c9240000-0000-4000-8000-000000000001'), 2, 'a5 two VAs on N');

-- ── b. presence: everyone Available, V1 idle longest ─────────────────────────────────────────────────────────
select pg_temp.as_user('e9240000-0000-4000-8000-000000000001'); select public.va_beat('available');
select pg_temp.as_user('e9240000-0000-4000-8000-000000000002'); select public.va_beat('available');
select pg_temp.as_user('e9240000-0000-4000-8000-000000000003'); select public.va_beat('available');
select pg_temp.as_owner();
update public.va_presence set idle_since = now() - interval '30 minutes' where user_id = 'e9240000-0000-4000-8000-000000000001';
update public.va_presence set idle_since = now() - interval '5 minutes' where user_id = 'e9240000-0000-4000-8000-000000000002';
update public.va_presence set idle_since = now() - interval '1 minute' where user_id = 'e9240000-0000-4000-8000-000000000003';
-- V3 talked with the caller +12145550301 last week.
insert into public.call_queue (kind, priority, phone, name, status, taken_by, taken_at)
values ('inbound', 1, '+12145550301', 'Lou Client', 'taken', 'e9240000-0000-4000-8000-000000000003', now() - interval '7 days');

-- ── c. calls in ──────────────────────────────────────────────────────────────────────────────────────────────
select is(public.client_line_prefer('(214) 555-0301', '+12145550900'),
  array['e9240000-0000-4000-8000-000000000003', 'e9240000-0000-4000-8000-000000000002']::uuid[], 'c1 the order: last VA, then the rest of the pod');
select is(public.route_inbound('CAp924a', '+12145550301', '+12145550900') ->> 'offered', 'true', 'c2 a call in is offered');
select is((select offered_to from public.call_queue where help_call_sid = 'CAp924a'),
  'e9240000-0000-4000-8000-000000000003'::uuid, 'c3 to the VA who last talked with the caller (V3), not the longest idle (V1)');
-- V3 is now ringing: a new caller to N rings the pod (V2), still not V1.
select public.route_inbound('CAp924b', '+19725550111', '+12145550900');
select is((select offered_to from public.call_queue where help_call_sid = 'CAp924b'),
  'e9240000-0000-4000-8000-000000000002'::uuid, 'c4 last VA busy → the pod (V2)');
-- Pod all busy: any free VA (V1).
select public.route_inbound('CAp924c', '+19725550112', '+12145550900');
select is((select offered_to from public.call_queue where help_call_sid = 'CAp924c'),
  'e9240000-0000-4000-8000-000000000001'::uuid, 'c5 pod busy → any free VA (V1)');
-- Nobody free: the call waits (help-voice plays hold music; P907 books the callback when it ends unanswered).
select is(public.route_inbound('CAp924d', '+19725550113', '+12145550900') ->> 'offered', 'false', 'c6 nobody free → not offered');
select is((select status from public.call_queue where help_call_sid = 'CAp924d'), 'waiting', 'c7 it waits for the callback path');
select is(public.client_line_prefer('+19725550114', '+12145550999'), '{}'::uuid[], 'c8 a number with no pod → no preference (any VA)');

-- ── d. texts ─────────────────────────────────────────────────────────────────────────────────────────────────
select is(public.client_text_intent('I want to cancel my policy'), 'cancel', 'd1 cancel');
select is(public.client_text_intent('my card was declined'), 'payment', 'd2 payment');
select is(public.client_text_intent('I moved, new address is 4 Elm St'), 'change', 'd3 change');
select is(public.client_text_intent('what does my policy cover?'), 'question', 'd4 question');
insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, state, status, effective_date, fulfillment_assigned, replaced_old_policy, new_carrier_name)
values ('b9240000-0000-4000-8000-000000000001', 'd9240000-0000-4000-8000-000000000002', 'Lou', 'Client', '2145550301', 'TX', 'In Effect', current_date - 40, false, false, 'P924 Life');
select is(public.client_text_intake('+12145550301', 'my bank draft bounced', 'ghl:m1') ->> 'intent', 'payment', 'd5 a client text opens a task');
select ok((select body from public.client_text_replies where message_id = 'ghl:m1') ~ '^Got it\..*Sarah.* will (call|text)',
  'd6 the drafted reply names the pod''s first VA');
select is((select kind from public.servicing_tasks where id = (select task_id from public.client_text_replies where message_id = 'ghl:m1')), 'payment_change', 'd7 a payment problem → payment change task');

-- ── e. the check and the save call ───────────────────────────────────────────────────────────────────────────
select is((select check_delay_days from public.book_settings limit 1), 1, 'e1 the check is the day after the draft');
select is(public.client_text_intent('please stop my policy, cancel it'), 'cancel', 'e2 a cancel text');
insert into public.servicing_tasks (id, agent_id, policy_id, kind, status, due_at, requested_by, note)
values ('f9240000-0000-4000-8000-000000000001', 'd9240000-0000-4000-8000-000000000002', 'b9240000-0000-4000-8000-000000000001', 'lapse_save', 'in_progress', now(), 'agent', 'save');
select pg_temp.as_user('d9240000-0000-4000-8000-000000000001');
select throws_ok($$ select public.va_servicing_outcome('f9240000-0000-4000-8000-000000000001', 'not_saved') $$,
  '22023', 'Say why it can''t be saved', 'e3 can''t be saved needs the reason');
select is(public.va_servicing_outcome('f9240000-0000-4000-8000-000000000001', 'not_saved', 'Too expensive'), 'not_saved', 'e4 can''t be saved is recorded');
select pg_temp.as_owner();
select is((select closed_reason from public.policies where id = 'b9240000-0000-4000-8000-000000000001' and closed_at is not null), 'Too expensive', 'e5 the client is Closed with the reason');
-- ── f. one set of hours ──────────────────────────────────────────────────────────────────────────────────────
insert into public.agent_working_hours (agent_id, weekday, start_time, end_time) values ('d9240000-0000-4000-8000-000000000002', 1, '09:00', '17:00');
select is((select mode || ' ' || (live_hours #>> '{Mon,start}') || '-' || (live_hours #>> '{Mon,end}') from public.agent_lead_product where agent_id = 'd9240000-0000-4000-8000-000000000002'),
  'both 9:00 AM-5:00 PM', 'f1 working hours are the live-call hours');

select * from finish();
rollback;
