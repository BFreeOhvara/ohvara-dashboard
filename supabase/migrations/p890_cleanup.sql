-- P890 — Cleanup from the code map (Map vs Blueprint) + Pause lead spend.
-- UNNUMBERED, NOT APPLIED. Apply after p884_billing_engine.sql and p889_one_lead_product.sql.
-- Switches things off; drops no table and deletes no row.
--
--   1. VA pay is hourly ($8/hr, from timesheets), not per cancel: the Monday pay-per-cancel run and the AI cancel
--      check stop (cron unscheduled), no new cancel rows are made, and the per-cancel RPCs can't be called. The
--      fulfillment_cancels / payouts / recordings tables and their data stay.
--   2. One way to prepay (P884's weekly lead spend): the old balance top-up can't credit anything any more.
--   3. No VA reply inbox: no VA screen uses it. Replies are still saved (lead_sms_replies) and a reply the system
--      can't read becomes a VA callback (twilio-sms-webhook).
--   4. Agent caller ID is gone (agents call from their own phone): agents can't switch it on.
--   5. Duty switch → live-call hours: routing and the incoming-transfer check read P889's How you take leads
--      (agent_lead_product: mode + live_hours + tz). agent_duty stays, read by nothing, written by nobody.
--   7. Pause leads: an agent pauses lead spend with an optional resume date.

do $$ begin
  if to_regclass('public.agent_lead_product') is null or to_regclass('public.agent_campaign_control') is null then
    raise exception 'p890 needs p884_billing_engine.sql and p889_one_lead_product.sql applied first';
  end if;
end $$;

-- ── 7a. pause tables first (agent_live_now in 5 reads agent_lead_pause) ──────────────────────────────────────────────
create table if not exists public.agent_lead_pause (
  agent_id     uuid primary key references public.profiles(id) on delete cascade,
  active       boolean not null default true,
  paused_at    timestamptz not null default now(),
  resume_on    date,                       -- null = until the agent resumes; else spend restarts that day
  was_active   boolean not null default true,  -- agent_lead_settings.active before the pause, put back on resume
  updated_at   timestamptz not null default now()
);
alter table public.agent_lead_pause enable row level security;
revoke all on public.agent_lead_pause from public, anon, authenticated;
grant select on public.agent_lead_pause to authenticated;
drop policy if exists alpause_read on public.agent_lead_pause;
create policy alpause_read on public.agent_lead_pause for select to authenticated using (agent_id = auth.uid() or is_admin());

-- Append-only history (admin reads it in the agent drawer).
create table if not exists public.agent_lead_pause_log (
  id         bigint generated always as identity primary key,
  agent_id   uuid not null references public.profiles(id) on delete cascade,
  what       text not null check (what in ('paused', 'resume_set', 'resumed')),
  resume_on  date,
  at         timestamptz not null default now()
);
alter table public.agent_lead_pause_log enable row level security;
revoke all on public.agent_lead_pause_log from public, anon, authenticated;
grant select on public.agent_lead_pause_log to authenticated;
drop policy if exists alpause_log_read on public.agent_lead_pause_log;
create policy alpause_log_read on public.agent_lead_pause_log for select to authenticated using (agent_id = auth.uid() or is_admin());

-- ── 1. pay per cancel off ───────────────────────────────────────────────────────────────────────────────────────────
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('fulfillment-pay-run', 'fulfillment-cancel-check');
end $$;
-- Logging a cancel (fulfillment_stage → Complete) no longer makes a pay row.
drop trigger if exists policies_fulfillment_cancel on public.policies;
revoke execute on function public.fulfillment_decide_cancel(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.agent_flag_cancel(uuid, text) from public, anon, authenticated;
revoke execute on function public.fulfillment_claim_payout(uuid, date, uuid, boolean, text) from public, anon, authenticated, service_role;
comment on table public.fulfillment_cancels is
  'P890: history only. VA pay is hourly from timesheets; nothing writes here and nothing is paid from it.';

-- ── 2. old prepaid balance top-up off ───────────────────────────────────────────────────────────────────────────────
revoke execute on function public.credit_topup(uuid, integer, text, text, text) from public, anon, authenticated, service_role;
comment on view public.agent_lead_balance is
  'P890: the old top-up is off. Before applying, check no agent has balance_cents > 0 (refund or move it to lead spend).';

-- ── 3. no VA reply inbox ────────────────────────────────────────────────────────────────────────────────────────────
-- No VA screen calls va_lead_replies / va_mark_reply_handled any more (left callable: nothing to switch off, and
-- p_va_desk.sql still pins them). Replies stay saved; one the system can't read becomes a VA callback (twilio-sms-webhook).

-- ── 4. agent caller ID off ──────────────────────────────────────────────────────────────────────────────────────────
update public.profiles set caller_id_enabled = false where caller_id_enabled;

-- ── 5. live-call hours replace the duty switch ──────────────────────────────────────────────────────────────────────
-- True when the agent takes live transfers (mode 'both') and p_at is inside today's live-call hours on their clock.
-- Same rule as src/lib/leadSplit.js inLiveHours. Hours look like { "Mon": { "on": true, "start": "9:00 AM", "end": "5:00 PM" } }.
create or replace function public.clock_minutes(p text) returns int language sql immutable as $$
  select case when m is null then null
              else ((m[1]::int % 12) + case when upper(m[3]) = 'PM' then 12 else 0 end) * 60 + m[2]::int end
    from (select regexp_match(btrim(coalesce(p, '')), '^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$') m) x
$$;

create or replace function public.agent_live_now(p_agent uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.mode = 'both'
       and coalesce((h ->> 'on')::boolean, false)
       and clock_minutes(h ->> 'start') is not null and clock_minutes(h ->> 'end') is not null
       and extract(hour from loc) * 60 + extract(minute from loc) >= clock_minutes(h ->> 'start')
       and extract(hour from loc) * 60 + extract(minute from loc) <  clock_minutes(h ->> 'end')
      from agent_lead_product p
      cross join lateral (select p_at at time zone coalesce(nullif(p.tz, ''), 'America/Chicago') as loc) t
      cross join lateral (select p.live_hours -> to_char(t.loc, 'Dy') as h) d
     where p.agent_id = p_agent
       and not exists (select 1 from agent_lead_pause z where z.agent_id = p_agent and z.active)
  ), false)
$$;

-- Admin "Taking live transfers now" (OnDutyNow): agents inside their live-call hours. since = when the hours last changed.
create or replace function public.on_duty_agents()
 returns table (agent_id uuid, full_name text, since timestamptz)
 language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, lp.updated_at
    from public.agent_lead_product lp
    join public.profiles p on p.id = lp.agent_id
   where public.is_admin() and p.is_active and p.role = 'agent' and public.agent_live_now(p.id)
   order by p.full_name;
$$;

-- The agent's phone checks for a live transfer: now gated on live-call hours, not agent_duty.
create or replace function public.my_incoming_transfer()
 returns table (help_call_id uuid, transfer_started_at timestamptz, lead_id uuid, caller_label text)
 language sql stable security definer set search_path = public as $$
  select h.id,
         h.transfer_started_at,
         h.lead_id,
         case
           when nullif(split_part(btrim(l.contact_name), ' ', 1), '') is null then 'New caller'
           when split_part(btrim(l.contact_name), ' ', 1) ~ '[0-9]' then 'New caller'
           else split_part(btrim(l.contact_name), ' ', 1)
         end
    from public.help_calls h
    join public.profiles p on p.id = h.transfer_agent_id
    left join public.leads l on l.id = h.lead_id
   where auth.uid() is not null
     and h.transfer_agent_id = auth.uid()
     and h.status = 'transferring'
     and h.transfer_started_at > now() - interval '2 minutes'
     and public.agent_live_now(h.transfer_agent_id, h.transfer_started_at)
     and p.role = 'agent'
     and p.is_active
   order by h.transfer_started_at desc
   limit 1;
$$;
revoke execute on function public.my_incoming_transfer() from public, anon;
grant execute on function public.my_incoming_transfer() to authenticated;

-- Nobody flips the old switch any more.
revoke insert, update on public.agent_duty from authenticated;

-- ── 7. Pause leads ──────────────────────────────────────────────────────────────────────────────────────────────────
-- While paused: lead spend stops (agent_campaign_control run off, reason 'paused by agent'), no new leads
-- (agent_lead_settings.active off, the gate assign_lead already reads), no new weekly lead-spend charge.
-- Membership keeps charging, servicing keeps running, booked appointments stay. Any balance stays and rolls over.
-- Resume restarts spend from the next day (the daily job at 12:05 AM Central).
-- Every engine instruction for a paused agent says stop, whoever writes it (lead_spend_refresh_control included).
create or replace function public.campaign_control_pause_guard() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if exists (select 1 from agent_lead_pause z where z.agent_id = new.agent_id and z.active) then
    new.run := false; new.daily_budget_cents := 0; new.cap_cents := 0; new.reason := 'paused by agent';
  end if;
  return new;
end; $$;
drop trigger if exists campaign_control_pause_guard on public.agent_campaign_control;
create trigger campaign_control_pause_guard before insert or update on public.agent_campaign_control
  for each row execute function public.campaign_control_pause_guard();

-- No weekly lead-spend charge for a week the agent is paused at the start of.
create or replace function public.lead_spend_charge_pause_guard() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.kind = 'weekly' and exists (
       select 1 from agent_lead_pause z where z.agent_id = new.agent_id and z.active
          and (z.resume_on is null or z.resume_on > new.week_start)) then
    return null;
  end if;
  return new;
end; $$;
drop trigger if exists lead_spend_charge_pause_guard on public.lead_spend_charges;
create trigger lead_spend_charge_pause_guard before insert on public.lead_spend_charges
  for each row execute function public.lead_spend_charge_pause_guard();

-- The agent's own: pause now (optionally with a resume date), or change the resume date while paused.
create or replace function public.lead_pause_set(p_resume_on date default null) returns jsonb language plpgsql
security definer set search_path = public as $$
declare me uuid := auth.uid(); was boolean; already boolean;
begin
  if me is null or not exists (select 1 from profiles where id = me and role = 'agent') then
    raise exception 'Only an agent can pause their leads' using errcode = '42501';
  end if;
  if p_resume_on is not null and p_resume_on <= billing_today() then
    raise exception 'Pick a resume date after today' using errcode = '22023';
  end if;
  select z.active into already from agent_lead_pause z where z.agent_id = me;
  if coalesce(already, false) then
    update agent_lead_pause set resume_on = p_resume_on, updated_at = now() where agent_id = me;
    insert into agent_lead_pause_log (agent_id, what, resume_on) values (me, 'resume_set', p_resume_on);
  else
    select coalesce(s.active, true) into was from agent_lead_settings s where s.agent_id = me;
    insert into agent_lead_pause as z (agent_id, active, paused_at, resume_on, was_active)
    values (me, true, now(), p_resume_on, coalesce(was, true))
    on conflict (agent_id) do update set active = true, paused_at = now(), resume_on = excluded.resume_on,
                                         was_active = excluded.was_active, updated_at = now();
    update agent_lead_settings set active = false where agent_id = me;
    insert into agent_lead_pause_log (agent_id, what, resume_on) values (me, 'paused', p_resume_on);
    perform lead_spend_refresh_control(me);
  end if;
  return jsonb_build_object('paused', true, 'resume_on', p_resume_on);
end; $$;

-- Resume: spend restarts tomorrow (the daily job ends the pause at 12:05 AM Central).
create or replace function public.lead_pause_resume() returns jsonb language plpgsql
security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := billing_today() + 1;
begin
  if me is null or not exists (select 1 from agent_lead_pause where agent_id = me and active) then
    raise exception 'Your leads aren''t paused' using errcode = '22023';
  end if;
  update agent_lead_pause set resume_on = d, updated_at = now() where agent_id = me;
  insert into agent_lead_pause_log (agent_id, what, resume_on) values (me, 'resume_set', d);
  return jsonb_build_object('paused', true, 'resume_on', d);
end; $$;

-- Daily: end the pauses due today. Leads back on, engine refreshed, and the rest of this week's spend charged
-- (the week's charge was skipped while paused; any balance counts first).
create or replace function public.lead_pause_daily() returns int language plpgsql
security definer set search_path = public as $$
declare z record; today date := billing_today(); wk date := billing_week_of(billing_today()); left_days int; need int; n int := 0;
begin
  for z in select * from agent_lead_pause where active and resume_on is not null and resume_on <= today for update loop
    update agent_lead_pause set active = false, updated_at = now() where agent_id = z.agent_id;
    update agent_lead_settings set active = z.was_active where agent_id = z.agent_id;
    insert into agent_lead_pause_log (agent_id, what, resume_on) values (z.agent_id, 'resumed', today);
    left_days := (wk + 7) - today;
    need := lead_spend_daily_total(z.agent_id, today) * left_days - lead_spend_balance(z.agent_id);
    if need > 0 and billing_status_of(z.agent_id) in ('pilot', 'active', 'waiting_acceptance', 'past_due')
       and not exists (select 1 from lead_spend_charges c where c.agent_id = z.agent_id and c.week_start = wk and c.kind = 'weekly') then
      insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note)
      values (z.agent_id, wk, 'change', need, 'resume:' || z.agent_id || ':' || today,
              'Rest of the week after your pause (' || left_days || ' days)')
      on conflict (key) do nothing;
    end if;
    perform lead_spend_refresh_control(z.agent_id);
    n := n + 1;
  end loop;
  return n;
end; $$;

-- Admin: who is paused, since when, until when.
create or replace function public.admin_lead_pauses()
 returns table (agent_id uuid, full_name text, paused_at timestamptz, resume_on date)
 language sql stable security definer set search_path = public as $$
  select z.agent_id, p.full_name, z.paused_at, z.resume_on
    from agent_lead_pause z join profiles p on p.id = z.agent_id
   where is_admin() and z.active
   order by z.paused_at;
$$;

revoke execute on function public.lead_pause_set(date), public.lead_pause_resume(), public.admin_lead_pauses(),
  public.lead_pause_daily(), public.agent_live_now(uuid, timestamptz) from public, anon;
grant execute on function public.lead_pause_set(date), public.lead_pause_resume(), public.admin_lead_pauses() to authenticated;
grant execute on function public.lead_pause_daily(), public.agent_live_now(uuid, timestamptz) to service_role;

-- 12:05 AM Central in summer and winter (05:05 / 06:05 UTC); the function is idempotent.
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lead-pause-daily';
end $$;
select cron.schedule('lead-pause-daily', '5 5,6 * * *', $$select public.lead_pause_daily()$$);

-- Check after applying:
--   select jobname from cron.job where jobname in ('fulfillment-pay-run', 'fulfillment-cancel-check');  -- none
--   select count(*) from agent_lead_balance where balance_cents > 0;                                     -- 0 (see 2.)
--   select public.agent_live_now('<agent id>');                                                         -- matches Settings › Hours and calls
