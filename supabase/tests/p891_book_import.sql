-- p891_book_import — pgTAP checks for p891_book_import.sql: an agent adds their own clients (good, missing and
-- duplicate rows), each gets one welcome call spread by the per-day cap, the welcome call's four results, text
-- consent logged only on a yes, the agent's Added → Welcomed → Serviced status, and the admin's backlog.
--
-- RUN: `npm run test:sql -- supabase/tests/p891_book_import.sql` (PGlite, in memory). Never against live.
--
-- Cast: admin Z, agent A (has one policy already: AM-1, phone 512-555-0100), agent B, VA V.

begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p891_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a8910000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a8910000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Ada Agent'),
    ('a8910000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent', 'Bea Agent'),
    ('a8910000-0000-4000-8000-0000000000f1'::uuid, 'va', 'fulfillment', 'Val Va')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin', is_active = true where id = 'a8910000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true where id in ('a8910000-0000-4000-8000-00000000000a', 'a8910000-0000-4000-8000-00000000000b');
update public.profiles set role = 'fulfillment', is_active = true where id = 'a8910000-0000-4000-8000-0000000000f1';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, carrier_name, policy_number, status, state)
values ('b8910000-0000-4000-8000-000000000001', 'a8910000-0000-4000-8000-00000000000a', 'Old', 'Client', '+15125550100', 'Americo', 'AM-1', 'In Effect', 'TX');
update public.book_settings set welcome_calls_per_day = 2;

-- ── Refusals ────────────────────────────────────────────────────────────────
select pg_temp.as_user('a8910000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.agent_add_clients('[{"first_name":"A"}]'::jsonb, false) $$, '22023', null, 'no tick, nothing added');
select throws_ok($$ select public.agent_add_clients('[]'::jsonb, true) $$, '22023', null, 'no rows refused');
select pg_temp.as_user('a8910000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.agent_add_clients('[{"first_name":"A"}]'::jsonb, true) $$, '42501', null, 'a VA can''t add clients');

-- ── Good, missing and duplicate rows ────────────────────────────────────────
select pg_temp.as_user('a8910000-0000-4000-8000-00000000000a');
create temp table t_res as
select public.agent_add_clients(jsonb_build_array(
  jsonb_build_object('line', 2, 'first_name', 'Maria', 'last_name', 'Lopez', 'phone', '+15125550199', 'state', 'TX', 'carrier', 'Americo',
                     'policy_number', 'AM-77', 'face_amount', 250000, 'monthly_premium', 84.2, 'draft_day', 3, 'effective_date', '2025-06-01', 'email', 'Maria@Example.com'),
  jsonb_build_object('line', 3, 'first_name', 'Tom', 'last_name', 'Reyes', 'phone', '+15125550122', 'state', 'TX', 'carrier', 'Foresters', 'policy_number', 'FF-1'),
  jsonb_build_object('line', 4, 'first_name', 'Gene', 'last_name', 'Wall', 'phone', '+15125550131', 'state', 'TX', 'carrier', 'Foresters', 'policy_number', 'FF-2'),
  jsonb_build_object('line', 5, 'first_name', 'No', 'last_name', 'Phone', 'state', 'TX', 'carrier', 'Americo', 'policy_number', 'AM-90'),
  jsonb_build_object('line', 6, 'first_name', 'Dup', 'last_name', 'Book', 'phone', '+15125550111', 'state', 'TX', 'carrier', 'Americo', 'policy_number', 'am 1'),
  jsonb_build_object('line', 7, 'first_name', 'Dup', 'last_name', 'Row', 'phone', '+15125550112', 'state', 'TX', 'carrier', 'Americo', 'policy_number', 'AM-77'),
  jsonb_build_object('line', 8, 'first_name', 'Dup', 'last_name', 'Phone', 'phone', '(512) 555-0100', 'state', 'TX', 'carrier', 'Americo', 'policy_number', 'AM-91'),
  jsonb_build_object('line', 9, 'first_name', 'Bad', 'last_name', 'Phone', 'phone', '555-01', 'state', 'TX', 'carrier', 'Americo', 'policy_number', 'AM-92')
), true) as r;
select is((select (r->>'added')::int from t_res), 3, 'three good rows added');
select is((select r->'skipped' from t_res),
          '[{"line":5,"why":"missing"},{"line":6,"why":"duplicate_policy"},{"line":7,"why":"duplicate_policy"},{"line":8,"why":"duplicate_phone"},{"line":9,"why":"bad_phone"}]'::jsonb,
          'missing, duplicate (book, row above, phone) and bad rows skipped with why');

select pg_temp.as_owner();
select results_eq($$ select source, status::text, face_amount, draft_day, effective_date, client_email, coalesce(fulfillment_assigned, false), sms_consent
                       from public.policies where policy_number = 'AM-77' and agent_id = 'a8910000-0000-4000-8000-00000000000a' $$,
                  $$ values ('agent_added'::text, 'In Effect'::text, 250000.00::numeric(12,2), 3::smallint, '2025-06-01'::date, 'maria@example.com'::text, false, false) $$,
                  'the added policy keeps every detail, never enters the cancellation flow, no text consent yet');
select is((select count(*)::int from public.servicing_tasks t join public.policies p on p.id = t.policy_id
            where p.source = 'agent_added' and t.kind = 'welcome_call' and t.status = 'requested' and t.requested_by = 'agent'), 3,
          'one welcome call per added client');
select is((select count(distinct (due_at at time zone 'America/Chicago')::date)::int from public.servicing_tasks where kind = 'welcome_call'), 2,
          'two a day: three welcome calls land on two business days');
select ok((select bool_and(extract(isodow from (due_at at time zone 'America/Chicago')) < 6) from public.servicing_tasks where kind = 'welcome_call'),
          'welcome calls fall on business days');
select is((select count(*)::int from public.client_import_batches where agent_id = 'a8910000-0000-4000-8000-00000000000a' and rows_read = 8 and added = 3), 1,
          'the import is recorded with its tick');
select is((select count(*)::int from public.policies where client_first_name = 'Dup'), 0, 'no duplicate was saved');

-- Agent B can add the same policy number: duplicates are per agent's book.
select pg_temp.as_user('a8910000-0000-4000-8000-00000000000b');
select is((public.agent_add_clients('[{"first_name":"Sue","last_name":"Ng","phone":"+15125550177","state":"TX","carrier":"Americo","policy_number":"AM-77"}]'::jsonb, true)->>'added')::int, 1,
          'another agent''s book does not count as a duplicate');

-- ── The agent's status ──────────────────────────────────────────────────────
select pg_temp.as_user('a8910000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.agent_added_clients() where book_status = 'added' and welcome_due_at is not null), 3,
          'agent sees three Added, each with its welcome call time');
select is((select count(*)::int from public.agent_added_clients()), 3, 'only the agent''s own added clients');

-- ── The VA works the welcome calls ──────────────────────────────────────────
select pg_temp.as_owner();
create temp table t_w as
select p.policy_number, t.id as task_id from public.servicing_tasks t join public.policies p on p.id = t.policy_id
 where t.kind = 'welcome_call' and p.agent_id = 'a8910000-0000-4000-8000-00000000000a';
grant select on t_w to authenticated;

select pg_temp.as_user('a8910000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.va_welcome_text_consent((select task_id from t_w where policy_number = 'AM-77'), true) $$, '42501', null,
                 'text answer needs the step held');
select lives_ok($$ select public.va_servicing_claim((select task_id from t_w where policy_number = 'AM-77')) $$, 'VA takes Maria''s welcome call');
select is(public.va_welcome_text_consent((select task_id from t_w where policy_number = 'AM-77'), true), true, 'Maria says yes to texts');
select throws_ok($$ select public.va_welcome_text_consent((select task_id from t_w where policy_number = 'AM-77'), false) $$, '22023', null,
                 'answered once per call');
select throws_ok($$ select public.va_servicing_outcome((select task_id from t_w where policy_number = 'AM-77'), 'saved') $$, '22023', null,
                 'a save-call result doesn''t fit a welcome call');
select is(public.va_servicing_outcome((select task_id from t_w where policy_number = 'AM-77'), 'welcomed'), 'welcomed', 'Welcomed recorded');

select lives_ok($$ select public.va_servicing_claim((select task_id from t_w where policy_number = 'FF-1')) $$, 'VA takes Tom''s welcome call');
select is(public.va_welcome_text_consent((select task_id from t_w where policy_number = 'FF-1'), false), false, 'Tom says no to texts');
select is(public.va_servicing_outcome((select task_id from t_w where policy_number = 'FF-1'), 'details_fixed'), 'details_fixed', 'Details fixed recorded');

select pg_temp.as_owner();
select results_eq($$ select p.sms_consent, p.sms_consent_at is not null, c.script_version, c.said_by
                       from public.policies p join public.client_text_consents c on c.policy_id = p.id where p.policy_number = 'AM-77' $$,
                  $$ values (true, true, 'welcome-v1'::text, 'a8910000-0000-4000-8000-0000000000f1'::uuid) $$,
                  'a yes is logged: consent on the policy and a row with the script, who and when');
select results_eq($$ select p.sms_consent, (select count(*)::int from public.client_text_consents c where c.policy_id = p.id) from public.policies p where p.policy_number = 'FF-1' $$,
                  $$ values (false, 0) $$, 'a no writes nothing');
select is((select count(*)::int from public.policies where policy_number in ('AM-77', 'FF-1') and welcomed_at is not null), 2,
          'Welcomed and Details fixed both mark the client welcomed');

-- Problem → agent: the VA's note is what the agent sees.
update public.servicing_tasks set outcome_note = 'Says the policy lapsed in August', outcome = 'problem', status = 'done', done_at = now()
 where id = (select task_id from t_w where policy_number = 'FF-2');
select is((select welcome_problem from public.policies where policy_number = 'FF-2'), 'Says the policy lapsed in August', 'Problem carries the VA''s note to the agent');

-- No answer: tomorrow again, three tries in all.
update public.policies set welcome_problem = null where policy_number = 'FF-2';
insert into public.servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by)
select agent_id, id, 'welcome_call', 'requested', now(), 'system' from public.policies where policy_number = 'FF-2';
update public.servicing_tasks set outcome = 'no_answer', status = 'done', done_at = now()
 where kind = 'welcome_call' and status <> 'done' and policy_id = (select id from public.policies where policy_number = 'FF-2');
select results_eq($$ select count(*)::int, bool_or(t.status = 'requested' and t.due_at = public.payment_save_deadline(now()) and t.note like 'Try again%')
                       from public.servicing_tasks t where t.kind = 'welcome_call' and t.policy_id = (select id from public.policies where policy_number = 'FF-2') $$,
                  $$ values (3, true) $$, 'no answer puts the welcome call back on the next business day');
update public.servicing_tasks set outcome = 'no_answer', status = 'done', done_at = now()
 where kind = 'welcome_call' and status <> 'done' and policy_id = (select id from public.policies where policy_number = 'FF-2');
update public.servicing_tasks set outcome = 'no_answer', status = 'done', done_at = now()
 where kind = 'welcome_call' and status <> 'done' and policy_id = (select id from public.policies where policy_number = 'FF-2');
select is((select count(*)::int from public.servicing_tasks where kind = 'welcome_call' and status <> 'done'
             and policy_id = (select id from public.policies where policy_number = 'FF-2')), 0, 'after three no-answers, no more calls');
select is((select welcome_problem from public.policies where policy_number = 'FF-2'), 'No answer after 3 tries', 'and the agent is told');

-- Serviced: a servicing step done after the welcome.
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
select agent_id, id, 'annual_review', 'requested', 'system' from public.policies where policy_number = 'AM-77' and agent_id = 'a8910000-0000-4000-8000-00000000000a';
update public.servicing_tasks set outcome = 'completed', status = 'done', done_at = now() + interval '1 minute'
 where kind = 'annual_review' and policy_id = (select id from public.policies where policy_number = 'AM-77' and agent_id = 'a8910000-0000-4000-8000-00000000000a');
select pg_temp.as_user('a8910000-0000-4000-8000-00000000000a');
select results_eq($$ select p.policy_number, a.book_status from public.agent_added_clients() a join public.policies p on p.id = a.policy_id order by 1 $$,
                  $$ values ('AM-77'::text, 'serviced'::text), ('FF-1', 'welcomed'), ('FF-2', 'problem') $$,
                  'Added → Welcomed → Serviced, problem wins');

-- ── Admin backlog and the per-day setting ───────────────────────────────────
select throws_ok($$ select public.admin_welcome_backlog() $$, '42501', null, 'an agent can''t read the backlog');
update public.book_settings set welcome_calls_per_day = 99;
select is((select welcome_calls_per_day from public.book_settings), 2, 'an agent can''t change the per-day cap');
select pg_temp.as_user('a8910000-0000-4000-8000-000000000001');
select is((select jsonb_path_query_array(public.admin_welcome_backlog(), '$.agents[*].agent_name')), '["Ada Agent", "Bea Agent"]'::jsonb,
          'the admin sees who has welcome calls waiting, most first');
update public.book_settings set welcome_calls_per_day = 40;
select is((public.admin_welcome_backlog()->>'per_day')::int, 40, 'an admin sets welcome calls a day');

select * from finish();
rollback;
