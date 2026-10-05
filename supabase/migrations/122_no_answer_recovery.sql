-- Prompt 696 — No-answer recovery: text → text → one locked retry call →
-- confirm the number → morning + evening text next day → hand off to the agent.
--
-- Everything that doesn't need a text message lives here and works today; the
-- actual SMS send is the edge function `recovery-sms` and stays OFF until
-- recovery_config.sms_live is flipped (needs an SMS-capable Twilio number +
-- A2P 10DLC registration). While it's off, no lead ever enters the flow.
--
-- Phase 1 (locked retry day), starts when a call ends No answer and the agent
-- has opted in:
--   1. text 1 fires now: missed you, retry already locked, self-serve link.
--   2. the retry slot is reserved for real — same time tomorrow in the agent's
--      zone, moved to the nearest later slot a rep is actually free at if that
--      one is taken (fulfillment_slot_free) — by moving scheduled_call_at; the
--      existing autoassign trigger (116) then puts it on a free rep's desk.
--   3. text 2 the next morning (recovery_config.reminder_time, never later than
--      30 min before the call).
--   4. the rep makes the retry call. Cancelled → done. No answer again → the
--      checkpoint: all automation stops until the agent confirms the number.
-- Phase 2, after the agent confirms the number (any time of day):
--   the next fresh calendar day: a morning text, an evening text
--   (recovery_config.evening_time), same link, no slot reserved; if neither is
--   answered by midnight the agent is notified to call the client themselves.
--   That ends automation for the lead.
-- Using the link at any point rebooks the lead (status → Booked) and ends the
-- flow. Re-booking by hand (agent_rebook_call) and Cancelled end it too.
--
-- Not built, by design: freeform reply parsing (the link is the only response
-- channel), weekend skipping for the "same time tomorrow" retry, a timeout for
-- a rep who never makes the retry call.

-- ── config ──────────────────────────────────────────────────────────────────
create table if not exists public.recovery_config (
  id            boolean primary key default true check (id),
  sms_live      boolean not null default false,
  reminder_time time    not null default '09:15',
  evening_time  time    not null default '18:30',
  updated_at    timestamptz not null default now()
);
insert into public.recovery_config default values on conflict do nothing;

alter table public.recovery_config enable row level security;
drop policy if exists recovery_config_read on public.recovery_config;
create policy recovery_config_read on public.recovery_config
  for select to authenticated using (true);
drop policy if exists recovery_config_admin_update on public.recovery_config;
create policy recovery_config_admin_update on public.recovery_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.recovery_config from anon, authenticated;
grant select on public.recovery_config to authenticated;
grant update (sms_live, reminder_time, evening_time, updated_at) on public.recovery_config to authenticated;

-- ── agent opt-in (one-time consent) ─────────────────────────────────────────
alter table public.profiles
  add column if not exists no_answer_sms_opt_in boolean not null default false,
  add column if not exists no_answer_sms_opted_in_at timestamptz;

create or replace function public.profiles_stamp_sms_opt_in()
returns trigger
language plpgsql
as $$
begin
  if new.no_answer_sms_opt_in then
    if tg_op = 'INSERT' or not old.no_answer_sms_opt_in then
      new.no_answer_sms_opted_in_at := now();
    else
      new.no_answer_sms_opted_in_at := old.no_answer_sms_opted_in_at;
    end if;
  else
    new.no_answer_sms_opted_in_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_stamp_sms_opt_in on public.profiles;
create trigger profiles_stamp_sms_opt_in
  before insert or update of no_answer_sms_opt_in on public.profiles
  for each row execute function public.profiles_stamp_sms_opt_in();

-- ── per-lead flow state ─────────────────────────────────────────────────────
alter table public.policies
  add column if not exists recovery_phase               smallint,
  add column if not exists recovery_step                text,
  add column if not exists recovery_retry_at            timestamptz,
  add column if not exists recovery_next_kind           text,
  add column if not exists recovery_next_at             timestamptz,
  add column if not exists recovery_followup_day        date,
  add column if not exists recovery_text1_sent_at       timestamptz,
  add column if not exists recovery_text2_sent_at       timestamptz,
  add column if not exists recovery_am_sent_at          timestamptz,
  add column if not exists recovery_pm_sent_at          timestamptz,
  add column if not exists recovery_number_confirmed_at timestamptz,
  add column if not exists recovery_handoff_at          timestamptz,
  add column if not exists recovery_responded_at        timestamptz,
  add column if not exists recovery_token               uuid not null default gen_random_uuid();

create unique index if not exists policies_recovery_token_idx on public.policies (recovery_token);
create index if not exists policies_recovery_due_idx
  on public.policies (recovery_next_at) where recovery_next_kind is not null;

do $$ begin
  alter table public.policies add constraint policies_recovery_phase_check
    check (recovery_phase is null or recovery_phase in (1, 2));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.policies add constraint policies_recovery_step_check
    check (recovery_step is null or recovery_step in ('retry_locked', 'number_check', 'followup', 'call_directly'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.policies add constraint policies_recovery_next_kind_check
    check (recovery_next_kind is null or recovery_next_kind in ('text1', 'text2', 'am', 'pm', 'handoff'));
exception when duplicate_object then null; end $$;

-- Every send attempt, for the audit trail and the 3-strikes rule. Service role only.
create table if not exists public.recovery_sms_log (
  id         uuid primary key default gen_random_uuid(),
  policy_id  uuid not null references public.policies(id) on delete cascade,
  kind       text not null,
  to_phone   text,
  ok         boolean not null,
  twilio_sid text,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists recovery_sms_log_policy_idx on public.recovery_sms_log (policy_id, kind);
alter table public.recovery_sms_log enable row level security;
revoke all on public.recovery_sms_log from anon, authenticated;

-- ── helpers ─────────────────────────────────────────────────────────────────

create or replace function public.recovery_agent_tz(p_agent uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select timezone from profiles where id = p_agent), 'America/Chicago')
$$;

-- A wall-clock date + time in a zone, as an instant.
create or replace function public.recovery_local_at(p_date date, p_time time, p_tz text)
returns timestamptz
language sql
stable
as $$
  select (p_date + p_time) at time zone p_tz
$$;

-- Is there an active rep with no open call within 30 minutes of p_at? Same
-- 30-minute window fulfillment_pick_rep (116) uses for its conflict check.
create or replace function public.fulfillment_slot_free(p_at timestamptz, p_policy uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles r
    where r.role = 'fulfillment' and r.is_active
      and not exists (
        select 1 from policies po
        where po.assigned_fulfillment_id = r.id
          and po.fulfillment_assigned
          and po.fulfillment_stage is distinct from 'Complete'
          and po.id is distinct from p_policy
          and po.scheduled_call_at is not null
          and abs(extract(epoch from po.scheduled_call_at - p_at)) < 1800
      )
  )
$$;

-- The wanted slot if a rep is free then, otherwise the nearest later 30-minute
-- slot inside the 9:00 AM–4:00 PM window (rolling to the next morning).
create or replace function public.recovery_pick_retry_slot(p_want timestamptz, p_tz text, p_policy uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c  timestamptz := p_want;
  lt timestamp;
begin
  for i in 0..60 loop
    if public.fulfillment_slot_free(c, p_policy) then
      return c;
    end if;
    c  := c + interval '30 minutes';
    lt := c at time zone p_tz;
    if lt::time > time '16:00' or lt::time < time '09:00' then
      c := public.recovery_local_at(
        case when lt::time < time '09:00' then lt::date else lt::date + 1 end, time '09:00', p_tz);
    end if;
  end loop;
  return p_want;   -- nobody free anywhere: autoassign still places it, never orphaned
end;
$$;

-- Open slots a client may pick from the link: the next 8 days, weekdays,
-- 9:00 AM–4:00 PM in the agent's zone, at least an hour out, free for some rep.
create or replace function public.recovery_slot_list(p_policy uuid)
returns setof timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with pol as (
    select id, public.recovery_agent_tz(agent_id) as tz from policies where id = p_policy
  )
  select s from (
    select public.recovery_local_at(
             ((now() at time zone pol.tz)::date + d), time '09:00' + k * interval '30 minutes', pol.tz) as s,
           pol.id, pol.tz
    from pol, generate_series(0, 7) d, generate_series(0, 14) k
  ) x
  where s > now() + interval '1 hour'
    and extract(isodow from s at time zone x.tz) < 6
    and public.fulfillment_slot_free(s, x.id)
  order by s
$$;

-- Wipes the flow (not the audit trail, not responded_at).
create or replace function public.recovery_clear_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.fulfillment_stage = 'Complete' then
    new.recovery_phase := null;           new.recovery_step := null;
    new.recovery_retry_at := null;        new.recovery_next_kind := null;
    new.recovery_next_at := null;         new.recovery_followup_day := null;
    new.recovery_text1_sent_at := null;   new.recovery_text2_sent_at := null;
    new.recovery_am_sent_at := null;      new.recovery_pm_sent_at := null;
    new.recovery_number_confirmed_at := null; new.recovery_handoff_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists policies_recovery_clear on public.policies;
create trigger policies_recovery_clear
  before update on public.policies
  for each row execute function public.recovery_clear_trigger();

-- ── a call just ended No answer ─────────────────────────────────────────────
create or replace function public.recovery_after_no_answer(p_policy uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol    policies;
  cfg    recovery_config;
  tz     text;
  want   timestamptz;
  retry  timestamptz;
  who    text;
begin
  select * into pol from policies where id = p_policy;
  select * into cfg from recovery_config limit 1;
  who := coalesce(nullif(btrim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, '')), ''), 'A client');

  -- The retry also went unanswered: stop, and make the agent confirm the number.
  if pol.recovery_phase = 1 then
    update policies
       set recovery_step = 'number_check', recovery_next_kind = null, recovery_next_at = null
     where id = p_policy;
    insert into notifications (profile_id, type, message, data)
    values (pol.agent_id, 'no_answer_number_check',
            who || ' didn''t pick up twice. Confirm their number to continue.',
            jsonb_build_object('policy_id', pol.id, 'link', '/agent/clients?stage=noAnswer&open=' || pol.id));
    return;
  end if;

  -- Phase 2 is hands-off; a stray call there changes nothing.
  if pol.recovery_phase is not null then
    return;
  end if;

  if not coalesce(cfg.sms_live, false) then return; end if;
  if not coalesce((select no_answer_sms_opt_in from profiles where id = pol.agent_id), false) then return; end if;
  if nullif(btrim(coalesce(pol.client_phone, '')), '') is null then return; end if;

  tz := public.recovery_agent_tz(pol.agent_id);
  -- same time tomorrow on the agent's wall clock (DST-safe)
  want := ((coalesce(pol.scheduled_call_at, now()) at time zone tz) + interval '1 day') at time zone tz;
  while want < now() + interval '2 hours' loop
    want := ((want at time zone tz) + interval '1 day') at time zone tz;
  end loop;
  retry := public.recovery_pick_retry_slot(want, tz, pol.id);

  -- Moving scheduled_call_at with the stage back on Pending makes the
  -- autoassign trigger re-check which rep is free at the new time.
  update policies
     set scheduled_call_at = retry,
         fulfillment_stage = 'Pending',
         recovery_phase = 1, recovery_step = 'retry_locked', recovery_retry_at = retry,
         recovery_next_kind = 'text1', recovery_next_at = now(),
         recovery_followup_day = null,
         recovery_text1_sent_at = null, recovery_text2_sent_at = null,
         recovery_am_sent_at = null, recovery_pm_sent_at = null,
         recovery_number_confirmed_at = null, recovery_handoff_at = null
   where id = p_policy;

  -- The stage flip above makes the stamp trigger clear the rep's optional
  -- reason (waiting on carrier/client); put it back — the stage is unchanged
  -- this time, so nothing clears it again.
  if pol.cancellation_substatus is not null then
    update policies set cancellation_substatus = pol.cancellation_substatus where id = p_policy;
  end if;
end;
$$;
revoke all on function public.recovery_after_no_answer(uuid) from public, anon, authenticated;

-- fulfillment_end_call (121) + the recovery hook.
create or replace function public.fulfillment_end_call(
  p_policy  uuid,
  p_outcome text,
  p_reason  text default null     -- optional: waiting_carrier | waiting_client
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
begin
  if p_outcome not in ('no_answer', 'rescheduling') then
    raise exception 'Outcome must be no_answer' using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in ('waiting_carrier', 'waiting_client') then
    raise exception 'Unknown reason' using errcode = '22023';
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then
    raise exception 'Only the rep it''s assigned to (or an admin) can end this call' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This one is already cancelled' using errcode = '22023';
  end if;
  if pol.call_live_since is null then
    raise exception 'No call is live on this one' using errcode = '22023';
  end if;

  update policies
     set call_live_since        = null,
         last_call_outcome      = 'no_answer',
         last_call_at           = now(),
         cancellation_substatus = p_reason
   where id = p_policy;

  perform public.recovery_after_no_answer(p_policy);
end;
$$;
revoke all on function public.fulfillment_end_call(uuid, text, text) from public, anon;
grant execute on function public.fulfillment_end_call(uuid, text, text) to authenticated;

-- agent_rebook_call (121) + end the recovery flow.
create or replace function public.agent_rebook_call(p_policy uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
begin
  if p_at is null or p_at < now() - interval '5 minutes' then
    raise exception 'Pick a time in the future' using errcode = '22023';
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.agent_id = auth.uid()) then
    raise exception 'Only the agent who booked this (or an admin) can re-book it' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' or pol.call_live_since is not null
     or pol.last_call_outcome is distinct from 'no_answer' then
    raise exception 'Only a lead sitting on No answer can be re-booked' using errcode = '22023';
  end if;

  update policies
     set scheduled_call_at      = p_at,
         last_call_outcome      = null,
         cancellation_substatus = null,
         fulfillment_stage      = 'Pending',
         recovery_phase = null, recovery_step = null, recovery_retry_at = null,
         recovery_next_kind = null, recovery_next_at = null, recovery_followup_day = null,
         recovery_text1_sent_at = null, recovery_text2_sent_at = null,
         recovery_am_sent_at = null, recovery_pm_sent_at = null,
         recovery_number_confirmed_at = null, recovery_handoff_at = null
   where id = p_policy;
end;
$$;
revoke all on function public.agent_rebook_call(uuid, timestamptz) from public, anon;
grant execute on function public.agent_rebook_call(uuid, timestamptz) to authenticated;

-- ── the agent confirms the number (the checkpoint) ──────────────────────────
-- Optionally corrects it in the same step. Nothing fires until the next fresh
-- calendar day in the agent's zone.
create or replace function public.agent_confirm_recovery_number(p_policy uuid, p_phone text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
  cfg recovery_config;
  tz  text;
  d   date;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.agent_id = auth.uid()) then
    raise exception 'Only the agent who booked this (or an admin) can confirm the number' using errcode = '42501';
  end if;
  if pol.recovery_step is distinct from 'number_check' or pol.fulfillment_stage = 'Complete' then
    raise exception 'Nothing to confirm on this one' using errcode = '22023';
  end if;
  if p_phone is not null and length(regexp_replace(p_phone, '\D', '', 'g')) not between 10 and 11 then
    raise exception 'Enter a 10-digit phone number' using errcode = '22023';
  end if;

  select * into cfg from recovery_config limit 1;
  tz := public.recovery_agent_tz(pol.agent_id);
  d  := (now() at time zone tz)::date + 1;

  update policies
     set client_phone = coalesce(nullif(btrim(p_phone), ''), client_phone),
         recovery_phase = 2, recovery_step = 'followup',
         recovery_number_confirmed_at = now(), recovery_followup_day = d,
         recovery_next_kind = 'am', recovery_next_at = public.recovery_local_at(d, cfg.reminder_time, tz),
         recovery_am_sent_at = null, recovery_pm_sent_at = null
   where id = p_policy;
end;
$$;
revoke all on function public.agent_confirm_recovery_number(uuid, text) from public, anon;
grant execute on function public.agent_confirm_recovery_number(uuid, text) to authenticated;

-- ── the SMS worker's side (service role only) ───────────────────────────────

-- Hands the edge function the texts that are due. Re-validates each lead at
-- claim time, and leases it for 15 minutes so a crashed run retries.
create or replace function public.recovery_claim_due(p_limit integer default 25)
returns table (
  policy_id uuid, kind text, first_name text, phone text,
  retry_at timestamptz, token uuid, agent_name text, tz text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg recovery_config;
  r   policies;
begin
  select * into cfg from recovery_config limit 1;
  if not coalesce(cfg.sms_live, false) then return; end if;

  for r in
    select * from policies
    where recovery_next_kind in ('text1', 'text2', 'am', 'pm')
      and recovery_next_at <= now()
    order by recovery_next_at
    limit p_limit
    for update skip locked
  loop
    if r.call_live_since is not null then
      update policies set recovery_next_at = now() + interval '10 minutes' where id = r.id;
      continue;
    end if;
    if r.fulfillment_stage = 'Complete' or r.last_call_outcome is distinct from 'no_answer'
       or nullif(btrim(coalesce(r.client_phone, '')), '') is null
       or not coalesce((select no_answer_sms_opt_in from profiles where id = r.agent_id), false) then
      update policies set recovery_next_kind = null, recovery_next_at = null where id = r.id;
      continue;
    end if;

    update policies set recovery_next_at = now() + interval '15 minutes' where id = r.id;
    policy_id  := r.id;
    kind       := r.recovery_next_kind;
    first_name := coalesce(nullif(btrim(r.client_first_name), ''), 'there');
    phone      := r.client_phone;
    retry_at   := r.recovery_retry_at;
    token      := r.recovery_token;
    agent_name := (select full_name from profiles where id = r.agent_id);
    tz         := public.recovery_agent_tz(r.agent_id);
    return next;
  end loop;
end;
$$;

-- Records a send and moves the lead to its next step. A failed send is retried
-- (next claim, 15 min later); after 3 failures that text is skipped so the flow
-- can't stall on a number that can't receive texts.
create or replace function public.recovery_mark_sent(
  p_policy uuid, p_kind text, p_ok boolean, p_sid text default null,
  p_error text default null, p_phone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol      policies;
  cfg      recovery_config;
  tz       text;
  failures integer;
  sent_at  timestamptz;
begin
  insert into recovery_sms_log (policy_id, kind, to_phone, ok, twilio_sid, error)
  values (p_policy, p_kind, p_phone, p_ok, p_sid, p_error);

  if not p_ok then
    select count(*) into failures from recovery_sms_log
     where policy_id = p_policy and kind = p_kind and not ok;
    if failures < 3 then return; end if;
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or pol.recovery_next_kind is distinct from p_kind then return; end if;

  select * into cfg from recovery_config limit 1;
  tz := public.recovery_agent_tz(pol.agent_id);
  sent_at := case when p_ok then now() end;

  if p_kind = 'text1' then
    update policies
       set recovery_text1_sent_at = sent_at, recovery_next_kind = 'text2',
           recovery_next_at = greatest(
             least(public.recovery_local_at((pol.recovery_retry_at at time zone tz)::date, cfg.reminder_time, tz),
                   pol.recovery_retry_at - interval '30 minutes'),
             now() + interval '5 minutes')
     where id = p_policy;
  elsif p_kind = 'text2' then
    update policies
       set recovery_text2_sent_at = sent_at, recovery_next_kind = null, recovery_next_at = null
     where id = p_policy;
  elsif p_kind = 'am' then
    update policies
       set recovery_am_sent_at = sent_at, recovery_next_kind = 'pm',
           recovery_next_at = greatest(public.recovery_local_at(pol.recovery_followup_day, cfg.evening_time, tz),
                                       now() + interval '5 minutes')
     where id = p_policy;
  elsif p_kind = 'pm' then
    update policies
       set recovery_pm_sent_at = sent_at, recovery_next_kind = 'handoff',
           recovery_next_at = greatest(public.recovery_local_at(pol.recovery_followup_day + 1, time '00:00', tz), now())
     where id = p_policy;
  end if;
end;
$$;

-- Phase 2 ran its course unanswered → the agent calls the client themselves.
-- Needs no SMS, so it runs on its own cron regardless of sms_live.
create or replace function public.recovery_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r policies;
  n integer := 0;
begin
  for r in
    select * from policies
    where recovery_next_kind = 'handoff' and recovery_next_at <= now()
    for update skip locked
  loop
    update policies
       set recovery_step = 'call_directly', recovery_next_kind = null, recovery_next_at = null,
           recovery_handoff_at = now()
     where id = r.id;
    insert into notifications (profile_id, type, message, data)
    values (r.agent_id, 'no_answer_call_directly',
            coalesce(nullif(btrim(coalesce(r.client_first_name, '') || ' ' || coalesce(r.client_last_name, '')), ''), 'A client')
              || ' hasn''t replied to our texts. Call them yourself and rebook.',
            jsonb_build_object('policy_id', r.id, 'link', '/agent/clients?stage=noAnswer&open=' || r.id));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── the client's self-serve link (service role only; the edge function wraps it) ─

create or replace function public.recovery_link_info(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pol policies;
  agent_first text;
  base jsonb;
begin
  select * into pol from policies where recovery_token = p_token and fulfillment_assigned;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select split_part(btrim(coalesce(full_name, '')), ' ', 1) into agent_first from profiles where id = pol.agent_id;
  base := jsonb_build_object(
    'first_name', nullif(btrim(coalesce(pol.client_first_name, '')), ''),
    'agent_first_name', nullif(agent_first, ''),
    'tz', public.recovery_agent_tz(pol.agent_id));

  if pol.fulfillment_stage = 'Complete' then
    return base || jsonb_build_object('status', 'closed');
  end if;
  if pol.recovery_step is null then
    -- already used the link (or an agent rebooked): show what's on the books
    return base || jsonb_build_object(
      'status', case when pol.last_call_outcome is null and pol.scheduled_call_at is not null then 'booked' else 'closed' end,
      'scheduled_call_at', pol.scheduled_call_at);
  end if;
  return base || jsonb_build_object(
    'status', 'open',
    'retry_at', pol.recovery_retry_at,
    'slots', coalesce((select jsonb_agg(s) from public.recovery_slot_list(pol.id) s), '[]'::jsonb));
end;
$$;

create or replace function public.recovery_link_pick(p_token uuid, p_at timestamptz default null, p_asap boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
  at_ timestamptz := p_at;
  who text;
begin
  select * into pol from policies where recovery_token = p_token and fulfillment_assigned for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if pol.fulfillment_stage = 'Complete' or pol.call_live_since is not null or pol.recovery_step is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if p_asap then
    select min(s) into at_ from public.recovery_slot_list(pol.id) s;
  end if;
  if at_ is null or not exists (select 1 from public.recovery_slot_list(pol.id) s where s = at_) then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  update policies
     set scheduled_call_at = at_,
         last_call_outcome = null, cancellation_substatus = null,
         fulfillment_stage = 'Pending',
         recovery_responded_at = now(),
         recovery_phase = null, recovery_step = null, recovery_retry_at = null,
         recovery_next_kind = null, recovery_next_at = null, recovery_followup_day = null,
         recovery_text1_sent_at = null, recovery_text2_sent_at = null,
         recovery_am_sent_at = null, recovery_pm_sent_at = null,
         recovery_number_confirmed_at = null, recovery_handoff_at = null
   where id = pol.id;

  who := coalesce(nullif(btrim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, '')), ''), 'A client');
  insert into notifications (profile_id, type, message, data)
  values (pol.agent_id, 'no_answer_self_rebook', who || ' picked a new time for their call.',
          jsonb_build_object('policy_id', pol.id, 'link', '/agent/clients?open=' || pol.id));

  return jsonb_build_object('ok', true, 'at', at_);
end;
$$;

-- ── permissions: worker + link functions are service-role only ──────────────
do $$
declare f text;
begin
  foreach f in array array[
    'recovery_agent_tz(uuid)', 'recovery_local_at(date, time, text)',
    'fulfillment_slot_free(timestamptz, uuid)', 'recovery_pick_retry_slot(timestamptz, text, uuid)',
    'recovery_slot_list(uuid)', 'recovery_claim_due(integer)',
    'recovery_mark_sent(uuid, text, boolean, text, text, text)', 'recovery_sweep()',
    'recovery_link_info(uuid)', 'recovery_link_pick(uuid, timestamptz, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── crons ───────────────────────────────────────────────────────────────────
-- The hand-off needs no SMS, so it's plain SQL. The sender is the edge
-- function, a no-op until recovery_config.sms_live is on.
select cron.schedule('recovery-sweep', '*/5 * * * *', $$select public.recovery_sweep()$$);
select cron.schedule(
  'recovery-sms',
  '*/5 * * * *',
  $$select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/recovery-sms',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  )$$
);
