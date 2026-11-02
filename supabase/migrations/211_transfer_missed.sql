-- 211 — Live transfer: the miss logged on the server, an acknowledge-only Accept,
-- the VA's next open slot, and working hours on bookings (Agent Portal Servicing
-- Spec, Live calls: "ring -> accept / missed -> VA books the next open slot within
-- the hour"; Settings: working hours are "the only hours VAs may book leads onto").
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked step.
-- Additive: one column, one partial unique index, new functions, and va_claim and
-- va_set_lead_outcome re-stated whole from 175 with the same arguments and grants.
-- Nothing is removed, renamed or emptied. Nothing here calls or messages anyone.
-- help-voice must be deployed after this applies; until then its call to
-- log_missed_transfer fails, is logged and never breaks the call.
--
-- APPLY ORDER: after 179, 180, 186 and 197. The check below stops the file if any
-- of them is missing.
--
-- WHY THE MISS IS ON THE SERVER: Twilio's 25-second leg timing out is the real miss
-- (help-voice agentLeg). TransferAlert stops polling in a hidden tab, so a browser
-- timer would miss the commonest case.
--
-- WHY ACCEPT ONLY ACKNOWLEDGES: help-transfer drop() lets the VA leave once
-- help_calls.status is 'transferred'. A browser tap must never set that, or the VA
-- could leave a caller with nobody. Only Twilio's answered callback does.
--
--   help_calls.agent_ack_at          the agent tapped Accept on this attempt.
--   agent_accept_transfer(p_lead)    sets agent_ack_at on the caller's current call.
--   log_missed_transfer(p_call_sid)  one inbound_events 'missed' row per help call.
--                                    Service role only.
--   agent_missed_transfer(p_lead)    "Can't take it": the same logic, for the agent.
--   agents_slots_in_hours(agent, slots)  the slots inside the agent's hours, in one
--                                    query. Service role and definer functions only:
--                                    from the browser, one agent could probe another.
--   va_next_open_slot(p_lead)        the first free slot in the next 60 minutes.
--   va_agent_in_hours(agent, at)     lets the desk check before it writes the booking.
--   va_missed_leads()                the desk's list of missed leads, with their agent.
--
-- DECISIONS:
--   * p_lead may be null on Accept and "Can't take it": nothing writes
--     help_calls.lead_id yet (180 left that to a later file), so my_incoming_transfer
--     can return a null lead_id. The caller's own call is found either way.
--   * With no lead_id on the call, log_missed_transfer finds the lead the way
--     va_save_policy_help_lead does (same 10 digits, typed lead, last 30 days) and
--     links it. markLead had nothing to act on in that case, so the link also sets
--     'dropped' once the call has really gone back to no_answer. No lead found: no
--     row (inbound_events.lead_id is required) and false comes back.
--   * One row per help call, as briefed: a second agent missing the same call on a
--     retry writes nothing more.
--   * An agent with no working hours has none to book onto: every day is closed
--     (197's contract), and the refusal says so.
--   * The slot grid is quarter hours, the first one strictly after now. Free means
--     no other open booking for that agent at that exact time, the same test
--     enforce_agent_booking_rules uses (policies is the calendar; 187).
--   * A missed lead can have va_outcome 'transferred', which va_claim refuses, so
--     va_claim also takes a missed lead. Otherwise the VA could never book it.
--   * "Missed" stops once a retry is requested or connects, or the VA records another
--     result. A lead with only a dropped transfer (VA ended, caller left) is not missed.

do $$
begin
  if to_regclass('public.help_calls') is null then
    raise exception '211 needs 179_help_calls applied first';
  end if;
  if to_regclass('public.inbound_events') is null then
    raise exception '211 needs 180_agent_inbounds applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inbound_events' and column_name = 'is_sample') then
    raise exception '211 needs 186_is_sample_flag applied first';
  end if;
  if to_regclass('public.agent_working_hours') is null then
    raise exception '211 needs 197_agent_settings applied first';
  end if;
end $$;

-- ── 1. The acknowledgement and the one-row guard ────────────────────────────
alter table public.help_calls
  add column if not exists agent_ack_at timestamptz;

comment on column public.help_calls.agent_ack_at is
  'The agent tapped Accept in the portal. Never means connected: only Twilio''s answered callback sets status transferred.';

create unique index if not exists inbound_events_missed_call_uidx
  on public.inbound_events ((detail ->> 'help_call_id'))
  where kind = 'missed';

-- ── 2. Accept ───────────────────────────────────────────────────────────────
-- A retry to another agent keeps the same row, so an ack from before this attempt
-- counts for nothing and a repeat tap on this attempt keeps its first time.
create or replace function public.agent_accept_transfer(p_lead uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from profiles where id = v_uid and role = 'agent' and is_active) then
    raise exception 'Only an active agent can do this' using errcode = '42501';
  end if;

  update help_calls h
     set agent_ack_at = case when h.agent_ack_at >= h.transfer_started_at then h.agent_ack_at else now() end
   where h.id = (
     select c.id from help_calls c
      where c.transfer_agent_id = v_uid
        and c.status in ('transferring', 'transferred')
        and c.transfer_started_at > now() - interval '2 minutes'
        and (p_lead is null or c.lead_id = p_lead)
      order by c.transfer_started_at desc
      limit 1);
  return found;
end;
$$;
revoke execute on function public.agent_accept_transfer(uuid) from public, anon;
grant execute on function public.agent_accept_transfer(uuid) to authenticated;

-- ── 3. The miss ─────────────────────────────────────────────────────────────
-- Safe to call twice, from either path: the row lock and the unique index give one
-- row per call. A call someone answered is not a miss. True only when a row was written.
create or replace function public.log_missed_transfer(p_call_sid text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call   help_calls;
  v_lead   uuid;
  v_digits text;
  v_rows   integer;
begin
  select * into v_call from help_calls where call_sid = p_call_sid for update;
  if not found or v_call.transfer_agent_id is null
     or v_call.status = 'transferred' or v_call.outcome = 'transferred' then
    return false;
  end if;

  v_lead := v_call.lead_id;
  if v_lead is null then
    v_digits := right(regexp_replace(coalesce(v_call.caller_number, ''), '\D', '', 'g'), 10);
    if length(v_digits) = 10 then
      select l.id into v_lead
        from leads l
       where l.lead_type <> 'cancellation'
         and l.phone is not null
         and l.created_at >= now() - interval '30 days'
         and right(regexp_replace(l.phone, '\D', '', 'g'), 10) = v_digits
       order by l.created_at desc
       limit 1;
    end if;
    if v_lead is null then
      return false;
    end if;
    update help_calls set lead_id = v_lead where id = v_call.id;
    if v_call.status = 'no_answer' then
      update leads set transfer_status = 'dropped'
       where id = v_lead and transfer_status is distinct from 'dropped';
    end if;
  end if;

  insert into inbound_events (lead_id, agent_id, kind, state, label, detail, actor_name, actor_role, is_sample)
  select v_lead, v_call.transfer_agent_id, 'missed', 'done', 'A live transfer was missed.',
         jsonb_build_object('help_call_id', v_call.id), 'Ohvara', 'system', l.is_sample
    from leads l
   where l.id = v_lead
  on conflict ((detail ->> 'help_call_id')) where kind = 'missed' do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.log_missed_transfer(text) from public, anon, authenticated;
grant execute on function public.log_missed_transfer(text) to service_role;

-- "Can't take it". Leaves the call alone: Twilio's leg keeps ringing until its own
-- no-answer moves the row, and that callback finds the row already written.
create or replace function public.agent_missed_transfer(p_lead uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sid text;
begin
  if not exists (select 1 from profiles where id = v_uid and role = 'agent' and is_active) then
    raise exception 'Only the lead''s agent can do this' using errcode = '42501';
  end if;

  select c.call_sid into v_sid
    from help_calls c
   where c.transfer_agent_id = v_uid
     and c.status in ('transferring', 'no_answer')
     and c.transfer_started_at > now() - interval '2 minutes'
     and (p_lead is null or c.lead_id = p_lead)
   order by c.transfer_started_at desc
   limit 1;

  if v_sid is null then
    if p_lead is not null
       and not exists (select 1 from leads l where l.id = p_lead and v_uid in (l.assigned_rep_id, l.transfer_agent_id))
       and not exists (select 1 from help_calls c where c.lead_id = p_lead and c.transfer_agent_id = v_uid) then
      raise exception 'Only the lead''s agent can do this' using errcode = '42501';
    end if;
    return false;
  end if;
  return public.log_missed_transfer(v_sid);
end;
$$;
revoke execute on function public.agent_missed_transfer(uuid) from public, anon;
grant execute on function public.agent_missed_transfer(uuid) to authenticated;

-- ── 4. Working hours, many slots at once ────────────────────────────────────
-- 197's rules: the zone is never trusted (unknown means no slots), the weekday comes
-- from the local date, a missing row is a closed day. Materialized so no slot is
-- converted with a zone that hasn't been checked. pg_timezone_names is read once.
create or replace function public.agents_slots_in_hours(p_agent uuid, p_slots timestamptz[])
returns setof timestamptz
language sql
stable security definer
set search_path = public
as $$
  with zone as materialized (
    select p.timezone as tz
      from profiles p
     where p.id = p_agent
       and exists (select 1 from pg_timezone_names z where z.name = p.timezone)
  )
  select s.slot
    from zone
   cross join lateral unnest(p_slots) as s(slot)
    join agent_working_hours h
      on h.agent_id = p_agent
     and h.weekday = extract(isodow from s.slot at time zone zone.tz)
     and h.start_time <= (s.slot at time zone zone.tz)::time
     and (s.slot at time zone zone.tz)::time < h.end_time;
$$;
revoke all on function public.agents_slots_in_hours(uuid, timestamptz[]) from public, anon, authenticated;
grant execute on function public.agents_slots_in_hours(uuid, timestamptz[]) to service_role;

-- ── 5. Missed leads for the desk ────────────────────────────────────────────
-- Private, like agent_settings_types: only the definer functions below use these.
create or replace function public.lead_transfer_missed(p_lead uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1 from leads l
     where l.id = p_lead
       and l.lead_type <> 'cancellation'
       and (l.va_outcome is null or l.va_outcome = 'transferred')
       and (l.transfer_status is null or l.transfer_status = 'dropped')
       and exists (select 1 from inbound_events e where e.lead_id = l.id and e.kind = 'missed'));
$$;
revoke all on function public.lead_transfer_missed(uuid) from public, anon, authenticated;

-- The agent a missed lead books onto: whoever holds the lead, else the last agent who
-- missed it, else the one the VA recorded.
create or replace function public.lead_booking_agent(p_lead uuid)
returns uuid
language sql
stable security definer
set search_path = public
as $$
  select coalesce(
           l.assigned_rep_id,
           (select e.agent_id from inbound_events e
             where e.lead_id = l.id and e.kind = 'missed' and e.agent_id is not null
             order by e.at desc limit 1),
           l.transfer_agent_id)
    from leads l
   where l.id = p_lead;
$$;
revoke all on function public.lead_booking_agent(uuid) from public, anon, authenticated;

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
        and o.scheduled_call_at = s.slot);
  return v_slot;
end;
$$;
revoke execute on function public.va_next_open_slot(uuid) from public, anon;
grant execute on function public.va_next_open_slot(uuid) to authenticated;

-- The desk writes the booking row before it records the outcome, so it asks first:
-- a refusal in va_set_lead_outcome alone would leave the row on the agent's calendar.
create or replace function public.va_agent_in_hours(p_agent uuid, p_at timestamptz)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can check an agent''s hours' using errcode = '42501';
  end if;
  return exists (select 1 from public.agents_slots_in_hours(p_agent, array[p_at]));
end;
$$;
revoke execute on function public.va_agent_in_hours(uuid, timestamptz) from public, anon;
grant execute on function public.va_agent_in_hours(uuid, timestamptz) to authenticated;

-- The same row shape as va_queue, plus the agent, so the desk can open any of these.
-- A lead another VA holds is left out until their claim expires.
create or replace function public.va_missed_leads()
returns table (
  lead_id uuid, lead_type text, lead_source text, contact_name text, phone text,
  city text, state text, qualifier_answers jsonb, va_checklist jsonb,
  bucket text, va_attempts integer, va_callback_at timestamptz,
  claimed_by_me boolean, claim_expires_at timestamptz, created_at timestamptz,
  agent_id uuid, agent_name text, missed_at timestamptz
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
           'not_reached'::text,
           l.va_attempts, l.va_callback_at,
           (l.va_claimed_by = v_uid and l.va_claim_expires_at > now()),
           case when l.va_claim_expires_at > now() then l.va_claim_expires_at end,
           l.created_at,
           a.id, a.full_name, m.missed_at
      from (select e.lead_id, max(e.at) as missed_at
              from public.inbound_events e
             where e.kind = 'missed'
             group by e.lead_id) m
      join public.leads l on l.id = m.lead_id
      left join public.profiles a
        on a.id = public.lead_booking_agent(l.id) and a.role = 'agent' and a.is_active
     where public.lead_transfer_missed(l.id)
       and (l.va_claimed_by is null
            or l.va_claimed_by = v_uid
            or l.va_claim_expires_at is null
            or l.va_claim_expires_at <= now())
     order by m.missed_at desc
     limit 200;
end;
$$;
revoke execute on function public.va_missed_leads() from public, anon;
grant execute on function public.va_missed_leads() to authenticated;

-- ── 6. va_claim: 175, plus a missed lead ────────────────────────────────────
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
     and ((l.assigned_rep_id is null
           and (l.va_outcome is null
                or l.va_outcome = 'not_reached'
                or (l.va_outcome = 'callback' and l.va_callback_at <= now())))
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

-- ── 7. va_set_lead_outcome: 175, plus working hours on a booking ────────────
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
end;
$$;
revoke execute on function public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.va_set_lead_outcome(uuid, uuid, text, timestamptz, uuid, jsonb) to authenticated;

-- Check after applying (expect false, false, true, then true for the last line):
--   select has_function_privilege('authenticated', 'public.agents_slots_in_hours(uuid, timestamptz[])', 'execute') slots_authed,
--          has_function_privilege('authenticated', 'public.log_missed_transfer(text)', 'execute') log_authed,
--          has_function_privilege('service_role', 'public.log_missed_transfer(text)', 'execute') log_service;
--   select has_function_privilege('authenticated', 'public.va_next_open_slot(uuid)', 'execute');
