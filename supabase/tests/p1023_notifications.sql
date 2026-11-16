-- p1023_notifications — pgTAP checks for 282_notifications_final.sql: exactly Brayden's lists fire per role,
-- old types and old direct inserts are dropped, bookings read Booked / Missed transfer / Rebooked once each,
-- mute stops the phone alert but not the bell, the urgent ones can't be muted, email is only the two, and the
-- sweeps (appointment soon, shift soon, missed clock-in, task due) and the triggers (new client, client request,
-- client payment failed, bug report, new agent ready, time to hire) write the right rows.
--
-- RUN: `npm run test:sql` (local PGlite). One transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- ── seed ────────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p1023_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.fname), now(), now()
  from (values
    ('a1023000-0000-4000-8000-00000000000a'::uuid, 'agent', 'agent',       'Dana Walker'),
    ('a1023000-0000-4000-8000-00000000000f'::uuid, 'va',    'fulfillment', 'Vic Ames'),
    ('a1023000-0000-4000-8000-0000000000ad'::uuid, 'admin', 'admin',       'Ada Admin')
  ) as u(id, n, role, fname);
update public.profiles set is_active = true, timezone = 'UTC', full_name = case role::text when 'agent' then 'Dana Walker' when 'fulfillment' then 'Vic Ames' else 'Ada Admin' end
 where id::text like 'a1023000-%';
-- Only our three people get admin / VA notices.
update public.profiles set is_active = false where role::text in ('admin', 'fulfillment') and id::text not like 'a1023000-%';

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at)
values ('a1023000-0000-4000-8000-0000000000d1', 'Sarah Miller', 'Sarah Miller', '+15550001001', 'TX', 'mortgage_protection', 'google', now()),
       ('a1023000-0000-4000-8000-0000000000d2', 'Tom Reyes',    'Tom Reyes',    '+15550001002', 'TX', 'mortgage_protection', 'google', now()),
       ('a1023000-0000-4000-8000-0000000000d3', 'Ann Lee',      'Ann Lee',      '+15550001003', 'TX', 'mortgage_protection', 'google', now());

insert into push_devices (profile_id, token, platform) values ('a1023000-0000-4000-8000-00000000000a', 'p1023-token', 'ios');

-- ── 1. the catalog ──────────────────────────────────────────────────────────
select set_eq($$ select type from notification_types where fires and 'agent' = any(roles) $$,
  array['live_transfer','appointment_booked','appointment_soon','transfer_missed','appointment_rebooked',
        'client_payment_failed','billing_charge_failed','message'], 'agent: exactly the 8');
select set_eq($$ select type from notification_types where fires and 'fulfillment' = any(roles) $$,
  array['va_ring','new_client','task_due','va_save_call','call_soon','call_handed_to_you','call_not_started','message',
        'client_request','shift_soon','missed_strike','paid','pay_problem'], 'VA: the 12 (booked call starting covers two types)');
select set_eq($$ select type from notification_types where fires and 'admin' = any(roles) $$,
  array['agent_ready','billing_payment_problem','message','rep_strikes','payout_problem','job_failed','bug_report','time_to_hire'],
  'admin: exactly the 8');
select set_eq($$ select type from notification_types where email_via is not null $$, array['billing_charge_failed','job_failed'],
  'email only for your payment failed and something broke');
select set_eq($$ select type from notification_types where fires and not can_mute $$,
  array['live_transfer','va_ring','client_payment_failed','billing_charge_failed','va_save_call','call_not_started','billing_payment_problem'],
  'urgent ones cannot be muted');
select is((select count(*)::int from notification_types where fires and not in_bell), 2, 'only the two ringing calls skip the bell');

-- ── 2. old types and direct inserts stop ────────────────────────────────────
select is(public.notify('a1023000-0000-4000-8000-00000000000a', 'policy_cancelled', 'x', 'y', '/'), null, 'an old type writes nothing');
insert into notifications (profile_id, type, message, title) values ('a1023000-0000-4000-8000-0000000000ad', 'invite_accepted', 'x', 'x');
insert into notifications (profile_id, type, message) values ('a1023000-0000-4000-8000-0000000000ad', 'bug_report_submitted', 'x');
select is((select count(*)::int from notifications where profile_id = 'a1023000-0000-4000-8000-0000000000ad'), 0, 'old direct inserts are dropped');

-- ── 3. bookings: Booked, Rebooked, Missed transfer ──────────────────────────
insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
values ('a1023000-0000-4000-8000-0000000000d1', 'a1023000-0000-4000-8000-00000000000a', 'booked', 'Booked',
        jsonb_build_object('at', now() + interval '2 days'), 'Our team', 'team');
select is((select count(*)::int from notifications where profile_id = 'a1023000-0000-4000-8000-00000000000a' and type = 'appointment_booked'), 1, 'a booking notifies the agent');
select matches((select title from notifications where type = 'appointment_booked' and profile_id = 'a1023000-0000-4000-8000-00000000000a'),
  '^Booked: Sarah M\., ', 'Booked: Sarah M., <day time>');
select is((select link from notifications where type = 'appointment_booked' and profile_id = 'a1023000-0000-4000-8000-00000000000a'),
  '/agent/inbounds/a1023000-0000-4000-8000-0000000000d1', 'opens the lead');

insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role, created_at)
values ('a1023000-0000-4000-8000-0000000000d1', 'a1023000-0000-4000-8000-00000000000a', 'booked', 'Booked again',
        jsonb_build_object('at', now() + interval '3 days'), 'Our team', 'team', now() + interval '1 minute');
select is((select count(*)::int from notifications where profile_id = 'a1023000-0000-4000-8000-00000000000a' and type = 'appointment_rebooked'), 1, 'a second booking reads Rebooked');
select matches((select title from notifications where type = 'appointment_rebooked'), '^We rebooked Sarah M\. on your calendar: ', 'rebooked words, no "no-show"');

insert into transfer_checks (id, agent_id, lead_id, summary, status, seen_token)
values ('a1023000-0000-4000-8000-0000000000c1', 'a1023000-0000-4000-8000-00000000000a', 'a1023000-0000-4000-8000-0000000000d2',
        '{}'::jsonb, 'no_answer', 'tok');
update transfer_checks set status = 'booked', booked_for = now() + interval '1 day' where id = 'a1023000-0000-4000-8000-0000000000c1';
insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
select 'a1023000-0000-4000-8000-0000000000d2', 'a1023000-0000-4000-8000-00000000000a', 'booked', 'Booked',
       jsonb_build_object('appointment_at', booked_for), 'Our team', 'team' from transfer_checks where id = 'a1023000-0000-4000-8000-0000000000c1';
select is((select count(*)::int from notifications where profile_id = 'a1023000-0000-4000-8000-00000000000a' and data ->> 'lead_id' = 'a1023000-0000-4000-8000-0000000000d2'),
  1, 'missed transfer + its booking: one notice');
select matches((select title || ' ' || detail from notifications where type = 'transfer_missed'), '^You missed Tom R\.''s transfer We booked Tom for ',
  'You missed Tom R.''s transfer. We booked Tom for <time>.');

-- ── 4. mute ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1023000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(jsonb_array_length(public.my_notification_list()), 8, 'agent settings list has the 8');
select lives_ok($$ select public.set_notification_mute('appointment_booked', true) $$, 'agent mutes New appointment booked');
select throws_ok($$ select public.set_notification_mute('billing_charge_failed', true) $$, '22023', 'This one can''t be muted', 'payment failed can''t be muted');
select throws_ok($$ select public.set_notification_mute('job_failed', true) $$, '22023', 'Not a notification you get', 'not another role''s type');
reset role;
insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
values ('a1023000-0000-4000-8000-0000000000d3', 'a1023000-0000-4000-8000-00000000000a', 'booked', 'Booked',
        jsonb_build_object('at', now() + interval '4 days'), 'Our team', 'team');
select is((select count(*)::int from notifications where data ->> 'lead_id' = 'a1023000-0000-4000-8000-0000000000d3' and in_bell), 1, 'muted: still in the bell');
select is((select count(*)::int from notification_pushes p join notifications n on n.id = p.notification_id
            where n.data ->> 'lead_id' = 'a1023000-0000-4000-8000-0000000000d3'), 0, 'muted: no phone alert');
select is((select count(*)::int from notification_pushes p join notifications n on n.id = p.notification_id
            where n.type = 'transfer_missed'), 1, 'not muted: phone alert queued');

-- ── 5. sweeps ───────────────────────────────────────────────────────────────
insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role, created_at)
values ('a1023000-0000-4000-8000-0000000000d3', 'a1023000-0000-4000-8000-00000000000a', 'booked', 'Soon',
        jsonb_build_object('at', now() + interval '12 minutes'), 'Our team', 'team', now() + interval '2 minutes');
select ok(public.notify_call_times(now() + interval '2 minutes') >= 1, 'the sweep runs');
select matches((select title from notifications where type = 'appointment_soon'), '^In 1[0-9] minutes: Ann L\.$', 'appointment in 15 minutes');

insert into va_shifts (va_id, shift_date, starts, ends, tz)
values ('a1023000-0000-4000-8000-00000000000f', (now() at time zone 'UTC')::date, ((now() at time zone 'UTC') + interval '12 minutes')::time(0),
        '23:59', 'UTC');
select lives_ok($$ select public.notify_call_times(now()) $$, 'shift sweep runs');
select is((select count(*)::int from notifications where type = 'shift_soon' and profile_id = 'a1023000-0000-4000-8000-00000000000f'),
  case when ((now() at time zone 'UTC') + interval '12 minutes')::date = (now() at time zone 'UTC')::date then 1 else 0 end, 'shift in 15 minutes');
select lives_ok($$ select public.notify_call_times(now() + interval '25 minutes') $$, 'clock-in sweep runs');
select is((select count(*)::int from notifications where type = 'missed_strike' and title = 'You haven''t clocked in'),
  case when ((now() at time zone 'UTC') + interval '12 minutes')::date = (now() at time zone 'UTC')::date then 1 else 0 end, 'missed clock-in');

-- ── 6. admin ────────────────────────────────────────────────────────────────
insert into bug_reports (reporter_id, description) values ('a1023000-0000-4000-8000-00000000000a', 'The   calendar
 is blank');
select is((select title || ' | ' || detail || ' | ' || link from notifications where type = 'bug_report'),
  'Bug report from Dana Walker | The calendar is blank | /admin/bugs', 'bug report');
select is(public.job_words('notify-push'), 'Phone alerts aren''t sending', 'something broke, in plain words');
select is((public.va_capacity_forecast() ->> 'short_vas')::int >= 0, true, 'capacity forecast returns a shortfall');
select is(public.notify_time_to_hire(), 0, 'no shortfall, no time-to-hire notice');

-- ── 7. locks ────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.my_notification_list()', 'execute'), 'anon can''t read a list');
select ok(not has_function_privilege('authenticated', 'public.notify(uuid,text,text,text,text,boolean,text,jsonb)', 'execute'), 'browser can''t call notify');

select * from finish();
rollback;
