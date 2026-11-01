-- p_va_servicing — pgTAP checks for 206_va_servicing.sql: the VA servicing queue,
-- claims, the no-skipping rule, the locked-down RLS, sending to the agent, the
-- events and the demo wall.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_va_servicing.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agents A, B (no link to A), U (A's upline), D (demo side); VAs V1, V2, VD
-- (demo side), VOFF (access off); admin Z. Each case's task has its own fresh policy
-- or lead, so no case leans on another.

begin;
create extension if not exists pgtap with schema extensions;
select plan(429);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_va_servicing_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8200-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8200-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8200-00000000000c'::uuid, 'agent_u', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8200-00000000000d'::uuid, 'agent_d', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8200-000000000001'::uuid, 'va_one',  'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8200-000000000002'::uuid, 'va_two',  'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8200-000000000003'::uuid, 'va_off',  'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8200-00000000000d'::uuid, 'va_demo', 'fulfillment'),
    ('cccccccc-cccc-4ccc-8200-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8200-000000000001';
update public.profiles set upline_id = 'aaaaaaaa-aaaa-4aaa-8200-00000000000c' where id = 'aaaaaaaa-aaaa-4aaa-8200-00000000000a';
update public.profiles set is_demo = true where id in ('aaaaaaaa-aaaa-4aaa-8200-00000000000d', 'bbbbbbbb-bbbb-4bbb-8200-00000000000d');
update public.profiles set is_active = false where id = 'bbbbbbbb-bbbb-4bbb-8200-000000000003';

create function public.p_vs_person(p_who text) returns uuid language sql immutable as $f$
  select case p_who
    when 'a' then 'aaaaaaaa-aaaa-4aaa-8200-00000000000a'::uuid
    when 'b' then 'aaaaaaaa-aaaa-4aaa-8200-00000000000b'::uuid
    when 'u' then 'aaaaaaaa-aaaa-4aaa-8200-00000000000c'::uuid
    when 'd' then 'aaaaaaaa-aaaa-4aaa-8200-00000000000d'::uuid
    when 'v1' then 'bbbbbbbb-bbbb-4bbb-8200-000000000001'::uuid
    when 'v2' then 'bbbbbbbb-bbbb-4bbb-8200-000000000002'::uuid
    when 'voff' then 'bbbbbbbb-bbbb-4bbb-8200-000000000003'::uuid
    when 'vd' then 'bbbbbbbb-bbbb-4bbb-8200-00000000000d'::uuid
    when 'z' then 'cccccccc-cccc-4ccc-8200-000000000001'::uuid
  end
$f$;

-- Sign in as someone. p_vs_owner() goes back to the table owner, signed out.
create function public.p_vs_as(p_who text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', public.p_vs_person(p_who), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
create function public.p_vs_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end
$f$;
create function public.p_vs_owner() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end
$f$;

create table public.p_vs_ids (name text primary key, id uuid not null);
grant all on public.p_vs_ids to authenticated, anon;
insert into public.p_vs_ids values ('ghost', '99999999-9999-4999-8999-999999999999');

create function public.p_vs_id(p_name text) returns uuid language sql stable as $f$
  select id from public.p_vs_ids where name = p_name
$f$;

-- A task on its own fresh policy. Protected stage unless the kind says otherwise.
create function public.p_vs_task(
  p_name text,
  p_kind text default 'carrier_call',
  p_status text default 'requested',
  p_due timestamptz default null,
  p_agent text default 'a',
  p_by text default 'agent',
  p_note text default null,
  p_policy_sample boolean default false,
  p_task_sample boolean default false
) returns uuid language plpgsql as $f$
declare
  v_policy uuid;
  v_task uuid;
begin
  insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, state, status, effective_date,
                               fulfillment_assigned, replaced_old_policy, new_carrier_name, is_sample)
  values (public.p_vs_person(p_agent), 'Case', p_name, '5125550100', 'TX', 'In Effect', (current_date - interval '3 months 10 days')::date,
          false, false, 'P VA Life', p_policy_sample)
  returning id into v_policy;
  insert into public.servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, note, is_sample)
  values (public.p_vs_person(p_agent), v_policy, p_kind, p_status, p_due, p_by, p_note, p_task_sample)
  returning id into v_task;
  insert into public.p_vs_ids values (p_name, v_task);
  return v_task;
end
$f$;

-- A task on a fresh lead, with no policy.
create function public.p_vs_lead_task(
  p_name text,
  p_kind text default 'carrier_call',
  p_status text default 'requested',
  p_agent text default 'a',
  p_lead_sample boolean default false,
  p_note text default null
) returns uuid language plpgsql as $f$
declare
  v_lead uuid;
  v_task uuid;
begin
  insert into public.leads (business_name, contact_name, phone, state, lead_type, assigned_rep_id, is_sample)
  values (p_name, p_name, '+15125550177', 'OK', 'policy_help', public.p_vs_person(p_agent), p_lead_sample)
  returning id into v_lead;
  insert into public.servicing_tasks (agent_id, lead_id, kind, status, requested_by, note)
  values (public.p_vs_person(p_agent), v_lead, p_kind, p_status, 'agent', p_note)
  returning id into v_task;
  insert into public.p_vs_ids values (p_name, v_task);
  return v_task;
end
$f$;

-- A claim held by someone, set directly: a fixture, as the owner.
create function public.p_vs_hold(p_name text, p_who text, p_for interval default interval '10 minutes') returns void language sql as $f$
  update public.servicing_tasks set va_claimed_by = public.p_vs_person(p_who), va_claim_expires_at = now() + p_for
   where id = public.p_vs_id(p_name)
$f$;

-- Runs a statement and gives back 'ok' or its SQLSTATE, so a list of cases can each be a check.
create function public.p_vs_try(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$f$;

-- The six calls that act on a task, each with arguments that would otherwise pass.
create function public.p_vs_calls(p_name text) returns table (what text, stmt text) language sql stable as $f$
  select v.what, format(v.stmt, public.p_vs_id(p_name)) from (values
    ('claim', 'select public.va_servicing_claim(%L)'),
    ('schedule', 'select public.va_servicing_schedule(%L, now() + interval ''1 day'')'),
    ('outcome', 'select public.va_servicing_outcome(%L, ''completed'')'),
    ('done', 'select public.va_servicing_done(%L)'),
    ('cancel', 'select public.va_servicing_cancel(%L, ''Not needed'')'),
    ('send', 'select public.va_servicing_send_to_agent(%L, ''other'', ''Who covers this?'')')
  ) v(what, stmt)
$f$;

-- stage|next_step for a task's policy.
create function public.p_vs_stage(p_name text) returns text language sql stable as $f$
  select s.stage || '|' || coalesce(s.next_step, 'null')
    from public.policy_servicing_status s
    join public.servicing_tasks t on t.policy_id = s.policy_id
   where t.id = public.p_vs_id(p_name)
$f$;

create function public.p_vs_client_stage(p_name text) returns text language sql stable as $f$
  select c.stage from public.agent_clients c
    join public.servicing_tasks t on t.policy_id = any (c.policy_ids)
   where t.id = public.p_vs_id(p_name)
$f$;

create function public.p_vs_status(p_name text) returns text language sql stable as $f$
  select status from public.servicing_tasks where id = public.p_vs_id(p_name)
$f$;

-- Every action this task's events hold, sorted.
create function public.p_vs_events(p_name text) returns text language sql stable as $f$
  select coalesce(string_agg(detail ->> 'action', ',' order by detail ->> 'action'), '')
    from public.policy_events
   where kind = 'servicing' and detail ->> 'task_id' = public.p_vs_id(p_name)::text
$f$;

create function public.p_vs_lead_events(p_name text) returns text language sql stable as $f$
  select coalesce(string_agg(detail ->> 'action', ',' order by detail ->> 'action'), '')
    from public.inbound_events
   where kind = 'note' and detail ->> 'task_id' = public.p_vs_id(p_name)::text
$f$;

create function public.p_vs_queue_has(p_name text) returns boolean language sql stable as $f$
  select exists (select 1 from public.va_servicing_queue() q where q.task_id = public.p_vs_id(p_name))
$f$;

create function public.p_vs_notices(p_name text) returns bigint language sql stable as $f$
  select count(*) from public.notifications n
   where n.type = 'needs_attention' and n.data ->> 'task_id' = public.p_vs_id(p_name)::text
$f$;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'p\_vs\_%' loop
    execute format('grant execute on function %s to authenticated, anon', f);
  end loop;
end $$;

-- ── a. The shape ────────────────────────────────────────────────────────────
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_servicing\_%'),
          array['va_servicing_cancel', 'va_servicing_claim', 'va_servicing_done', 'va_servicing_outcome', 'va_servicing_queue',
                'va_servicing_release', 'va_servicing_schedule', 'va_servicing_send_to_agent'],
          'a1 the va_servicing_* functions are exactly these eight');
select ok(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
          and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'),
          format('a2 %s is security definer, has a fixed search_path, anon can''t run it, authenticated can', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (p.proname like 'va\_servicing\_%' or p.proname in ('agent_servicing_clear_sent', 'servicing_task_is_demo_side'))
 order by p.proname;
select is((select count(*) from pg_proc p, unnest(p.proargnames) a(n)
            where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'va\_servicing\_%' or p.proname = 'agent_servicing_clear_sent')
              and a.n ~* '(answer|advice)'),
          0::bigint, 'a3 no va_servicing_* argument or column is named answer or advice');
select is((select string_agg(a.n, ',' order by a.n) from pg_proc p, unnest(p.proargnames) a(n)
            where p.proname = 'va_servicing_send_to_agent'),
          'p_question,p_reason,p_task', 'a4 and that check is reading real arguments: send takes these three and no more');
select is((select array_agg(a.n order by a.o) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality a(n, m, o)
            where p.proname = 'va_servicing_queue' and a.m = 't'),
          array['task_id', 'policy_id', 'lead_id', 'kind', 'status', 'requested_by', 'due_at', 'best_time', 'outcome', 'client_name',
                'client_state', 'carrier', 'agent_name', 'mine', 'claim_expires_at', 'client_phone', 'note', 'agent_reply_note'],
          'a5 the queue returns exactly the contract''s columns');
select ok(not has_function_privilege('authenticated', 'public.servicing_task_for_write(uuid, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.servicing_task_log(public.servicing_tasks, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.servicing_tasks_status_order()', 'execute'),
          'a6 nobody signed in can run the private helpers, so no event can be forged');
select is((select count(*) from unnest(array['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited', 'reassigned',
                                             'submitted', 'service_request', 'servicing']) k
            where position(quote_literal(k) in (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'policy_events_kind_check')) > 0),
          10::bigint, 'a7 policy_events_kind_check keeps all nine of 187''s values and adds servicing');
select ok(not has_table_privilege('authenticated', 'public.servicing_tasks', 'update')
          and not has_column_privilege('authenticated', 'public.servicing_tasks', 'status', 'update'),
          'a8 authenticated has no update on the table, and the column grant on status went with it');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'servicing_tasks' and policyname = 'servicing_tasks_update'),
          0::bigint, 'a9 the update policy is gone');
select is((select count(*) from pg_indexes where schemaname = 'public' and tablename = 'servicing_tasks'
            and indexname = 'servicing_tasks_open_due_idx' and indexdef ~ '\(due_at\) WHERE'), 1::bigint, 'a10 open tasks have a partial index by due_at');
select is((select string_agg(t.tgname::text, ',' order by t.tgname) from pg_trigger t
            where t.tgrelid = 'public.servicing_tasks'::regclass and t.tgname like 'servicing_tasks_%'),
          'servicing_tasks_status_order,servicing_tasks_touch', 'a11 the status trigger is separate from servicing_tasks_touch');
select is((select array_agg(a.attname::text order by a.attnum) from pg_attribute a
            where a.attrelid = 'public.policy_servicing_status'::regclass and a.attnum > 0 and not a.attisdropped),
          array['policy_id', 'agent_id', 'client_key', 'client_first_name', 'client_last_name', 'client_phone', 'carrier', 'stage',
                'next_step', 'next_date', 'watch_month', 'open_requests', 'is_sample'],
          'a12 the status view keeps its columns in the same order');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.policy_servicing_status'::regclass),
          'a13 the status view is still security_invoker');

-- ── b. Who can call them ────────────────────────────────────────────────────
select public.p_vs_task('rl');
select public.p_vs_as('a');
select is(public.p_vs_try($$ select * from public.va_servicing_queue() $$), '42501', 'b1 an agent cannot read the queue');
select is(public.p_vs_try(format('select public.va_servicing_release(%L)', public.p_vs_id('rl'))), '42501', 'b1 an agent cannot release');
select is(public.p_vs_try(c.stmt), '42501', 'b1 an agent cannot ' || c.what) from public.p_vs_calls('rl') c;
select public.p_vs_as('voff');
select is(public.p_vs_try($$ select * from public.va_servicing_queue() $$), '42501', 'b2 a VA with access off cannot read the queue');
select is(public.p_vs_try(format('select public.va_servicing_release(%L)', public.p_vs_id('rl'))), '42501', 'b2 a VA with access off cannot release');
select is(public.p_vs_try(c.stmt), '42501', 'b2 a VA with access off cannot ' || c.what) from public.p_vs_calls('rl') c;
select public.p_vs_anon();
select is(public.p_vs_try($$ select * from public.va_servicing_queue() $$), '42501', 'b3 anon cannot read the queue');
select is(public.p_vs_try(c.stmt), '42501', 'b3 anon cannot ' || c.what) from public.p_vs_calls('rl') c;
select is(public.p_vs_try(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('rl'))), '42501', 'b3 anon cannot clear');
select public.p_vs_as('v1');
select is(public.p_vs_try(v.s), '22004', 'b4 no task is refused: ' || v.w) from (values
  ('claim', 'select public.va_servicing_claim(null)'),
  ('schedule', 'select public.va_servicing_schedule(null, now() + interval ''1 day'')'),
  ('outcome', 'select public.va_servicing_outcome(null, ''completed'')'),
  ('done', 'select public.va_servicing_done(null)'),
  ('cancel', 'select public.va_servicing_cancel(null, ''x'')'),
  ('send', 'select public.va_servicing_send_to_agent(null, ''other'', ''x'')'),
  ('clear', 'select public.agent_servicing_clear_sent(null, ''x'')')
) v(w, s);
select is(public.va_servicing_release(null), false, 'b5 releasing nothing is false, like va_release');
select is(public.p_vs_try(c.stmt), 'P0002', 'b6 a task that does not exist is not found: ' || c.what) from public.p_vs_calls('ghost') c;
select public.p_vs_owner();

-- ── c. The queue ────────────────────────────────────────────────────────────
select public.p_vs_task('q_soon', 'review_call', 'scheduled', now() + interval '1 day', 'a', 'system', 'free note');
select public.p_vs_task('q_later', 'packet_check', 'scheduled', now() + interval '5 days', 'a', 'system');
select public.p_vs_task('q_nodate', 'address_change', 'requested', null, 'a', 'agent');
select public.p_vs_task('q_nodate_old', 'address_change', 'requested', null, 'a', 'agent');
update public.servicing_tasks set created_at = now() - interval '1 day' where id = public.p_vs_id('q_nodate_old');
select public.p_vs_task('q_client', 'carrier_call', 'requested', now() + interval '3 days', 'a', 'client');
select public.p_vs_task('q_watch', 'chargeback_watch', 'scheduled', now() + interval '300 days', 'a', 'system');
select public.p_vs_task('q_mine', 'carrier_call', 'in_progress', now() + interval '2 days', 'a', 'agent', 'mine note');
select public.p_vs_hold('q_mine', 'v1');
select public.p_vs_task('q_v2', 'carrier_call', 'in_progress', now() + interval '1 hour', 'a', 'agent', 'v2 note');
select public.p_vs_hold('q_v2', 'v2');
select public.p_vs_task('q_exp', 'carrier_call', 'in_progress', now() + interval '4 days', 'a', 'agent', 'expired note');
select public.p_vs_hold('q_exp', 'v2', interval '-1 minute');
select public.p_vs_task('q_done', 'carrier_call', 'done', now());
select public.p_vs_task('q_cancelled', 'carrier_call', 'cancelled', now());
select public.p_vs_task('q_sent', 'carrier_call', 'requested', now());
update public.servicing_tasks set sent_to_agent_at = now() where id = public.p_vs_id('q_sent');

select public.p_vs_as('v1');
select is((select string_agg(i.name, ',' order by q.ordinality)
             from public.va_servicing_queue() with ordinality q
             join public.p_vs_ids i on i.id = q.task_id where i.name like 'q\_%'),
          'q_soon,q_mine,q_client,q_exp,q_later,q_watch,q_nodate_old,q_nodate',
          'c1 soonest due first, no date last then oldest first; agent, client and system steps in one list; own + unclaimed + expired only');
select is(public.p_vs_queue_has('q_v2'), false, 'c2 another VA''s live claim is not listed');
select is((select count(*) from public.va_servicing_queue() q where q.task_id in (public.p_vs_id('q_done'), public.p_vs_id('q_cancelled'), public.p_vs_id('q_sent'))),
          0::bigint, 'c3 done, cancelled and sent are not listed');
select is((select q.kind || ':' || q.status from public.va_servicing_queue() q where q.task_id = public.p_vs_id('q_watch')),
          'chargeback_watch:scheduled', 'c4 today''s kind of chargeback_watch row lists');
select is((select concat_ws('|', q.mine, q.claim_expires_at is null, q.client_phone is null, q.note is null, q.agent_reply_note is null)
             from public.va_servicing_queue() q where q.task_id = public.p_vs_id('q_soon')),
          'f|t|t|t|t', 'c5 a free task: not mine, with no expiry, phone, note or reply');
select is((select concat_ws('|', q.client_name, q.client_state, q.carrier, q.agent_name, q.requested_by)
             from public.va_servicing_queue() q where q.task_id = public.p_vs_id('q_soon')),
          'Case q_soon|TX|P VA Life|Test agent_a|system', 'c6 it still says who, where, which carrier and whose client');
select is((select concat_ws('|', q.mine, q.claim_expires_at = now() + interval '10 minutes', q.client_phone, q.note)
             from public.va_servicing_queue() q where q.task_id = public.p_vs_id('q_mine')),
          't|t|5125550100|mine note', 'c7 my live claim shows the expiry, phone and note');
select is((select concat_ws('|', q.mine, q.client_phone is null, q.note is null)
             from public.va_servicing_queue() q where q.task_id = public.p_vs_id('q_exp')),
          'f|t|t', 'c8 another VA''s expired claim reads as free');
select public.p_vs_as('v2');
select is((select concat_ws('|', q.mine, q.note) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('q_v2')),
          't|v2 note', 'c9 the VA who holds it sees it as theirs');
select is((select concat_ws('|', q.mine, q.note is null) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('q_exp')),
          'f|t', 'c10 your own expired claim is not yours any more');
select is(public.p_vs_queue_has('q_mine'), false, 'c11 V1''s claim is hidden from V2');
select public.p_vs_as('z');
select is(public.p_vs_queue_has('q_soon'), true, 'c12 admin can read the queue');
select is(public.p_vs_queue_has('q_v2'), false, 'c13 and never a VA''s live claim either');
select public.p_vs_owner();

-- ── d. Claim and release ────────────────────────────────────────────────────
select public.p_vs_task('cl_req');
select public.p_vs_task('cl_sch', 'carrier_call', 'scheduled', now() + interval '30 days');
select public.p_vs_task('cl_exp', 'carrier_call', 'in_progress');
select public.p_vs_hold('cl_exp', 'v2', interval '-1 minute');
select public.p_vs_task('cl_done', 'carrier_call', 'done');
select public.p_vs_task('cl_cancelled', 'carrier_call', 'cancelled');
select public.p_vs_task('cl_sent');
update public.servicing_tasks set sent_to_agent_at = now() where id = public.p_vs_id('cl_sent');

select public.p_vs_as('v1');
select is(public.va_servicing_claim(public.p_vs_id('cl_req')), now() + interval '15 minutes', 'd1 a claim lasts 15 minutes and returns the expiry');
select public.p_vs_owner();
select is(public.p_vs_status('cl_req'), 'in_progress', 'd2 requested moves to in_progress by claim');
select public.p_vs_as('v1');
select lives_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id('cl_sch')), 'd3 a scheduled task can be claimed');
select public.p_vs_owner();
select is(public.p_vs_status('cl_sch'), 'in_progress', 'd4 scheduled moves to in_progress by claim');

select public.p_vs_as('v2');
select throws_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id('cl_req')), '55006', 'Another VA is on this step', 'd5 a second VA''s claim is refused');
select public.p_vs_owner();
select is((select va_claimed_by from public.servicing_tasks where id = public.p_vs_id('cl_req')), public.p_vs_person('v1'), 'd6 and V1 still holds it');

update public.servicing_tasks set va_claim_expires_at = now() + interval '1 minute' where id = public.p_vs_id('cl_req');
select public.p_vs_as('v1');
select is(public.va_servicing_claim(public.p_vs_id('cl_req')), now() + interval '15 minutes', 'd7 claiming your own again renews it');

select public.p_vs_as('v2');
select is(public.va_servicing_release(public.p_vs_id('cl_req')), false, 'd8 you can''t release another VA''s claim');
select public.p_vs_as('v1');
select is(public.va_servicing_release(public.p_vs_id('cl_req')), true, 'd9 you can release your own');
select is(public.va_servicing_release(public.p_vs_id('cl_req')), false, 'd10 and then nothing is left to release');
select public.p_vs_owner();
select is((select concat_ws('|', status, va_claimed_by is null, va_claim_expires_at is null) from public.servicing_tasks where id = public.p_vs_id('cl_req')),
          'in_progress|t|t', 'd11 a released task has no holder and stays in_progress');
select public.p_vs_as('v2');
select is((select concat_ws('|', q.status, q.mine) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('cl_req')),
          'in_progress|f', 'd12 a released in_progress task returns to the queue');
select lives_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id('cl_req')), 'd13 and another VA can claim it');
select public.p_vs_as('z');
select is(public.va_servicing_release(public.p_vs_id('cl_req')), true, 'd14 admin can free anyone''s claim');

select public.p_vs_as('v1');
select lives_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id('cl_exp')), 'd15 an expired claim can be taken');
select throws_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id('cl_done')), '22023', 'This step is not in the queue', 'd16 claim refuses done');
select throws_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id('cl_cancelled')), '22023', 'This step is not in the queue', 'd17 claim refuses cancelled');
select throws_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id('cl_sent')), '22023', 'This step is not in the queue', 'd18 claim refuses sent');
select public.p_vs_owner();
select is(public.p_vs_events('cl_req') || public.p_vs_events('cl_exp'), '', 'd19 claim and release write no event');

-- ── e. Writes need a live claim ─────────────────────────────────────────────
select public.p_vs_task('wr_free');
select public.p_vs_task('wr_v2', 'carrier_call', 'in_progress');
select public.p_vs_hold('wr_v2', 'v2');
select public.p_vs_task('wr_exp', 'carrier_call', 'in_progress');
select public.p_vs_hold('wr_exp', 'v1', interval '-1 minute');
select public.p_vs_as('v1');
select is(public.p_vs_try(c.stmt), '42501', 'e1 no claim, refused: ' || c.what) from public.p_vs_calls('wr_free') c where c.what in ('outcome', 'done', 'cancel', 'send');
select is(public.p_vs_try(c.stmt), '42501', 'e2 another VA''s claim, refused: ' || c.what) from public.p_vs_calls('wr_v2') c where c.what in ('outcome', 'done', 'cancel', 'send');
select is(public.p_vs_try(c.stmt), '42501', 'e3 my own expired claim, refused: ' || c.what) from public.p_vs_calls('wr_exp') c where c.what in ('outcome', 'done', 'cancel', 'send');
select public.p_vs_owner();
select is((select string_agg(i.name || ':' || t.status || ':' || coalesce(t.outcome, '-'), ',' order by i.name)
             from public.servicing_tasks t join public.p_vs_ids i on i.id = t.id where i.name in ('wr_free', 'wr_v2', 'wr_exp')),
          'wr_exp:in_progress:-,wr_free:requested:-,wr_v2:in_progress:-', 'e4 none of the refused writes changed anything');

-- Admin needs no claim.
select public.p_vs_task('wr_admin_oc');
select public.p_vs_task('wr_admin_cancel');
select public.p_vs_task('wr_admin_send');
select public.p_vs_task('wr_admin_done', 'carrier_call', 'in_progress');
update public.servicing_tasks set outcome = 'completed' where id = public.p_vs_id('wr_admin_done');
select public.p_vs_as('z');
select is(public.va_servicing_outcome(public.p_vs_id('wr_admin_oc'), 'completed'), 'completed', 'e5 admin can record an outcome with no claim');
select lives_ok(format('select public.va_servicing_cancel(%L, ''Asked to stop'')', public.p_vs_id('wr_admin_cancel')), 'e6 admin can cancel with no claim');
select lives_ok(format('select public.va_servicing_send_to_agent(%L, ''coverage'', ''Is this covered?'')', public.p_vs_id('wr_admin_send')), 'e7 admin can send with no claim');
select lives_ok(format('select public.va_servicing_done(%L)', public.p_vs_id('wr_admin_done')), 'e8 admin can finish an in_progress task with no claim');
select public.p_vs_owner();
select is(public.p_vs_status('wr_admin_oc'), 'requested', 'e9 recording an outcome leaves the status alone');

-- Cancel needs a reason.
select public.p_vs_task('wr_cancel');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id('wr_cancel'));
select throws_ok(format('select public.va_servicing_cancel(%L, null)', public.p_vs_id('wr_cancel')), '22023', 'Say why it is cancelled', 'e10 cancel with no reason is refused');
select throws_ok(format('select public.va_servicing_cancel(%L, %L)', public.p_vs_id('wr_cancel'), E'  \n '), '22023', 'Say why it is cancelled', 'e11 a blank reason is refused');
select throws_ok(format('select public.va_servicing_cancel(%L, %L)', public.p_vs_id('wr_cancel'), repeat('r', 501)), '22023', 'Keep the reason to 500 characters', 'e12 501 characters is refused');
select lives_ok(format('select public.va_servicing_cancel(%L, %L)', public.p_vs_id('wr_cancel'), '  ' || repeat('r', 500) || ' '), 'e13 500 after trimming is accepted');
select public.p_vs_owner();
select is((select concat_ws('|', status, length(cancel_reason), va_claimed_by is null, va_claim_expires_at is null) from public.servicing_tasks where id = public.p_vs_id('wr_cancel')),
          'cancelled|500|t|t', 'e14 cancel stores the trimmed reason and clears the claim');

-- Every kind has a right and a wrong outcome: through the function, and at the table.
select public.p_vs_task('oc_' || k, k) from unnest(array['lapse_save', 'packet_check', 'review_call', 'annual_review', 'conversion', 'chargeback_watch',
  'beneficiary_change', 'address_change', 'payment_change', 'draft_date_change', 'claim_help', 'carrier_call', 'other']) k;
select public.p_vs_as('z');
select is(public.p_vs_try(format('select public.va_servicing_outcome(%L, %L)', public.p_vs_id('oc_' || v.k), v.right_one)), 'ok', 'e15 ' || v.k || ' takes ' || v.right_one),
       is(public.p_vs_try(format('select public.va_servicing_outcome(%L, %L)', public.p_vs_id('oc_' || v.k), v.wrong_one)), '22023', 'e16 ' || v.k || ' refuses ' || v.wrong_one)
  from (values
    ('lapse_save', 'saved', 'completed'), ('packet_check', 'delivered', 'saved'), ('review_call', 'completed', 'delivered'),
    ('annual_review', 'not_reached', 'on_time'), ('conversion', 'completed', 'could_not_complete'), ('chargeback_watch', 'on_time', 'completed'),
    ('beneficiary_change', 'completed', 'not_reached'), ('address_change', 'could_not_complete', 'saved'), ('payment_change', 'completed', 'missed'),
    ('draft_date_change', 'could_not_complete', 'delivered'), ('claim_help', 'completed', 'lapsed'), ('carrier_call', 'could_not_complete', 'not_reached'),
    ('other', 'completed', 'saved')
  ) v(k, right_one, wrong_one);
select public.p_vs_owner();
select is(public.p_vs_try(format('update public.servicing_tasks set outcome = %L where id = %L', v.wrong_one, public.p_vs_id('oc_' || v.k))), '23514', 'e17 the table itself refuses ' || v.wrong_one || ' on ' || v.k)
  from (values
    ('lapse_save', 'completed'), ('packet_check', 'saved'), ('review_call', 'delivered'), ('annual_review', 'on_time'), ('conversion', 'could_not_complete'),
    ('chargeback_watch', 'completed'), ('beneficiary_change', 'not_reached'), ('address_change', 'saved'), ('payment_change', 'missed'),
    ('draft_date_change', 'delivered'), ('claim_help', 'lapsed'), ('carrier_call', 'not_reached'), ('other', 'on_time')
  ) v(k, wrong_one);
select public.p_vs_as('z');
select throws_ok(format('select public.va_servicing_outcome(%L, null)', public.p_vs_id('oc_carrier_call')), '22023', 'That outcome doesn''t fit this step', 'e18 a null outcome is refused');
select throws_ok(format('select public.va_servicing_outcome(%L, ''Told them it is covered'')', public.p_vs_id('oc_carrier_call')), '22023', 'That outcome doesn''t fit this step', 'e19 free text is refused');
select is(public.va_servicing_outcome(public.p_vs_id('oc_carrier_call'), 'completed'), 'completed', 'e20 an outcome can be re-recorded while open');
select public.p_vs_owner();
select is((select outcome from public.servicing_tasks where id = public.p_vs_id('oc_carrier_call')), 'completed', 'e21 and the new one stands');

-- Done with no outcome is refused on every kind.
select public.p_vs_task('nd_' || k, k, 'in_progress'), public.p_vs_hold('nd_' || k, 'v1')
  from unnest(array['lapse_save', 'packet_check', 'review_call', 'annual_review', 'conversion', 'chargeback_watch',
                    'beneficiary_change', 'address_change', 'payment_change', 'draft_date_change', 'claim_help', 'carrier_call', 'other']) k;
select public.p_vs_as('v1');
select throws_ok(format('select public.va_servicing_done(%L)', public.p_vs_id('nd_lapse_save')), '22023', 'Record the outcome first',
                 'e22 a lapse_save with no outcome can''t be done, or the client would silently leave needs_attention');
select is(public.p_vs_try(format('select public.va_servicing_done(%L)', public.p_vs_id('nd_' || k))), '22023', 'e23 done with no outcome is refused on ' || k)
  from unnest(array['packet_check', 'review_call', 'annual_review', 'conversion', 'chargeback_watch',
                    'beneficiary_change', 'address_change', 'payment_change', 'draft_date_change', 'claim_help', 'carrier_call', 'other']) k;
select public.p_vs_owner();
select is(public.p_vs_stage('nd_lapse_save'), 'needs_attention|lapse_save', 'e24 so that client still needs attention');

-- Once done or cancelled, the outcome is fixed: by function and by owner update.
select public.p_vs_task('fin_done', 'lapse_save', 'in_progress');
select public.p_vs_hold('fin_done', 'v1');
select public.p_vs_task('fin_cancel', 'lapse_save', 'in_progress');
select public.p_vs_hold('fin_cancel', 'v1');
select public.p_vs_as('v1');
select public.va_servicing_outcome(public.p_vs_id('fin_done'), 'saved');
select public.va_servicing_outcome(public.p_vs_id('fin_cancel'), 'saved');
select is(public.va_servicing_done(public.p_vs_id('fin_done')), now(), 'e25 done returns done_at');
select lives_ok(format('select public.va_servicing_cancel(%L, ''Asked to stop'')', public.p_vs_id('fin_cancel')), 'e26 cancel works');
select public.p_vs_owner();
select is((select concat_ws('|', status, va_claimed_by is null, va_claim_expires_at is null, done_at = now()) from public.servicing_tasks where id = public.p_vs_id('fin_done')),
          'done|t|t|t', 'e27 done clears the claim and servicing_tasks_touch stamps done_at');
select public.p_vs_as('z');
select is(public.p_vs_try(format('select public.va_servicing_outcome(%L, ''lapsed'')', public.p_vs_id('fin_done'))), '22023', 'e28 the function refuses an outcome change once done, even for admin');
select is(public.p_vs_try(format('select public.va_servicing_outcome(%L, ''lapsed'')', public.p_vs_id('fin_cancel'))), '22023', 'e29 and once cancelled');
select is(public.p_vs_try(c.stmt), '22023', 'e30 a done task refuses ' || c.what) from public.p_vs_calls('fin_done') c;
select is(public.p_vs_try(c.stmt), '22023', 'e31 a cancelled task refuses ' || c.what) from public.p_vs_calls('fin_cancel') c;
select public.p_vs_owner();
select throws_ok(format('update public.servicing_tasks set outcome = ''lapsed'' where id = %L', public.p_vs_id('fin_done')), '22023', 'The outcome of a done step can''t change', 'e32 the owner can''t change the outcome of a done task');
select throws_ok(format('update public.servicing_tasks set outcome = null where id = %L', public.p_vs_id('fin_cancel')), '22023', 'The outcome of a cancelled step can''t change', 'e33 or of a cancelled one');

-- ── f. The status order ─────────────────────────────────────────────────────
select public.p_vs_task('st_' || v.f || '_' || v.t, 'carrier_call', v.f)
  from (values ('in_progress', 'scheduled'), ('in_progress', 'requested'), ('scheduled', 'requested'), ('done', 'in_progress'),
               ('done', 'cancelled'), ('done', 'requested'), ('cancelled', 'requested'), ('cancelled', 'done')) v(f, t);
select is(public.p_vs_try(format('update public.servicing_tasks set status = %L where id = %L', v.t, public.p_vs_id('st_' || v.f || '_' || v.t))),
          '22023', 'f1 the owner cannot move ' || v.f || ' to ' || v.t)
  from (values ('in_progress', 'scheduled'), ('in_progress', 'requested'), ('scheduled', 'requested'), ('done', 'in_progress'),
               ('done', 'cancelled'), ('done', 'requested'), ('cancelled', 'requested'), ('cancelled', 'done')) v(f, t);
select public.p_vs_task('stok_' || v.f || '_' || v.t, 'carrier_call', v.f)
  from (values ('requested', 'scheduled'), ('requested', 'in_progress'), ('requested', 'done'), ('scheduled', 'done'), ('in_progress', 'done'),
               ('requested', 'cancelled'), ('scheduled', 'cancelled'), ('in_progress', 'cancelled')) v(f, t);
select is(public.p_vs_try(format('update public.servicing_tasks set status = %L where id = %L', v.t, public.p_vs_id('stok_' || v.f || '_' || v.t))),
          'ok', 'f2 the owner can move ' || v.f || ' to ' || v.t)
  from (values ('requested', 'scheduled'), ('requested', 'in_progress'), ('requested', 'done'), ('scheduled', 'done'), ('in_progress', 'done'),
               ('requested', 'cancelled'), ('scheduled', 'cancelled'), ('in_progress', 'cancelled')) v(f, t);
select lives_ok(format('update public.servicing_tasks set note = ''still fine'' where id = %L', public.p_vs_id('stok_requested_done')), 'f3 the owner can still touch another column on a done task');

-- No skipping to done, for a VA or for admin.
select public.p_vs_task('skip_req');
select public.p_vs_task('skip_sch', 'carrier_call', 'scheduled', now() + interval '1 day');
select public.p_vs_task('skip_req_held');
select public.p_vs_task('skip_sch_held', 'carrier_call', 'scheduled', now() + interval '1 day');
select public.p_vs_hold('skip_req_held', 'v1');
select public.p_vs_hold('skip_sch_held', 'v1');
update public.servicing_tasks set outcome = 'completed'
 where id in (public.p_vs_id('skip_req'), public.p_vs_id('skip_sch'), public.p_vs_id('skip_req_held'), public.p_vs_id('skip_sch_held'));
select public.p_vs_as('v1');
select is(public.p_vs_try(format('select public.va_servicing_done(%L)', public.p_vs_id('skip_req'))), '42501', 'f4 a VA cannot reach done from requested');
select is(public.p_vs_try(format('select public.va_servicing_done(%L)', public.p_vs_id('skip_sch'))), '42501', 'f5 or from scheduled');
select throws_ok(format('select public.va_servicing_done(%L)', public.p_vs_id('skip_req_held')), '22023', 'Take this step before finishing it', 'f6 not even holding a claim on a requested row');
select throws_ok(format('select public.va_servicing_done(%L)', public.p_vs_id('skip_sch_held')), '22023', 'Take this step before finishing it', 'f7 or a scheduled one');
select public.p_vs_as('z');
select throws_ok(format('select public.va_servicing_done(%L)', public.p_vs_id('skip_req')), '22023', 'Take this step before finishing it', 'f8 admin cannot reach done from requested');
select throws_ok(format('select public.va_servicing_done(%L)', public.p_vs_id('skip_sch')), '22023', 'Take this step before finishing it', 'f9 or from scheduled');
select public.va_servicing_claim(public.p_vs_id('skip_req'));
select lives_ok(format('select public.va_servicing_done(%L)', public.p_vs_id('skip_req')), 'f10 admin finishes it after claiming');
select public.p_vs_owner();
select is(public.p_vs_status('skip_req'), 'done', 'f11 and it is done');
select is(public.p_vs_status('skip_sch'), 'scheduled', 'f12 the refused ones did not move');

-- ── g. Schedule ─────────────────────────────────────────────────────────────
select public.p_vs_task('sc_free');
select public.p_vs_task('sc_own', 'carrier_call', 'scheduled', now() + interval '1 day');
select public.p_vs_task('sc_sch', 'carrier_call', 'scheduled', now() + interval '1 day');
select public.p_vs_task('sc_prog', 'carrier_call', 'in_progress', now() + interval '1 day');
select public.p_vs_task('sc_other', 'carrier_call', 'in_progress', now() + interval '1 day');
select public.p_vs_hold('sc_other', 'v2');
select public.p_vs_task('sc_exp', 'carrier_call', 'in_progress', now() + interval '1 day');
select public.p_vs_hold('sc_exp', 'v2', interval '-1 minute');
select public.p_vs_task('sc_done', 'carrier_call', 'done');
select public.p_vs_task('sc_cancelled', 'carrier_call', 'cancelled');
select public.p_vs_task('sc_sent');
update public.servicing_tasks set sent_to_agent_at = now() where id = public.p_vs_id('sc_sent');
select public.p_vs_task('sc_admin');

select public.p_vs_as('v1');
select is(public.va_servicing_schedule(public.p_vs_id('sc_free'), now() + interval '2 days'), now() + interval '2 days', 'g1 a free requested task can be scheduled, with no claim');
select public.va_servicing_claim(public.p_vs_id('sc_own'));
select lives_ok(format('select public.va_servicing_schedule(%L, now() + interval ''3 days'')', public.p_vs_id('sc_own')), 'g2 on my own live claim');
select lives_ok(format('select public.va_servicing_schedule(%L, now() + interval ''4 days'')', public.p_vs_id('sc_sch')), 'g3 on a free scheduled task');
select lives_ok(format('select public.va_servicing_schedule(%L, now() + interval ''5 days'')', public.p_vs_id('sc_prog')), 'g4 on a free in_progress task');
select lives_ok(format('select public.va_servicing_schedule(%L, now() + interval ''6 days'')', public.p_vs_id('sc_exp')), 'g5 on another VA''s expired claim');
select public.p_vs_owner();
select is((select concat_ws('|', status, due_at = now() + interval '2 days', va_claimed_by is null) from public.servicing_tasks where id = public.p_vs_id('sc_free')),
          'scheduled|t|t', 'g6 requested moves to scheduled and takes the date, with no claim');
select is((select concat_ws('|', status, due_at = now() + interval '3 days', va_claimed_by = public.p_vs_person('v1')) from public.servicing_tasks where id = public.p_vs_id('sc_own')),
          'in_progress|t|t', 'g7 my own claim: only due_at changes and the claim stays');
select is((select concat_ws('|', status, due_at = now() + interval '4 days') from public.servicing_tasks where id = public.p_vs_id('sc_sch')),
          'scheduled|t', 'g8 a free scheduled task: only due_at changes');
select is((select concat_ws('|', status, due_at = now() + interval '5 days') from public.servicing_tasks where id = public.p_vs_id('sc_prog')),
          'in_progress|t', 'g9 a free in_progress task: only due_at changes');
select public.p_vs_as('v1');
select throws_ok(format('select public.va_servicing_schedule(%L, now() + interval ''7 days'')', public.p_vs_id('sc_other')), '55006', 'Another VA is on this step', 'g10 another VA''s live claim is refused');
select public.p_vs_as('z');
select throws_ok(format('select public.va_servicing_schedule(%L, now() + interval ''7 days'')', public.p_vs_id('sc_other')), '55006', 'Another VA is on this step', 'g11 for admin too');
select lives_ok(format('select public.va_servicing_schedule(%L, now() + interval ''7 days'')', public.p_vs_id('sc_admin')), 'g12 admin can schedule a free task');
select public.p_vs_as('v1');
select is(public.p_vs_try(format('select public.va_servicing_schedule(%L, now() + interval ''7 days'')', public.p_vs_id('sc_' || k))), '22023', 'g13 schedule refuses ' || k)
  from unnest(array['done', 'cancelled', 'sent']) k;
select throws_ok(format('select public.va_servicing_schedule(%L, now() - interval ''1 minute'')', public.p_vs_id('sc_sch')), '22023', 'Pick a time in the future', 'g14 a past time is refused');
select throws_ok(format('select public.va_servicing_schedule(%L, now())', public.p_vs_id('sc_sch')), '22023', 'Pick a time in the future', 'g15 so is right now');
select throws_ok(format('select public.va_servicing_schedule(%L, null)', public.p_vs_id('sc_sch')), '22023', 'Pick a time in the future', 'g16 and no time at all');
select public.p_vs_owner();
select is((select due_at from public.servicing_tasks where id = public.p_vs_id('sc_other')), now() + interval '1 day', 'g17 the refused calls left due_at alone');
select is(public.p_vs_events('sc_free') || '/' || public.p_vs_events('sc_sch') || '/' || public.p_vs_events('sc_other'), 'scheduled/scheduled/', 'g18 each schedule writes one event, a refused one none');

-- 196's two functions are admin only: VAs use only va_servicing_*.
select public.p_vs_task('sc_196_req');
select public.p_vs_task('sc_196_prog', 'carrier_call', 'in_progress');
select public.p_vs_task('sc_196_finish');
select public.p_vs_task('sc_196_sent');
update public.servicing_tasks set sent_to_agent_at = now() where id = public.p_vs_id('sc_196_sent');
select public.p_vs_as('v1');
select throws_ok(format('select public.fulfillment_schedule_request(%L, now() + interval ''8 days'')', public.p_vs_id('sc_196_req')), '42501', 'Only an admin can do this', 'g19a a VA cannot call fulfillment_schedule_request');
select throws_ok(format('select public.fulfillment_finish_request(%L, ''Told them it is covered'')', public.p_vs_id('sc_196_req')), '42501', 'Only an admin can do this', 'g19b or finish a request in free text');
select public.p_vs_as('z');
select public.fulfillment_schedule_request(public.p_vs_id(k), now() + interval '8 days') from unnest(array['sc_196_req', 'sc_196_prog']) k;
select lives_ok(format('select public.fulfillment_finish_request(%L, ''Sorted with the carrier'')', public.p_vs_id('sc_196_finish')), 'g19c admin can finish a request');
select throws_ok(format('select public.fulfillment_schedule_request(%L, now() + interval ''8 days'')', public.p_vs_id('sc_196_sent')), '22023', 'This request is with the agent', 'g19d admin cannot schedule a task sent to the agent');
select throws_ok(format('select public.fulfillment_finish_request(%L, ''x'')', public.p_vs_id('sc_196_sent')), '22023', 'This request is with the agent', 'g19e or answer around the agent');
select public.p_vs_owner();
select is((select concat_ws('|', status, due_at = now() + interval '8 days') from public.servicing_tasks where id = public.p_vs_id('sc_196_req')),
          'scheduled|t', 'g19 as admin, fulfillment_schedule_request moves requested to scheduled');
select is((select concat_ws('|', status, due_at = now() + interval '8 days') from public.servicing_tasks where id = public.p_vs_id('sc_196_prog')),
          'in_progress|t', 'g20 and on in_progress only changes due_at');
select is((select concat_ws('|', status, outcome_note) from public.servicing_tasks where id = public.p_vs_id('sc_196_finish')),
          'done|Sorted with the carrier', 'g21 finish stores the admin''s note');

-- ── h. Direct reads and writes ──────────────────────────────────────────────
select public.p_vs_task('rd_free', 'carrier_call', 'requested', null, 'a', 'agent', 'free task note');
select public.p_vs_task('rd_v2', 'carrier_call', 'in_progress', null, 'a', 'agent', 'other task note');
select public.p_vs_hold('rd_v2', 'v2');
select public.p_vs_task('rd_own', 'carrier_call', 'in_progress', null, 'a', 'agent', 'own task note');
select public.p_vs_hold('rd_own', 'v1');
select public.p_vs_task('rd_exp', 'carrier_call', 'in_progress', null, 'a', 'agent', 'stale task note');
select public.p_vs_hold('rd_exp', 'v1', interval '-1 minute');
insert into public.servicing_task_notes (task_id, author_id, body)
select public.p_vs_id(k), public.p_vs_person('a'), 'A note' from unnest(array['rd_free', 'rd_v2', 'rd_own', 'rd_exp']) k;

select public.p_vs_as('v1');
select is((select count(*) from public.servicing_tasks where id = public.p_vs_id('rd_free')), 0::bigint, 'h1 a VA cannot read an unclaimed row directly');
select is((select count(*) from public.servicing_task_notes where task_id = public.p_vs_id('rd_free')), 0::bigint, 'h2 or its notes');
select is((select count(*) from public.servicing_tasks where id = public.p_vs_id('rd_v2')), 0::bigint, 'h3 another VA''s claimed row is invisible');
select is((select count(*) from public.servicing_task_notes where task_id = public.p_vs_id('rd_v2')), 0::bigint, 'h4 and so are its notes');
select is((select count(*) from public.servicing_tasks where id = public.p_vs_id('rd_exp')), 0::bigint, 'h5 my own expired claim is not a read any more');
select is((select count(*) from public.servicing_tasks where id = public.p_vs_id('rd_own')), 1::bigint, 'h6 my own live claim is readable directly');
select is((select count(*) from public.servicing_task_notes where task_id = public.p_vs_id('rd_own')), 1::bigint, 'h7 with its notes');
select is((select concat_ws('|', q.mine, q.client_phone is null, q.note is null) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('rd_free')),
          'f|t|t', 'h8 the queue lists the unclaimed row with phone and note empty');
select is((select concat_ws('|', q.mine, q.client_phone, q.note) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('rd_own')),
          't|5125550100|own task note', 'h9 my own claim shows phone and note');
select throws_ok(format('update public.servicing_tasks set status = ''done'' where id = %L', public.p_vs_id('rd_own')), '42501', 'permission denied for table servicing_tasks', 'h10 a VA cannot update the status directly');
select throws_ok(format('update public.servicing_tasks set outcome = ''completed'' where id = %L', public.p_vs_id('rd_own')), '42501', 'permission denied for table servicing_tasks', 'h11 or the outcome');
select throws_ok(format('delete from public.servicing_tasks where id = %L', public.p_vs_id('rd_own')), '42501', 'permission denied for table servicing_tasks', 'h12 or delete');
select public.p_vs_as('a');
select throws_ok(format('update public.servicing_tasks set status = ''done'' where id = %L', public.p_vs_id('rd_free')), '42501', 'permission denied for table servicing_tasks', 'h13 an agent cannot update the status directly');
select is((select count(*) from public.servicing_tasks where id in (public.p_vs_id('rd_free'), public.p_vs_id('rd_v2'), public.p_vs_id('rd_own'), public.p_vs_id('rd_exp'))), 4::bigint, 'h14 an agent sees their own clients'' tasks, claimed or not');
select is((select count(*) from public.servicing_task_notes where task_id = public.p_vs_id('rd_v2')), 1::bigint, 'h15 and their notes');
select public.p_vs_as('u');
select is((select count(*) from public.servicing_tasks where id in (public.p_vs_id('rd_free'), public.p_vs_id('rd_v2'))), 2::bigint, 'h16 an upline sees the downline''s');
select public.p_vs_as('b');
select is((select count(*) from public.servicing_tasks where id in (public.p_vs_id('rd_free'), public.p_vs_id('rd_v2'))), 0::bigint, 'h17 an unrelated agent sees none');
select public.p_vs_as('z');
select is((select count(*) from public.servicing_tasks where id in (public.p_vs_id('rd_free'), public.p_vs_id('rd_v2'))), 2::bigint, 'h18 admin reads as before');
select throws_ok(format('update public.servicing_tasks set status = ''done'' where id = %L', public.p_vs_id('rd_free')), '42501', 'permission denied for table servicing_tasks', 'h19 and cannot update directly');
select public.p_vs_anon();
select throws_ok('select count(*) from public.servicing_tasks', '42501', 'permission denied for table servicing_tasks', 'h20 anon gets nothing from the table');
select throws_ok('select count(*) from public.servicing_task_notes', '42501', 'permission denied for table servicing_task_notes', 'h21 or the notes');
select public.p_vs_owner();

-- ── i. Send to the agent, and clear ─────────────────────────────────────────
select public.p_vs_task('snd', 'carrier_call', 'requested', now() + interval '2 days');
select is(public.p_vs_stage('snd'), 'protected|chargeback_watch', 'i1 before sending: protected, a request sets no stage');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id('snd'));
select throws_ok(format('select public.va_servicing_send_to_agent(%L, ''legal'', ''Q'')', public.p_vs_id('snd')), '22023', 'Pick why it goes to the agent', 'i2 the reason is a closed list');
select throws_ok(format('select public.va_servicing_send_to_agent(%L, null, ''Q'')', public.p_vs_id('snd')), '22023', 'Pick why it goes to the agent', 'i3 the reason is required');
select throws_ok(format('select public.va_servicing_send_to_agent(%L, ''advice'', ''   '')', public.p_vs_id('snd')), '22023', 'Write the question first', 'i4 the question is required');
select throws_ok(format('select public.va_servicing_send_to_agent(%L, ''advice'', %L)', public.p_vs_id('snd'), repeat('q', 1001)), '22023', 'Keep the question to 1000 characters', 'i5 1001 characters is refused');
select lives_ok(format('select public.va_servicing_send_to_agent(%L, ''advice'', ''  Should they keep the rider?  '')', public.p_vs_id('snd')), 'i6 a VA with a live claim can send');
select public.p_vs_owner();
select is((select concat_ws('|', status, sent_reason, sent_question, sent_by = public.p_vs_person('v1'), va_claimed_by is null, va_claim_expires_at is null, sent_to_agent_at is not null)
             from public.servicing_tasks where id = public.p_vs_id('snd')),
          'in_progress|advice|Should they keep the rider?|t|t|t|t', 'i7 it stores the trimmed question, drops the claim and keeps the status');
select is(public.p_vs_stage('snd'), 'needs_attention|carrier_call', 'i8 policy_servicing_status reads needs_attention, next_step the sent kind');
select is(public.p_vs_client_stage('snd'), 'needs_attention', 'i9 and so does agent_clients');
select is(public.p_vs_notices('snd'), 1::bigint, 'i10 it creates exactly one notice');
select is((select concat_ws('|', profile_id = public.p_vs_person('a'), link, needs_action, read, title, data ->> 'policy_id' = (select policy_id::text from public.servicing_tasks where id = public.p_vs_id('snd')))
             from public.notifications where data ->> 'task_id' = public.p_vs_id('snd')::text),
          't|/agent/clients?stage=needs|t|f|A client needs your answer|t', 'i11 to the agent, needing action, with the link and policy_id');
select is((select dedupe_key from public.notifications where data ->> 'task_id' = public.p_vs_id('snd')::text),
          (select 'servicing_sent:' || id::text || ':' || extract(epoch from sent_to_agent_at)::text from public.servicing_tasks where id = public.p_vs_id('snd')),
          'i12 its key is task + sent time');

select public.p_vs_as('v1');
select is(public.p_vs_queue_has('snd'), false, 'i13 sending removes it from the queue');
select is(public.p_vs_try(c.stmt), '22023', 'i14 a sent task refuses a VA: ' || c.what) from public.p_vs_calls('snd') c;
select public.p_vs_as('z');
select is(public.p_vs_queue_has('snd'), false, 'i15 and admin''s queue');
select is(public.p_vs_try(c.stmt), '22023', 'i16 a sent task refuses admin too: ' || c.what) from public.p_vs_calls('snd') c;

select public.p_vs_as('b');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('snd')), '42501', 'Only this client''s agent can answer this', 'i17 clear by the wrong agent is refused');
select public.p_vs_as('u');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('snd')), '42501', 'Only this client''s agent can answer this', 'i18 by the upline too');
select public.p_vs_as('z');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('snd')), '42501', 'Only this client''s agent can answer this', 'i19 by admin too');
select public.p_vs_as('v1');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('snd')), '42501', 'Only this client''s agent can answer this', 'i20 by a VA too');
select public.p_vs_as('a');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('ghost')), '42501', 'Only this client''s agent can answer this', 'i21 a task that does not exist gets the same answer');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('rd_free')), '22023', 'This step isn''t waiting on you', 'i22 a task that was not sent is refused');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''  '')', public.p_vs_id('snd')), '22023', 'Write the note first', 'i23 the note is required');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, %L)', public.p_vs_id('snd'), repeat('n', 1001)), '22023', 'Keep the note to 1000 characters', 'i24 1001 characters is refused');
select public.p_vs_owner();
update public.profiles set is_active = false where id = public.p_vs_person('a');
select public.p_vs_as('a');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('snd')), '42501', 'Only this client''s agent can answer this', 'i25 an inactive agent is refused');
select public.p_vs_owner();
update public.profiles set is_active = true where id = public.p_vs_person('a');

select public.p_vs_as('a');
select is(public.agent_servicing_clear_sent(public.p_vs_id('snd'), '  Yes, keep it.  '), now(), 'i26 the task''s own agent clears it');
select public.p_vs_owner();
select is((select concat_ws('|', sent_to_agent_at is null, agent_reply_note, agent_replied_at = now(), status) from public.servicing_tasks where id = public.p_vs_id('snd')),
          't|Yes, keep it.|t|in_progress', 'i27 the note is stored and the send is cleared');
select is(public.p_vs_stage('snd'), 'protected|chargeback_watch', 'i28 the stage is back as before');
select is(public.p_vs_client_stage('snd'), 'protected', 'i29 in agent_clients too');
select is((select concat_ws('|', needs_action, read, read_at = now()) from public.notifications where data ->> 'task_id' = public.p_vs_id('snd')::text),
          'f|t|t', 'i30 that notice is resolved');
select public.p_vs_as('v2');
select is((select concat_ws('|', q.mine, q.agent_reply_note is null) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('snd')),
          'f|t', 'i31 it returns to the queue unclaimed, with the note still hidden');
select public.va_servicing_claim(public.p_vs_id('snd'));
select is((select concat_ws('|', q.mine, q.agent_reply_note) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('snd')),
          't|Yes, keep it.', 'i32 the VA who claims it reads the agent''s note');
select lives_ok(format('select public.va_servicing_send_to_agent(%L, ''coverage'', ''And the second rider?'')', public.p_vs_id('snd')), 'i33 send again, inside one transaction');
select public.p_vs_owner();
select is(public.p_vs_notices('snd'), 2::bigint, 'i34 send, clear, send = 2 notices');
select is((select count(*) from public.notifications where data ->> 'task_id' = public.p_vs_id('snd')::text and needs_action and not read), 1::bigint, 'i35 and only the new one needs action');
select is((select concat_ws('|', agent_reply_note is null, agent_replied_at is null, sent_reason) from public.servicing_tasks where id = public.p_vs_id('snd')),
          't|t|coverage', 'i36 the older reply is cleared');
select is(public.p_vs_stage('snd'), 'needs_attention|carrier_call', 'i37 and it needs attention again');

-- Ended still wins.
select public.p_vs_task('snd_ended');
update public.policies set status = 'Lapsed' where id = (select policy_id from public.servicing_tasks where id = public.p_vs_id('snd_ended'));
update public.servicing_tasks set sent_to_agent_at = now() where id = public.p_vs_id('snd_ended');
select is(public.p_vs_stage('snd_ended'), 'ended|null', 'i38 an ended policy with a sent task reads ended');
-- A sent task that closes stops counting.
select public.p_vs_task('snd_closed');
update public.servicing_tasks set sent_to_agent_at = now(), status = 'cancelled' where id = public.p_vs_id('snd_closed');
select is(public.p_vs_stage('snd_closed'), 'protected|chargeback_watch', 'i39 only an open sent task needs attention');
-- A sent step next to an open lapse save: soonest due is the next step.
select public.p_vs_task('snd_lapse', 'carrier_call', 'requested', now() + interval '1 day');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by)
select agent_id, policy_id, 'lapse_save', 'requested', now() + interval '2 days', 'agent' from public.servicing_tasks where id = public.p_vs_id('snd_lapse');
update public.servicing_tasks set sent_to_agent_at = now() where id = public.p_vs_id('snd_lapse');
select is(public.p_vs_stage('snd_lapse'), 'needs_attention|carrier_call', 'i40 needs_attention also takes sent tasks');

-- ── j. The stage from lapse_save outcomes ───────────────────────────────────
select public.p_vs_task('lp_' || k, 'lapse_save') from unnest(array['saved', 'lapsed', 'client_cancelled']) k;
select is(public.p_vs_stage('lp_saved'), 'needs_attention|lapse_save', 'j1 an open lapse save needs attention');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id('lp_' || k)), public.va_servicing_outcome(public.p_vs_id('lp_' || k), k), public.va_servicing_done(public.p_vs_id('lp_' || k))
  from unnest(array['saved', 'lapsed', 'client_cancelled']) k;
select public.p_vs_owner();
select is(public.p_vs_stage('lp_saved'), 'needs_attention|saved_watch', 'j2 saved reads needs_attention, saved_watch');
select is(public.p_vs_stage('lp_lapsed'), 'ended|null', 'j3 lapsed reads ended');
select is(public.p_vs_stage('lp_client_cancelled'), 'ended|null', 'j4 client_cancelled reads ended');

-- ── k. The timeline ─────────────────────────────────────────────────────────
select public.p_vs_task('tl');
select public.p_vs_task('tl_cancel');
select public.p_vs_as('v1');
select public.va_servicing_schedule(public.p_vs_id('tl'), now() + interval '1 day');
select public.va_servicing_claim(public.p_vs_id('tl'));
select public.va_servicing_release(public.p_vs_id('tl'));
select public.p_vs_owner();
select is(public.p_vs_events('tl'), 'scheduled', 'k1 schedule writes one event; claim and release write none');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id('tl'));
select public.va_servicing_outcome(public.p_vs_id('tl'), 'completed');
select public.p_vs_owner();
select is(public.p_vs_events('tl'), 'outcome,scheduled', 'k2 outcome writes one');
select public.p_vs_as('v1');
select public.va_servicing_send_to_agent(public.p_vs_id('tl'), 'other', 'A question');
select public.p_vs_owner();
select is(public.p_vs_events('tl'), 'outcome,scheduled,sent', 'k3 send writes one');
select public.p_vs_as('a');
select public.agent_servicing_clear_sent(public.p_vs_id('tl'), 'An answer');
select public.p_vs_owner();
select is(public.p_vs_events('tl'), 'cleared,outcome,scheduled,sent', 'k4 clear writes one');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id('tl'));
select public.va_servicing_done(public.p_vs_id('tl'));
select public.va_servicing_claim(public.p_vs_id('tl_cancel'));
select public.va_servicing_cancel(public.p_vs_id('tl_cancel'), 'A reason');
select public.p_vs_owner();
select is(public.p_vs_events('tl'), 'cleared,done,outcome,scheduled,sent', 'k5 done writes one');
select is(public.p_vs_events('tl_cancel'), 'cancelled', 'k6 cancel writes one');
select is((select string_agg(detail ->> 'action' || '=' || (detail ->> 'label'), ',' order by detail ->> 'action') from public.policy_events
            where kind = 'servicing' and detail ->> 'task_id' = public.p_vs_id('tl')::text),
          'cleared=Agent answered a servicing task.,done=Servicing task done.,outcome=Servicing result recorded.,scheduled=Servicing task scheduled.,sent=Servicing task sent to the agent.',
          'k7 the labels come from the fixed list');
select is((select detail ->> 'label' from public.policy_events where kind = 'servicing' and detail ->> 'task_id' = public.p_vs_id('tl_cancel')::text),
          'Servicing task cancelled.', 'k8 and so does the cancel label');
select is((select count(*) from public.policy_events where kind = 'servicing' and detail ->> 'task_id' = public.p_vs_id('tl')::text
            and (select array_agg(k order by k) from jsonb_object_keys(detail) k) = array['action', 'label', 'outcome', 'task_id', 'task_kind']),
          5::bigint, 'k9 every detail holds exactly label, action, task_id, task_kind, outcome, and no key named reason');
select is((select detail ->> 'task_kind' || ':' || coalesce(detail ->> 'outcome', 'null') from public.policy_events where kind = 'servicing' and detail ->> 'action' = 'done' and detail ->> 'task_id' = public.p_vs_id('tl')::text),
          'carrier_call:completed', 'k10 with the task''s kind and outcome');
select is((select concat_ws('|', actor_id = public.p_vs_person('v1'), actor_name, actor_role, agent_id = public.p_vs_person('a')) from public.policy_events where kind = 'servicing' and detail ->> 'action' = 'sent' and detail ->> 'task_id' = public.p_vs_id('tl')::text),
          't|Test va_one|fulfillment|t', 'k11 the actor comes from profiles');
select is((select concat_ws('|', actor_id = public.p_vs_person('a'), actor_role) from public.policy_events where kind = 'servicing' and detail ->> 'action' = 'cleared' and detail ->> 'task_id' = public.p_vs_id('tl')::text),
          't|agent', 'k12 the agent is the actor on clear');

-- One done task gives one feed row. Created long ago, with its outcome set as a fixture,
-- so nothing else about it falls in the window.
select public.p_vs_task('fd');
update public.servicing_tasks set created_at = now() - interval '30 days', outcome = 'completed' where id = public.p_vs_id('fd');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id('fd'));
select public.va_servicing_done(public.p_vs_id('fd'));
select public.p_vs_owner();
select is(public.p_vs_events('fd'), 'done', 'k13 the done event is written');
select public.p_vs_as('a');
create temp table feed_a on commit drop as
  select * from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', public.p_vs_person('a'), 5000);
select is((select string_agg(f.id, ',') from feed_a f where f.meta ->> 'policy_id' = (select policy_id::text from public.servicing_tasks where id = public.p_vs_id('fd'))),
          'servicing_done:' || public.p_vs_id('fd')::text, 'k14 one done task gives exactly one feed row, the servicing_done row');
select is((select string_agg(f.title, ',' order by f.title) from feed_a f
            where f.kind = 'servicing' and f.id like 'policy_event:%'
              and f.meta ->> 'policy_id' = (select policy_id::text from public.servicing_tasks where id = public.p_vs_id('tl'))),
          'Agent answered a servicing task.,Servicing result recorded.,Servicing task scheduled.,Servicing task sent to the agent.',
          'k15 the feed returns kind servicing with the label as its title, and skips the done event');
select is((select count(*) from feed_a f where f.title = 'Call updated.'), 0::bigint, 'k16 no row reads Call updated.');
select public.p_vs_owner();

-- ── l. The marker stays on the task ─────────────────────────────────────────
select public.p_vs_task('mk_send');
select public.p_vs_task('mk_send_coverage');
select public.p_vs_task('mk_send_other');
select public.p_vs_task('mk_cancel');
select public.p_vs_lead_task('mk_lead_send');
select public.p_vs_lead_task('mk_lead_cancel');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id(k)) from unnest(array['mk_send', 'mk_send_coverage', 'mk_send_other', 'mk_cancel', 'mk_lead_send', 'mk_lead_cancel']) k;
select public.va_servicing_send_to_agent(public.p_vs_id(k), 'advice', 'MARKERX call 512-555-0199') from unnest(array['mk_send', 'mk_lead_send']) k;
select public.va_servicing_send_to_agent(public.p_vs_id('mk_send_coverage'), 'coverage', 'MARKERX call 512-555-0199');
select public.va_servicing_send_to_agent(public.p_vs_id('mk_send_other'), 'other', 'MARKERX call 512-555-0199');
select public.va_servicing_cancel(public.p_vs_id(k), 'MARKERX call 512-555-0199') from unnest(array['mk_cancel', 'mk_lead_cancel']) k;
select public.p_vs_as('a');
select public.agent_servicing_clear_sent(public.p_vs_id(k), 'MARKERX call 512-555-0199') from unnest(array['mk_send', 'mk_send_coverage', 'mk_send_other', 'mk_lead_send']) k;
select public.p_vs_owner();
select is((select count(*) from public.servicing_tasks where sent_question like 'MARKERX%' and agent_reply_note like 'MARKERX%' and id in (public.p_vs_id('mk_send'), public.p_vs_id('mk_send_coverage'), public.p_vs_id('mk_send_other'), public.p_vs_id('mk_lead_send'))),
          4::bigint, 'l1 the question and the agent''s note are on the tasks');
select is((select count(*) from public.servicing_tasks where cancel_reason like 'MARKERX%' and id in (public.p_vs_id('mk_cancel'), public.p_vs_id('mk_lead_cancel'))),
          2::bigint, 'l2 the cancel reason is on the tasks');
select is((select count(*) from public.policy_events where kind = 'servicing' and detail ->> 'task_id' in (public.p_vs_id('mk_send')::text, public.p_vs_id('mk_send_coverage')::text, public.p_vs_id('mk_send_other')::text, public.p_vs_id('mk_cancel')::text)),
          7::bigint, 'l3 the policy tasks wrote their events: three sent, three cleared, one cancelled');
select is((select count(*) from public.inbound_events where kind = 'note' and detail ->> 'task_id' in (public.p_vs_id('mk_lead_send')::text, public.p_vs_id('mk_lead_cancel')::text)),
          3::bigint, 'l4 the lead-only tasks wrote theirs');
select is((select count(*) from public.notifications where data ->> 'task_id' in (public.p_vs_id('mk_send')::text, public.p_vs_id('mk_send_coverage')::text, public.p_vs_id('mk_send_other')::text, public.p_vs_id('mk_lead_send')::text)),
          4::bigint, 'l5 and each send wrote a notice, one for each reason');
select is((select count(*) from public.policy_events e where e.detail::text ~ 'MARKERX|555-?0199'), 0::bigint, 'l6 the marker is in no policy_events.detail');
select is((select count(*) from public.inbound_events e where e.detail::text ~ 'MARKERX|555-?0199'), 0::bigint, 'l7 no inbound_events.detail');
select is((select count(*) from public.notifications n where to_jsonb(n)::text ~ 'MARKERX|555-?0199'), 0::bigint, 'l8 no notification');
select is((select count(*) from public.notification_emails n where to_jsonb(n)::text ~ 'MARKERX|555-?0199'), 0::bigint, 'l9 no queued email');
select is((select count(*) from public.notification_pushes n where to_jsonb(n)::text ~ 'MARKERX|555-?0199'), 0::bigint, 'l10 no queued push');
select public.p_vs_as('a');
select ok((select count(*) from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', public.p_vs_person('a'), 5000) f
            where f.meta ->> 'policy_id' = (select policy_id::text from public.servicing_tasks where id = public.p_vs_id('mk_send'))) > 1,
          'l11 the feed has rows for those tasks, so the next check is reading them');
select is((select count(*) from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', public.p_vs_person('a'), 5000) f
            where to_jsonb(f)::text ~ 'MARKERX|555-?0199|number removed'), 0::bigint, 'l12 no feed row, for the agent');
select public.p_vs_as('z');
select is((select count(*) from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', null, 5000) f
            where to_jsonb(f)::text ~ 'MARKERX|555-?0199|number removed'), 0::bigint, 'l13 or for admin');
select public.p_vs_owner();

-- ── m. Lead-only tasks ──────────────────────────────────────────────────────
select public.p_vs_lead_task('ld', 'carrier_call', 'requested', 'a', false, 'lead note');
select public.p_vs_lead_task('ld_cancel');
create temp table ld_before on commit drop as
  select count(*) as n, md5(string_agg(s.policy_id::text || s.stage, ',' order by s.policy_id)) as stages
    from public.policy_servicing_status s where s.agent_id = public.p_vs_person('a');
select public.p_vs_as('v1');
select is((select concat_ws('|', q.client_name, q.client_state, q.carrier is null, q.client_phone is null, q.note is null, q.policy_id is null)
             from public.va_servicing_queue() q where q.task_id = public.p_vs_id('ld')),
          'ld|OK|t|t|t|t', 'm1 a free lead-only task lists with the lead''s name and state, phone and note empty');
select public.va_servicing_schedule(public.p_vs_id('ld'), now() + interval '1 day');
select public.va_servicing_claim(public.p_vs_id('ld'));
select is((select concat_ws('|', q.client_phone, q.note) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('ld')),
          '+15125550177|lead note', 'm2 claimed, it shows the lead''s phone and the note');
select public.va_servicing_outcome(public.p_vs_id('ld'), 'completed');
select is(public.p_vs_try(format('select public.va_servicing_send_to_agent(%L, ''coverage'', ''Is this covered?'')', public.p_vs_id('ld'))), 'ok', 'm3 send works on a lead-only task');
select public.p_vs_owner();
select is(public.p_vs_notices('ld'), 1::bigint, 'm4 it gives the notice');
select is((select (data ? 'policy_id') and data ->> 'policy_id' is null from public.notifications where data ->> 'task_id' = public.p_vs_id('ld')::text), true, 'm5 with no policy id');
select is((select count(*) || ':' || md5(string_agg(s.policy_id::text || s.stage, ',' order by s.policy_id)) from public.policy_servicing_status s where s.agent_id = public.p_vs_person('a')),
          (select n || ':' || stages from ld_before), 'm6 and changes no stage: the view is untouched');
select public.p_vs_as('a');
select public.agent_servicing_clear_sent(public.p_vs_id('ld'), 'An answer');
select public.p_vs_as('v1');
select public.va_servicing_claim(public.p_vs_id('ld'));
select public.va_servicing_done(public.p_vs_id('ld'));
select public.va_servicing_claim(public.p_vs_id('ld_cancel'));
select public.va_servicing_cancel(public.p_vs_id('ld_cancel'), 'A reason');
select public.p_vs_owner();
select is(public.p_vs_lead_events('ld'), 'cleared,done,outcome,scheduled,sent', 'm7 each action writes an inbound_events note');
select is(public.p_vs_lead_events('ld_cancel'), 'cancelled', 'm8 cancel too');
select is(public.p_vs_events('ld') || public.p_vs_events('ld_cancel'), '', 'm9 and no policy_events row');
select is((select count(*) from public.inbound_events where kind = 'note' and state = 'done' and label = detail ->> 'label' and label = detail ->> 'note'
            and detail ->> 'task_id' = public.p_vs_id('ld')::text
            and (select array_agg(k order by k) from jsonb_object_keys(detail) k) = array['action', 'label', 'note', 'outcome', 'task_id', 'task_kind']),
          5::bigint, 'm10 state done, the fixed label, the no-free-text detail, and note = the label so the Notes card isn''t blank');
select is((select concat_ws('|', status, done_at = now(), va_claimed_by is null) from public.servicing_tasks where id = public.p_vs_id('ld')), 'done|t|t', 'm11 a lead-only task finishes the same way');

-- ── n. The wall, both directions, lead-only rows included ───────────────────
select public.p_vs_task('w_live', 'carrier_call', 'requested', now() + interval '1 day');
select public.p_vs_lead_task('w_lead_live');
select public.p_vs_task('w_demo', 'carrier_call', 'requested', now() + interval '1 day', 'd');
select public.p_vs_lead_task('w_lead_demo', 'carrier_call', 'requested', 'd');
select public.p_vs_task('w_sample', 'carrier_call', 'requested', now() + interval '1 day', 'a', 'agent', null, true);
select public.p_vs_task('w_task_sample', 'carrier_call', 'requested', now() + interval '1 day', 'a', 'agent', null, false, true);
select public.p_vs_lead_task('w_lead_sample', 'carrier_call', 'requested', 'a', true);
select is((select string_agg(i.name || '=' || public.servicing_task_is_demo_side(i.id), ',' order by i.name) from public.p_vs_ids i where i.name like 'w\_%'),
          'w_demo=true,w_lead_demo=true,w_lead_live=false,w_lead_sample=true,w_live=false,w_sample=true,w_task_sample=true',
          'n1 the side rule: demo policy, demo agent''s lead, and any sample flag are the demo side');
select is(public.servicing_task_is_demo_side(public.p_vs_id('ghost')), null::boolean, 'n2 a task that isn''t there has no side');

select public.p_vs_as('v1');
select is((select string_agg(i.name, ',' order by i.name) from public.va_servicing_queue() q join public.p_vs_ids i on i.id = q.task_id where i.name like 'w\_%'),
          'w_lead_live,w_live', 'n3 a live VA''s queue holds only live tasks');
select public.p_vs_as('z');
select is((select string_agg(i.name, ',' order by i.name) from public.va_servicing_queue() q join public.p_vs_ids i on i.id = q.task_id where i.name like 'w\_%'),
          'w_lead_live,w_live', 'n4 and so does a live admin''s');
select public.p_vs_as('vd');
select is((select string_agg(i.name, ',' order by i.name) from public.va_servicing_queue() q join public.p_vs_ids i on i.id = q.task_id where i.name like 'w\_%'),
          'w_demo,w_lead_demo,w_lead_sample,w_sample,w_task_sample', 'n5 a demo VA''s queue holds only demo-side tasks, sample rows on a live agent included');

select public.p_vs_as('v1');
select is(public.p_vs_try(c.stmt), 'P0002', 'n6 a live VA is told not found on ' || k || ': ' || c.what)
  from unnest(array['w_demo', 'w_lead_demo', 'w_sample', 'w_task_sample', 'w_lead_sample']) k, public.p_vs_calls(k) c;
select public.p_vs_as('vd');
select is(public.p_vs_try(c.stmt), 'P0002', 'n7 a demo VA is told not found on ' || k || ': ' || c.what)
  from unnest(array['w_live', 'w_lead_live']) k, public.p_vs_calls(k) c;
select public.p_vs_as('z');
select is(public.p_vs_try(c.stmt), 'P0002', 'n8 a live admin is walled too on ' || k || ': ' || c.what)
  from unnest(array['w_demo', 'w_lead_sample']) k, public.p_vs_calls(k) c;
select public.p_vs_owner();
select is((select count(*) from public.servicing_tasks where id in (select id from public.p_vs_ids where name like 'w\_%') and (status <> 'requested' or va_claimed_by is not null)),
          0::bigint, 'n9 none of those calls changed a task');

-- Release: a wrong-side task answers like a missing one.
select public.p_vs_task('w_rel_demo', 'carrier_call', 'in_progress', null, 'd');
select public.p_vs_hold('w_rel_demo', 'vd');
select public.p_vs_task('w_rel_live', 'carrier_call', 'in_progress');
select public.p_vs_hold('w_rel_live', 'vd');
select public.p_vs_as('z');
select is(public.va_servicing_release(public.p_vs_id('w_rel_demo')), false, 'n10 a live admin cannot free a claim on the demo side');
select public.p_vs_as('vd');
select is(public.va_servicing_release(public.p_vs_id('w_rel_live')), false, 'n11 a demo VA cannot free one on the live side, even their own');
select public.p_vs_owner();
select is((select count(*) from public.servicing_tasks where id in (public.p_vs_id('w_rel_demo'), public.p_vs_id('w_rel_live')) and va_claimed_by = public.p_vs_person('vd')),
          2::bigint, 'n12 both claims stand');

-- Direct reads: the RLS branch uses the side rule too.
select public.p_vs_lead_task('w_rls_demo', 'carrier_call', 'in_progress', 'd');
select public.p_vs_hold('w_rls_demo', 'v1');
select public.p_vs_lead_task('w_rls_sample', 'carrier_call', 'in_progress', 'a', true);
select public.p_vs_hold('w_rls_sample', 'v1');
select public.p_vs_as('v1');
select is((select count(*) from public.servicing_tasks where id in (public.p_vs_id('w_rls_demo'), public.p_vs_id('w_rls_sample'))), 0::bigint,
          'n13 a live VA holding a claim on a demo-side lead-only row still can''t read it directly');
select is(public.p_vs_queue_has('w_rls_sample'), false, 'n14 or see it in the queue');
select public.p_vs_owner();

-- The right side works. A demo VA on sample rows of a live agent, policy and lead-only.
select public.p_vs_as('vd');
select lives_ok(format('select public.va_servicing_claim(%L)', public.p_vs_id(k)), 'n15 a demo VA can claim ' || k)
  from unnest(array['w_demo', 'w_lead_demo', 'w_sample', 'w_task_sample', 'w_lead_sample']) k;
select is((select concat_ws('|', q.mine, q.client_phone) from public.va_servicing_queue() q where q.task_id = public.p_vs_id('w_lead_sample')),
          't|+15125550177', 'n16 and works the lead-only sample row');
select is((select count(*) from public.servicing_tasks where id = public.p_vs_id('w_lead_sample')), 1::bigint, 'n17 reading it directly while it is claimed');
select is((select count(*) from public.servicing_tasks where id = public.p_vs_id('w_sample')), 0::bigint,
          'n18 a sample row on a live agent''s policy stays behind 193''s wall for a direct read; the queue is how they reach it');
select lives_ok(format('select public.va_servicing_send_to_agent(%L, ''other'', ''Q'')', public.p_vs_id(k)), 'n19 a demo VA can send ' || k)
  from unnest(array['w_demo', 'w_sample', 'w_lead_sample']) k;
select public.p_vs_owner();
select is(public.p_vs_notices('w_sample') + public.p_vs_notices('w_lead_sample'), 0::bigint, 'n20 a demo VA on sample rows of a non-demo agent gets no notice (P775)');
select is(public.p_vs_notices('w_demo'), 1::bigint, 'n21 a demo agent''s own demo client does');
select public.p_vs_as('a');
select throws_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('w_sample')), '42501', 'Only this client''s agent can answer this', 'n22 the live agent is walled off their sample row');
select public.p_vs_as('d');
select lives_ok(format('select public.agent_servicing_clear_sent(%L, ''x'')', public.p_vs_id('w_demo')), 'n23 the demo agent can clear on the demo side');
select public.p_vs_owner();

-- Negative control: without the side rule a live VA does see a demo-side task, so n3 is a real check.
select public.p_vs_lead_task('w_ctl', 'carrier_call', 'requested', 'd');
select public.p_vs_as('v1');
select is(public.p_vs_queue_has('w_ctl'), false, 'n24 a live VA does not see this free demo lead-only task');
select public.p_vs_owner();
savepoint side_control;
create or replace function public.servicing_task_is_demo_side(p_task uuid) returns boolean language sql stable as $f$ select false $f$;
select public.p_vs_as('v1');
select is(public.p_vs_queue_has('w_ctl'), true, 'n25 control: with the side rule gutted they would, so n3 and n24 are real checks');
rollback to savepoint side_control;
select public.p_vs_owner();

select * from finish();
rollback;
