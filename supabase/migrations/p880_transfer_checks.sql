-- P880 — Live transfer for real: Check agent, the Yes/No app push, cold transfer and bounce-back.
--
-- NOT NUMBERED, NOT APPLIED. Brayden gives it a number and applies it (Parallel rule 4). Additive only:
-- new tables, new columns on push_devices, new functions, one notification type, two cron jobs. Nothing is
-- dropped, renamed or emptied. 182's my_incoming_transfer and 211's agent_accept_transfer stay (the old
-- TransferAlert no longer calls them; a later cleanup can retire them).
--
-- APPLY ORDER: after 156 (push_devices, notify), 175 (leads.va_*), 179 (help_calls), 174 (agent_duty).
--
-- The flow (How Ohvara Works → Live transfer, decided Nov 7). help-transfer and transfer-voice write these
-- rows with the service role; the browser only reads its own rows (RLS) and listens on realtime.
--
--   transfer_checks          one row per Check agent. status:
--     sent        the push left for at least one of the agent's phones; expires_at = sent_at + 30 s
--     seen        the agent's phone showed it (Android delivery ping) or the app opened it
--     yes / no    the agent answered in time (first answer wins on any device)
--     late_yes    Yes after the 30 s while the VA still has the lead on the line, unbooked: "Transfer now"
--     no_answer   30 s passed with no answer (the sweep, or the next read, settles it)
--     failed      no phone could be reached: "Couldn't reach agent", book at once
--     withdrawn   the agent took back a Yes before the transfer connected
--     cancelled   the VA's leg or the lead dropped before the hand-off
--     ringing     Yes → the lead is on hold music and the agent's phone rings (about 20 s)
--     connected   the agent pressed 1: the lead is with the agent, the VA dropped off. delivered = true
--     bounced     nobody pressed 1 in time: the lead is back with the VA
--     booked      the VA booked the lead instead (booked_for)
--   transfer_readiness       per agent: the Setup push test, the test transfer call, the daily health check.
--   push_devices.permission / time_sensitive / reported_at   what the app last reported.

do $$
begin
  if to_regclass('public.push_devices') is null then raise exception 'p880 needs 156_phone_app applied first'; end if;
  if to_regclass('public.help_calls') is null then raise exception 'p880 needs 179_help_calls applied first'; end if;
  if to_regclass('public.agent_duty') is null then raise exception 'p880 needs 174_agent_duty applied first'; end if;
end $$;

-- ── 1. The checks ───────────────────────────────────────────────────────────
create table if not exists public.transfer_checks (
  id              uuid primary key default gen_random_uuid(),
  call_sid        text references public.help_calls(call_sid) on delete set null,
  va_id           uuid references public.profiles(id) on delete set null,
  agent_id        uuid not null references public.profiles(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete set null,
  -- What the push and the whisper say: { name, age, state, need, your_client }.
  summary         jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  status          text not null default 'sent' check (status in (
                    'sent', 'seen', 'yes', 'no', 'late_yes', 'no_answer', 'failed', 'withdrawn',
                    'cancelled', 'ringing', 'connected', 'bounced', 'booked')),
  is_test         boolean not null default false,
  seen_token      text not null default replace(gen_random_uuid()::text, '-', ''),
  devices         int not null default 0,      -- phones the push reached
  fail_reason     text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  expires_at      timestamptz,                 -- the 30 s timer, kept here so a reload keeps it
  seen_at         timestamptz,
  answered_at     timestamptz,
  answer          text check (answer in ('yes', 'no')),
  answered_device text,                        -- the phone that answered first (the rest are cleared)
  response_secs   numeric,
  ring_started_at timestamptz,
  agent_call_sid  text,
  connected_at    timestamptz,
  delivered       boolean not null default false,  -- Q26: counted as delivered when the agent picks up
  bounced_at      timestamptz,
  ended_reason    text,
  booked_for      timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists transfer_checks_agent_idx on public.transfer_checks (agent_id, created_at desc);
create index if not exists transfer_checks_call_idx on public.transfer_checks (call_sid);
create index if not exists transfer_checks_open_idx on public.transfer_checks (expires_at)
  where status in ('sent', 'seen');
-- One live check per agent at a time (a second VA is told "Agent being checked"). Test checks don't count.
create unique index if not exists transfer_checks_one_open_uidx on public.transfer_checks (agent_id)
  where status in ('sent', 'seen', 'yes', 'late_yes', 'ringing') and not is_test;

comment on table public.transfer_checks is
  'P880: one row per Check agent (push → Yes/No → cold transfer → connected or bounced). Written by help-transfer and transfer-voice only.';
comment on column public.transfer_checks.delivered is
  'Q26: a live transfer counts as delivered when the agent picks up (presses 1). Never billed per call.';

create or replace function public.transfer_checks_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists transfer_checks_touch on public.transfer_checks;
create trigger transfer_checks_touch before update on public.transfer_checks
  for each row execute function public.transfer_checks_touch();

alter table public.transfer_checks enable row level security;
revoke all on public.transfer_checks from anon, authenticated;
grant select on public.transfer_checks to authenticated;
-- The VA on the call, the agent asked, and admins. seen_token is never needed in the browser, but it is
-- only good for one check's "seen" ping, so reading your own is harmless.
drop policy if exists transfer_checks_read on public.transfer_checks;
create policy transfer_checks_read on public.transfer_checks for select to authenticated
  using (va_id = auth.uid() or agent_id = auth.uid() or public.is_admin());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transfer_checks') then
    alter publication supabase_realtime add table public.transfer_checks;
  end if;
end $$;

-- ── 2. Phone health (what the app reports) ──────────────────────────────────
alter table public.push_devices
  add column if not exists permission     text check (permission in ('granted', 'denied', 'prompt')),
  add column if not exists time_sensitive text check (time_sensitive in ('on', 'off', 'unknown')),
  add column if not exists reported_at    timestamptz;

-- Called by the app on launch and resume (lib/push.js). Only the caller's own phone.
create or replace function public.push_report(p_token text, p_permission text, p_time_sensitive text default 'unknown')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  update push_devices
     set permission = case when p_permission in ('granted', 'denied', 'prompt') then p_permission end,
         time_sensitive = case when p_time_sensitive in ('on', 'off') then p_time_sensitive else 'unknown' end,
         reported_at = now(), last_seen_at = now()
   where token = p_token and profile_id = auth.uid();
end; $$;
revoke execute on function public.push_report(text, text, text) from public, anon;
grant execute on function public.push_report(text, text, text) to authenticated;

-- ── 3. Readiness: the Setup push test, the test call, the daily check ───────
create table if not exists public.transfer_readiness (
  agent_id      uuid primary key references public.profiles(id) on delete cascade,
  push_ok_at    timestamptz,      -- the test push was answered Yes from the phone
  call_ok_at    timestamptz,      -- the test transfer call was answered (pressed 1)
  last_test_at  timestamptz,
  fail_reason   text,             -- no_device | denied | no_answer | push_failed | call_no_answer | voice_off
  booking_only  boolean not null default true,   -- live calls stay off until both tests pass
  checked_at    timestamptz,      -- the daily health check
  updated_at    timestamptz not null default now()
);
alter table public.transfer_readiness enable row level security;
revoke all on public.transfer_readiness from anon, authenticated;
grant select on public.transfer_readiness to authenticated;
drop policy if exists transfer_readiness_read on public.transfer_readiness;
create policy transfer_readiness_read on public.transfer_readiness for select to authenticated
  using (agent_id = auth.uid() or public.is_admin() or public.is_fulfillment());

-- Is this agent reachable for live calls? Read by the VA phone (Check agent) and the agent's own card.
--   ready        both tests passed, not switched to booking-only, and a phone with notifications allowed
--   reason       'not_tested' | 'booking_only' | 'no_device' | 'notifications_off' | null
-- transfer_reach_for: the service role's version (help-transfer); transfer_reach: the same for a signed-in
-- user, only about themselves (agents) or anyone (VAs, admins).
create or replace function public.transfer_reach_for(p_agent uuid)
returns table (agent_id uuid, ready boolean, reason text, devices int, last_ok timestamptz)
language sql stable security definer set search_path = public as $$
  with d as (
    select count(*) filter (where coalesce(permission, 'granted') = 'granted')::int as ok,
           count(*)::int as n
      from push_devices where profile_id = p_agent
  ), r as (select * from transfer_readiness where agent_id = p_agent)
  select p_agent,
         coalesce(d.ok > 0 and r.push_ok_at is not null and r.call_ok_at is not null and not r.booking_only, false),
         case when d.n = 0 then 'no_device'
              when d.ok = 0 then 'notifications_off'
              when r.agent_id is null or r.push_ok_at is null or r.call_ok_at is null then 'not_tested'
              when r.booking_only then 'booking_only' end,
         d.n, greatest(r.push_ok_at, r.call_ok_at)
    from d left join r on true
$$;
revoke execute on function public.transfer_reach_for(uuid) from public, anon, authenticated;

create or replace function public.transfer_reach(p_agent uuid)
returns table (agent_id uuid, ready boolean, reason text, devices int, last_ok timestamptz)
language sql stable security definer set search_path = public as $$
  select * from public.transfer_reach_for(p_agent)
   where auth.uid() = p_agent or public.is_admin() or public.is_fulfillment()
$$;
revoke execute on function public.transfer_reach(uuid) from public, anon;
grant execute on function public.transfer_reach(uuid) to authenticated;

-- Admin: every agent who can't get live calls right now, and why.
create or replace function public.admin_unreachable_agents()
returns table (agent_id uuid, name text, reason text, devices int, checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(trim(p.full_name), ''), p.email),
         t.reason, t.devices, r.checked_at
    from profiles p
    cross join lateral public.transfer_reach_for(p.id) t
    left join transfer_readiness r on r.agent_id = p.id
   where public.is_admin() and p.role = 'agent' and coalesce(p.is_active, true) and not coalesce(p.is_demo, false)
     and not t.ready
   order by 2
$$;
revoke execute on function public.admin_unreachable_agents() from public, anon;
grant execute on function public.admin_unreachable_agents() to authenticated;

-- ── 4. The sweep (every minute): settle timers, cancel checks whose call ended ─
-- A check past its 30 s with no answer becomes no_answer. A check whose help call ended (the VA's leg or
-- the lead dropped) before the hand-off is cancelled, and the lead gets a VA callback in 5 minutes.
create or replace function public.transfer_checks_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  update transfer_checks set status = 'no_answer', ended_reason = coalesce(ended_reason, 'timer')
   where status in ('sent', 'seen') and expires_at < now();
  get diagnostics k = row_count; n := n + k;

  with gone as (
    update transfer_checks c
       set status = 'cancelled', ended_reason = 'call_ended'
      from help_calls h
     where h.call_sid = c.call_sid and h.status = 'ended'
       and c.status in ('sent', 'seen', 'yes', 'late_yes', 'ringing')
    returning c.lead_id
  )
  update leads l set va_outcome = 'callback', va_callback_at = now() + interval '5 minutes'
    from gone where l.id = gone.lead_id and coalesce(l.va_outcome, '') not in ('booked', 'transferred');
  get diagnostics k = row_count; n := n + k;
  return n;
end; $$;
revoke execute on function public.transfer_checks_sweep() from public, anon, authenticated;

-- ── 5. Daily app health (N-H-18) ────────────────────────────────────────────
-- An agent who passed the tests but has no phone with notifications allowed any more (new phone, app
-- removed, alerts turned off, or a token Apple/Google says is dead, which notify-push deletes) is switched
-- to booking-only, and the agent and every admin are told. Turning it back on is passing the push test again.
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select 'live_calls_unreachable', array['agent', 'admin'], 'Live calls switched to booking only', true, 'notify', true, true, false, true,
       coalesce((select max(sort) from public.notification_types), 0) + 1
 where not exists (select 1 from public.notification_types where type = 'live_calls_unreachable');

create or replace function public.transfer_health_daily()
returns int language plpgsql security definer set search_path = public as $$
declare a record; n int := 0; adm uuid;
begin
  for a in
    select r.agent_id, split_part(p.full_name, ' ', 1) as first_name
      from transfer_readiness r join profiles p on p.id = r.agent_id
     where not r.booking_only and r.push_ok_at is not null
       and not exists (select 1 from push_devices d where d.profile_id = r.agent_id
                        and coalesce(d.permission, 'granted') = 'granted'
                        and d.last_seen_at > now() - interval '14 days')
  loop
    update transfer_readiness set booking_only = true, fail_reason = 'no_device', checked_at = now(), updated_at = now()
     where agent_id = a.agent_id;
    perform public.notify(a.agent_id, 'live_calls_unreachable', 'Live calls are paused',
      'Your phone can''t get live-call alerts, so new leads are booked on your calendar. Open the Ohvara app and run the push test to turn live calls back on.',
      '/settings?tab=contact', true, 'unreach:' || a.agent_id || ':' || current_date);
    for adm in select id from profiles where role = 'admin' and coalesce(is_active, true) loop
      perform public.notify(adm, 'live_calls_unreachable', coalesce(a.first_name, 'An agent') || ' is booking only',
        'Their phone can''t get live-call alerts. Live calls are off for them until they pass the push test.',
        '/admin', false, 'unreach:' || a.agent_id || ':' || current_date || ':' || adm);
    end loop;
    n := n + 1;
  end loop;
  update transfer_readiness set checked_at = now() where checked_at is null or checked_at < now() - interval '20 hours';
  return n;
end; $$;
revoke execute on function public.transfer_health_daily() from public, anon, authenticated;

-- Cron: the sweep every minute, the health check at 7 AM Central (13:00 UTC; 12:00 in summer is fine).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('transfer-checks-sweep', 'transfer-health-daily');
    perform cron.schedule('transfer-checks-sweep', '* * * * *', 'select public.transfer_checks_sweep()');
    perform cron.schedule('transfer-health-daily', '0 13 * * *', 'select public.transfer_health_daily()');
  end if;
end $$;
