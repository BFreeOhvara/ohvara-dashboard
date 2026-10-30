-- p_submit_servicing — pgTAP checks for 187_submit_servicing.sql: Submit a deal,
-- the has_servicing flag, No deals staying away from reps, no weekly cap (188), and
-- service requests.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_submit_servicing.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Case (b) differs from how it was first asked for: 188 made the weekly cap a
-- no-op, so b checks that nothing refuses at the old 7 and 16, for the RPCs and
-- the direct insert alike, comped or not.
--
-- Cast: agent A (Standard, 7), agent B (A's competitor for (d)), agent C
-- (has_servicing off), agent D (comped, Premium), agent E (comped, Standard),
-- agent F (a tier with no cap), rep R, admin Z. Carriers: 01 the one they leave
-- (open all week), 02 the new one.

begin;
create extension if not exists pgtap with schema extensions;
select plan(81);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_submit_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000c'::uuid, 'agent_c', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000d'::uuid, 'agent_d', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000e'::uuid, 'agent_e', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000f'::uuid, 'agent_f', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid, 'rep_r',   'fulfillment'),
    ('cccccccc-cccc-4ccc-8ccc-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8ccc-000000000001';
update public.profiles set has_servicing = false where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000c';
insert into public.agent_billing_tiers (key, name, weekly_cents, weekly_cap) values ('p_submit_open', 'No cap', 100, null);
update public.profiles set billing_exempt = true, billing_tier = 'premium' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000d';
update public.profiles set billing_exempt = true, billing_tier = 'standard' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000e';
update public.profiles set billing_tier = 'p_submit_open' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000f';

insert into public.carriers (id, name, is_active, hours, hours_tz, hours_status, hours_checked_at)
select i.id, i.name, true, h.hours, 'America/Chicago', 'verified', now()
  from (values ('dddddddd-dddd-4ddd-8ddd-000000000001'::uuid, 'P Submit Leaving Life'),
               ('dddddddd-dddd-4ddd-8ddd-000000000002'::uuid, 'P Submit New Life')) as i(id, name),
       (select jsonb_object_agg(d, jsonb_build_object('open', '00:00', 'close', '23:59')) as hours
          from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d) h;

update public.app_settings set submit_live = true, agent_billing_enforced = false where id = 1;

-- Keeps the hint a call raised, so a check can name it (throws_ok can't).
create function public.p_submit_hint(p_sql text) returns text language plpgsql as $f$
declare v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'no hint: ' || sqlerrm);
end
$f$;

create function public.p_submit_no(p_who text) returns uuid language sql as $f$
  select public.agent_submit_deal(
    p_first => 'No', p_last => p_who, p_phone => '5125550100', p_city => 'Austin', p_state => 'TX',
    p_timezone => 'America/Chicago', p_new_carrier => 'dddddddd-dddd-4ddd-8ddd-000000000002',
    p_policy_number => 'NEW-1', p_replaced => false, p_best_time => 'morning', p_sms_consent => true)
$f$;

-- A slot n half hours after noon tomorrow on the client's clock.
create function public.p_submit_slot(p_n integer) returns timestamptz language sql as $f$
  select (date_trunc('day', now() at time zone 'America/Chicago') + interval '1 day 12 hours'
          + make_interval(mins => p_n * 30)) at time zone 'America/Chicago'
$f$;

create function public.p_submit_yes(p_who text, p_at timestamptz) returns uuid language sql as $f$
  select public.agent_submit_deal(
    p_first => 'Yes', p_last => p_who, p_phone => '5125550101', p_city => 'Austin', p_state => 'TX',
    p_timezone => 'America/Chicago', p_new_carrier => 'dddddddd-dddd-4ddd-8ddd-000000000002',
    p_replaced => true, p_old_carrier => 'dddddddd-dddd-4ddd-8ddd-000000000001', p_at => p_at, p_best_time => 'evening')
$f$;

-- n No deals in a row, stopping at the first refusal: returns how many went in.
create function public.p_submit_many(p_n integer) returns integer language plpgsql as $f$
declare i integer := 0;
begin
  while i < p_n loop
    perform public.p_submit_no('Bulk ' || i);
    i := i + 1;
  end loop;
  return i;
end
$f$;

grant execute on function public.p_submit_hint(text), public.p_submit_no(text), public.p_submit_slot(integer),
  public.p_submit_yes(text, timestamptz), public.p_submit_many(integer) to authenticated;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

-- ── the shape: both RPCs and the table ──────────────────────────────────────
select ok(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
          and not has_function_privilege('anon', p.oid, 'execute')
          and has_function_privilege('authenticated', p.oid, 'execute'),
          format('s1 %s is security definer, search_path public, closed to anon', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('agent_submit_deal', 'agent_submit_service_request')
 order by p.proname;
select ok((select relrowsecurity from pg_class where oid = 'public.service_requests'::regclass),
          's2 service_requests has RLS on');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'service_requests' and cmd = 'INSERT'),
          0::bigint, 's3 service_requests has no insert policy');
select is((select count(*) from pg_attribute where attrelid = 'public.policies'::regclass and attname = 'policy_number' and not attisdropped),
          1::bigint, 's4 policy_number is the one column from 072');
select is((select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'policies' and column_name = 'policy_number'),
          'YES', 's5 policy_number stays optional');

-- ── flag and switch: admin only ─────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ update public.profiles set has_servicing = false where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000a' $$,
                 '42501', 'Only an admin can change that part of a profile', 's6 an agent cannot change their own has_servicing');
update public.app_settings set submit_live = false where id = 1;
select is((select has_servicing from public.get_my_profile()), true, 's7 an agent reads has_servicing through get_my_profile');
reset role;
select is((select submit_live from public.app_settings where id = 1), true, 's8 an agent''s update of submit_live changes nothing');

select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ update public.profiles set has_servicing = false where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000b' $$,
                's9 an admin can change has_servicing');
update public.app_settings set submit_live = false where id = 1;
reset role;
select is((select has_servicing from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000b'), false, 's10 the admin''s change saved');
select is((select submit_live from public.app_settings where id = 1), false, 's11 an admin can change submit_live');
select is((select count(*) from public.admin_audit_log where target_table = 'profiles'
            and target_id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000b' and new_values ->> 'has_servicing' = 'false'),
          1::bigint, 's12 the has_servicing change is on the audit log');
update public.profiles set has_servicing = true where id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000b';
update public.app_settings set submit_live = true where id = 1;

-- ── a. A No deal never reaches a rep ────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select used from public.agent_weekly_usage()), 0, 'a0 agent A starts the week at 0');
insert into ids select 'no', public.p_submit_no('Deal');
select is((select used from public.agent_weekly_usage()), 1, 'a1 a No deal counts 1 on agent_weekly_usage');
reset role;

select is((select assigned_fulfillment_id from public.policies where id = (select id from ids where name = 'no')), null::uuid,
          'a2 no rep after the insert, with an active rep available');
select is(
  (select concat_ws('|', status, fulfillment_assigned, fulfillment_stage, replaced_old_policy, best_time, policy_number,
                    new_carrier_id, new_carrier_name, client_city, state, client_timezone, sms_consent)
     from public.policies where id = (select id from ids where name = 'no')),
  'Submitted|t|Pending|f|morning|NEW-1|dddddddd-dddd-4ddd-8ddd-000000000002|P Submit New Life|Austin|TX|America/Chicago|t',
  'a3 the deal row is what was submitted');
select is((select scheduled_call_at is null and carrier_id is null and carrier_name is null
             from public.policies where id = (select id from ids where name = 'no')),
          true, 'a4 no call time and no leaving carrier');
select is((select full_legal_name || ':' || (current_carrier is null) from public.policy_fulfillment_details
            where policy_id = (select id from ids where name = 'no')),
          'No Deal:true', 'a5 the intake row exists, with no current_carrier');
select is((select string_agg(kind || ':' || (detail ->> 'label'), ',') from public.policy_events
            where policy_id = (select id from ids where name = 'no')),
          'submitted:Submitted for servicing', 'a6 one event, Submitted for servicing, and no "booked"');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.fulfillment_assign_unassigned(), 0, 'a7 the sweep picks up nothing');
reset role;
select is((select assigned_fulfillment_id from public.policies where id = (select id from ids where name = 'no')), null::uuid,
          'a8 no rep after the sweep');
select is((select count(*) from public.notifications
            where type in ('fulfillment_assigned', 'call_booked')
              and (data ->> 'policy_id') = (select id::text from ids where name = 'no')),
          0::bigint, 'a9 no fulfillment_assigned or call_booked notification');

select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_hint(format('select public.admin_give_call(%L, %L)', (select id from ids where name = 'no'), 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001')),
          'no_old_policy', 'a10 an admin cannot give a No deal to a rep');
select is(public.p_submit_hint(format('select public.fulfillment_pass_on(%L)', (select id from ids where name = 'no'))),
          'no_old_policy', 'a11 an admin cannot pass a No deal on to a rep');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_hint(format('select public.agent_set_booking_carrier(%L, %L)', (select id from ids where name = 'no'), 'dddddddd-dddd-4ddd-8ddd-000000000001')),
          'no_old_policy', 'a12 the agent cannot add a leaving carrier to a No deal');
select is(public.p_submit_hint($$ insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned, replaced_old_policy)
                                  values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000a', 'Direct', 'No', true, false) $$),
          'booking_rule', 'a13 a direct insert cannot claim to be a No deal to skip the time');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select current_carrier from public.policy_fulfillment_details where policy_id = (select id from ids where name = 'no')), null,
          'a14 current_carrier is still null after those');
update public.policies set fulfillment_stage = 'Complete' where id = (select id from ids where name = 'no');
select is((select count(*) from public.fulfillment_cancels where policy_id = (select id from ids where name = 'no')),
          0::bigint, 'a15 with no rep, Complete creates no pay row');
update public.policies set fulfillment_stage = 'Pending' where id = (select id from ids where name = 'no');

-- The sweep still does its job for a row that isn't a No deal.
update public.profiles set is_active = false where role = 'fulfillment';
insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned, fulfillment_stage)
values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000b', 'Old', 'Style', true, 'Pending');
update public.profiles set is_active = true where id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
select is((select assigned_fulfillment_id from public.policies where client_last_name = 'Style'), null::uuid,
          'a16 an old-style row sits unassigned while no rep is active');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.fulfillment_assign_unassigned(), 1, 'a17 the sweep takes the old-style row and only that one');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select assigned_fulfillment_id from public.policies where client_last_name = 'Style'),
          'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid, 'a18 the old-style row got the rep');
select is((select assigned_fulfillment_id from public.policies where id = (select id from ids where name = 'no')), null::uuid,
          'a19 the No deal still has none');

-- ── b. No weekly cap (188) ──────────────────────────────────────────────────
-- 188 made enforce_weekly_submission_cap a no-op, and agent_submit_deal has no
-- check of its own. Agent A has 1 this week and is on Standard (7). With
-- agent_billing_enforced on, nothing refuses at 7, in the RPC or the trigger.
update public.app_settings set agent_billing_enforced = true where id = 1;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_many(6), 6, 'b1 deals 2 to 7 go through');
select is((select used from public.agent_weekly_usage()), 7, 'b2 agent A is at 7, their tier''s old cap');
select is(public.p_submit_hint($$ select public.p_submit_no('Eighth') $$), 'no error', 'b3 the 8th No deal goes through');
select is(public.p_submit_hint($$ select public.p_submit_yes('Eighth', public.p_submit_slot(10)) $$), 'no error', 'b4 a Yes deal goes through too');
select is(public.p_submit_hint($$ insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned,
                                    carrier_id, carrier_name, client_timezone, scheduled_call_at)
                                  values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000a', 'Direct', 'Eighth', true,
                                    'dddddddd-dddd-4ddd-8ddd-000000000001', 'P Submit Leaving Life', 'America/Chicago', public.p_submit_slot(11)) $$),
          'no error', 'b5 the direct insert goes through: the trigger no longer refuses');
select is((select used from public.agent_weekly_usage()), 10, 'b6 all three counted, none refused');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000d","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_many(8), 8, 'b7 a comped agent on Premium: the 8th goes through');
select is(public.p_submit_many(8), 8, 'b8 and up to their old 16');
select is(public.p_submit_hint($$ select public.p_submit_no('Seventeenth') $$), 'no error', 'b9 the 17th goes through too');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000e","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_many(7), 7, 'b10 a comped agent left on Standard gets 7');
select is(public.p_submit_hint($$ select public.p_submit_no('Eighth') $$), 'no error', 'b11 and the 8th goes through');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000f","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_many(8), 8, 'b12 a tier with no cap: the 8th goes through');
reset role;
update public.app_settings set agent_billing_enforced = false where id = 1;

-- ── c. No Servicing: both RPCs and the direct insert refuse ─────────────────
-- agent_billing_enforced is off here, so the guard can't be relying on the cap
-- function's not-enforced return.
select set_config('request.jwt.claims', '', true);
insert into public.policies (id, agent_id, client_first_name, client_last_name, fulfillment_assigned, fulfillment_stage)
values ('eeeeeeee-eeee-4eee-8eee-00000000000c', 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000c', 'Service', 'Path', true, 'Pending');
select pass('c0 the service path is unchanged: it can still write a counted row for a Leads-only agent');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_hint($$ select public.p_submit_no('Nope') $$), 'no_servicing', 'c1 agent_submit_deal refuses (No)');
select is(public.p_submit_hint($$ select public.p_submit_yes('Nope', public.p_submit_slot(1)) $$), 'no_servicing', 'c2 agent_submit_deal refuses (Yes)');
select is(public.p_submit_hint($$ select public.agent_submit_service_request('eeeeeeee-eeee-4eee-8eee-00000000000c', 'carrier_call', 'x', 'morning') $$),
          'no_servicing', 'c3 agent_submit_service_request refuses');
select is(public.p_submit_hint($$ insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned, fulfillment_stage,
                                    carrier_id, carrier_name, client_timezone, scheduled_call_at)
                                  values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000c', 'Direct', 'Book', true, 'Pending',
                                    'dddddddd-dddd-4ddd-8ddd-000000000001', 'P Submit Leaving Life', 'America/Chicago', public.p_submit_slot(2)) $$),
          'no_servicing', 'c4 the old direct insert from useBookCall refuses, a valid booking otherwise');
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned)
                    values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000c', 'Direct', 'Book', true) $$,
                 'P0001', 'Servicing is not on your plan', 'c5 with the agreed words');
select lives_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned)
                   values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000c', 'Own', 'Sale', false) $$,
                'c6 a Leads-only agent can still write a row that does not go to Fulfillment');
reset role;
select is((select count(*) from public.policies where agent_id = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000c' and fulfillment_assigned),
          1::bigint, 'c7 only the service path''s row counts');

-- ── d. Only your own client ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'req', public.agent_submit_service_request((select id from ids where name = 'no'), 'beneficiary_change',
                                                                  '  ' || repeat('n', 1200) || '  ', 'afternoon');
reset role;
select is((select length(note) || ':' || left(note, 1) || ':' || status || ':' || best_time from public.service_requests where id = (select id from ids where name = 'req')),
          '1000:n:open:afternoon', 'd0 the note is trimmed to 1000 characters and the request starts open');
select is((select count(*) from public.policy_events where policy_id = (select id from ids where name = 'no') and kind = 'service_request'
              and detail ->> 'request_id' = (select id::text from ids where name = 'req')),
          1::bigint, 'd1 the request wrote an event');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok(format('select public.agent_submit_service_request(%L, ''carrier_call'', ''x'', ''morning'')', (select id from ids where name = 'no')),
                 '42501', 'Not your client', 'd2 agent B cannot request on agent A''s client');
select throws_ok($$ select public.agent_submit_service_request('99999999-9999-4999-8999-999999999999', 'carrier_call', 'x', 'morning') $$,
                 '42501', 'Not your client', 'd3 an id that is nobody''s gets the same answer');
select is((select count(*) from public.service_requests), 0::bigint, 'd4 agent B sees none of agent A''s requests');
select throws_ok(format($$ insert into public.service_requests (agent_id, policy_id, kind) values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000b', %L, 'carrier_call') $$, (select id from ids where name = 'no')),
                 '42501', 'permission denied for table service_requests', 'd5 no direct agent insert');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.service_requests), 1::bigint, 'd6 agent A sees their own request');
select throws_ok(format($$ insert into public.service_requests (agent_id, policy_id, kind) values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000a', %L, 'carrier_call') $$, (select id from ids where name = 'no')),
                 '42501', 'permission denied for table service_requests', 'd7 not even on their own client');
update public.service_requests set status = 'done';
select is((select status from public.service_requests), 'open', 'd8 an agent cannot change the status');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.service_requests), 1::bigint, 'd9 Fulfillment sees the queue');
select lives_ok($$ update public.service_requests set status = 'in_progress' $$, 'd10 Fulfillment can change the status');
select throws_ok($$ update public.service_requests set note = 'changed' $$, '42501', 'permission denied for table service_requests',
                 'd11 and nothing else');
reset role;

-- ── e. submit_live off ──────────────────────────────────────────────────────
update public.app_settings set submit_live = false where id = 1;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_hint($$ select public.p_submit_no('Off') $$), 'not_live', 'e1 agent_submit_deal raises not_live');
select is(public.p_submit_hint(format('select public.agent_submit_service_request(%L, ''carrier_call'', ''x'', ''morning'')', (select id from ids where name = 'no'))),
          'not_live', 'e2 agent_submit_service_request raises not_live');
reset role;
update public.app_settings set submit_live = true where id = 1;

-- ── f. A service request doesn't count ──────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'b_no', public.p_submit_no('Bee');
select is((select used from public.agent_weekly_usage()), 2, 'f0 agent B has 2: the old-style row and this deal');
select lives_ok(format('select public.agent_submit_service_request(%L, ''lapse_help'', null, null)', (select id from ids where name = 'b_no')),
                'f1 a request needs no note and no best time');
select is((select used from public.agent_weekly_usage()), 2, 'f2 a service request does not change agent_weekly_usage');
reset role;

-- ── g. A Yes deal still gets a rep and a current_carrier ────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'yes', public.p_submit_yes('Deal', public.p_submit_slot(0));
reset role;
select is((select assigned_fulfillment_id from public.policies where id = (select id from ids where name = 'yes')),
          'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid, 'g1 a Yes deal gets a rep');
select is((select concat_ws('|', carrier_id, carrier_name, new_carrier_name, replaced_old_policy, best_time, scheduled_call_at = public.p_submit_slot(0))
             from public.policies where id = (select id from ids where name = 'yes')),
          'dddddddd-dddd-4ddd-8ddd-000000000001|P Submit Leaving Life|P Submit New Life|t|evening|t',
          'g2 carrier_* is the one they leave, new_carrier_* the new one');
select is((select current_carrier from public.policy_fulfillment_details where policy_id = (select id from ids where name = 'yes')),
          'P Submit Leaving Life', 'g3 current_carrier is the carrier they leave');
select is((select count(*) from public.notifications where type = 'call_booked'
              and profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001' and (data ->> 'policy_id') = (select id::text from ids where name = 'yes')),
          1::bigint, 'g4 the rep is told');
select is((select string_agg(kind, ',' order by kind) from public.policy_events where policy_id = (select id from ids where name = 'yes')),
          'booked,submitted', 'g5 it keeps the booked row and adds submitted');

-- The slot rules hold, because the booking trigger fires inside the RPC.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_submit_hint($$ select public.p_submit_yes('Soon', now() + interval '10 minutes') $$), 'booking_rule', 'g6 less than 30 minutes'' notice is refused');
select is(public.p_submit_hint($$ select public.p_submit_yes('Twice', public.p_submit_slot(0)) $$), 'booking_rule', 'g7 a double booking is refused');
select is(public.p_submit_hint($$ select public.p_submit_yes('Timeless', null) $$), 'booking_rule', 'g8 a Yes deal needs a time');
select is(public.p_submit_hint($$ select public.agent_submit_deal(
            p_first => 'Yes', p_last => 'NoOld', p_phone => '5125550101', p_city => 'Austin', p_state => 'TX', p_timezone => 'America/Chicago',
            p_new_carrier => 'dddddddd-dddd-4ddd-8ddd-000000000002', p_replaced => true, p_at => public.p_submit_slot(3), p_best_time => 'evening') $$),
          'booking_rule', 'g9 a Yes deal needs the carrier they leave');
select throws_ok($$ select public.agent_submit_deal(
            p_first => 'No', p_last => 'Best', p_phone => '5125550101', p_city => 'Austin', p_state => 'TX', p_timezone => 'America/Chicago',
            p_new_carrier => 'dddddddd-dddd-4ddd-8ddd-000000000002', p_replaced => false) $$,
          '22023', 'Pick the best time to reach them', 'g10 best_time is required on a No deal');
select throws_ok($$ select public.agent_submit_deal(
            p_first => 'Yes', p_last => 'Best', p_phone => '5125550101', p_city => 'Austin', p_state => 'TX', p_timezone => 'America/Chicago',
            p_new_carrier => 'dddddddd-dddd-4ddd-8ddd-000000000002', p_replaced => true, p_old_carrier => 'dddddddd-dddd-4ddd-8ddd-000000000001',
            p_at => public.p_submit_slot(4)) $$,
          '22023', 'Pick the best time to reach them', 'g11 best_time is required on a Yes deal');
reset role;

select * from finish();
rollback;
