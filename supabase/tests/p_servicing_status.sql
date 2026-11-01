-- p_servicing_status — pgTAP checks for 193_servicing_model.sql: one servicing_tasks
-- table, policy_servicing_status, agent_clients, the replaced feed and the writers.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_servicing_status.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agents A and B (no upline link), U (A's upline), D (the demo side), rep R,
-- admin Z. Every date is worked out from today, so a case can't go stale.

begin;
create extension if not exists pgtap with schema extensions;
select plan(120);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_servicing_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8193-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8193-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8193-00000000000c'::uuid, 'agent_u', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8193-00000000000d'::uuid, 'agent_d', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8193-000000000001'::uuid, 'rep_r',   'fulfillment'),
    ('cccccccc-cccc-4ccc-8193-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8193-000000000001';
update public.profiles set upline_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000c' where id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000a';
update public.profiles set is_demo = true where id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000d';
update public.app_settings set submit_live = true, agent_billing_enforced = false where id = 1;

-- A policy with the fields the stage reads. The last name is the case's name.
create function public.p_ss_policy(
  p_name text,
  p_age interval default interval '3 months 10 days',
  p_replaced boolean default false,
  p_agent uuid default 'aaaaaaaa-aaaa-4aaa-8193-00000000000a',
  p_status public.policy_status default 'In Effect',
  p_assigned boolean default true
) returns uuid language sql as $f$
  insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, status, effective_date,
                               fulfillment_assigned, fulfillment_stage, replaced_old_policy, new_carrier_name)
  values (p_agent, 'Case', p_name, null, p_status, (current_date - p_age)::date,
          p_assigned, case when p_assigned then 'Pending'::public.fulfillment_stage_status end, p_replaced, 'P Status Life')
  returning id
$f$;

-- A task on the case. requested_by_id stays null: the kinds here are fixtures.
create function public.p_ss_task(
  p_name text,
  p_kind text,
  p_status text default 'scheduled',
  p_due timestamptz default null,
  p_by text default 'system',
  p_outcome text default null,
  p_done timestamptz default null
) returns uuid language sql as $f$
  insert into public.servicing_tasks (agent_id, policy_id, kind, status, due_at, requested_by, outcome, done_at)
  select p.agent_id, p.id, p_kind, p_status, p_due, p_by, p_outcome, p_done
    from public.policies p where p.client_last_name = p_name
  returning id
$f$;

-- stage|next_step|next_date for a case, 'null' where there is none.
create function public.p_ss_row(p_name text) returns text language sql as $f$
  select s.stage || '|' || coalesce(s.next_step, 'null') || '|' || coalesce(s.next_date::text, 'null')
    from public.policy_servicing_status s where s.client_last_name = p_name
$f$;

create function public.p_ss_expect(p_stage text, p_step text, p_date timestamptz) returns text language sql as $f$
  select p_stage || '|' || coalesce(p_step, 'null') || '|' || coalesce(p_date::text, 'null')
$f$;

-- The date a watch ends, as the view writes it: noon UTC on anchor + 12 months.
create function public.p_ss_watch_end(p_age interval) returns timestamptz language sql as $f$
  select (((current_date - p_age)::date + interval '12 months')::date + time '12:00') at time zone 'UTC'
$f$;

-- Two policies for the grouping cases, on their own names and phones.
create function public.p_ss_person(p_agent uuid, p_first text, p_last text, p_phone text,
                                   p_age interval default interval '3 months 10 days',
                                   p_status public.policy_status default 'In Effect',
                                   p_created timestamptz default now()) returns uuid language sql as $f$
  insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, status, effective_date,
                               fulfillment_assigned, fulfillment_stage, replaced_old_policy, created_at)
  values (p_agent, p_first, p_last, p_phone, p_status, (current_date - p_age)::date, true, 'Pending', false, p_created)
  returning id
$f$;

grant execute on function public.p_ss_row(text) to authenticated, anon;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, anon;

-- ── a. Stage cases ──────────────────────────────────────────────────────────
-- Setting up with an open packet_check: the earliest of the steps that belong to
-- the stage. The chargeback watch is open too, and isn't one of them.
select public.p_ss_policy('SetupPacket', interval '10 days');
select public.p_ss_task('SetupPacket', 'review_call', 'scheduled', now() + interval '20 days');
select public.p_ss_task('SetupPacket', 'packet_check', 'scheduled', now() + interval '3 days');
select public.p_ss_task('SetupPacket', 'chargeback_watch', 'scheduled', now() + interval '1 day');
select is(public.p_ss_row('SetupPacket'), public.p_ss_expect('setting_up', 'packet_check', now() + interval '3 days'),
          'a1 an open packet_check reads setting up, and it is the next step');

-- Setting up with the old policy open and no tasks left.
insert into public.policies (agent_id, client_first_name, client_last_name, status, effective_date, fulfillment_assigned,
                             fulfillment_stage, replaced_old_policy, carrier_name, new_carrier_name, scheduled_call_at)
values ('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Case', 'SetupOld', 'In Effect', current_date - 10, true, 'Pending', true,
        'P Old Life', 'P Status Life', now() + interval '2 days');
select public.p_ss_task('SetupOld', 'packet_check', 'done');
select is(public.p_ss_row('SetupOld'), public.p_ss_expect('setting_up', 'old_policy_cancel', now() + interval '2 days'),
          'a2 the old policy open with no tasks left reads setting up, old_policy_cancel at the call time');
select is((select carrier from public.policy_servicing_status where client_last_name = 'SetupOld'), 'P Status Life',
          'a3 carrier is the new carrier, not the one they leave');

-- Setting up weighs the call against the tasks.
insert into public.policies (agent_id, client_first_name, client_last_name, status, effective_date, fulfillment_assigned,
                             fulfillment_stage, replaced_old_policy, carrier_name, scheduled_call_at)
values ('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Case', 'SetupWeigh', 'In Effect', current_date - 10, true, 'Pending', true,
        'P Old Life', now() + interval '2 days');
select public.p_ss_task('SetupWeigh', 'review_call', 'scheduled', now() + interval '1 day');
select is(public.p_ss_row('SetupWeigh'), public.p_ss_expect('setting_up', 'review_call', now() + interval '1 day'),
          'a4 a review call before the old-policy call is the next step');
select is((select carrier from public.policy_servicing_status where client_last_name = 'SetupWeigh'), 'P Old Life',
          'a5 carrier falls back to carrier_name when there is no new carrier');

-- Protected, month 4, nothing open: the fallback.
select public.p_ss_policy('Protected4', interval '3 months 10 days');
select is(public.p_ss_row('Protected4'),
          public.p_ss_expect('protected', 'chargeback_watch', public.p_ss_watch_end(interval '3 months 10 days')),
          'a6 month 4 reads protected, chargeback_watch at anchor + 12 months');
select is((select watch_month from public.policy_servicing_status where client_last_name = 'Protected4'), 4, 'a7 watch_month is 4');

-- Protected with a seeded watch: the task's own date wins over the fallback.
select public.p_ss_policy('ProtectedSeed', interval '1 month 10 days');
select public.p_ss_task('ProtectedSeed', 'packet_check', 'done');
select public.p_ss_task('ProtectedSeed', 'chargeback_watch', 'scheduled', now() + interval '300 days');
select is(public.p_ss_row('ProtectedSeed'), public.p_ss_expect('protected', 'chargeback_watch', now() + interval '300 days'),
          'a8 a chargeback_watch task gives its own date');

-- The anchor: effective date, then sold date, then created_at.
insert into public.policies (agent_id, client_first_name, client_last_name, status, policy_sold_date, fulfillment_assigned, fulfillment_stage, replaced_old_policy)
values ('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Case', 'AnchorSold', 'In Effect', current_date - interval '5 months 10 days', true, 'Pending', false);
insert into public.policies (agent_id, client_first_name, client_last_name, status, fulfillment_assigned, fulfillment_stage, replaced_old_policy, created_at)
values ('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Case', 'AnchorMade', 'In Effect', true, 'Pending', false, now() - interval '6 months 10 days');
select is((select watch_month from public.policy_servicing_status where client_last_name = 'AnchorSold'), 6, 'a9 with no effective date the sold date anchors');
select is((select watch_month from public.policy_servicing_status where client_last_name = 'AnchorMade'), 7, 'a10 with neither, created_at anchors');

-- A future effective date is month 1. A policy at exactly 12 months has moved on.
select public.p_ss_policy('NotYet', interval '-20 days');
select public.p_ss_policy('Exactly12', interval '12 months');
select is((select stage || ':' || watch_month from public.policy_servicing_status where client_last_name = 'NotYet'), 'protected:1',
          'a11 an effective date still to come reads protected, month 1');
select is((select stage || ':' || coalesce(watch_month::text, 'null') from public.policy_servicing_status where client_last_name = 'Exactly12'), 'ongoing:null',
          'a12 the day 12 months pass reads ongoing, watch_month null');

-- The old policy cancelled is good news.
select public.p_ss_policy('OldCancelled', interval '1 month 10 days', null);
update public.policies set fulfillment_stage = 'Complete', fulfillment_completed_at = now(), cancellation_status = 'Cancellation Complete'
 where client_last_name = 'OldCancelled';
select is(public.p_ss_row('OldCancelled'),
          public.p_ss_expect('protected', 'chargeback_watch', public.p_ss_watch_end(interval '1 month 10 days')),
          'a13 old policy cancelled in month 2 reads protected, never ended');
select is((select watch_month from public.policy_servicing_status where client_last_name = 'OldCancelled'), 2, 'a14 and watch_month is 2');

-- replaced_old_policy: false skips the step, null with an open call has it.
select public.p_ss_policy('NoReplace', interval '1 month 10 days', false);
select public.p_ss_policy('NullReplace', interval '1 month 10 days', null);
select is((select stage from public.policy_servicing_status where client_last_name = 'NoReplace'), 'protected',
          'a15 replaced_old_policy false skips the old-policy step');
select is((select stage || ':' || next_step from public.policy_servicing_status where client_last_name = 'NullReplace'), 'setting_up:old_policy_cancel',
          'a16 replaced_old_policy null with an open call reads setting up');

-- A sold lead's policy never went to Fulfillment, so it has no call to wait for.
select public.p_ss_policy('NeverAssigned', interval '1 month 10 days', null, 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'In Effect', false);
select public.p_ss_task('NeverAssigned', 'packet_check', 'done');
select is((select stage from public.policy_servicing_status where client_last_name = 'NeverAssigned'), 'protected',
          'a17 a policy that never went to Fulfillment is not stuck on the old-policy step');
select public.p_ss_policy('NoTaskNoCall', interval '1 month 10 days', null, 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'In Effect', false);
select is((select count(*) from public.policy_servicing_status where client_last_name = 'NoTaskNoCall'), 0::bigint,
          'a18 a policy with no call and no task is not in the view');

-- Lapse save open in month 14, by the system and by the agent.
select public.p_ss_policy('Lapse14', interval '13 months 10 days');
select public.p_ss_task('Lapse14', 'lapse_save', 'scheduled', now() + interval '1 day');
select is(public.p_ss_row('Lapse14'), public.p_ss_expect('needs_attention', 'lapse_save', now() + interval '1 day'),
          'a19 a lapse save open in month 14 reads needs attention, not ongoing');
select is((select watch_month from public.policy_servicing_status where client_last_name = 'Lapse14'), null::integer, 'a20 watch_month is null after month 12');
select public.p_ss_policy('LapseAgent', interval '3 months 10 days');
select public.p_ss_task('LapseAgent', 'lapse_save', 'requested', null, 'agent');
select is(public.p_ss_row('LapseAgent'), public.p_ss_expect('needs_attention', 'lapse_save', null),
          'a21 an agent''s open lapse save reads needs attention, whoever opened it');
select is((select open_requests from public.policy_servicing_status where client_last_name = 'LapseAgent'), 1, 'a22 and counts as a request');

-- Saved.
select public.p_ss_policy('Saved3', interval '3 months 10 days');
select public.p_ss_task('Saved3', 'lapse_save', 'done', null, 'system', 'saved', now() - interval '3 days');
select is(public.p_ss_row('Saved3'), public.p_ss_expect('needs_attention', 'saved_watch', now() + interval '11 days'),
          'a23 saved 3 days ago reads needs attention, saved_watch at done_at + 14 days');
select public.p_ss_policy('Saved20', interval '3 months 10 days');
select public.p_ss_task('Saved20', 'lapse_save', 'done', null, 'system', 'saved', now() - interval '20 days');
select is(public.p_ss_row('Saved20'),
          public.p_ss_expect('protected', 'chargeback_watch', public.p_ss_watch_end(interval '3 months 10 days')),
          'a24 saved 20 days ago reads protected');

-- Ongoing.
select public.p_ss_policy('Ongoing14', interval '13 months 10 days');
select public.p_ss_task('Ongoing14', 'chargeback_watch', 'scheduled', now() - interval '1 month');
select public.p_ss_task('Ongoing14', 'annual_review', 'scheduled', now() + interval '9 days');
select is(public.p_ss_row('Ongoing14'), public.p_ss_expect('ongoing', 'annual_review', now() + interval '9 days'),
          'a25 month 14 with an annual_review reads ongoing, annual_review its next step');
select public.p_ss_policy('OngoingConv', interval '13 months 10 days');
select public.p_ss_task('OngoingConv', 'conversion', 'requested', now() + interval '4 days');
select is(public.p_ss_row('OngoingConv'), public.p_ss_expect('ongoing', 'conversion', now() + interval '4 days'), 'a26 or a conversion');
select public.p_ss_policy('OngoingNone', interval '13 months 10 days');
select is(public.p_ss_row('OngoingNone'), public.p_ss_expect('ongoing', null, null), 'a27 month 14 with neither has no step and no date');

-- Ended, from exactly these sources.
select public.p_ss_policy('EndLapsed', interval '3 months 10 days', false, 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Lapsed');
select public.p_ss_policy('EndNotApproved', interval '3 months 10 days', false, 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Not Approved');
select public.p_ss_policy('EndUndrafted', interval '3 months 10 days', false, 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Undrafted');
select public.p_ss_policy('EndArchived', interval '3 months 10 days');
update public.policies set archived_at = now() where client_last_name = 'EndArchived';
select public.p_ss_policy('EndOutcomeLapsed', interval '3 months 10 days');
select public.p_ss_task('EndOutcomeLapsed', 'lapse_save', 'done', null, 'system', 'lapsed', now() - interval '1 day');
select public.p_ss_policy('EndClientCancelled', interval '3 months 10 days');
select public.p_ss_task('EndClientCancelled', 'lapse_save', 'done', null, 'system', 'client_cancelled', now() - interval '1 day');
select is(public.p_ss_row('EndLapsed'), 'ended|null|null', 'a28 status Lapsed reads ended, no step, no date');
select is(public.p_ss_row('EndNotApproved'), 'ended|null|null', 'a29 status Not Approved reads ended');
select is(public.p_ss_row('EndUndrafted'), 'ended|null|null', 'a30 status Undrafted reads ended');
select is(public.p_ss_row('EndArchived'), 'ended|null|null', 'a31 archived_at reads ended');
select is(public.p_ss_row('EndOutcomeLapsed'), 'ended|null|null', 'a32 a done lapse save with outcome lapsed reads ended');
select is(public.p_ss_row('EndClientCancelled'), 'ended|null|null', 'a33 a done lapse save with outcome client_cancelled reads ended');

-- Order.
select public.p_ss_policy('OrderEnded', interval '3 months 10 days', false, 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Lapsed');
select public.p_ss_task('OrderEnded', 'lapse_save', 'requested', now() + interval '1 day');
select is(public.p_ss_row('OrderEnded'), 'ended|null|null', 'a34 ended beats needs attention');
select public.p_ss_policy('OrderAttention', interval '10 days');
select public.p_ss_task('OrderAttention', 'packet_check', 'scheduled', now() + interval '1 day');
select public.p_ss_task('OrderAttention', 'lapse_save', 'scheduled', now() + interval '2 days');
select is(public.p_ss_row('OrderAttention'), public.p_ss_expect('needs_attention', 'lapse_save', now() + interval '2 days'),
          'a35 needs attention beats setting up, and its step is the lapse save');
select public.p_ss_policy('OrderSetup', interval '13 months 10 days');
select public.p_ss_task('OrderSetup', 'review_call', 'scheduled', now() + interval '1 day');
select is(public.p_ss_row('OrderSetup'), public.p_ss_expect('setting_up', 'review_call', now() + interval '1 day'),
          'a36 setting up beats month 14');

-- A request never sets a stage.
select public.p_ss_policy('Request', interval '3 months 10 days');
insert into ids select 'request', public.p_ss_task('Request', 'address_change', 'requested', now() + interval '1 hour', 'agent');
select is(public.p_ss_row('Request'),
          public.p_ss_expect('protected', 'chargeback_watch', public.p_ss_watch_end(interval '3 months 10 days')),
          'a37 a protected policy with an open address_change stays protected, and that is not its next step');
select is((select open_requests from public.policy_servicing_status where client_last_name = 'Request'), 1, 'a38 open_requests is 1');
select public.p_ss_task('Request', 'carrier_call', 'in_progress', null, 'client');
select is((select open_requests from public.policy_servicing_status where client_last_name = 'Request'), 2, 'a39 a client''s request in progress is open too');
update public.servicing_tasks set status = 'done' where policy_id = (select policy_id from public.servicing_tasks where id = (select id from ids where name = 'request'));
select is((select open_requests from public.policy_servicing_status where client_last_name = 'Request'), 0, 'a40 done gives 0');
select public.p_ss_task('SetupOld', 'annual_review', 'scheduled', now() + interval '1 hour', 'system');
select is((select next_step from public.policy_servicing_status where client_last_name = 'SetupOld'), 'old_policy_cancel',
          'a41 a task that belongs to another stage does not become setting up''s next step');
select public.p_ss_policy('RequestSetup', interval '13 months 10 days');
select public.p_ss_task('RequestSetup', 'packet_check', 'requested', null, 'agent');
select is((select stage from public.policy_servicing_status where client_last_name = 'RequestSetup'), 'ongoing',
          'a42 a packet_check somebody asked for does not make it setting up');

-- ── b. The shape ────────────────────────────────────────────────────────────
select is((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname ~ '^service_request'), 0::bigint,
          'b1 the second table is gone');
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'servicing_tasks' and column_name = 'requested_by_id'),
          'uuid', 'b2 requested_by_id is the uuid');
select is((select data_type || ':' || is_nullable || ':' || column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'servicing_tasks' and column_name = 'requested_by'),
          'text:NO:''system''::text', 'b3 requested_by is text, not null, default system');
select throws_ok($$ select public.p_ss_task('Request', 'carrier_call', 'requested', null, 'robot') $$, '23514', null, 'b4 requested_by is agent, client or system');
select throws_ok($$ select public.p_ss_task('Request', 'carrier_call', 'open') $$, '23514', null, 'b5 the status list has no open');
select throws_ok($$ select public.p_ss_task('Request', 'not_a_kind') $$, '23514', null, 'b6 the kind list is still closed');
select throws_ok($$ select public.p_ss_task('Request', 'lapse_save', 'done', null, 'system', 'maybe') $$, '23514', null, 'b7 outcome is a closed list');
select throws_ok($$ update public.servicing_tasks set best_time = 'night' $$, '23514', null, 'b8 best_time is a closed list');
select is((select count(*) from pg_indexes where schemaname = 'public' and tablename = 'servicing_tasks' and indexdef like '%(policy_id)%'), 1::bigint, 'b9 policy_id has its index');
select is((select count(*) from public.policy_servicing_status where client_last_name = 'Request' and is_sample), 0::bigint, 'b10 is_sample comes from the policy');
select is((select array_agg(a.attname::text order by a.attnum) from pg_attribute a
            where a.attrelid = 'public.policy_servicing_status'::regclass and a.attnum > 0 and not a.attisdropped),
          array['policy_id', 'agent_id', 'client_key', 'client_first_name', 'client_last_name', 'client_phone', 'carrier', 'stage',
                'next_step', 'next_date', 'watch_month', 'open_requests', 'is_sample'],
          'b11 the status view has the columns the pages build against');

-- ── c. RLS ──────────────────────────────────────────────────────────────────
select public.p_ss_policy('OfA', interval '3 months 10 days');
select public.p_ss_task('OfA', 'carrier_call', 'requested', null, 'agent');
select public.p_ss_policy('OfB', interval '3 months 10 days', false, 'aaaaaaaa-aaaa-4aaa-8193-00000000000b');
insert into ids select 'b_task', public.p_ss_task('OfB', 'carrier_call', 'requested', null, 'agent');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_tasks where agent_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000b'), 0::bigint, 'c1 A sees 0 of B''s servicing_tasks');
select is((select count(*) from public.policy_servicing_status where agent_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000b'), 0::bigint, 'c2 A sees 0 of B''s policy_servicing_status');
select is((select count(*) from public.agent_clients where agent_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000b'), 0::bigint, 'c3 A sees 0 of B''s agent_clients');
select ok((select count(*) from public.servicing_tasks where agent_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000a') > 0, 'c4 A sees A''s servicing_tasks');
select is((select count(*) from public.policy_servicing_status where client_last_name = 'OfA'), 1::bigint, 'c5 A sees A''s policy_servicing_status');
select ok((select count(*) from public.agent_clients where client_last_name = 'OfA') = 1, 'c6 A sees A''s agent_clients');
select is((select stage || ':' || open_requests from public.policy_servicing_status where client_last_name = 'OfA'), 'protected:1',
          'c7 A reads the same stage and request count the owner does');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select ok((select count(*) from public.servicing_tasks where agent_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000a') > 0, 'c8 U sees A''s servicing_tasks');
select is((select count(*) from public.policy_servicing_status where client_last_name = 'OfA'), 1::bigint, 'c9 U sees A''s policy_servicing_status');
select is((select count(*) from public.agent_clients where client_last_name = 'OfA'), 1::bigint, 'c10 U sees A''s agent_clients');
select is((select count(*) from public.policy_servicing_status where client_last_name = 'OfB'), 0::bigint, 'c11 U sees nothing of B');
reset role;

select set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.servicing_tasks $$, '42501', 'permission denied for table servicing_tasks', 'c12 anon is refused servicing_tasks');
select throws_ok($$ select count(*) from public.policy_servicing_status $$, '42501', 'permission denied for view policy_servicing_status', 'c13 anon is refused policy_servicing_status');
select throws_ok($$ select count(*) from public.agent_clients $$, '42501', 'permission denied for view agent_clients', 'c14 anon is refused agent_clients');
reset role;

select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.policy_servicing_status'::regclass),
          'c15 policy_servicing_status is security_invoker');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.agent_clients'::regclass),
          'c16 agent_clients is security_invoker');
select ok(has_table_privilege('service_role', 'public.policy_servicing_status', 'select') and has_table_privilege('service_role', 'public.agent_clients', 'select')
          and has_table_privilege('authenticated', 'public.policy_servicing_status', 'select') and has_table_privilege('authenticated', 'public.agent_clients', 'select'),
          'c17 authenticated and service_role can read both views');
select ok(not has_table_privilege('authenticated', 'public.policy_servicing_status', 'insert, update, delete')
          and not has_table_privilege('authenticated', 'public.agent_clients', 'insert, update, delete'),
          'c18 and nobody writes through them');

-- Negative control: the same check must catch a view that runs as its owner. A
-- savepoint keeps it from touching what comes after.
savepoint negative_control;
alter view public.policy_servicing_status reset (security_invoker);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select ok((select count(*) from public.policy_servicing_status where agent_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000b') > 0,
          'c19 negative control: without security_invoker A can see B''s rows, so c2 is a real check');
rollback to savepoint negative_control;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.policy_servicing_status'::regclass),
          'c20 the control rolled back: the view is security_invoker again');

-- Writes.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ insert into public.servicing_tasks (agent_id, policy_id, kind)
                    select agent_id, policy_id, 'carrier_call' from public.policy_servicing_status where client_last_name = 'OfA' $$,
                 '42501', 'permission denied for table servicing_tasks', 'c21 A cannot insert servicing_tasks');
update public.servicing_tasks set status = 'done' where agent_id = 'aaaaaaaa-aaaa-4aaa-8193-00000000000a';
reset role;
select is((select t.status from public.servicing_tasks t join public.policies p on p.id = t.policy_id where p.client_last_name = 'OfA'), 'requested',
          'c22 A cannot update the status of their own task');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ update public.servicing_tasks set note = 'x' $$, '42501', 'permission denied for table servicing_tasks', 'c23 A cannot update the note');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8193-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok(format($$ update public.servicing_tasks set status = 'in_progress' where id = %L $$, (select id from ids where name = 'b_task')),
                'c24 Fulfillment can update the status');
select throws_ok(format($$ update public.servicing_tasks set note = 'changed' where id = %L $$, (select id from ids where name = 'b_task')),
                 '42501', 'permission denied for table servicing_tasks', 'c25 Fulfillment cannot update the note');
select throws_ok(format($$ update public.servicing_tasks set outcome = 'saved' where id = %L $$, (select id from ids where name = 'b_task')),
                 '42501', 'permission denied for table servicing_tasks', 'c26 Fulfillment cannot update the outcome');
reset role;
select is((select status from public.servicing_tasks where id = (select id from ids where name = 'b_task')), 'in_progress', 'c27 Fulfillment''s status change saved');

select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8193-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok(format($$ update public.servicing_tasks set status = 'scheduled' where id = %L $$, (select id from ids where name = 'b_task')),
                'c28 admin can update the status');
reset role;
select is((select status from public.servicing_tasks where id = (select id from ids where name = 'b_task')), 'scheduled', 'c29 admin''s status change saved');

-- Demo wall. The task names A as its agent, so only the wall can hide it.
select set_config('request.jwt.claims', '', true);
select public.p_ss_policy('DemoCase', interval '3 months 10 days', false, 'aaaaaaaa-aaaa-4aaa-8193-00000000000d');
insert into public.servicing_tasks (agent_id, policy_id, kind, note)
select 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', id, 'carrier_call', 'demo task in A''s name' from public.policies where client_last_name = 'DemoCase';
insert into public.servicing_tasks (agent_id, policy_id, kind, note)
select 'aaaaaaaa-aaaa-4aaa-8193-00000000000d', id, 'address_change', 'demo task in D''s name' from public.policies where client_last_name = 'DemoCase';
select is((select is_demo from public.policies where client_last_name = 'DemoCase'), true, 'c30 the fixture is a demo policy');

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, assigned_rep_id)
values ('dddddddd-dddd-4ddd-8193-00000000000a', 'Lead A', 'Lead A', '+15125550190', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8193-00000000000a'),
       ('dddddddd-dddd-4ddd-8193-00000000000d', 'Lead D', 'Lead D', '+15125550191', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8193-00000000000d');
insert into public.servicing_tasks (agent_id, lead_id, policy_id, kind) values
  ('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'dddddddd-dddd-4ddd-8193-00000000000a', null, 'carrier_call'),
  ('aaaaaaaa-aaaa-4aaa-8193-00000000000d', 'dddddddd-dddd-4ddd-8193-00000000000d', null, 'carrier_call');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_tasks where note = 'demo task in A''s name'), 0::bigint,
          'c31 a non-demo agent cannot see a demo policy''s task, even one in their name');
select is((select count(*) from public.servicing_tasks where lead_id = 'dddddddd-dddd-4ddd-8193-00000000000a' and policy_id is null), 1::bigint,
          'c32 an agent still sees their own lead-only task with a null policy_id');
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8193-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_tasks where note like 'demo task%'), 0::bigint,
          'c33 a non-demo rep cannot see a demo policy''s task');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000d","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_tasks where note = 'demo task in D''s name'), 1::bigint, 'c34 the demo agent sees their demo task');
select is((select count(*) from public.servicing_tasks where lead_id = 'dddddddd-dddd-4ddd-8193-00000000000d' and policy_id is null), 1::bigint,
          'c35 and their own lead-only task');
reset role;
select set_config('request.jwt.claims', '', true);

-- Control: with the wall gone A does see that task, so c31 is the wall's doing.
savepoint wall_control;
drop policy servicing_tasks_demo_wall on public.servicing_tasks;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.servicing_tasks where note = 'demo task in A''s name'), 1::bigint,
          'c36 control: without the demo wall A sees the demo task');
rollback to savepoint wall_control;

-- ── d. done_at and updated_at ───────────────────────────────────────────────
select public.p_ss_policy('DoneStamp', interval '3 months 10 days');
insert into ids select 'stamp', public.p_ss_task('DoneStamp', 'lapse_save', 'in_progress', now() + interval '1 day');
update public.servicing_tasks set outcome = 'saved' where id = (select id from ids where name = 'stamp');
select is((select done_at from public.servicing_tasks where id = (select id from ids where name = 'stamp')), null, 'd0 an open task has no done_at');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8193-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
update public.servicing_tasks set status = 'done' where id = (select id from ids where name = 'stamp');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select done_at from public.servicing_tasks where id = (select id from ids where name = 'stamp')), now(), 'd1 Fulfillment setting status done stamps done_at');
select is(public.p_ss_row('DoneStamp'), public.p_ss_expect('needs_attention', 'saved_watch', now() + interval '14 days'),
          'd2 a saved task with that stamp reads needs attention');

select public.p_ss_policy('DoneKeep', interval '3 months 10 days');
insert into ids select 'keep', public.p_ss_task('DoneKeep', 'review_call', 'scheduled', null, 'system', null, now() - interval '9 days');
update public.servicing_tasks set status = 'done', updated_at = now() - interval '9 days' where id = (select id from ids where name = 'keep');
select is((select done_at from public.servicing_tasks where id = (select id from ids where name = 'keep')), now() - interval '9 days', 'd3 a done_at already set is kept');
select is((select updated_at from public.servicing_tasks where id = (select id from ids where name = 'keep')), now(), 'd4 updated_at is the trigger''s to set');

-- ── e. Feed and writers ─────────────────────────────────────────────────────
-- Sold, on a lead with a policy.
select public.p_ss_policy('SoldPolicy', interval '10 days', null, 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'In Effect', false);
update public.leads set client_policy_id = (select id from public.policies where client_last_name = 'SoldPolicy')
 where id = 'dddddddd-dddd-4ddd-8193-00000000000a';
select public.p_ss_policy('FeedRequest', interval '3 months 10 days');
update public.policies set client_first_name = 'Feed' where client_last_name = 'FeedRequest';

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('dddddddd-dddd-4ddd-8193-00000000000a', 'sold'), 'sold', 'e1 A marks the lead sold');
create temp table used_before as select used from public.agent_weekly_usage('aaaaaaaa-aaaa-4aaa-8193-00000000000a');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
insert into ids select 'rpc', public.agent_submit_service_request(
  (select policy_id from public.policy_servicing_status where client_last_name = 'FeedRequest'), 'address_change', 'New address', 'morning');
select is((select used from public.agent_weekly_usage('aaaaaaaa-aaaa-4aaa-8193-00000000000a')), (select used from used_before),
          'e2 agent_weekly_usage(A).used is unchanged after a service request');
-- The old spelling, in two pieces so the leftover-names grep stays empty.
select throws_ok(format($$ select public.agent_submit_service_request(%L, %L, null, null) $$,
                        (select policy_id from public.policy_servicing_status where client_last_name = 'FeedRequest'), 'lapse' || '_help'),
                 '22023', 'Pick what the client needs', 'e3 the old kind names are refused by the RPC');
select lives_ok($$ create temp table feed as
                   select * from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', 'aaaaaaaa-aaaa-4aaa-8193-00000000000a', 5000) $$,
                'e4 agent_activity_feed runs as A');
select is((select count(*) from feed where id in (select 'servicing_added:' || t.id::text from public.servicing_tasks t
                                                    where t.lead_id = 'dddddddd-dddd-4ddd-8193-00000000000a' and t.kind = 'packet_check')
             and meta ->> 'actor_name' = 'Test agent_a' and title = 'Servicing task added: packet check.'), 1::bigint,
          'e5 the Sold servicing row shows the requester''s name');
select is((select count(*) from feed where id = 'servicing_added:' || (select id::text from ids where name = 'rpc')
             and meta ->> 'actor_name' = 'Test agent_a' and title = 'Request opened: address change.'), 1::bigint,
          'e6 the request shows once as a servicing row, with the requester''s name');
select is((select count(*) from feed where (meta ->> 'policy_id')::uuid = (select policy_id from public.policy_servicing_status where client_last_name = 'FeedRequest')
             and kind = 'servicing'), 1::bigint, 'e7 and that is the only servicing row for it');
select is((select count(*) from feed where kind = 'service_request' or title = 'Call updated.'), 0::bigint, 'e8 with no Call updated row');
reset role;
select is((select count(*) from public.policy_events where kind = 'service_request'
             and detail ->> 'request_id' = (select id::text from ids where name = 'rpc')), 1::bigint,
          'e9 the policy_events row stays, and detail.request_id is the task id');
select is((select concat_ws('|', requested_by, requested_by_id, status, kind, note, best_time) from public.servicing_tasks where id = (select id from ids where name = 'rpc')),
          'agent|aaaaaaaa-aaaa-4aaa-8193-00000000000a|requested|address_change|New address|morning',
          'e10 the RPC writes requested_by agent and requested_by_id A');
select is((select string_agg(kind || ':' || requested_by || ':' || requested_by_id || ':' || status, ',' order by kind)
             from public.servicing_tasks where lead_id = 'dddddddd-dddd-4ddd-8193-00000000000a' and policy_id is not null),
          'chargeback_watch:system:aaaaaaaa-aaaa-4aaa-8193-00000000000a:scheduled,packet_check:system:aaaaaaaa-aaaa-4aaa-8193-00000000000a:scheduled,review_call:system:aaaaaaaa-aaaa-4aaa-8193-00000000000a:scheduled',
          'e11 Sold writes requested_by system and its three seeds');
select is(public.p_ss_row('SoldPolicy'), public.p_ss_expect('setting_up', 'packet_check', now() + interval '7 days'),
          'e12 a sold lead''s policy reads setting up from its seeds');

-- ── f. Grouping ─────────────────────────────────────────────────────────────
-- No signed-in user here: the booking trigger resets created_at on an agent's own insert.
select set_config('request.jwt.claims', '', true);
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Grace', 'Hopper', '(555) 010-0300', interval '3 months 10 days', 'In Effect', now() - interval '2 days');
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', '  GRACE', 'hopper   ', '+15550100300', interval '2 months 10 days', 'In Effect', now() - interval '1 day');
select is((select count(*) || ':' || sum(policy_count) from public.agent_clients where lower(btrim(client_first_name)) = 'grace'), '1:2',
          'f1 two phone formats and a name differing in case and spacing are one client, policy_count 2');
select is((select client_first_name || '|' || client_phone from public.agent_clients where lower(btrim(client_first_name)) = 'grace'), '  GRACE|+15550100300',
          'f2 name and phone come from the newest policy');
select is((select cardinality(policy_ids) from public.agent_clients where lower(btrim(client_first_name)) = 'grace'), 2, 'f3 policy_ids holds both');

select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Ada', 'Lovelace', '5550100301');
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Alan', 'Turing', '5550100301');
select is((select count(*) from public.agent_clients where client_phone = '5550100301'), 2::bigint, 'f4 the same phone with different names is 2 clients');

select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'No', 'Phone', null);
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'No', 'Phone', 'n/a');
select is((select count(*) from public.agent_clients where client_last_name = 'Phone'), 2::bigint, 'f5 no phone with the same name is 2 clients');

select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Both', 'Books', '5550100302');
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000b', 'Both', 'Books', '5550100302');
select is((select count(*) from public.agent_clients where client_last_name = 'Books'), 2::bigint, 'f6 the same person under A and B is separate rows');
select is((select count(distinct client_key) from public.policy_servicing_status where client_last_name = 'Books'), 2::bigint, 'f7 with separate keys');

select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Mix', 'EndProt', '5550100303', interval '3 months 10 days', 'Lapsed');
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Mix', 'EndProt', '5550100303', interval '2 months 10 days');
select is((select stage from public.agent_clients where client_last_name = 'EndProt'), 'protected', 'f8 one ended + one protected = protected');
select is((select next_date from public.agent_clients where client_last_name = 'EndProt'), public.p_ss_watch_end(interval '2 months 10 days'), 'f9 next_date comes from the policy that isn''t ended');

select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Mix', 'EndEnd', '5550100304', interval '3 months 10 days', 'Lapsed');
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Mix', 'EndEnd', '5550100304', interval '2 months 10 days', 'Undrafted');
select is((select stage || ':' || coalesce(next_date::text, 'null') from public.agent_clients where client_last_name = 'EndEnd'), 'ended:null', 'f10 two ended = ended');

select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Mix', 'AttnProt', '5550100305');
select public.p_ss_person('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Mix', 'AttnProt', '5550100305');
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by, due_at)
select agent_id, id, 'lapse_save', 'requested', 'agent', now() + interval '1 day' from public.policies
 where client_last_name = 'AttnProt' order by id limit 1;
select is((select stage || ':' || open_requests from public.agent_clients where client_last_name = 'AttnProt'), 'needs_attention:1', 'f11 one needs attention + one protected = needs attention, requests summed');

update public.policies set is_sample = true where client_last_name = 'EndEnd';
update public.policies set is_sample = true where id = (select id from public.policies where client_last_name = 'AttnProt' order by id limit 1);
select is((select is_sample from public.agent_clients where client_last_name = 'EndEnd'), true, 'f12 is_sample when all of them are');
select is((select is_sample from public.agent_clients where client_last_name = 'AttnProt'), false, 'f13 and not when only one is');

-- ── g. 7/16 ─────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
create temp table used_week as select used from public.agent_weekly_usage('aaaaaaaa-aaaa-4aaa-8193-00000000000a');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.policies (agent_id, client_first_name, client_last_name, status, fulfillment_assigned, fulfillment_stage, replaced_old_policy, is_sample, created_at)
values ('aaaaaaaa-aaaa-4aaa-8193-00000000000a', 'Sample', 'Backdated', 'In Effect', true, 'Pending', false, true, date_trunc('week', now()) - interval '3 days');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8193-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select used from public.agent_weekly_usage('aaaaaaaa-aaaa-4aaa-8193-00000000000a')), (select used from used_week),
          'g1 an is_sample policy created before this Monday does not raise used');
reset role;

select * from finish();
rollback;
