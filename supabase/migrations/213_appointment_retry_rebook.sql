-- 213 — Appointment retry steps and no-show rebooks (Booked Appointments on the VA desk).
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked step.
-- Additive: one app_settings column, two indexes, one trigger, five new functions, and
-- three functions replaced, each copied whole from its newest version with its grants
-- re-stated: va_queue from 175, va_claim and va_set_lead_outcome from 211. No table is
-- added. It is all data: nothing here sends a text, email or call, and no switch moves. No
-- screen and no edge function changes. Live Calls (policy_help) and other lead types behave
-- exactly as today: every new behaviour needs lead_type = 'mortgage_protection'.
--
-- Why: an appointment lead nobody reached comes back to the VA desk on a set schedule
-- (day 0, 1, 3, 7, then monthly), and a no-show gets a rebook in the agent's hours, twice
-- at most. Before this, 175's va_queue showed a not_reached lead at once with no schedule
-- and nothing wrote a no-show.
--
-- APPLY ORDER: after 175, 180, 184, 186, 197 and 211. The check below stops the whole file
-- if any of them is missing. 211 counts because its va_claim and va_set_lead_outcome are
-- the versions copied here, and they call its functions.
--
-- ── How VA steps stay apart from lead-workflow-sms ──────────────────────────
-- Both write scheduled rows to inbound_events. These rows stay out of its way:
--   * Steps use detail.va_step, never detail.step. So they miss:
--       leadsWithScheduled and its 2000 cap   lead-workflow-sms/index.ts:82-84
--       isStep in tick and stop               lead-workflow-sms/core.ts:131, 220, 318
--       has() and the cadence check           lead-workflow-sms/core.ts:249, 257
--       inbound_events_step_uidx              184, keyed on detail->>'step'
--   * Steps use kind 'follow_up' only. Never booked or rebooked: core.ts:158 and :171
--     would read them as appointments and stop the texts. Never text_received: core.ts:199
--     would read a reply. scripts/portal-v2-shots.mjs shows a scheduled 'rebooked' row;
--     that is sample data, not a shape to copy.
--   * One deliberate exception: lead_mark_no_show writes one real kind 'no_show', state
--     'done' row with no step key. It is the fact core.ts:290 reads to plan its own rebook
--     text, under its own sms_live gate. Nothing here sends it.
--
-- ── Limits to know about ────────────────────────────────────────────────────
--   (a) The rebook time is a suggestion in the agent's hours only. It does not check the
--       client's 8 AM-8 PM or carrier hours: leads hold no client time zone, and 187:405
--       can refuse a booking at that time, so the VA then picks another.
--   (b) Agents see these rows on their timeline and cards (src/lib/inbounds.js:132, 155),
--       so every row has a plain label and summary with no names or phone numbers.
--   (c) A rebook sits in the Not reached section and the screen re-sorts it
--       (src/lib/vaQueue.js:39). Server order only keeps it inside the limit of 200.
--
-- ── What was decided ────────────────────────────────────────────────────────
--   settings      app_settings.appt_followup_settings, row id = 1. Every timing is read
--                 from it. day0_delay_minutes matches core.ts:125's +4 hours so a lead
--                 doesn't bounce straight back after Not reached. A timing change applies
--                 to steps created afterwards.
--   step key      (lead, va_step, va_cycle, va_seq), unique over ALL states, so a stopped
--                 step can never be re-made under the same key within its cycle. A new
--                 schedule after a stop is a new va_cycle. A rebook has no va_cycle.
--   the agent     always coalesce(transfer_agent_id, assigned_rep_id). 175:24-26 puts a
--                 VA-booked agent in transfer_agent_id; assign_lead sets assigned_rep_id.
--   worked        Not reached or callback moves due steps to skipped (detail.ended
--                 'worked'), so Activity gets no duplicate of 202's va_call row.
--   no-show       Only once per booking: a double tap uses no rebook and adds no row. The
--                 lead moves off booked first, or the queue would never show it. A lead
--                 that is sold or closed as not interested returns recorded false and keeps
--                 its stage, because va_outcome stays 'booked' after a sale.
--   stop          A trigger, so set_inbound_outcome (193) and va_save_policy_help_lead need
--                 no replacing. Only a change INTO a stop value counts. Transferred is a
--                 stop: the client was reached and the queue already drops that lead.
--   the desk      A due step puts a lead on the desk even with assigned_rep_id set, or a
--                 rebook on an assigned lead would never show. Steps scheduled and none due
--                 hide it. A callback keeps today's rule: a step never pulls it forward and
--                 a future step never hides it once due.
--
-- ── Known gap, not fixed here ───────────────────────────────────────────────
--   A callback set on a lead with assigned_rep_id follows today's rule, which leaves out
--   any assigned lead. So when a VA reaches that lead and sets a callback, the desk does
--   not show it when the callback comes due.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'va_outcome')
     or to_regprocedure('public.va_queue()') is null
     or to_regprocedure('public.va_claim(uuid)') is null
     or to_regprocedure('public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb)') is null then
    raise exception '213 needs 175_va_desk applied first';
  end if;
  if to_regclass('public.inbound_events') is null
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'inbound_stage') then
    raise exception '213 needs 180_agent_inbounds applied first';
  end if;
  if to_regclass('public.inbound_events_step_uidx') is null then
    raise exception '213 needs 184_booked_appointment_texts applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inbound_events' and column_name = 'is_sample')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'is_sample') then
    raise exception '213 needs 186_is_sample_flag applied first';
  end if;
  if to_regclass('public.agent_working_hours') is null
     or to_regprocedure('public.agent_in_working_hours(uuid, timestamptz)') is null then
    raise exception '213 needs 197_agent_settings applied first';
  end if;
  if to_regprocedure('public.lead_transfer_missed(uuid)') is null
     or to_regprocedure('public.agents_slots_in_hours(uuid, timestamp with time zone[])') is null then
    raise exception '213 needs 211_transfer_missed applied first';
  end if;
end $$;

-- ── 1. Settings ─────────────────────────────────────────────────────────────
-- A CHECK can't hold a subquery, so the shape test is a function. Postgres checks execute
-- on it as the writer each time the CHECK runs, so authenticated keeps execute: without it
-- an admin saving any app_settings column would be refused. It reads only its argument.
-- The caps below are limits on a setting. No timing is read from here.
create or replace function public.lead_followup_settings_ok(p jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  k      text;
  el     jsonb;
  n      numeric;
  v_prev numeric := -1;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p)) <> 8
     or not p ?& array['retry_days', 'day0_delay_minutes', 'monthly_days', 'rebook_within_minutes',
                       'rebook_notice_minutes', 'rebook_max', 'slot_minutes', 'slot_search_days'] then
    return false;
  end if;

  -- Whole days, each later than the last: a repeat would break the step key.
  if jsonb_typeof(p -> 'retry_days') <> 'array' or p -> 'retry_days' = '[]'::jsonb then return false; end if;
  for el in select jsonb_array_elements(p -> 'retry_days') loop
    if jsonb_typeof(el) <> 'number' then return false; end if;
    n := (el #>> '{}')::numeric;
    if n <> trunc(n) or n <= v_prev or n > 100000 then return false; end if;
    v_prev := n;
  end loop;

  foreach k in array array['day0_delay_minutes', 'monthly_days', 'rebook_within_minutes', 'rebook_notice_minutes',
                           'rebook_max', 'slot_minutes', 'slot_search_days'] loop
    if jsonb_typeof(p -> k) <> 'number' then return false; end if;
    n := (p ->> k)::numeric;
    if n <> trunc(n) or n < 0 or n > 100000 then return false; end if;
  end loop;

  return (p ->> 'rebook_notice_minutes')::numeric <= (p ->> 'rebook_within_minutes')::numeric
     and (p ->> 'monthly_days')::numeric > v_prev
     and (p ->> 'slot_minutes')::numeric between 1 and 1440
     and (p ->> 'slot_search_days')::numeric between 1 and 90;
end;
$$;
revoke execute on function public.lead_followup_settings_ok(jsonb) from public, anon;
grant execute on function public.lead_followup_settings_ok(jsonb) to authenticated, service_role;

alter table public.app_settings
  add column if not exists appt_followup_settings jsonb not null
    default '{"retry_days":[0,1,3,7],"day0_delay_minutes":240,"monthly_days":30,"rebook_within_minutes":60,"rebook_notice_minutes":30,"rebook_max":2,"slot_minutes":30,"slot_search_days":21}'::jsonb
    constraint app_settings_appt_followup_settings_valid
    check (public.lead_followup_settings_ok(appt_followup_settings));

comment on column public.app_settings.appt_followup_settings is
  'Timings for the VA desk''s appointment retry steps and no-show rebooks (213). retry_days: days after Not reached the VA tries again (day 0 uses day0_delay_minutes). monthly_days: gap between monthly calls. rebook_max: rebooks per lead. rebook_notice_minutes, slot_minutes, slot_search_days: how the rebook time is found. rebook_within_minutes: a later rebook is marked moved. A change applies to steps created afterwards. Nothing is sent from this.';

-- ── 2. Step rows ────────────────────────────────────────────────────────────
-- inbound_events rows: kind 'follow_up', state 'scheduled', actor Ohvara / system, is_sample
-- from the lead. detail: va_step, va_cycle (retry only), va_seq, summary. All states, so a
-- stopped step keeps its key.
create unique index if not exists inbound_events_va_step_uidx
  on public.inbound_events (lead_id, (detail->>'va_step'), (coalesce(detail->>'va_cycle', '0')), (detail->>'va_seq'))
  where detail ? 'va_step';

-- The queue's read.
create index if not exists inbound_events_va_step_due_idx
  on public.inbound_events (lead_id, at)
  where state = 'scheduled' and detail ? 'va_step';

-- ── 3. lead_plan_retry_steps (private) ──────────────────────────────────────
-- A full schedule for a lead nobody reached. A repeat Not reached never restarts or shifts
-- one that is running. The cycle number is what lets a second schedule exist after a stop:
-- not reached, booked (the trigger skips the steps), no-show, then not reached.
create or replace function public.lead_plan_retry_steps(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead  record;
  v_cfg   jsonb;
  v_cycle int;
begin
  select lead_type, va_outcome, inbound_stage, outcome, is_sample,
         coalesce(transfer_agent_id, assigned_rep_id) as agent_id
    into v_lead
    from leads where id = p_lead
    for update;
  if not found or v_lead.lead_type is distinct from 'mortgage_protection' then return; end if;
  if v_lead.va_outcome in ('booked', 'transferred', 'not_interested')
     or v_lead.inbound_stage in ('booked', 'sold', 'lost')
     or v_lead.outcome in ('sold', 'not_interested') then
    return;
  end if;

  if exists (select 1 from inbound_events e
              where e.lead_id = p_lead and e.state = 'scheduled' and e.detail ->> 'va_step' like 'retry\_%') then
    return;
  end if;

  select 1 + coalesce(max((e.detail ->> 'va_cycle')::int), 0) into v_cycle
    from inbound_events e
   where e.lead_id = p_lead and e.detail ->> 'va_step' like 'retry\_%';

  select appt_followup_settings into v_cfg from app_settings where id = 1;

  insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role, is_sample)
  select p_lead, v_lead.agent_id, 'follow_up', 'scheduled',
         now() + case when d.n = 0 then make_interval(mins => (v_cfg ->> 'day0_delay_minutes')::int)
                      else make_interval(days => d.n) end,
         case when d.n = 0 then 'VA calls again, same day' else 'VA calls again, day ' || d.n end,
         jsonb_build_object('va_step', 'retry_d' || d.n, 'va_cycle', v_cycle, 'va_seq', 1,
                            'summary', 'Our VA will try them again.'),
         'Ohvara', 'system', v_lead.is_sample
    from (select value::int as n from jsonb_array_elements_text(v_cfg -> 'retry_days')) d;

  insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role, is_sample)
  values (p_lead, v_lead.agent_id, 'follow_up', 'scheduled',
          now() + make_interval(days => (v_cfg ->> 'monthly_days')::int),
          'VA monthly call',
          jsonb_build_object('va_step', 'retry_monthly', 'va_cycle', v_cycle, 'va_seq', 1,
                             'summary', 'Our VA will try them once a month until they are reached.'),
          'Ohvara', 'system', v_lead.is_sample);
end;
$$;
revoke execute on function public.lead_plan_retry_steps(uuid) from public, anon, authenticated;

-- ── 4. lead_next_rebook_slot (private) ──────────────────────────────────────
-- The first open time on the agent's own clock, or null: no agent, a bad zone, no hours or
-- nothing open. Not callable from the browser, so no agent can probe another's hours. The
-- caller passes the time to search from. Same lock key as 187's booking check.
-- One query, as 197 warns. It walks real time a clock minute at a time, the search's step
-- and not a setting, and tests each minute on the local clock, so a daylight saving change
-- moves neither the hours nor the slot grid. A scheduled step of this lead can't be running
-- here (booking stops them), so every one found belongs to another lead.
create or replace function public.lead_next_rebook_slot(p_agent uuid, p_from timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg   jsonb;
  v_tz    text;
  v_gap   interval;
  v_start timestamptz;
  v_end   timestamptz;
  v_slot  timestamptz;
begin
  if p_agent is null or p_from is null then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('booking_slot:' || p_agent::text, 0));

  -- profiles.timezone can be changed directly, so it is never trusted (197).
  select timezone into v_tz from profiles where id = p_agent;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then return null; end if;

  select appt_followup_settings into v_cfg from app_settings where id = 1;
  v_gap   := make_interval(mins => (v_cfg ->> 'slot_minutes')::int);
  v_start := p_from + make_interval(mins => (v_cfg ->> 'rebook_notice_minutes')::int);
  v_end   := p_from + make_interval(days => (v_cfg ->> 'slot_search_days')::int);

  with busy as materialized (
    select p.scheduled_call_at as at
      from policies p
     where p.agent_id = p_agent
       and p.fulfillment_assigned
       and p.fulfillment_stage is distinct from 'Complete'
       and p.scheduled_call_at is not null
    union all
    select e.at
      from inbound_events e
     where e.agent_id = p_agent
       and e.state = 'scheduled'
       and e.detail ? 'va_step'
       and e.detail ->> 'va_step' = 'rebook'
  ),
  minutes as (
    select g as at, g at time zone v_tz as local
      from generate_series(date_trunc('minute', v_start), v_end, make_interval(mins => 1)) g
     where g >= v_start
  )
  select m.at into v_slot
    from minutes m
    join agent_working_hours h
      on h.agent_id = p_agent
     and h.weekday = extract(isodow from m.local)
     and h.start_time <= m.local::time
     and m.local::time < h.end_time
   where mod(extract(epoch from m.local::time), extract(epoch from v_gap)) = 0
     and not exists (select 1 from busy b where b.at > m.at - v_gap and b.at < m.at + v_gap)
   order by m.at
   limit 1;

  return v_slot;
end;
$$;
revoke execute on function public.lead_next_rebook_slot(uuid, timestamptz) from public, anon, authenticated;

-- ── 5. lead_mark_no_show ────────────────────────────────────────────────────
-- The new way in. Fulfillment, admin, the lead's active agent and the service role.
-- Returns { recorded: false } and changes nothing unless the lead has been booked since the
-- last no-show. Recording updates the lead first, without va_attempts so 202's trigger logs
-- no VA call, and then writes the no_show row. Under rebook_max it adds a rebook step;
-- at the max it goes back to a full retry schedule.
create or replace function public.lead_mark_no_show(p_lead uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_lead       record;
  v_found      boolean;
  v_last       timestamptz;
  v_event_at   timestamptz;
  v_booked_at  timestamptz;
  v_cfg        jsonb;
  v_count      int;
  v_slot       timestamptz;
  v_at         timestamptz;
  v_detail     jsonb;
begin
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;

  select lead_type, va_outcome, inbound_stage, outcome, va_last_worked_at, is_sample,
         coalesce(transfer_agent_id, assigned_rep_id) as agent_id
    into v_lead
    from leads where id = p_lead
    for update;
  v_found := found;

  if not coalesce(public.is_fulfillment() or public.is_admin()
                  or current_setting('role', true) = 'service_role'
                  or coalesce(auth.role(), '') = 'service_role'
                  or (v_lead.agent_id = v_uid
                      and exists (select 1 from profiles where id = v_uid and role = 'agent' and is_active)),
                  false) then
    raise exception 'Only the lead''s agent or Fulfillment can do this' using errcode = '42501';
  end if;
  if not v_found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if v_lead.lead_type is distinct from 'mortgage_protection'
     or v_lead.va_outcome = 'not_interested'
     or v_lead.inbound_stage in ('sold', 'lost')
     or v_lead.outcome in ('sold', 'not_interested') then
    return jsonb_build_object('recorded', false);
  end if;

  -- Booked since the last no-show? core.ts:333 reads the same two times.
  select max(e.at) into v_last
    from inbound_events e
   where e.lead_id = p_lead and e.kind = 'no_show' and e.state = 'done';
  select max(e.created_at) into v_event_at
    from inbound_events e
   where e.lead_id = p_lead and e.kind in ('booked', 'rebooked') and e.state <> 'skipped';

  if not coalesce(v_lead.va_outcome = 'booked', false)
     and not coalesce(v_lead.inbound_stage = 'booked', false)
     and not (v_event_at is not null and (v_last is null or v_event_at > v_last)) then
    return jsonb_build_object('recorded', false);
  end if;

  v_booked_at := greatest(case when v_lead.va_outcome = 'booked' then v_lead.va_last_worked_at end, v_event_at);
  if v_last > v_booked_at then
    return jsonb_build_object('recorded', false);
  end if;

  -- Off booked first: the queue never shows a lead that stays on it.
  update leads
     set va_outcome = 'not_reached', inbound_stage = 'contacting'
   where id = p_lead;

  insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_id, actor_name, actor_role, is_sample)
  values (p_lead, v_lead.agent_id, 'no_show', 'done', now(), 'No-show',
          jsonb_build_object('summary', 'They missed the appointment. Our VA will follow up.'),
          v_uid, 'Ohvara', 'system', v_lead.is_sample);

  select appt_followup_settings into v_cfg from app_settings where id = 1;
  select count(*) into v_count
    from inbound_events e
   where e.lead_id = p_lead and e.detail ->> 'va_step' = 'rebook';

  if v_count >= (v_cfg ->> 'rebook_max')::int then
    perform public.lead_plan_retry_steps(p_lead);
    return jsonb_build_object('recorded', true, 'rebook_seq', null, 'retry_planned', true);
  end if;

  v_slot := public.lead_next_rebook_slot(v_lead.agent_id, now());
  v_at := coalesce(v_slot, now());
  v_detail := jsonb_build_object('va_step', 'rebook', 'va_seq', v_count + 1,
                                 'summary', 'Our VA will call them to set a new time.');
  if v_slot is null then
    v_detail := v_detail || jsonb_build_object('no_auto_time', true);
  else
    v_detail := v_detail || jsonb_build_object(
      'rebook_at', v_slot,
      'moved', v_slot > now() + make_interval(mins => (v_cfg ->> 'rebook_within_minutes')::int));
  end if;

  insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role, is_sample)
  values (p_lead, v_lead.agent_id, 'follow_up', 'scheduled', v_at, 'VA calls to rebook', v_detail,
          'Ohvara', 'system', v_lead.is_sample);

  return jsonb_build_object('recorded', true, 'rebook_seq', v_count + 1, 'rebook_at', v_at,
                            'moved', coalesce((v_detail ->> 'moved')::boolean, false),
                            'no_auto_time', v_slot is null);
end;
$$;
revoke execute on function public.lead_mark_no_show(uuid) from public, anon;
grant execute on function public.lead_mark_no_show(uuid) to authenticated, service_role;

-- ── 6. Stop trigger ─────────────────────────────────────────────────────────
-- Security definer because authenticated has no write on inbound_events (180:288), so a
-- caller's update would otherwise fail. Only a change INTO a stop value counts: a lead that
-- was already at one and did not change must not kill a new rebook. Nothing found today sets
-- inbound_stage to 'booked', which is why va_outcome and outcome are read too.
create or replace function public.leads_stop_followup_steps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  v_reason := case
    when new.va_outcome is distinct from old.va_outcome
         and new.va_outcome in ('booked', 'transferred', 'not_interested') then new.va_outcome
    when new.outcome is distinct from old.outcome
         and new.outcome in ('sold', 'not_interested') then new.outcome
    when new.inbound_stage is distinct from old.inbound_stage
         and new.inbound_stage in ('booked', 'sold', 'lost') then new.inbound_stage
  end;
  if v_reason is null then return null; end if;

  update inbound_events
     set state = 'skipped', detail = detail || jsonb_build_object('ended', v_reason)
   where lead_id = new.id
     and state = 'scheduled'
     and detail ? 'va_step'
     and not detail ? 'step';
  return null;
end;
$$;
revoke execute on function public.leads_stop_followup_steps() from public, anon, authenticated;

drop trigger if exists leads_stop_followup_steps on public.leads;
create trigger leads_stop_followup_steps
  after update of va_outcome, inbound_stage, outcome on public.leads
  for each row
  when (new.lead_type = 'mortgage_protection')
  execute function public.leads_stop_followup_steps();

-- ── 7. Queue ────────────────────────────────────────────────────────────────
-- 175, copied whole. Changed: the agent and bucket tests in WHERE and the first sort line.
-- A typed lead with no agent (assigned_rep_id null) that is new (no VA result
-- yet), not reached, or a callback that is due. A lead another VA holds is
-- left out until their claim expires; an expired claim counts as unclaimed.
-- A mortgage_protection lead with VA steps scheduled and no callback set is on the
-- desk only while one is due, even with assigned_rep_id set.
-- Order: rebooks due, then callbacks due, then new, then not reached; oldest first in each.
create or replace function public.va_queue()
returns table (
  lead_id uuid, lead_type text, lead_source text, contact_name text, phone text,
  city text, state text, qualifier_answers jsonb, va_checklist jsonb,
  bucket text, va_attempts integer, va_callback_at timestamptz,
  claimed_by_me boolean, claim_expires_at timestamptz, created_at timestamptz
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see the call queue' using errcode = '42501';
  end if;
  return query
    select l.id, l.lead_type, l.lead_source, coalesce(l.contact_name, l.business_name), l.phone,
           l.city, l.state, l.qualifier_answers, l.va_checklist,
           case when l.va_outcome is null then 'new'
                when l.va_outcome = 'not_reached' then 'not_reached'
                else 'callback_due' end,
           l.va_attempts, l.va_callback_at,
           (l.va_claimed_by = v_uid and l.va_claim_expires_at > now()),
           case when l.va_claim_expires_at > now() then l.va_claim_expires_at end,
           l.created_at
      from public.leads l
     where l.lead_type <> 'cancellation'
       and case when l.lead_type = 'mortgage_protection'
                 and l.va_outcome is distinct from 'callback'
                 and exists (select 1 from public.inbound_events e
                              where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step')
                then exists (select 1 from public.inbound_events e
                              where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step'
                                and e.at <= now())
                else l.assigned_rep_id is null
                     and (l.va_outcome is null
                          or l.va_outcome = 'not_reached'
                          or (l.va_outcome = 'callback' and l.va_callback_at <= now()))
           end
       and (l.va_claimed_by is null
            or l.va_claimed_by = v_uid
            or l.va_claim_expires_at is null
            or l.va_claim_expires_at <= now())
     order by case when l.lead_type = 'mortgage_protection'
                    and exists (select 1 from public.inbound_events e
                                 where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step'
                                   and e.detail ->> 'va_step' = 'rebook' and e.at <= now())
                   then 0 else 1 end,
              case when l.va_outcome = 'callback' then 0
                   when l.va_outcome is null then 1
                   else 2 end,
              coalesce(l.va_callback_at, l.created_at)
     limit 200;
end;
$$;
revoke execute on function public.va_queue() from public, anon;
grant execute on function public.va_queue() to authenticated;

-- ── 8. Claim ────────────────────────────────────────────────────────────────
-- 211, copied whole. Changed: the same agent and bucket test as va_queue, so whatever the
-- queue shows can be claimed. 211's missed-lead line and the claim test stay.
-- One update with the claim test in its WHERE, so two VAs can't both win: the
-- second waits on the row lock, re-checks the WHERE against the first VA's
-- claim and updates nothing. Claiming your own lead again renews it (the desk
-- can call this while the VA is still on the lead). Returns the new expiry.
create or replace function public.va_claim(p_lead uuid)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_until timestamptz;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take a lead' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;

  update public.leads l
     set va_claimed_by = v_uid,
         va_claim_expires_at = now() + interval '15 minutes'
   where l.id = p_lead
     and l.lead_type <> 'cancellation'
     and (case when l.lead_type = 'mortgage_protection'
                and l.va_outcome is distinct from 'callback'
                and exists (select 1 from public.inbound_events e
                             where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step')
               then exists (select 1 from public.inbound_events e
                             where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step'
                               and e.at <= now())
               else l.assigned_rep_id is null
                    and (l.va_outcome is null
                         or l.va_outcome = 'not_reached'
                         or (l.va_outcome = 'callback' and l.va_callback_at <= now()))
          end
          or public.lead_transfer_missed(l.id))
     and (l.va_claimed_by is null
          or l.va_claimed_by = v_uid
          or l.va_claim_expires_at is null
          or l.va_claim_expires_at <= now())
  returning l.va_claim_expires_at into v_until;

  if v_until is null then
    if not exists (select 1 from public.leads where id = p_lead) then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.leads
                where id = p_lead and va_claimed_by <> v_uid and va_claim_expires_at > now()) then
      raise exception 'Another VA is on this lead' using errcode = '55006';
    end if;
    raise exception 'This lead is not in the queue' using errcode = '22023';
  end if;
  return v_until;
end;
$$;
revoke execute on function public.va_claim(uuid) from public, anon;
grant execute on function public.va_claim(uuid) to authenticated;

-- ── 9. Record the result ────────────────────────────────────────────────────
-- 211, copied whole. Changed: two declared variables and one block after the update.
-- The time is the booking row's: this function has no time argument, and a booked
-- outcome with no booking row has no time to check.
create or replace function public.va_set_lead_outcome(
  p_lead uuid, p_agent uuid default null, p_outcome text default 'booked',
  p_callback_at timestamptz default null, p_booking_id uuid default null,
  p_checklist jsonb default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_at  timestamptz;
  v_monthly_seq int;
  v_monthly_cycle int;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can update a call' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if p_outcome is null or p_outcome not in ('not_reached', 'callback', 'booked', 'transferred', 'not_interested') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if p_outcome = 'callback' and (p_callback_at is null or p_callback_at <= now()
                                 or p_callback_at > now() + interval '90 days') then
    raise exception 'Pick a callback time in the next 90 days' using errcode = '22023';
  end if;
  if p_outcome in ('booked', 'transferred') then
    if p_agent is null then
      raise exception 'Pick the agent' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles where id = p_agent and role = 'agent' and is_active) then
      raise exception 'That agent is not available' using errcode = '22023';
    end if;
  end if;
  if p_booking_id is not null and (p_outcome <> 'booked' or not exists (
    select 1 from public.policies where id = p_booking_id and agent_id = p_agent
  )) then
    raise exception 'That booking is not on the agent''s calendar' using errcode = '22023';
  end if;
  if p_booking_id is not null then
    select scheduled_call_at into v_at from public.policies where id = p_booking_id;
    if v_at is not null and not exists (select 1 from public.agents_slots_in_hours(p_agent, array[v_at])) then
      if not exists (select 1 from public.agent_working_hours where agent_id = p_agent) then
        raise exception 'This agent hasn''t set working hours yet, so nothing can be booked with them.'
          using errcode = '22023', hint = 'working_hours';
      end if;
      raise exception 'That''s outside this agent''s working hours. Pick another time.'
        using errcode = '22023', hint = 'working_hours';
    end if;
  end if;
  if p_checklist is not null and jsonb_typeof(p_checklist) <> 'object' then
    raise exception 'Checklist answers must be an object' using errcode = '22023';
  end if;

  update public.leads
     set va_outcome = p_outcome,
         va_callback_at = case when p_outcome = 'callback' then p_callback_at end,
         va_attempts = va_attempts + 1,
         va_checklist = coalesce(p_checklist, va_checklist),
         transfer_agent_id = case when p_outcome in ('booked', 'transferred') then p_agent else transfer_agent_id end,
         transfer_status = case when p_outcome = 'transferred' then 'requested' else transfer_status end,
         transferred_at = case when p_outcome = 'transferred' then now() else transferred_at end,
         booking_id = case when p_outcome = 'booked' then coalesce(p_booking_id, booking_id) else booking_id end,
         va_last_worked_by = v_uid,
         va_last_worked_at = now(),
         va_claimed_by = null,
         va_claim_expires_at = null
   where id = p_lead
     and lead_type <> 'cancellation'
     and ((va_claimed_by = v_uid and va_claim_expires_at > now()) or public.is_admin());

  if not found then
    if not exists (select 1 from public.leads where id = p_lead and lead_type <> 'cancellation') then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    raise exception 'Take the lead first (a claim lasts 15 minutes)' using errcode = '55006';
  end if;

  -- The call just made is the due step: skipped, so Activity shows only 202's va_call row.
  -- A monthly call that was used makes the next one; lead_plan_retry_steps does the rest.
  if p_outcome in ('not_reached', 'callback')
     and exists (select 1 from public.leads where id = p_lead and lead_type = 'mortgage_protection') then
    with worked as (
      update public.inbound_events e
         set state = 'skipped', detail = e.detail || jsonb_build_object('ended', 'worked')
       where e.lead_id = p_lead and e.state = 'scheduled' and e.detail ? 'va_step' and e.at <= now()
      returning e.detail
    )
    select max((w.detail ->> 'va_seq')::int), max((w.detail ->> 'va_cycle')::int)
      into v_monthly_seq, v_monthly_cycle
      from worked w
     where w.detail ->> 'va_step' = 'retry_monthly';

    if p_outcome = 'not_reached' then
      if v_monthly_seq is not null
         and not exists (select 1 from public.inbound_events e
                          where e.lead_id = p_lead and e.state = 'scheduled' and e.detail ->> 'va_step' like 'retry\_%') then
        insert into public.inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role, is_sample)
        select l.id, coalesce(l.transfer_agent_id, l.assigned_rep_id), 'follow_up', 'scheduled',
               now() + make_interval(days => (s.appt_followup_settings ->> 'monthly_days')::int),
               'VA monthly call',
               jsonb_build_object('va_step', 'retry_monthly', 'va_cycle', v_monthly_cycle, 'va_seq', v_monthly_seq + 1,
                                  'summary', 'Our VA will try them once a month until they are reached.'),
               'Ohvara', 'system', l.is_sample
          from public.leads l, public.app_settings s
         where l.id = p_lead and s.id = 1;
      end if;
      perform public.lead_plan_retry_steps(p_lead);
    end if;
  end if;
end;
$$;
revoke execute on function public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb) to authenticated;

-- Check after applying (expect anon false everywhere; authenticated false for the private
-- ones and true for lead_mark_no_show):
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
--          has_function_privilege('authenticated', p.oid, 'execute') authed
--     from pg_proc p where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('lead_plan_retry_steps', 'lead_next_rebook_slot', 'lead_mark_no_show', 'leads_stop_followup_steps');
--   select appt_followup_settings from public.app_settings where id = 1;
--   select indexdef from pg_indexes where indexname = 'inbound_events_va_step_uidx';
