-- P894 — the 30-minute booking gap, on the server. NOT APPLIED (Brayden applies it).
--
-- Rule (Brayden, Nov 7): a VA or the AI can't book an agent within 30 minutes of another call booked on that agent.
-- The pickers grey those times out (src/lib/callSlots.js agentFree / agentGap); this file makes the server refuse them
-- too, whoever writes the booking.
--
-- Where an agent's booked calls live today: the newest kind 'booked' row in inbound_events for each lead (its time in
-- detail.appointment_at, or detail.at from p892's ai_caller_book, or the row's own at when it's scheduled), plus
-- ai_calls.booked_for. A booking stops counting once the lead has a newer no_show row (213) or has left booked
-- (sold, lost, follow up).
--
--   1. agent_booked_times(agent, except_lead)  every live booked time on the agent (private)
--   2. agent_gap_ok(agent, at, except_lead)     true when no booked call starts under 30 minutes from `at` (private)
--   3. agent_booked_slots(agent)                the same times for the VA desk picker (Fulfillment / admin only)
--   4. trigger on inbound_events                a new booked row inside the gap is refused (hint 'booking_gap')
--   5. ai_caller_slots, va_next_open_slot, lead_next_rebook_slot only offer times outside the gap
--      (p892 / 211 / 213, copied whole; the change in each is marked "P894").

-- ── 1. Every live booked time on an agent ──────────────────────────────────
create or replace function public.agent_booked_times(p_agent uuid, p_except_lead uuid default null)
returns table (lead_id uuid, at timestamptz)
language sql
stable security definer
set search_path = public
as $$
  with newest as (
    select distinct on (e.lead_id) e.lead_id, e.created_at,
           coalesce((e.detail ->> 'appointment_at')::timestamptz, (e.detail ->> 'at')::timestamptz,
                    case when e.state = 'scheduled' then e.at end) as at
      from inbound_events e
     where e.kind = 'booked'
       and e.state is distinct from 'skipped'
       and e.agent_id = p_agent
       and (p_except_lead is null or e.lead_id <> p_except_lead)
     order by e.lead_id, e.created_at desc
  )
  select n.lead_id, n.at
    from newest n
    join leads l on l.id = n.lead_id
   where n.at is not null
     and n.at > now() - interval '30 minutes'
     and coalesce(l.inbound_stage, '') not in ('sold', 'lost', 'follow_up')
     and not exists (select 1 from inbound_events x
                      where x.lead_id = n.lead_id and x.kind = 'no_show'
                        and x.state is distinct from 'skipped' and x.created_at > n.created_at)
  union all
  select a.lead_id, a.booked_for
    from ai_calls a
   where a.agent_id = p_agent
     and a.booked_for is not null
     and a.booked_for > now() - interval '30 minutes'
     and (p_except_lead is null or a.lead_id <> p_except_lead);
$$;
revoke all on function public.agent_booked_times(uuid, uuid) from public, anon, authenticated;

-- ── 2. Outside the gap? ────────────────────────────────────────────────────
create or replace function public.agent_gap_ok(p_agent uuid, p_at timestamptz, p_except_lead uuid default null)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select p_at is null or not exists (
    select 1 from public.agent_booked_times(p_agent, p_except_lead) t
     where abs(extract(epoch from (t.at - p_at))) < 30 * 60);
$$;
revoke all on function public.agent_gap_ok(uuid, timestamptz, uuid) from public, anon, authenticated;

-- ── 3. The times, for the VA desk's picker ─────────────────────────────────
create or replace function public.agent_booked_slots(p_agent uuid)
returns setof timestamptz
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see an agent''s booked times' using errcode = '42501';
  end if;
  return query select t.at from public.agent_booked_times(p_agent, null) t order by t.at;
end;
$$;
revoke all on function public.agent_booked_slots(uuid) from public, anon;
grant execute on function public.agent_booked_slots(uuid) to authenticated;

-- ── 4. The server refuses a booking inside the gap ─────────────────────────
create or replace function public.enforce_agent_booking_gap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if new.kind is distinct from 'booked' or new.state = 'skipped' or new.agent_id is null then
    return new;
  end if;
  v_at := coalesce((new.detail ->> 'appointment_at')::timestamptz, (new.detail ->> 'at')::timestamptz,
                   case when new.state = 'scheduled' then new.at end);
  if v_at is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('booking_slot:' || new.agent_id::text, 0));
  if not public.agent_gap_ok(new.agent_id, v_at, new.lead_id) then
    raise exception 'That time is within 30 minutes of another call booked for this agent. Pick another time.'
      using errcode = '22023', hint = 'booking_gap';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_agent_booking_gap() from public, anon, authenticated;

drop trigger if exists inbound_events_booking_gap on public.inbound_events;
create trigger inbound_events_booking_gap
  before insert on public.inbound_events
  for each row execute function public.enforce_agent_booking_gap();

-- ── 5a. The AI only offers times outside the gap (p892, copied whole) ──────
create or replace function public.ai_caller_slots(p_call uuid, p_limit int default 6)
returns setof timestamptz language plpgsql stable security definer set search_path = public as $$
declare c public.ai_calls; cand timestamptz[];
begin
  select * into c from public.ai_calls where id = p_call;
  if c.agent_id is null then return; end if;
  select array_agg(g) into cand
    from generate_series(date_trunc('hour', now()) + interval '90 minutes', now() + interval '3 days', interval '30 minutes') g;
  return query select s from public.agents_slots_in_hours(c.agent_id, cand) s
                where not exists (select 1 from public.ai_calls o where o.agent_id = c.agent_id and o.booked_for = s)
                  and public.agent_gap_ok(c.agent_id, s, c.lead_id) -- P894
                order by s limit greatest(1, least(coalesce(p_limit, 6), 12));
end;
$$;

-- ── 5b. The desk's next open slot (211, copied whole) ──────────────────────
create or replace function public.va_next_open_slot(p_lead uuid)
returns timestamptz
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_agent uuid;
  v_first timestamptz := date_bin('15 minutes', now(), timestamptz 'epoch') + interval '15 minutes';
  v_slot  timestamptz;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see open slots' using errcode = '42501';
  end if;
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.leads where id = p_lead and lead_type <> 'cancellation') then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  v_agent := public.lead_booking_agent(p_lead);
  if not exists (select 1 from public.profiles where id = v_agent and role = 'agent' and is_active) then
    return null;
  end if;

  select min(s.slot) into v_slot
    from public.agents_slots_in_hours(v_agent, array(
           select generate_series(v_first, now() + interval '60 minutes', interval '15 minutes'))) as s(slot)
   where not exists (
     select 1 from public.policies o
      where o.agent_id = v_agent
        and o.fulfillment_assigned
        and o.fulfillment_stage is distinct from 'Complete'
        and o.scheduled_call_at = s.slot)
     and public.agent_gap_ok(v_agent, s.slot, p_lead); -- P894
  return v_slot;
end;
$$;
revoke execute on function public.va_next_open_slot(uuid) from public, anon;
grant execute on function public.va_next_open_slot(uuid) to authenticated;

-- ── 5c. The rebook suggestion (213, copied whole) ──────────────────────────
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
  v_win   interval;
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
  v_win   := greatest(v_gap, interval '30 minutes'); -- P894: never under 30 minutes from another booked call
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
    union all
    select t.at from public.agent_booked_times(p_agent, null) t -- P894
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
     and not exists (select 1 from busy b where b.at > m.at - v_win and b.at < m.at + v_win)
   order by m.at
   limit 1;

  return v_slot;
end;
$$;
revoke execute on function public.lead_next_rebook_slot(uuid, timestamptz) from public, anon, authenticated;
