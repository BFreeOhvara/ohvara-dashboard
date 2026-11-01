-- p_servicing_functions — pgTAP checks for 195_servicing_functions.sql: list my
-- items, Submit's seeded steps, notes, read one client.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_servicing_functions.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agents A and B (no upline link), U (A's upline), D (the demo side), S (makes
-- the deals, so A's list stays exact), C (hits the weekly cap), rep R, admin Z.
-- Every date is worked out from today, so a case can't go stale.

begin;
create extension if not exists pgtap with schema extensions;
select plan(134);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_functions_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8195-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8195-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8195-00000000000c'::uuid, 'agent_u', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8195-00000000000d'::uuid, 'agent_d', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8195-00000000000e'::uuid, 'agent_s', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8195-00000000000f'::uuid, 'agent_c', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8195-000000000001'::uuid, 'rep_r',   'fulfillment'),
    ('cccccccc-cccc-4ccc-8195-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8195-000000000001';
update public.profiles set upline_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000c' where id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000a';
update public.profiles set is_demo = true where id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000d';

insert into public.carriers (id, name, is_active, hours, hours_tz, hours_status, hours_checked_at)
select i.id, i.name, true, h.hours, 'America/Chicago', 'verified', now()
  from (values ('dddddddd-dddd-4ddd-8195-000000000001'::uuid, 'P Functions Leaving Life'),
               ('dddddddd-dddd-4ddd-8195-000000000002'::uuid, 'P Functions New Life')) as i(id, name),
       (select jsonb_object_agg(d, jsonb_build_object('open', '00:00', 'close', '23:59')) as hours
          from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d) h;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, anon;

-- Keeps the hint a call raised, so a check can name it (throws_ok can't).
create function public.p_sf_hint(p_sql text) returns text language plpgsql as $f$
declare v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'no hint: ' || sqlerrm);
end
$f$;

-- A No deal. The last name is the case's name.
create function public.p_sf_deal(p_name text, p_effective date default null, p_best text default 'morning') returns uuid language sql as $f$
  select public.agent_submit_deal(
    p_first => 'Deal', p_last => p_name, p_phone => '5125550100', p_city => 'Austin', p_state => 'TX',
    p_timezone => 'America/Chicago', p_new_carrier => 'dddddddd-dddd-4ddd-8195-000000000002',
    p_policy_number => 'NEW-1', p_replaced => false, p_best_time => p_best, p_sms_consent => true,
    p_effective_date => p_effective)
$f$;

-- n No deals in a row, stopping at the first refusal: returns how many went in.
create function public.p_sf_many(p_n integer) returns integer language plpgsql as $f$
declare i integer := 0;
begin
  while i < p_n loop
    perform public.p_sf_deal('Bulk ' || i);
    i := i + 1;
  end loop;
  return i;
end
$f$;

-- The noon UTC a seed falls on.
create function public.p_sf_noon(p_day date) returns timestamptz language sql as $f$
  select (p_day + time '12:00') at time zone 'UTC'
$f$;

-- A seed's due_at, by deal and kind.
create function public.p_sf_due(p_policy uuid, p_kind text) returns timestamptz language sql as $f$
  select due_at from public.servicing_tasks where policy_id = p_policy and kind = p_kind
$f$;

-- A policy in an agent's book, written directly so it seeds nothing.
create function public.p_sf_policy(p_agent uuid, p_first text, p_last text, p_phone text default null,
                                   p_created timestamptz default now()) returns uuid language sql as $f$
  insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, status, effective_date,
                               fulfillment_assigned, fulfillment_stage, replaced_old_policy, created_at)
  values (p_agent, p_first, p_last, p_phone, 'In Effect', current_date - 40, true, 'Pending', false, p_created)
  returning id
$f$;

-- A task, written directly and named in ids. updated_at is a day old, so anything
-- that touches the row later shows.
create function public.p_sf_task(p_name text, p_agent uuid, p_policy uuid, p_lead uuid, p_kind text, p_status text,
                                 p_due timestamptz, p_by text default 'system', p_created timestamptz default now()) returns uuid language sql as $f$
  with made as (
    insert into public.servicing_tasks (agent_id, policy_id, lead_id, kind, status, due_at, requested_by, note, created_at, updated_at)
    values (p_agent, p_policy, p_lead, p_kind, p_status, p_due, p_by, 'Note on ' || p_name, p_created, now() - interval '1 day')
    returning id
  ), named as (
    insert into ids select p_name, id from made returning id
  )
  select id from named
$f$;

-- The list, as the fixture names of its rows, in order.
create function public.p_sf_list(p_status text default null) returns text language sql as $f$
  select string_agg(i.name, ',' order by r.ordinality)
    from public.agent_servicing_items(p_status) with ordinality r
    join ids i on i.id = r.task_id
$f$;

create function public.p_sf_key(p_last text) returns text language sql as $f$
  select client_key from public.policy_servicing_status where client_last_name = p_last limit 1
$f$;

grant execute on function public.p_sf_hint(text), public.p_sf_deal(text, date, text), public.p_sf_many(integer),
  public.p_sf_list(text) to authenticated;

-- ── a. The shape, before the test turns anything on ─────────────────────────
select is((select submit_live from public.app_settings where id = 1), false, 'a1 the migration leaves submit_live off');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'agent_submit_deal'), 1::bigint,
          'a2 exactly one agent_submit_deal exists');
select is(to_regprocedure('public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean)'), null,
          'a3 the 13-argument signature is gone');
select ok(position('weekly_cap' in pg_get_functiondef('public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date)'::regprocedure)) > 0,
          'a4 the new agent_submit_deal keeps the weekly cap check');
select is((select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text
                             || ':' || coalesce(array_to_string(p.proconfig, ';'), ''), ',' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('add_servicing_note', 'agent_client_detail', 'agent_servicing_items', 'agent_submit_deal')),
          'add_servicing_note:definer:v:search_path=public,agent_client_detail:invoker:s:search_path=public,agent_servicing_items:invoker:s:search_path=public,agent_submit_deal:definer:v:search_path=public',
          'a5 definer, invoker, stable and search_path are as the contract says');
select ok(not has_function_privilege('public', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
          and has_function_privilege('authenticated', p.oid, 'execute'),
          format('a6 %s is closed to public and anon, open to authenticated', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('add_servicing_note', 'agent_client_detail', 'agent_servicing_items', 'agent_submit_deal')
 order by p.proname;
select ok((select relrowsecurity from pg_class where oid = 'public.servicing_task_notes'::regclass), 'a7 servicing_task_notes has RLS on');
select is((select string_agg(cmd, ',') from pg_policies where schemaname = 'public' and tablename = 'servicing_task_notes'), 'SELECT',
          'a8 its one policy is the read policy');
select ok(has_table_privilege('authenticated', 'public.servicing_task_notes', 'select')
          and not has_table_privilege('authenticated', 'public.servicing_task_notes', 'insert, update, delete')
          and not has_table_privilege('anon', 'public.servicing_task_notes', 'select, insert, update, delete'),
          'a9 authenticated can only read it and anon has nothing');
select is((select string_agg(tgname::text, ',' order by tgname) from pg_trigger
            where tgrelid = 'public.servicing_task_notes'::regclass and not tgisinternal),
          'a0_block_inactive_writer,a0_block_locked_self_signup', 'a10 both triggers are on the notes table');
select is((select string_agg(a.attname::text || ':' || c.confdeltype::text, ',' order by a.attname)
             from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.conrelid = 'public.servicing_task_notes'::regclass and c.contype = 'f'),
          'author_id:n,task_id:c', 'a11 deleting an account nulls the author, deleting a task takes its notes');
select ok(obj_description('public.servicing_tasks'::regclass) like '%agent_submit_deal%', 'a12 the servicing_tasks comment names agent_submit_deal');

-- ── b. submit_live off ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000e","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sf_hint($$ select public.p_sf_deal('Off') $$), 'not_live', 'b1 with submit_live off a deal is refused');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.policies where client_last_name = 'Off'), 0::bigint, 'b2 and writes no policy');
select is((select count(*) from public.servicing_tasks where agent_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000e'), 0::bigint, 'b3 and no tasks');
update public.app_settings set submit_live = true, agent_billing_enforced = false where id = 1;

-- ── c. A deal's steps ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000e","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'dated', public.p_sf_deal('Dated', (current_date + 5)::date, 'afternoon');
insert into ids select 'undated', public.p_sf_deal('Undated', null, 'evening');
insert into ids select 'leap', public.p_sf_deal('Leap', '2024-02-29'::date);
-- The argument names useAgentBookings.js:133 sends, exactly.
insert into ids select 'app', public.agent_submit_deal(
  p_first => 'Deal', p_last => 'FromApp', p_phone => '5125550100',
  p_city => 'Austin', p_state => 'TX', p_timezone => 'America/Chicago',
  p_new_carrier => 'dddddddd-dddd-4ddd-8195-000000000002', p_policy_number => null,
  p_replaced => false, p_old_carrier => null,
  p_at => null, p_best_time => 'morning',
  p_sms_consent => false);
reset role;
select set_config('request.jwt.claims', '', true);

select is((select effective_date from public.policies where id = (select id from ids where name = 'dated')), (current_date + 5)::date,
          'c1 p_effective_date is saved to policies.effective_date');
select is((select string_agg(kind, ',' order by kind) from public.servicing_tasks where policy_id = (select id from ids where name = 'dated')),
          'chargeback_watch,packet_check,review_call', 'c2 a dated deal has exactly the 3 tasks');
select is(public.p_sf_due((select id from ids where name = 'dated'), 'packet_check'), public.p_sf_noon((current_date + 5 + 3)::date),
          'c3 packet_check is due at noon UTC on effective + 3 days');
select is(public.p_sf_due((select id from ids where name = 'dated'), 'review_call'), public.p_sf_noon((current_date + 5 + 10)::date),
          'c4 review_call is due at noon UTC on effective + 10 days');
select is(public.p_sf_due((select id from ids where name = 'dated'), 'chargeback_watch'), public.p_sf_noon(((current_date + 5) + interval '12 months')::date),
          'c5 chargeback_watch is due at noon UTC on effective + 12 months');

select is((select effective_date from public.policies where id = (select id from ids where name = 'undated')), null::date,
          'c6 with no date policies.effective_date stays null');
select is((select string_agg(kind, ',' order by kind) from public.servicing_tasks where policy_id = (select id from ids where name = 'undated')),
          'chargeback_watch,packet_check,review_call', 'c7 and it still has exactly the 3 tasks');
select is(public.p_sf_due((select id from ids where name = 'undated'), 'packet_check'), public.p_sf_noon((current_date + 3)::date),
          'c8 packet_check counts from today');
select is(public.p_sf_due((select id from ids where name = 'undated'), 'review_call'), public.p_sf_noon((current_date + 10)::date),
          'c9 review_call counts from today');
select is(public.p_sf_due((select id from ids where name = 'undated'), 'chargeback_watch'), public.p_sf_noon((current_date + interval '12 months')::date),
          'c10 chargeback_watch counts from today');

-- The exact values, written out, on the date interval arithmetic is hardest on.
select is(public.p_sf_due((select id from ids where name = 'leap'), 'packet_check'), '2024-03-03 12:00:00+00'::timestamptz, 'c11 Feb 29 + 3 days is Mar 3, noon UTC');
select is(public.p_sf_due((select id from ids where name = 'leap'), 'review_call'), '2024-03-10 12:00:00+00'::timestamptz, 'c12 Feb 29 + 10 days is Mar 10, noon UTC');
select is(public.p_sf_due((select id from ids where name = 'leap'), 'chargeback_watch'), '2025-02-28 12:00:00+00'::timestamptz, 'c13 Feb 29 + 12 months is Feb 28, noon UTC');

select is((select concat_ws('|', stage, next_step, next_date = public.p_sf_noon((current_date + 5 + 3)::date))
             from public.policy_servicing_status where policy_id = (select id from ids where name = 'dated')),
          'setting_up|packet_check|t', 'c14 a submitted deal reads setting up, packet_check next at its due_at');
select is((select string_agg(kind || ':' || coalesce(best_time, 'null'), ',' order by kind)
             from public.servicing_tasks where policy_id = (select id from ids where name = 'dated')),
          'chargeback_watch:null,packet_check:null,review_call:afternoon', 'c15 only review_call carries the deal''s best time');
select is((select count(*) from public.servicing_tasks
            where policy_id in (select id from ids where name in ('dated', 'undated', 'leap', 'app'))
              and requested_by = 'system' and requested_by_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000e'
              and agent_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000e' and status = 'scheduled' and lead_id is null),
          12::bigint, 'c16 all seeds are system, requested_by_id the agent, scheduled, no lead');
select is((select string_agg(kind, ',' order by kind) from public.servicing_tasks where policy_id = (select id from ids where name = 'app')),
          'chargeback_watch,packet_check,review_call', 'c17 the call with the app''s argument names works and seeds the 3');

-- A Yes deal's old-policy cancellation stays in today's machinery, not a task.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000e","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'yes', public.agent_submit_deal(
  p_first => 'Yes', p_last => 'YesDeal', p_phone => '5125550101', p_city => 'Austin', p_state => 'TX',
  p_timezone => 'America/Chicago', p_new_carrier => 'dddddddd-dddd-4ddd-8195-000000000002',
  p_replaced => true, p_old_carrier => 'dddddddd-dddd-4ddd-8195-000000000001',
  p_at => (date_trunc('day', now() at time zone 'America/Chicago') + interval '1 day 12 hours') at time zone 'America/Chicago',
  p_best_time => 'evening');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select string_agg(kind || ':' || coalesce(best_time, 'null'), ',' order by kind) from public.servicing_tasks where policy_id = (select id from ids where name = 'yes')),
          'chargeback_watch:null,packet_check:null,review_call:evening', 'c18 a Yes deal seeds the same 3 and no old-policy task');

-- The watch's due_at against the view. With the setup steps done the task gives the
-- date; with the task gone the view works out its own. They must be one instant.
update public.servicing_tasks set status = 'done'
 where policy_id in (select id from ids where name in ('dated', 'undated')) and kind in ('packet_check', 'review_call');
select is((select concat_ws('|', stage, next_step, next_date = public.p_sf_due((select id from ids where name = 'dated'), 'chargeback_watch'))
             from public.policy_servicing_status where policy_id = (select id from ids where name = 'dated')),
          'protected|chargeback_watch|t', 'c19 protected, a dated deal: next_date is the seed''s due_at');
select is((select concat_ws('|', stage, next_step, next_date = public.p_sf_due((select id from ids where name = 'undated'), 'chargeback_watch'))
             from public.policy_servicing_status where policy_id = (select id from ids where name = 'undated')),
          'protected|chargeback_watch|t', 'c20 protected, an undated deal: next_date is the seed''s due_at');
create temp table watch as
  select policy_id, due_at from public.servicing_tasks
   where policy_id in (select id from ids where name in ('dated', 'undated')) and kind = 'chargeback_watch';
update public.servicing_tasks set status = 'cancelled' where policy_id in (select policy_id from watch) and kind = 'chargeback_watch';
select is((select count(*) from public.policy_servicing_status s join watch w using (policy_id)
            where s.stage = 'protected' and s.next_step = 'chargeback_watch' and s.next_date = w.due_at),
          2::bigint, 'c21 the view''s own watch end, with no task to read, equals both seeds'' due_at');

-- A deal the weekly cap refuses.
update public.app_settings set agent_billing_enforced = true where id = 1;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000f","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sf_many(7), 7, 'c22 agent C uses all 7 of the week''s deals');
select is(public.p_sf_hint($$ select public.p_sf_deal('Eighth') $$), 'weekly_cap', 'c23 the 8th is refused by the cap');
select throws_ok($$ select public.p_sf_deal('Eighth') $$, 'P0001', '7 of 7 used this week, resets Monday', 'c23a in the words agent_products builds');
reset role;
select set_config('request.jwt.claims', '', true);
update public.app_settings set agent_billing_enforced = false where id = 1;
select is((select count(*) from public.servicing_tasks where agent_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000f'), 21::bigint,
          'c24 the cap-blocked deal wrote no tasks: 7 deals, 21 steps');
select is((select count(*) from public.policies where client_last_name = 'Eighth'), 0::bigint, 'c25 and no policy');

-- ── d. Fixtures for list, note and read ─────────────────────────────────────
insert into ids select 'p_a', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000a', 'Case', 'Listed', '5125550111');
insert into ids select 'p_b', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000b', 'Case', 'OfB', '5125550112');
insert into ids select 'p_u', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000c', 'Case', 'OfU', '5125550113');
insert into ids select 'p_d', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000d', 'Case', 'OfD', '5125550114');

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, assigned_rep_id)
values ('eeeeeeee-eeee-4eee-8195-000000000001', 'Lina Biz', 'Lina Lead', '+15125550121', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8195-00000000000a'),
       ('eeeeeeee-eeee-4eee-8195-000000000002', 'Only Biz', null,        '+15125550122', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8195-00000000000a'),
       ('eeeeeeee-eeee-4eee-8195-000000000003', 'Gone Biz', 'Gone Lead', '+15125550123', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8195-00000000000a'),
       ('eeeeeeee-eeee-4eee-8195-000000000004', 'Dee Biz',  'Dee Lead',  '+15125550124', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8195-00000000000d');

-- A's list, in the order it must come back. Two have no date, the older one first.
select public.p_sf_task('t_prog',   'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_a'), null, 'address_change', 'in_progress', now() + interval '1 day', 'agent');
select public.p_sf_task('t_lead',   'aaaaaaaa-aaaa-4aaa-8195-00000000000a', null, 'eeeeeeee-eeee-4eee-8195-000000000001', 'carrier_call', 'scheduled', now() + interval '2 days');
select public.p_sf_task('t_sched',  'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_a'), null, 'packet_check', 'scheduled', now() + interval '3 days');
select public.p_sf_task('t_biz',    'aaaaaaaa-aaaa-4aaa-8195-00000000000a', null, 'eeeeeeee-eeee-4eee-8195-000000000002', 'carrier_call', 'scheduled', now() + interval '4 days');
select public.p_sf_task('t_done',   'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_a'), null, 'review_call', 'done', now() + interval '5 days');
select public.p_sf_task('t_gone',   'aaaaaaaa-aaaa-4aaa-8195-00000000000a', null, 'eeeeeeee-eeee-4eee-8195-000000000003', 'claim_help', 'scheduled', now() + interval '6 days');
select public.p_sf_task('t_cancel', 'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_a'), null, 'beneficiary_change', 'cancelled', now() + interval '7 days', 'agent');
select public.p_sf_task('t_both',   'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_a'), 'eeeeeeee-eeee-4eee-8195-000000000001', 'claim_help', 'scheduled', now() + interval '8 days');
select public.p_sf_task('t_old',    'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_a'), null, 'carrier_call', 'requested', null, 'agent', now() - interval '1 day');
select public.p_sf_task('t_req',    'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_a'), null, 'carrier_call', 'requested', null, 'agent', now() - interval '1 hour');

select public.p_sf_task('t_b', 'aaaaaaaa-aaaa-4aaa-8195-00000000000b', (select id from ids where name = 'p_b'), null, 'carrier_call', 'requested', null, 'agent');
select public.p_sf_task('t_u', 'aaaaaaaa-aaaa-4aaa-8195-00000000000c', (select id from ids where name = 'p_u'), null, 'carrier_call', 'requested', null, 'agent');
select public.p_sf_task('t_d', 'aaaaaaaa-aaaa-4aaa-8195-00000000000d', (select id from ids where name = 'p_d'), null, 'carrier_call', 'requested', null, 'agent', now() - interval '1 hour');
select public.p_sf_task('t_d_lead', 'aaaaaaaa-aaaa-4aaa-8195-00000000000d', null, 'eeeeeeee-eeee-4eee-8195-000000000004', 'carrier_call', 'scheduled', null);

-- The wall both ways. These tasks are in the viewer's own name on a policy in the
-- viewer's own name, so only the wall can stop them: the stamp keeps a policy's side
-- when its agent changes.
insert into ids select 'p_demo_on_a', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000d', 'Case', 'DemoOnA', '5125550115');
update public.policies set agent_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000a' where id = (select id from ids where name = 'p_demo_on_a');
select public.p_sf_task('t_demo_on_a', 'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_demo_on_a'), null, 'carrier_call', 'requested', null, 'agent');
insert into ids select 'p_live_on_d', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000a', 'Case', 'LiveOnD', '5125550116');
update public.policies set agent_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000d' where id = (select id from ids where name = 'p_live_on_d');
select public.p_sf_task('t_live_on_d', 'aaaaaaaa-aaaa-4aaa-8195-00000000000d', (select id from ids where name = 'p_live_on_d'), null, 'carrier_call', 'requested', null, 'agent');
select is((select string_agg(client_last_name || ':' || is_demo, ',' order by client_last_name) from public.policies where client_last_name in ('DemoOnA', 'LiveOnD')),
          'DemoOnA:true,LiveOnD:false', 'd1 the wall fixtures sit on the other side from their agent');

-- A two-policy client, the older policy first.
insert into ids select 'p_two_old', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000a', 'Two', 'Policies', '5125550117', now() - interval '2 days');
insert into ids select 'p_two_new', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000a', 'Two', 'Policies', '(512) 555-0117', now() - interval '1 day');
select public.p_sf_task('t2_nodate', 'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_two_new'), null, 'carrier_call', 'requested', null, 'agent');
select public.p_sf_task('t2_later',  'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_two_new'), null, 'review_call', 'scheduled', now() + interval '20 days');
select public.p_sf_task('t2_soon',   'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_two_new'), null, 'packet_check', 'scheduled', now() + interval '10 days');
select public.p_sf_task('t2_oldest', 'aaaaaaaa-aaaa-4aaa-8195-00000000000a', (select id from ids where name = 'p_two_old'), null, 'annual_review', 'scheduled', now() + interval '30 days');
-- A third client whose policy has no tasks, so the empty lists show.
insert into ids select 'p_bare', public.p_sf_policy('aaaaaaaa-aaaa-4aaa-8195-00000000000a', 'Bare', 'NoTasks', '5125550118');

-- The lead's agent changes. The task stays with A, and RLS now hides the lead.
update public.leads set assigned_rep_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000b' where id = 'eeeeeeee-eeee-4eee-8195-000000000003';

-- ── e. List my items ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sf_list(), 't_prog,t_lead,t_sched,t_biz,t_done,t_gone,t_cancel,t_both,t2_soon,t2_later,t2_oldest,t_old,t_req,t2_nodate',
          'e1 null lists every status, soonest due first, no date last, then oldest first');
select is(public.p_sf_list('requested'), 't_old,t_req,t2_nodate', 'e2 the requested filter');
select is(public.p_sf_list('scheduled'), 't_lead,t_sched,t_biz,t_gone,t_both,t2_soon,t2_later,t2_oldest', 'e3 the scheduled filter');
select is(public.p_sf_list('in_progress'), 't_prog', 'e4 the in_progress filter');
select is(public.p_sf_list('done'), 't_done', 'e5 the done filter');
select is(public.p_sf_list('cancelled'), 't_cancel', 'e6 the cancelled filter');
select throws_ok($$ select * from public.agent_servicing_items('open') $$, '22023', 'Unknown status open', 'e7 a bad status raises 22023');
select throws_ok($$ select * from public.agent_servicing_items('') $$, '22023', 'Unknown status ', 'e8 an empty status is a bad status');
select is((select concat_ws('|', policy_id = (select id from ids where name = 'p_a'), kind, status, requested_by, due_at = now() + interval '1 day', note, client_name)
             from public.agent_servicing_items() where task_id = (select id from ids where name = 't_prog')),
          't|address_change|in_progress|agent|t|Note on t_prog|Case Listed', 'e9 a row carries the task and the policy''s client name');
select is((select lead_id::text || '|' || (policy_id is null) || '|' || client_name
             from public.agent_servicing_items() where task_id = (select id from ids where name = 't_lead')),
          'eeeeeeee-eeee-4eee-8195-000000000001|true|Lina Lead', 'e10 a lead-only task lists, with the lead''s contact name');
select is((select client_name from public.agent_servicing_items() where task_id = (select id from ids where name = 't_biz')), 'Only Biz',
          'e11 a lead with no contact name falls back to the business name');
select is((select count(*) from public.leads where id = 'eeeeeeee-eeee-4eee-8195-000000000003'), 0::bigint, 'e12 RLS hides the reassigned lead from A');
select is((select client_name from public.agent_servicing_items() where task_id = (select id from ids where name = 't_gone')), null,
          'e13 and its task still lists, with a null client name');
select is((select client_name from public.agent_servicing_items() where task_id = (select id from ids where name = 't_both')), 'Case Listed',
          'e14 a task on a policy and a lead takes the policy''s name');
reset role;

-- ── f. Other people's items ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sf_list(), 't_b', 'f1 B lists only B''s own, none of A''s');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_sched'), 'x'),
                 '42501', 'Only this client''s agent can add a note', 'f2 B cannot note A''s task');
select is(public.agent_client_detail('Listed-is-not-a-key'), null, 'f3 a key that is nobody''s reads null');
reset role;
select set_config('request.jwt.claims', '', true);
create temp table keys as select public.p_sf_key('Listed') as listed, public.p_sf_key('OfU') as of_u, public.p_sf_key('Policies') as two,
                                 public.p_sf_key('NoTasks') as bare, public.p_sf_key('OfD') as of_d,
                                 public.p_sf_key('DemoOnA') as demo_on_a, public.p_sf_key('LiveOnD') as live_on_d;
grant select on keys to authenticated;
select is((select count(*) from keys where listed is not null and of_u is not null and two is not null and bare is not null
             and of_d is not null and demo_on_a is not null and live_on_d is not null), 1::bigint, 'f4 the keys the next checks use all exist');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.agent_client_detail((select listed from keys)), null, 'f5 B cannot read A''s client');
reset role;

-- U can read A's rows directly, but these functions are for U's own.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select ok((select count(*) from public.servicing_tasks where agent_id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000a') > 0, 'f6 U can read A''s tasks directly');
select is((select count(*) from public.agent_clients where client_key = (select listed from keys)), 1::bigint, 'f7 and A''s client');
select is(public.p_sf_list(), 't_u', 'f8 but U''s list is only U''s own');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_sched'), 'x'),
                 '42501', 'Only this client''s agent can add a note', 'f9 U cannot note A''s task');
select is(public.agent_client_detail((select listed from keys)), null, 'f10 U reads null for A''s client');
select is(public.agent_client_detail((select of_u from keys)) #>> '{client,client_last_name}', 'OfU', 'f11 and reads U''s own');
select lives_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_u'), 'Mine'), 'f12 and notes U''s own');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8195-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.agent_servicing_items()), 0::bigint, 'f13 Fulfillment has no items of its own to list');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_sched'), 'x'),
                 '42501', 'Only this client''s agent can add a note', 'f14 Fulfillment cannot add a note');
reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8195-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_sched'), 'x'),
                 '42501', 'Only this client''s agent can add a note', 'f15 an admin cannot add a note');
reset role;

-- ── g. Anon ─────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
select throws_ok($$ select * from public.agent_servicing_items() $$, '42501', 'permission denied for function agent_servicing_items', 'g1 anon is refused the list');
select throws_ok($$ select public.add_servicing_note('99999999-9999-4999-8999-999999999999', 'x') $$, '42501', 'permission denied for function add_servicing_note', 'g2 anon is refused a note');
select throws_ok($$ select public.agent_client_detail('x') $$, '42501', 'permission denied for function agent_client_detail', 'g3 anon is refused the read');
select throws_ok($$ select public.agent_submit_deal('A', 'B', '5125550100', 'Austin', 'TX', 'America/Chicago', 'dddddddd-dddd-4ddd-8195-000000000002') $$,
                 '42501', 'permission denied for function agent_submit_deal', 'g4 anon is refused Submit');
select throws_ok($$ select count(*) from public.servicing_task_notes $$, '42501', 'permission denied for table servicing_task_notes', 'g5 anon is refused the notes table');
reset role;

-- ── h. Add a note ───────────────────────────────────────────────────────────
create temp table before_note as
  select (select count(*) from public.policy_events) as events,
         (select note from public.servicing_tasks where id = (select id from ids where name = 't_sched')) as note,
         (select updated_at from public.servicing_tasks where id = (select id from ids where name = 't_sched')) as updated_at;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'note_1', public.add_servicing_note((select id from ids where name = 't_sched'), '  Called the client.  ');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select concat_ws('|', task_id = (select id from ids where name = 't_sched'), author_id, body) from public.servicing_task_notes where id = (select id from ids where name = 'note_1')),
          't|aaaaaaaa-aaaa-4aaa-8195-00000000000a|Called the client.', 'h1 a note adds a row, trimmed, with its author, and returns its id');
select is((select note from public.servicing_tasks where id = (select id from ids where name = 't_sched')), (select note from before_note), 'h2 servicing_tasks.note does not change');
select is((select updated_at from public.servicing_tasks where id = (select id from ids where name = 't_sched')), (select updated_at from before_note), 'h3 nor does updated_at, a day old');
select is((select count(*) from public.policy_events), (select events from before_note), 'h4 and no policy_events row is added');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.add_servicing_note(null, 'x') $$, '22004', 'task is required', 'h5 no task raises 22004');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_sched'), ''), '22023', 'Write the note first', 'h6 an empty note is refused');
select throws_ok(format('select public.add_servicing_note(%L, null)', (select id from ids where name = 't_sched')), '22023', 'Write the note first', 'h7 a null note is refused');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_sched'), E'  \n\t  '), '22023', 'Write the note first', 'h8 a note of only spaces and line breaks is refused');
select lives_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_done'), repeat('x', 1000)), 'h9 exactly 1000 characters is accepted');
select lives_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_cancel'), '   ' || repeat('y', 1000) || '   '), 'h10 1000 after trimming is accepted');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_prog'), repeat('z', 1001)), '22023', 'Keep the note to 1000 characters', 'h11 1001 is refused');
select is((select count(*) from public.servicing_task_notes where task_id = (select id from ids where name = 't_prog')), 0::bigint, 'h12 refused, not cut short: nothing was saved');
select throws_ok($$ select public.add_servicing_note('99999999-9999-4999-8999-999999999999', 'x') $$,
                 '42501', 'Only this client''s agent can add a note', 'h13 a task that doesn''t exist gets the same answer');
select lives_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_lead'), 'On a lead'), 'h14 a lead-only task takes a note');
select throws_ok(format($$ insert into public.servicing_task_notes (task_id, author_id, body) values (%L, 'aaaaaaaa-aaaa-4aaa-8195-00000000000a', 'x') $$, (select id from ids where name = 't_sched')),
                 '42501', 'permission denied for table servicing_task_notes', 'h15 no direct insert on the notes table');
select throws_ok($$ update public.servicing_task_notes set body = 'x' $$, '42501', 'permission denied for table servicing_task_notes', 'h16 no direct update');
select throws_ok($$ delete from public.servicing_task_notes $$, '42501', 'permission denied for table servicing_task_notes', 'h17 no direct delete');
select is((select count(*) from public.servicing_task_notes where id = (select id from ids where name = 'note_1')), 1::bigint, 'h18 A reads their note');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(format($$ insert into public.servicing_task_notes (task_id, body) values (%L, '') $$, (select id from ids where name = 't_sched')), '23514', null, 'h19 the table refuses an empty body');
select throws_ok(format($$ insert into public.servicing_task_notes (task_id, body) values (%L, %L) $$, (select id from ids where name = 't_sched'), repeat('z', 1001)), '23514', null, 'h20 and one over 1000');

-- Who reads the note: the task's rules.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_task_notes where id = (select id from ids where name = 'note_1')), 1::bigint, 'h21 U reads A''s note directly, as U reads A''s task');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_task_notes where id = (select id from ids where name = 'note_1')), 0::bigint, 'h22 B cannot');
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8195-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_task_notes where id = (select id from ids where name = 'note_1')), 1::bigint, 'h23 Fulfillment can');
reset role;

-- An inactive or locked agent is stopped, on their own task.
select set_config('request.jwt.claims', '', true);
update public.profiles set is_active = false where id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000b';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_b'), 'x'),
                 '42501', 'Only this client''s agent can add a note', 'h24 an inactive agent cannot note their own task');
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set is_active = true, signup_source = 'self' where id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000b';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_b'), 'x'),
                 '42501', 'Choose a plan to unlock your portal.', 'h25 a locked self-signup is stopped by the trigger');
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set signup_source = 'invite' where id = 'aaaaaaaa-aaaa-4aaa-8195-00000000000b';

-- ── i. The demo wall, both ways ─────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.agent_servicing_items() where task_id = (select id from ids where name = 't_demo_on_a')), 0::bigint,
          'i1 a non-demo agent does not list a demo policy''s task, even in their name');
select is(public.agent_client_detail((select demo_on_a from keys)), null, 'i2 nor read that client');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_demo_on_a'), 'x'),
                 '42501', 'Only this client''s agent can add a note', 'i3 nor note it');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000d","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_sf_list(), 't_d,t_d_lead', 'i4 the demo agent lists their demo task and their lead-only task, and not the live one');
select is((select count(*) from public.agent_servicing_items() where task_id = (select id from ids where name = 't_live_on_d')), 0::bigint,
          'i5 a demo agent does not list a live policy''s task, even in their name');
select is(public.agent_client_detail((select live_on_d from keys)), null, 'i6 nor read that client');
select throws_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_live_on_d'), 'x'),
                 '42501', 'Only this client''s agent can add a note', 'i7 nor note it');
insert into ids select 'note_d', public.add_servicing_note((select id from ids where name = 't_d'), 'Demo note');
select ok((select id from ids where name = 'note_d') is not null, 'i8 the demo agent notes their own demo task');
select lives_ok(format('select public.add_servicing_note(%L, %L)', (select id from ids where name = 't_d_lead'), 'Demo lead note'), 'i9 and their lead-only task, which the wall doesn''t cover');
select is(public.agent_client_detail((select of_d from keys)) #>> '{policies,0,tasks,0,notes,0,body}', 'Demo note', 'i10 and reads it back');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_task_notes where id = (select id from ids where name = 'note_d')), 0::bigint, 'i11 the demo note is behind the wall for A');
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8195-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_task_notes where id = (select id from ids where name = 'note_d')), 0::bigint, 'i12 and for a non-demo rep, who reads every live note');
reset role;

-- ── j. Read one client ──────────────────────────────────────────────────────
-- Notes written out of order, with their times set by the owner.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'n_second', public.add_servicing_note((select id from ids where name = 't2_soon'), 'Second');
insert into ids select 'n_first', public.add_servicing_note((select id from ids where name = 't2_soon'), 'First');
insert into ids select 'n_old', public.add_servicing_note((select id from ids where name = 't2_oldest'), 'On the older policy');
reset role;
select set_config('request.jwt.claims', '', true);
update public.servicing_task_notes set created_at = now() - interval '1 hour' where id = (select id from ids where name = 'n_second');
update public.servicing_task_notes set created_at = now() - interval '2 hours' where id = (select id from ids where name = 'n_first');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
create temp table two as select public.agent_client_detail((select two from keys)) as d;
select is((select d #>> '{client,client_key}' from two), (select two from keys), 'j1 client is the agent_clients row');
select is((select (d #>> '{client,policy_count}')::int from two), 2, 'j2 with both policies counted');
select is((select jsonb_array_length(d -> 'policies') from two), 2, 'j3 a two-policy client reads back with both policies');
select is((select array[d #>> '{policies,0,policy_id}', d #>> '{policies,1,policy_id}'] from two),
          array[(select id::text from ids where name = 'p_two_new'), (select id::text from ids where name = 'p_two_old')], 'j4 newest first');
select is((select d #>> '{policies,0,stage}' from two), 'setting_up', 'j5 each policy is its policy_servicing_status row');
select is((select jsonb_path_query_array(d, '$.policies[0].tasks[*].id') from two),
          (select jsonb_agg(i.id order by o.ord) from unnest(array['t2_soon', 't2_later', 't2_nodate']) with ordinality o(name, ord) join ids i using (name)),
          'j6 the newer policy''s tasks, soonest due first, no date last');
select is((select jsonb_path_query_array(d, '$.policies[1].tasks[*].id') from two),
          (select jsonb_agg(i.id) from ids i where i.name = 't2_oldest'), 'j7 the older policy has its own task');
select is((select jsonb_path_query_array(d, '$.policies[0].tasks[0].notes[*].body') from two), '["First", "Second"]'::jsonb, 'j8 notes oldest first');
select is((select d #>> '{policies,1,tasks,0,notes,0,body}' from two), 'On the older policy', 'j9 and the older policy''s task has its note');
select is((select d -> 'policies' -> 0 -> 'tasks' -> 2 -> 'notes' from two), '[]'::jsonb, 'j10 a task with no notes has an empty list');
select is(public.agent_client_detail((select bare from keys)) #> '{policies,0,tasks}', '[]'::jsonb, 'j11 a policy with no tasks reads back with an empty list');
select is(public.agent_client_detail(null), null, 'j12 a null key reads null');
select is((select count(*) from public.agent_clients where client_first_name = 'Lina' or client_last_name = 'Lead'), 0::bigint,
          'j13 a lead-only task has no client row: it shows in the list, not in the read');
reset role;

-- ── k. The feed ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8195-00000000000e","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'feed', public.p_sf_deal('FeedDeal');
create temp table feed as
  select * from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', 'aaaaaaaa-aaaa-4aaa-8195-00000000000e', 5000);
select is((select count(*) from feed where (meta ->> 'policy_id')::uuid = (select id from ids where name = 'feed') and title = 'Call updated.'), 1::bigint,
          'k1 a submitted deal shows exactly 1 Call updated row, its existing submitted event');
select is((select string_agg(title, ',' order by title) from feed where (meta ->> 'policy_id')::uuid = (select id from ids where name = 'feed') and title like 'Servicing task added%'),
          'Servicing task added: chargeback watch.,Servicing task added: packet check.,Servicing task added: review call.', 'k2 and exactly 3 Servicing task added rows');
select is((select count(*) from feed where (meta ->> 'policy_id')::uuid = (select id from ids where name = 'feed')), 4::bigint, 'k3 and nothing else');
select lives_ok(format('select public.add_servicing_note(%L, %L)',
                       (select t.id from public.servicing_tasks t where t.policy_id = (select id from ids where name = 'feed') and t.kind = 'packet_check'), 'A note'),
                'k4 S adds a note');
select is((select count(*) from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', 'aaaaaaaa-aaaa-4aaa-8195-00000000000e', 5000)),
          (select count(*) from feed), 'k5 adding a note leaves the feed''s row count unchanged');
reset role;

select * from finish();
rollback;
