-- 157 — Texting go-live rules (Prompt 776).
--
-- Twilio is reviewing an A2P campaign whose opt-in is VERBAL: the agent reads
-- a script at booking time and ticks "Client agreed to texts". This migration
-- makes the server hold every client text to what that campaign registered:
--
--   * per-booking consent on policies (sms_consent + who/when/script version,
--     stamped by a trigger, never taken from the client). Bookings made before
--     this have none and are never texted.
--   * an opt-out list (sms_opt_outs) fed by the inbound webhook (STOP/START)
--     and by Twilio's 21610 "unsubscribed" send error.
--   * one gate, sms_check(), used by both text queues (P696 no-answer, P771
--     missed-by-us). A text is sent only if sms_live is on (the claim
--     functions return nothing otherwise), the agent's opt-in is on, the
--     booking has consent, the number isn't opted out, it's 8 AM–9 PM client
--     time, it maps onto one of the registered samples, and it fits the cap
--     of 4 texts per call (the one-time confirmation counts). Anything else is
--     skipped — logged, and the flow moves on exactly as if the text went —
--     or, for quiet hours, held until 8 AM client time.
--   * the first text a booking gets is preceded by the registered
--     confirmation text (needs_confirm on the claimed row).
--
-- Registered samples (bodies are composed in recovery-sms/core.ts):
--   missed   — "We tried you at [time] and missed you…"  (P696 text1, Phase-2 AM)
--   reminder — "Reminder, we're calling you today at [time]…" (P696 text2, P771
--              apology2, and apology1 when the held retry is later today)
--   sorry    — "Sorry…, we missed your [time] call today. We'll call you
--              tomorrow at [time]…" (P771 apology1 when the retry is tomorrow)
--   confirm  — "You're set to get texts about your call…"
-- No registered text fits the Phase-2 PM text, so it is always skipped
-- (flagged to Brayden in the ship note); the agent hand-off still happens.
--
-- Team-invite texts (P731) aren't in the campaign either: they now need their
-- own switch, recovery_config.invite_sms_live (off), as well as sms_live.

-- ── consent on the booking ───────────────────────────────────────────────────
alter table public.policies
  add column if not exists sms_consent         boolean not null default false,
  add column if not exists sms_consent_at      timestamptz,
  add column if not exists sms_consent_by      uuid references public.profiles(id) on delete set null,
  add column if not exists sms_consent_version text;

create table if not exists public.sms_consent_scripts (
  version    text primary key,
  script     text not null,
  created_at timestamptz not null default now()
);
alter table public.sms_consent_scripts enable row level security;
revoke all on public.sms_consent_scripts from anon, authenticated;
grant select on public.sms_consent_scripts to authenticated;
drop policy if exists sms_consent_scripts_read on public.sms_consent_scripts;
create policy sms_consent_scripts_read on public.sms_consent_scripts for select to authenticated using (true);
insert into public.sms_consent_scripts (version, script) values ('v1',
  'Ohvara will text you at this number about your cancellation call, including reminders and a link to reschedule. Up to 4 messages per call. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Do you agree?')
on conflict (version) do nothing;

create or replace function public.sms_consent_version()
returns text language sql immutable as $$ select 'v1'::text $$;

-- Who/when/version always come from the server. Ticking the box stamps them;
-- unticking clears them; any other write keeps the stamp as it was (a signed-in
-- user can't forge it). The service role (no auth.uid()) may write them as-is.
create or replace function public.policies_sms_consent_stamp()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if not new.sms_consent then
      new.sms_consent_at := null; new.sms_consent_by := null; new.sms_consent_version := null;
    elsif auth.uid() is not null then
      new.sms_consent_at := now(); new.sms_consent_by := auth.uid(); new.sms_consent_version := public.sms_consent_version();
    end if;
  elsif new.sms_consent is distinct from old.sms_consent then
    if new.sms_consent then
      new.sms_consent_at := now(); new.sms_consent_by := auth.uid(); new.sms_consent_version := public.sms_consent_version();
    else
      new.sms_consent_at := null; new.sms_consent_by := null; new.sms_consent_version := null;
    end if;
  elsif auth.uid() is not null then
    new.sms_consent_at := old.sms_consent_at; new.sms_consent_by := old.sms_consent_by;
    new.sms_consent_version := old.sms_consent_version;
  end if;
  return new;
end;
$$;
drop trigger if exists policies_sms_consent on public.policies;
create trigger policies_sms_consent before insert or update on public.policies
  for each row execute function public.policies_sms_consent_stamp();

-- Change booking: the agent who booked it ticks or unticks consent.
create or replace function public.agent_set_sms_consent(p_policy uuid, p_agreed boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare pol policies;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not coalesce(pol.fulfillment_assigned, false) then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if pol.agent_id is distinct from auth.uid() then
    raise exception 'Only the agent who booked this can change text consent' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' or pol.archived_at is not null then
    raise exception 'This booking is closed' using errcode = '22023';
  end if;
  update policies set sms_consent = coalesce(p_agreed, false) where id = p_policy;
end;
$$;
revoke all on function public.agent_set_sms_consent(uuid, boolean) from public, anon;
grant execute on function public.agent_set_sms_consent(uuid, boolean) to authenticated;

-- ── opt-outs ─────────────────────────────────────────────────────────────────
create or replace function public.sms_e164(p text)
returns text language sql immutable as $$
  select case
    when length(d) = 10 then '+1' || d
    when length(d) = 11 and left(d, 1) = '1' then '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create table if not exists public.sms_opt_outs (
  phone      text primary key,            -- E.164, +1XXXXXXXXXX
  opted_out  boolean not null,
  source     text,                        -- 'STOP', 'START', 'twilio_21610', …
  changed_at timestamptz not null default now()
);
alter table public.sms_opt_outs enable row level security;
revoke all on public.sms_opt_outs from anon, authenticated;

create or replace function public.sms_set_opt(p_phone text, p_opted_out boolean, p_source text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare e text := public.sms_e164(p_phone);
begin
  if e is null then return; end if;
  insert into sms_opt_outs (phone, opted_out, source, changed_at) values (e, p_opted_out, p_source, now())
  on conflict (phone) do update set opted_out = excluded.opted_out, source = excluded.source, changed_at = excluded.changed_at;
end;
$$;

create or replace function public.sms_is_opted_out(p_phone text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select opted_out from sms_opt_outs where phone = public.sms_e164(p_phone)), false)
$$;

-- ── the log ──────────────────────────────────────────────────────────────────
alter table public.recovery_sms_log add column if not exists skipped text;   -- reason, when nothing was sent

alter table public.recovery_config add column if not exists invite_sms_live boolean not null default false;

-- ── the gate ─────────────────────────────────────────────────────────────────
-- What to do with one due text: 'send' (with the sample to use and whether the
-- confirmation goes first), 'skip' (with a reason) or 'defer' (to o_until).
-- Expects recovery_config.sms_live to be on already (the callers check).
create or replace function public.sms_check(r public.policies, p_kind text, p_now timestamptz default now(),
  out o_action text, out o_sample text, out o_confirm boolean, out o_reason text, out o_until timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  tz      text := public.missed_tz(r);
  lt      timestamp := p_now at time zone tz;
  today   date := (p_now at time zone tz)::date;
  v_retry timestamptz := case when p_kind like 'apology%' then r.missed_retry_at else r.recovery_retry_at end;
  rday    date := (v_retry at time zone tz)::date;
  sent    integer;
  cfails  integer;
begin
  o_confirm := false;
  if not coalesce((select no_answer_sms_opt_in from profiles where id = r.agent_id), false) then
    o_action := 'skip'; o_reason := 'agent_opt_in_off'; return;
  end if;
  if public.sms_e164(r.client_phone) is null then
    o_action := 'skip'; o_reason := 'no_phone'; return;
  end if;
  if not coalesce(r.sms_consent, false) or r.sms_consent_at is null then
    o_action := 'skip'; o_reason := 'no_consent'; return;
  end if;
  if public.sms_is_opted_out(r.client_phone) then
    o_action := 'skip'; o_reason := 'opted_out'; return;
  end if;
  if nullif(btrim(coalesce(r.carrier_name, '')), '') is null
     and not exists (select 1 from carriers c where c.id = r.carrier_id) then
    o_action := 'skip'; o_reason := 'no_carrier'; return;
  end if;
  if lt::time < time '08:00' or lt::time >= time '21:00' then
    o_action := 'defer';
    o_until := public.recovery_local_at(today + case when lt::time >= time '21:00' then 1 else 0 end, time '08:00', tz);
    return;
  end if;

  o_sample := case p_kind
    when 'text1'    then 'missed'
    when 'am'       then 'missed'
    when 'text2'    then case when rday = today then 'reminder' end
    when 'apology2' then case when rday = today then 'reminder' end
    when 'apology1' then case
                           when rday = today then 'reminder'
                           when rday = today + 1 and (r.missed_call_at at time zone tz)::date = today then 'sorry'
                         end
  end;   -- 'pm': nothing registered fits
  if o_sample is null then
    o_action := 'skip'; o_reason := 'no_registered_text'; return;
  end if;
  -- "We tried you at [time]" must be about a recent try.
  if o_sample = 'missed' and coalesce(r.last_call_at, p_now) < p_now - interval '36 hours' then
    o_action := 'skip'; o_reason := 'stale'; o_sample := null; return;
  end if;

  select count(*) filter (where ok),
         count(*) filter (where kind = 'confirm' and not ok and skipped is null)
    into sent, cfails
    from recovery_sms_log where policy_id = r.id and created_at >= r.sms_consent_at;
  o_confirm := not exists (select 1 from recovery_sms_log
                            where policy_id = r.id and kind = 'confirm' and ok and created_at >= r.sms_consent_at);
  if o_confirm and cfails >= 3 then
    o_action := 'skip'; o_reason := 'confirm_failed'; o_sample := null; o_confirm := false; return;
  end if;
  if sent + 1 + o_confirm::int > 4 then
    o_action := 'skip'; o_reason := 'cap'; o_sample := null; o_confirm := false; return;
  end if;
  o_action := 'send';
end;
$$;

-- ── moving the P696 flow on (was inline in recovery_mark_sent) ───────────────
create or replace function public.recovery_advance(p_policy uuid, p_kind text, p_sent_at timestamptz, p_now timestamptz default now())
returns void language plpgsql security definer set search_path to 'public' as $$
declare pol policies; cfg recovery_config; tz text;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or pol.recovery_next_kind is distinct from p_kind then return; end if;
  select * into cfg from recovery_config limit 1;
  tz := public.recovery_agent_tz(pol.agent_id);
  if p_kind = 'text1' then
    update policies
       set recovery_text1_sent_at = p_sent_at, recovery_next_kind = 'text2',
           recovery_next_at = greatest(
             least(public.recovery_local_at((pol.recovery_retry_at at time zone tz)::date, cfg.reminder_time, tz),
                   pol.recovery_retry_at - interval '30 minutes'),
             p_now + interval '5 minutes')
     where id = p_policy;
  elsif p_kind = 'text2' then
    update policies set recovery_text2_sent_at = p_sent_at, recovery_next_kind = null, recovery_next_at = null where id = p_policy;
  elsif p_kind = 'am' then
    update policies
       set recovery_am_sent_at = p_sent_at, recovery_next_kind = 'pm',
           recovery_next_at = greatest(public.recovery_local_at(pol.recovery_followup_day, cfg.evening_time, tz), p_now + interval '5 minutes')
     where id = p_policy;
  elsif p_kind = 'pm' then
    update policies
       set recovery_pm_sent_at = p_sent_at, recovery_next_kind = 'handoff',
           recovery_next_at = greatest(public.recovery_local_at(pol.recovery_followup_day + 1, time '00:00', tz), p_now)
     where id = p_policy;
  end if;
end;
$$;

-- Log a text that won't be sent and move its flow on.
create or replace function public.sms_skip(p_policy uuid, p_kind text, p_reason text, p_phone text default null, p_now timestamptz default now())
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into recovery_sms_log (policy_id, kind, to_phone, ok, skipped, created_at)
  values (p_policy, p_kind, public.sms_e164(p_phone), false, p_reason, p_now);
  if p_kind in ('apology1', 'apology2') then
    if exists (select 1 from policies where id = p_policy and missed_next_kind = p_kind) then
      perform public.missed_advance(p_policy, p_kind, null, p_now);
    end if;
  else
    perform public.recovery_advance(p_policy, p_kind, null, p_now);
  end if;
end;
$$;

create or replace function public.sms_log_confirm(p_policy uuid, p_ok boolean, p_sid text default null,
  p_error text default null, p_phone text default null, p_now timestamptz default now())
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into recovery_sms_log (policy_id, kind, to_phone, ok, twilio_sid, error, created_at)
  values (p_policy, 'confirm', p_phone, p_ok, p_sid, p_error, p_now);
  if not p_ok and coalesce(p_error, '') like '%21610%' then
    perform public.sms_set_opt(p_phone, true, 'twilio_21610');
  end if;
end;
$$;

-- ── P696 queue ───────────────────────────────────────────────────────────────
drop function if exists public.recovery_claim_due(integer);
create or replace function public.recovery_claim_due(p_limit integer default 25, p_now timestamptz default now())
returns table(policy_id uuid, kind text, sample text, needs_confirm boolean, first_name text, phone text,
              agent_name text, carrier text, tried_at timestamptz, retry_at timestamptz, token uuid, tz text)
language plpgsql security definer set search_path to 'public' as $$
declare cfg recovery_config; r policies; atz text; g record;
begin
  select * into cfg from recovery_config limit 1;
  if not coalesce(cfg.sms_live, false) then return; end if;
  for r in
    select * from policies where recovery_next_kind in ('text1', 'text2', 'am', 'pm') and recovery_next_at <= p_now
    order by recovery_next_at limit p_limit for update skip locked
  loop
    if r.call_live_since is not null then
      update policies set recovery_next_at = p_now + interval '10 minutes' where id = r.id;
      continue;
    end if;
    if r.fulfillment_stage = 'Complete' or r.last_call_outcome is distinct from 'no_answer' then
      update policies set recovery_next_kind = null, recovery_next_at = null where id = r.id;
      continue;
    end if;
    atz := public.recovery_agent_tz(r.agent_id);
    if r.recovery_next_kind = 'text1' and exists (
         select 1 from recovery_sms_log l where l.policy_id = r.id and l.ok and l.kind in ('apology1', 'apology2')
            and (l.created_at at time zone public.missed_tz(r))::date = (p_now at time zone public.missed_tz(r))::date) then
      update policies
         set recovery_next_kind = 'text2',
             recovery_next_at = greatest(least(public.recovery_local_at((r.recovery_retry_at at time zone atz)::date, cfg.reminder_time, atz), r.recovery_retry_at - interval '30 minutes'), p_now + interval '5 minutes')
       where id = r.id;
      continue;
    end if;
    select * into g from public.sms_check(r, r.recovery_next_kind, p_now);
    if g.o_action = 'defer' then
      update policies set recovery_next_at = g.o_until where id = r.id;
      continue;
    elsif g.o_action = 'skip' then
      perform public.sms_skip(r.id, r.recovery_next_kind, g.o_reason, r.client_phone, p_now);
      continue;
    end if;
    update policies set recovery_next_at = p_now + interval '15 minutes' where id = r.id;
    policy_id := r.id; kind := r.recovery_next_kind; sample := g.o_sample; needs_confirm := g.o_confirm;
    first_name := coalesce(nullif(btrim(r.client_first_name), ''), 'there');
    phone := public.sms_e164(r.client_phone);
    agent_name := (select nullif(btrim(full_name), '') from profiles where id = r.agent_id);
    carrier := coalesce(nullif(btrim(r.carrier_name), ''), (select c.name from carriers c where c.id = r.carrier_id));
    tried_at := coalesce(r.last_call_at, p_now); retry_at := r.recovery_retry_at;
    token := r.recovery_token; tz := public.missed_tz(r);
    return next;
  end loop;
end;
$$;

-- Same as 122's, plus: 21610 = the number opted out (stop now, no retries);
-- skipped rows don't count as failures; the advance lives in recovery_advance.
create or replace function public.recovery_mark_sent(p_policy uuid, p_kind text, p_ok boolean, p_sid text default null,
  p_error text default null, p_phone text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare failures integer; opted boolean := not p_ok and coalesce(p_error, '') like '%21610%';
begin
  insert into recovery_sms_log (policy_id, kind, to_phone, ok, twilio_sid, error)
  values (p_policy, p_kind, p_phone, p_ok, p_sid, p_error);
  if opted then perform public.sms_set_opt(p_phone, true, 'twilio_21610'); end if;
  if not p_ok and not opted then
    select count(*) into failures from recovery_sms_log
     where policy_id = p_policy and kind = p_kind and not ok and skipped is null;
    if failures < 3 then return; end if;
  end if;
  perform public.recovery_advance(p_policy, p_kind, case when p_ok then now() end, now());
end;
$$;

-- ── P771 queue ───────────────────────────────────────────────────────────────
drop function if exists public.missed_claim_due(integer, timestamptz);
create or replace function public.missed_claim_due(p_limit integer default 25, p_now timestamptz default now())
returns table(policy_id uuid, kind text, sample text, needs_confirm boolean, first_name text, phone text,
              agent_name text, carrier text, tried_at timestamptz, retry_at timestamptz, token uuid, tz text)
language plpgsql security definer set search_path to 'public' as $$
declare cfg recovery_config; r policies; ltz text; g record;
begin
  select * into cfg from recovery_config limit 1;
  if not coalesce(cfg.sms_live, false) then return; end if;
  for r in
    select * from policies where missed_next_kind in ('apology1', 'apology2') and missed_next_at <= p_now
     order by missed_next_at limit p_limit for update skip locked
  loop
    ltz := public.missed_tz(r);
    if r.missed_step is distinct from 'rebooking' or r.fulfillment_stage = 'Complete' or r.call_live_since is not null then
      update policies set missed_next_kind = null, missed_next_at = null where id = r.id;
      continue;
    end if;
    if exists (select 1 from recovery_sms_log l where l.policy_id = r.id and l.ok and l.kind not in ('apology1', 'apology2', 'confirm')
                  and (l.created_at at time zone ltz)::date = (p_now at time zone ltz)::date) then
      perform public.missed_advance(r.id, r.missed_next_kind, null, p_now);
      continue;
    end if;
    select * into g from public.sms_check(r, r.missed_next_kind, p_now);
    if g.o_action = 'defer' then
      update policies set missed_next_at = g.o_until where id = r.id;
      continue;
    elsif g.o_action = 'skip' then
      perform public.sms_skip(r.id, r.missed_next_kind, g.o_reason, r.client_phone, p_now);
      continue;
    end if;
    update policies set missed_next_at = p_now + interval '15 minutes' where id = r.id;
    policy_id := r.id; kind := r.missed_next_kind; sample := g.o_sample; needs_confirm := g.o_confirm;
    first_name := coalesce(nullif(btrim(r.client_first_name), ''), 'there');
    phone := public.sms_e164(r.client_phone);
    agent_name := (select nullif(btrim(full_name), '') from profiles where id = r.agent_id);
    carrier := coalesce(nullif(btrim(r.carrier_name), ''), (select c.name from carriers c where c.id = r.carrier_id));
    tried_at := r.missed_call_at; retry_at := r.missed_retry_at;
    token := r.recovery_token; tz := ltz;
    return next;
  end loop;
end;
$$;

create or replace function public.missed_mark_sent(p_policy uuid, p_kind text, p_ok boolean, p_sid text default null,
  p_error text default null, p_phone text default null, p_now timestamptz default now())
returns void language plpgsql security definer set search_path to 'public' as $$
declare pol policies; failures integer; opted boolean := not p_ok and coalesce(p_error, '') like '%21610%';
begin
  insert into recovery_sms_log (policy_id, kind, to_phone, ok, twilio_sid, error, created_at) values (p_policy, p_kind, p_phone, p_ok, p_sid, p_error, p_now);
  if opted then perform public.sms_set_opt(p_phone, true, 'twilio_21610'); end if;
  select * into pol from policies where id = p_policy for update;
  if not found or pol.missed_next_kind is distinct from p_kind then return; end if;
  if not p_ok and not opted then
    select count(*) into failures from recovery_sms_log
     where policy_id = p_policy and kind = p_kind and not ok and skipped is null and created_at >= pol.missed_at;
    if failures < 3 then return; end if;
  end if;
  perform public.missed_advance(p_policy, p_kind, case when p_ok then p_now end, p_now);
end;
$$;

-- ── grants: everything above except the consent RPC is the worker's ─────────
revoke all on function public.sms_e164(text) from public, anon, authenticated;
revoke all on function public.sms_set_opt(text, boolean, text) from public, anon, authenticated;
revoke all on function public.sms_is_opted_out(text) from public, anon, authenticated;
revoke all on function public.sms_check(public.policies, text, timestamptz) from public, anon, authenticated;
revoke all on function public.recovery_advance(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.sms_skip(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.sms_log_confirm(uuid, boolean, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.recovery_claim_due(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.recovery_mark_sent(uuid, text, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.missed_claim_due(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.missed_mark_sent(uuid, text, boolean, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.policies_sms_consent_stamp() from public, anon, authenticated;
grant execute on function public.sms_set_opt(text, boolean, text) to service_role;
grant execute on function public.sms_is_opted_out(text) to service_role;
grant execute on function public.sms_log_confirm(uuid, boolean, text, text, text, timestamptz) to service_role;
grant execute on function public.recovery_claim_due(integer, timestamptz) to service_role;
grant execute on function public.recovery_mark_sent(uuid, text, boolean, text, text, text) to service_role;
grant execute on function public.missed_claim_due(integer, timestamptz) to service_role;
grant execute on function public.missed_mark_sent(uuid, text, boolean, text, text, text, timestamptz) to service_role;
