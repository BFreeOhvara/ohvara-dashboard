-- p885_missed_payments — pgTAP checks for p885_missed_payments.sql: the per-agent forwarding address, forwarded
-- email intake (matched / duplicate / same miss / unmatched / paid), the Payment missed event (lapse-save step due
-- within 1 business day, the agent warned at the first miss, chargeback risk in year one, repeat), the VA's hand
-- match, carrier portal checks (look only; actions go to the agent), the chargeback-watch link, RLS and grants.
--
-- RUN: `npm run test:sql -- supabase/tests/p885_missed_payments.sql` (PGlite, in memory). Never against live.
--
-- Cast: admin Z, agents A and B, VA V. Policies: P1 Harold Brooks (A, Harborline, year one), P2 Luisa Ortega
-- (A, Pinecrest, year three), P3 + P4 Mary Smith twice (A, Harborline), P5 (B, Harborline), P6 Ann Lee (A,
-- Harborline, year one, on the watch), P7 Tom Fry (A, Harborline, year one).

begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p885_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a8850000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a8850000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Ada Agent'),
    ('a8850000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent', 'Bo Bee'),
    ('a8850000-0000-4000-8000-0000000000f1'::uuid, 'va', 'fulfillment', 'Val Va')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin' where id = 'a8850000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true where id in ('a8850000-0000-4000-8000-00000000000a', 'a8850000-0000-4000-8000-00000000000b');
update public.profiles set role = 'fulfillment', is_active = true where id = 'a8850000-0000-4000-8000-0000000000f1';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into public.policies (id, agent_id, client_first_name, client_last_name, carrier_name, policy_number, status, effective_date, state)
values
  ('b8850000-0000-4000-8000-000000000001', 'a8850000-0000-4000-8000-00000000000a', 'Harold', 'Brooks', 'Harborline Life', 'HL-100-200', 'In Effect', (current_date - interval '4 months')::date, 'TX'),
  ('b8850000-0000-4000-8000-000000000002', 'a8850000-0000-4000-8000-00000000000a', 'Luisa',  'Ortega', 'Pinecrest Assurance', 'PA-77', 'In Effect', (current_date - interval '30 months')::date, 'TX'),
  ('b8850000-0000-4000-8000-000000000003', 'a8850000-0000-4000-8000-00000000000a', 'Mary',   'Smith',  'Harborline Life', 'HL-300', 'In Effect', (current_date - interval '2 months')::date, 'TX'),
  ('b8850000-0000-4000-8000-000000000004', 'a8850000-0000-4000-8000-00000000000a', 'Mary',   'Smith',  'Harborline Life', 'HL-301', 'In Effect', (current_date - interval '5 months')::date, 'TX'),
  ('b8850000-0000-4000-8000-000000000005', 'a8850000-0000-4000-8000-00000000000b', 'Ned',    'Bee',    'Harborline Life', 'HL-555', 'In Effect', (current_date - interval '3 months')::date, 'TX'),
  ('b8850000-0000-4000-8000-000000000006', 'a8850000-0000-4000-8000-00000000000a', 'Ann',    'Lee',    'Harborline Life', 'HL-600', 'In Effect', (current_date - interval '3 months')::date, 'TX'),
  ('b8850000-0000-4000-8000-000000000007', 'a8850000-0000-4000-8000-00000000000a', 'Tom',    'Fry',    'harborline life ', 'HL-700', 'In Effect', (current_date - interval '6 months')::date, 'TX');

-- ── The forwarding address ──
select pg_temp.as_user('a8850000-0000-4000-8000-00000000000a');
select matches(public.my_payment_intake_address(), '^pay\+[a-z0-9]{10}@in\.ohvara\.com$', 'an agent gets a pay+token address');
select is(public.my_payment_intake_address(), public.my_payment_intake_address(), 'the same address every time');
create temp table t_addr as select public.my_payment_intake_address() as old_addr;
select isnt(public.rotate_my_payment_intake_address(), (select old_addr from t_addr), 'rotate gives a new address');
select is((select count(*)::int from public.payment_intake_addresses), 1, 'the agent reads only their own address row');
select pg_temp.as_user('a8850000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.my_payment_intake_address() $$, '42501', null, 'a VA has no forwarding address');
select pg_temp.as_user('a8850000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.payment_intake_addresses where agent_id = 'a8850000-0000-4000-8000-00000000000a'), 0, 'agent B can''t see A''s address');
select ok(public.my_payment_intake_address() like 'pay+%', 'agent B gets one too');
select pg_temp.as_owner();
create temp table t_tok as
  select (select token from public.payment_intake_addresses where agent_id = 'a8850000-0000-4000-8000-00000000000a') as a,
         (select token from public.payment_intake_addresses where agent_id = 'a8850000-0000-4000-8000-00000000000b') as b,
         substr(split_part((select old_addr from t_addr), '@', 1), 5) as old;
select is(public.payment_intake_receive((select old from t_tok), 'm-old', 'x@y', 'Payment missed', '', '{"kind":"missed","policy_number":"HL-100-200"}')->>'status',
          'unknown_address', 'the old address stops working after a rotate');

-- ── 1 business day ──
select is(public.payment_save_deadline('2026-11-09 10:00 America/Chicago'), '2026-11-10 17:00 America/Chicago'::timestamptz, 'Monday morning: due Tuesday 5 PM Central');
select is(public.payment_save_deadline('2026-11-13 16:00 America/Chicago'), '2026-11-16 17:00 America/Chicago'::timestamptz, 'Friday: due Monday 5 PM');
select is(public.payment_save_deadline('2026-11-14 09:00 America/Chicago'), '2026-11-16 17:00 America/Chicago'::timestamptz, 'Saturday: due Monday 5 PM');

-- ── Forwarded email, matched by policy number ──
select is(public.payment_intake_receive((select a from t_tok), 'm-1', 'notices@harborline.example', 'Fwd: Lapse pending notice',
          'Policy number: HL 100 200', jsonb_build_object('kind', 'missed', 'policy_number', 'hl 100-200', 'due_date', current_date - 4))->>'status',
          'matched', 'a forwarded lapse notice matches the policy by number (spaces, case and dashes ignored)');
select results_eq($$ select source, first_year, grace_ends_on, policy_month between 4 and 5 from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000001' $$,
                  $$ values ('email'::text, true, current_date - 4 + 31, true) $$, 'one Payment missed event: from email, year one, grace = due + 31, month 4-5');
select results_eq($$ select t.kind, t.status, t.requested_by, t.due_at = e.save_due_at, e.save_due_at = public.payment_save_deadline(e.detected_at)
                       from public.payment_missed_events e join public.servicing_tasks t on t.id = e.lapse_task_id
                      where e.policy_id = 'b8850000-0000-4000-8000-000000000001' $$,
                  $$ values ('lapse_save'::text, 'requested'::text, 'system'::text, true, true) $$, 'a lapse-save step opened, due by the end of the next business day');
select results_eq($$ select count(*)::int, min(title), bool_and(detail like '%Harborline Life%' and detail like '%Grace ends about%' and detail like '%chargeback watch%')
                       from public.notifications where profile_id = 'a8850000-0000-4000-8000-00000000000a' and type = 'payment_missed' $$,
                  $$ values (1, 'Chargeback risk: Harold Brooks missed a payment'::text, true) $$, 'the agent is warned at the first missed payment: chargeback risk, carrier, grace, watch month');
select ok((select warned_at is not null from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000001'), 'the warning time is stamped');
select is(public.payment_intake_receive((select a from t_tok), 'm-1', 'notices@harborline.example', 'again', '', '{"kind":"missed","policy_number":"HL-100-200"}')->>'status',
          'duplicate', 'the same email twice is a duplicate');
select is(public.payment_intake_receive((select a from t_tok), 'm-2', 'agent@forward', 'Fwd: Fwd: payment returned', '', jsonb_build_object('kind', 'missed', 'policy_number', 'HL100200', 'due_date', current_date - 2))->>'status',
          'matched', 'a second email about the same miss is matched');
select results_eq($$ select (select count(*)::int from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000001'),
                            (select count(*)::int from public.notifications where profile_id = 'a8850000-0000-4000-8000-00000000000a' and type = 'payment_missed'),
                            (select count(*)::int from public.servicing_tasks where policy_id = 'b8850000-0000-4000-8000-000000000001' and kind = 'lapse_save') $$,
                  $$ values (1, 1, 1) $$, 'the same miss joins the open event: one event, one warning, one save step');

-- ── Matched by name; not year one ──
select is(public.payment_intake_receive((select a from t_tok), 'm-3', 'x@pinecrest', 'NSF notice', '', jsonb_build_object('kind', 'missed', 'client_name', 'Ortega,  Luisa', 'due_date', current_date - 60))->>'status',
          'matched', '"Last, First" matches the insured''s name when only one policy fits');
select results_eq($$ select first_year, repeat_miss from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000002' $$,
                  $$ values (false, false) $$, 'year three: no chargeback risk');
select is((select title from public.notifications where profile_id = 'a8850000-0000-4000-8000-00000000000a' and type = 'payment_missed' and data->>'policy_id' = 'b8850000-0000-4000-8000-000000000002'),
          'Luisa Ortega missed a payment', 'the warning after year one has no chargeback wording');

-- ── Unmatched: several policies, no policy, unclear ──
select results_eq($$ select r->>'status', r->>'why' from (select public.payment_intake_receive((select a from t_tok), 'm-4', 'x', 'Missed payment: Mary Smith', 'body', '{"kind":"missed","client_name":"Mary Smith"}') r) q $$,
                  $$ values ('unmatched'::text, 'several_policies'::text) $$, 'a name that fits two policies waits for a VA');
select results_eq($$ select r->>'status', r->>'why' from (select public.payment_intake_receive((select a from t_tok), 'm-5', 'x', 'Missed payment', 'body', '{"kind":"missed","policy_number":"ZZ-999"}') r) q $$,
                  $$ values ('unmatched'::text, 'no_policy'::text) $$, 'an unknown policy number waits for a VA');
select results_eq($$ select r->>'status', r->>'why' from (select public.payment_intake_receive((select a from t_tok), 'm-6', 'x', 'Your statement', 'body', '{"kind":"other","policy_number":"HL-600"}') r) q $$,
                  $$ values ('unmatched'::text, 'unclear'::text) $$, 'an email that isn''t clearly a miss waits for a VA');
-- P888: the admins are told, not the VAs.
select is((select count(*)::int from public.notifications where profile_id = 'a8850000-0000-4000-8000-000000000001' and type = 'payment_intake_unmatched'), 3, 'an admin is told about each waiting email');
select is((select count(*)::int from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000006'), 0, 'an unclear email makes no event');

-- ── Who can see and call what ──
select pg_temp.as_user('a8850000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.payment_intake_emails), 0, 'agent B sees none of A''s emails');
select is((select count(*)::int from public.payment_missed_events), 0, 'agent B sees none of A''s misses');
select pg_temp.as_user('a8850000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.payment_missed_events), 2, 'agent A sees their own misses');
select throws_ok($$ select public.payment_intake_receive('x', 'm', 'x', 'x', 'x', '{}') $$, '42501', null, 'an agent can''t call the intake');
select throws_ok($$ insert into public.payment_missed_events (policy_id, agent_id, due_date, source, first_year) values ('b8850000-0000-4000-8000-000000000001', 'a8850000-0000-4000-8000-00000000000a', current_date, 'agent', true) $$,
                 '42501', null, 'no direct writes to the events');
select throws_ok($$ select public.va_payment_intake_match((select id from public.payment_intake_emails where message_id = 'm-4'), 'b8850000-0000-4000-8000-000000000003') $$,
                 '42501', null, 'an agent can''t match emails');
select throws_ok($$ select public.va_payment_intake_dismiss((select id from public.payment_intake_emails where message_id = 'm-5')) $$, '42501', null, 'an agent can''t set an email aside');
select throws_ok($$ select public.va_missed_payment_desk() $$, '42501', null, 'an agent can''t open the VA desk');

-- ── An admin matches by hand (P888: no longer a VA) ──
select pg_temp.as_user('a8850000-0000-4000-8000-000000000001');
select throws_ok($$ select public.va_payment_intake_match((select id from public.payment_intake_emails where message_id = 'm-4'), 'b8850000-0000-4000-8000-000000000005') $$,
                 '42501', null, 'an admin can''t match to another agent''s policy');
-- P3 already has an open lapse save (asked by the agent), due in 10 days: the miss reuses it and pulls it in.
select pg_temp.as_owner();
insert into public.servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by)
values ('a8850000-0000-4000-8000-00000000000a', 'b8850000-0000-4000-8000-000000000003', 'lapse_save', 'requested', now() + interval '10 days', 'agent');
select pg_temp.as_user('a8850000-0000-4000-8000-000000000001');
select isnt(public.va_payment_intake_match((select id from public.payment_intake_emails where message_id = 'm-4'), 'b8850000-0000-4000-8000-000000000003', current_date - 3), null,
            'an admin matches the email to the right Mary Smith');
select pg_temp.as_owner();
select results_eq($$ select (select count(*)::int from public.servicing_tasks where policy_id = 'b8850000-0000-4000-8000-000000000003' and kind = 'lapse_save'),
                            (select t.due_at < now() + interval '4 days' from public.servicing_tasks t where t.policy_id = 'b8850000-0000-4000-8000-000000000003' and t.kind = 'lapse_save'),
                            (select status from public.payment_intake_emails where message_id = 'm-4') $$,
                  $$ values (1, true, 'matched'::text) $$, 'the open lapse save is reused and pulled forward; the email is marked matched');
select pg_temp.as_user('a8850000-0000-4000-8000-000000000001');
select lives_ok($$ select public.va_payment_intake_dismiss((select id from public.payment_intake_emails where message_id = 'm-6')) $$, 'an admin sets a non-notice aside');
select throws_ok($$ select public.va_payment_intake_dismiss((select id from public.payment_intake_emails where message_id = 'm-6')) $$, 'P0002', null, 'only once');
select results_eq($$ select jsonb_array_length(d->'emails'), jsonb_array_length(d->'misses') from (select public.va_missed_payment_desk() d) q $$,
                  $$ values (1, 3) $$, 'an admin''s desk read shows the one waiting email and the three open misses');

-- ── The save result closes the miss; a later miss is a repeat ──
select pg_temp.as_owner();
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'saved'
 where policy_id = 'b8850000-0000-4000-8000-000000000002' and kind = 'lapse_save';
select is((select resolution from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000002'), 'paid', 'a saved lapse save closes the miss as paid');
select is(public.payment_intake_receive((select a from t_tok), 'm-7', 'x', 'Missed payment', '', jsonb_build_object('kind', 'missed', 'policy_number', 'PA-77', 'due_date', current_date - 1))->>'status', 'matched', 'a second miss two months later');
select results_eq($$ select count(*)::int, bool_or(repeat_miss) from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000002' $$,
                  $$ values (2, true) $$, 'it is its own event, flagged repeat');
select ok(exists (select 1 from public.notifications where type = 'payment_missed' and data->>'policy_id' = 'b8850000-0000-4000-8000-000000000002'
                   and detail like 'Second missed payment in 12 months.%'),
          'the agent is told it''s the second miss');

-- ── The chargeback watch ──
insert into public.servicing_tasks (agent_id, policy_id, kind, status, due_at, watch_month, requested_by)
values ('a8850000-0000-4000-8000-00000000000a', 'b8850000-0000-4000-8000-000000000006', 'chargeback_watch', 'scheduled', now() - interval '1 day', 3, 'system');
update public.servicing_tasks set status = 'done', done_at = now(), outcome = 'missed'
 where policy_id = 'b8850000-0000-4000-8000-000000000006' and kind = 'chargeback_watch';
select results_eq($$ select source, first_year from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000006' $$,
                  $$ values ('watch'::text, true) $$, 'a watch month marked "Missed a payment" becomes a Payment missed event');
select is(public.payment_intake_receive((select a from t_tok), 'm-8', 'x', 'Payment received', '', '{"kind":"paid","policy_number":"HL-600"}')->>'status', 'paid_notice', 'a payment-received email');
select is((select resolution from public.payment_missed_events where policy_id = 'b8850000-0000-4000-8000-000000000006'), 'paid', 'closes the open miss');

-- ── Carrier portal checks (P888: off by default; an admin can turn them back on) ──
update public.payment_settings set portal_checks_on = true;
select is((select count(*)::int from (select public.payment_portal_checks_seed()) q), 1, 'the seed runs');
select results_eq($$ select agent_id::text, carrier_name, policies_count from public.carrier_portal_checks
                      where agent_id in ('a8850000-0000-4000-8000-00000000000a', 'a8850000-0000-4000-8000-00000000000b') order by 1, 2 $$,
                  $$ values ('a8850000-0000-4000-8000-00000000000a', 'Harborline Life', 5), ('a8850000-0000-4000-8000-00000000000a', 'Pinecrest Assurance', 1),
                            ('a8850000-0000-4000-8000-00000000000b', 'Harborline Life', 1) $$,
                  'one check per agent per carrier (carrier names matched loosely)');
select is(public.payment_portal_checks_seed() - public.payment_portal_checks_seed(), 0, 'no second open check');
create temp table t_chk as select id, agent_id, carrier_name from public.carrier_portal_checks
 where agent_id in ('a8850000-0000-4000-8000-00000000000a', 'a8850000-0000-4000-8000-00000000000b');
grant select on t_chk to authenticated;
select pg_temp.as_user('a8850000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.va_portal_check_done((select id from t_chk where carrier_name = 'Pinecrest Assurance'), 'nothing_missed') $$, '42501', null, 'an agent can''t record a portal check');
select pg_temp.as_user('a8850000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.va_portal_check_done((select id from t_chk where agent_id = 'a8850000-0000-4000-8000-00000000000a' and carrier_name = 'Harborline Life'), 'missed_found') $$,
                 '22023', null, 'missed_found needs the policy');
select throws_ok($$ select public.va_portal_check_done((select id from t_chk where agent_id = 'a8850000-0000-4000-8000-00000000000a' and carrier_name = 'Harborline Life'), 'missed_found', null,
                    '[{"policy_id":"b8850000-0000-4000-8000-000000000002","due_date":"2026-11-01"}]') $$,
                 '42501', null, 'the policy must be with that carrier for that agent');
select is(public.va_portal_check_done((select id from t_chk where agent_id = 'a8850000-0000-4000-8000-00000000000a' and carrier_name = 'Harborline Life'), 'missed_found', 'Draft returned',
            jsonb_build_array(jsonb_build_object('policy_id', 'b8850000-0000-4000-8000-000000000007', 'due_date', current_date - 5)),
            'Please re-run the draft for Tom Fry in the portal'), 1, 'the VA reports a miss found in the portal');
select pg_temp.as_owner();
select results_eq($$ select e.source, (select count(*)::int from public.notifications n where n.profile_id = e.agent_id and n.type = 'portal_action_needed') from public.payment_missed_events e
                      where e.policy_id = 'b8850000-0000-4000-8000-000000000007' $$,
                  $$ values ('portal_check'::text, 1) $$, 'it becomes a Payment missed event, and the portal change goes to the agent (Q38)');
select pg_temp.as_user('a8850000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.va_portal_check_done((select id from t_chk where carrier_name = 'Pinecrest Assurance'), 'no_access') $$, '22023', null, 'no access needs a note for the agent');
select lives_ok($$ select public.va_portal_check_done((select id from t_chk where carrier_name = 'Pinecrest Assurance'), 'nothing_missed') $$, 'nothing missed');
select throws_ok($$ select public.va_portal_check_done((select id from t_chk where carrier_name = 'Pinecrest Assurance'), 'nothing_missed') $$, '22023', null, 'a check is done once');

select pg_temp.as_owner();
select is((select count(*)::int from public.notification_types where type in ('payment_missed', 'portal_action_needed', 'payment_intake_unmatched')), 3, 'three notification types');

select * from finish();
rollback;
