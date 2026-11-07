-- p888_va_servicing_simple — pgTAP checks for p888_va_servicing_simple.sql: portal checks off, forwarded emails
-- matched by last name too, unmatched ones go to the admins (not the VAs), and the save call's four results
-- (Saved / Fixing it / Wants to cancel / No answer) with the follow-up and retry calls.
--
-- RUN: `npm run test:sql -- supabase/tests/p888_va_servicing_simple.sql` (PGlite, in memory). Never against live.
--
-- Cast: admin Z, agent A, VA V. Policies (all A): P1 Rosa Ortiz, P2 Jim Smith, P3 Kay Smith, P4 Lee Park.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p888_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a8880000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a8880000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Ada Agent'),
    ('a8880000-0000-4000-8000-0000000000f1'::uuid, 'va', 'fulfillment', 'Val Va')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin', is_active = true where id = 'a8880000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true where id = 'a8880000-0000-4000-8000-00000000000a';
update public.profiles set role = 'fulfillment', is_active = true where id = 'a8880000-0000-4000-8000-0000000000f1';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into public.policies (id, agent_id, client_first_name, client_last_name, carrier_name, policy_number, status, effective_date, state)
values
  ('b8880000-0000-4000-8000-000000000001', 'a8880000-0000-4000-8000-00000000000a', 'Rosa', 'Ortiz', 'Pinecrest Assurance', 'PA-0092211', 'In Effect', (current_date - interval '4 months')::date, 'TX'),
  ('b8880000-0000-4000-8000-000000000002', 'a8880000-0000-4000-8000-00000000000a', 'Jim',  'Smith', 'Harborline Life', 'HL-201', 'In Effect', (current_date - interval '3 months')::date, 'TX'),
  ('b8880000-0000-4000-8000-000000000003', 'a8880000-0000-4000-8000-00000000000a', 'Kay',  'Smith', 'Harborline Life', 'HL-202', 'In Effect', (current_date - interval '3 months')::date, 'TX'),
  ('b8880000-0000-4000-8000-000000000004', 'a8880000-0000-4000-8000-00000000000a', 'Lee',  'Park',  'Americo', 'AM-404', 'In Effect', (current_date - interval '5 months')::date, 'TX');

select pg_temp.as_user('a8880000-0000-4000-8000-00000000000a');
select ok(public.my_payment_intake_address() like 'pay+%', 'agent A has a forwarding address');
select pg_temp.as_owner();
create temp table t_tok as select token as a from public.payment_intake_addresses where agent_id = 'a8880000-0000-4000-8000-00000000000a';

-- ── Portal checks off ──
select is((select portal_checks_on from public.payment_settings), false, 'carrier portal checks are off by default');
select is(public.payment_portal_checks_seed(), 0, 'the weekly seed makes no checks while off');
select is((select count(*)::int from public.carrier_portal_checks where status = 'open'), 0, 'no open portal checks');

-- ── Matching by itself ──
select results_eq($$ select r->>'status' from (select public.payment_intake_receive((select a from t_tok), 'e-1', 'billing@pinecrest', 'Fwd: Returned EFT', 'Policyholder: R. Ortiz',
                       jsonb_build_object('kind', 'missed', 'client_name', 'R. Ortiz', 'due_date', current_date - 3)) r) q $$,
                  $$ values ('matched'::text) $$, 'a last name that fits one policy matches by itself');
select is((select count(*)::int from public.servicing_tasks where policy_id = 'b8880000-0000-4000-8000-000000000001' and kind = 'lapse_save'), 1,
          'the miss is one ordinary save call for the VAs');
select results_eq($$ select r->>'status', r->>'why' from (select public.payment_intake_receive((select a from t_tok), 'e-2', 'x', 'Lapse pending', '', '{"kind":"lapsed","client_name":"J. Smith"}') r) q $$,
                  $$ values ('unmatched'::text, 'several_policies'::text) $$, 'a last name that fits two policies doesn''t guess');
select is((select count(*)::int from public.notifications where profile_id = 'a8880000-0000-4000-8000-000000000001' and type = 'payment_intake_unmatched'), 1,
          'the admin is told about the email nothing could match');
select is((select count(*)::int from public.notifications where profile_id = 'a8880000-0000-4000-8000-0000000000f1' and type = 'payment_intake_unmatched'), 0,
          'the VA is not');
select is((select roles from public.notification_types where type = 'payment_intake_unmatched'), array['admin']::text[], 'that notice is admin-only');

-- ── VAs don't match or see emails; admins do ──
select pg_temp.as_user('a8880000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.va_payment_intake_match((select id from public.payment_intake_emails where message_id = 'e-2'), 'b8880000-0000-4000-8000-000000000002') $$,
                 '42501', null, 'a VA can''t match an email');
select throws_ok($$ select public.va_payment_intake_dismiss((select id from public.payment_intake_emails where message_id = 'e-2')) $$, '42501', null, 'a VA can''t set one aside');
select throws_ok($$ select public.admin_payment_emails_to_match() $$, '42501', null, 'a VA can''t open the admin list');
select results_eq($$ select jsonb_array_length(d->'emails'), jsonb_array_length(d->'checks'), jsonb_array_length(d->'misses') from (select public.va_missed_payment_desk() d) q $$,
                  $$ values (0, 0, 1) $$, 'the VA read has no emails and no portal checks, only the open miss');
select pg_temp.as_user('a8880000-0000-4000-8000-000000000001');
select is(jsonb_array_length(public.admin_payment_emails_to_match()), 1, 'the admin''s Needs-you list has the waiting email');
select isnt(public.va_payment_intake_match((select id from public.payment_intake_emails where message_id = 'e-2'), 'b8880000-0000-4000-8000-000000000002', current_date - 2), null,
            'the admin matches it to Jim Smith');

-- ── The four results ──
select pg_temp.as_owner();
select throws_ok($$ update public.servicing_tasks set outcome = 'bogus' where policy_id = 'b8880000-0000-4000-8000-000000000001' and kind = 'lapse_save' $$,
                 '23514', null, 'a save call takes only its own results');
-- No answer: back the next business day, 3 tries in all.
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'no_answer'
 where policy_id = 'b8880000-0000-4000-8000-000000000001' and kind = 'lapse_save' and status <> 'done';
select results_eq($$ select count(*)::int, (select resolved_at is null from public.payment_missed_events where policy_id = 'b8880000-0000-4000-8000-000000000001'),
                            bool_or(t.status = 'requested' and t.due_at = public.payment_save_deadline(now()) and t.note like 'Try again%')
                       from public.servicing_tasks t where t.policy_id = 'b8880000-0000-4000-8000-000000000001' and t.kind = 'lapse_save' $$,
                  $$ values (2, true, true) $$, 'no answer keeps the miss open and puts the call back on tomorrow''s schedule');
select ok((select e.lapse_task_id = t.id from public.payment_missed_events e join public.servicing_tasks t on t.policy_id = e.policy_id and t.status = 'requested'
            where e.policy_id = 'b8880000-0000-4000-8000-000000000001'), 'the miss follows the new call');
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'no_answer'
 where policy_id = 'b8880000-0000-4000-8000-000000000001' and kind = 'lapse_save' and status <> 'done';
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'no_answer'
 where policy_id = 'b8880000-0000-4000-8000-000000000001' and kind = 'lapse_save' and status <> 'done';
select is((select count(*)::int from public.servicing_tasks where policy_id = 'b8880000-0000-4000-8000-000000000001' and kind = 'lapse_save'), 3,
          'three tries in all, then no more calls');
-- Fixing it: a check-it-cleared call 3 business days out; then Saved closes the miss.
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'fixing'
 where policy_id = 'b8880000-0000-4000-8000-000000000002' and kind = 'lapse_save' and status <> 'done';
select results_eq($$ select t.due_at = public.payment_save_deadline(public.payment_save_deadline(public.payment_save_deadline(now()))), t.note like 'Check the fixed payment cleared%',
                            (select resolved_at is null from public.payment_missed_events where policy_id = 'b8880000-0000-4000-8000-000000000002')
                       from public.servicing_tasks t where t.policy_id = 'b8880000-0000-4000-8000-000000000002' and t.kind = 'lapse_save' and t.status = 'requested' $$,
                  $$ values (true, true, true) $$, 'fixing it opens a check-it-cleared call in 3 business days and keeps the miss open');
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'saved'
 where policy_id = 'b8880000-0000-4000-8000-000000000002' and kind = 'lapse_save' and status <> 'done';
select is((select resolution from public.payment_missed_events where policy_id = 'b8880000-0000-4000-8000-000000000002'), 'paid', 'then Saved closes it as paid');
-- Wants to cancel.
select is(public.payment_intake_receive((select a from t_tok), 'e-3', 'x', 'Missed payment', '', jsonb_build_object('kind', 'missed', 'policy_number', 'AM-404'))->>'status', 'matched', 'a third miss');
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'client_cancelled'
 where policy_id = 'b8880000-0000-4000-8000-000000000004' and kind = 'lapse_save' and status <> 'done';
select is((select resolution from public.payment_missed_events where policy_id = 'b8880000-0000-4000-8000-000000000004'), 'cancelled', 'wants to cancel closes it as cancelled');

select * from finish();
rollback;
