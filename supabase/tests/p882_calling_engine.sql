-- p882_calling_engine — pgTAP checks for supabase/migrations/p882_calling_engine.sql (Prompt 882): routing to ONE
-- free VA (longest idle, 15 s, then the next; 2 misses = Away + admins), callbacks to the promiser, a new lead
-- pulling a VA off a carrier hold, wait alerts, presence, wrap-up, the pre-dial check and one-tap Do not call.
--
-- RUN: `npm run test:sql -- supabase/tests/p882_calling_engine.sql` (PGlite, in memory). One transaction, rolled
-- back. Never run it against Ohvara's live database.
--
-- Cast: admin Z, agent G, VAs V1 V2 (on shift all day today), V3 (no shift).

begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p882_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('d8820000-0000-4000-8000-000000000001'::uuid, 'admin_z', 'agent'),
    ('d8820000-0000-4000-8000-000000000002'::uuid, 'agent_g', 'agent'),
    ('e8820000-0000-4000-8000-000000000001'::uuid, 'va_one', 'fulfillment'),
    ('e8820000-0000-4000-8000-000000000002'::uuid, 'va_two', 'fulfillment'),
    ('e8820000-0000-4000-8000-000000000003'::uuid, 'va_three', 'fulfillment')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'd8820000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where role::text in ('fulfillment', 'admin')
   and id not in ('d8820000-0000-4000-8000-000000000001', 'e8820000-0000-4000-8000-000000000001',
                  'e8820000-0000-4000-8000-000000000002', 'e8820000-0000-4000-8000-000000000003');
insert into public.va_shifts (va_id, shift_date, starts, ends) values
  ('e8820000-0000-4000-8000-000000000001', public.va_today(), '00:00', '23:59'),
  ('e8820000-0000-4000-8000-000000000002', public.va_today(), '00:00', '23:59');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
-- Desk hours and the lead's window are clock-dependent; most checks pin them with a fixed instant or a state
-- that's open now. 'ZZ' is a test state open all day in UTC.
insert into public.state_call_rules (state, tz, call_start, call_end) values ('ZZ', array['UTC'], '00:00', '23:59:59');
create or replace function public.route_desk_open(p_at timestamptz default now())
returns boolean language sql stable as $$ select true $$;

-- ── a. structure and access ───────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'call_queue', 'a1 call_queue exists');
select has_table('public', 'va_presence', 'a2 va_presence exists');
select has_table('public', 'va_lines', 'a3 va_lines exists');
select has_table('public', 'state_call_rules', 'a4 state_call_rules exists');
select ok((select count(*) from public.state_call_rules) >= 52, 'a5 every state seeded');
select is((select bool_or(counsel_reviewed) from public.state_call_rules where state <> 'ZZ'), false, 'a6 seeds are flagged not counsel-reviewed');
select ok(not has_function_privilege('authenticated', 'public.route_tick()', 'execute'), 'a7 route_tick is server-only');
select ok(not has_function_privilege('authenticated', 'public.line_open(uuid, uuid, uuid, text)', 'execute'), 'a8 line_open is server-only');
select ok(not has_function_privilege('anon', 'public.va_beat(text, jsonb)', 'execute'), 'a9 anon cannot beat');
select ok(has_function_privilege('authenticated', 'public.mark_do_not_call(text, uuid, uuid, text)', 'execute'), 'a10 VAs can mark do not call');
select is((select relrowsecurity from pg_class where oid = 'public.call_queue'::regclass), true, 'a11 RLS on call_queue');

-- ── b. pre-dial ──────────────────────────────────────────────────────────────────────────────────────────────
insert into public.leads (id, lead_type, phone, state, contact_name, business_name, qualifier_answers) values
  ('a8820000-0000-4000-8000-000000000001', 'cancellation', '+15550100001', 'FL', 'Fay Form', 'Fay Form', '{"consent_at":"2026-11-07T10:00:00Z"}'),
  ('a8820000-0000-4000-8000-000000000002', 'cancellation', '+15550100002', 'FL', 'Nora None', 'Nora None', '{}');
-- 8:30 PM Eastern on a Tuesday: FL closes at 8 PM.
select is((select reason from public.predial_eval('+15550100001', null, 'a8820000-0000-4000-8000-000000000001', 'call', '2026-11-10 20:30:00-05')),
  'outside_hours', 'b1 FL after 8 PM local is outside hours');
select is((select next_at from public.predial_eval('+15550100001', null, 'a8820000-0000-4000-8000-000000000001', 'call', '2026-11-10 20:30:00-05')),
  '2026-11-11 08:00:00-06'::timestamptz, 'b2 next time = 8 AM in the later of FL''s two zones (Central)');
select is((select ok from public.predial_eval('+15550100001', null, 'a8820000-0000-4000-8000-000000000001', 'call', '2026-11-10 10:00:00-05')),
  true, 'b3 FL 10 AM with form consent is ok');
select is((select reason from public.predial_eval('+15550100002', null, 'a8820000-0000-4000-8000-000000000002', 'call', '2026-11-10 10:00:00-05')),
  'no_consent', 'b4 no consent on file blocks');
select is((select ok from public.predial_eval('+15550100002', null, 'a8820000-0000-4000-8000-000000000002', 'call', '2026-11-10 10:00:00-05', null, true)),
  true, 'b5 someone who called in counts as consent');
select is((select reason from public.predial_eval('+15550100001', 'QQ', null, 'call', now())),
  'no_consent', 'b6 an unknown number with no lead or policy has no consent');
insert into public.call_attempts (phone, at) select '+15550100001', '2026-11-10 09:00:00-05'::timestamptz + make_interval(mins => g) from generate_series(1, 3) g;
select is((select reason from public.predial_eval('+15550100001', null, 'a8820000-0000-4000-8000-000000000001', 'call', '2026-11-10 10:00:00-05')),
  'attempt_cap', 'b7 FL: a 4th call in 24 h is capped');
select is((select ok from public.predial_eval('+15550100001', null, 'a8820000-0000-4000-8000-000000000001', 'text', '2026-11-10 10:00:00-05')),
  true, 'b8 the cap counts calls, not texts');
select is((select reason from public.predial_eval('+15550100001', 'TX', null, 'call', '2026-11-15 11:00:00-06', null, true)),
  'outside_hours', 'b9 TX Sunday opens at noon');
select is((select reason from public.predial_eval('+15550100001', 'XX', 'a8820000-0000-4000-8000-000000000001', 'call', now())),
  'unknown_state', 'b10 a state we don''t know is never guessed');
select pg_temp.as_user('d8820000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.predial_check('+15550100001') $$, '42501', null, 'b11 agents cannot run the VA pre-dial check');
select pg_temp.as_owner();

-- ── c. presence ──────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('e8820000-0000-4000-8000-000000000003');
select throws_ok($$ select public.va_beat('available') $$, '55000', 'You are not on shift right now', 'c1 off shift cannot go Available');
select pg_temp.as_user('e8820000-0000-4000-8000-000000000001');
select is(public.va_beat('available') #>> '{presence,status}', 'available', 'c2 V1 goes Available');
select pg_temp.as_user('e8820000-0000-4000-8000-000000000002');
select is(public.va_beat('available') #>> '{presence,status}', 'available', 'c3 V2 goes Available');
select pg_temp.as_owner();
-- V1 has been free longer than V2.
update public.va_presence set idle_since = now() - interval '10 minutes' where user_id = 'e8820000-0000-4000-8000-000000000001';
update public.va_presence set idle_since = now() - interval '1 minute' where user_id = 'e8820000-0000-4000-8000-000000000002';

-- ── d. a new lead rings ONE VA, the longest idle ─────────────────────────────────────────────────────────────
insert into public.leads (id, lead_type, phone, state, contact_name, business_name, qualifier_answers) values
  ('a8820000-0000-4000-8000-000000000010', 'mortgage_protection', '+15550100010', 'ZZ', 'Lee New', 'Lee New', '{"consent_at":"2026-11-07T10:00:00Z"}');
select is((select count(*)::int from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000010'), 1, 'd1 the new lead is on the queue');
select is((select status from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000010'), 'offered', 'd2 it is offered at once');
select is((select offered_to from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000010'),
  'e8820000-0000-4000-8000-000000000001'::uuid, 'd3 to the longest-idle VA (V1), not everyone');
select is((select status from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000002'), 'available', 'd4 V2 is not rung');
select is((select status from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000001'), 'ringing', 'd5 V1 is ringing');
select ok(exists (select 1 from public.notifications where profile_id = 'e8820000-0000-4000-8000-000000000001' and type = 'va_ring'), 'd6 V1 got the ring push');
select is((select (offer_expires_at - offered_at) from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000010'),
  interval '15 seconds', 'd7 15 s to answer');

-- 15 s pass: counted miss, then V2.
update public.call_queue set offer_expires_at = now() - interval '1 second' where lead_id = 'a8820000-0000-4000-8000-000000000010';
select public.route_tick();
select is((select offered_to from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000010'),
  'e8820000-0000-4000-8000-000000000002'::uuid, 'd8 after 15 s the next VA gets it');
select is((select missed_rings from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000001'), 1, 'd9 V1''s miss is counted');
select is((select status from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000001'), 'available', 'd10 one miss: still Available');

-- V2 answers.
select pg_temp.as_user('e8820000-0000-4000-8000-000000000002');
select ok((public.route_accept((select id from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000010')) ->> 'line_id') is not null, 'd11 Answer makes a line');
select pg_temp.as_owner();
select is((select status from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000002'), 'on_call', 'd12 V2 is on the call');
select is((select va_claimed_by from public.leads where id = 'a8820000-0000-4000-8000-000000000010'),
  'e8820000-0000-4000-8000-000000000002'::uuid, 'd13 the lead is V2''s');
select pg_temp.as_user('e8820000-0000-4000-8000-000000000001');
select throws_ok($$ select public.route_accept((select id from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000010')) $$,
  '55006', null, 'd14 a late Answer from V1 is refused');
select pg_temp.as_owner();

-- ── e. two misses in a row = Away + admins ───────────────────────────────────────────────────────────────────
insert into public.leads (id, lead_type, phone, state, contact_name, business_name, qualifier_answers) values
  ('a8820000-0000-4000-8000-000000000011', 'mortgage_protection', '+15550100011', 'ZZ', 'Mia Miss', 'Mia Miss', '{"consent_at":"x"}');
select is((select offered_to from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000011'),
  'e8820000-0000-4000-8000-000000000001'::uuid, 'e1 V1 (the only free VA) is rung');
select pg_temp.as_user('e8820000-0000-4000-8000-000000000001');
select is(public.route_pass((select id from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000011')) ->> 'status',
  'away', 'e2 Not now twice in a row sets V1 to Away');
select pg_temp.as_owner();
select ok(exists (select 1 from public.notifications where profile_id = 'd8820000-0000-4000-8000-000000000001' and type = 'va_missed_rings'), 'e3 admins told');
select is((select status from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000011'), 'waiting', 'e4 the lead waits for the first VA free');

-- ── f. waiting 60 s → admins pushed, a speed miss ───────────────────────────────────────────────────────────
update public.call_queue set ready_at = now() - interval '70 seconds' where lead_id = 'a8820000-0000-4000-8000-000000000011';
select public.route_tick();
select ok(exists (select 1 from public.notifications where profile_id = 'd8820000-0000-4000-8000-000000000001' and type = 'lead_waiting'), 'f1 lead waiting 60 s: admins pushed');
select is((select speed_miss from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000011'), true, 'f2 counted as a speed miss');

-- ── g. wrap-up, then the first VA free gets the waiting lead ────────────────────────────────────────────────
select public.line_ended((select line_id from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000002'), 'test');
select is((select status from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000002'), 'wrap', 'g1 call over: V2 is in wrap-up');
select pg_temp.as_user('e8820000-0000-4000-8000-000000000002');
select throws_ok($$ select public.va_beat('available') $$, '55000', 'Log the outcome first', 'g2 no Available before the outcome');
select throws_ok($$ select public.va_wrap_done('') $$, '22023', null, 'g3 an empty outcome is refused');
select is((public.va_wrap_more() ->> 'wrap_extra')::int, 1, 'g4 +60 s is counted');
select is(public.va_wrap_done('booked') ->> 'status', 'available', 'g5 outcome logged: Available');
select pg_temp.as_owner();
select is((select offered_to from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000011'),
  'e8820000-0000-4000-8000-000000000002'::uuid, 'g6 the waiting lead goes to the first VA out of wrap');
update public.va_presence set wrap_started_at = now() - interval '4 minutes', status = 'wrap' where user_id = 'e8820000-0000-4000-8000-000000000001';
select public.route_tick();
select ok(exists (select 1 from public.notifications where type = 'wrap_stuck'), 'g7 wrap over 3 min: admins told');
update public.va_presence set status = 'available', wrap_started_at = null, idle_since = now() where user_id = 'e8820000-0000-4000-8000-000000000001';

-- ── h. a callback rings the promiser first ───────────────────────────────────────────────────────────────────
update public.call_queue set status = 'done' where lead_id = 'a8820000-0000-4000-8000-000000000011';
update public.va_presence set status = 'available', idle_since = now() - interval '1 hour' where user_id = 'e8820000-0000-4000-8000-000000000002';
update public.va_presence set idle_since = now() - interval '2 hours' where user_id = 'e8820000-0000-4000-8000-000000000001';
update public.leads set va_outcome = 'callback', va_callback_at = now() - interval '6 minutes',
       va_last_worked_by = 'e8820000-0000-4000-8000-000000000002' where id = 'a8820000-0000-4000-8000-000000000011';
select public.route_tick();
select is((select offered_to from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000011' and kind = 'callback'),
  'e8820000-0000-4000-8000-000000000002'::uuid, 'h1 the callback rings the VA who promised it, not the longest idle');
update public.call_queue set offer_expires_at = now() + interval '1 minute' where lead_id = 'a8820000-0000-4000-8000-000000000011' and kind = 'callback';
select public.route_tick();
select ok(exists (select 1 from public.notifications where type = 'callback_late'), 'h2 more than 5 min late: admins told');

-- ── i. a new lead pulls a VA off a carrier hold (no client on it) ────────────────────────────────────────────
update public.call_queue set status = 'done' where status in ('waiting', 'offered', 'held');
update public.va_presence set status = 'away' where user_id = 'e8820000-0000-4000-8000-000000000001';
insert into public.va_lines (id, kind, va_id, status, detail) values
  ('b8820000-0000-4000-8000-000000000001', 'carrier', 'e8820000-0000-4000-8000-000000000002', 'live', '{"carrier":"Acme Life"}');
update public.va_presence set status = 'on_call', line_id = 'b8820000-0000-4000-8000-000000000001' where user_id = 'e8820000-0000-4000-8000-000000000002';
insert into public.fulfillment_voice_legs (call_sid, line_id, party, status) values ('CAcarrier1', 'b8820000-0000-4000-8000-000000000001', 'carrier', 'live');
select public.line_hold_state('b8820000-0000-4000-8000-000000000001');
select is((select status from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000002'), 'on_hold_carrier', 'i1 carrier-only hold is marked');
insert into public.leads (id, lead_type, phone, state, contact_name, business_name, qualifier_answers) values
  ('a8820000-0000-4000-8000-000000000012', 'mortgage_protection', '+15550100012', 'ZZ', 'Pat Pull', 'Pat Pull', '{"consent_at":"x"}');
select is((select pull_hold from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000012'), true, 'i2 nobody free: offered to the VA on hold');
select pg_temp.as_user('e8820000-0000-4000-8000-000000000002');
select ok((public.route_accept((select id from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000012')) ->> 'line_id') is not null, 'i3 they answer the new lead');
select pg_temp.as_owner();
select is((select status from public.va_lines where id = 'b8820000-0000-4000-8000-000000000001'), 'handoff', 'i4 the hold is handed off');
select is((select count(*)::int from public.call_queue where line_id = 'b8820000-0000-4000-8000-000000000001' and kind = 'hold_handoff'), 1, 'i5 and queued for the next VA');

-- ── j. a dropped call: 60 s to rejoin, then the next VA ──────────────────────────────────────────────────────
update public.va_lines set status = 'live', va_call_sid = 'CAvaleg1' where id = (select line_id from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000002');
select is(public.line_va_left((select line_id from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000002'), 'CAvaleg1'), true, 'j1 the VA''s leg dropped: rescue');
update public.va_lines set rescue_until = now() - interval '1 second' where status = 'rescue';
update public.va_presence set status = 'available', idle_since = now() where user_id = 'e8820000-0000-4000-8000-000000000001';
update public.va_presence set last_seen = now() where user_id = 'e8820000-0000-4000-8000-000000000001';
select public.route_tick();
select ok(exists (select 1 from public.call_queue where kind = 'rescue' and offered_to = 'e8820000-0000-4000-8000-000000000001'), 'j2 after 60 s the next VA (not the one who dropped) gets it');

-- ── k. presence: 30 s quiet = out of routing ─────────────────────────────────────────────────────────────────
update public.va_presence set last_seen = now() - interval '40 seconds', status = 'available' where user_id = 'e8820000-0000-4000-8000-000000000001';
update public.call_queue set status = 'done' where status in ('waiting', 'offered');
select public.route_tick();
select is((select pulled_reason from public.va_presence where user_id = 'e8820000-0000-4000-8000-000000000001'), 'silent', 'k1 quiet 30 s: pulled from routing');
select ok(exists (select 1 from public.notifications where profile_id = 'e8820000-0000-4000-8000-000000000001' and type = 'va_pulled'), 'k2 and told');

-- ── l. one-tap Do not call ───────────────────────────────────────────────────────────────────────────────────
update public.va_presence set status = 'available', last_seen = now(), pulled_reason = null where user_id = 'e8820000-0000-4000-8000-000000000001';
insert into public.leads (id, lead_type, phone, state, contact_name, business_name, qualifier_answers) values
  ('a8820000-0000-4000-8000-000000000013', 'mortgage_protection', '+15550100013', 'ZZ', 'Dee Dnc', 'Dee Dnc', '{"consent_at":"x"}');
insert into public.inbound_events (lead_id, kind, state, at, label) values
  ('a8820000-0000-4000-8000-000000000013', 'text_sent', 'scheduled', now() + interval '1 day', 'Check-in text');
select pg_temp.as_user('e8820000-0000-4000-8000-000000000001');
select is((public.mark_do_not_call(null, 'a8820000-0000-4000-8000-000000000013', null, 'asked on the call') ->> 'cancelled_texts')::int, 1, 'l1 Do not call skips the scheduled text');
select pg_temp.as_owner();
select is((select status from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000013' and kind = 'new_lead'), 'cancelled', 'l2 and cancels the queued call');
select is(public.sms_is_opted_out('+15550100013'), true, 'l3 opted out of texts (and GoHighLevel through the opt-out list)');
select is((select reason from public.predial_eval('+15550100013', 'ZZ', null, 'call', now())), 'opted_out', 'l4 every later call is blocked');
-- STOP from anywhere cancels queued calls too.
insert into public.leads (id, lead_type, phone, state, contact_name, business_name, qualifier_answers) values
  ('a8820000-0000-4000-8000-000000000014', 'mortgage_protection', '+15550100014', 'ZZ', 'Sam Stop', 'Sam Stop', '{"consent_at":"x"}');
select public.sms_set_opt('+15550100014', true, 'STOP');
select is((select status from public.call_queue where lead_id = 'a8820000-0000-4000-8000-000000000014'), 'cancelled', 'l5 a STOP cancels the queued call');

-- ── m. admins on the desk ────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('d8820000-0000-4000-8000-000000000001');
select is(public.admin_set_desk(true) ->> 'status', 'available', 'm1 an admin goes Available as the desk');
select pg_temp.as_owner();
select ok(exists (select 1 from public.presence_log where user_id = 'd8820000-0000-4000-8000-000000000001' and is_desk), 'm2 desk time is logged apart');

select * from finish();
rollback;
