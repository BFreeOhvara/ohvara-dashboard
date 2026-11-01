-- p_transfer_missed — pgTAP checks for 208_transfer_missed.sql: Accept only records
-- the acknowledgement, a miss is one row from either path, the working-hours helper
-- is closed to the browser, the next open slot respects hours and bookings, and
-- va_set_lead_outcome refuses a booking outside the agent's hours.
--
-- RUN: `npm run test:sql` (local PGlite) or `supabase test db` on a LOCAL stack only.
-- Everything runs in one transaction that is rolled back. Never run it against
-- Ohvara's live database (jjextitmbptoaolacocs), and never apply migrations to it
-- from here.
--
-- Cast: agents A and B (active, UTC), agent C (active, Chicago), VA V.
-- Leads: d1 d2 d3 d4 d5 typed, each with its own phone; d6 is found by phone only.
-- Calls (last two hex digits of the id):
--   c1 transferring to A on d1          c4 transferred to A on d4
--   c2 transferring to A on d2          c5 transferring to A, nobody's phone matches
--   c3 no_answer, A on d3               c6 no_answer, A, no lead_id, caller is d6's phone

begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_transfer_missed_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('f2080000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent'),
    ('f2080000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent'),
    ('f2080000-0000-4000-8000-00000000000c'::uuid, 'agent_c', 'agent'),
    ('f2080000-0000-4000-8000-00000000000f'::uuid, 'va_v',    'fulfillment')
  ) as u(id, n, role);
update public.profiles set is_active = true, timezone = 'UTC'
 where id in ('f2080000-0000-4000-8000-00000000000a', 'f2080000-0000-4000-8000-00000000000b',
              'f2080000-0000-4000-8000-00000000000f');
update public.profiles set is_active = true, timezone = 'America/Chicago'
 where id = 'f2080000-0000-4000-8000-00000000000c';

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at, va_outcome, transfer_status)
values
  ('f2080000-0000-4000-8000-0000000000d1', 'Dana One',   'Dana One',   '+15125559201', 'TX', 'policy_help', 'google', now(), 'transferred', 'requested'),
  ('f2080000-0000-4000-8000-0000000000d2', 'Dana Two',   'Dana Two',   '+15125559202', 'TX', 'policy_help', 'google', now(), null, null),
  ('f2080000-0000-4000-8000-0000000000d3', 'Dana Three', 'Dana Three', '+15125559203', 'TX', 'policy_help', 'google', now(), 'transferred', 'dropped'),
  ('f2080000-0000-4000-8000-0000000000d4', 'Dana Four',  'Dana Four',  '+15125559204', 'TX', 'policy_help', 'google', now(), null, null),
  ('f2080000-0000-4000-8000-0000000000d5', 'Dana Five',  'Dana Five',  '+15125559205', 'TX', 'policy_help', 'google', now(), null, null),
  ('f2080000-0000-4000-8000-0000000000d6', 'Dana Six',   'Dana Six',   '+15125559206', 'TX', 'policy_help', 'google', now(), null, 'requested');

insert into public.help_calls (id, call_sid, caller_number, tracking_number, status, outcome, transfer_agent_id, lead_id, transfer_started_at, transferred_at)
values
  ('f2080000-0000-4000-8000-0000000000c1', 'p_tm_c1', '+15125559201', '+15125559100', 'transferring', null,
   'f2080000-0000-4000-8000-00000000000a', 'f2080000-0000-4000-8000-0000000000d1', now() - interval '20 seconds', null),
  ('f2080000-0000-4000-8000-0000000000c2', 'p_tm_c2', '+15125559202', '+15125559100', 'transferring', null,
   'f2080000-0000-4000-8000-00000000000a', 'f2080000-0000-4000-8000-0000000000d2', now() - interval '10 seconds', null),
  ('f2080000-0000-4000-8000-0000000000c3', 'p_tm_c3', '+15125559203', '+15125559100', 'no_answer', null,
   'f2080000-0000-4000-8000-00000000000a', 'f2080000-0000-4000-8000-0000000000d3', now() - interval '40 seconds', null),
  ('f2080000-0000-4000-8000-0000000000c4', 'p_tm_c4', '+15125559204', '+15125559100', 'transferred', 'transferred',
   'f2080000-0000-4000-8000-00000000000a', 'f2080000-0000-4000-8000-0000000000d4', now() - interval '50 seconds', now() - interval '45 seconds'),
  ('f2080000-0000-4000-8000-0000000000c5', 'p_tm_c5', '+15125559299', '+15125559100', 'no_answer', null,
   'f2080000-0000-4000-8000-00000000000a', null, now() - interval '50 seconds', null),
  ('f2080000-0000-4000-8000-0000000000c6', 'p_tm_c6', '+15125559206', '+15125559100', 'no_answer', null,
   'f2080000-0000-4000-8000-00000000000a', null, now() - interval '50 seconds', null);

create temp table p_tm_before as
  select id, status, outcome, transferred_at, end_reason, agent_call_sid from public.help_calls;

-- ── a. Grants ───────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.agent_accept_transfer(uuid)', 'execute'), 'a1 anon cannot accept');
select ok(has_function_privilege('authenticated', 'public.agent_accept_transfer(uuid)', 'execute'), 'a2 authenticated can accept');
select ok(not has_function_privilege('anon', 'public.agent_missed_transfer(uuid)', 'execute'), 'a3 anon cannot say can''t take it');
select ok(has_function_privilege('authenticated', 'public.agent_missed_transfer(uuid)', 'execute'), 'a4 authenticated can say can''t take it');
select ok(not has_function_privilege('authenticated', 'public.agents_slots_in_hours(uuid, timestamptz[])', 'execute'), 'a5 agents_slots_in_hours is not executable by authenticated');
select ok(not has_function_privilege('anon', 'public.agents_slots_in_hours(uuid, timestamptz[])', 'execute'), 'a6 or by anon');
select ok(has_function_privilege('service_role', 'public.agents_slots_in_hours(uuid, timestamptz[])', 'execute'), 'a7 the service role can');
select ok(not has_function_privilege('authenticated', 'public.log_missed_transfer(text)', 'execute'), 'a8 log_missed_transfer is not executable by authenticated');
select ok(not has_function_privilege('anon', 'public.log_missed_transfer(text)', 'execute'), 'a9 or by anon');
select ok(has_function_privilege('service_role', 'public.log_missed_transfer(text)', 'execute'), 'a10 the service role can');
select ok(has_function_privilege('authenticated', 'public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb)', 'execute'),
          'a11 va_set_lead_outcome keeps its arguments and grants');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'va_set_lead_outcome'), 1::bigint,
          'a12 and there is still one of it');

-- ── b. Accept records the acknowledgement and nothing else ──────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select ok(public.agent_accept_transfer('f2080000-0000-4000-8000-0000000000d1'), 'b1 A acknowledges their ringing call');
reset role;
select ok((select agent_ack_at is not null from public.help_calls where call_sid = 'p_tm_c1'), 'b2 agent_ack_at is set');
select is((select status from public.help_calls where call_sid = 'p_tm_c1'), 'transferring', 'b3 status is untouched');
select ok((select outcome is null and transferred_at is null from public.help_calls where call_sid = 'p_tm_c1'), 'b4 outcome and transferred_at are untouched');

-- A repeat keeps the first time.
update public.help_calls set agent_ack_at = now() - interval '5 seconds' where call_sid = 'p_tm_c1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.agent_accept_transfer('f2080000-0000-4000-8000-0000000000d1');
reset role;
select is((select agent_ack_at from public.help_calls where call_sid = 'p_tm_c1'), now() - interval '5 seconds', 'b5 a repeat tap keeps the first time');

-- An ack from an earlier attempt doesn't stand for this one.
update public.help_calls set agent_ack_at = now() - interval '5 minutes' where call_sid = 'p_tm_c1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.agent_accept_transfer('f2080000-0000-4000-8000-0000000000d1');
reset role;
select is((select agent_ack_at from public.help_calls where call_sid = 'p_tm_c1'), now(), 'b6 an older attempt''s ack is replaced');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select ok(not public.agent_accept_transfer('f2080000-0000-4000-8000-0000000000d2'), 'b7 B cannot acknowledge A''s call');
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select throws_ok($$ select public.agent_accept_transfer('f2080000-0000-4000-8000-0000000000d2') $$, '42501', 'Only an active agent can do this',
                 'b8 a VA is refused');
reset role;
select ok((select agent_ack_at is null from public.help_calls where call_sid = 'p_tm_c2'), 'b9 and A''s other call has no ack');

-- ── c. A miss is one row, from either path ──────────────────────────────────
create or replace function pg_temp.missed(p_lead text) returns bigint language sql as $$
  select count(*) from public.inbound_events where kind = 'missed' and lead_id = ('f2080000-0000-4000-8000-0000000000' || p_lead)::uuid
$$;

-- Twilio's path first, then the browser.
select ok(public.log_missed_transfer('p_tm_c3'), 'c1 the server path writes a row');
select is(pg_temp.missed('d3'), 1::bigint, 'c2 one row');
select ok(not public.log_missed_transfer('p_tm_c3'), 'c3 a second call writes nothing');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select ok(not public.agent_missed_transfer('f2080000-0000-4000-8000-0000000000d3'), 'c4 the browser after the server writes nothing');
reset role;
select is(pg_temp.missed('d3'), 1::bigint, 'c5 still one row');

-- The browser first, twice, then Twilio.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select ok(public.agent_missed_transfer('f2080000-0000-4000-8000-0000000000d1'), 'c6 can''t take it writes a row');
select ok(not public.agent_missed_transfer('f2080000-0000-4000-8000-0000000000d1'), 'c7 a second tap writes nothing');
reset role;
select ok(not public.log_missed_transfer('p_tm_c1'), 'c8 the server after the browser writes nothing');
select is(pg_temp.missed('d1'), 1::bigint, 'c9 one row across both paths');
select is((select agent_id from public.inbound_events where kind = 'missed' and lead_id = 'f2080000-0000-4000-8000-0000000000d1'),
          'f2080000-0000-4000-8000-00000000000a'::uuid, 'c10 the row names the agent who missed it');

-- Someone else's lead.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select throws_ok($$ select public.agent_missed_transfer('f2080000-0000-4000-8000-0000000000d2') $$, '42501', 'Only the lead''s agent can do this',
                 'c11 B cannot mark A''s lead missed');
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select throws_ok($$ select public.agent_missed_transfer('f2080000-0000-4000-8000-0000000000d2') $$, '42501', 'Only the lead''s agent can do this',
                 'c12 neither can a VA');
reset role;
select is(pg_temp.missed('d2'), 0::bigint, 'c13 and nothing was written');

-- An answered call is not a miss; no lead means no row; a phone match links the lead.
select ok(not public.log_missed_transfer('p_tm_c4'), 'c14 an answered call writes nothing');
select ok(not public.log_missed_transfer('p_tm_c5'), 'c15 no lead to be found writes nothing');
select ok(public.log_missed_transfer('p_tm_c6'), 'c16 a call with no lead_id finds its lead by phone');
select is((select lead_id from public.help_calls where call_sid = 'p_tm_c6'), 'f2080000-0000-4000-8000-0000000000d6'::uuid, 'c17 and links it');
select is((select transfer_status from public.leads where id = 'f2080000-0000-4000-8000-0000000000d6'), 'dropped', 'c18 and drops the lead''s transfer, since markLead had no lead to act on');

-- The call itself: only lead_id on c6, and every status and outcome as it was.
select is((select count(*) from public.help_calls h join p_tm_before b using (id)
            where (h.status, h.outcome, h.transferred_at, h.end_reason, h.agent_call_sid)
                  is distinct from (b.status, b.outcome, b.transferred_at, b.end_reason, b.agent_call_sid)), 0::bigint,
          'c19 no status, outcome, transferred_at, end_reason or agent leg changed on any call');

-- ── d. The helper, on fixed times (2030-01-07 is a Monday) ──────────────────
insert into public.agent_working_hours (agent_id, weekday, start_time, end_time)
values ('f2080000-0000-4000-8000-00000000000c', 1, '09:00', '17:00');

select is((select array_agg(s order by s) from public.agents_slots_in_hours('f2080000-0000-4000-8000-00000000000c',
             array['2030-01-07 14:59+00', '2030-01-07 15:00+00', '2030-01-07 22:59+00', '2030-01-07 23:00+00', '2030-01-07 03:00+00', '2030-01-08 15:00+00']::timestamptz[]) s),
          array['2030-01-07 15:00+00', '2030-01-07 22:59+00']::timestamptz[],
          'd1 only the slots inside hours, in the agent''s zone: end exclusive, and 03:00 UTC is still Sunday in Chicago');
update public.profiles set timezone = 'Foo3' where id = 'f2080000-0000-4000-8000-00000000000c';
select is((select count(*) from public.agents_slots_in_hours('f2080000-0000-4000-8000-00000000000c', array['2030-01-07 15:00+00']::timestamptz[])), 0::bigint,
          'd2 an unknown zone is no slots, not an error');
update public.profiles set timezone = 'America/Chicago' where id = 'f2080000-0000-4000-8000-00000000000c';

-- ── e. va_next_open_slot (d3 and d1 were missed by A) ───────────────────────
create or replace function pg_temp.step(n int) returns timestamptz language sql stable as $$
  select date_bin('15 minutes', now(), timestamptz 'epoch') + (n * interval '15 minutes')
$$;
create or replace function pg_temp.next_slot() returns timestamptz language plpgsql as $$
declare v timestamptz;
begin
  perform set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
  set local role authenticated;
  v := public.va_next_open_slot('f2080000-0000-4000-8000-0000000000d3');
  reset role;
  return v;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.va_next_open_slot('f2080000-0000-4000-8000-0000000000d3') $$, '42501', 'Only Fulfillment can see open slots',
                 'e1 an agent cannot call va_next_open_slot');
select throws_ok($$ select public.va_agent_in_hours('f2080000-0000-4000-8000-00000000000b', now()) $$, '42501', 'Only Fulfillment can check an agent''s hours',
                 'e2 an agent cannot probe another agent''s hours');
reset role;

select is(pg_temp.next_slot(), null::timestamptz, 'e3 no hours set: no slot');

insert into public.agent_working_hours (agent_id, weekday, start_time, end_time)
select 'f2080000-0000-4000-8000-00000000000a', d, '00:00', '24:00' from generate_series(1, 7) d;
select is(pg_temp.next_slot(), pg_temp.step(1), 'e4 open all day: the first quarter hour after now');

insert into public.policies (agent_id, status, client_first_name, client_last_name, fulfillment_assigned, fulfillment_stage, scheduled_call_at, pending_underwriting)
values ('f2080000-0000-4000-8000-00000000000a', 'Submitted', 'Taken', 'Slot', true, 'Pending', pg_temp.step(1), false);
select is(pg_temp.next_slot(), pg_temp.step(2), 'e5 a booked slot is skipped');
update public.policies set fulfillment_stage = 'Complete' where client_first_name = 'Taken' and client_last_name = 'Slot';
select is(pg_temp.next_slot(), pg_temp.step(1), 'e6 a finished booking frees its slot');

-- Hours opening at step 3: the local weekday and time, so it holds across midnight.
delete from public.agent_working_hours where agent_id = 'f2080000-0000-4000-8000-00000000000a';
insert into public.agent_working_hours (agent_id, weekday, start_time, end_time)
values ('f2080000-0000-4000-8000-00000000000a', extract(isodow from pg_temp.step(3) at time zone 'UTC'), (pg_temp.step(3) at time zone 'UTC')::time, '24:00');
select is(pg_temp.next_slot(), pg_temp.step(3), 'e7 slots before the hours open are skipped');

-- Hours opening past the 60 minutes: nothing.
delete from public.agent_working_hours where agent_id = 'f2080000-0000-4000-8000-00000000000a';
insert into public.agent_working_hours (agent_id, weekday, start_time, end_time)
values ('f2080000-0000-4000-8000-00000000000a', extract(isodow from pg_temp.step(6) at time zone 'UTC'), (pg_temp.step(6) at time zone 'UTC')::time, '24:00');
select is(pg_temp.next_slot(), null::timestamptz, 'e8 nothing past the next hour');

-- ── f. Missed leads reach the desk and can be taken ─────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select is((select array_agg(right(lead_id::text, 2) order by lead_id) from public.va_missed_leads()), array['d3', 'd6'],
          'f1 the list holds d3 and d6; d1 is out while its transfer still reads requested');
select is((select agent_id from public.va_missed_leads() where lead_id = 'f2080000-0000-4000-8000-0000000000d3'),
          'f2080000-0000-4000-8000-00000000000a'::uuid, 'f2 with the agent who missed it');
select ok(public.va_claim('f2080000-0000-4000-8000-0000000000d3') > now(), 'f3 a missed lead reading transferred can be taken');
reset role;

-- ── g. va_set_lead_outcome and working hours ────────────────────────────────
insert into public.policies (id, agent_id, status, client_first_name, client_last_name, fulfillment_assigned, fulfillment_stage, scheduled_call_at, pending_underwriting)
values
  ('f2080000-0000-4000-8000-0000000000a1', 'f2080000-0000-4000-8000-00000000000c', 'Submitted', 'In',  'Hours', true, 'Pending', '2030-01-07 15:00+00', false),
  ('f2080000-0000-4000-8000-0000000000a2', 'f2080000-0000-4000-8000-00000000000c', 'Submitted', 'Out', 'Hours', true, 'Pending', '2030-01-07 23:00+00', false),
  ('f2080000-0000-4000-8000-0000000000a3', 'f2080000-0000-4000-8000-00000000000b', 'Submitted', 'No',  'Hours', true, 'Pending', '2030-01-07 15:00+00', false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2080000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select public.va_claim('f2080000-0000-4000-8000-0000000000d5');
select throws_ok($$ select public.va_set_lead_outcome('f2080000-0000-4000-8000-0000000000d5', 'f2080000-0000-4000-8000-00000000000c', 'booked', null, 'f2080000-0000-4000-8000-0000000000a2') $$,
                 '22023', 'That''s outside this agent''s working hours. Pick another time.', 'g1 a booking outside the agent''s hours is refused');
select throws_ok($$ select public.va_set_lead_outcome('f2080000-0000-4000-8000-0000000000d5', 'f2080000-0000-4000-8000-00000000000b', 'booked', null, 'f2080000-0000-4000-8000-0000000000a3') $$,
                 '22023', 'This agent hasn''t set working hours yet, so nothing can be booked with them.', 'g2 an agent with no hours says so');
select lives_ok($$ select public.va_set_lead_outcome('f2080000-0000-4000-8000-0000000000d5', 'f2080000-0000-4000-8000-00000000000c', 'booked', null, 'f2080000-0000-4000-8000-0000000000a1') $$,
                'g3 a booking inside the agent''s hours saves');
select is((select va_outcome || ':' || right(booking_id::text, 2) from public.leads where id = 'f2080000-0000-4000-8000-0000000000d5'), 'booked:a1', 'g4 on the lead');
select ok(public.va_agent_in_hours('f2080000-0000-4000-8000-00000000000c', '2030-01-07 15:00+00')
          and not public.va_agent_in_hours('f2080000-0000-4000-8000-00000000000c', '2030-01-07 23:00+00'),
          'g5 the desk''s check before it writes agrees');
reset role;

select * from finish();
rollback;
