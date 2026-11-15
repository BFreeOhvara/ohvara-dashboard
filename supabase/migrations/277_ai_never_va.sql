-- 277_ai_never_va — VAs never call new leads (Prompt 1014; Brayden Nov 15, found in P1008).
--
-- Before: ai_caller_takes() sent a new lead to a VA whenever the AI couldn't take it (switch off, agent not on, no AI
-- consent, outside hours, do-not-call), the insert trigger rang a VA (route_enqueue('new_lead')), a call the AI
-- couldn't start went to a VA, and a reply to a no-answer text (lead_flow_action), the no-answer flow's call steps
-- (lead_flows_sweep) and a callback the AI booked (route_tick part d) became VA callback tasks.
--
-- Now (Brayden's rules):
--   1. Outside calling hours → wait_hours: the AI calls at the next allowed moment (the lead's state and time zone,
--      predial_eval's next_at).
--   2. Do-not-call (STOP, our list, the national list without written consent) → blocked_dnc: nobody calls, ever.
--   3. No AI consent on the lead → blocked_no_consent: nobody calls; every admin is told (it should never happen).
--   4. The AI caller switched off (before launch) → wait_switch_off: the lead waits in line; nobody calls. Also an
--      agent not on the AI's list. A lead with no agent yet waits as wait_agent and is routed when it gets one.
--   5. A reply to a no-answer text → the AI calls them back (purpose 'reply'); no VA task.
--   A call the AI couldn't start (provider down, not started in 20 s) → wait_retry: tried again in 5, 10 … 60 minutes.
--   The no-answer flow's call steps and a callback the AI booked are the AI's calls too (P931: lead calls are the AI's).
--   VAs keep inbound calls, hold-line callbacks, missed live transfers and every client / servicing call.
--
-- Pieces:
--   * ai_calls.purpose: first | retry | reply | flow | callback (the 2-minute retry used to be "attempt = 2").
--   * ai_lead_waits: one row per lead that waits or is blocked (admin read only). The reasons also go on the lead's
--     timeline in words an agent can read (never "AI").
--   * ai_caller_takes(lead) → (by, reason, state, next_at). by: ai | wait | blocked | none. Never 'va'. The reason
--     codes are the old ones (switch_off, agent_not_on, no_ai_consent, outside_hours, dnc, …), state is the new state.
--   * ai_route_lead(lead, purpose, due): the one router. ai_caller_not_dialed(call, reason): a call that didn't start.
--     ai_caller_to_va keeps its name for the deployed edge function and now only calls ai_caller_not_dialed.
--   * A guard on call_queue: a new_lead item, or a callback the AI owns, never reaches a VA (it is stored cancelled,
--     reason ai_calls, and handed to ai_route_lead). This catches every old caller of route_enqueue at once.
--   * va_queue(): no form leads (mortgage_protection) in the VA desk's queue unless P213 put a step there.
--   Test-account and sample leads are never called (nobody, as before for the AI).

do $$
begin
  if to_regprocedure('public.ai_caller_takes(uuid)') is null or to_regprocedure('public.reactivation_callable(reactivation_contacts,reactivation_lists)') is null then
    raise exception '277 needs 244_ai_caller and 269_reactivation_per_delivered applied first';
  end if;
  if to_regprocedure('public.lead_flow_action(uuid,text,jsonb)') is null then raise exception '277 needs 248_lead_outcomes applied first'; end if;
  if to_regclass('public.ai_lead_waits') is not null then raise exception '277: ai_lead_waits already exists'; end if;
end $$;

-- ── 1. What each AI call is for ───────────────────────────────────────────────────────────────────────────────────
alter table public.ai_calls add column if not exists purpose text not null default 'first';
alter table public.ai_calls drop constraint if exists ai_calls_purpose_check;
alter table public.ai_calls add constraint ai_calls_purpose_check check (purpose in ('first', 'retry', 'reply', 'flow', 'callback'));
update public.ai_calls set purpose = 'retry' where attempt = 2 and reactivation_contact_id is null and purpose = 'first';
alter table public.ai_calls drop constraint if exists ai_calls_attempt_check;
alter table public.ai_calls add constraint ai_calls_attempt_check check (attempt between 1 and 30);
comment on column public.ai_calls.to_va_reason is 'Why the call was not dialed (P1014: never a VA; status to_va = not dialed).';

-- ── 2. Leads that wait or are blocked ─────────────────────────────────────────────────────────────────────────────
create table public.ai_lead_waits (
  lead_id    uuid primary key references public.leads(id) on delete cascade,
  state      text not null check (state in ('wait_hours', 'wait_switch_off', 'wait_agent', 'wait_retry', 'blocked_dnc', 'blocked_no_consent')),
  reason     text not null,                                   -- the rule's code: outside_hours, switch_off, dnc, …
  purpose    text not null default 'first' check (purpose in ('first', 'reply', 'flow', 'callback')),
  next_at    timestamptz,                                     -- when the sweep looks again (waits only)
  tries      int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_lead_waits_due_idx on public.ai_lead_waits (next_at) where state like 'wait%';
alter table public.ai_lead_waits enable row level security;
revoke all on public.ai_lead_waits from public, anon, authenticated;
grant select on public.ai_lead_waits to authenticated;
create policy ai_lead_waits_admin_read on public.ai_lead_waits for select to authenticated using (public.is_admin());

insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select 'ai_lead_not_called', array['admin'], 'A new lead can''t be called (consent missing, or the call won''t start)', false, null, true, true,
       false, true, coalesce((select max(sort) from public.notification_types), 0) + 1
 where not exists (select 1 from public.notification_types where type = 'ai_lead_not_called');

-- ── 3. The rules (rules.js whoCalls agrees) ───────────────────────────────────────────────────────────────────────
drop function if exists public.ai_caller_takes(uuid);
create function public.ai_caller_takes(p_lead uuid)
returns table(by text, reason text, state text, next_at timestamptz) language plpgsql stable security definer set search_path = public as $$
declare l public.leads; s public.ai_caller_settings; chk record; rc public.reactivation_contacts; rl public.reactivation_lists; d public.dnc_numbers;
begin
  select * into l from public.leads where id = p_lead;
  -- P952/P957: a person on a reactivation list (its own rules; a call that can't start goes back in its list).
  if l.reactivation_id is not null then
    select * into rc from public.reactivation_contacts where id = l.reactivation_id;
    select * into rl from public.reactivation_lists where id = rc.list_id;
    if public.profile_is_test(l.assigned_rep_id) then return query select 'none', 'test_account', null::text, null::timestamptz; return; end if;
    if not coalesce((select reactivation_live from public.recovery_config limit 1), false) then
      return query select 'wait', 'switch_off', 'wait_switch_off', null::timestamptz; return;
    end if;
    if not public.reactivation_callable(rc, rl) then return query select 'none', 'list_' || coalesce(rl.status, 'missing'), null::text, null::timestamptz; return; end if;
    if exists (select 1 from public.reactivation_deliveries where agent_id = rc.agent_id and status = 'failed') then
      return query select 'wait', 'card_owed', null::text, null::timestamptz; return;
    end if;
    if rc.status not in ('queued', 'calling') then return query select 'none', 'contact_done', null::text, null::timestamptz; return; end if;
    select * into d from public.dnc_numbers where phone = rc.phone;
    if public.sms_is_opted_out(rc.phone) or coalesce(d.internal, false) or coalesce(d.national, false) then
      return query select 'blocked', 'dnc', 'blocked_dnc', null::timestamptz; return;
    end if;
    if not public.reactivation_window_ok(rc.state, now()) then
      return query select 'wait', 'outside_hours', 'wait_hours', public.reactivation_window_next(rc.state, now()); return;
    end if;
    if (public.reactivation_number()).id is null then return query select 'wait', 'no_reactivation_number', null::text, null::timestamptz; return; end if;
    return query select 'ai', null::text, null::text, null::timestamptz; return;
  end if;

  -- Not a fresh form lead (an inbound caller, a live-call ad, a client): nobody's outbound call. VAs answer inbound.
  if l.id is null or l.lead_type is distinct from 'mortgage_protection' or l.phone is null
     or coalesce(l.qualifier_answers ->> 'consent_at', '') = '' or l.call_consent_at is not null then
    return query select 'none', 'not_form', null::text, null::timestamptz; return;
  end if;
  if public.profile_is_test(l.assigned_rep_id) or coalesce(l.is_sample, false) then
    return query select 'none', 'test_account', null::text, null::timestamptz; return;   -- P929: never dialed
  end if;
  -- Do-not-call first: nobody calls it, whatever else is true.
  select * into chk from public.predial_eval(l.phone, l.state, l.id, 'call', now(), null, false);
  if not chk.ok and chk.reason in ('opted_out', 'dnc', 'national_dnc') then
    return query select 'blocked', chk.reason, 'blocked_dnc', null::timestamptz; return;
  end if;
  if not coalesce((select ai_caller_live from public.recovery_config limit 1), false) then
    return query select 'wait', 'switch_off', 'wait_switch_off', null::timestamptz; return;
  end if;
  select * into s from public.ai_caller_settings where id;
  if l.assigned_rep_id is null then return query select 'wait', 'agent_not_on', 'wait_agent', null::timestamptz; return; end if;
  if not (s.all_agents or l.assigned_rep_id = any(s.agent_ids)) then
    return query select 'wait', 'agent_not_on', 'wait_switch_off', null::timestamptz; return;
  end if;
  if not public.lead_ai_consent_ok(p_lead) then return query select 'blocked', 'no_ai_consent', 'blocked_no_consent', null::timestamptz; return; end if;
  if not chk.ok then
    if chk.reason in ('outside_hours', 'attempt_cap', 'unknown_state') then
      return query select 'wait', chk.reason, 'wait_hours', chk.next_at; return;
    end if;
    if chk.reason = 'no_phone' then return query select 'none', 'no_phone', null::text, null::timestamptz; return; end if;
    return query select 'wait', coalesce(chk.reason, 'predial'), 'wait_retry', now() + interval '30 minutes'; return;
  end if;
  return query select 'ai', null::text, null::text, null::timestamptz;
end;
$$;

-- ── 4. Waiting: one row per lead, the reason on its timeline when the state changes ───────────────────────────────
create or replace function public.ai_wait_set(p_lead uuid, p_state text, p_reason text, p_purpose text, p_next timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare prev public.ai_lead_waits; l public.leads; tz text; label text; nxt timestamptz := p_next;
begin
  select * into l from public.leads where id = p_lead;
  if l.id is null then return; end if;
  select * into prev from public.ai_lead_waits where lead_id = p_lead for update;
  if p_state = 'wait_retry' and p_next is null then
    nxt := now() + make_interval(mins => least(60, 5 * (coalesce(prev.tries, 0) + 1)));
  elsif p_state = 'wait_switch_off' then
    nxt := now() + interval '5 minutes';
  elsif p_state = 'wait_agent' then
    nxt := 'infinity';                                                  -- route_lead_assigned routes it

  elsif p_state = 'wait_hours' then
    nxt := coalesce(p_next, now() + interval '1 hour');                 -- unknown state: look again hourly
  elsif p_state like 'blocked%' then
    nxt := null;
  end if;
  insert into public.ai_lead_waits (lead_id, state, reason, purpose, next_at, tries)
  values (p_lead, p_state, left(coalesce(p_reason, p_state), 80), coalesce(p_purpose, 'first'), nxt, case when p_state = 'wait_retry' then 1 else 0 end)
  on conflict (lead_id) do update set state = excluded.state, reason = excluded.reason, purpose = excluded.purpose, next_at = excluded.next_at,
    tries = case when excluded.state = 'wait_retry' then public.ai_lead_waits.tries + 1 else 0 end, updated_at = now();
  if (prev.lead_id is not null and prev.state = p_state) or p_state = 'wait_agent' then return; end if;  -- no agent yet: silent, for a moment

  -- Agent-safe words (agents read the timeline; never "AI").
  tz := public.lead_tz(p_lead);
  label := case p_state
    when 'wait_hours' then case when p_next is null then 'Outside their calling hours. We call once their state''s hours open'
                                else 'Outside their calling hours. We call ' || to_char(p_next at time zone tz, 'Dy "at" FMHH12:MI AM') || ' their time' end
    when 'wait_switch_off' then 'Waiting in line. We call as soon as calling opens'
    when 'wait_agent' then 'Waiting for an agent. We call once they''re matched'
    when 'wait_retry' then 'The call didn''t start. We try again shortly'
    when 'blocked_dnc' then 'Not called: the number is on a do-not-call list'
    when 'blocked_no_consent' then 'Not called: their consent needs checking. Our team has been told' end;
  insert into public.inbound_events (lead_id, agent_id, kind, at, label, detail, actor_name, actor_role)
  values (p_lead, l.assigned_rep_id, 'follow_up', now(), label,
          jsonb_build_object('call_wait', p_state, 'reason', p_reason, 'purpose', coalesce(p_purpose, 'first')), 'Automatic', 'system');
  if p_state = 'blocked_no_consent' then
    perform public.route_notify_admins('ai_lead_not_called', 'A new lead can''t be called: no consent for AI calls',
      coalesce(l.contact_name, l.business_name, 'A lead') || ' signed consent version ' || coalesce(l.qualifier_answers ->> 'consent_text_version', 'none')
        || ', which doesn''t cover AI calls. Nobody will call them. Check the form''s consent wording in AI caller settings.',
      '/admin/inbounds?view=ai', 'ai_no_consent:' || p_lead::text);
  end if;
end;
$$;

-- ── 5. The router: who calls this lead now (never a VA) ───────────────────────────────────────────────────────────
-- p_purpose: first (a new lead) | reply (they texted back) | flow (a no-answer call step) | callback (a time they gave).
-- p_due in the future: the call is queued for then and the sweep dials it (the rules are checked again at the dial).
create or replace function public.ai_route_lead(p_lead uuid, p_purpose text default 'first', p_due timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare l public.leads; w record; cid uuid; n int;
begin
  if p_purpose not in ('first', 'reply', 'flow', 'callback') then raise exception 'unknown purpose %', p_purpose using errcode = '22023'; end if;
  select * into l from public.leads where id = p_lead;
  if l.id is null or l.reactivation_id is not null then return 'none'; end if;
  -- Nothing left to call about.
  if l.inbound_stage in ('lost', 'sold')
     or (p_purpose = 'first' and (l.first_call_outcome is not null
         or exists (select 1 from public.ai_calls a where a.lead_id = p_lead and a.reactivation_contact_id is null
                     and a.purpose in ('first', 'retry') and a.status = 'done')))
     or exists (select 1 from public.ai_calls a where a.lead_id = p_lead and a.reactivation_contact_id is null
                 and a.status not in ('done', 'to_va', 'queued'))                                   -- on a call now
     or exists (select 1 from public.ai_calls a where a.lead_id = p_lead and a.reactivation_contact_id is null and a.status = 'queued'
                 and (p_due is null or a.due_at = p_due)) then
    delete from public.ai_lead_waits where lead_id = p_lead and state like 'wait%';
    return 'already';
  end if;
  select coalesce(max(attempt), 0) + 1 into n from public.ai_calls where lead_id = p_lead;
  if n > 30 then
    perform public.ai_wait_set(p_lead, 'wait_retry', 'max_tries', p_purpose, 'infinity');
    return 'max_tries';
  end if;

  if p_due is not null and p_due > now() then
    insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, due_at, provider, purpose)
    values (p_lead, l.assigned_rep_id, n, coalesce(l.created_at, now()), p_due, (select provider from public.ai_caller_settings where id), p_purpose)
    on conflict do nothing;
    delete from public.ai_lead_waits where lead_id = p_lead and state like 'wait%';
    return 'later';
  end if;

  select * into w from public.ai_caller_takes(p_lead);
  if w."by" = 'ai' then
    insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, due_at, provider, purpose)
    values (p_lead, l.assigned_rep_id, n, coalesce(l.created_at, now()), now(), (select provider from public.ai_caller_settings where id), p_purpose)
    on conflict do nothing returning id into cid;
    if cid is null then return 'already'; end if;
    delete from public.ai_lead_waits where lead_id = p_lead;
    perform public.ai_caller_post(jsonb_build_object('action', 'start', 'call_id', cid));
    return 'ai';
  end if;
  if w."by" = 'none' or w.state is null then
    delete from public.ai_lead_waits where lead_id = p_lead;
    return 'none';
  end if;
  perform public.ai_wait_set(p_lead, w.state, w.reason, p_purpose, w.next_at);
  return w.state;
end;
$$;

-- A call the AI didn't dial (the rules changed, the provider is down, it never started). Never a VA.
create or replace function public.ai_caller_not_dialed(p_call uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.ai_calls; w record;
begin
  select * into c from public.ai_calls where id = p_call and status in ('queued', 'dialing') for update;
  if c.id is null then return null; end if;
  if c.reactivation_contact_id is null and c.purpose = 'retry' then
    -- The 2-minute retry: counts as no answer (the no-answer texts start), as before.
    perform public.ai_caller_result(c.id, 'no_answer', jsonb_build_object('summary', 'Retry not dialed: ' || left(coalesce(p_reason, ''), 80)));
    return 'no_answer';
  end if;
  update public.ai_calls set status = 'to_va', to_va_reason = left(p_reason, 120), updated_at = now() where id = c.id;
  if c.reactivation_contact_id is not null then                  -- P952: back in its list
    perform public.reactivation_not_dialed(c.reactivation_contact_id, p_reason);
    return 'reactivation';
  end if;
  select * into w from public.ai_caller_takes(c.lead_id);
  if w."by" = 'ai' then
    -- The rules allow the call, so the start itself failed: wait and try again (5, 10 … 60 minutes).
    perform public.ai_wait_set(c.lead_id, 'wait_retry', coalesce(p_reason, 'not_started'), case when c.purpose = 'retry' then 'first' else c.purpose end, null);
    if (select tries from public.ai_lead_waits where lead_id = c.lead_id) = 6 then
      perform public.route_notify_admins('ai_lead_not_called', 'New leads aren''t being called: the call won''t start',
        'A call to a new lead failed to start 6 times in a row (' || coalesce(p_reason, 'not_started') || '). It keeps trying every hour. Check the AI caller.',
        '/admin/inbounds?view=ai', 'ai_not_starting:' || to_char(now(), 'YYYYMMDDHH24'));
    end if;
    return 'wait_retry';
  end if;
  return public.ai_route_lead(c.lead_id, c.purpose);
end;
$$;

-- The deployed edge function still calls this name; it never hands anything to a VA now.
create or replace function public.ai_caller_to_va(p_call uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.ai_caller_not_dialed(p_call, p_reason);
  return null;
end;
$$;

-- ── 6. New leads: routed when they come in, and again when they get their agent ───────────────────────────────────
create or replace function public.route_new_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_type is distinct from 'cancellation' and new.phone is not null and new.reactivation_id is null then
    begin
      perform public.ai_route_lead(new.id, 'first');
    exception when others then
      raise warning 'route_new_lead %: %', new.id, sqlerrm;   -- never blocks the lead (the sweep can't see it, so log loud)
    end;
  end if;
  return new;
end;
$$;

-- The form and GoHighLevel insert the lead first and assign it a moment later (assign_lead, the daily batch).
create or replace function public.route_lead_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.assigned_rep_id is null and new.assigned_rep_id is not null and new.reactivation_id is null and new.phone is not null
     and new.lead_type is distinct from 'cancellation' and new.first_call_outcome is null then
    begin
      perform public.ai_route_lead(new.id, 'first');
    exception when others then raise warning 'route_lead_assigned %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_route_assigned on public.leads;
create trigger leads_route_assigned after update of assigned_rep_id on public.leads
  for each row execute function public.route_lead_assigned();

-- ── 7. The guard: no new lead ever reaches a VA's queue ───────────────────────────────────────────────────────────
-- new_lead items, a no-answer step (detail.flow), a reply to the no-answer texts (detail.flow_reply) and a callback
-- time the AI booked are the AI's: stored cancelled (so the old callers don't queue them again) and routed to it.
-- Inbound callers, hold-line callbacks, missed live transfers and clients keep ringing VAs.
create or replace function public.call_queue_no_new_leads()
returns trigger language plpgsql security definer set search_path = public as $$
declare dt jsonb := coalesce(new.detail, '{}'::jsonb); purp text;
begin
  if new.lead_id is null or new.kind not in ('new_lead', 'callback') then return new; end if;
  if new.kind = 'new_lead' then purp := 'first';
  elsif dt ? 'flow_reply' then purp := 'reply';
  elsif dt ? 'flow' then purp := 'flow';
  elsif new.due_at is not null and exists (select 1 from public.ai_calls a where a.lead_id = new.lead_id and a.outcome = 'not_now'
                                            and a.callback_at = new.due_at and a.reactivation_contact_id is null) then purp := 'callback';
  else return new;
  end if;
  new.status := 'cancelled'; new.cancel_reason := 'ai_calls'; new.offered_to := null; new.hold_until := null;
  begin
    perform public.ai_route_lead(new.lead_id, purp, case when purp = 'callback' then new.due_at end);
  exception when others then raise warning 'call_queue_no_new_leads %: %', new.lead_id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists a0_call_queue_no_new_leads on public.call_queue;
create trigger a0_call_queue_no_new_leads before insert on public.call_queue
  for each row execute function public.call_queue_no_new_leads();
-- Anything already waiting for a VA on a new lead goes to the AI too.
update public.call_queue set status = 'cancelled', cancel_reason = 'ai_calls', offered_to = null
 where status in ('held', 'waiting', 'offered') and (kind = 'new_lead' or (kind = 'callback' and (detail ? 'flow' or detail ? 'flow_reply')));

-- ── 8. After a call: the retry by purpose, and the AI's calls back ────────────────────────────────────────────────
create or replace function public.ai_caller_result(p_call uuid, p_outcome text, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.ai_calls; nxt uuid; secs int; label text; ag uuid; cb timestamptz; fc jsonb; said text; tz text;
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

  if c.reactivation_contact_id is not null then                   -- P952
    label := 'Reactivation call ' || c.attempt || '. ' ||
             case p_outcome when 'booked' then 'Reached them. Booked' when 'transferred' then 'Reached them. Live transfer to you'
                            when 'not_now' then 'Reached them. Not a good time' when 'hard_no' then 'Reached them. Not interested'
                            when 'wrong_number' then 'Wrong number' when 'no_answer' then 'No answer' when 'opt_out' then 'Asked not to be called' end;
    insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
    values (c.lead_id, c.agent_id, 'va_call', label, jsonb_build_object('result', p_outcome, 'try', c.attempt, 'reactivation', true), 'Our team', 'team');
    return public.reactivation_after_call(c.id, p_outcome, cb) || jsonb_build_object('label', label);
  end if;

  said := case p_outcome when 'booked' then 'Reached them. Booked' when 'transferred' then 'Reached them. Live transfer to you'
                         when 'not_now' then case when cb is not null then 'Reached them. Booked a callback' else 'Reached them. Not a good time' end
                         when 'hard_no' then 'Reached them. Not interested' when 'wrong_number' then 'Wrong number'
                         when 'no_answer' then 'No answer' when 'opt_out' then 'Asked not to be called' end;
  select assigned_rep_id into ag from public.leads where id = c.lead_id;

  -- P1014: a call back (a reply, a no-answer step, a callback time). The first-call outcome is already set.
  if c.purpose in ('reply', 'flow', 'callback') then
    label := 'Called them back. ' || said;
    insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
    values (c.lead_id, ag, 'va_call', label, jsonb_build_object('result', p_outcome, 'try', c.attempt, 'purpose', c.purpose), 'Our team', 'team');
    if p_outcome not in ('no_answer', 'booked') then          -- reached them: the no-answer texts stop (a booking does it itself)
      perform public.lead_flow_action(c.lead_id, case when p_outcome = 'opt_out' then 'opted_out' else 'answered' end);
    end if;
    case p_outcome
      when 'not_now' then
        if cb is not null then
          tz := public.lead_tz(c.lead_id);
          insert into public.inbound_events (lead_id, agent_id, kind, at, label, detail, actor_name, actor_role)
          values (c.lead_id, ag, 'booked', now(), 'Callback booked for ' || to_char(cb at time zone tz, 'Dy, Mon FMDD at FMHH12:MI AM'),
                  jsonb_build_object('appointment_at', cb, 'callback', true), 'Our team', 'team');
          perform public.ai_route_lead(c.lead_id, 'callback', cb);
        end if;
      when 'hard_no' then
        update public.leads set inbound_stage = 'lost', outcome = 'not_interested', outcome_reason = 'Not interested when we called back',
               outcome_at = now() where id = c.lead_id and inbound_stage is distinct from 'sold';
      when 'wrong_number' then
        update public.leads set inbound_stage = 'lost', outcome = 'not_interested', outcome_reason = 'Wrong number', outcome_at = now(),
               bad_lead_at = now(), bad_lead_reason = 'Wrong number' where id = c.lead_id and inbound_stage is distinct from 'sold';
      when 'opt_out' then
        perform public.mark_do_not_call(null, c.lead_id, null, 'Asked on a call back not to be called');
      else null;
    end case;
    return jsonb_build_object('ok', true, 'label', label, 'purpose', c.purpose);
  end if;

  -- Speed is from the lead arriving to the first dial of its first call. Agent-safe words (rules.js agentLine), never "AI".
  select round(secs_to_dial) into secs from public.ai_calls
   where lead_id = c.lead_id and purpose = 'first' and dialed_at is not null order by attempt limit 1;
  label := 'Called' || case when secs is null then '' else ' in ' || secs || ' second' || case when secs = 1 then '' else 's' end end || '. ' || said;
  insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
  values (c.lead_id, ag, 'va_call', label, jsonb_build_object('speed_secs', secs, 'result', p_outcome, 'try', c.attempt), 'Our team', 'team');

  if p_outcome = 'no_answer' and c.purpose = 'first' then
    -- One more try 2 minutes later; the outcome waits for it.
    insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, due_at, provider, purpose)
    values (c.lead_id, c.agent_id, (select max(attempt) + 1 from public.ai_calls where lead_id = c.lead_id), c.lead_in_at,
            now() + interval '2 minutes', c.provider, 'retry')
    on conflict do nothing returning id into nxt;
    if nxt is not null then return jsonb_build_object('ok', true, 'retry_call', nxt, 'label', label); end if;
  end if;
  fc := public.lead_first_call_outcome(c.lead_id, p_outcome, 'ai', cb);
  return jsonb_build_object('ok', true, 'retry_call', nxt, 'label', label, 'first_call', fc);
end;
$$;

-- ── 9. The sweep (every 10 s): due calls, calls that never started, and leads waiting for their moment ─────────────
create or replace function public.ai_caller_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; w record; started int := 0; held int := 0; na int := 0; looked int := 0; live boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('ai_caller_sweep')) then return jsonb_build_object('skipped', true); end if;
  live := coalesce((select ai_caller_live from public.recovery_config limit 1), false);
  -- a. Calls queued for a time (the 2-minute retry, a callback): the rules again at the dial.
  for r in select c.* from public.ai_calls c where c.status = 'queued' and c.purpose <> 'first' and c.due_at <= now()
             and c.updated_at < now() - interval '5 seconds' and c.reactivation_contact_id is null loop
    select * into w from public.ai_caller_takes(r.lead_id);
    if w."by" = 'ai' then
      update public.ai_calls set updated_at = now() where id = r.id;
      perform public.ai_caller_post(jsonb_build_object('action', 'start', 'call_id', r.id)); started := started + 1;
    elsif r.purpose = 'retry' then
      perform public.ai_caller_result(r.id, 'no_answer', jsonb_build_object('summary', 'retry_blocked')); na := na + 1;
    else
      perform public.ai_caller_not_dialed(r.id, coalesce(w.reason, 'rules')); held := held + 1;
    end if;
  end loop;
  -- b. A first call not started in 20 s, or a timed call not started 60 s after it was due: not dialed (wait, retry).
  for r in select c.id from public.ai_calls c where c.status = 'queued' and c.reactivation_contact_id is null
             and ((c.purpose = 'first' and c.created_at < now() - interval '20 seconds')
               or (c.purpose <> 'first' and c.due_at < now() - interval '60 seconds')) loop
    perform public.ai_caller_not_dialed(r.id, 'not_started'); held := held + 1;
  end loop;
  -- c. Leads waiting for their moment: the rules again, 20 at a time. While the switch is off its waiters stay put.
  for r in select lead_id, purpose from public.ai_lead_waits
            where state like 'wait%' and next_at <= now() and (live or reason <> 'switch_off')
            order by next_at limit 20 for update skip locked loop
    perform public.ai_route_lead(r.lead_id, r.purpose); looked := looked + 1;
  end loop;
  return jsonb_build_object('started', started, 'not_dialed', held, 'no_answer', na, 'waits_looked', looked);
end;
$$;

-- ── 10. The VA desk's queue: no new form leads ────────────────────────────────────────────────────────────────────
-- 260's va_queue with one change: a mortgage_protection lead shows only for a P213 step that is due (no new lead,
-- not-reached or callback rows for form leads; those are the AI's). Inbound leads (policy_help, …) are unchanged.
create or replace function public.va_queue()
returns table(lead_id uuid, lead_type text, lead_source text, contact_name text, phone text, city text, state text,
              qualifier_answers jsonb, va_checklist jsonb, bucket text, va_attempts integer,
              va_callback_at timestamptz, claimed_by_me boolean, claim_expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_test boolean := public.my_is_test();
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
       and public.lead_is_test(l.id) = v_test
       and case when l.lead_type = 'mortgage_protection'
                and l.va_outcome is distinct from 'callback'
                and exists (select 1 from public.inbound_events e
                             where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step')
                then exists (select 1 from public.inbound_events e
                              where e.lead_id = l.id and e.state = 'scheduled' and e.detail ? 'va_step'
                                and e.at <= now())
                when l.lead_type = 'mortgage_protection' then false               -- P1014: new form leads are the AI's
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

-- ── 11. Locked doors (P922): service role only, except va_queue (signed-in staff) ─────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.ai_caller_takes(uuid)', 'public.ai_wait_set(uuid, text, text, text, timestamptz)',
    'public.ai_route_lead(uuid, text, timestamptz)', 'public.ai_caller_not_dialed(uuid, text)', 'public.ai_caller_to_va(uuid, text)',
    'public.route_new_lead()', 'public.route_lead_assigned()', 'public.call_queue_no_new_leads()',
    'public.ai_caller_result(uuid, text, jsonb)', 'public.ai_caller_sweep()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke execute on function public.va_queue() from public, anon;
grant execute on function public.va_queue() to authenticated;
