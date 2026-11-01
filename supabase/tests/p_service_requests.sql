-- p_service_requests — pgTAP checks for 196_service_request_tracking.sql: the kinds on
-- a request, 'other', the weekly limit staying out of it, the agent's list, and
-- Fulfillment scheduling and finishing a request.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_service_requests.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agents A and B (no link), U (A's upline), D (the demo side), rep R and admin Z
-- (the live side), demo rep DR. A request's name in the ids table starts with its
-- agent: a_, b_, d_. The weekly cap is read from agent_weekly_usage, never written here.

begin;
create extension if not exists pgtap with schema extensions;
select plan(159);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_requests_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8196-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8196-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8196-00000000000c'::uuid, 'agent_u', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8196-00000000000d'::uuid, 'agent_d', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8196-000000000001'::uuid, 'rep_r',   'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8196-000000000002'::uuid, 'rep_dr',  'fulfillment'),
    ('cccccccc-cccc-4ccc-8196-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8196-000000000001';
update public.profiles set upline_id = 'aaaaaaaa-aaaa-4aaa-8196-00000000000c' where id = 'aaaaaaaa-aaaa-4aaa-8196-00000000000a';
update public.profiles set is_demo = true where id in ('aaaaaaaa-aaaa-4aaa-8196-00000000000d', 'bbbbbbbb-bbbb-4bbb-8196-000000000002');
update public.app_settings set submit_live = true, agent_billing_enforced = false where id = 1;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, anon;
create temp table kept (name text primary key, snap text);
grant all on kept to authenticated;

create function public.p_sr_id(p_name text) returns uuid language sql as $f$
  select id from ids where name = p_name
$f$;

-- The ids of every request named with this start, in id order.
create function public.p_sr_ids(p_start text) returns uuid[] language sql as $f$
  select coalesce(array_agg(id order by id), '{}') from ids where left(name, length(p_start)) = p_start
$f$;

-- A policy that doesn't count on agent_weekly_usage. The last name is the case's name.
create function public.p_sr_policy(p_name text, p_agent uuid default 'aaaaaaaa-aaaa-4aaa-8196-00000000000a') returns uuid language sql as $f$
  with x as (
    insert into public.policies (agent_id, client_first_name, client_last_name, status, effective_date, fulfillment_assigned, replaced_old_policy)
    values (p_agent, 'Case', p_name, 'In Effect', (current_date - interval '3 months 10 days')::date, false, false)
    returning id
  )
  insert into ids (name, id) select p_name, x.id from x
  returning id
$f$;

-- A request through the RPC, as whoever is signed in.
create function public.p_sr_send(p_name text, p_policy text, p_kind text, p_note text default 'Please help') returns uuid language sql as $f$
  insert into ids (name, id) values (p_name, public.agent_submit_service_request(public.p_sr_id(p_policy), p_kind, p_note, 'morning'))
  returning id
$f$;

-- A task the RPC can't write: a system step, a client's request.
create function public.p_sr_task(p_name text, p_policy text, p_kind text, p_by text, p_agent uuid default 'aaaaaaaa-aaaa-4aaa-8196-00000000000a') returns uuid language sql as $f$
  with x as (
    insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
    values (p_agent, public.p_sr_id(p_policy), p_kind, 'requested', p_by)
    returning id
  )
  insert into ids (name, id) select p_name, x.id from x
  returning id
$f$;

-- Everything the two functions can change on a row, for "row unchanged".
create function public.p_sr_row(p_name text) returns text language sql as $f$
  select concat_ws('|', status, coalesce(due_at::text, '-'), coalesce(done_at::text, '-'), coalesce(outcome, '-'), coalesce(outcome_note, '-'))
    from public.servicing_tasks where id = public.p_sr_id(p_name)
$f$;

create function public.p_sr_keep(p_name text) returns void language sql as $f$
  insert into kept (name, snap) values (p_name, public.p_sr_row(p_name))
  on conflict (name) do update set snap = excluded.snap
$f$;

create function public.p_sr_kept(p_name text) returns text language sql as $f$
  select snap from kept where name = p_name
$f$;

-- What the agent's own list says about one request.
create function public.p_sr_seen(p_name text) returns text language sql as $f$
  select concat_ws('|', status, coalesce(due_at::text, '-'), coalesce(outcome, '-'), coalesce(outcome_note, '-'), done_at is not null)
    from public.agent_my_service_requests() where id = public.p_sr_id(p_name)
$f$;

-- Keeps the hint a call raised, so a check can name it (throws_ok can't).
create function public.p_sr_hint(p_sql text) returns text language plpgsql as $f$
declare v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'no hint: ' || sqlerrm);
end
$f$;

grant execute on function public.p_sr_id(text), public.p_sr_ids(text), public.p_sr_send(text, text, text, text),
  public.p_sr_row(text), public.p_sr_keep(text), public.p_sr_kept(text), public.p_sr_seen(text), public.p_sr_hint(text) to authenticated;
grant execute on function public.p_sr_id(text) to anon;

select public.p_sr_policy('ReqA');
select public.p_sr_policy('ReqA2');
select public.p_sr_policy('ReqB', 'aaaaaaaa-aaaa-4aaa-8196-00000000000b');
select public.p_sr_policy('ReqD', 'aaaaaaaa-aaaa-4aaa-8196-00000000000d');
select public.p_sr_policy('LapseSaved');
select public.p_sr_policy('LapseLost');
select public.p_sr_policy('LapseCancelled');
select public.p_sr_policy('PlainCase');

-- ── s. The shape ────────────────────────────────────────────────────────────
select ok(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
          and not has_function_privilege('anon', p.oid, 'execute')
          and has_function_privilege('authenticated', p.oid, 'execute'),
          format('s1 %s is security definer, search_path public, closed to anon', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('agent_submit_service_request', 'fulfillment_finish_request', 'fulfillment_schedule_request')
 order by p.proname;
select ok((select not p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and has_function_privilege('authenticated', p.oid, 'execute')
             from pg_proc p where p.oid = 'public.agent_my_service_requests(uuid)'::regprocedure),
          's2 agent_my_service_requests is security invoker, stable, search_path public, closed to anon');
select is(pg_get_function_result('public.agent_my_service_requests(uuid)'::regprocedure),
          'TABLE(id uuid, policy_id uuid, kind text, status text, note text, best_time text, due_at timestamp with time zone, done_at timestamp with time zone, outcome text, outcome_note text, created_at timestamp with time zone, updated_at timestamp with time zone)',
          's3 agent_my_service_requests returns the columns the page builds against');
select is((select data_type || ':' || is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'servicing_tasks' and column_name = 'outcome_note'),
          'text:YES', 's4 outcome_note is nullable text');
select is((select count(*) from pg_constraint c
            where c.conrelid = 'public.servicing_tasks'::regclass and c.contype = 'c'
              and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.servicing_tasks'::regclass and attname = 'kind')]),
          1::bigint, 's5 kind has one check, not two');
select lives_ok($$ insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
                   select 'aaaaaaaa-aaaa-4aaa-8196-00000000000a', public.p_sr_id('ReqA2'), k, 'scheduled', 'system'
                     from unnest(array['packet_check', 'review_call', 'chargeback_watch', 'beneficiary_change', 'address_change',
                                       'payment_change', 'draft_date_change', 'lapse_save', 'conversion', 'annual_review',
                                       'claim_help', 'carrier_call', 'other']) k $$,
                's6 the table takes all 13 kinds');
select throws_ok($$ select public.p_sr_task('s7', 'ReqA', 'not_a_kind', 'agent') $$, '23514', null, 's7 the table''s kind list is still closed');
select throws_ok($$ update public.servicing_tasks set outcome = 'maybe' where policy_id = public.p_sr_id('ReqA2') $$, '23514', null,
                 's8 outcome is still a closed list');

-- ── k. The kinds ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok(format('select public.p_sr_send(%L, %L, %L)', 'a_kind_' || k, 'ReqA', k), format('k1 the RPC takes %s', k))
  from unnest(array['beneficiary_change', 'address_change', 'payment_change', 'draft_date_change',
                    'lapse_save', 'claim_help', 'carrier_call', 'other']) k;
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'not_a_kind', 'x', 'morning') $$,
                 '22023', 'Pick what the client needs', 'k2 an unknown kind is refused');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'packet_check', 'x', 'morning') $$,
                 '22023', 'Pick what the client needs', 'k3 a system step''s kind is refused');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', null, 'morning') $$,
                 '22023', 'Say what the client needs', 'k4 other with a null note is refused');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', '', 'morning') $$,
                 '22023', 'Say what the client needs', 'k5 other with an empty note is refused');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', '    ', 'morning') $$,
                 '22023', 'Say what the client needs', 'k6 other with a spaces-only note is refused');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', E'\n\n', 'morning') $$,
                 '22023', 'Say what the client needs', 'k7 other with a newline-only note is refused');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', E' \t\r\n\f\v', 'morning') $$,
                 '22023', 'Say what the client needs', 'k8 other with a note of every kind of whitespace is refused');
select lives_ok($$ select public.p_sr_send('a_no_note', 'ReqA2', 'address_change', null) $$,
                'k9 any other kind still needs no note');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqB'), 'other', null, 'morning') $$,
                 '42501', 'Not your client', 'k10 whose client comes before the note, as before');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', 'x', 'night') $$,
                 '22023', 'Pick the best time to reach them', 'k11 a bad best time is refused');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', '', 'night') $$,
                 '22023', 'Say what the client needs', 'k12 the note comes before the best time');
reset role;
select is((select count(*) from public.servicing_tasks where id = any(public.p_sr_ids('a_kind_'))
              and requested_by = 'agent' and status = 'requested' and requested_by_id = 'aaaaaaaa-aaaa-4aaa-8196-00000000000a'),
          8::bigint, 'k13 each new row has requested_by agent, status requested and A''s id');
select is((select count(*) from public.servicing_tasks where kind = 'other' and requested_by = 'agent'), 1::bigint,
          'k14 the refused ones wrote nothing');
select is((select note from public.servicing_tasks where id = public.p_sr_id('a_kind_other')), 'Please help', 'k15 other keeps its note');
select is((select count(*) || ':' || min(detail ->> 'request_kind') || ':' || (min(detail::text) like '%Please help%')
             from public.policy_events where kind = 'service_request' and detail ->> 'request_id' = public.p_sr_id('a_kind_other')::text),
          '1:other:false', 'k16 other writes its one event, with no note in it');

update public.app_settings set submit_live = false where id = 1;
update public.profiles set has_servicing = false where id = 'aaaaaaaa-aaaa-4aaa-8196-00000000000b';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sr_hint($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', null, null) $$), 'not_live',
          'k17 submit_live off comes first');
reset role;
update public.app_settings set submit_live = true where id = 1;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sr_hint($$ select public.agent_submit_service_request(public.p_sr_id('ReqB'), 'other', null, null) $$), 'no_servicing',
          'k18 a plan with no Servicing is still refused');
reset role;
update public.profiles set has_servicing = true where id = 'aaaaaaaa-aaaa-4aaa-8196-00000000000b';
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqA'), 'other', 'x', null) $$,
                 '42501', 'Only an agent can send a request', 'k19 a rep cannot send a request');
reset role;

-- ── l. The weekly limit stays out of it ─────────────────────────────────────
-- The carrier is only for the control: a real Submit at the cap is refused.
insert into public.carriers (id, name, is_active) values ('dddddddd-dddd-4ddd-8196-000000000001', 'P Requests Life', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a"}', true);
create temp table usage_at_start as select weekly_cap, used from public.agent_weekly_usage();
grant select on usage_at_start to authenticated;
select set_config('request.jwt.claims', '', true);
insert into public.policies (agent_id, client_first_name, client_last_name, status, fulfillment_assigned, fulfillment_stage, replaced_old_policy)
select 'aaaaaaaa-aaaa-4aaa-8196-00000000000a', 'Cap', 'Deal ' || n, 'In Effect', true, 'Pending', false
  from generate_series(1, (select weekly_cap - used from usage_at_start)) n;
update public.app_settings set agent_billing_enforced = true where id = 1;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select ok((select used = weekly_cap and weekly_cap is not null and enforced from public.agent_weekly_usage()),
          'l1 A has used the whole weekly cap, with billing enforced');
select is(public.p_sr_hint($$ select public.agent_submit_deal(
            p_first => 'Over', p_last => 'Cap', p_phone => '5125550100', p_city => 'Austin', p_state => 'TX', p_timezone => 'America/Chicago',
            p_new_carrier => 'dddddddd-dddd-4ddd-8196-000000000001', p_policy_number => 'NEW-1', p_replaced => false,
            p_best_time => 'morning', p_sms_consent => true) $$),
          'weekly_cap', 'l2 control: a real Submit at the cap is refused');
select lives_ok($$ select public.p_sr_send('a_at_cap', 'ReqA', 'carrier_call') $$, 'l3 A still sends a request at the cap');
select lives_ok($$ select public.p_sr_send('a_at_cap_other', 'ReqA', 'other', 'Something else') $$, 'l4 and an other');
select is((select used from public.agent_weekly_usage()), (select weekly_cap from public.agent_weekly_usage()), 'l5 used still equals the cap');
select is((select used from public.agent_weekly_usage()), (select weekly_cap from usage_at_start), 'l6 agent_weekly_usage is unchanged');
reset role;
update public.app_settings set agent_billing_enforced = false where id = 1;

-- ── o. Only your own client ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.p_sr_send('a_on_2', 'ReqA2', 'beneficiary_change', 'Add the daughter') $$, 'o1 A sends on A''s policy');
select throws_ok($$ select public.agent_submit_service_request(public.p_sr_id('ReqB'), 'carrier_call', 'x', 'morning') $$,
                 '42501', 'Not your client', 'o2 A is refused on B''s policy');
reset role;
select is((select count(*) from public.servicing_tasks where policy_id = public.p_sr_id('ReqB')), 0::bigint, 'o3 and nothing landed on B''s policy');

-- ── m. The agent's list ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.p_sr_send('b_old', 'ReqB', 'carrier_call');
select public.p_sr_send('b_new', 'ReqB', 'claim_help');
select public.p_sr_send('b_tie1', 'ReqB', 'address_change');
select public.p_sr_send('b_tie2', 'ReqB', 'payment_change');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000d","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.p_sr_send('d_own', 'ReqD', 'carrier_call');
select public.p_sr_send('d_own2', 'ReqD', 'claim_help');
reset role;
select set_config('request.jwt.claims', '', true);
update public.servicing_tasks set created_at = now() - interval '3 days' where id = public.p_sr_id('b_old');
update public.servicing_tasks set created_at = now() - interval '2 days' where id = public.p_sr_id('b_new');
select public.p_sr_task('sys_a', 'ReqA', 'carrier_call', 'system');
select public.p_sr_task('a_client', 'ReqA', 'claim_help', 'client');
-- Across the wall, in A's name, so only the wall can hide it.
select public.p_sr_task('demo_in_a', 'ReqD', 'carrier_call', 'agent');
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, assigned_rep_id)
values ('dddddddd-dddd-4ddd-8196-00000000000a', 'Lead A', 'Lead A', '+15125550190', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8196-00000000000a');
with x as (
  insert into public.servicing_tasks (agent_id, lead_id, kind, requested_by)
  values ('aaaaaaaa-aaaa-4aaa-8196-00000000000a', 'dddddddd-dddd-4ddd-8196-00000000000a', 'carrier_call', 'agent')
  returning id
)
insert into ids (name, id) select 'a_lead_only', x.id from x;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(array(select id from public.agent_my_service_requests() order by id), public.p_sr_ids('a_'),
          'm1 A sees exactly A''s requests: the RPC''s, a client''s and a lead-only one');
select is((select count(*) from public.agent_my_service_requests() where id = any(public.p_sr_ids('b_'))), 0::bigint, 'm2 none of B''s');
select is((select count(*) from public.agent_my_service_requests() where id = public.p_sr_id('sys_a')), 0::bigint, 'm3 a system step never appears');
select ok((select count(*) from public.servicing_tasks where id = public.p_sr_id('sys_a')) = 1, 'm4 control: A can read that step in the table');
select is((select count(*) from public.agent_my_service_requests() where kind in ('packet_check', 'review_call', 'chargeback_watch')), 0::bigint,
          'm5 nor do the 13 system rows on ReqA2');
select is((select count(*) from public.agent_my_service_requests(public.p_sr_id('ReqB'))), 0::bigint, 'm6 A passing B''s policy gets 0 rows');
select is((select count(*) from public.agent_my_service_requests('99999999-9999-4999-8999-999999999999')), 0::bigint, 'm7 so does an id that is nobody''s');
select is((select array_agg(kind order by kind) from public.agent_my_service_requests(public.p_sr_id('ReqA2'))),
          array['address_change', 'beneficiary_change'], 'm8 A passing one of A''s policies gets that policy''s requests');
select is((select count(*) from public.agent_my_service_requests(null)), (select count(*) from public.agent_my_service_requests()), 'm9 a null policy means all');
select is((select concat_ws('|', policy_id = public.p_sr_id('ReqA2'), kind, status, note, best_time, due_at is null, done_at is null, outcome is null, outcome_note is null, created_at = now(), updated_at = now())
             from public.agent_my_service_requests() where id = public.p_sr_id('a_on_2')),
          't|beneficiary_change|requested|Add the daughter|morning|t|t|t|t|t|t', 'm10 the row carries what was sent');
select is((select policy_id from public.agent_my_service_requests() where id = public.p_sr_id('a_lead_only')), null::uuid, 'm11 a lead-only request has no policy_id');
select is((select count(*) from public.agent_my_service_requests() where id = public.p_sr_id('demo_in_a')), 0::bigint,
          'm12 the demo wall hides a demo task in A''s name');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.agent_my_service_requests() where id = any(public.p_sr_ids('a_'))), 0::bigint, 'm13 B sees none of A''s');
select is((select count(*) from public.agent_my_service_requests(public.p_sr_id('ReqA'))), 0::bigint, 'm14 even passing A''s policy');
select is(array(select id from public.agent_my_service_requests()),
          array(select id from ids where name in ('b_tie1', 'b_tie2') order by id desc)
          || public.p_sr_id('b_new') || public.p_sr_id('b_old'),
          'm15 newest first, and id desc breaks a tie');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.agent_my_service_requests()), 0::bigint, 'm16 U, A''s upline, sees none of A''s');
select is((select count(*) from public.agent_my_service_requests(public.p_sr_id('ReqA'))), 0::bigint, 'm17 even passing A''s policy');
select ok((select count(*) from public.servicing_tasks where id = any(public.p_sr_ids('a_kind_'))) = 8, 'm18 control: U can read them in the table');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.agent_my_service_requests()), 0::bigint, 'm19 a rep has none of their own');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000d","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(array(select id from public.agent_my_service_requests() order by id), public.p_sr_ids('d_own'), 'm20 D sees D''s, on the demo side');
reset role;

select set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
select throws_ok($$ select * from public.agent_my_service_requests() $$, '42501', null, 'm21 anon cannot read the list');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_on_2'), now() + interval '1 day') $$, '42501', null, 'm22 anon cannot schedule');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_on_2'), 'x') $$, '42501', null, 'm23 anon cannot finish');
reset role;

-- Control: with the wall gone A does see that task, so m12 is the wall's doing.
savepoint wall_control;
drop policy servicing_tasks_demo_wall on public.servicing_tasks;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.agent_my_service_requests() where id = public.p_sr_id('demo_in_a')), 1::bigint,
          'm24 control: without the demo wall A sees the demo task, so the list runs under RLS');
rollback to savepoint wall_control;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── c. Schedule ─────────────────────────────────────────────────────────────
create temp table counts_before as select (select count(*) from public.notifications) as notes;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.p_sr_send('a_c1', 'PlainCase', 'address_change');
select public.p_sr_send('a_c2', 'ReqA', 'address_change');
select public.p_sr_send('a_c_done', 'ReqA', 'draft_date_change');
select public.p_sr_send('a_c_cancelled', 'ReqA', 'draft_date_change');
select public.p_sr_send('a_c_open', 'ReqA', 'carrier_call');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c1'), now() + interval '2 days') $$, 'c1 R schedules a request');
select is((select concat_ws('|', status, due_at = now() + interval '2 days') from public.servicing_tasks where id = public.p_sr_id('a_c1')),
          'scheduled|t', 'c2 status scheduled with the date in due_at');
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c1'), now() + interval '5 days') $$, 'c3 R reschedules it');
update public.servicing_tasks set status = 'in_progress' where id = public.p_sr_id('a_c2');
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c2'), now() + interval '1 day') $$, 'c4 an in_progress request can be scheduled');
select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_c_done'), 'Draft date moved') $$, 'c5 fixture: one done request');
update public.servicing_tasks set status = 'cancelled' where id = public.p_sr_id('a_c_cancelled');
select public.p_sr_keep('a_c_open');
select public.p_sr_keep('a_c_done');
select public.p_sr_keep('a_c_cancelled');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c_open'), null) $$, '22023', 'Pick a time in the future', 'c6 a null time is refused');
select is(public.p_sr_row('a_c_open'), public.p_sr_kept('a_c_open'), 'c7 row unchanged');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c_open'), now() - interval '1 hour') $$, '22023', 'Pick a time in the future', 'c8 a past time is refused');
select is(public.p_sr_row('a_c_open'), public.p_sr_kept('a_c_open'), 'c9 row unchanged');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c_open'), now()) $$, '22023', 'Pick a time in the future', 'c10 right now is refused');
select is(public.p_sr_row('a_c_open'), public.p_sr_kept('a_c_open'), 'c11 row unchanged');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c_done'), now() + interval '1 day') $$, '22023', 'This request is closed', 'c12 a done request is refused');
select is(public.p_sr_row('a_c_done'), public.p_sr_kept('a_c_done'), 'c13 row unchanged');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_c_cancelled'), now() + interval '1 day') $$, '22023', 'This request is closed', 'c14 a cancelled request is refused');
select is(public.p_sr_row('a_c_cancelled'), public.p_sr_kept('a_c_cancelled'), 'c15 row unchanged');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sr_seen('a_c1'), concat_ws('|', 'scheduled', (now() + interval '5 days')::text, '-', '-', 'f'), 'c16 the agent sees scheduled and the newest date');
select is(public.p_sr_seen('a_c2'), concat_ws('|', 'scheduled', (now() + interval '1 day')::text, '-', '-', 'f'), 'c17 and the in_progress one, now scheduled');
reset role;

-- ── f. Finish ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.p_sr_send('a_f1', 'PlainCase', 'address_change');
select public.p_sr_send('a_f2', 'ReqA', 'other', 'Client has a question');
select public.p_sr_send('a_f_long', 'ReqA', 'carrier_call');
select public.p_sr_send('a_f_done', 'ReqA', 'carrier_call');
select public.p_sr_send('a_f_cancelled', 'ReqA', 'carrier_call');
select public.p_sr_send('a_f_open', 'ReqA', 'carrier_call');
select public.p_sr_send('a_f_lapse', 'ReqA', 'lapse_save');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f1'), E' \n Address updated with the carrier\t\n') $$, 'f1 R finishes a request');
select is((select concat_ws('|', status, done_at = now(), outcome_note, outcome is null) from public.servicing_tasks where id = public.p_sr_id('a_f1')),
          'done|t|Address updated with the carrier|t', 'f2 status done, done_at stamped, the note saved trimmed, no key');
update public.servicing_tasks set status = 'in_progress' where id = public.p_sr_id('a_f2');
select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f2'), 'Answered') $$, 'f3 an in_progress request can be finished');
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_f_long'), now() + interval '1 day') $$, 'f4 a scheduled one can too');
select lives_ok(format('select public.fulfillment_finish_request(public.p_sr_id(''a_f_long''), %L)', '  ' || repeat('n', 1000) || '  '), 'f5 1000 characters after trimming is allowed');
select is((select length(outcome_note) || ':' || (due_at = now() + interval '1 day') from public.servicing_tasks where id = public.p_sr_id('a_f_long')),
          '1000:true', 'f6 and saved whole, keeping its date');

select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_done'), 'First answer') $$, 'f7 fixture: one done request');
update public.servicing_tasks set status = 'cancelled' where id = public.p_sr_id('a_f_cancelled');
reset role;
-- Backdated, so a second finish restamping it would show.
update public.servicing_tasks set done_at = now() - interval '2 days' where id = public.p_sr_id('a_f_done');
select public.p_sr_keep('a_f_done');
select public.p_sr_keep('a_f_cancelled');
select public.p_sr_keep('a_f_open');
select public.p_sr_keep('a_f_lapse');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_done'), 'Second answer') $$, '22023', 'This request is closed', 'f8 a done request is refused');
select is(public.p_sr_row('a_f_done'), public.p_sr_kept('a_f_done'), 'f9 outcome_note, outcome and done_at unchanged');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_cancelled'), 'Answer') $$, '22023', 'This request is closed', 'f10 a cancelled request is refused');
select is(public.p_sr_row('a_f_cancelled'), public.p_sr_kept('a_f_cancelled'), 'f11 row unchanged');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_open'), null) $$, '22023', 'Say what happened', 'f12 a null note is refused');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_open'), '   ') $$, '22023', 'Say what happened', 'f13 a blank note is refused');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_open'), E'\n\t\n') $$, '22023', 'Say what happened', 'f14 a newline-only note is refused');
select throws_ok(format('select public.fulfillment_finish_request(public.p_sr_id(''a_f_open''), %L)', repeat('n', 1001)), '22023', 'Keep the outcome to 1000 characters', 'f15 a note over 1000 characters is refused');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_lapse'), 'Saved it', 'maybe') $$, '22023', 'Unknown outcome maybe', 'f16 a bad key is 22023, not 23514');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_open'), 'Done', 'saved') $$, '22023', 'Only a lapse save has an outcome key', 'f17 a key on a non-lapse kind is refused');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_f_lapse'), 'Done') $$, '22023', 'Say how the lapse save ended', 'f18 a lapse_save with no key is refused');
select is(public.p_sr_row('a_f_lapse'), public.p_sr_kept('a_f_lapse'), 'f19 and that lapse_save stays open');
select is(public.p_sr_row('a_f_open'), public.p_sr_kept('a_f_open'), 'f20 the open request came through those unchanged');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sr_seen('a_f1'), 'done|-|-|Address updated with the carrier|t', 'f21 the agent sees done and the outcome');
select is(public.p_sr_seen('a_f2'), 'done|-|-|Answered|t', 'f22 and on the other that was in progress');
reset role;

-- ── t. The stage reads the key ──────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.p_sr_send('a_t_saved', 'LapseSaved', 'lapse_save');
select public.p_sr_send('a_t_lost', 'LapseLost', 'lapse_save');
select public.p_sr_send('a_t_cancelled', 'LapseCancelled', 'lapse_save');
reset role;
select is((select stage from public.policy_servicing_status where client_last_name = 'LapseSaved'), 'needs_attention', 't1 an open lapse_save reads needs attention');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.fulfillment_finish_request(public.p_sr_id('a_t_saved'), 'Paid the back premium', 'saved');
select public.fulfillment_finish_request(public.p_sr_id('a_t_lost'), 'Could not reach them', 'lapsed');
select public.fulfillment_finish_request(public.p_sr_id('a_t_cancelled'), 'Client cancelled', 'client_cancelled');
reset role;
select is((select stage || ':' || next_step from public.policy_servicing_status where client_last_name = 'LapseSaved'), 'needs_attention:saved_watch',
          't2 finished with saved reads needs attention, saved_watch');
select is((select stage from public.policy_servicing_status where client_last_name = 'LapseLost'), 'ended', 't3 finished with lapsed reads ended');
select is((select stage from public.policy_servicing_status where client_last_name = 'LapseCancelled'), 'ended', 't4 finished with client_cancelled reads ended');
select is((select stage || ':' || open_requests from public.policy_servicing_status where client_last_name = 'PlainCase'), 'protected:1',
          't5 a finished request on another kind leaves the stage alone, and only a_c1 is still open');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sr_seen('a_t_saved'), 'done|-|saved|Paid the back premium|t', 't6 the agent sees both the key and the note');
reset role;

-- ── w. Who can move a request ───────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.p_sr_send('a_w', 'ReqA', 'carrier_call');
select public.p_sr_send('a_w_admin', 'ReqA', 'carrier_call');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_w'), now() + interval '1 day') $$, '42501', 'Only Fulfillment can do this', 'w1 the agent cannot schedule their own request');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_w'), 'Done') $$, '42501', 'Only Fulfillment can do this', 'w2 nor finish it');
select throws_ok($$ select public.fulfillment_schedule_request('99999999-9999-4999-8999-999999999999', now() + interval '1 day') $$, '42501', 'Only Fulfillment can do this', 'w3 an id that is nobody''s gets the same answer, on schedule');
select throws_ok($$ select public.fulfillment_finish_request('99999999-9999-4999-8999-999999999999', 'Done') $$, '42501', 'Only Fulfillment can do this', 'w4 and on finish');
select throws_ok($$ select public.fulfillment_schedule_request(null, null) $$, '42501', 'Only Fulfillment can do this', 'w5 the role comes before the inputs, on schedule');
select throws_ok($$ select public.fulfillment_finish_request(null, null, 'maybe') $$, '42501', 'Only Fulfillment can do this', 'w6 and on finish');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_w'), now() + interval '1 day') $$, '42501', 'Only Fulfillment can do this', 'w7 the upline cannot schedule it');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_w'), 'Done') $$, '42501', 'Only Fulfillment can do this', 'w8 nor finish it');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_w'), now() + interval '1 day') $$, '42501', 'Only Fulfillment can do this', 'w9 another agent cannot schedule it');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_w'), 'Done') $$, '42501', 'Only Fulfillment can do this', 'w10 nor finish it');
reset role;
select set_config('request.jwt.claims', '', true);
select is(public.p_sr_row('a_w'), 'requested|-|-|-|-', 'w11 the agents changed nothing');

-- A rep whose access is off.
update public.profiles set is_active = false where id = 'bbbbbbbb-bbbb-4bbb-8196-000000000001';
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_w'), now() + interval '1 day') $$, '42501', 'Only Fulfillment can do this', 'w12 an inactive rep cannot schedule');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_w'), 'Done') $$, '42501', 'Only Fulfillment can do this', 'w13 nor finish');
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set is_active = true where id = 'bbbbbbbb-bbbb-4bbb-8196-000000000001';

-- No such row, no task, and a system step.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.fulfillment_schedule_request('99999999-9999-4999-8999-999999999999', now() + interval '1 day') $$, 'P0002', 'Request not found', 'w14 no such request, on schedule');
select throws_ok($$ select public.fulfillment_finish_request('99999999-9999-4999-8999-999999999999', 'Done') $$, 'P0002', 'Request not found', 'w15 and on finish');
select throws_ok($$ select public.fulfillment_schedule_request(null, now() + interval '1 day') $$, '22023', 'Pick a request', 'w16 a null task, on schedule');
select throws_ok($$ select public.fulfillment_finish_request(null, 'Done') $$, '22023', 'Pick a request', 'w17 and on finish');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('sys_a'), now() + interval '1 day') $$, '22023', 'This is not a service request', 'w18 a system step cannot be scheduled');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('sys_a'), 'Done') $$, '22023', 'This is not a service request', 'w19 nor finished');
select is(public.p_sr_row('sys_a'), 'requested|-|-|-|-', 'w20 the step is unchanged');
-- The demo wall, by hand: definer skips RLS.
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('d_own'), now() + interval '1 day') $$, 'P0002', 'Request not found', 'w21 a live rep cannot schedule across the wall, same words');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('d_own'), 'Done') $$, 'P0002', 'Request not found', 'w22 nor finish');
-- A client's request and a lead-only one are both requests.
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_client'), now() + interval '1 day') $$, 'w23 a client''s request can be scheduled');
select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_client'), 'Done') $$, 'w24 and finished');
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_lead_only'), now() + interval '1 day') $$, 'w25 a request with no policy isn''t behind the wall: schedule');
select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_lead_only'), 'Done') $$, 'w26 and finish');
reset role;

select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_w_admin'), now() + interval '1 day') $$, 'w27 admin can schedule');
select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_w_admin'), 'Done') $$, 'w28 and finish');
select throws_ok($$ select public.fulfillment_schedule_request('99999999-9999-4999-8999-999999999999', now() + interval '1 day') $$, 'P0002', 'Request not found', 'w29 admin: no such request');
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('d_own'), now() + interval '1 day') $$, 'P0002', 'Request not found', 'w30 a live admin cannot schedule across the wall');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('d_own'), 'Done') $$, 'P0002', 'Request not found', 'w31 nor finish');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('a_w'), now() + interval '1 day') $$, 'P0002', 'Request not found', 'w32 a demo rep cannot schedule a live request');
select throws_ok($$ select public.fulfillment_finish_request(public.p_sr_id('a_w'), 'Done') $$, 'P0002', 'Request not found', 'w33 nor finish one');
reset role;
select set_config('request.jwt.claims', '', true);
select is(public.p_sr_row('a_w'), 'requested|-|-|-|-', 'w34 the live request is unchanged');
select is(public.p_sr_row('d_own'), 'requested|-|-|-|-', 'w35 and so is the demo one');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.fulfillment_schedule_request(public.p_sr_id('d_own'), now() + interval '1 day') $$, 'w36 a demo rep can schedule a demo request');
select lives_ok($$ select public.fulfillment_finish_request(public.p_sr_id('d_own2'), 'Done') $$, 'w37 and finish one');
reset role;
select is((select status from public.servicing_tasks where id = public.p_sr_id('d_own')) || ':' || (select status from public.servicing_tasks where id = public.p_sr_id('d_own2')),
          'scheduled:done', 'w38 both saved');

-- ── e. Nothing else moved ───────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.policy_events where kind = 'service_request' and detail ->> 'request_id' = public.p_sr_id('a_c1')::text), 1::bigint,
          'e1 a scheduled request has only the RPC''s event');
select is((select count(*) from public.policy_events where policy_id = public.p_sr_id('PlainCase')), 2::bigint,
          'e2 two requests on PlainCase, one scheduled and one finished, wrote two events in all');
select is((select count(*) from public.notifications), (select notes from counts_before), 'e3 no notification from scheduling or finishing');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8196-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ update public.servicing_tasks set due_at = now() where id = public.p_sr_id('a_w') $$, '42501', 'permission denied for table servicing_tasks', 'e4 a rep still cannot write due_at directly');
select throws_ok($$ update public.servicing_tasks set outcome_note = 'x' where id = public.p_sr_id('a_w') $$, '42501', 'permission denied for table servicing_tasks', 'e5 nor outcome_note');
select throws_ok($$ update public.servicing_tasks set outcome = 'saved' where id = public.p_sr_id('a_w') $$, '42501', 'permission denied for table servicing_tasks', 'e6 nor outcome');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8196-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ update public.servicing_tasks set outcome_note = 'x' where id = public.p_sr_id('a_w') $$, '42501', 'permission denied for table servicing_tasks', 'e7 an agent cannot write outcome_note');
reset role;

select * from finish();
rollback;
