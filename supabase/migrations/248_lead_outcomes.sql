-- p902_lead_outcomes — after the speed-to-lead call: one outcome per first call, and the right texts for each
-- (Prompt 902; brain/ohvara/Lead Text Workflows.md, Brayden Nov 7 22:43 and Nov 8 14:36).
--
-- NOT NUMBERED, NOT APPLIED. P904 numbers and applies it, AFTER p892_ai_caller, 230_ghl_integration, 215_lead_outcomes,
-- 175_va_desk, 180_agent_inbounds and 122_no_answer_recovery. Additive: new columns, functions and triggers; the
-- ai_calls outcome check and the ghl_outbox event check are re-created wider; ai_caller_result / ai_caller_sweep are
-- re-created (P892's VA hand-off is gone); ghl_claim_outbox is re-created with one more column (detail). Nothing is
-- dropped but the hand-off trigger; P696's tables stay, its flow is switched off.
--
-- The rules (single source: supabase/functions/_shared/leadFlows.js; src/p902.test.js checks this file agrees):
--   * A new lead gets a CALL first, never a text (route_new_lead is unchanged: AI within 10 s, else a VA).
--   * Each first call ends in one outcome: no_answer · booked · transferred · not_now (with or without a time) · hard_no
--     · wrong_number · opt_out. lead_first_call_outcome() stores it once, writes the timeline row and queues a
--     `call_outcome` event for GoHighLevel (ghl_outbox.detail carries the fields Jordan's workflows read).
--   * Only no_answer and booked (not_now WITH a time counts as booked) start a text flow. GoHighLevel sends the texts:
--       no_answer → the contact is added to ghl_settings.workflow_no_answer;
--       booked    → the lead's stage moves to booked, which already sends P850's appointment_reminder event.
--     Ohvara's own call steps of the no-answer flow (later today, next morning, day 3) are P882 callback tasks, one at
--     a time (lead_flows_sweep). Day 97 with no answer closes the lead: Couldn't reach.
--   * Transferred / hard_no / wrong_number / not_now without a time / opt_out: no texts. Wrong number closes the lead
--     as a bad lead and puts it on admin's Lead quality list (admin_lead_quality_view).
--   * Anything the lead does stops the current flow and starts the right one (lead_flow_action): answers a later call,
--     replies, books by link (or the team books them), opts out. A stopped no-answer flow sends `flow_stop` (removes
--     the contact from the no-answer workflow) and cancels its open call task.
--   * The AI never hands a new lead to a VA (P892's ai_handoff path is retired). A failed AI call counts as no answer.
--   * P696 (the old no-answer recovery on booked calls) is superseded: recovery_config.no_answer_recovery_live (off)
--     gates it, its sweep cron is unscheduled and recovery-sms skips its queue.

do $$
begin
  if to_regclass('public.ai_calls') is null then raise exception 'p902 needs p892_ai_caller applied first'; end if;
  if to_regclass('public.ghl_outbox') is null then raise exception 'p902 needs 230_ghl_integration applied first'; end if;
  if to_regclass('public.inbound_events') is null then raise exception 'p902 needs 180_agent_inbounds applied first'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'outcome_reason') then
    raise exception 'p902 needs 215_lead_outcomes applied first';
  end if;
  if to_regprocedure('public.recovery_after_no_answer(uuid)') is null then raise exception 'p902 needs 122_no_answer_recovery applied first'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'first_call_outcome') then
    raise exception 'p902: leads.first_call_outcome already exists';
  end if;
end $$;

-- ── 1. The outcome and the flow, on the lead ────────────────────────────────────────────────────────────────────
alter table public.leads
  add column first_call_outcome text check (first_call_outcome is null or first_call_outcome in (
               'no_answer', 'booked', 'transferred', 'not_now', 'hard_no', 'wrong_number', 'opt_out')),
  add column first_call_at       timestamptz,
  add column first_call_by       text check (first_call_by is null or first_call_by in ('ai', 'va')),
  add column first_call_callback_at timestamptz,          -- not_now with a time (booked as a callback)
  add column text_flow           text check (text_flow is null or text_flow in ('no_answer', 'booked')),
  add column text_flow_started_at timestamptz,
  add column text_flow_stopped_at timestamptz,
  add column text_flow_stop_reason text check (text_flow_stop_reason is null or text_flow_stop_reason in (
               'answered', 'replied', 'confirmed', 'booked_link', 'booked', 'opted_out', 'closed')),
  add column text_flow_calls     int not null default 0 check (text_flow_calls between 0 and 3),  -- no-answer call tasks made
  add column bad_lead_at         timestamptz,
  add column bad_lead_reason     text check (bad_lead_reason is null or char_length(bad_lead_reason) <= 120);
create index leads_text_flow_idx on public.leads (text_flow_started_at) where text_flow = 'no_answer' and text_flow_stopped_at is null;
create index leads_bad_lead_idx on public.leads (bad_lead_at desc) where bad_lead_at is not null;

-- The AI's call results are the first-call outcomes now ('reached' / 'handed_to_va' stay valid for old rows only).
alter table public.ai_calls drop constraint if exists ai_calls_outcome_check;
alter table public.ai_calls add constraint ai_calls_outcome_check check (outcome is null or outcome in (
  'no_answer', 'booked', 'transferred', 'not_now', 'hard_no', 'wrong_number', 'opt_out', 'reached', 'handed_to_va'));
alter table public.ai_calls add column if not exists callback_at timestamptz;

-- P696 is superseded by the no-answer flow: off, tables kept.
alter table public.recovery_config add column if not exists no_answer_recovery_live boolean not null default false;

-- ── 2. GoHighLevel: two more events, the fields they carry, one more workflow ───────────────────────────────────
alter table public.ghl_outbox drop constraint if exists ghl_outbox_event_check;
alter table public.ghl_outbox add constraint ghl_outbox_event_check
  check (event in ('new_inbound', 'stage', 'appointment_reminder', 'no_show', 'opt_out', 'call_outcome', 'flow_stop'));
alter table public.ghl_outbox add column if not exists detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object');
alter table public.ghl_settings add column if not exists workflow_no_answer text
  check (workflow_no_answer is null or workflow_no_answer ~ '^[A-Za-z0-9-]{6,64}$');
grant update (workflow_no_answer) on public.ghl_settings to authenticated;

-- Same claim as 230, plus detail (the call_outcome / flow_stop fields).
drop function if exists public.ghl_claim_outbox(int);
create function public.ghl_claim_outbox(p_limit int default 25)
 returns table (id bigint, event text, lead_id uuid, stage text, contact_id text,
                contact_name text, phone text, email text, state text, detail jsonb)
 language plpgsql volatile security definer set search_path to 'public'
as $$
begin
  return query
  with due as (
    select o.id from ghl_outbox o
     where o.done_at is null and o.next_try_at <= now()
     order by o.next_try_at, o.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
       for update skip locked
  ), claimed as (
    update ghl_outbox o set attempts = o.attempts + 1, next_try_at = now() + interval '5 minutes'
      from due where o.id = due.id
    returning o.id, o.event, o.lead_id, o.stage, o.phone, o.detail
  )
  select c.id, c.event, c.lead_id, coalesce(c.stage, l.inbound_stage), gc.contact_id,
         nullif(btrim(coalesce(l.contact_name, '')), ''),
         coalesce(public.sms_e164(l.phone), public.sms_e164(c.phone), c.phone, l.phone),
         nullif(btrim(coalesce(l.email, '')), ''), l.state, c.detail
    from claimed c
    left join leads l on l.id = c.lead_id
    left join ghl_contacts gc on gc.lead_id = c.lead_id
   order by c.id;
end;
$$;
revoke execute on function public.ghl_claim_outbox(int) from public, anon, authenticated;
grant  execute on function public.ghl_claim_outbox(int) to service_role;

-- ── 3. Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
-- The lead's own time zone: the form's answer, else the agent's, else Central.
create or replace function public.lead_tz(p_lead uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(l.qualifier_answers ->> 'tz', ''), p.timezone, 'America/Chicago')
    from public.leads l left join public.profiles p on p.id = l.assigned_rep_id where l.id = p_lead
$$;
revoke execute on function public.lead_tz(uuid) from public, anon, authenticated;

-- A local wall-clock time on a day after p_from's local date, in zone p_tz.
create or replace function public.lead_local_at(p_from timestamptz, p_days int, p_time time, p_tz text) returns timestamptz
language sql immutable as $$
  select (((p_from at time zone p_tz)::date + p_days) + p_time) at time zone p_tz
$$;

-- The no-answer flow's call steps (leadFlows.js FLOW_STEPS.no_answer, kind call): when call k (1..3) is due.
-- 1: about 3 hours after the flow starts, only if that's still before 7:30 PM local; 2: the next morning 9:30;
-- 3: day 3 at 10:00. Returns null for a step that is skipped.
create or replace function public.lead_flow_call_due(p_start timestamptz, p_k int, p_tz text) returns timestamptz
language plpgsql immutable as $$
declare t timestamptz;
begin
  if p_k = 1 then
    t := p_start + interval '3 hours';
    if (t at time zone p_tz)::date <> (p_start at time zone p_tz)::date or (t at time zone p_tz)::time > time '19:30' then return null; end if;
    if (t at time zone p_tz)::time < time '08:00' then t := public.lead_local_at(p_start, 0, time '08:00', p_tz); end if;
    return t;
  elsif p_k = 2 then return public.lead_local_at(p_start, 1, time '09:30', p_tz);
  elsif p_k = 3 then return public.lead_local_at(p_start, 3, time '10:00', p_tz);
  end if;
  return null;
end;
$$;

-- Queue one GoHighLevel event (only while the bridge is on; never blocks the caller).
create or replace function public.lead_ghl_event(p_event text, p_lead uuid, p_detail jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ghl_enabled() or exists (select 1 from public.leads where id = p_lead and coalesce(is_sample, false)) then return; end if;
  insert into public.ghl_outbox (event, lead_id, detail) values (p_event, p_lead, coalesce(p_detail, '{}'::jsonb));
exception when others then raise warning 'lead_ghl_event %: %', p_event, sqlerrm;
end;
$$;
revoke execute on function public.lead_ghl_event(text, uuid, jsonb) from public, anon, authenticated;

-- ── 4. One outcome per first call ───────────────────────────────────────────────────────────────────────────────
-- p_by: 'ai' (ai_caller_result) or 'va' (the VA desk's first result, trigger below). Recorded once: a later call's
-- result goes through lead_flow_action instead. Returns { ok, outcome, flow }.
create or replace function public.lead_first_call_outcome(p_lead uuid, p_outcome text, p_by text,
  p_callback_at timestamptz default null, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.leads; flow text; tz text; secs int; ag public.profiles; appt timestamptz; label text;
begin
  if p_outcome not in ('no_answer', 'booked', 'transferred', 'not_now', 'hard_no', 'wrong_number', 'opt_out') then
    raise exception 'unknown first-call outcome %', p_outcome using errcode = '22023';
  end if;
  if p_by not in ('ai', 'va') then raise exception 'unknown caller %', p_by using errcode = '22023'; end if;
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then return jsonb_build_object('ok', false, 'code', 'no_lead'); end if;
  if l.first_call_outcome is not null then return jsonb_build_object('ok', false, 'code', 'already', 'outcome', l.first_call_outcome); end if;

  flow := case when p_outcome = 'no_answer' then 'no_answer'
               when p_outcome = 'booked' or (p_outcome = 'not_now' and p_callback_at is not null) then 'booked' end;
  tz := public.lead_tz(p_lead);
  select * into ag from public.profiles where id = l.assigned_rep_id;
  select round(secs_to_dial) into secs from public.ai_calls where lead_id = p_lead and attempt = 1;
  appt := coalesce(p_callback_at, (select booked_for from public.ai_calls where lead_id = p_lead and booked_for is not null order by attempt desc limit 1));

  update public.leads set
    first_call_outcome = p_outcome, first_call_at = now(), first_call_by = p_by, first_call_callback_at = p_callback_at,
    text_flow = flow, text_flow_started_at = case when flow is not null then now() end
   where id = p_lead;

  -- GoHighLevel first (the contact's fields are set before the stage change below starts a workflow).
  perform public.lead_ghl_event('call_outcome', p_lead, jsonb_build_object(
    'ohvara_lead_id', p_lead, 'first_call_outcome', p_outcome, 'text_flow', coalesce(flow, 'none'), 'called_by', p_by,
    'called_in_secs', secs, 'call_at', now(),
    'appointment_at', case when flow = 'booked' then appt end,
    'appointment_local', case when flow = 'booked' and appt is not null then to_char(appt at time zone tz, 'Dy "at" FMHH12:MI AM') end,
    'lead_tz', tz, 'agent_name', nullif(split_part(coalesce(ag.full_name, ''), ' ', 1), ''), 'agent_phone', ag.phone,
    'booking_link', nullif(p_detail ->> 'booking_link', '')));

  -- Where the lead lands (leadFlows.js landingFor).
  case p_outcome
    when 'booked' then
      update public.leads set inbound_stage = 'booked' where id = p_lead and inbound_stage is distinct from 'booked';
    when 'not_now' then
      if p_callback_at is not null then
        update public.leads set inbound_stage = 'booked', va_outcome = 'callback', va_callback_at = p_callback_at where id = p_lead;
        insert into public.inbound_events (lead_id, agent_id, kind, at, label, detail, actor_name, actor_role)
        values (p_lead, l.assigned_rep_id, 'booked', now(), 'Callback booked for ' || to_char(p_callback_at at time zone tz, 'Dy, Mon FMDD at FMHH12:MI AM'),
                jsonb_build_object('appointment_at', p_callback_at, 'callback', true), 'Our team', 'team');
      else
        update public.leads set inbound_stage = 'follow_up', outcome = 'follow_up', outcome_reason = 'Not a good time on the first call',
               outcome_at = now() where id = p_lead;
      end if;
    when 'hard_no' then
      update public.leads set inbound_stage = 'lost', outcome = 'not_interested', outcome_reason = 'Not interested on the first call',
             outcome_at = now() where id = p_lead;
    when 'wrong_number' then
      update public.leads set inbound_stage = 'lost', outcome = 'not_interested', outcome_reason = 'Wrong number', outcome_at = now(),
             bad_lead_at = now(), bad_lead_reason = coalesce(nullif(p_detail ->> 'reason', ''), 'Wrong number') where id = p_lead;
    when 'opt_out' then
      perform public.mark_do_not_call(null, p_lead, null, 'Asked on the first call not to be called');
    else null; -- no_answer: the lead stays in contacting; transferred: the agent's result decides
  end case;

  label := case flow when 'no_answer' then 'No-answer texts started' when 'booked' then 'Booking texts started' end;
  if p_outcome = 'wrong_number' then label := 'Closed: wrong number. Flagged for lead quality'; end if;
  if label is not null then
    insert into public.inbound_events (lead_id, agent_id, kind, at, label, detail, actor_name, actor_role)
    values (p_lead, l.assigned_rep_id, 'outcome', now(), label,
            jsonb_build_object('first_call_outcome', p_outcome, 'text_flow', flow, 'by', p_by), 'Automatic', 'system');
  end if;
  return jsonb_build_object('ok', true, 'outcome', p_outcome, 'flow', flow);
end;
$$;
revoke execute on function public.lead_first_call_outcome(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant  execute on function public.lead_first_call_outcome(uuid, text, text, timestamptz, jsonb) to service_role;

-- ── 5. Anything the lead does stops the flow and starts the right one ───────────────────────────────────────────
-- leadFlows.js onAction. answered / replied / confirmed stop the no-answer flow (a reply also makes a call task for our
-- team); booked_link / booked start the booked flow (the stage change sends GoHighLevel's reminder workflow);
-- opted_out stops everything. A confirm or a question during the booked flow keeps its reminders.
create or replace function public.lead_flow_action(p_lead uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads; stop_ boolean := false; start_ text; task boolean := false; note text;
begin
  if p_action not in ('answered', 'replied', 'confirmed', 'booked_link', 'booked', 'opted_out') then
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then return jsonb_build_object('ok', false, 'code', 'no_lead'); end if;
  if l.text_flow is null or l.text_flow_stopped_at is not null then
    if p_action not in ('booked_link', 'booked') or l.first_call_outcome is null then return jsonb_build_object('ok', true, 'changed', false); end if;
  end if;
  if p_action = 'opted_out' then stop_ := true; note := 'Opted out: every call and text stopped';
  elsif p_action in ('booked_link', 'booked') then
    stop_ := l.text_flow = 'no_answer' and l.text_flow_stopped_at is null; start_ := 'booked'; note := 'Booked: booking texts started';
  elsif l.text_flow = 'no_answer' and l.text_flow_stopped_at is null then
    stop_ := true;
    task := p_action in ('replied', 'confirmed');
    note := case when task then 'They replied: no-answer texts stopped, our team calls them' else 'They answered: no-answer texts stopped' end;
  end if;
  if not stop_ and start_ is null then return jsonb_build_object('ok', true, 'changed', false); end if;

  if stop_ then
    update public.leads set text_flow_stopped_at = now(), text_flow_stop_reason = p_action where id = p_lead;
    if l.text_flow = 'no_answer' then
      perform public.lead_ghl_event('flow_stop', p_lead, jsonb_build_object('ohvara_lead_id', p_lead, 'text_flow', 'no_answer', 'action', p_action));
      update public.call_queue set status = 'cancelled', cancel_reason = 'flow_stopped:' || p_action
       where lead_id = p_lead and kind = 'callback' and detail ->> 'flow' = 'no_answer' and status in ('held', 'waiting', 'offered');
    end if;
  end if;
  if start_ = 'booked' then
    update public.leads set text_flow = 'booked', text_flow_started_at = now(), text_flow_stopped_at = null, text_flow_stop_reason = null
     where id = p_lead;
  end if;
  if task then
    begin
      perform public.route_enqueue('callback', p_lead, p_due => now(), p_detail => jsonb_build_object('flow_reply', true, 'why', 'replied to a no-answer text'));
    exception when others then raise warning 'lead_flow_action call task %: %', p_lead, sqlerrm;
    end;
  end if;
  insert into public.inbound_events (lead_id, agent_id, kind, at, label, detail, actor_name, actor_role)
  values (p_lead, l.assigned_rep_id, 'follow_up', now(), note, jsonb_build_object('flow_action', p_action, 'from_flow', l.text_flow, 'to_flow', start_), 'Automatic', 'system');
  return jsonb_build_object('ok', true, 'changed', true, 'stopped', stop_, 'started', start_);
end;
$$;
revoke execute on function public.lead_flow_action(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.lead_flow_action(uuid, text, jsonb) to service_role;

-- The hooks: a text back (GoHighLevel's or Twilio's log), a booking, a STOP, and the VA desk's results.
create or replace function public.lead_flow_on_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'text_received' and new.state = 'done' then
    perform public.lead_flow_action(new.lead_id,
      case when upper(btrim(coalesce(new.detail ->> 'body', new.label, ''))) in ('C', 'YES', 'CONFIRM') then 'confirmed' else 'replied' end);
  elsif new.kind in ('booked', 'rebooked') and new.state <> 'skipped' and coalesce(new.detail ->> 'callback', '') <> 'true' then
    perform public.lead_flow_action(new.lead_id, case when new.actor_role = 'lead' then 'booked_link' else 'booked' end);
  end if;
  return new;
exception when others then raise warning 'lead_flow_on_event %: %', new.lead_id, sqlerrm; return new;
end;
$$;
drop trigger if exists inbound_events_lead_flow on public.inbound_events;
create trigger inbound_events_lead_flow after insert on public.inbound_events
  for each row execute function public.lead_flow_on_event();

create or replace function public.lead_flow_on_opt_out() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.opted_out then
    for r in select id from public.leads where public.sms_e164(phone) = new.phone and text_flow is not null and text_flow_stopped_at is null loop
      perform public.lead_flow_action(r.id, 'opted_out');
    end loop;
  end if;
  return new;
exception when others then raise warning 'lead_flow_on_opt_out: %', sqlerrm; return new;
end;
$$;
drop trigger if exists sms_opt_outs_lead_flow on public.sms_opt_outs;
create trigger sms_opt_outs_lead_flow after insert or update of opted_out on public.sms_opt_outs
  for each row execute function public.lead_flow_on_opt_out();

-- The VA desk's result on a lead (leads.va_outcome). No first call yet and the AI isn't calling it → the VA's result
-- is the first-call outcome (leadFlows.js fromVaOutcome). Already in the no-answer flow → they answered a later call.
create or replace function public.lead_flow_on_va_result() returns trigger
language plpgsql security definer set search_path = public as $$
declare o text;
begin
  if new.va_outcome is null or new.va_outcome is not distinct from old.va_outcome and new.va_attempts is not distinct from old.va_attempts then return new; end if;
  if new.first_call_outcome is null then
    if exists (select 1 from public.ai_calls a where a.lead_id = new.id and a.status <> 'to_va') then return new; end if; -- the AI owns it
    o := case new.va_outcome when 'not_reached' then 'no_answer' when 'booked' then 'booked' when 'transferred' then 'transferred'
           when 'callback' then 'not_now'
           when 'not_interested' then case when coalesce(new.outcome_reason, '') ilike '%wrong number%' then 'wrong_number' else 'hard_no' end end;
    if o is not null then
      perform public.lead_first_call_outcome(new.id, o, 'va', case when o = 'not_now' then new.va_callback_at end);
    end if;
  elsif new.text_flow = 'no_answer' and new.text_flow_stopped_at is null and new.va_outcome <> 'not_reached' then
    perform public.lead_flow_action(new.id, case when new.va_outcome = 'booked' then 'booked' else 'answered' end);
  end if;
  return new;
exception when others then raise warning 'lead_flow_on_va_result %: %', new.id, sqlerrm; return new;
end;
$$;
drop trigger if exists leads_lead_flow_va on public.leads;
create trigger leads_lead_flow_va after update of va_outcome, va_attempts on public.leads
  for each row execute function public.lead_flow_on_va_result();

-- ── 6. The no-answer flow's own steps: one call task at a time, then Couldn't reach at day 97 ─────────────────────
create or replace function public.lead_flows_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; due timestamptz; k int; made int := 0; closed int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('lead_flows_sweep')) then return jsonb_build_object('skipped', true); end if;
  for r in select l.id, l.text_flow_started_at, l.text_flow_calls from public.leads l
            where l.text_flow = 'no_answer' and l.text_flow_stopped_at is null and l.text_flow_calls < 3 loop
    k := r.text_flow_calls + 1;
    due := public.lead_flow_call_due(r.text_flow_started_at, k, public.lead_tz(r.id));
    while due is null and k < 3 loop k := k + 1; due := public.lead_flow_call_due(r.text_flow_started_at, k, public.lead_tz(r.id)); end loop;
    if due is null or due > now() then continue; end if;
    if exists (select 1 from public.call_queue q where q.lead_id = r.id and q.kind = 'callback' and q.status in ('held', 'waiting', 'offered')) then continue; end if;
    begin
      perform public.route_enqueue('callback', r.id, p_due => due, p_detail => jsonb_build_object('flow', 'no_answer', 'step', k));
      update public.leads set text_flow_calls = k where id = r.id;
      made := made + 1;
    exception when others then raise warning 'lead_flows_sweep call %: %', r.id, sqlerrm;
    end;
  end loop;
  for r in select l.id, l.assigned_rep_id from public.leads l
            where l.text_flow = 'no_answer' and l.text_flow_stopped_at is null
              and l.text_flow_started_at < now() - interval '97 days' loop
    update public.leads set text_flow_stopped_at = now(), text_flow_stop_reason = 'closed', inbound_stage = 'lost',
           outcome_reason = 'Couldn''t reach' where id = r.id;
    insert into public.inbound_events (lead_id, agent_id, kind, at, label, detail, actor_name, actor_role)
    values (r.id, r.assigned_rep_id, 'outcome', now(), 'Closed: couldn''t reach. No reply after the day 90 check-in',
            jsonb_build_object('flow_closed', 'no_answer'), 'Automatic', 'system');
    closed := closed + 1;
  end loop;
  return jsonb_build_object('call_tasks', made, 'closed', closed);
end;
$$;
revoke execute on function public.lead_flows_sweep() from public, anon, authenticated;
do $$ begin
  perform cron.schedule('lead-flows-sweep', '*/5 * * * *', 'select public.lead_flows_sweep()');
exception when others then raise notice 'lead-flows-sweep cron not scheduled: %', sqlerrm;
end $$;

-- ── 7. The AI caller: the new outcomes, no hand-off ─────────────────────────────────────────────────────────────
create or replace function public.ai_caller_result(p_call uuid, p_outcome text, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.ai_calls; nxt uuid; secs int; label text; ag uuid; cb timestamptz; fc jsonb;
begin
  if p_outcome not in ('no_answer', 'booked', 'transferred', 'not_now', 'hard_no', 'wrong_number', 'opt_out') then
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  cb := case when p_outcome = 'not_now' then nullif(p_patch ->> 'callback_at', '')::timestamptz end;
  update public.ai_calls set status = 'done', outcome = p_outcome, ended_at = now(),
    duration_secs  = coalesce((p_patch ->> 'duration_secs')::int, duration_secs),
    cost_cents     = coalesce((p_patch ->> 'cost_cents')::numeric,
                       ceil(coalesce((p_patch ->> 'duration_secs')::int, 0) / 60.0) * (select cents_per_min from public.ai_caller_settings where id)),
    booked_for     = coalesce((p_patch ->> 'booked_for')::timestamptz, booked_for),
    callback_at    = coalesce(cb, callback_at),
    summary        = coalesce(left(p_patch ->> 'summary', 1200), summary),
    transcript_ref = coalesce(p_patch ->> 'transcript_ref', transcript_ref),
    updated_at     = now()
   where id = p_call and status <> 'done' returning * into c;
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'gone'); end if;

  -- Speed is from the lead arriving to the FIRST dial (attempt 1). Agent-safe words (rules.js agentLine), never "AI".
  select round(secs_to_dial) into secs from public.ai_calls where lead_id = c.lead_id and attempt = 1;
  label := 'Called' || case when secs is null then '' else ' in ' || secs || ' second' || case when secs = 1 then '' else 's' end end || '. ' ||
           case p_outcome when 'booked' then 'Reached them. Booked' when 'transferred' then 'Reached them. Live transfer to you'
                          when 'not_now' then case when cb is not null then 'Reached them. Booked a callback' else 'Reached them. Not a good time' end
                          when 'hard_no' then 'Reached them. Not interested' when 'wrong_number' then 'Wrong number'
                          when 'no_answer' then 'No answer' when 'opt_out' then 'Asked not to be called' end;
  select assigned_rep_id into ag from public.leads where id = c.lead_id;
  insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
  values (c.lead_id, ag, 'va_call', label, jsonb_build_object('speed_secs', secs, 'result', p_outcome, 'try', c.attempt), 'Our team', 'team');

  if p_outcome = 'no_answer' and c.attempt = 1 then
    -- One more try 2 minutes later; the outcome waits for it.
    insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, due_at, provider)
    values (c.lead_id, c.agent_id, 2, c.lead_in_at, now() + interval '2 minutes', c.provider)
    on conflict do nothing returning id into nxt;
    if nxt is not null then return jsonb_build_object('ok', true, 'retry_call', nxt, 'label', label); end if;
  end if;
  fc := public.lead_first_call_outcome(c.lead_id, p_outcome, 'ai', cb);
  return jsonb_build_object('ok', true, 'retry_call', nxt, 'label', label, 'first_call', fc);
end;
$$;
revoke execute on function public.ai_caller_result(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.ai_caller_result(uuid, text, jsonb) to service_role;

-- The hand-off is retired: the function refuses, the trigger is gone, the sweep no longer expires hand-offs.
create or replace function public.ai_caller_handoff(p_call uuid, p_reason text, p_summary text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'ai_caller_handoff is retired (P902): the AI never hands a new lead to a VA' using errcode = '0A000';
end;
$$;
revoke execute on function public.ai_caller_handoff(uuid, text, text) from public, anon, authenticated;
drop trigger if exists call_queue_ai_handoff_taken on public.call_queue;
update public.call_queue set status = 'cancelled', cancel_reason = 'ai_handoff_retired'
 where kind = 'ai_handoff' and status in ('held', 'waiting', 'offered');

create or replace function public.ai_caller_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; started int := 0; to_va int := 0; na int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('ai_caller_sweep')) then return jsonb_build_object('skipped', true); end if;
  -- Attempt 2 due: re-check the rules (an opt-out, the window, the switch) before dialling. Blocked → no answer.
  for r in select c.* from public.ai_calls c where c.status = 'queued' and c.attempt = 2 and c.due_at <= now() and c.updated_at < now() - interval '5 seconds' loop
    if (select by from public.ai_caller_takes(r.lead_id)) = 'ai' then
      update public.ai_calls set updated_at = now() where id = r.id;
      perform public.ai_caller_post(jsonb_build_object('action', 'start', 'call_id', r.id)); started := started + 1;
    else
      perform public.ai_caller_result(r.id, 'no_answer', jsonb_build_object('summary', 'retry_blocked')); na := na + 1;
    end if;
  end loop;
  -- Attempt 1 never started in 20 s (the function or the provider is down): the VA desk calls the lead instead, as
  -- when the AI is off. Not a hand-off: no call happened.
  for r in select c.id from public.ai_calls c where c.status = 'queued' and c.attempt = 1 and c.created_at < now() - interval '20 seconds' loop
    perform public.ai_caller_to_va(r.id, 'not_started'); to_va := to_va + 1;
  end loop;
  -- Attempt 2 never started in 60 s: counts as no answer.
  for r in select c.id from public.ai_calls c where c.status = 'queued' and c.attempt = 2 and c.due_at < now() - interval '60 seconds' loop
    perform public.ai_caller_result(r.id, 'no_answer', jsonb_build_object('summary', 'not_started')); na := na + 1;
  end loop;
  return jsonb_build_object('started', started, 'to_va', to_va, 'no_answer', na);
end;
$$;
revoke execute on function public.ai_caller_sweep() from public, anon, authenticated;

-- ── 8. P696 superseded: its flow is switched off, its crons removed, its tables kept ─────────────────────────────
alter function public.recovery_after_no_answer(uuid) rename to recovery_after_no_answer_p696;
create function public.recovery_after_no_answer(p_policy uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select no_answer_recovery_live from public.recovery_config limit 1), false) then return; end if;
  perform public.recovery_after_no_answer_p696(p_policy);
end;
$$;
revoke all on function public.recovery_after_no_answer(uuid) from public, anon, authenticated;
revoke all on function public.recovery_after_no_answer_p696(uuid) from public, anon, authenticated;
do $$ begin
  perform cron.unschedule('recovery-sweep');
exception when others then raise notice 'recovery-sweep cron: %', sqlerrm;
end $$;
-- The recovery-sms cron stays: it also sends P771's missed-by-us texts. The function skips P696's queue while
-- no_answer_recovery_live is off.

-- ── 9. Admin: Lead quality (bad leads from the first call) ──────────────────────────────────────────────────────
create or replace function public.admin_lead_quality_view(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'lead_id', l.id, 'name', l.contact_name, 'state', l.state, 'agent_id', l.assigned_rep_id, 'agent', p.full_name,
      'at', l.bad_lead_at, 'reason', l.bad_lead_reason, 'by', l.first_call_by,
      'campaign', (select g.campaign_name from public.ghl_campaign_agents g where g.agent_id = l.assigned_rep_id limit 1)
    ) order by l.bad_lead_at desc)
    from public.leads l left join public.profiles p on p.id = l.assigned_rep_id
   where l.bad_lead_at is not null and coalesce(l.is_sample, false) = false
     and (p_from is null or l.bad_lead_at >= p_from) and (p_to is null or l.bad_lead_at < p_to + 1)), '[]'::jsonb);
exception when undefined_table or undefined_column then
  -- ghl_campaign_agents (232) not applied yet: the list without the campaign.
  return coalesce((select jsonb_agg(jsonb_build_object('lead_id', l.id, 'name', l.contact_name, 'state', l.state, 'agent_id', l.assigned_rep_id,
           'at', l.bad_lead_at, 'reason', l.bad_lead_reason, 'by', l.first_call_by) order by l.bad_lead_at desc)
           from public.leads l where l.bad_lead_at is not null), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_lead_quality_view(date, date) from public, anon;
grant  execute on function public.admin_lead_quality_view(date, date) to authenticated;

-- Check after applying:
--   select first_call_outcome, text_flow from public.leads limit 1;                       -- columns exist
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'ghl_outbox_event_check';  -- has call_outcome
--   select jobname from cron.job where jobname in ('recovery-sweep', 'lead-flows-sweep');  -- only lead-flows-sweep
