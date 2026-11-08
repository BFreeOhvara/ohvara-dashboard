-- p892_ai_caller — AI speed to lead: an AI calls every new form lead within 10 seconds, transfers (Check agent) or
-- books, and hands to a VA when needed (Prompt 892; brain/ohvara/How Ohvara Works.md "AI speed to lead", Brayden
-- Nov 7 17:49). Switched OFF: recovery_config.ai_caller_live defaults false, like voice_live.
--
-- NOT NUMBERED, NOT APPLIED. Brayden numbers and applies it, after p880, p882 and p889 (it replaces P889's form-lead
-- start, which is P882's route_new_lead trigger). Additive: new tables, columns and functions; the call_queue kind
-- check is re-created one value wider ('ai_handoff'); route_new_lead and mark_do_not_call are re-created with the
-- same behaviour plus the AI branch / a service-role caller.
--
-- How it works (the rules live in supabase/functions/ai-caller/rules.js; src/p892.test.js checks this file agrees):
--   * Only FRESH FORM leads (lead_type mortgage_protection with the form's consent_at). Inbound calls (call ads and
--     live-transfer calls) still ring a VA; the AI never calls clients and never does servicing.
--   * ai_caller_takes(lead): the switch is on, the lead's agent is switched on for the AI, the lead's consent version
--     covers AI / artificial-voice calls (ai_consent_versions, nothing covers it until Brayden approves wording), and
--     P882's pre-dial check passes now (consent, do-not-call, the state's window in every zone, the attempt cap).
--     Anything else → the VA path, exactly as P889 built it (route_enqueue('new_lead')).
--   * The insert trigger writes an ai_calls row and posts to the ai-caller edge function at once (pg_net), so the
--     first dial is inside 10 s. If the function hasn't started the call in 20 s, the sweep hands the lead to a VA.
--   * Hand-off: ai_caller_handoff() puts an 'ai_handoff' item at the top of P882's queue (priority 0) and offers it to
--     the next free VA, who sees "From the AI" with the summary. Taken → the function bridges the lead into that VA's
--     line. Not taken in 60 s → a callback task (the lead is told someone will call back).
--   * No answer: one more try 2 minutes later; after that the existing no-answer path (P882 new_lead for a VA, the
--     P696 texts) takes over.
--   * "Stop calling" → mark_do_not_call (everywhere, at once).
--   * Timeline: one va_call row per call. Agents read "Called in 9 seconds. Booked" and never "AI"; ai_calls itself is
--     admin + Fulfillment only.

do $$
begin
  if to_regclass('public.call_queue') is null or to_regprocedure('public.route_enqueue(text,uuid,text,text,text,text,uuid,timestamptz,uuid,jsonb,uuid[],uuid,boolean)') is null then
    raise exception 'p892 needs p882_calling_engine applied first';
  end if;
  if to_regclass('public.transfer_checks') is null then raise exception 'p892 needs p880 applied first'; end if;
  if to_regclass('public.agent_lead_product') is null then raise exception 'p892 needs p889 applied first'; end if;
  if to_regclass('public.ai_calls') is not null then raise exception 'p892: ai_calls already exists'; end if;
end $$;

-- ── 1. The switch and the settings ────────────────────────────────────────────────────────────────────────────────
-- ai_caller_live sits with voice_live / sms_live. Off: form leads go to VAs exactly as P889 built it.
alter table public.recovery_config add column if not exists ai_caller_live boolean not null default false;

create table public.ai_caller_settings (
  id                 boolean primary key default true check (id),
  all_agents         boolean not null default false,
  agent_ids          uuid[] not null default '{}',
  max_call_secs      int not null default 300 check (max_call_secs between 60 and 900),
  provider           text not null default 'none' check (provider in ('none', 'retell', 'vapi', 'ghl')),
  cents_per_min      numeric(6,2) check (cents_per_min is null or cents_per_min >= 0),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id) on delete set null
);
insert into public.ai_caller_settings default values;
alter table public.ai_caller_settings enable row level security;
revoke all on public.ai_caller_settings from public, anon, authenticated;
grant select on public.ai_caller_settings to authenticated;
create policy acs_admin_read on public.ai_caller_settings for select to authenticated using (public.is_admin());

-- ── 2. Consent that covers AI calls ───────────────────────────────────────────────────────────────────────────────
-- The form stores its wording version on the lead (qualifier_answers.consent_text_version, submit-mp-lead). Only a
-- version marked covers_ai lets the AI call. mp-v1 (today's placeholder) does NOT: Brayden + a lawyer add the wording.
create table public.ai_consent_versions (
  version      text primary key,
  covers_ai    boolean not null default false,
  wording      text check (wording is null or char_length(wording) <= 2000),
  approved_by  uuid references public.profiles(id) on delete set null,
  approved_at  timestamptz
);
insert into public.ai_consent_versions (version, covers_ai) values ('mp-v1', false) on conflict do nothing;
alter table public.ai_consent_versions enable row level security;
revoke all on public.ai_consent_versions from public, anon, authenticated;
grant select on public.ai_consent_versions to authenticated;
create policy acv_staff_read on public.ai_consent_versions for select to authenticated using (public.is_admin() or public.is_fulfillment());

create or replace function public.lead_ai_consent_ok(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select v.covers_ai from public.leads l
                     join public.ai_consent_versions v on v.version = l.qualifier_answers ->> 'consent_text_version'
                    where l.id = p_lead), false)
$$;

-- ── 3. The calls ──────────────────────────────────────────────────────────────────────────────────────────────────
create table public.ai_calls (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  agent_id         uuid references public.profiles(id) on delete set null,
  attempt          int not null default 1 check (attempt between 1 and 2),
  status           text not null default 'queued' check (status in (
                     'queued', 'dialing', 'talking', 'checking', 'transferring', 'booking', 'handing_off', 'done', 'to_va')),
  outcome          text check (outcome in ('reached', 'booked', 'transferred', 'handed_to_va', 'no_answer', 'opt_out')),
  due_at           timestamptz not null default now(),       -- attempt 2: two minutes after attempt 1
  lead_in_at       timestamptz not null,                     -- the lead's created_at (speed is measured from here)
  dialed_at        timestamptz,
  answered_at      timestamptz,
  ended_at         timestamptz,
  secs_to_dial     numeric generated always as (extract(epoch from (dialed_at - lead_in_at))) stored,
  duration_secs    int,
  cost_cents       numeric(8,2),
  provider         text,
  provider_call_id text,
  routed           text check (routed in ('in_hours', 'out_of_hours', 'appts_only', 'not_reachable')),
  check_id         uuid references public.transfer_checks(id) on delete set null,
  booked_for       timestamptz,
  handoff_reason   text check (handoff_reason in ('asked_person', 'coverage_or_price', 'confused_upset', 'ai_failed')),
  handoff_item     uuid references public.call_queue(id) on delete set null,
  callback_task    boolean not null default false,
  to_va_reason     text,                                    -- why a VA took the lead instead (start failed, etc.)
  summary          text check (summary is null or char_length(summary) <= 1200),  -- for the VA's "From the AI" card
  control_url      text,                                    -- Vapi's live-control URL for this call (transfer, say)
  line_id          uuid,                                    -- the VA line a hand-off was bridged into
  transcript_ref   text,                                    -- the provider's id for the transcript; we don't copy it
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index ai_calls_one_per_attempt on public.ai_calls (lead_id, attempt);
create index ai_calls_due_idx on public.ai_calls (due_at) where status = 'queued';
create index ai_calls_created_idx on public.ai_calls (created_at desc);
create unique index ai_calls_provider_idx on public.ai_calls (provider, provider_call_id) where provider_call_id is not null;
alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from public, anon, authenticated;
grant select on public.ai_calls to authenticated;
-- Admin and VAs only (a VA needs the summary). Agents never read this table.
create policy ai_calls_staff_read on public.ai_calls for select to authenticated using (public.is_admin() or public.is_fulfillment());

-- A Check agent the AI sent (P880's table, no Twilio call behind it).
alter table public.transfer_checks add column if not exists ai_call_id uuid references public.ai_calls(id) on delete set null;

-- ── 4. The hand-off kind on P882's queue (top priority, like a caller waiting) ────────────────────────────────────
alter table public.call_queue drop constraint if exists call_queue_kind_check;
alter table public.call_queue add constraint call_queue_kind_check
  check (kind in ('inbound', 'new_lead', 'callback', 'hold_handoff', 'rescue', 'ai_handoff'));
-- One open hand-off per lead: P882's call_queue_one_open_per_lead (lead_id, kind) already covers it.

-- ── 5. Who calls a new lead (same rule as rules.js whoCalls) ──────────────────────────────────────────────────────
create or replace function public.ai_caller_takes(p_lead uuid)
returns table (by text, reason text)
language plpgsql stable security definer set search_path = public as $$
declare l public.leads; s public.ai_caller_settings; chk record;
begin
  select * into l from public.leads where id = p_lead;
  if l.id is null or l.lead_type is distinct from 'mortgage_protection' or l.phone is null
     or coalesce(l.qualifier_answers ->> 'consent_at', '') = '' or l.call_consent_at is not null then
    return query select 'va', 'not_form'; return;               -- inbound calls and anything not a fresh form lead
  end if;
  if not coalesce((select ai_caller_live from public.recovery_config limit 1), false) then
    return query select 'va', 'switch_off'; return;
  end if;
  select * into s from public.ai_caller_settings where id;
  if l.assigned_rep_id is null or not (s.all_agents or l.assigned_rep_id = any(s.agent_ids)) then
    return query select 'va', 'agent_not_on'; return;
  end if;
  if not public.lead_ai_consent_ok(p_lead) then return query select 'va', 'no_ai_consent'; return; end if;
  select * into chk from public.predial_eval(l.phone, l.state, l.id, 'call', now(), null, false);
  if not chk.ok then return query select 'va', coalesce(chk.reason, 'predial'); return; end if;
  return query select 'ai', null::text;
end;
$$;

-- Post to the edge function now (pg_net, same secret as the Fulfillment crons). Never blocks the caller.
create or replace function public.ai_caller_post(p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.fulfillment_cron_post('ai-caller', p_body);
exception when others then raise warning 'ai_caller_post: %', sqlerrm;
end;
$$;

-- P882's trigger, with the AI branch first. Off, or anything the AI may not call → the VA path, unchanged.
create or replace function public.route_new_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare w record; cid uuid;
begin
  if new.lead_type is distinct from 'cancellation' and new.phone is not null then
    begin
      select * into w from public.ai_caller_takes(new.id);
      if w.by = 'ai' then
        insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, provider)
        values (new.id, new.assigned_rep_id, 1, coalesce(new.created_at, now()), (select provider from public.ai_caller_settings where id))
        on conflict do nothing returning id into cid;
        if cid is not null then
          perform public.ai_caller_post(jsonb_build_object('action', 'start', 'call_id', cid));
          return new;
        end if;
      end if;
      perform public.route_enqueue('new_lead', new.id);
    exception when others then
      raise warning 'route_new_lead %: %', new.id, sqlerrm;  -- never blocks the lead
      begin perform public.route_enqueue('new_lead', new.id); exception when others then null; end;
    end;
  end if;
  return new;
end;
$$;

-- ── 6. What the edge function reports (service role only) ─────────────────────────────────────────────────────────
-- The lead goes to a VA instead (the AI couldn't start, or a rule changed before the dial).
create or replace function public.ai_caller_to_va(p_call uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.ai_calls;
begin
  update public.ai_calls set status = 'to_va', to_va_reason = left(p_reason, 120), updated_at = now()
   where id = p_call and status in ('queued', 'dialing') returning * into c;
  if c.id is null then return null; end if;
  return public.route_enqueue('new_lead', c.lead_id, p_detail => jsonb_build_object('from_ai', true, 'ai_call_id', c.id, 'why', p_reason));
end;
$$;

-- One status change on a call: dialing / talking / checking / transferring / booking (with what the function knows).
create or replace function public.ai_caller_status(p_call uuid, p_status text, p_patch jsonb default '{}'::jsonb)
returns public.ai_calls language plpgsql security definer set search_path = public as $$
declare c public.ai_calls;
begin
  update public.ai_calls set
    status           = p_status,
    provider_call_id = coalesce(p_patch ->> 'provider_call_id', provider_call_id),
    dialed_at        = case when p_status = 'dialing' then coalesce(dialed_at, now()) else dialed_at end,
    answered_at      = case when p_status = 'talking' then coalesce(answered_at, now()) else answered_at end,
    routed           = coalesce(p_patch ->> 'routed', routed),
    check_id         = coalesce((p_patch ->> 'check_id')::uuid, check_id),
    control_url      = coalesce(p_patch ->> 'control_url', control_url),
    line_id          = coalesce((p_patch ->> 'line_id')::uuid, line_id),
    summary          = coalesce(left(p_patch ->> 'summary', 1200), summary),
    updated_at       = now()
   where id = p_call and status not in ('done', 'to_va')
  returning * into c;
  if p_status = 'dialing' and c.id is not null then
    perform public.predial_log_attempt((select phone from public.leads where id = c.lead_id), c.lead_id, null, null, null);
  end if;
  return c;
end;
$$;

-- The end of a call: the outcome, the timeline row (agent-safe words), and what happens next.
create or replace function public.ai_caller_result(p_call uuid, p_outcome text, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.ai_calls; nxt uuid; secs int; label text; ag uuid;
begin
  if p_outcome not in ('reached', 'booked', 'transferred', 'handed_to_va', 'no_answer', 'opt_out') then
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  update public.ai_calls set status = 'done', outcome = p_outcome, ended_at = now(),
    duration_secs  = coalesce((p_patch ->> 'duration_secs')::int, duration_secs),
    cost_cents     = coalesce((p_patch ->> 'cost_cents')::numeric,
                       ceil(coalesce((p_patch ->> 'duration_secs')::int, 0) / 60.0) * (select cents_per_min from public.ai_caller_settings where id)),
    booked_for     = coalesce((p_patch ->> 'booked_for')::timestamptz, booked_for),
    summary        = coalesce(left(p_patch ->> 'summary', 1200), summary),
    transcript_ref = coalesce(p_patch ->> 'transcript_ref', transcript_ref),
    callback_task  = coalesce((p_patch ->> 'callback_task')::boolean, callback_task),
    updated_at     = now()
   where id = p_call and status <> 'done' returning * into c;
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'gone'); end if;

  -- Speed is from the lead arriving to the FIRST dial (attempt 1), on every row of this lead.
  select round(secs_to_dial) into secs from public.ai_calls where lead_id = c.lead_id and attempt = 1;
  label := 'Called' || case when secs is null then '' else ' in ' || secs || ' second' || case when secs = 1 then '' else 's' end end || '. ' ||
           case p_outcome when 'booked' then 'Reached them. Booked' when 'transferred' then 'Reached them. Live transfer to you'
                          when 'handed_to_va' then 'Reached them. Our team is on it' when 'no_answer' then 'No answer'
                          when 'opt_out' then 'Asked not to be called' else 'Reached them' end;
  select assigned_rep_id into ag from public.leads where id = c.lead_id;
  insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
  values (c.lead_id, ag, 'va_call', label, jsonb_build_object('speed_secs', secs, 'result', p_outcome, 'try', c.attempt), 'Our team', 'team');

  if p_outcome = 'opt_out' then
    perform public.mark_do_not_call(null, c.lead_id, null, 'Asked the call not to call again');
  elsif p_outcome = 'no_answer' and c.attempt = 1 then
    insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, due_at, provider)
    values (c.lead_id, c.agent_id, 2, c.lead_in_at, now() + interval '2 minutes', c.provider)
    on conflict do nothing returning id into nxt;
  elsif p_outcome = 'no_answer' then
    -- Two tries: the existing no-answer path takes over (a VA call task on P882's queue, P696's texts).
    perform public.route_enqueue('new_lead', c.lead_id, p_detail => jsonb_build_object('from_ai', true, 'ai_no_answer', 2));
  end if;
  return jsonb_build_object('ok', true, 'retry_call', nxt, 'label', label);
end;
$$;

-- The times the AI can offer: 30-minute slots in the agent's working hours (211's agents_slots_in_hours, the agent's
-- zone) over the next 3 days, at least an hour out. The AI reads them to the lead in the lead's own time zone.
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
                order by s limit greatest(1, least(coalesce(p_limit, 6), 12));
end;
$$;

-- Book one of those slots. The appointment row itself is written by the VA booking RPC once 852 wires it (the same
-- one the desk's Book an agent uses); until then the lead is marked booked with the time on the call.
create or replace function public.ai_caller_book(p_call uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.ai_calls;
begin
  select * into c from public.ai_calls where id = p_call and status in ('booking', 'talking', 'checking', 'transferring');
  if c.id is null then return jsonb_build_object('ok', false, 'code', 'gone'); end if;
  if not exists (select 1 from public.ai_caller_slots(p_call, 12) s where s = p_at) then
    return jsonb_build_object('ok', false, 'code', 'slot_taken');
  end if;
  update public.ai_calls set booked_for = p_at, status = 'booking', updated_at = now() where id = c.id;
  update public.leads set va_outcome = 'booked', va_last_worked_at = now() where id = c.lead_id;
  insert into public.inbound_events (lead_id, agent_id, kind, label, detail, actor_name, actor_role)
  values (c.lead_id, c.agent_id, 'booked', 'Booked for ' || to_char(p_at at time zone coalesce((select timezone from public.profiles where id = c.agent_id), 'America/Chicago'), 'Dy, Mon FMDD at FMHH12:MI AM'),
          jsonb_build_object('at', p_at), 'Our team', 'team');
  return jsonb_build_object('ok', true, 'at', p_at);
end;
$$;

-- Hand the live lead to the next free VA, warm, at the top of the queue.
create or replace function public.ai_caller_handoff(p_call uuid, p_reason text, p_summary text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.ai_calls; q uuid;
begin
  if p_reason not in ('asked_person', 'coverage_or_price', 'confused_upset', 'ai_failed') then
    raise exception 'unknown hand-off reason %', p_reason using errcode = '22023';
  end if;
  update public.ai_calls set status = 'handing_off', handoff_reason = p_reason, summary = coalesce(left(p_summary, 1200), summary), updated_at = now()
   where id = p_call and status in ('talking', 'checking', 'transferring', 'booking') returning * into c;
  if c.id is null then return null; end if;
  q := public.route_enqueue('ai_handoff', c.lead_id,
         p_detail => jsonb_build_object('ai_call_id', c.id, 'reason', p_reason, 'summary', left(p_summary, 1200)), p_offer => false);
  if q is null then return null; end if;
  update public.call_queue set priority = 0 where id = q;
  update public.ai_calls set handoff_item = q where id = c.id;
  perform public.route_offer(q);
  return q;
end;
$$;

-- A VA took the hand-off: tell the function to bridge the lead into that VA's line, right away.
create or replace function public.ai_handoff_taken()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'ai_handoff' and new.status = 'taken' and old.status is distinct from 'taken' then
    perform public.ai_caller_post(jsonb_build_object('action', 'bridge', 'call_id', new.detail ->> 'ai_call_id', 'line_id', new.line_id, 'va_id', new.taken_by));
  end if;
  return new;
end;
$$;
drop trigger if exists call_queue_ai_handoff_taken on public.call_queue;
create trigger call_queue_ai_handoff_taken after update of status on public.call_queue
  for each row execute function public.ai_handoff_taken();

-- P882's one-tap Do not call, unchanged, plus the service role (the AI's "stop calling").
create or replace function public.mark_do_not_call(p_phone text default null, p_lead uuid default null,
  p_policy uuid default null, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  svc   boolean := auth.uid() is null and coalesce(auth.role(), current_user) in ('service_role', 'postgres');
  e     text;
  calls int;
  texts int;
  leads_ uuid[];
begin
  if not svc and (uid is null or not (public.is_fulfillment() or public.is_admin())) then
    raise exception 'Only Fulfillment can mark do not call' using errcode = '42501';
  end if;
  e := public.sms_e164(coalesce(p_phone,
         (select phone from public.leads where id = p_lead),
         (select client_phone from public.policies where id = p_policy)));
  if e is null then raise exception 'No phone number to mark' using errcode = '22023'; end if;

  insert into public.dnc_numbers (phone, internal, source, note, added_by)
  values (e, true, 'do_not_call', left(p_reason, 500), uid)
  on conflict (phone) do update set internal = true, source = 'do_not_call', note = coalesce(excluded.note, dnc_numbers.note),
                                    added_by = excluded.added_by, added_at = now();
  calls := public.route_cancel_phone(e, p_lead, 'do_not_call');
  select coalesce(array_agg(id), '{}') into leads_ from public.leads where public.sms_e164(phone) = e or id = p_lead;
  update public.inbound_events ev set state = 'skipped', detail = ev.detail || jsonb_build_object('skipped', 'do_not_call')
   where ev.state = 'scheduled' and ev.kind in ('text_sent', 'reminder', 'va_call') and ev.lead_id = any(leads_);
  get diagnostics texts = row_count;
  perform public.sms_set_opt(e, true, 'do_not_call');
  update public.leads set va_callback_at = null where id = any(leads_) and va_outcome = 'callback';
  -- Queued AI tries and open AI hand-offs stop too.
  update public.ai_calls set status = 'done', outcome = coalesce(outcome, 'opt_out'), ended_at = coalesce(ended_at, now()), updated_at = now()
   where lead_id = any(leads_) and status = 'queued';
  update public.call_queue set status = 'cancelled', cancel_reason = 'do_not_call'
   where kind = 'ai_handoff' and lead_id = any(leads_) and status in ('held', 'waiting', 'offered');
  insert into public.inbound_events (lead_id, kind, state, label, detail, actor_id, actor_role)
  select id, 'note', 'done', 'Do not call: opted out of calls and texts', jsonb_build_object('do_not_call', true), uid,
         case when svc then 'team' when public.is_admin() then 'admin' else 'fulfillment' end
    from unnest(leads_) as id;
  return jsonb_build_object('phone_last4', right(e, 4), 'cancelled_calls', calls, 'cancelled_texts', texts);
end;
$$;

-- ── 7. The sweep (every 10 s): retries due, stuck starts, hand-offs nobody took in 60 s ───────────────────────────
create or replace function public.ai_caller_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; started int := 0; to_va int := 0; cb int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('ai_caller_sweep')) then return jsonb_build_object('skipped', true); end if;
  -- Attempt 2 due: re-check the rules (an opt-out, the window, the switch) before dialling.
  for r in select c.* from public.ai_calls c where c.status = 'queued' and c.attempt = 2 and c.due_at <= now() and c.updated_at < now() - interval '5 seconds' loop
    if (select by from public.ai_caller_takes(r.lead_id)) = 'ai' then
      update public.ai_calls set updated_at = now() where id = r.id;
      perform public.ai_caller_post(jsonb_build_object('action', 'start', 'call_id', r.id)); started := started + 1;
    else
      perform public.ai_caller_to_va(r.id, 'retry_blocked'); to_va := to_va + 1;
    end if;
  end loop;
  -- Never started in 20 s (the function or the provider is down): a VA calls instead.
  for r in select c.id from public.ai_calls c where c.status = 'queued' and c.attempt = 1 and c.created_at < now() - interval '20 seconds' loop
    perform public.ai_caller_to_va(r.id, 'not_started'); to_va := to_va + 1;
  end loop;
  -- Hand-offs nobody took in 60 s → a callback task; the function tells the lead and ends the call.
  for r in select q.id, q.lead_id, q.detail from public.call_queue q
            where q.kind = 'ai_handoff' and q.status in ('waiting', 'offered', 'held') and q.created_at < now() - interval '60 seconds' loop
    update public.call_queue set status = 'expired', cancel_reason = 'no_va_free', offered_to = null where id = r.id;
    update public.va_presence set status = 'available', updated_at = now()
     where status = 'ringing' and user_id = (select offered_to from public.call_queue where id = r.id);
    perform public.route_enqueue('callback', r.lead_id, p_due => now(),
      p_detail => jsonb_build_object('from_ai', true, 'ai_call_id', r.detail ->> 'ai_call_id', 'summary', r.detail ->> 'summary', 'reason', r.detail ->> 'reason'));
    update public.ai_calls set callback_task = true, updated_at = now() where id = (r.detail ->> 'ai_call_id')::uuid;
    perform public.ai_caller_post(jsonb_build_object('action', 'handoff_timeout', 'call_id', r.detail ->> 'ai_call_id'));
    cb := cb + 1;
  end loop;
  return jsonb_build_object('started', started, 'to_va', to_va, 'callbacks', cb);
end;
$$;

-- ── 8. Admin ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_caller_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.ai_caller_settings;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.ai_caller_settings set
    all_agents    = coalesce((p ->> 'all_agents')::boolean, all_agents),
    agent_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'agent_ids') x), case when p ? 'agent_ids' then '{}'::uuid[] else agent_ids end),
    max_call_secs = coalesce((p ->> 'max_call_secs')::int, max_call_secs),
    provider      = coalesce(p ->> 'provider', provider),
    cents_per_min = case when p ? 'cents_per_min' then (p ->> 'cents_per_min')::numeric else cents_per_min end,
    updated_at = now(), updated_by = auth.uid()
   where id returning * into s;
  if p ? 'live' then
    update public.recovery_config set ai_caller_live = (p ->> 'live')::boolean;
  end if;
  insert into public.admin_audit_log (actor, actor_name, via, action, target_table, target_id, new_values)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'admin_ai_caller_save', 'update', 'ai_caller_settings', 'ai_caller', p);
  return to_jsonb(s) || jsonb_build_object('live', (select ai_caller_live from public.recovery_config limit 1));
end;
$$;

-- The AI calls view: the numbers and the latest calls for a date range (Central days).
create or replace function public.admin_ai_calls_view(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz; res jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  f := (coalesce(p_from, (now() at time zone 'America/Chicago')::date - 6))::timestamp at time zone 'America/Chicago';
  t := (coalesce(p_to, (now() at time zone 'America/Chicago')::date) + 1)::timestamp at time zone 'America/Chicago';
  with c as (select * from public.ai_calls where created_at >= f and created_at < t and status in ('done', 'handing_off'))
  select jsonb_build_object(
    'calls', (select count(*) from c),
    'leads', (select count(*) from c where attempt = 1),
    'reached', (select count(distinct lead_id) from c where outcome is distinct from 'no_answer' and outcome is not null),
    'booked', (select count(*) from c where outcome = 'booked'),
    'transferred', (select count(*) from c where outcome = 'transferred'),
    'handed', (select count(*) from c where outcome = 'handed_to_va'),
    'no_answer', (select count(*) from c where outcome = 'no_answer'),
    'opt_out', (select count(*) from c where outcome = 'opt_out'),
    'avg_secs', (select round(avg(secs_to_dial)::numeric, 1) from c where attempt = 1),
    'minutes', (select round(coalesce(sum(duration_secs), 0) / 60.0, 1) from c),
    'cost_cents', (select sum(cost_cents) from c),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'lead_id', c.lead_id, 'name', l.contact_name, 'state', l.state,
                       'agent', p.full_name, 'at', c.created_at, 'attempt', c.attempt, 'secs', round(c.secs_to_dial),
                       'duration', c.duration_secs, 'outcome', c.outcome, 'handoff_reason', c.handoff_reason, 'routed', c.routed,
                       'callback_task', c.callback_task) order by c.created_at desc)
                       from (select * from c order by created_at desc limit 200) c
                       left join public.leads l on l.id = c.lead_id left join public.profiles p on p.id = c.agent_id), '[]'::jsonb),
    'to_va', (select count(*) from public.ai_calls where created_at >= f and created_at < t and status = 'to_va')
  ) into res;
  return res;
end;
$$;

-- ── 9. Grants ─────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.ai_caller_takes(uuid)', 'public.ai_caller_post(jsonb)', 'public.ai_caller_to_va(uuid, text)',
    'public.ai_caller_status(uuid, text, jsonb)', 'public.ai_caller_result(uuid, text, jsonb)', 'public.ai_caller_handoff(uuid, text, text)',
    'public.ai_caller_sweep()', 'public.lead_ai_consent_ok(uuid)', 'public.ai_caller_slots(uuid, integer)',
    'public.ai_caller_book(uuid, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.admin_ai_caller_save(jsonb)', 'public.admin_ai_calls_view(date, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ── 10. Cron: the sweep every 10 seconds (pg_cron 1.5+) ───────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ai-caller-sweep', '10 seconds', 'select public.ai_caller_sweep()');
  end if;
end $$;
