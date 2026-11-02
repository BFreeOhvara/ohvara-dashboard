-- p_appt_retry_rebook — pgTAP checks for 213_appointment_retry_rebook.sql: the VA retry
-- schedule, the no-show rebook and its cap, the agent's working hours, the stop trigger,
-- and proof that lead-workflow-sms's text steps are untouched and nothing is sent.
--
-- RUN: `npm run test:sql -- supabase/tests/p_appt_retry_rebook.sql` (local PGlite) or
-- `supabase test db` on a LOCAL stack only. Everything runs in one transaction that is
-- rolled back. Never run it against Ohvara's live database.
--
-- It passes on ANY day. now() is frozen inside the transaction, so a step comes due by
-- backdating its at as the owner. Clock times are asserted only from direct
-- lead_next_rebook_slot calls with a fixed p_from. A now()-based no-show asserts only what
-- holds every day: at >= now + notice, inside the agent's hours, and moved = (at > now +
-- rebook_within_minutes).
--
-- Cast: agent A (America/Chicago, Mon-Fri 09:00-17:00), agent N (active, no hours), agent
-- B (hours but a bad time zone), agent E (America/Chicago, Sunday 20:00-23:30: A's hours
-- never cross midnight UTC, so only E can tell a local weekday from a UTC one), agent O
-- (no link to any lead), VAs V1 and V2.

begin;
create extension if not exists pgtap with schema extensions;
select plan(224);

-- ── helpers ─────────────────────────────────────────────────────────────────
-- Ids come from a name, so a helper needs no table the signed-in roles can't read.
create function public.p_arr_user(p text) returns uuid language sql immutable as $f$
  select md5('p_arr_user:' || p)::uuid
$f$;
create function public.p_arr_lead(p text) returns uuid language sql immutable as $f$
  select md5('p_arr_lead:' || p)::uuid
$f$;

-- Sign in by set_config: 'owner', 'anon' or a cast name.
create function public.p_arr_as(p_who text) returns void language plpgsql as $f$
begin
  if p_who = 'owner' then
    perform set_config('request.jwt.claims', '', true), set_config('role', 'none', true);
  elsif p_who = 'anon' then
    perform set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', public.p_arr_user(p_who), 'role', 'authenticated')::text, true),
            set_config('role', 'authenticated', true);
  end if;
end
$f$;

create temp sequence p_arr_phone;
create function public.p_arr_new(p_name text, p_type text default 'mortgage_protection', p_assigned text default null,
                                 p_transfer text default null, p_va_outcome text default null, p_stage text default null)
returns void language sql as $f$
  insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, assigned_rep_id,
                            transfer_agent_id, va_outcome, va_last_worked_at, inbound_stage, created_at)
  values (public.p_arr_lead(p_name), 'Quimby Works', 'Zebedee Quimby',
          '+1512555' || lpad(nextval('p_arr_phone')::text, 4, '0'), 'TX', p_type, 'google',
          public.p_arr_user(p_assigned), public.p_arr_user(p_transfer), p_va_outcome,
          case when p_va_outcome is not null then now() end, p_stage, now() - interval '3 days')
$f$;

-- Step rows for a lead, as step:cycle:seq in one state. Read as the owner.
create function public.p_arr_steps(p_lead text, p_state text default 'scheduled') returns text language sql as $f$
  select string_agg((e.detail ->> 'va_step') || ':' || coalesce(e.detail ->> 'va_cycle', '-') || ':' || (e.detail ->> 'va_seq'), ','
                    order by (e.detail ->> 'va_cycle')::int nulls first, e.detail ->> 'va_step', (e.detail ->> 'va_seq')::int)
    from public.inbound_events e
   where e.lead_id = public.p_arr_lead(p_lead) and e.state = p_state and e.detail ? 'va_step'
$f$;

-- Everything about a lead's VA rows, or its lead row, in one hash. Read as the owner.
create function public.p_arr_va_md5(p_lead text) returns text language sql as $f$
  select md5(coalesce(string_agg(e::text, '|' order by e.id), ''))
    from public.inbound_events e
   where e.lead_id = public.p_arr_lead(p_lead) and (e.detail ? 'va_step' or e.kind = 'no_show')
$f$;
create function public.p_arr_lead_md5(p_lead text) returns text language sql as $f$
  select md5(l::text) from public.leads l where l.id = public.p_arr_lead(p_lead)
$f$;

-- Bring a lead's scheduled VA steps due. Owner only.
create function public.p_arr_due(p_lead text, p_step text default '%') returns void language sql as $f$
  update public.inbound_events e
     set at = now() - interval '1 minute'
   where e.lead_id = public.p_arr_lead(p_lead) and e.state = 'scheduled' and e.detail ->> 'va_step' like p_step
$f$;

-- Give a lead to a VA with no step due, which is what a double tap looks like. Owner only.
create function public.p_arr_hold(p_lead text, p_va text default 'V1') returns void language sql as $f$
  update public.leads
     set va_claimed_by = public.p_arr_user(p_va), va_claim_expires_at = now() + interval '15 minutes'
   where id = public.p_arr_lead(p_lead)
$f$;

-- The bucket the signed-in VA's queue shows this lead in; null when it isn't there.
create function public.p_arr_bucket(p_lead text) returns text language sql as $f$
  select q.bucket from public.va_queue() q where q.lead_id = public.p_arr_lead(p_lead)
$f$;

-- What the desk does: claim, then record the outcome. As the signed-in VA.
create function public.p_arr_work(p_lead text, p_outcome text, p_agent text default null, p_callback timestamptz default null)
returns void language plpgsql as $f$
begin
  perform public.va_claim(public.p_arr_lead(p_lead));
  perform public.va_set_lead_outcome(public.p_arr_lead(p_lead), public.p_arr_user(p_agent), p_outcome, p_callback);
end
$f$;

create function public.p_arr_no_show(p_lead text) returns jsonb language sql as $f$
  select public.lead_mark_no_show(public.p_arr_lead(p_lead))
$f$;

-- What holds on any day for a rebook with an auto time. Owner only.
create function public.p_arr_rebook_facts(p_lead text, p_agent text, p_seq int default 1) returns text language sql as $f$
  select 'notice:' || (e.at >= now() + make_interval(mins => (c.s ->> 'rebook_notice_minutes')::int))
      || ' hours:' || public.agent_in_working_hours(public.p_arr_user(p_agent), e.at)
      || ' moved:' || (((e.detail ->> 'moved')::boolean) = (e.at > now() + make_interval(mins => (c.s ->> 'rebook_within_minutes')::int)))
      || ' agent:' || (e.agent_id = public.p_arr_user(p_agent))
      || ' same_at:' || ((e.detail ->> 'rebook_at')::timestamptz = e.at)
    from public.inbound_events e,
         (select appt_followup_settings as s from public.app_settings where id = 1) c
   where e.lead_id = public.p_arr_lead(p_lead) and e.detail ->> 'va_step' = 'rebook'
     and (e.detail ->> 'va_seq')::int = p_seq
$f$;

grant execute on function public.p_arr_user(text), public.p_arr_lead(text), public.p_arr_as(text) to anon, authenticated;
grant execute on function public.p_arr_bucket(text), public.p_arr_work(text, text, text, timestamptz), public.p_arr_no_show(text) to authenticated;

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', public.p_arr_user(u.n), 'authenticated', 'authenticated',
       'p_arr_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Yolanda Xavier ' || u.n), now(), now()
  from (values ('A', 'agent'), ('N', 'agent'), ('B', 'agent'), ('E', 'agent'), ('O', 'agent'),
               ('V1', 'fulfillment'), ('V2', 'fulfillment')) as u(n, role);
update public.profiles set is_active = true where id in (select public.p_arr_user(n) from unnest(array['A','N','B','E','O','V1','V2']) n);
update public.profiles set timezone = 'America/Chicago' where id in (public.p_arr_user('A'), public.p_arr_user('E'), public.p_arr_user('N'));
update public.profiles set timezone = 'Not/AZone' where id = public.p_arr_user('B');

insert into public.agent_working_hours (agent_id, weekday, start_time, end_time)
select public.p_arr_user('A'), d, '09:00'::time, '17:00'::time from generate_series(1, 5) d
union all
select public.p_arr_user('B'), d, '09:00'::time, '17:00'::time from generate_series(1, 5) d
union all
select public.p_arr_user('E'), 7, '20:00'::time, '23:30'::time;

select public.p_arr_new(n) from unnest(array['retry', 'retry_all', 'retry_cfg', 'cycle', 'text']) n;
select public.p_arr_new('text_only');
select public.p_arr_new('help', 'policy_help');
select public.p_arr_new('other_rebook', 'mortgage_protection', 'A');
-- Desk: one assigned, one VA-booked, one with both set (the transfer agent wins).
select public.p_arr_new('desk_assigned', 'mortgage_protection', 'A', null, null, 'booked');
select public.p_arr_new('desk_booked', 'mortgage_protection', null, 'A', 'booked');
select public.p_arr_new('desk_both', 'mortgage_protection', 'N', 'A', 'booked');
select public.p_arr_new('callback', 'mortgage_protection', null, null, 'not_reached', 'contacting');
-- Stop.
select public.p_arr_new('stop_booked', 'mortgage_protection', null, null, 'not_reached', 'contacting');
select public.p_arr_new('stop_transfer', 'mortgage_protection', null, null, 'not_reached', 'contacting');
select public.p_arr_new('stop_sold', 'mortgage_protection', 'A', null, 'not_reached', 'contacting');
select public.p_arr_new('stop_not_interested', 'mortgage_protection', 'A', null, 'not_reached', 'contacting');
select public.p_arr_new('stop_follow_up', 'mortgage_protection', 'A', null, 'not_reached', 'contacting');
select public.p_arr_new('same_rebook', 'mortgage_protection', 'A', null, null, 'booked');
select public.p_arr_new('same_already', 'mortgage_protection', 'A', null, 'booked', 'booked');
select public.p_arr_new('stage_booked', 'mortgage_protection', 'A', null, 'not_reached', 'contacting');
select public.p_arr_new('cancel', 'cancellation');
select public.p_arr_new('help_stop', 'policy_help');
-- No-show.
select public.p_arr_new('ns_va', 'mortgage_protection', null, 'A', 'booked');
select public.p_arr_new('ns_agent', 'mortgage_protection', 'A', null, null, 'booked');
select public.p_arr_new('ns_two_a', 'mortgage_protection', 'A', null, null, 'booked');
select public.p_arr_new('ns_two_b', 'mortgage_protection', 'A', null, null, 'booked');
select public.p_arr_new('ns_sold', 'mortgage_protection', 'A', null, null, 'sold');
select public.p_arr_new('ns_help', 'policy_help', 'A', null, 'booked', 'booked');
select public.p_arr_new('no_hours', 'mortgage_protection', 'N', null, null, 'booked');
select public.p_arr_new('bad_zone', 'mortgage_protection', 'B', null, null, 'booked');

-- Text steps as lead-workflow-sms writes them: scheduled (one past due, one future), done, skipped.
insert into public.inbound_events (lead_id, kind, state, at, label, detail, actor_name, actor_role)
select public.p_arr_lead(t.lead), t.kind, t.state, t.at, t.label, t.detail, 'Ohvara', 'system'
  from (values
    ('text', 'text_sent', 'done', now() - interval '2 hours', 'Welcome text',
     '{"step":"instant","seq":1,"summary":"Thanks them and says a call is coming.","twilio_sid":"SMp_arr"}'::jsonb),
    ('text', 'text_sent', 'skipped', now() - interval '1 hour', 'Follow-up text, same day',
     '{"step":"not_reached_d0","seq":1,"reason":"sms_off","summary":"Not sent: texting is off."}'::jsonb),
    ('text', 'text_sent', 'scheduled', now() - interval '1 minute', 'Follow-up text, day 1',
     '{"step":"not_reached_d1","seq":1,"summary":"Asks when a quick call works."}'::jsonb),
    ('text', 'text_sent', 'scheduled', now() + interval '3 days', 'Follow-up text, day 3',
     '{"step":"not_reached_d3","seq":1,"summary":"Asks for a day and time that works."}'::jsonb),
    ('text', 'reminder', 'scheduled', now() + interval '1 day', 'Reminder text',
     '{"step":"reminder_day_before","seq":1,"summary":"The day before the appointment."}'::jsonb),
    ('text_only', 'text_sent', 'scheduled', now() + interval '1 day', 'Follow-up text, day 1',
     '{"step":"not_reached_d1","seq":1,"summary":"Asks when a quick call works."}'::jsonb)
  ) as t(lead, kind, state, at, label, detail);

create temp table p_arr_text_before as
select md5(string_agg(e::text, '|' order by e.id)) as hash, count(*) as n
  from public.inbound_events e
 where e.lead_id = public.p_arr_lead('text') and e.detail ? 'step';

-- ── a. Switches, grants and defaults ────────────────────────────────────────
select is((select sms_live from public.recovery_config), false, 'a1 sms_live is off at the start');
select is((select voice_live from public.recovery_config), false, 'a2 voice_live is off at the start');
select is((select appt_followup_settings from public.app_settings where id = 1),
          '{"retry_days":[0,1,3,7],"day0_delay_minutes":240,"monthly_days":30,"rebook_within_minutes":60,"rebook_notice_minutes":30,"rebook_max":2,"slot_minutes":30,"slot_search_days":21}'::jsonb,
          'a3 the settings hold the agreed default timings');

select ok(not has_function_privilege('anon', 'public.lead_plan_retry_steps(uuid)', 'execute'), 'a4 anon has no execute on lead_plan_retry_steps');
select ok(not has_function_privilege('authenticated', 'public.lead_plan_retry_steps(uuid)', 'execute'), 'a5 authenticated has no execute on lead_plan_retry_steps');
select ok(not has_function_privilege('anon', 'public.lead_next_rebook_slot(uuid, timestamptz)', 'execute'), 'a6 anon has no execute on lead_next_rebook_slot');
select ok(not has_function_privilege('authenticated', 'public.lead_next_rebook_slot(uuid, timestamptz)', 'execute'), 'a7 authenticated has no execute on lead_next_rebook_slot');
select ok(not has_function_privilege('anon', 'public.leads_stop_followup_steps()', 'execute'), 'a8 anon has no execute on the stop trigger function');
select ok(not has_function_privilege('authenticated', 'public.leads_stop_followup_steps()', 'execute'), 'a9 authenticated has no execute on the stop trigger function');
select ok(not has_function_privilege('anon', 'public.lead_mark_no_show(uuid)', 'execute'), 'a10 anon has no execute on lead_mark_no_show');
select ok(has_function_privilege('authenticated', 'public.lead_mark_no_show(uuid)', 'execute'), 'a11 authenticated can call lead_mark_no_show (it checks the caller)');
select is((select prosecdef from pg_proc where oid = 'public.leads_stop_followup_steps()'::regprocedure), true,
          'a12 the stop trigger function is security definer');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('lead_plan_retry_steps', 'lead_next_rebook_slot', 'lead_mark_no_show', 'leads_stop_followup_steps')
      and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  array['lead_mark_no_show', 'lead_next_rebook_slot', 'lead_plan_retry_steps', 'leads_stop_followup_steps'],
  'a13 the four functions are security definer with search_path set');

select public.p_arr_as('V1');
select throws_ok(format($$ select public.lead_plan_retry_steps(%L) $$, public.p_arr_lead('retry')), '42501',
                 'permission denied for function lead_plan_retry_steps', 'a14 a VA cannot call lead_plan_retry_steps');
select throws_ok(format($$ select public.lead_next_rebook_slot(%L, now()) $$, public.p_arr_user('A')), '42501',
                 'permission denied for function lead_next_rebook_slot', 'a15 a VA cannot call lead_next_rebook_slot');
select public.p_arr_as('owner');

-- ── b. Slots: exact instants, fixed p_from, as the owner ────────────────────
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-28 15:10+00'), '2026-10-28 16:00+00'::timestamptz,
          'b1 Wed 10:10 AM CDT gives 11:00 AM (30 minutes notice, then the next half hour)');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-30 21:45+00'), '2026-11-02 15:00+00'::timestamptz,
          'b2 Fri 4:45 PM CDT gives Mon 9:00 AM CST, across the weekend and the daylight saving change');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-11-02 05:00+00'), '2026-11-02 15:00+00'::timestamptz,
          'b3 Sunday 11 PM CST, already Monday in UTC, gives Monday 9:00 AM CST, not a UTC clock time');
select is(public.lead_next_rebook_slot(public.p_arr_user('E'), '2026-11-02 03:30+00'), '2026-11-02 04:00+00'::timestamptz,
          'b4 Sunday 9:30 PM CST, already Monday in UTC, is inside E''s Sunday hours: the weekday is the local one');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-30 17:20+00'), '2026-10-30 18:00+00'::timestamptz,
          'b5 Fri 12:20 PM CDT gives 1:00 PM: notice lands at 12:50 and 12:50 is off the half-hour grid');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), null), null::timestamptz, 'b6 no p_from gives null');
select is(public.lead_next_rebook_slot(null, '2026-10-28 15:10+00'), null::timestamptz, 'b7 no agent gives null');

-- A fixed date trips 187's booking trigger once it passes (187:384), and
-- replaced_old_policy = false can't hold a scheduled_call_at (187:212). Off for the seed only.
alter table public.policies disable trigger policies_booking_rules;
insert into public.policies (agent_id, client_first_name, client_last_name, status, effective_date,
                             fulfillment_assigned, fulfillment_stage, scheduled_call_at)
values (public.p_arr_user('A'), 'Case', 'Complete', 'In Effect', current_date - 40, true, 'Complete', '2026-11-02 15:00+00');
alter table public.policies enable trigger policies_booking_rules;
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-30 21:45+00'), '2026-11-02 15:00+00'::timestamptz,
          'b8 a Complete booking does not block its slot');

alter table public.policies disable trigger policies_booking_rules;
insert into public.policies (agent_id, client_first_name, client_last_name, status, effective_date,
                             fulfillment_assigned, fulfillment_stage, scheduled_call_at)
values (public.p_arr_user('A'), 'Case', 'Monday', 'In Effect', current_date - 40, true, 'Pending', '2026-11-02 15:00+00'),
       (public.p_arr_user('A'), 'Case', 'Wednesday', 'In Effect', current_date - 40, true, 'Pending', '2026-10-28 16:10+00'),
       (public.p_arr_user('O'), 'Case', 'Other agent', 'In Effect', current_date - 40, true, 'Pending', '2026-10-29 16:00+00');
alter table public.policies enable trigger policies_booking_rules;
select is((select count(*) from pg_trigger
            where tgrelid = 'public.policies'::regclass and tgname = 'policies_booking_rules' and tgenabled = 'O'),
          1::bigint, 'b9 the booking trigger is back on after the seed');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-30 21:45+00'), '2026-11-02 15:30+00'::timestamptz,
          'b10 a booking on Monday 15:00Z moves the slot to 15:30Z');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-28 15:10+00'), '2026-10-28 17:00+00'::timestamptz,
          'b11 a booking at 16:10Z gives 17:00Z: 16:00Z and 16:30Z are each under 30 minutes away');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-29 15:10+00'), '2026-10-29 16:00+00'::timestamptz,
          'b12 another agent''s booking at the same time blocks nothing');

insert into public.inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role)
values (public.p_arr_lead('other_rebook'), public.p_arr_user('A'), 'follow_up', 'scheduled', '2026-10-29 16:00+00', 'VA calls to rebook',
        '{"va_step":"rebook","va_seq":1,"summary":"Our VA will call them to set a new time."}'::jsonb, 'Ohvara', 'system');
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-29 15:10+00'), '2026-10-29 16:30+00'::timestamptz,
          'b13 a second lead''s scheduled rebook on a slot pushes the next lead off it');
update public.inbound_events set state = 'skipped'
 where lead_id = public.p_arr_lead('other_rebook') and detail ->> 'va_step' = 'rebook';
select is(public.lead_next_rebook_slot(public.p_arr_user('A'), '2026-10-29 15:10+00'), '2026-10-29 16:00+00'::timestamptz,
          'b14 a skipped rebook holds no slot');

select is(public.lead_next_rebook_slot(public.p_arr_user('N'), '2026-10-28 15:10+00'), null::timestamptz, 'b15 no working hours gives null');
select is(public.lead_next_rebook_slot(public.p_arr_user('B'), '2026-10-28 15:10+00'), null::timestamptz, 'b16 a bad time zone gives null');

-- Row counts of every table that can hold an outbound message, after the seed and before
-- any step or no-show runs.
create temp table p_arr_before as
select (select count(*) from public.notification_emails)    as emails,
       (select count(*) from public.notification_pushes)    as pushes,
       (select count(*) from public.recovery_sms_log)       as sms,
       (select count(*) from public.lead_followup_sms_log)  as followup_sms,
       (select count(*) from public.calls)                  as calls,
       (select count(*) from public.help_calls)             as help_calls,
       (select count(*) from net.http_request_queue)        as http,
       (select count(*) from public.inbound_events where kind in ('text_sent', 'reminder')) as texts;

-- ── c. Retry: the schedule, the timings and the repeat ──────────────────────
select public.p_arr_as('V1');
select is(public.p_arr_bucket('retry'), 'new', 'c1 a new lead is on the desk as new');
select lives_ok($$ select public.p_arr_work('retry', 'not_reached') $$, 'c2 a VA records not reached with sms_live off');
select is(public.p_arr_bucket('retry'), null, 'c3 right after not reached the lead does not bounce back onto the desk');
select throws_ok(format($$ select public.va_claim(%L) $$, public.p_arr_lead('retry')), '22023', 'This lead is not in the queue',
                 'c4 and it cannot be claimed');
select public.p_arr_as('V2');
select is(public.p_arr_bucket('retry'), null, 'c5 the other VA does not see it either');
select public.p_arr_as('owner');

select is(public.p_arr_steps('retry'), 'retry_d0:1:1,retry_d1:1:1,retry_d3:1:1,retry_d7:1:1,retry_monthly:1:1',
          'c6 not reached makes one cycle: day 0, 1, 3, 7 and monthly');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_d0'),
          now() + interval '240 minutes', 'c7 day 0 is exactly now + 240 minutes');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_d1'),
          now() + make_interval(days => 1), 'c8 day 1 is exactly now + 1 day');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_d3'),
          now() + make_interval(days => 3), 'c9 day 3 is exactly now + 3 days');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_d7'),
          now() + make_interval(days => 7), 'c10 day 7 is exactly now + 7 days');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_monthly'),
          now() + make_interval(days => 30), 'c11 monthly is exactly now + monthly_days');
select is((select count(*) from public.inbound_events
            where lead_id = public.p_arr_lead('retry') and detail ? 'va_step'
              and kind = 'follow_up' and not detail ? 'step' and actor_name = 'Ohvara' and actor_role = 'system'),
          5::bigint, 'c12 all five are kind follow_up with no step key, written by Ohvara');
select is((select va_outcome || ':' || va_attempts from public.leads where id = public.p_arr_lead('retry')), 'not_reached:1',
          'c13 the lead is not reached with one attempt');

-- A second Not reached, with no step due, adds nothing and shifts nothing.
create temp table p_arr_hash (name text primary key, hash text);
insert into p_arr_hash values ('retry', public.p_arr_va_md5('retry'));
select public.p_arr_hold('retry');
select public.p_arr_as('V1');
select lives_ok(format($$ select public.va_set_lead_outcome(%L, null, 'not_reached') $$, public.p_arr_lead('retry')),
                'c14 a second not reached runs');
select public.p_arr_as('owner');
select is(public.p_arr_va_md5('retry'), (select hash from p_arr_hash where name = 'retry'),
          'c15 and adds no row and shifts no time');

-- Working the steps in turn. A due step puts the lead back; working it skips it.
select public.p_arr_due('retry', 'retry_d0');
select public.p_arr_as('V1');
select is(public.p_arr_bucket('retry'), 'not_reached', 'c16 a due step brings the lead back, bucket not_reached');
select lives_ok($$ select public.p_arr_work('retry', 'not_reached') $$, 'c17 the VA works it, not reached again');
select public.p_arr_as('owner');
select is(public.p_arr_steps('retry'), 'retry_d1:1:1,retry_d3:1:1,retry_d7:1:1,retry_monthly:1:1', 'c18 the used step left, the rest are unchanged');
select is((select state || ':' || (detail ->> 'ended') from public.inbound_events
            where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_d0'),
          'skipped:worked', 'c19 the used step is skipped as worked');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_d1'),
          now() + make_interval(days => 1), 'c20 the next step did not move');

select public.p_arr_due('retry', 'retry\_d%');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('retry', 'not_reached') $$, 'c21 the VA works days 1, 3 and 7');
select public.p_arr_as('owner');
select is(public.p_arr_steps('retry'), 'retry_monthly:1:1', 'c22 only the monthly is left');

-- Consuming the monthly. Days 0-7 go first, as they do in real time: 213 makes the next
-- monthly only when none of them is still scheduled.
select public.p_arr_due('retry', 'retry_monthly');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('retry', 'not_reached') $$, 'c23 the VA works the monthly');
select public.p_arr_as('owner');
select is(public.p_arr_steps('retry'), 'retry_monthly:1:2', 'c24 the used monthly makes seq 2, in the same cycle');
select is((select at from public.inbound_events
            where lead_id = public.p_arr_lead('retry') and state = 'scheduled' and detail ->> 'va_step' = 'retry_monthly'),
          now() + make_interval(days => 30), 'c25 seq 2 is exactly now + monthly_days');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('retry') and detail ->> 'va_step' = 'retry_monthly'),
          2::bigint, 'c26 there are two monthly rows, no duplicate');
update p_arr_hash set hash = public.p_arr_va_md5('retry') where name = 'retry';
select public.p_arr_hold('retry');
select public.p_arr_as('V1');
select lives_ok(format($$ select public.va_set_lead_outcome(%L, null, 'not_reached') $$, public.p_arr_lead('retry')),
                'c27 not reached again with the monthly not due');
select public.p_arr_as('owner');
select is(public.p_arr_va_md5('retry'), (select hash from p_arr_hash where name = 'retry'), 'c28 adds no monthly');

-- A VA away for two months: every step due at once still makes one next monthly and no new cycle.
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('retry_all', 'not_reached') $$, 'c29 a second lead goes not reached');
select public.p_arr_as('owner');
select public.p_arr_due('retry_all');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('retry_all', 'not_reached') $$, 'c30 the VA works all five, due at once');
select public.p_arr_as('owner');
select is(public.p_arr_steps('retry_all'), 'retry_monthly:1:2', 'c31 one next monthly and no new cycle');

-- Timings come from settings.
update p_arr_hash set hash = public.p_arr_va_md5('retry_all') where name = 'retry';
update public.app_settings
   set appt_followup_settings = appt_followup_settings
         || '{"retry_days":[0,2],"day0_delay_minutes":90,"monthly_days":45}'::jsonb
 where id = 1;
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('retry_cfg', 'not_reached') $$, 'c32 not reached with changed settings');
select public.p_arr_as('owner');
select is(public.p_arr_steps('retry_cfg'), 'retry_d0:1:1,retry_d2:1:1,retry_monthly:1:1', 'c33 a new lead gets the days in the settings');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry_cfg') and detail ->> 'va_step' = 'retry_d0'),
          now() + interval '90 minutes', 'c34 day 0 follows day0_delay_minutes');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry_cfg') and detail ->> 'va_step' = 'retry_d2'),
          now() + make_interval(days => 2), 'c35 the new day follows retry_days');
select is((select at from public.inbound_events where lead_id = public.p_arr_lead('retry_cfg') and detail ->> 'va_step' = 'retry_monthly'),
          now() + make_interval(days => 45), 'c36 monthly follows monthly_days');
select is(public.p_arr_va_md5('retry_all'), (select hash from p_arr_hash where name = 'retry'),
          'c37 a settings change does not move steps already made');
update public.app_settings
   set appt_followup_settings = appt_followup_settings
         || '{"retry_days":[0,1,3,7],"day0_delay_minutes":240,"monthly_days":30}'::jsonb
 where id = 1;

-- Other lead types behave as before.
select public.p_arr_as('V1');
select is(public.p_arr_bucket('help'), 'new', 'c38 a policy_help lead is on the desk as new');
select lives_ok($$ select public.p_arr_work('help', 'not_reached') $$, 'c39 a VA records not reached on it');
select is(public.p_arr_bucket('help'), 'not_reached', 'c40 it stays visible, bucket not_reached');
select public.p_arr_as('owner');
select is(public.p_arr_steps('help'), null, 'c41 and has no steps');

-- ── d. Desk: the same path for an assigned lead and a VA-booked lead ────────
create function public.p_arr_desk_checks(p_lead text, p_how text) returns setof text language plpgsql as $f$
declare
  v_lead uuid := public.p_arr_lead(p_lead);
begin
  perform public.p_arr_as('V1');
  return next is(public.p_arr_bucket(p_lead), null, 'd ' || p_how || ': a booked lead is not on the desk');
  return next is(public.p_arr_no_show(p_lead) ->> 'recorded', 'true', 'd ' || p_how || ': the VA records a no-show');
  return next is(public.p_arr_bucket(p_lead), null, 'd ' || p_how || ': with only a future rebook the lead is out of the queue');
  return next throws_ok(format($s$ select public.va_claim(%L) $s$, v_lead), '22023', 'This lead is not in the queue',
                        'd ' || p_how || ': and va_claim refuses it');

  perform public.p_arr_as('owner');
  return next is(public.p_arr_rebook_facts(p_lead, 'A'), 'notice:true hours:true moved:true agent:true same_at:true',
                 'd ' || p_how || ': the rebook is on the agent''s own calendar, with notice and in hours');
  perform public.p_arr_due(p_lead);

  perform public.p_arr_as('V1');
  return next is(public.p_arr_bucket(p_lead), 'not_reached', 'd ' || p_how || ': backdated, it appears, bucket not_reached');
  return next lives_ok(format($s$ select public.va_claim(%L) $s$, v_lead), 'd ' || p_how || ': and can be claimed');
  return next lives_ok(format($s$ select public.va_set_lead_outcome(%L, null, 'not_reached') $s$, v_lead),
                       'd ' || p_how || ': the VA records not reached');
  return next is(public.p_arr_bucket(p_lead), null, 'd ' || p_how || ': and it is gone again');
  return next throws_ok(format($s$ select public.va_claim(%L) $s$, v_lead), '22023', 'This lead is not in the queue',
                        'd ' || p_how || ': and va_claim refuses it again');

  perform public.p_arr_as('owner');
  return next is(public.p_arr_steps(p_lead), 'retry_d0:1:1,retry_d1:1:1,retry_d3:1:1,retry_d7:1:1,retry_monthly:1:1',
                 'd ' || p_how || ': a full retry schedule follows');
  return next is((select count(*) from public.inbound_events e
                   where e.lead_id = v_lead and e.state = 'scheduled' and e.detail ? 'va_step' and e.agent_id = public.p_arr_user('A')),
                 5::bigint, 'd ' || p_how || ': every step belongs to that agent');
  return next is(public.p_arr_steps(p_lead, 'skipped'), 'rebook:-:1', 'd ' || p_how || ': the rebook was used');
end
$f$;

select * from public.p_arr_desk_checks('desk_assigned', 'assigned');
select * from public.p_arr_desk_checks('desk_booked', 'VA-booked');

select public.p_arr_as('V1');
select is(public.p_arr_no_show('desk_both') ->> 'recorded', 'true', 'd1 a no-show on a lead with both agents set');
select public.p_arr_as('owner');
select is(public.p_arr_rebook_facts('desk_both', 'A'), 'notice:true hours:true moved:true agent:true same_at:true',
          'd2 the transfer agent wins: A has the rebook and the slot, not N, who has no hours');
select is((select va_outcome || ':' || inbound_stage from public.leads where id = public.p_arr_lead('desk_both')),
          'not_reached:contacting', 'd3 the no-show moved the lead off booked');

-- A callback keeps today's rule.
select public.lead_plan_retry_steps(public.p_arr_lead('callback'));
select public.p_arr_due('callback', 'retry_d0');
select public.p_arr_as('V1');
select lives_ok(format($$ select public.p_arr_work('callback', 'callback', null, %L) $$, now() + interval '1 day'),
                'd4 the VA reaches the lead and sets a callback for tomorrow');
select is(public.p_arr_bucket('callback'), null, 'd5 a callback not due is hidden');
select public.p_arr_as('owner');
select is(public.p_arr_steps('callback'), 'retry_d1:1:1,retry_d3:1:1,retry_d7:1:1,retry_monthly:1:1', 'd6 the callback used the due step and planned nothing');
select public.p_arr_due('callback', 'retry_d1');
select public.p_arr_as('V1');
select is(public.p_arr_bucket('callback'), null, 'd7 a due step does not pull a callback forward');
select public.p_arr_as('owner');
update public.leads set va_callback_at = now() - interval '1 minute' where id = public.p_arr_lead('callback');
update public.inbound_events set at = now() + interval '1 day'
 where lead_id = public.p_arr_lead('callback') and state = 'scheduled' and detail ->> 'va_step' = 'retry_d1';
select public.p_arr_as('V1');
select is(public.p_arr_bucket('callback'), 'callback_due', 'd8 a future step does not hide a callback that is due, bucket callback_due');
select public.p_arr_as('owner');

-- ── e. Stop ─────────────────────────────────────────────────────────────────
select public.lead_plan_retry_steps(public.p_arr_lead(n))
  from unnest(array['stop_booked', 'stop_transfer', 'stop_sold', 'stop_not_interested', 'stop_follow_up', 'stage_booked']) n;
select public.p_arr_due('stop_booked', 'retry_d0');
select public.p_arr_due('stop_transfer', 'retry_d0');

select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('stop_booked', 'booked', 'A') $$, 'e1 a VA books a lead with steps');
select lives_ok($$ select public.p_arr_work('stop_transfer', 'transferred', 'A') $$, 'e2 a VA transfers a lead with steps');
select public.p_arr_as('A');
select is(public.set_inbound_outcome(public.p_arr_lead('stop_sold'), 'sold'), 'sold', 'e3 the signed-in agent marks a lead sold');
select is(public.set_inbound_outcome(public.p_arr_lead('stop_not_interested'), 'not_interested', null, null, 'Has a policy elsewhere'), 'lost', 'e4 the signed-in agent marks a lead not interested');
select is(public.set_inbound_outcome(public.p_arr_lead('stop_follow_up'), 'follow_up', null, now() + interval '2 days'), 'follow_up', 'e5 the signed-in agent marks a lead follow up');
select public.p_arr_as('owner');

select is(public.p_arr_steps('stop_booked'), null, 'e6 booked leaves no scheduled step');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('stop_booked') and detail ? 'va_step' and state = 'skipped' and detail ->> 'ended' = 'booked'),
          5::bigint, 'e7 all five skipped as booked');
select is(public.p_arr_steps('stop_transfer'), null, 'e8 a transfer leaves no scheduled step');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('stop_transfer') and detail ? 'va_step' and state = 'skipped' and detail ->> 'ended' = 'transferred'),
          5::bigint, 'e9 all five skipped as transferred');
select is(public.p_arr_steps('stop_sold'), null, 'e10 sold leaves no scheduled step');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('stop_sold') and detail ? 'va_step' and state = 'skipped' and detail ->> 'ended' = 'sold'),
          5::bigint, 'e11 all five skipped as sold');
select is(public.p_arr_steps('stop_not_interested'), null, 'e12 not interested leaves no scheduled step');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('stop_not_interested') and detail ? 'va_step' and state = 'skipped' and detail ->> 'ended' = 'not_interested'),
          5::bigint, 'e13 all five skipped as not interested');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('stop_follow_up') and detail ? 'va_step' and state = 'scheduled'),
          5::bigint, 'e14 follow up is not a stop value: all five stay');

-- A step's time passing no longer brings any of them back.
update public.inbound_events set at = now() - interval '1 minute'
 where lead_id in (public.p_arr_lead('stop_booked'), public.p_arr_lead('stop_transfer'),
                   public.p_arr_lead('stop_sold'), public.p_arr_lead('stop_not_interested'))
   and detail ? 'va_step';
select public.p_arr_as('V1');
select is(public.p_arr_bucket('stop_booked'), null, 'e15 a booked lead with a past step stays off the desk');
select is(public.p_arr_bucket('stop_transfer'), null, 'e16 a transferred lead with a past step stays off the desk');
select is(public.p_arr_bucket('stop_sold'), null, 'e17 a sold lead with a past step stays off the desk');
select is(public.p_arr_bucket('stop_not_interested'), null, 'e18 a not-interested lead with a past step stays off the desk');
select throws_ok(format($$ select public.va_claim(%L) $$, public.p_arr_lead('stop_booked')), '22023', 'This lead is not in the queue',
                 'e19 and a stopped lead cannot be claimed');
select is(public.p_arr_no_show('same_rebook') ->> 'rebook_seq', '1', 'e20 a no-show makes a rebook');
select public.p_arr_as('owner');

-- Only a change INTO a stop value counts.
update public.leads set va_outcome = va_outcome, inbound_stage = inbound_stage, outcome = outcome
 where id = public.p_arr_lead('same_rebook');
select is(public.p_arr_steps('same_rebook'), 'rebook:-:1', 'e21 an update that changes no stop column leaves the rebook');
update public.leads set inbound_stage = 'follow_up', va_outcome = 'callback', va_callback_at = now() + interval '1 day'
 where id = public.p_arr_lead('same_rebook');
select is(public.p_arr_steps('same_rebook'), 'rebook:-:1', 'e22 a change into a value that is not a stop leaves the rebook');

insert into public.inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role)
select public.p_arr_lead(n), public.p_arr_user('A'), 'follow_up', 'scheduled', now() + interval '1 day', 'VA calls to rebook',
       '{"va_step":"rebook","va_seq":1,"summary":"Our VA will call them to set a new time."}'::jsonb, 'Ohvara', 'system'
  from unnest(array['same_already', 'cancel', 'help_stop']) n;
update public.leads set inbound_stage = 'contacting' where id = public.p_arr_lead('same_already');
select is(public.p_arr_steps('same_already'), 'rebook:-:1', 'e23 a lead already at va_outcome booked, with that column unchanged, keeps its rebook');
update public.leads set inbound_stage = 'booked' where id = public.p_arr_lead('stage_booked');
select is(public.p_arr_steps('stage_booked'), null, 'e24 inbound_stage changing into booked is a stop too');

update public.leads set va_outcome = 'booked' where id = public.p_arr_lead('cancel');
select is(public.p_arr_steps('cancel'), 'rebook:-:1', 'e25 a cancellation lead update fires nothing');
update public.leads set va_outcome = 'booked' where id = public.p_arr_lead('help_stop');
select is(public.p_arr_steps('help_stop'), 'rebook:-:1', 'e26 a policy_help lead update fires nothing');

-- ── f. Second cycle: the path va_cycle exists for ───────────────────────────
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('cycle', 'not_reached') $$, 'f1 not reached starts cycle 1');
select public.p_arr_as('owner');
select public.p_arr_due('cycle', 'retry_d0');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('cycle', 'booked', 'A') $$, 'f2 booked');
select public.p_arr_as('owner');
select is(public.p_arr_steps('cycle'), null, 'f3 the booking skipped cycle 1');
select public.p_arr_as('V1');
select is(public.p_arr_no_show('cycle') ->> 'rebook_seq', '1', 'f4 the no-show makes rebook 1');
select public.p_arr_as('owner');
select is(public.p_arr_steps('cycle'), 'rebook:-:1', 'f5 only the rebook is scheduled');
select public.p_arr_due('cycle', 'rebook');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('cycle', 'not_reached') $$, 'f6 claim and not reached on the rebook runs with no error');
select is(public.p_arr_bucket('cycle'), null, 'f7 the lead is hidden until a step is due');
select public.p_arr_as('owner');
select is(public.p_arr_steps('cycle'), 'retry_d0:2:1,retry_d1:2:1,retry_d3:2:1,retry_d7:2:1,retry_monthly:2:1', 'f8 a full cycle 2');
select is((select at from public.inbound_events
            where lead_id = public.p_arr_lead('cycle') and state = 'scheduled' and detail ->> 'va_step' = 'retry_d0'),
          now() + interval '240 minutes', 'f9 cycle 2 starts its own day 0');
select is(public.p_arr_steps('cycle', 'skipped'),
          'rebook:-:1,retry_d0:1:1,retry_d1:1:1,retry_d3:1:1,retry_d7:1:1,retry_monthly:1:1',
          'f10 the stopped cycle 1 and the used rebook keep their rows');

insert into p_arr_hash values ('cycle', public.p_arr_va_md5('cycle'));
select public.p_arr_hold('cycle');
select public.p_arr_as('V1');
select lives_ok(format($$ select public.va_set_lead_outcome(%L, null, 'not_reached') $$, public.p_arr_lead('cycle')), 'f11 re-run not reached');
select public.p_arr_as('owner');
select is(public.p_arr_va_md5('cycle'), (select hash from p_arr_hash where name = 'cycle'), 'f12 nothing added and nothing shifted');

select public.p_arr_due('cycle', 'retry_d0');
select public.p_arr_as('V1');
select is(public.p_arr_bucket('cycle'), 'not_reached', 'f13 a due step of cycle 2 brings it back');
select lives_ok($$ select public.p_arr_work('cycle', 'booked', 'A') $$, 'f14 booked again');
select is(public.p_arr_no_show('cycle') ->> 'rebook_seq', '2', 'f15 the second no-show makes rebook 2');
select public.p_arr_as('owner');
select is(public.p_arr_steps('cycle'), 'rebook:-:2', 'f16 only rebook 2 is scheduled');
select public.p_arr_due('cycle', 'rebook');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('cycle', 'booked', 'A') $$, 'f17 booked a third time');
select is(public.p_arr_no_show('cycle'), '{"recorded": true, "rebook_seq": null, "retry_planned": true}'::jsonb,
          'f18 the third no-show makes no rebook and plans retries');
select is(public.p_arr_bucket('cycle'), null, 'f19 the lead is hidden until a step is due');
select public.p_arr_as('owner');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('cycle') and detail ->> 'va_step' = 'rebook'),
          2::bigint, 'f20 rebook rows stay at 2');
select is(public.p_arr_steps('cycle'), 'retry_d0:3:1,retry_d1:3:1,retry_d3:3:1,retry_d7:3:1,retry_monthly:3:1', 'f21 a new cycle 3 exists');
select is((select count(*) from public.inbound_events where lead_id = public.p_arr_lead('cycle') and kind = 'no_show' and state = 'done'),
          3::bigint, 'f22 three no-show rows');

update p_arr_hash set hash = public.p_arr_va_md5('cycle') where name = 'cycle';
insert into p_arr_hash values ('cycle_lead', public.p_arr_lead_md5('cycle'));
select public.p_arr_as('V1');
select is(public.p_arr_no_show('cycle'), '{"recorded": false}'::jsonb, 'f23 re-run lead_mark_no_show is refused quietly');
select public.p_arr_as('owner');
select is(public.p_arr_va_md5('cycle'), (select hash from p_arr_hash where name = 'cycle'), 'f24 nothing added');
select is(public.p_arr_lead_md5('cycle'), (select hash from p_arr_hash where name = 'cycle_lead'), 'f25 the lead did not change');
select public.p_arr_due('cycle', 'retry_d0');
select public.p_arr_as('V1');
select is(public.p_arr_bucket('cycle'), 'not_reached', 'f26 when cycle 3 comes due the lead is back');
select public.p_arr_as('owner');

-- ── g. No-show: who can, and the double tap ─────────────────────────────────
insert into p_arr_hash values ('ns_va_before', public.p_arr_lead_md5('ns_va'));
select public.p_arr_as('anon');
select throws_ok(format($$ select public.lead_mark_no_show(%L) $$, public.p_arr_lead('ns_va')), '42501',
                 'permission denied for function lead_mark_no_show', 'g1 anon is refused');
select public.p_arr_as('O');
select throws_ok(format($$ select public.lead_mark_no_show(%L) $$, public.p_arr_lead('ns_va')), '42501',
                 'Only the lead''s agent or Fulfillment can do this', 'g2 an unrelated agent is refused');
select throws_ok(format($$ select public.lead_mark_no_show(%L) $$, public.p_arr_lead('ns_agent')), '42501',
                 'Only the lead''s agent or Fulfillment can do this', 'g3 an unrelated agent is refused on an assigned lead too');
select public.p_arr_as('owner');
select is(public.p_arr_lead_md5('ns_va'), (select hash from p_arr_hash where name = 'ns_va_before'), 'g4 the refused calls changed nothing');
select is(public.p_arr_va_md5('ns_va'), md5(''), 'g5 and wrote no row');

select public.p_arr_as('V1');
select is(public.p_arr_no_show('ns_va') ->> 'recorded', 'true', 'g6 the VA can record a no-show');
select public.p_arr_as('A');
select is(public.p_arr_no_show('ns_agent') ->> 'recorded', 'true', 'g7 the lead''s agent can record a no-show');
select public.p_arr_as('owner');
select is((select va_outcome from public.leads where id = public.p_arr_lead('ns_va')), 'not_reached', 'g8 va_outcome is no longer booked');
select is((select inbound_stage from public.leads where id = public.p_arr_lead('ns_agent')), 'contacting', 'g9 inbound_stage is no longer booked');
select is((select kind || ':' || state || ':' || (at = now()) from public.inbound_events
            where lead_id = public.p_arr_lead('ns_agent') and kind = 'no_show'), 'no_show:done:true', 'g10 one no_show row, done, at now');
select is(public.p_arr_rebook_facts('ns_va', 'A'), 'notice:true hours:true moved:true agent:true same_at:true', 'g11 the VA''s no-show: a rebook with notice, in hours');
select is(public.p_arr_rebook_facts('ns_agent', 'A'), 'notice:true hours:true moved:true agent:true same_at:true', 'g12 the agent''s no-show: the same');

insert into p_arr_hash values ('ns_va_events', public.p_arr_va_md5('ns_va')), ('ns_va_lead', public.p_arr_lead_md5('ns_va')),
                              ('ns_agent_events', public.p_arr_va_md5('ns_agent')), ('ns_agent_lead', public.p_arr_lead_md5('ns_agent'));
select public.p_arr_as('V1');
select is(public.p_arr_no_show('ns_va'), '{"recorded": false}'::jsonb, 'g13 a second call with no booking between returns recorded false');
select public.p_arr_as('A');
select is(public.p_arr_no_show('ns_agent'), '{"recorded": false}'::jsonb, 'g14 from the agent too');
select public.p_arr_as('owner');
select is(public.p_arr_va_md5('ns_va'), (select hash from p_arr_hash where name = 'ns_va_events'), 'g15 no second no_show row or rebook');
select is(public.p_arr_lead_md5('ns_va'), (select hash from p_arr_hash where name = 'ns_va_lead'), 'g16 no change to the lead');
select is(public.p_arr_va_md5('ns_agent'), (select hash from p_arr_hash where name = 'ns_agent_events'), 'g17 no second row on the agent''s lead');
select is(public.p_arr_lead_md5('ns_agent'), (select hash from p_arr_hash where name = 'ns_agent_lead'), 'g18 no change to the agent''s lead');

select public.p_arr_due('ns_va', 'rebook');
select public.p_arr_as('V1');
select is(public.p_arr_bucket('ns_va'), 'not_reached', 'g19 the lead reaches the queue once the rebook is due');
select public.p_arr_as('owner');

-- Two no-shows at the same moment, same agent: two slots at least a slot apart.
select public.p_arr_as('A');
select is(public.p_arr_no_show('ns_two_a') ->> 'recorded', 'true', 'g20 a no-show on one lead');
select is(public.p_arr_no_show('ns_two_b') ->> 'recorded', 'true', 'g21 a no-show on another of the same agent''s leads');
select public.p_arr_as('owner');
select ok((select abs(extract(epoch from a.at - b.at)) >= 1800
             from public.inbound_events a, public.inbound_events b
            where a.lead_id = public.p_arr_lead('ns_two_a') and a.detail ->> 'va_step' = 'rebook'
              and b.lead_id = public.p_arr_lead('ns_two_b') and b.detail ->> 'va_step' = 'rebook'),
          'g22 the second lead was pushed off the first one''s slot');

select public.p_arr_as('A');
select is(public.p_arr_no_show('ns_sold'), '{"recorded": false}'::jsonb, 'g23 a sold lead is not a no-show');
select is(public.p_arr_no_show('ns_help'), '{"recorded": false}'::jsonb, 'g24 nor is another lead type');
select public.p_arr_as('owner');
select is((select inbound_stage from public.leads where id = public.p_arr_lead('ns_sold')), 'sold', 'g25 the sold lead keeps its stage');
select is(public.p_arr_steps('ns_help'), null, 'g26 and the other lead type has no steps');

-- ── h. No auto time: no hours, or a bad time zone ───────────────────────────
select public.p_arr_as('V1');
select is(public.p_arr_no_show('no_hours') ->> 'no_auto_time', 'true', 'h1 a no-show for an agent with no hours has no auto time');
select is(public.p_arr_bucket('no_hours'), 'not_reached', 'h2 and is on the desk at once');
select is(public.p_arr_no_show('bad_zone') ->> 'no_auto_time', 'true', 'h3 a no-show for an agent with a bad time zone has no auto time');
select is(public.p_arr_bucket('bad_zone'), 'not_reached', 'h4 and is on the desk at once');
select public.p_arr_as('owner');
select is((select (at = now())::text || ':' || (detail ->> 'no_auto_time') || ':' || (detail ? 'rebook_at') from public.inbound_events
            where lead_id = public.p_arr_lead('no_hours') and detail ->> 'va_step' = 'rebook'), 'true:true:false', 'h5 no hours: at is now, no_auto_time is set, no rebook_at');
select is((select (at = now())::text || ':' || (detail ->> 'no_auto_time') || ':' || (detail ? 'rebook_at') from public.inbound_events
            where lead_id = public.p_arr_lead('bad_zone') and detail ->> 'va_step' = 'rebook'), 'true:true:false', 'h6 a bad time zone: the same');
select is(public.lead_next_rebook_slot(public.p_arr_user('N'), now()), null::timestamptz, 'h7 lead_next_rebook_slot returns null for no hours');
select is(public.lead_next_rebook_slot(public.p_arr_user('B'), now()), null::timestamptz, 'h8 and for a bad time zone');

-- ── i. Text steps stay out of it ────────────────────────────────────────────
select public.p_arr_as('V1');
select is(public.p_arr_bucket('text_only'), 'new', 'i1 a text step alone does not hide a new lead');
select lives_ok($$ select public.p_arr_work('text', 'not_reached') $$, 'i2 not reached on a lead with text steps');
select is(public.p_arr_bucket('text'), null, 'i3 the past-due text step does not put the lead on the desk');
select public.p_arr_as('owner');
select public.p_arr_due('text', 'retry_d0');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('text', 'booked', 'A') $$, 'i4 booked');
select is(public.p_arr_no_show('text') ->> 'recorded', 'true', 'i5 no-show');
select public.p_arr_as('owner');
select public.p_arr_due('text', 'rebook');
select public.p_arr_as('V1');
select lives_ok($$ select public.p_arr_work('text', 'booked', 'A') $$, 'i6 booked again');
select public.p_arr_as('owner');
select is((select md5(string_agg(e::text, '|' order by e.id)) from public.inbound_events e
            where e.lead_id = public.p_arr_lead('text') and e.detail ? 'step'),
          (select hash from p_arr_text_before), 'i7 not reached, no-show and booked left every text row byte-identical');
select is((select count(*) from public.inbound_events e where e.lead_id = public.p_arr_lead('text') and e.detail ? 'step'),
          (select n from p_arr_text_before), 'i8 and added none');
select ok((select count(*) from public.inbound_events e where e.lead_id = public.p_arr_lead('text') and e.detail ? 'va_step') >= 6,
          'i9 the VA rows really were written on that lead');

-- index.ts:83's own filter, every lead in this file.
select is((select count(*) from public.inbound_events where state = 'scheduled' and detail ->> 'step' is not null and detail ? 'va_step'),
          0::bigint, 'i10 lead-workflow-sms''s scan (index.ts:83) returns no VA row');
select is((select count(*) from public.inbound_events where state = 'scheduled' and detail ->> 'step' is not null),
          4::bigint, 'i11 and returns exactly the seeded text rows');
select is((select array_agg(distinct l.lead_id order by l.lead_id) from public.inbound_events l
            where l.state = 'scheduled' and l.detail ->> 'step' is not null),
          (select array_agg(x order by x) from unnest(array[public.p_arr_lead('text'), public.p_arr_lead('text_only')]) x),
          'i12 on the two seeded leads only');
select is((select count(*) from public.inbound_events where detail ? 'va_step' and detail ? 'step'), 0::bigint, 'i13 no VA row has a step key');
select is((select count(*) from public.inbound_events where detail ? 'va_step' and kind in ('booked', 'rebooked', 'text_received')),
          0::bigint, 'i14 no VA row has kind booked, rebooked or text_received');
select is((select count(*) from public.inbound_events where detail ? 'va_step' and kind <> 'follow_up'),
          0::bigint, 'i15 every VA row is kind follow_up');
select ok((select count(*) from public.inbound_events where detail ? 'va_step') > 50, 'i16 those three checks saw the VA rows');

-- ── j. Labels: on the agent's timeline, so plain words and nobody's details ─
select ok((select count(*) from public.inbound_events where kind = 'no_show') >= 10, 'j1 the no_show rows are here to check');
select is((select count(*) from public.inbound_events e
            where (e.detail ? 'va_step' or e.kind = 'no_show')
              and (coalesce(btrim(e.label), '') = '' or coalesce(btrim(e.detail ->> 'summary'), '') = '')),
          0::bigint, 'j2 every VA row and no_show row has a label and a detail.summary');
select is((select count(*) from public.inbound_events e
             join public.leads l on l.id = e.lead_id
             left join public.profiles p on p.id = e.agent_id
            where (e.detail ? 'va_step' or e.kind = 'no_show')
              and (e.label || ' ' || (e.detail ->> 'summary')) ~* ('zebedee|quimby|yolanda|xavier|' || regexp_replace(l.phone, '\D', '', 'g') || '|' || right(l.phone, 7))),
          0::bigint, 'j3 no name or phone number in a label or a summary');
select is((select count(*) from public.inbound_events e
            where (e.detail ? 'va_step' or e.kind = 'no_show')
              and (e.label || ' ' || (e.detail ->> 'summary')) ~ '\d{3}[\s.-]?\d{3}[\s.-]?\d{4}'),
          0::bigint, 'j4 nothing there looks like a phone number');

-- ── k. Nothing sent ─────────────────────────────────────────────────────────
select is(
  (select ((select count(*) from public.notification_emails) - b.emails) || ',' ||
          ((select count(*) from public.notification_pushes) - b.pushes) || ',' ||
          ((select count(*) from public.recovery_sms_log) - b.sms) || ',' ||
          ((select count(*) from public.lead_followup_sms_log) - b.followup_sms) || ',' ||
          ((select count(*) from public.calls) - b.calls) || ',' ||
          ((select count(*) from public.help_calls) - b.help_calls) || ',' ||
          ((select count(*) from net.http_request_queue) - b.http)
     from p_arr_before b),
  '0,0,0,0,0,0,0',
  'k1 every call in this file wrote nothing to the email, push, text or call tables, and queued no http request');
select is((select count(*) from public.inbound_events where kind in ('text_sent', 'reminder')),
          (select texts from p_arr_before), 'k2 and no text_sent or reminder row appeared');
select is(
  (select count(*) from pg_proc p
    where p.oid in ('public.lead_plan_retry_steps(uuid)'::regprocedure, 'public.lead_next_rebook_slot(uuid, timestamptz)'::regprocedure,
                    'public.lead_mark_no_show(uuid)'::regprocedure, 'public.leads_stop_followup_steps()'::regprocedure)
      and p.prosrc ~* '(notification_emails|notification_pushes|recovery_sms_log|net\.http|pg_notify)'),
  0::bigint, 'k3 no new function body mentions an outbound message table, http call or notify');

-- ── l. The step key ─────────────────────────────────────────────────────────
create function public.p_arr_add_step(p_lead text, p_step text, p_cycle int, p_seq int) returns void language sql as $f$
  insert into public.inbound_events (lead_id, kind, state, at, label, detail, actor_name, actor_role)
  values (public.p_arr_lead(p_lead), 'follow_up', 'scheduled', now() + interval '1 day', 'VA calls again',
          jsonb_strip_nulls(jsonb_build_object('va_step', p_step, 'va_cycle', p_cycle, 'va_seq', p_seq, 'summary', 'Our VA will try them again.')),
          'Ohvara', 'system')
$f$;

select is(public.p_arr_steps('retry_cfg'), 'retry_d0:1:1,retry_d2:1:1,retry_monthly:1:1', 'l1 the rows the next checks collide with');
select throws_ok($$ select public.p_arr_add_step('retry_cfg', 'retry_d2', 1, 1) $$, '23505', null,
                 'l2 a duplicate of a scheduled VA step in the same cycle raises 23505');
select throws_ok($$ select public.p_arr_add_step('retry', 'retry_d0', 1, 1) $$, '23505', null,
                 'l3 a duplicate over a skipped row raises 23505');
select throws_ok($$ select public.p_arr_add_step('ns_va', 'rebook', null, 1) $$, '23505', null,
                 'l4 a duplicate rebook, which has no cycle, raises 23505');
select lives_ok($$ select public.p_arr_add_step('retry_cfg', 'retry_d2', 2, 1) $$, 'l5 the same step in a new cycle is allowed');

-- The text index is still its own: a new text step can use a seq a VA row already uses.
select lives_ok($$
  insert into public.inbound_events (lead_id, kind, state, at, label, detail, actor_name, actor_role)
  values (public.p_arr_lead('text'), 'text_sent', 'scheduled', now() + interval '7 days', 'Follow-up text, day 7',
          '{"step":"not_reached_d7","seq":1,"summary":"One more check-in."}'::jsonb, 'Ohvara', 'system')
$$, 'l6 a new text step with the same seq as a VA step still inserts');
select throws_ok($$
  insert into public.inbound_events (lead_id, kind, state, at, label, detail, actor_name, actor_role)
  values (public.p_arr_lead('text'), 'text_sent', 'scheduled', now() + interval '7 days', 'Follow-up text, day 7',
          '{"step":"not_reached_d7","seq":1,"summary":"One more check-in."}'::jsonb, 'Ohvara', 'system')
$$, '23505', null, 'l7 and 184''s own index still refuses a second one');

select is((select sms_live from public.recovery_config), false, 'l8 sms_live is still off at the end');
select is((select voice_live from public.recovery_config), false, 'l9 voice_live is still off at the end');

select * from finish();
rollback;
