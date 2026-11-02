-- p_servicing_steps — pgTAP checks for 212_servicing_steps_on_submit.sql: the shared seed,
-- the settings, the servicing VA who owns the client thread, the duplicate guard, the queue
-- window and the Activity feed.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No robot can
-- run SQL against Ohvara, and none did. Everything runs in one transaction that is rolled
-- back. Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_servicing_steps.sql` replays every migration into an in-memory PGlite and
-- runs this file there. It has no database URL and can't reach Ohvara. A pass there is not a
-- pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agents A, B, C (no upline link), D (the demo side), admin Z. VAs V1, V2, V3 on the
-- live side. VX is inactive and VD is on the demo side; both sort before V1, so a pick that
-- ignored either rule would choose them. Carriers: 01 the one they leave, 02 and 03 new ones.

begin;
create extension if not exists pgtap with schema extensions;
select plan(125);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_steps_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8212-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8212-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8212-00000000000c'::uuid, 'agent_c', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8212-00000000000d'::uuid, 'agent_d', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8212-000000000001'::uuid, 'va_x',    'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8212-000000000002'::uuid, 'va_d',    'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8212-000000000011'::uuid, 'va_1',    'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8212-000000000012'::uuid, 'va_2',    'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8212-000000000013'::uuid, 'va_3',    'fulfillment'),
    ('cccccccc-cccc-4ccc-8212-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8212-000000000001';
update public.profiles set is_active = false where id = 'bbbbbbbb-bbbb-4bbb-8212-000000000001';
update public.profiles set is_demo = true
 where id in ('aaaaaaaa-aaaa-4aaa-8212-00000000000d', 'bbbbbbbb-bbbb-4bbb-8212-000000000002');

insert into public.carriers (id, name, is_active, hours, hours_tz, hours_status, hours_checked_at)
select i.id, i.name, true, h.hours, 'America/Chicago', 'verified', now()
  from (values ('dddddddd-dddd-4ddd-8212-000000000001'::uuid, 'P Steps Leaving Life'),
               ('dddddddd-dddd-4ddd-8212-000000000002'::uuid, 'P Steps New Life'),
               ('dddddddd-dddd-4ddd-8212-000000000003'::uuid, 'P Steps Other Life')) as i(id, name),
       (select jsonb_object_agg(d, jsonb_build_object('open', '00:00', 'close', '23:59')) as hours
          from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d) h;

update public.app_settings set submit_live = true, agent_billing_enforced = false where id = 1;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, anon;

create function public.p_st_i(p_name text) returns uuid language sql as $f$
  select id from ids where name = p_name
$f$;

create function public.p_st_as(p_who uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;

create function public.p_st_owner() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end
$f$;

-- A No deal. The last name is the case's name.
create function public.p_st_no(p_name text, p_number text default null, p_effective date default null,
                               p_best text default 'morning',
                               p_carrier uuid default 'dddddddd-dddd-4ddd-8212-000000000002') returns uuid language sql as $f$
  select public.agent_submit_deal(
    p_first => 'Deal', p_last => p_name, p_phone => '5125550100', p_city => 'Austin', p_state => 'TX',
    p_timezone => 'America/Chicago', p_new_carrier => p_carrier,
    p_policy_number => p_number, p_replaced => false, p_best_time => p_best, p_effective_date => p_effective)
$f$;

-- A slot n half hours after noon tomorrow on the client's clock.
create function public.p_st_slot(p_n integer) returns timestamptz language sql as $f$
  select (date_trunc('day', now() at time zone 'America/Chicago') + interval '1 day 12 hours'
          + make_interval(mins => p_n * 30)) at time zone 'America/Chicago'
$f$;

create function public.p_st_yes(p_name text, p_slot integer) returns uuid language sql as $f$
  select public.agent_submit_deal(
    p_first => 'Yes', p_last => p_name, p_phone => '5125550101', p_city => 'Austin', p_state => 'TX',
    p_timezone => 'America/Chicago', p_new_carrier => 'dddddddd-dddd-4ddd-8212-000000000002',
    p_replaced => true, p_old_carrier => 'dddddddd-dddd-4ddd-8212-000000000001',
    p_at => public.p_st_slot(p_slot), p_best_time => 'evening')
$f$;

-- A policy written directly by the owner, so it seeds nothing and has no owner.
create function public.p_st_policy(p_name text, p_agent uuid default 'aaaaaaaa-aaaa-4aaa-8212-00000000000a',
                                   p_effective date default null, p_sold date default null,
                                   p_created timestamptz default now(), p_best text default null) returns uuid language sql as $f$
  insert into public.policies (agent_id, client_first_name, client_last_name, status, effective_date, policy_sold_date,
                               created_at, best_time, fulfillment_assigned)
  values (p_agent, 'Case', p_name, 'In Effect', p_effective, p_sold, p_created, p_best, false)
  returning id
$f$;

create function public.p_st_lead(p_name text, p_policy uuid default null,
                                 p_agent uuid default 'aaaaaaaa-aaaa-4aaa-8212-00000000000a') returns uuid language sql as $f$
  insert into public.leads (business_name, contact_name, phone, state, lead_type, assigned_rep_id, client_policy_id)
  values (p_name, p_name, '+15125550121', 'TX', 'policy_help', p_agent, p_policy)
  returning id
$f$;

-- What a policy holds, as kind:count.
create function public.p_st_steps(p_policy uuid) returns text language sql as $f$
  select string_agg(s.kind || ':' || s.n, ',' order by s.kind)
    from (select kind, count(*) as n from public.servicing_tasks where policy_id = p_policy group by kind) s
$f$;

create function public.p_st_lead_steps(p_lead uuid) returns text language sql as $f$
  select string_agg(s.kind || ':' || s.n, ',' order by s.kind)
    from (select kind, count(*) as n from public.servicing_tasks where lead_id = p_lead group by kind) s
$f$;

create function public.p_st_noon(p_day date) returns timestamptz language sql as $f$
  select (p_day + time '12:00') at time zone 'UTC'
$f$;

create function public.p_st_due(p_policy uuid, p_kind text, p_month smallint default null) returns timestamptz language sql as $f$
  select due_at from public.servicing_tasks
   where policy_id = p_policy and kind = p_kind and watch_month is not distinct from p_month
$f$;

-- The owner, by the last two digits of the VA's id: 11, 12, 13. null when there is none.
create function public.p_st_va(p_policy uuid) returns text language sql as $f$
  select coalesce(right(servicing_va_id::text, 2), 'null') from public.policies where id = p_policy
$f$;

-- Keeps the hint a call raised, so a check can name it (throws_ok can't).
create function public.p_st_hint(p_sql text) returns text language plpgsql as $f$
declare v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'no hint: ' || sqlerrm);
end
$f$;

-- Runs a call with settings row 1 gone, as p_who if named. The block's exception puts the
-- row and the role back.
create function public.p_st_without_settings(p_sql text, p_who uuid default null) returns text language plpgsql as $f$
begin
  delete from public.app_settings where id = 1;
  if p_who is not null then
    perform public.p_st_as(p_who);
  end if;
  execute p_sql;
  raise exception 'no refusal' using errcode = 'P0003';
exception when others then
  return sqlstate || ':' || sqlerrm;
end
$f$;

grant execute on function public.p_st_i(text), public.p_st_as(uuid), public.p_st_owner(),
  public.p_st_no(text, text, date, text, uuid), public.p_st_slot(integer), public.p_st_yes(text, integer),
  public.p_st_hint(text) to authenticated;

-- ── a. The shape ────────────────────────────────────────────────────────────
select is((select concat_ws('|', servicing_packet_check_days, servicing_review_call_days, servicing_month_check_window_days)
             from public.app_settings where id = 1), '3|10|7', 'a1 the settings default to 3, 10 and 7');
select throws_ok($$ update public.app_settings set servicing_packet_check_days = -1 where id = 1 $$, '23514', null, 'a2 a negative packet setting is refused');
select throws_ok($$ update public.app_settings set servicing_review_call_days = -1 where id = 1 $$, '23514', null, 'a3 a negative review setting is refused');
select throws_ok($$ update public.app_settings set servicing_month_check_window_days = -1 where id = 1 $$, '23514', null, 'a4 a negative window is refused');
select is(to_regclass('public.servicing_tasks_sold_seed_uidx'), null, 'a5 180''s index is gone');
select is((select count(*) from pg_indexes where schemaname = 'public' and tablename = 'servicing_tasks'
            and indexdef like 'CREATE UNIQUE INDEX%COALESCE((watch_month)::integer, 0)%'
            and (indexdef like '%(lead_id, kind, COALESCE%' or indexdef like '%(policy_id, kind, COALESCE%')),
          2::bigint, 'a6 both new indexes use coalesce(watch_month, 0)');
select ok(not has_function_privilege('public', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
          and not has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef,
          format('a7 %s is security definer and closed to every signed-in role', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('servicing_seed_steps', 'servicing_va_pick')
 order by p.proname;
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('agent_submit_deal', 'set_inbound_outcome')),
          2::bigint, 'a8 one agent_submit_deal and one set_inbound_outcome, no overload');
select ok(has_function_privilege('authenticated', 'public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date)', 'execute')
          and not has_function_privilege('anon', 'public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date)', 'execute')
          and has_function_privilege('authenticated', 'public.set_inbound_outcome(uuid, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.set_inbound_outcome(uuid, text, text)', 'execute'),
          'a9 same grants on both');
select ok(obj_description('public.servicing_tasks'::regclass) like '%servicing_seed_steps%', 'a10 the table comment names the seed');
select ok(col_description('public.policies'::regclass,
            (select attnum from pg_attribute where attrelid = 'public.policies'::regclass and attname = 'servicing_va_id')) like '%owns the client thread%',
          'a11 the column comment says this VA owns the client thread');
select throws_ok(format($$ insert into public.servicing_tasks (agent_id, policy_id, kind, watch_month) values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', %L, 'packet_check', 1) $$,
                        public.p_st_policy('WrongKind')), '23514', null, 'a12 watch_month is refused on any other kind');
select throws_ok(format($$ insert into public.servicing_tasks (agent_id, policy_id, kind, watch_month) values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', %L, 'chargeback_watch', 13) $$,
                        public.p_st_policy('Month13')), '23514', null, 'a13 month 13 is refused');

-- ── b. A sale's steps ───────────────────────────────────────────────────────
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
insert into ids select 'jan31', public.p_st_no('Jan31', null, '2027-01-31', 'afternoon');
insert into ids select 'leap', public.p_st_no('Leap', null, '2028-01-31');
insert into ids select 'undated', public.p_st_no('Undated');
insert into ids select 'yes', public.p_st_yes('YesDeal', 0);
select public.p_st_owner();

select is(public.p_st_steps(public.p_st_i('jan31')), 'chargeback_watch:12,packet_check:1,review_call:1', 'b1 a No sale holds 14 steps');
select is(public.p_st_due(public.p_st_i('jan31'), 'packet_check'), '2027-02-03 12:00:00+00'::timestamptz, 'b2 the packet check is anchor + 3 days, noon UTC');
select is(public.p_st_due(public.p_st_i('jan31'), 'review_call'), '2027-02-10 12:00:00+00'::timestamptz, 'b3 the review call is anchor + 10 days, noon UTC');
select is((select string_agg(watch_month::text, ',' order by watch_month) from public.servicing_tasks
            where policy_id = public.p_st_i('jan31') and kind = 'chargeback_watch'),
          '1,2,3,4,5,6,7,8,9,10,11,12', 'b4 exactly 12 chargeback_watch rows, months 1 to 12');
select is((select string_agg(to_char(due_at at time zone 'UTC', 'YYYY-MM-DD HH24'), ',' order by watch_month) from public.servicing_tasks
            where policy_id = public.p_st_i('jan31') and kind = 'chargeback_watch'),
          '2027-02-28 12,2027-03-31 12,2027-04-30 12,2027-05-31 12,2027-06-30 12,2027-07-31 12,2027-08-31 12,2027-09-30 12,2027-10-31 12,2027-11-30 12,2027-12-31 12,2028-01-31 12',
          'b5 a Jan 31 anchor: each month counts from the anchor, so Feb 28 then Mar 31, and month 12 is the anchor + 12 months');
select is(public.p_st_due(public.p_st_i('leap'), 'chargeback_watch', 1::smallint), '2028-02-29 12:00:00+00'::timestamptz, 'b6 in a leap year month 1 is Feb 29');
select is((select count(*) from public.servicing_tasks
            where policy_id = public.p_st_i('jan31') and status = 'scheduled' and requested_by = 'system' and lead_id is null
              and requested_by_id = 'aaaaaaaa-aaaa-4aaa-8212-00000000000a' and agent_id = 'aaaaaaaa-aaaa-4aaa-8212-00000000000a'),
          14::bigint, 'b7 all 14 are scheduled, system, the agent''s, requested_by_id the agent');
select is((select string_agg(distinct kind || ':' || coalesce(best_time, 'null'), ',')
             from public.servicing_tasks where policy_id = public.p_st_i('jan31')),
          'chargeback_watch:null,packet_check:null,review_call:afternoon', 'b8 only the review call carries the deal''s best time');
select is((select concat_ws('|', assigned_fulfillment_id is null, scheduled_call_at is null, replaced_old_policy, fulfillment_assigned)
             from public.policies where id = public.p_st_i('jan31')), 't|t|f|t', 'b9 a No sale has an empty cancellation flow: no rep, no call');
select is(public.p_st_steps(public.p_st_i('yes')), 'chargeback_watch:12,packet_check:1,review_call:1', 'b10 a Yes sale holds the same 14');
select is((select concat_ws('|', assigned_fulfillment_id is not null, scheduled_call_at = public.p_st_slot(0), replaced_old_policy)
             from public.policies where id = public.p_st_i('yes')), 't|t|t', 'b11 and it also has its rep and its call');
select is(public.p_st_due(public.p_st_i('undated'), 'packet_check'), public.p_st_noon((current_date + 3)::date), 'b12 an undated deal counts from the day it was made');

-- The rest of the anchor, through the seed itself.
insert into ids select 'sold_date', public.p_st_policy('SoldDate', 'aaaaaaaa-aaaa-4aaa-8212-00000000000a', null, '2026-03-05');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('sold_date'), null, null, null);
select is(public.p_st_due(public.p_st_i('sold_date'), 'packet_check'), '2026-03-08 12:00:00+00'::timestamptz, 'b13 no effective date: policy_sold_date is the anchor');
insert into ids select 'created', public.p_st_policy('Created', 'aaaaaaaa-aaaa-4aaa-8212-00000000000a', null, null, '2026-02-10 15:00:00+00');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('created'), null, null, null);
select is(public.p_st_due(public.p_st_i('created'), 'review_call'), '2026-02-20 12:00:00+00'::timestamptz, 'b14 neither: created_at is the anchor, and the review call counts from it too');
select is(public.p_st_due(public.p_st_i('created'), 'chargeback_watch', 12::smallint), '2027-02-10 12:00:00+00'::timestamptz, 'b15 month 12 is the anchor + 12 months');
insert into ids select 'best', public.p_st_policy('Best', 'aaaaaaaa-aaaa-4aaa-8212-00000000000a', current_date, null, now(), 'evening');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('best'), null, null, null);
select is((select best_time from public.servicing_tasks where policy_id = public.p_st_i('best') and kind = 'review_call'), 'evening', 'b16 no best time passed: the policy''s is used');
insert into ids select 'best2', public.p_st_policy('Best2', 'aaaaaaaa-aaaa-4aaa-8212-00000000000a', current_date, null, now(), 'evening');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('best2'), null, 'morning', null);
select is((select best_time from public.servicing_tasks where policy_id = public.p_st_i('best2') and kind = 'review_call'), 'morning', 'b17 a passed best time wins');

-- ── c. The settings ─────────────────────────────────────────────────────────
update public.app_settings set servicing_packet_check_days = 5 where id = 1;
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
insert into ids select 'set_packet', public.p_st_no('SetPacket', null, '2027-03-01');
select public.p_st_owner();
select is(public.p_st_due(public.p_st_i('set_packet'), 'packet_check'), '2027-03-06 12:00:00+00'::timestamptz, 'c1 changing the packet setting changes its due date');
select is(public.p_st_due(public.p_st_i('set_packet'), 'review_call'), '2027-03-11 12:00:00+00'::timestamptz, 'c2 and not the review call''s');
update public.app_settings set servicing_packet_check_days = 3, servicing_review_call_days = 20 where id = 1;
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
insert into ids select 'set_review', public.p_st_no('SetReview', null, '2027-03-01');
select public.p_st_owner();
select is(public.p_st_due(public.p_st_i('set_review'), 'review_call'), '2027-03-21 12:00:00+00'::timestamptz, 'c3 changing the review setting changes its due date');
select is(public.p_st_due(public.p_st_i('set_review'), 'packet_check'), '2027-03-04 12:00:00+00'::timestamptz, 'c4 and not the packet check''s');
update public.app_settings set servicing_review_call_days = 10 where id = 1;
select is(public.p_st_without_settings(format('select public.servicing_seed_steps(%L, %L, null, null, null)',
                                              'aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_policy('NoSettings'))),
          'P0002:The servicing settings are missing (app_settings row 1)', 'c5 settings row 1 missing: the seed refuses rather than guessing');
select is((select count(*) from public.servicing_tasks where policy_id = (select id from public.policies where client_last_name = 'NoSettings')), 0::bigint, 'c6 and it wrote nothing');

-- ── d. The owner ────────────────────────────────────────────────────────────
-- Start the counts from nothing. The owner fixtures so far don't matter here.
update public.policies set servicing_va_id = null, servicing_va_assigned_at = null;

select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000b');
insert into ids select 'rr1', public.p_st_no('RR1');
insert into ids select 'rr2', public.p_st_yes('RR2', 1);
insert into ids select 'rr3', public.p_st_no('RR3');
insert into ids select 'rr4', public.p_st_yes('RR4', 2);
insert into ids select 'rr5', public.p_st_no('RR5');
insert into ids select 'rr6', public.p_st_no('RR6');
select public.p_st_owner();

select is(public.p_st_va(public.p_st_i('rr1')) || ',' || public.p_st_va(public.p_st_i('rr2')) || ',' || public.p_st_va(public.p_st_i('rr3')) || ','
          || public.p_st_va(public.p_st_i('rr4')) || ',' || public.p_st_va(public.p_st_i('rr5')) || ',' || public.p_st_va(public.p_st_i('rr6')),
          '11,12,13,11,12,13', 'd1 six submits go round the three VAs in order, No deals in the mix');
select is((select string_agg(right(servicing_va_id::text, 2) || ':' || n, ',' order by servicing_va_id)
             from (select servicing_va_id, count(*) as n from public.policies
                    where servicing_va_id is not null group by servicing_va_id) s),
          '11:2,12:2,13:2', 'd2 2 each, and nobody else holds one: the inactive VA and the demo VA got none');
select is((select count(distinct servicing_va_assigned_at) from public.policies where servicing_va_id is not null), 6::bigint,
          'd3 each has its own assigned time');
select is((select string_agg(client_last_name || ':' || (assigned_fulfillment_id is not null), ',' order by client_last_name) from public.policies where client_last_name like 'RR%'),
          'RR1:false,RR2:true,RR3:false,RR4:true,RR5:false,RR6:false', 'd4 the owner doesn''t touch the call rep: Yes deals have one and No deals have none');
select is((select string_agg(kind, ',' order by kind) from public.policy_events where policy_id = public.p_st_i('rr1')), 'submitted', 'd5 a No deal''s owner writes no event');
select is((select string_agg(kind, ',' order by kind) from public.policy_events where policy_id = public.p_st_i('rr2')), 'booked,submitted', 'd6 nor does a Yes deal''s');
select is((select count(*) from public.notifications where type = 'call_booked' and (data ->> 'policy_id')::uuid in (public.p_st_i('rr2'), public.p_st_i('rr4'))),
          2::bigint, 'd7 each Yes deal tells its rep once');
select is((select count(*) from public.notifications where (data ->> 'policy_id')::uuid in (public.p_st_i('rr1'), public.p_st_i('rr3'), public.p_st_i('rr5'), public.p_st_i('rr6'))),
          0::bigint, 'd8 a No deal''s owner fires no notice');

-- Who counts toward a VA's load. All three hold 2, and V1 is next on a tie, so V2 and V3
-- only come up here if those clients really stopped counting.
update public.policies set status = 'Lapsed' where servicing_va_id = 'bbbbbbbb-bbbb-4bbb-8212-000000000012';
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000b');
insert into ids select 'after_lapse', public.p_st_no('AfterLapse');
select public.p_st_owner();
select is(public.p_st_va(public.p_st_i('after_lapse')), '12', 'd9 lapsed clients stop counting: that VA has the fewest');
update public.policies set archived_at = now() where servicing_va_id = 'bbbbbbbb-bbbb-4bbb-8212-000000000013';
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000b');
insert into ids select 'after_archive', public.p_st_no('AfterArchive');
select public.p_st_owner();
select is(public.p_st_va(public.p_st_i('after_archive')), '13', 'd10 archived clients stop counting');

-- The demo side.
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000d');
insert into ids select 'demo1', public.p_st_no('Demo1');
select public.p_st_owner();
select is((select servicing_va_id from public.policies where id = public.p_st_i('demo1')), 'bbbbbbbb-bbbb-4bbb-8212-000000000002'::uuid, 'd11 a demo agent''s deal goes to the demo VA');
update public.profiles set is_active = false where id = 'bbbbbbbb-bbbb-4bbb-8212-000000000002';
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000d');
insert into ids select 'demo2', public.p_st_no('Demo2');
select public.p_st_owner();
select is(public.p_st_va(public.p_st_i('demo2')), 'null', 'd12 no demo VA active: null, even with live VAs active');
select is(public.p_st_steps(public.p_st_i('demo2')), 'chargeback_watch:12,packet_check:1,review_call:1', 'd13 and the sale still has its steps');

-- No VA at all.
update public.profiles set is_active = false where role = 'fulfillment';
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000b');
select lives_ok($$ insert into ids select 'no_va', public.p_st_no('NoVA') $$, 'd14 with no active VA the submit succeeds');
select public.p_st_owner();
select is((select concat_ws('|', servicing_va_id is null, servicing_va_assigned_at is null) from public.policies where id = public.p_st_i('no_va')), 't|t', 'd15 and the owner stays null');
select is(public.p_st_steps(public.p_st_i('no_va')), 'chargeback_watch:12,packet_check:1,review_call:1', 'd16 with all its steps');
update public.profiles set is_active = true where id in ('bbbbbbbb-bbbb-4bbb-8212-000000000002', 'bbbbbbbb-bbbb-4bbb-8212-000000000011',
                                                         'bbbbbbbb-bbbb-4bbb-8212-000000000012', 'bbbbbbbb-bbbb-4bbb-8212-000000000013');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000b', public.p_st_i('no_va'), null, null, null);
select isnt(public.p_st_va(public.p_st_i('no_va')), 'null', 'd17 a later seed run fills the empty owner');

-- A signed-in person can't write the columns. RLS has no update policy for an agent, so
-- one is added inside this transaction: the guard is what's being checked, not the wall.
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
insert into public.policies (agent_id, client_first_name, client_last_name, servicing_va_id, servicing_va_assigned_at)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', 'Direct', 'Forged', 'bbbbbbbb-bbbb-4bbb-8212-000000000011', now());
select public.p_st_owner();
select is((select concat_ws('|', servicing_va_id is null, servicing_va_assigned_at is null) from public.policies where client_last_name = 'Forged'), 't|t',
          'd18 an agent''s direct insert can''t set the owner');
select public.p_st_as('bbbbbbbb-bbbb-4bbb-8212-000000000011');
insert into public.policies (agent_id, client_first_name, client_last_name, servicing_va_id, servicing_va_assigned_at)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', 'Direct', 'ForgedByVA', 'bbbbbbbb-bbbb-4bbb-8212-000000000011', now());
select public.p_st_owner();
select is((select concat_ws('|', servicing_va_id is null, servicing_va_assigned_at is null) from public.policies where client_last_name = 'ForgedByVA'), 't|t',
          'd19 nor can a VA''s');

create policy p_st_any_update on public.policies for update to authenticated using (true) with check (true);
grant update on public.policies to authenticated;
update public.policies set servicing_va_id = 'bbbbbbbb-bbbb-4bbb-8212-000000000013', servicing_va_assigned_at = '2026-01-01' where client_last_name = 'Forged';
create temp table held as select id, servicing_va_id, servicing_va_assigned_at from public.policies where client_last_name = 'Forged';
grant select on held to authenticated;
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
update public.policies set servicing_va_id = 'bbbbbbbb-bbbb-4bbb-8212-000000000012', servicing_va_assigned_at = now(), client_city = 'Waco' where client_last_name = 'Forged';
select public.p_st_owner();
select is((select concat_ws('|', p.client_city, p.servicing_va_id = h.servicing_va_id, p.servicing_va_assigned_at = h.servicing_va_assigned_at)
             from public.policies p join held h using (id)), 'Waco|t|t', 'd20 an agent''s direct update changes the rest of the row and not the owner');
select public.p_st_as('bbbbbbbb-bbbb-4bbb-8212-000000000012');
update public.policies set servicing_va_id = 'bbbbbbbb-bbbb-4bbb-8212-000000000012', servicing_va_assigned_at = now() where client_last_name = 'Forged';
select public.p_st_owner();
select is((select p.servicing_va_id = h.servicing_va_id from public.policies p join held h using (id)), true, 'd21 nor a VA''s');
drop policy p_st_any_update on public.policies;
revoke update on public.policies from authenticated;

-- ── e. A resubmit ───────────────────────────────────────────────────────────
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
insert into ids select 'retry', public.p_st_no('Retry', 'NEW-77');
select public.p_st_owner();
create temp table retry_before as
  select (select count(*) from public.policies) as policies, (select count(*) from public.policy_events) as events,
         (select count(*) from public.servicing_tasks) as tasks, (select count(*) from public.policy_fulfillment_details) as details,
         (select servicing_va_id from public.policies where id = public.p_st_i('retry')) as owner,
         (select updated_at from public.policies where id = public.p_st_i('retry')) as updated_at;
grant select on retry_before to authenticated;

select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select is(public.p_st_no('Retry', 'NEW-77'), public.p_st_i('retry'), 'e1 the same policy number returns the same policy');
select is(public.p_st_no('Retry', '  new-77 '), public.p_st_i('retry'), 'e2 ignoring case and outer spaces');
select public.p_st_owner();
select is((select count(*) from public.policies), (select policies from retry_before), 'e3 and adds no policy');
select is((select count(*) from public.policy_events), (select events from retry_before), 'e4 no event');
select is((select count(*) from public.servicing_tasks), (select tasks from retry_before), 'e5 no steps');
select is((select count(*) from public.policy_fulfillment_details), (select details from retry_before), 'e6 and no intake row');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('retry'), null, null, null);
select is((select count(*) from public.servicing_tasks), (select tasks from retry_before), 'e7 a direct seed re-run adds no rows');
select is((select servicing_va_id from public.policies where id = public.p_st_i('retry')), (select owner from retry_before), 'e8 and keeps the owner');

select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select isnt(public.p_st_no('Retry', 'NEW-77', null, 'morning', 'dddddddd-dddd-4ddd-8212-000000000003'), public.p_st_i('retry'), 'e9 another new carrier is another policy');
select public.p_st_owner();
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000b');
select isnt(public.p_st_no('Retry', 'NEW-77'), public.p_st_i('retry'), 'e10 another agent is another policy');
select public.p_st_owner();
insert into ids select 'archived', public.p_st_policy('Archived');
update public.policies set policy_number = 'ARCH-1', new_carrier_id = 'dddddddd-dddd-4ddd-8212-000000000002', archived_at = now() where id = public.p_st_i('archived');
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select isnt(public.p_st_no('Archived', 'ARCH-1'), public.p_st_i('archived'), 'e11 an archived policy doesn''t count');
select public.p_st_owner();

select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select isnt(public.p_st_no('Blank', '   '), public.p_st_no('Blank', '   '), 'e12 two submits with a blank policy number make two policies');
select isnt(public.p_st_no('Null'), public.p_st_no('Null'), 'e13 and two with none do too');
select public.p_st_owner();

-- At the cap. Agent C, Standard, is 7 a week.
update public.app_settings set agent_billing_enforced = true where id = 1;
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000c');
insert into ids select 'at_cap', public.p_st_no('AtCap', 'CAP-1');
select public.p_st_no('Fill ' || n) from generate_series(1, 6) n;
select is((select used from public.agent_weekly_usage()), 7, 'e14 agent C is at the cap');
select is(public.p_st_no('AtCap', 'CAP-1'), public.p_st_i('at_cap'), 'e15 a resubmit at the cap returns the existing policy');
select is(public.p_st_hint($$ select public.p_st_no('Over', 'CAP-2') $$), 'weekly_cap', 'e16 a new policy number at the cap is refused');
select is(public.p_st_hint($$ select public.p_st_no('Over') $$), 'weekly_cap', 'e17 so is a blank one');
select is((select used from public.agent_weekly_usage()), 7, 'e18 still 7');
select public.p_st_owner();
update public.app_settings set agent_billing_enforced = false, submit_live = false where id = 1;
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000c');
select is(public.p_st_hint($$ select public.p_st_no('AtCap', 'CAP-1') $$), 'not_live', 'e19 submit_live off still refuses first, a resubmit too');
select public.p_st_owner();
update public.app_settings set submit_live = true where id = 1;

-- ── f. Sold ─────────────────────────────────────────────────────────────────
insert into ids select 'sold_lead', public.p_st_lead('SoldNoPolicy');
insert into ids select 'sold_policy', public.p_st_policy('SoldPolicy', 'aaaaaaaa-aaaa-4aaa-8212-00000000000a', '2026-06-15');
insert into ids select 'sold_lead_p', public.p_st_lead('SoldWithPolicy', public.p_st_i('sold_policy'));
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select is(public.set_inbound_outcome(public.p_st_i('sold_lead'), 'sold'), 'sold', 'f1 Sold on a lead with no policy');
select is(public.set_inbound_outcome(public.p_st_i('sold_lead_p'), 'sold'), 'sold', 'f2 Sold on a lead with a policy');
select public.p_st_owner();

select is(public.p_st_lead_steps(public.p_st_i('sold_lead')), 'chargeback_watch:12,packet_check:1,review_call:1', 'f3 with no policy: 14 rows, 12 watch and not 1');
select is((select count(*) from public.servicing_tasks where lead_id = public.p_st_i('sold_lead') and policy_id is null and requested_by = 'system'
              and requested_by_id = 'aaaaaaaa-aaaa-4aaa-8212-00000000000a'), 14::bigint, 'f4 on the lead, system, the caller as requested_by_id');
select is((select due_at from public.servicing_tasks where lead_id = public.p_st_i('sold_lead') and kind = 'packet_check'), public.p_st_noon((current_date + 3)::date),
          'f5 no policy counts from today, the same settings');
select is(public.p_st_steps(public.p_st_i('sold_policy')), 'chargeback_watch:12,packet_check:1,review_call:1', 'f6 with a policy: the same 14');
select is((select count(*) from public.servicing_tasks where lead_id = public.p_st_i('sold_lead_p') and policy_id = public.p_st_i('sold_policy')), 14::bigint, 'f7 on both the lead and the policy');
select is(public.p_st_due(public.p_st_i('sold_policy'), 'packet_check'), '2026-06-18 12:00:00+00'::timestamptz, 'f8 counted from the policy''s anchor');
select is(public.p_st_due(public.p_st_i('sold_policy'), 'chargeback_watch', 12::smallint), '2027-06-15 12:00:00+00'::timestamptz, 'f9 month 12 from the same anchor');

create temp table sold_owner as
  select servicing_va_id, servicing_va_assigned_at from public.policies where id = public.p_st_i('sold_policy');
grant select on sold_owner to authenticated;
select isnt((select servicing_va_id from sold_owner), null, 'f10 a Sold lead''s policy with no owner gets one');
select is((select count(*) from public.policy_events where policy_id = public.p_st_i('sold_policy')), 0::bigint, 'f11 with no event');
select is((select count(*) from public.notifications where (data ->> 'policy_id')::uuid = public.p_st_i('sold_policy')), 0::bigint, 'f12 and no notice');

select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select is(public.set_inbound_outcome(public.p_st_i('sold_lead'), 'sold'), 'sold', 'f13 Sold pressed again');
select is(public.set_inbound_outcome(public.p_st_i('sold_lead_p'), 'sold'), 'sold', 'f14 and again');
select public.p_st_owner();
select is(public.p_st_lead_steps(public.p_st_i('sold_lead')), 'chargeback_watch:12,packet_check:1,review_call:1', 'f15 pressing Sold twice adds none, packet and review included');
select is(public.p_st_steps(public.p_st_i('sold_policy')), 'chargeback_watch:12,packet_check:1,review_call:1', 'f16 and none on the policy');
select is((select concat_ws('|', p.servicing_va_id = o.servicing_va_id, p.servicing_va_assigned_at = o.servicing_va_assigned_at)
             from public.policies p, sold_owner o where p.id = public.p_st_i('sold_policy')), 't|t', 'f17 a re-run keeps the same owner and time');

-- A second lead on the same policy, and a Sold on a deal that was submitted.
insert into ids select 'sold_lead_2', public.p_st_lead('SoldSecond', public.p_st_i('sold_policy'));
insert into ids select 'sold_lead_deal', public.p_st_lead('SoldDeal', public.p_st_i('jan31'));
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select public.set_inbound_outcome(public.p_st_i('sold_lead_2'), 'sold');
select public.set_inbound_outcome(public.p_st_i('sold_lead_deal'), 'sold');
select public.p_st_owner();
select is(public.p_st_steps(public.p_st_i('sold_policy')), 'chargeback_watch:12,packet_check:1,review_call:1', 'f18 a second sold lead on one policy adds none');
select is(public.p_st_steps(public.p_st_i('jan31')), 'chargeback_watch:12,packet_check:1,review_call:1', 'f19 nor does a Sold on a submitted deal');

-- A lead with no policy changed nobody's owner.
select is((select count(*) from public.servicing_tasks where lead_id = public.p_st_i('sold_lead') and policy_id is not null), 0::bigint, 'f20 a lead with no policy has no policy, so no owner');

-- No active VA on Sold.
update public.profiles set is_active = false where role = 'fulfillment';
insert into ids select 'sold_no_va_p', public.p_st_policy('SoldNoVA');
insert into ids select 'sold_no_va', public.p_st_lead('SoldNoVALead', public.p_st_i('sold_no_va_p'));
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select is(public.set_inbound_outcome(public.p_st_i('sold_no_va'), 'sold'), 'sold', 'f21 Sold succeeds with no active VA');
select public.p_st_owner();
select is(public.p_st_va(public.p_st_i('sold_no_va_p')), 'null', 'f22 and the owner stays null');
update public.profiles set is_active = true where id in ('bbbbbbbb-bbbb-4bbb-8212-000000000002', 'bbbbbbbb-bbbb-4bbb-8212-000000000011',
                                                         'bbbbbbbb-bbbb-4bbb-8212-000000000012', 'bbbbbbbb-bbbb-4bbb-8212-000000000013');

-- A Yes booking with a rep and no owner yet: the owner update moves nothing.
update public.policies set servicing_va_id = null, servicing_va_assigned_at = null where id = public.p_st_i('rr2');
create temp table rr2_before as
  select p.assigned_fulfillment_id, p.scheduled_call_at,
         (select count(*) from public.policy_events e where e.policy_id = p.id) as events,
         (select count(*) from public.notifications n where (n.data ->> 'policy_id')::uuid = p.id) as notices
    from public.policies p where p.id = public.p_st_i('rr2');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000b', public.p_st_i('rr2'), null, null, null);
select isnt(public.p_st_va(public.p_st_i('rr2')), 'null', 'f23 a Yes booking with a rep gets its owner');
select is((select concat_ws('|', p.assigned_fulfillment_id = b.assigned_fulfillment_id, p.scheduled_call_at = b.scheduled_call_at,
                            (select count(*) from public.policy_events e where e.policy_id = p.id) = b.events,
                            (select count(*) from public.notifications n where (n.data ->> 'policy_id')::uuid = p.id) = b.notices)
             from public.policies p, rr2_before b where p.id = public.p_st_i('rr2')),
          't|t|t|t', 'f24 same rep, same call, no event and no notice');

-- The one case that does move a rep, in the migration's header. fulfillment_autoassign gives
-- a rep to any open booking with none on every update of that row, as the sweep would.
update public.profiles set is_active = false where role = 'fulfillment';
insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned, fulfillment_stage, scheduled_call_at, client_timezone)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', 'No', 'RepYet', true, 'Pending', public.p_st_slot(9), 'America/Chicago');
update public.profiles set is_active = true where id = 'bbbbbbbb-bbbb-4bbb-8212-000000000011';
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', (select id from public.policies where client_last_name = 'RepYet'), null, null, null);
select is((select concat_ws('|', assigned_fulfillment_id, servicing_va_id) from public.policies where client_last_name = 'RepYet'),
          'bbbbbbbb-bbbb-4bbb-8212-000000000011|bbbbbbbb-bbbb-4bbb-8212-000000000011', 'f25 an open booking with no rep gets one from the update, as the sweep gives it');
update public.profiles set is_active = true where id in ('bbbbbbbb-bbbb-4bbb-8212-000000000012', 'bbbbbbbb-bbbb-4bbb-8212-000000000013');

-- ── g. Old rows ─────────────────────────────────────────────────────────────
insert into ids select 'old_lead', public.p_st_lead('OldLead');
insert into public.servicing_tasks (agent_id, lead_id, kind, status, due_at, requested_by)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_lead'), 'chargeback_watch', 'scheduled', now() + interval '200 days', 'system');
insert into ids select 'old_policy', public.p_st_policy('OldPolicy');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_policy'), 'chargeback_watch', 'scheduled', now() + interval '200 days', 'system');
insert into ids select 'old_done', public.p_st_policy('OldDone');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_done'), 'chargeback_watch', 'done', 'system');

select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select public.set_inbound_outcome(public.p_st_i('old_lead'), 'sold');
select public.set_inbound_outcome(public.p_st_i('old_lead'), 'sold');
select public.p_st_owner();
select is(public.p_st_lead_steps(public.p_st_i('old_lead')), 'chargeback_watch:1,packet_check:1,review_call:1', 'g1 an old lead pressed Sold: the watch count stays 1, not 13');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_policy'), null, null, null);
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_policy'), null, null, null);
select is(public.p_st_steps(public.p_st_i('old_policy')), 'chargeback_watch:1,packet_check:1,review_call:1', 'g2 an old policy seeded again: the watch count stays 1');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_done'), null, null, null);
select is(public.p_st_steps(public.p_st_i('old_done')), 'chargeback_watch:1,packet_check:1,review_call:1', 'g3 a watch already done counts as old too');
-- An agent-opened row isn't the seed's: it neither blocks the watch nor is touched.
insert into ids select 'old_agent', public.p_st_policy('OldAgent');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_agent'), 'chargeback_watch', 'requested', 'agent');
select public.servicing_seed_steps('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('old_agent'), null, null, null);
select is(public.p_st_steps(public.p_st_i('old_agent')), 'chargeback_watch:13,packet_check:1,review_call:1', 'g4 only a system watch stops the months');

-- ── h. The queue ────────────────────────────────────────────────────────────
-- Month 1 is overdue, month 2 is about 3 days ahead, month 3 is about 33.
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
insert into ids select 'queue', public.p_st_no('Queue', null, ((current_date - interval '2 months')::date + 3)::date);
select public.p_st_owner();
insert into ids select 'q_' || watch_month, id from public.servicing_tasks where policy_id = public.p_st_i('queue') and kind = 'chargeback_watch';
insert into ids select 'q_packet', id from public.servicing_tasks where policy_id = public.p_st_i('queue') and kind = 'packet_check';
insert into ids select 'q_old', id from public.servicing_tasks where policy_id = public.p_st_i('old_policy') and kind = 'chargeback_watch';

create function public.p_st_queue_months() returns text language sql as $f$
  select coalesce(string_agg(t.m::text, ',' order by t.m), 'none')
    from public.va_servicing_queue() q
    join (select i.id, substr(i.name, 3)::int as m from ids i where i.name ~ '^q_[0-9]+$') t on t.id = q.task_id
$f$;
grant execute on function public.p_st_queue_months() to authenticated;

select public.p_st_as('bbbbbbbb-bbbb-4bbb-8212-000000000011');
select is(public.p_st_queue_months(), '1,2', 'h1 the queue shows the overdue month and the one inside the window, no later month');
select is((select count(*) from public.va_servicing_queue() q where q.task_id = public.p_st_i('q_packet')), 1::bigint, 'h2 other steps are as they were');
select is((select count(*) from public.va_servicing_queue() q where q.task_id = public.p_st_i('q_old')), 1::bigint, 'h3 an old unnumbered row 200 days out stays listed');
select throws_ok(format('select public.va_servicing_claim(%L)', public.p_st_i('q_5')), '22023', 'This step is not in the queue', 'h4 a future month can''t be claimed');
select lives_ok(format('select public.va_servicing_claim(%L)', public.p_st_i('q_2')), 'h5 a month inside the window can');
select public.p_st_owner();
select is((select status from public.servicing_tasks where id = public.p_st_i('q_5')), 'scheduled', 'h6 the refused month is untouched');

update public.app_settings set servicing_month_check_window_days = 40 where id = 1;
select public.p_st_as('bbbbbbbb-bbbb-4bbb-8212-000000000011');
select is(public.p_st_queue_months(), '1,2,3', 'h7 a wider window shows the next month');
select lives_ok(format('select public.va_servicing_claim(%L)', public.p_st_i('q_3')), 'h8 and it can be claimed');
select public.p_st_owner();

update public.app_settings set servicing_month_check_window_days = 0 where id = 1;
select public.p_st_as('bbbbbbbb-bbbb-4bbb-8212-000000000012');
select throws_ok(format('select public.va_servicing_claim(%L)', public.p_st_i('q_4')), '22023', 'This step is not in the queue', 'h9 a window of 0 refuses a month still ahead');
select public.p_st_owner();
select public.p_st_as('bbbbbbbb-bbbb-4bbb-8212-000000000011');
select is(public.p_st_queue_months(), '1,2,3', 'h10 and an overdue month or one in progress stays, however narrow the window');
select public.p_st_owner();
update public.app_settings set servicing_month_check_window_days = 7 where id = 1;

select is(public.p_st_without_settings('select * from public.va_servicing_queue()'), '42501:Only Fulfillment can see the servicing queue', 'h11 the queue checks the role first');
select is(public.p_st_without_settings('select * from public.va_servicing_queue()', 'bbbbbbbb-bbbb-4bbb-8212-000000000011'),
          'P0002:The servicing settings are missing (app_settings row 1)', 'h12 settings row 1 missing: the queue refuses rather than guessing');
select is(public.p_st_without_settings(format('select public.va_servicing_claim(%L)', public.p_st_i('q_1')), 'bbbbbbbb-bbbb-4bbb-8212-000000000011'),
          'P0002:The servicing settings are missing (app_settings row 1)', 'h13 and so does the claim');

-- ── i. The Activity feed ────────────────────────────────────────────────────
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
insert into ids select 'feed', public.p_st_no('FeedDeal');
create temp table feed as
  select * from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', 'aaaaaaaa-aaaa-4aaa-8212-00000000000a', 5000);
select is((select string_agg(title, ',' order by title) from feed
            where id like 'servicing_added:%' and (meta ->> 'policy_id')::uuid = public.p_st_i('feed')),
          'Servicing task added: chargeback watch.,Servicing task added: packet check.,Servicing task added: review call.',
          'i1 the feed gives 3 servicing_added rows per deal, not 14');
select is((select count(*) from feed where id like 'servicing_added:%' and lead_id = public.p_st_i('sold_lead')), 3::bigint, 'i2 and 3 for a Sold lead');
select public.p_st_owner();
update public.servicing_tasks set status = 'done' where policy_id = public.p_st_i('feed') and watch_month = 5;
select public.p_st_as('aaaaaaaa-aaaa-4aaa-8212-00000000000a');
select is((select count(*) from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', 'aaaaaaaa-aaaa-4aaa-8212-00000000000a', 5000) f
            where f.id like 'servicing_done:%' and (f.meta ->> 'policy_id')::uuid = public.p_st_i('feed')), 1::bigint,
          'i3 the done branch is unchanged: any month done shows');
select public.p_st_owner();

-- ── j. The preflight ────────────────────────────────────────────────────────
-- 212's first statement can't run here, because 212 is already in. This is its duplicate
-- count and its raise, copied whole. The real file was run against duplicate rows on a
-- database replayed to 211 when it was written (see the hand-off note). The new index is
-- dropped first or the duplicate can't exist, and the monthly rows are cleared because the
-- count is meant for the rows from before this migration. All of it rolls back.
drop index public.servicing_tasks_seed_policy_uidx;
delete from public.servicing_tasks;
insert into ids select 'dup', public.p_st_policy('Dup');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('dup'), 'packet_check', 'scheduled', 'system');

create function public.p_st_preflight() returns void language plpgsql as $f$
declare
  v_dupes bigint;
begin
  select count(*) into v_dupes
    from (
      select 1 from public.servicing_tasks
       where policy_id is not null and requested_by = 'system'
         and kind in ('packet_check', 'review_call', 'chargeback_watch')
       group by policy_id, kind having count(*) > 1
    ) d;
  if v_dupes > 0 then
    raise exception '212 stopped: system steps already repeat on % policy and kind pairs. Nothing was changed and no row was deleted.', v_dupes;
  end if;
end
$f$;

select lives_ok('select public.p_st_preflight()', 'j1 one row per policy and kind passes the preflight');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('dup'), 'packet_check', 'scheduled', 'system');
select throws_ok('select public.p_st_preflight()', 'P0001',
                 '212 stopped: system steps already repeat on 1 policy and kind pairs. Nothing was changed and no row was deleted.',
                 'j2 duplicate policy rows stop the file and name the count');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by)
values ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('dup'), 'carrier_call', 'requested', 'agent'),
       ('aaaaaaaa-aaaa-4aaa-8212-00000000000a', public.p_st_i('dup'), 'carrier_call', 'requested', 'agent');
select throws_ok('select public.p_st_preflight()', 'P0001',
                 '212 stopped: system steps already repeat on 1 policy and kind pairs. Nothing was changed and no row was deleted.',
                 'j3 requests repeating on a policy don''t count');

select * from finish();
rollback;
