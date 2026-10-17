-- 155 — When a rep misses a call: apologize, hold a retry, then hand to the
-- No answer flow (Prompt 771).
--
-- A booked call is "missed by us" when its time passes and the assigned rep
-- hasn't started it within recovery_config.missed_grace_min (default 10).
-- missed_sweep() (cron, every minute) then, once per missed call:
--   * logs a strike on the rep (fulfillment_missed_calls, 30-day rolling count)
--   * holds a retry on the same row: same time tomorrow in the client's zone,
--     or the nearest open time that day, then the next business day (weekday,
--     client 8 AM–8 PM, carrier open, a rep free). It goes to a different
--     active rep whenever one is free then; the original rep only if nobody
--     else can. The row is marked missed_step = 'rebooking' (badge "Missed by
--     us · rebooking", priority for the rep) and the P767 "New call booked"
--     notification fires for whoever gets it.
--   * queues apology text 1 (missed_text_delay_min after the miss) and, the
--     morning of the retry, apology text 2 — both through recovery-sms, so
--     nothing sends until recovery_config.sms_live is on (the retry still
--     happens with texting off).
--   * notifies the rep (missed_strike, warning from strike 2), admins
--     (rep_missed_call; rep_strikes at 3 in 30 days) and the agent
--     (call_missed_rebooking).
-- The agent isn't charged: it's the same booking (same row, same created_at)
-- moved, so agent_weekly_usage and the cap trigger never see a new one.
--
-- The hold ends (missed_step cleared) when the retry call starts, the client
-- picks a time with the P696 link, the booking is moved by anyone else, or the
-- call is cancelled/archived. If the retry call isn't answered, that's the
-- client's first No answer and P696 starts from the beginning (its
-- recovery_phase is still null). A miss on a call that's already inside P696
-- holds the retry the same way but sends no apology texts (P696 texts that
-- client already), and P696 carries on from where it was.
--
-- A client never gets texts from both flows on the same day: an apology is
-- skipped if a P696 text went out that day, and P696's first text is skipped
-- (straight to its next-morning reminder) if an apology went out that day.
-- Only calls booked for after this migration ran are swept (missed_since), so
-- the old test calls already past their time aren't struck or moved.

-- ── Settings ────────────────────────────────────────────────────────────────
alter table public.recovery_config
  add column if not exists missed_grace_min      integer     not null default 10,
  add column if not exists missed_text_delay_min integer     not null default 15,
  add column if not exists missed_since          timestamptz not null default now();

alter table public.recovery_config drop constraint if exists recovery_config_missed_grace_chk;
alter table public.recovery_config add constraint recovery_config_missed_grace_chk
  check (missed_grace_min between 5 and 60);
alter table public.recovery_config drop constraint if exists recovery_config_missed_delay_chk;
alter table public.recovery_config add constraint recovery_config_missed_delay_chk
  check (missed_text_delay_min between 0 and 120);

grant update (missed_grace_min, missed_text_delay_min) on public.recovery_config to authenticated;

-- ── Per-call state ──────────────────────────────────────────────────────────
alter table public.policies
  add column if not exists missed_step             text,
  add column if not exists missed_at               timestamptz,
  add column if not exists missed_call_at          timestamptz,
  add column if not exists missed_rep_id           uuid references public.profiles(id) on delete set null,
  add column if not exists missed_retry_at         timestamptz,
  add column if not exists missed_next_kind        text,
  add column if not exists missed_next_at          timestamptz,
  add column if not exists missed_apology1_sent_at timestamptz,
  add column if not exists missed_apology2_sent_at timestamptz;

alter table public.policies drop constraint if exists policies_missed_step_chk;
alter table public.policies add constraint policies_missed_step_chk
  check (missed_step is null or missed_step = 'rebooking');
alter table public.policies drop constraint if exists policies_missed_next_kind_chk;
alter table public.policies add constraint policies_missed_next_kind_chk
  check (missed_next_kind is null or missed_next_kind in ('apology1', 'apology2'));

create index if not exists policies_missed_next_idx
  on public.policies (missed_next_at) where missed_next_kind is not null;

-- ── Strikes ─────────────────────────────────────────────────────────────────
create table if not exists public.fulfillment_missed_calls (
  id          uuid primary key default gen_random_uuid(),
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  policy_id   uuid references public.policies(id) on delete set null,
  agent_id    uuid references public.profiles(id) on delete set null,
  call_at     timestamptz not null,
  client_name text,
  retry_at    timestamptz,
  retry_rep_id uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (policy_id, call_at)
);
create index if not exists fulfillment_missed_calls_rep_idx
  on public.fulfillment_missed_calls (rep_id, created_at desc);

alter table public.fulfillment_missed_calls enable row level security;
drop policy if exists fulfillment_missed_calls_read on public.fulfillment_missed_calls;
create policy fulfillment_missed_calls_read on public.fulfillment_missed_calls
  for select to authenticated using (public.is_admin() or rep_id = auth.uid());
revoke all on public.fulfillment_missed_calls from anon, authenticated;
grant select on public.fulfillment_missed_calls to authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- The client's zone (falls back to the agent's, like P696).
create or replace function public.missed_tz(p public.policies)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(btrim(coalesce(p.client_timezone, '')), ''), public.recovery_agent_tz(p.agent_id))
$$;

-- Is this rep active and free (no other open call within 30 min) at p_at?
create or replace function public.fulfillment_rep_free(p_rep uuid, p_at timestamptz, p_policy uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_rep is not null and exists (
    select 1 from profiles r
     where r.id = p_rep and r.role = 'fulfillment' and r.is_active
       and not exists (
         select 1 from policies po
          where po.assigned_fulfillment_id = r.id
            and po.fulfillment_assigned
            and po.fulfillment_stage is distinct from 'Complete'
            and po.id is distinct from p_policy
            and po.scheduled_call_at is not null
            and abs(extract(epoch from po.scheduled_call_at - p_at)) < 1800))
$$;

-- Can the held retry go at p_at? Weekday and 8 AM–8 PM for the client, the
-- carrier open (same check as enforce_agent_booking_rules, 9–5 ET when the
-- carrier's hours are unknown or stale), at least an hour out.
create or replace function public.missed_retry_ok(p public.policies, p_at timestamptz, p_now timestamptz default now())
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  tz      text := public.missed_tz(p);
  c       carriers;
  v_min   int;
  v_fresh boolean;
  v_nine5 constant jsonb := '{"mon":{"open":"09:00","close":"17:00"},"tue":{"open":"09:00","close":"17:00"},"wed":{"open":"09:00","close":"17:00"},"thu":{"open":"09:00","close":"17:00"},"fri":{"open":"09:00","close":"17:00"}}';
begin
  if p_at < p_now + interval '1 hour' then return false; end if;
  if extract(isodow from p_at at time zone tz) >= 6 then return false; end if;
  v_min := extract(hour from p_at at time zone tz)::int * 60 + extract(minute from p_at at time zone tz)::int;
  if v_min < 8 * 60 or v_min > 20 * 60 then return false; end if;

  select * into c from carriers where id = p.carrier_id;
  if not found then
    return public.booking_hours_ok(p_at, v_nine5, 'America/New_York');
  end if;
  v_fresh := c.hours is not null and c.hours_tz is not null and c.hours_checked_at is not null
             and c.hours_checked_at > p_now - case when c.hours_status = 'fallback'
                                                    then interval '7 days' else interval '180 days' end;
  return (c.hours is not null and c.hours_tz is not null and public.booking_hours_ok(p_at, c.hours, c.hours_tz))
      or (not v_fresh and public.booking_hours_ok(p_at, v_nine5, 'America/New_York'));
end;
$$;

-- The held retry: same time tomorrow (client's zone); else the nearest open
-- time that day; else the next business day, the same way. A different rep
-- whenever one is free then; the missed rep only if nobody else is (and only
-- if they're still on). No row = nothing open in the next 3 weeks.
create or replace function public.missed_pick_retry(p_policy uuid, p_missed_rep uuid, p_now timestamptz default now())
returns table (at timestamptz, rep uuid)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  pol policies;
  tz  text;
  t   time;
  d0  date;
  dd  date;
  c   timestamptz;
  r   uuid;
begin
  select * into pol from policies where id = p_policy;
  if not found then return; end if;
  tz := public.missed_tz(pol);
  t  := (pol.scheduled_call_at at time zone tz)::time;
  d0 := greatest((pol.scheduled_call_at at time zone tz)::date + 1, (p_now at time zone tz)::date);

  for i in 0..20 loop
    dd := d0 + i;
    continue when extract(isodow from dd) >= 6;
    for c in
      select public.recovery_local_at(dd, t, tz) + make_interval(mins => 30 * k)
        from generate_series(-24, 24) k
       order by abs(k), k
    loop
      continue when (c at time zone tz)::date <> dd;
      continue when not public.missed_retry_ok(pol, c, p_now);
      r := public.fulfillment_pick_rep(c, pol.id, p_missed_rep);
      if r is not null and not public.fulfillment_rep_free(r, c, pol.id) then r := null; end if;
      if r is null and public.fulfillment_rep_free(p_missed_rep, c, pol.id) then r := p_missed_rep; end if;
      if r is not null then
        at := c; rep := r;
        return next;
        return;
      end if;
    end loop;
  end loop;
end;
$$;

-- ── The sweep (cron, every minute) ──────────────────────────────────────────
create or replace function public.missed_sweep(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  cfg      recovery_config;
  r        policies;
  pk       record;
  sid      uuid;
  strikes  integer;
  who      text;
  rep_nm   text;
  new_nm   text;
  p696     boolean;
  adm      record;
  n        integer := 0;
begin
  select * into cfg from recovery_config limit 1;

  for r in
    select * from policies
     where fulfillment_assigned and assigned_fulfillment_id is not null
       and fulfillment_stage is distinct from 'Complete' and archived_at is null
       and scheduled_call_at is not null
       and scheduled_call_at >= cfg.missed_since
       and scheduled_call_at <= p_now - make_interval(mins => cfg.missed_grace_min)
       and call_live_since is null
       and (last_call_at is null or last_call_at < scheduled_call_at - interval '15 minutes')
       and missed_call_at is distinct from scheduled_call_at
     order by scheduled_call_at
     for update skip locked
  loop
    who := public.notify_client(r);
    sid := null;
    insert into fulfillment_missed_calls (rep_id, policy_id, agent_id, call_at, client_name, created_at)
    values (r.assigned_fulfillment_id, r.id, r.agent_id, r.scheduled_call_at, who, p_now)
    on conflict (policy_id, call_at) do nothing
    returning id into sid;
    continue when sid is null;

    select * into pk from public.missed_pick_retry(r.id, r.assigned_fulfillment_id, p_now);
    update fulfillment_missed_calls set retry_at = pk.at, retry_rep_id = pk.rep where id = sid;
    p696 := r.recovery_phase is not null;

    perform set_config('ohvara.missed_hold', 'on', true);
    update policies
       set scheduled_call_at       = coalesce(pk.at, scheduled_call_at),
           assigned_fulfillment_id = coalesce(pk.rep, assigned_fulfillment_id),
           fulfillment_claimed_at  = case when pk.rep is not null and pk.rep is distinct from r.assigned_fulfillment_id
                                          then p_now else fulfillment_claimed_at end,
           fulfillment_stage       = case when pk.at is not null then 'Pending' else fulfillment_stage end,
           missed_step             = case when pk.at is not null then 'rebooking' end,
           missed_at               = p_now,
           missed_call_at          = r.scheduled_call_at,
           missed_rep_id           = r.assigned_fulfillment_id,
           missed_retry_at         = pk.at,
           missed_next_kind        = case when pk.at is not null and not p696 then 'apology1' end,
           missed_next_at          = case when pk.at is not null and not p696
                                          then p_now + make_interval(mins => cfg.missed_text_delay_min) end,
           missed_apology1_sent_at = null,
           missed_apology2_sent_at = null,
           recovery_retry_at       = case when p696 and pk.at is not null then pk.at else recovery_retry_at end
     where id = r.id;
    perform set_config('ohvara.missed_hold', 'off', true);

    select count(*) into strikes from fulfillment_missed_calls
     where rep_id = r.assigned_fulfillment_id
       and created_at > p_now - interval '30 days' and created_at <= p_now;
    select full_name into rep_nm from profiles where id = r.assigned_fulfillment_id;
    select full_name into new_nm from profiles where id = pk.rep;
    rep_nm := coalesce(nullif(btrim(rep_nm), ''), 'A rep');

    perform public.notify(r.assigned_fulfillment_id, 'missed_strike', 'You missed a call',
      who || ' · ' || public.notify_when(r.scheduled_call_at, r.assigned_fulfillment_id, true)
        || ' · strike ' || strikes || ' in 30 days'
        || case when strikes >= 2 then '. At 3, Brayden is told.' else '' end,
      case when pk.rep = r.assigned_fulfillment_id then '/fulfillment/desk?open=' || r.id else '/fulfillment' end,
      strikes >= 2, 'strike:' || sid, jsonb_build_object('policy_id', r.id, 'strikes', strikes));

    for adm in select id from profiles where role = 'admin' and coalesce(is_active, true) loop
      perform public.notify(adm.id, 'rep_missed_call', rep_nm || ' missed a call',
        who || ' · ' || public.notify_when(r.scheduled_call_at, adm.id, true)
          || coalesce(' · retry ' || public.notify_when(pk.at, adm.id, true)
                      || coalesce(' with ' || nullif(btrim(new_nm), ''), ''), ' · no retry time open'),
        '/admin/pipeline?open=' || r.id, pk.at is null, 'repmiss:' || sid,
        jsonb_build_object('policy_id', r.id, 'rep_id', r.assigned_fulfillment_id, 'strikes', strikes));
      if strikes = 3 then
        perform public.notify(adm.id, 'rep_strikes', rep_nm || ' hit 3 missed calls',
          '3 in the last 30 days · latest ' || who, '/admin/users', true, 'strikes3:' || sid,
          jsonb_build_object('rep_id', r.assigned_fulfillment_id));
      end if;
    end loop;

    perform public.notify(r.agent_id, 'call_missed_rebooking', 'We missed the call with ' || who,
      case when pk.at is not null
           then 'Sorry. We''re calling them again ' || public.notify_when(pk.at, r.agent_id, true) || '. It doesn''t use a booking.'
           else 'Sorry. We''re finding a new time now. It doesn''t use a booking.' end,
      '/agent/clients?open=' || r.id, false, 'missed:' || sid, jsonb_build_object('policy_id', r.id));

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── Ending the hold ─────────────────────────────────────────────────────────
-- Nothing outside the sweep can set the missed_* fields (inserts are wiped),
-- and the hold ends once the call starts, it's cancelled/archived, or anyone
-- else moves the booking (the client's link pick, the agent, an admin).
create or replace function public.missed_clear_trigger()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    new.missed_step := null; new.missed_at := null; new.missed_call_at := null;
    new.missed_rep_id := null; new.missed_retry_at := null;
    new.missed_next_kind := null; new.missed_next_at := null;
    new.missed_apology1_sent_at := null; new.missed_apology2_sent_at := null;
    return new;
  end if;
  if coalesce(current_setting('ohvara.missed_hold', true), '') = 'on' then return new; end if;
  if old.missed_step is not null
     and (new.fulfillment_stage = 'Complete' or new.call_live_since is not null
          or new.scheduled_call_at is distinct from old.scheduled_call_at
          or not coalesce(new.fulfillment_assigned, false) or new.archived_at is not null) then
    new.missed_step := null; new.missed_retry_at := null;
    new.missed_next_kind := null; new.missed_next_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists policies_missed_clear on public.policies;
create trigger policies_missed_clear before insert or update on public.policies
  for each row execute function public.missed_clear_trigger();

-- ── Apology texts (claimed by recovery-sms) ─────────────────────────────────
create or replace function public.missed_advance(p_policy uuid, p_kind text, p_sent_at timestamptz, p_now timestamptz default now())
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  pol policies;
  cfg recovery_config;
  tz  text;
  a2  timestamptz;
begin
  select * into pol from policies where id = p_policy;
  select * into cfg from recovery_config limit 1;
  tz := public.missed_tz(pol);
  if p_kind = 'apology1' then
    -- The morning of the retry (reminder_time, never later than 30 min before
    -- it), and only if that's at least 3 hours after this one.
    a2 := least(public.recovery_local_at((pol.missed_retry_at at time zone tz)::date, cfg.reminder_time, tz),
                pol.missed_retry_at - interval '30 minutes');
    update policies
       set missed_apology1_sent_at = p_sent_at,
           missed_next_kind = case when a2 >= p_now + interval '3 hours' then 'apology2' end,
           missed_next_at   = case when a2 >= p_now + interval '3 hours' then a2 end
     where id = p_policy;
  else
    update policies
       set missed_apology2_sent_at = p_sent_at, missed_next_kind = null, missed_next_at = null
     where id = p_policy;
  end if;
end;
$$;

create or replace function public.missed_claim_due(p_limit integer default 25, p_now timestamptz default now())
returns table (policy_id uuid, kind text, first_name text, phone text, retry_at timestamptz, token uuid, agent_name text, tz text)
language plpgsql security definer set search_path to 'public' as $$
declare
  cfg recovery_config;
  r   policies;
  ltz text;
  lt  time;
begin
  select * into cfg from recovery_config limit 1;
  if not coalesce(cfg.sms_live, false) then return; end if;

  for r in
    select * from policies
     where missed_next_kind in ('apology1', 'apology2') and missed_next_at <= p_now
     order by missed_next_at
     limit p_limit
     for update skip locked
  loop
    ltz := public.missed_tz(r);
    if r.missed_step is distinct from 'rebooking' or r.fulfillment_stage = 'Complete'
       or r.call_live_since is not null
       or nullif(btrim(coalesce(r.client_phone, '')), '') is null
       or not coalesce((select no_answer_sms_opt_in from profiles where id = r.agent_id), false) then
      update policies set missed_next_kind = null, missed_next_at = null where id = r.id;
      continue;
    end if;
    -- No texts before 8 AM or from 9 PM, client's time.
    lt := (p_now at time zone ltz)::time;
    if lt < time '08:00' or lt >= time '21:00' then
      update policies
         set missed_next_at = public.recovery_local_at(
               (p_now at time zone ltz)::date + case when lt >= time '21:00' then 1 else 0 end, time '08:00', ltz)
       where id = r.id;
      continue;
    end if;
    -- One flow per day: P696 already texted this client today → skip this one.
    if exists (select 1 from recovery_sms_log l
                where l.policy_id = r.id and l.ok and l.kind not in ('apology1', 'apology2')
                  and (l.created_at at time zone ltz)::date = (p_now at time zone ltz)::date) then
      perform public.missed_advance(r.id, r.missed_next_kind, null, p_now);
      continue;
    end if;

    update policies set missed_next_at = p_now + interval '15 minutes' where id = r.id;
    policy_id  := r.id;
    kind       := r.missed_next_kind;
    first_name := coalesce(nullif(btrim(r.client_first_name), ''), 'there');
    phone      := r.client_phone;
    retry_at   := r.missed_retry_at;
    token      := r.recovery_token;
    agent_name := (select full_name from profiles where id = r.agent_id);
    tz         := ltz;
    return next;
  end loop;
end;
$$;

create or replace function public.missed_mark_sent(p_policy uuid, p_kind text, p_ok boolean, p_sid text default null,
                                                   p_error text default null, p_phone text default null, p_now timestamptz default now())
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  pol      policies;
  failures integer;
begin
  insert into recovery_sms_log (policy_id, kind, to_phone, ok, twilio_sid, error, created_at)
  values (p_policy, p_kind, p_phone, p_ok, p_sid, p_error, p_now);

  select * into pol from policies where id = p_policy for update;
  if not found or pol.missed_next_kind is distinct from p_kind then return; end if;

  if not p_ok then
    select count(*) into failures from recovery_sms_log
     where policy_id = p_policy and kind = p_kind and not ok and created_at >= pol.missed_at;
    if failures < 3 then return; end if;
  end if;
  perform public.missed_advance(p_policy, p_kind, case when p_ok then p_now end, p_now);
end;
$$;

-- ── P696 changes: the link works for a missed call, one flow's texts a day ──
create or replace function public.recovery_link_info(p_token uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
  if pol.recovery_step is null and pol.missed_step is null then
    return base || jsonb_build_object(
      'status', case when pol.last_call_outcome is null and pol.scheduled_call_at is not null then 'booked' else 'closed' end,
      'scheduled_call_at', pol.scheduled_call_at);
  end if;
  return base || jsonb_build_object(
    'status', 'open',
    'retry_at', coalesce(pol.missed_retry_at, pol.recovery_retry_at),
    'slots', coalesce((select jsonb_agg(s) from public.recovery_slot_list(pol.id) s), '[]'::jsonb));
end;
$function$;

create or replace function public.recovery_link_pick(p_token uuid, p_at timestamp with time zone default null::timestamp with time zone, p_asap boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pol policies;
  at_ timestamptz := p_at;
  who text;
begin
  select * into pol from policies where recovery_token = p_token and fulfillment_assigned for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if pol.fulfillment_stage = 'Complete' or pol.call_live_since is not null
     or (pol.recovery_step is null and pol.missed_step is null) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if p_asap then
    select min(s) into at_ from public.recovery_slot_list(pol.id) s;
  end if;
  if at_ is null or not exists (select 1 from public.recovery_slot_list(pol.id) s where s = at_) then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  -- Moving the time also ends a missed-by-us hold (missed_clear_trigger).
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
$function$;

create or replace function public.recovery_claim_due(p_limit integer default 25)
 returns table(policy_id uuid, kind text, first_name text, phone text, retry_at timestamp with time zone, token uuid, agent_name text, tz text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cfg recovery_config;
  r   policies;
  atz text;
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

    atz := public.recovery_agent_tz(r.agent_id);
    -- P771: an apology text already went to this client today → skip text 1
    -- and go straight to the next-morning reminder.
    if r.recovery_next_kind = 'text1' and exists (
         select 1 from recovery_sms_log l
          where l.policy_id = r.id and l.ok and l.kind in ('apology1', 'apology2')
            and (l.created_at at time zone public.missed_tz(r))::date = (now() at time zone public.missed_tz(r))::date) then
      update policies
         set recovery_next_kind = 'text2',
             recovery_next_at = greatest(
               least(public.recovery_local_at((r.recovery_retry_at at time zone atz)::date, cfg.reminder_time, atz),
                     r.recovery_retry_at - interval '30 minutes'),
               now() + interval '5 minutes')
       where id = r.id;
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
    tz         := atz;
    return next;
  end loop;
end;
$function$;

-- ── Who can call what ───────────────────────────────────────────────────────
revoke all on function public.missed_tz(public.policies) from public, anon, authenticated;
revoke all on function public.fulfillment_rep_free(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.missed_retry_ok(public.policies, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.missed_pick_retry(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.missed_sweep(timestamptz) from public, anon, authenticated;
revoke all on function public.missed_clear_trigger() from public, anon, authenticated;
revoke all on function public.missed_advance(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.missed_claim_due(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.missed_mark_sent(uuid, text, boolean, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.missed_claim_due(integer, timestamptz) to service_role;
grant execute on function public.missed_mark_sent(uuid, text, boolean, text, text, text, timestamptz) to service_role;

-- ── Notifications P767 left waiting for this ────────────────────────────────
update public.notification_types set fires = true
 where type in ('call_missed_rebooking', 'missed_strike', 'rep_missed_call', 'rep_strikes');

-- ── Cron ────────────────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'missed-sweep';
select cron.schedule('missed-sweep', '* * * * *', 'select public.missed_sweep()');
