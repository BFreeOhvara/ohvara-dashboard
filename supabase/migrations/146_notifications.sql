-- Prompt 767 — Notifications for every role (bell + email).
--
-- The approved list is brain/Ohvara Notifications Plan.md in the vault.
--
--   notifications          one row per notification. New columns: title,
--                          detail, link, read_at, needs_action, dedupe_key,
--                          in_bell (false = email/push only), push (mobile
--                          delivers these later). Recipients read their own
--                          and mark them read through notifications_mark_read;
--                          nobody inserts, updates or deletes from the client.
--   notification_types     the registry: who gets each type, its channels,
--                          whether it fires yet, and whether it's a money one.
--   notification_emails    the outgoing email queue. Sent by the notify-email
--                          edge function (Resend), called by pg_cron.
--   notify(...)            the one writer. Triggers and scheduled functions
--                          call it; it dedupes, queues the email when the
--                          person has it on, and holds non-urgent email in
--                          quiet hours (9 PM–8 AM their time).
--
-- Older writers that still insert the old shape (title null) are dropped by a
-- gate trigger, so the old items ("X just joined the team", lapse check-ins,
-- team chat fan-out…) stop. Old rows stay in the table, unshown.
--
-- Also fixes the four crons that failed every run because app.supabase_url
-- isn't set (recovery-sms, redistribute-no-answers, process-reminders,
-- trigger-re-engagement): they now post through fulfillment_cron_post with the
-- Vault secret, like P764's. What the jobs do is unchanged.

-- ── notifications ───────────────────────────────────────────────────────────
alter table public.notifications
  add column if not exists title        text,
  add column if not exists detail       text,
  add column if not exists link         text,
  add column if not exists read_at      timestamptz,
  add column if not exists needs_action boolean not null default false,
  add column if not exists dedupe_key   text,
  add column if not exists in_bell      boolean not null default true,
  add column if not exists push         boolean not null default false;

create unique index if not exists notifications_dedupe on public.notifications (profile_id, dedupe_key)
  where dedupe_key is not null;
create index if not exists notifications_feed on public.notifications (profile_id, created_at desc)
  where title is not null;

-- Old-shape inserts (no title) are dropped: every live notification comes
-- through notify().
create or replace function public.notifications_gate()
returns trigger language plpgsql as $$
begin
  if new.title is null then return null; end if;
  return new;
end;
$$;
drop trigger if exists notifications_gate on public.notifications;
create trigger notifications_gate before insert on public.notifications
  for each row execute function public.notifications_gate();

-- Recipients read their own; no client writes at all.
drop policy if exists "Admins delete notifications" on public.notifications;
drop policy if exists "Admins insert notifications" on public.notifications;
drop policy if exists "Admins update notifications" on public.notifications;
drop policy if exists "Reps insert own notifications" on public.notifications;
drop policy if exists "Reps update own notifications" on public.notifications;
drop policy if exists "Admins manage notifications" on public.notifications;
alter table public.notifications enable row level security;
revoke insert, update, delete on public.notifications from anon, authenticated;

-- ── registry ────────────────────────────────────────────────────────────────
create table if not exists public.notification_types (
  type          text primary key,
  roles         text[] not null,
  label         text not null,
  email_default boolean not null default false,  -- email on unless the person turns it off
  email_via     text check (email_via in ('notify', 'pay-week')), -- null = no email
  in_bell       boolean not null default true,
  push          boolean not null default false,  -- delivered by the mobile app later
  money         boolean not null default false,  -- ignores quiet hours
  fires         boolean not null default true,   -- false = feature not built yet
  sort          integer not null default 0
);
alter table public.notification_types enable row level security;
drop policy if exists "Signed-in read notification types" on public.notification_types;
create policy "Signed-in read notification types" on public.notification_types
  for select to authenticated using (true);
revoke insert, update, delete on public.notification_types from anon, authenticated;

insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort) values
  -- Agent
  ('policy_cancelled',      '{agent}',       'Policy cancelled for your client',              false, 'notify',   true,  true,  false, true,  10),
  ('client_no_answer',      '{agent}',       'Client didn''t answer',                         false, 'notify',   true,  true,  false, true,  11),
  ('call_missed_rebooking', '{agent}',       'We missed the call, rebooking underway',        false, 'notify',   true,  false, false, false, 12),
  ('client_unreachable',    '{agent}',       'Couldn''t reach a client after retries',        false, 'notify',   true,  true,  false, true,  13),
  ('needs_attention',       '{agent}',       'Clients that need attention (daily)',           false, 'notify',   true,  false, false, true,  14),
  ('weekly_limit',          '{agent}',       'Weekly booking limit reached',                  false, 'notify',   true,  false, false, true,  15),
  ('payment_failed',        '{agent}',       'Weekly payment failed',                         true,  'notify',   true,  true,  true,  true,  16),
  -- Fulfillment
  ('call_booked',           '{fulfillment}', 'New call booked for you',                       false, 'notify',   true,  true,  false, true,  20),
  ('call_soon',             '{fulfillment}', '5 minutes before a call',                       false, null,       true,  true,  false, true,  21),
  ('call_not_started',      '{fulfillment}', 'Call time is now and not started',              false, null,       true,  true,  false, true,  22),
  ('paid',                  '{fulfillment}', 'You were paid',                                 true,  'pay-week', true,  true,  false, true,  23),
  ('pay_problem',           '{fulfillment}', 'Payout problem (no bank or transfer failed)',   true,  'pay-week', true,  true,  true,  true,  24),
  ('missed_strike',         '{fulfillment}', 'Missed call strike',                            false, 'notify',   true,  true,  false, false, 25),
  -- Admin
  ('needs_listen',          '{admin}',       'A cancel needs a listen',                       false, 'notify',   true,  true,  false, true,  30),
  ('rep_missed_call',       '{admin}',       'A rep missed a call',                           false, 'notify',   true,  true,  false, false, 31),
  ('rep_strikes',           '{admin}',       'A rep hit 3 strikes in 30 days',                false, 'notify',   true,  true,  false, false, 32),
  ('payout_problem',        '{admin}',       'Payout problem',                                true,  'notify',   true,  true,  true,  true,  33),
  ('agent_payment_failed',  '{admin}',       'An agent''s weekly payment failed',             true,  'notify',   true,  true,  true,  true,  34),
  ('capacity_low',          '{admin}',       'Not enough reps for bookings',                  false, 'notify',   true,  true,  false, false, 35),
  ('job_failed',            '{admin}',       'A background job failed',                       false, 'notify',   true,  true,  false, true,  36),
  ('invite_accepted',       '{admin}',       'Someone accepted an invite',                    false, 'notify',   true,  false, false, true,  37),
  ('daily_digest',          '{admin}',       '8 AM email: anything that went wrong',          true,  'notify',   false, false, false, true,  38),
  -- Shared
  ('message',               '{agent,fulfillment,admin}', 'New message',                       false, 'notify',   true,  true,  false, true,  50),
  ('monday_summary',        '{agent,admin}', 'Monday summary',                                true,  'notify',   false, false, false, true,  51),
  ('live_room',             '{agent,admin}', 'Live Room is open',                             false, null,       true,  false, false, true,  52)
on conflict (type) do update set
  roles = excluded.roles, label = excluded.label, email_default = excluded.email_default,
  email_via = excluded.email_via, in_bell = excluded.in_bell, push = excluded.push,
  money = excluded.money, fires = excluded.fires, sort = excluded.sort;

-- ── email queue ─────────────────────────────────────────────────────────────
create table if not exists public.notification_emails (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  type            text not null references public.notification_types(type),
  notification_id uuid references public.notifications(id) on delete set null,
  dedupe_key      text not null unique,
  subject         text not null,
  body            text not null,          -- plain text; the sender wraps it
  link            text,                   -- relative app path for the button
  send_after      timestamptz not null default now(),
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts        integer not null default 0,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists notification_emails_due on public.notification_emails (send_after) where status = 'queued';
alter table public.notification_emails enable row level security;
revoke all on public.notification_emails from anon, authenticated;

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.notify_tz(p_profile uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select timezone from profiles where id = p_profile), ''), 'America/Chicago')
$$;

-- When a non-urgent email may go: now, or 8 AM the person's time if it's
-- between 9 PM and 8 AM there.
create or replace function public.notify_send_after(p_profile uuid, p_money boolean, p_now timestamptz default now())
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  tz    text := public.notify_tz(p_profile);
  local timestamp := p_now at time zone tz;
begin
  if p_money then return p_now; end if;
  if local::time >= time '21:00' then
    return (local::date + 1 + time '08:00') at time zone tz;
  elsif local::time < time '08:00' then
    return (local::date + time '08:00') at time zone tz;
  end if;
  return p_now;
end;
$$;

create or replace function public.notify_email_on(p_profile uuid, p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select case t.email_via
           when 'notify' then coalesce((p.notification_prefs -> 'email' ->> p_type)::boolean, t.email_default)
           when 'pay-week' then case p_type when 'paid' then p.payout_email_sent else p.payout_email_problem end
           else false end
  from notification_types t, profiles p
  where t.type = p_type and p.id = p_profile
$$;

create or replace function public.notify_money(p_cents bigint)
returns text language sql immutable as $$
  select case when p_cents % 100 = 0 then '$' || to_char(p_cents / 100, 'FM999,999,990')
              else '$' || to_char(p_cents / 100.0, 'FM999,999,990.00') end
$$;

create or replace function public.notify_client(p policies)
returns text language sql immutable as $$
  select coalesce(nullif(btrim(coalesce(p.client_first_name, '') || ' ' || coalesce(p.client_last_name, '')), ''), 'A client')
$$;

-- "2:00 PM" / "Thu 2:00 PM" on the person's clock.
create or replace function public.notify_when(p_at timestamptz, p_profile uuid, p_day boolean default false)
returns text language sql stable security definer set search_path = public as $$
  select to_char(p_at at time zone public.notify_tz(p_profile), case when p_day then 'Dy FMHH12:MI AM' else 'FMHH12:MI AM' end)
$$;

-- Queue one email. Respects the person's toggle and quiet hours.
create or replace function public.notify_queue_email(
  p_to uuid, p_type text, p_subject text, p_body text, p_link text, p_dedupe text, p_notification uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t notification_types;
begin
  select * into t from notification_types where type = p_type;
  if t.type is null or t.email_via is distinct from 'notify' then return; end if;
  if not coalesce(public.notify_email_on(p_to, p_type), false) then return; end if;
  if nullif(btrim(coalesce((select email from profiles where id = p_to), '')), '') is null then return; end if;
  insert into notification_emails (profile_id, type, notification_id, dedupe_key, subject, body, link, send_after)
  values (p_to, p_type, p_notification, p_dedupe, p_subject, p_body, p_link, public.notify_send_after(p_to, t.money))
  on conflict (dedupe_key) do nothing;
end;
$$;

-- The one writer. Returns the new id, or null when it was a duplicate or the
-- type doesn't fire yet.
create or replace function public.notify(
  p_to uuid, p_type text, p_title text, p_detail text, p_link text,
  p_needs_action boolean default false, p_dedupe text default null, p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t   notification_types;
  nid uuid;
begin
  if p_to is null then return null; end if;
  select * into t from notification_types where type = p_type;
  if t.type is null then raise exception 'Unknown notification type %', p_type; end if;
  if not t.fires then return null; end if;
  if not exists (select 1 from profiles where id = p_to and coalesce(is_active, true)) then return null; end if;

  insert into notifications (profile_id, type, message, title, detail, link, data, needs_action, dedupe_key, in_bell, push)
  values (p_to, p_type, p_title, p_title, p_detail, p_link, coalesce(p_data, '{}'::jsonb), p_needs_action,
          p_dedupe, t.in_bell, t.push)
  on conflict (profile_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into nid;

  if nid is not null then
    perform public.notify_queue_email(p_to, p_type, p_title, coalesce(p_detail, ''), p_link,
                                      'n:' || nid::text, nid);
  end if;
  return nid;
end;
$$;

-- Everyone active with a role.
create or replace function public.notify_admins()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from profiles where role::text = 'admin' and coalesce(is_active, true)
$$;

-- ── agent + fulfillment: policies ───────────────────────────────────────────
create or replace function public.policies_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who      text := public.notify_client(new);
  cfg      recovery_config;
  opted    boolean;
  agent_nm text;
  cap      integer;
  tz       text;
  wk_start timestamptz;
  used     integer;
begin
  -- Fulfillment: a call is booked for them (new, given to them, or moved).
  if coalesce(current_setting('ohvara.skip_assign_notify', true), '') <> 'on'
     and new.fulfillment_assigned and new.assigned_fulfillment_id is not null
     and new.fulfillment_stage is distinct from 'Complete'
     and new.scheduled_call_at is not null and new.scheduled_call_at > now()
     and (tg_op = 'INSERT'
          or new.assigned_fulfillment_id is distinct from old.assigned_fulfillment_id
          or new.scheduled_call_at is distinct from old.scheduled_call_at
          or (new.fulfillment_assigned and not coalesce(old.fulfillment_assigned, false))) then
    select full_name into agent_nm from profiles where id = new.agent_id;
    perform public.notify(new.assigned_fulfillment_id, 'call_booked', 'New call booked',
      public.notify_when(new.scheduled_call_at, new.assigned_fulfillment_id, true) || ' · ' || who
        || coalesce(' · for ' || nullif(btrim(agent_nm), ''), ''),
      '/fulfillment/desk?open=' || new.id, false,
      'booked:' || new.id || ':' || extract(epoch from new.scheduled_call_at)::bigint,
      jsonb_build_object('policy_id', new.id));
  end if;

  -- Agent: weekly booking limit reached.
  if new.fulfillment_assigned and (tg_op = 'INSERT' or not coalesce(old.fulfillment_assigned, false)) then
    select t.weekly_cap, coalesce(nullif(p.timezone, ''), 'America/Chicago') into cap, tz
      from profiles p join agent_billing_tiers t on t.key = p.billing_tier
     where p.id = new.agent_id and p.role::text = 'agent';
    if cap is not null then
      wk_start := date_trunc('week', now() at time zone tz) at time zone tz;
      select count(*) into used from policies
       where agent_id = new.agent_id and fulfillment_assigned
         and created_at >= wk_start and created_at < wk_start + interval '7 days';
      if used >= cap then
        perform public.notify(new.agent_id, 'weekly_limit', used || ' of ' || cap || ' bookings used',
          'Your limit resets Monday', '/agent/billing', false,
          'limit:' || to_char(wk_start at time zone tz, 'YYYY-MM-DD'));
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then return new; end if;

  -- Agent: the policy is cancelled.
  if new.fulfillment_stage = 'Complete' and old.fulfillment_stage is distinct from 'Complete' then
    perform public.notify(new.agent_id, 'policy_cancelled', 'Policy cancelled for ' || who,
      coalesce(nullif(btrim(new.carrier_name), '') || ' · ', '') || 'confirmed on the call',
      '/agent/clients?open=' || new.id, false, 'cancelled:' || new.id,
      jsonb_build_object('policy_id', new.id));
  end if;

  -- Agent: the client didn't answer and no text flow is taking it (texting
  -- off, agent not opted in, no phone). Inside the flow the steps below
  -- notify instead.
  if new.last_call_outcome = 'no_answer'
     and (old.last_call_outcome is distinct from 'no_answer' or new.last_call_at is distinct from old.last_call_at)
     and new.recovery_phase is null then
    select * into cfg from recovery_config limit 1;
    select coalesce(no_answer_sms_opt_in, false) into opted from profiles where id = new.agent_id;
    if not (coalesce(cfg.sms_live, false) and opted and nullif(btrim(coalesce(new.client_phone, '')), '') is not null) then
      perform public.notify(new.agent_id, 'client_no_answer', who || ' didn''t answer',
        'Call them or rebook from your pipeline', '/agent/clients?open=' || new.id, true,
        'noans:' || new.id || ':' || coalesce(extract(epoch from new.last_call_at)::bigint::text, 'x'),
        jsonb_build_object('policy_id', new.id));
    end if;
  end if;

  -- Agent: after the retry also went unanswered, confirm the number.
  if new.recovery_step = 'number_check' and old.recovery_step is distinct from 'number_check' then
    perform public.notify(new.agent_id, 'client_no_answer', who || ' didn''t answer',
      'Confirm the number so we can try again', '/agent/clients?open=' || new.id, true,
      'numcheck:' || new.id || ':' || coalesce(extract(epoch from new.recovery_retry_at)::bigint::text, 'x'),
      jsonb_build_object('policy_id', new.id));
  end if;

  -- Agent: the text flow ran out; it's theirs to call.
  if new.recovery_step = 'call_directly' and old.recovery_step is distinct from 'call_directly' then
    perform public.notify(new.agent_id, 'client_unreachable', 'Couldn''t reach ' || who,
      'We tried twice. They''re yours to call and rebook.', '/agent/clients?open=' || new.id, true,
      'unreach:' || new.id || ':' || coalesce(extract(epoch from new.recovery_handoff_at)::bigint::text, 'x'),
      jsonb_build_object('policy_id', new.id));
  end if;

  return new;
end;
$$;
drop trigger if exists policies_notify on public.policies;
create trigger policies_notify after insert or update on public.policies
  for each row execute function public.policies_notify();
-- Replaced by policies_notify.
drop trigger if exists policies_fulfillment_assigned_notify on public.policies;
drop trigger if exists policies_fulfillment_complete_notify on public.policies;
drop trigger if exists profiles_notify_new_member_trigger on public.profiles;

-- ── messages ────────────────────────────────────────────────────────────────
create or replace function public.direct_messages_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recipient uuid;
  link      text := '/messages?dm=' || new.agent_id || '.' || new.peer_key;
  quote     text := '“' || left(btrim(new.body), 140) || '”';
begin
  if new.sender_id = new.agent_id then
    if new.peer_id is not null then
      perform public.notify(new.peer_id, 'message', new.sender_name, quote, link, false, 'dm:' || new.id);
    else
      for recipient in select * from public.notify_admins() loop
        perform public.notify(recipient, 'message', new.sender_name, quote, link, false, 'dm:' || new.id);
      end loop;
    end if;
  else
    perform public.notify(new.agent_id, 'message', new.sender_name, quote, link, false, 'dm:' || new.id);
  end if;
  return new;
end;
$$;

create or replace function public.policy_messages_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pol       policies;
  recipient uuid;
  link      text := '/messages?thread=' || new.policy_id;
  quote     text;
begin
  select * into pol from policies where id = new.policy_id;
  quote := 'On ' || public.notify_client(pol) || ': “' || left(btrim(new.body), 120) || '”';
  if new.sender_id = pol.agent_id then
    if pol.assigned_fulfillment_id is not null then
      perform public.notify(pol.assigned_fulfillment_id, 'message', new.sender_name, quote, link, false, 'pm:' || new.id);
    else
      for recipient in select id from profiles where role::text = 'fulfillment' and is_active loop
        perform public.notify(recipient, 'message', new.sender_name, quote, link, false, 'pm:' || new.id);
      end loop;
    end if;
  else
    perform public.notify(pol.agent_id, 'message', new.sender_name, quote, link, false, 'pm:' || new.id);
  end if;
  return new;
end;
$$;

-- ── admin: a cancel needs a listen ──────────────────────────────────────────
create or replace function public.fulfillment_cancels_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a   uuid;
  rep text;
begin
  if new.status = 'needs_listen' and (tg_op = 'INSERT' or old.status is distinct from 'needs_listen') then
    select full_name into rep from profiles where id = new.rep_id;
    for a in select * from public.notify_admins() loop
      perform public.notify(a, 'needs_listen', coalesce(nullif(btrim(new.client_name), ''), 'A cancel') || ' needs a listen',
        concat_ws(' · ', nullif(btrim(new.carrier_name), ''), nullif(btrim(rep), ''),
                  case new.reason
                    when 'no_recording' then 'No recording of the call'
                    when 'unclear'      then 'AI couldn’t hear the carrier confirm'
                    when 'stt_error'    then 'The transcript failed'
                    when 'ai_error'     then 'The AI check failed'
                    when 'refused'      then 'The carrier didn’t confirm'
                    when 'agent_flag'   then 'The agent flagged it'
                    when 'over_cap'     then 'Over the weekly cap'
                    else 'The AI couldn’t verify it' end),
        '/admin/payouts', true, 'listen:' || new.id || ':' || extract(epoch from new.updated_at)::bigint,
        jsonb_build_object('cancel_id', new.id));
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists fulfillment_cancels_notify on public.fulfillment_cancels;
create trigger fulfillment_cancels_notify after insert or update of status on public.fulfillment_cancels
  for each row execute function public.fulfillment_cancels_notify();

-- ── payouts ─────────────────────────────────────────────────────────────────
create or replace function public.fulfillment_pay_runs_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a     uuid;
  title text;
  sub   text;
begin
  if new.status not in ('short_balance', 'error') or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;
  if new.status = 'short_balance' then
    title := 'Monday’s payout is ' || public.notify_money(greatest(coalesce(new.needed_cents, 0) - coalesce(new.balance_cents, 0), 0)) || ' short';
    sub   := 'Stripe has ' || public.notify_money(coalesce(new.balance_cents, 0)) || ' and the run needs '
             || public.notify_money(coalesce(new.needed_cents, 0)) || '. Nobody is paid until it’s covered.';
  else
    title := 'Monday’s payout didn’t finish';
    sub   := coalesce(nullif(btrim(new.note), ''), 'The run stopped partway. It tries again tomorrow.');
  end if;
  for a in select * from public.notify_admins() loop
    perform public.notify(a, 'payout_problem', title, sub, '/admin/payouts', true,
      'run:' || new.id || ':' || new.status || ':' || coalesce(new.attempts, 0), jsonb_build_object('run_id', new.id));
  end loop;
  return new;
end;
$$;
drop trigger if exists fulfillment_pay_runs_notify on public.fulfillment_pay_runs;
create trigger fulfillment_pay_runs_notify after insert or update of status on public.fulfillment_pay_runs
  for each row execute function public.fulfillment_pay_runs_notify();

create or replace function public.fulfillment_payouts_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a   uuid;
  rep text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  if new.status = 'paid' then
    perform public.notify(new.rep_id, 'paid', 'Paid ' || public.notify_money(new.amount_cents),
      coalesce('To ' || nullif(btrim(new.paid_to), '') || ' · ', '') || 'lands in 1–2 days',
      '/fulfillment/pay', false, 'paid:' || new.id);
  elsif new.status = 'failed' then
    perform public.notify(new.rep_id, 'pay_problem', 'Your pay of ' || public.notify_money(new.amount_cents) || ' didn’t go out',
      coalesce(nullif(btrim(new.failure_reason), ''), 'It tries again next Monday.'),
      '/fulfillment/pay?settings=1', true, 'payfail:' || new.id || ':' || extract(epoch from new.updated_at)::bigint);
    select full_name into rep from profiles where id = new.rep_id;
    for a in select * from public.notify_admins() loop
      perform public.notify(a, 'payout_problem', 'Transfer to ' || coalesce(nullif(btrim(rep), ''), 'a rep') || ' failed',
        public.notify_money(new.amount_cents) || ' · ' || coalesce(nullif(btrim(new.failure_reason), ''), 'It retries next Monday.'),
        '/admin/payouts', true, 'payfail:' || new.id || ':' || extract(epoch from new.updated_at)::bigint);
    end loop;
  elsif new.status = 'held' then
    perform public.notify(new.rep_id, 'pay_problem', 'Connect your bank to get paid',
      public.notify_money(new.amount_cents) || ' is held until a bank is added.',
      '/fulfillment/pay?settings=1', true, 'held:' || new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists fulfillment_payouts_notify on public.fulfillment_payouts;
create trigger fulfillment_payouts_notify after insert or update of status on public.fulfillment_payouts
  for each row execute function public.fulfillment_payouts_notify();

-- ── agent billing ───────────────────────────────────────────────────────────
create or replace function public.profiles_billing_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a        uuid;
  enforced boolean := coalesce((select agent_billing_enforced from app_settings where id = 1), false);
  key      text;
begin
  if new.role::text <> 'agent' or coalesce(new.billing_exempt, false) then return new; end if;
  if new.billing_status not in ('past_due', 'lapsed') or old.billing_status in ('past_due', 'lapsed') then return new; end if;
  key := 'billfail:' || new.id || ':' || to_char(coalesce(new.billing_updated_at, now()), 'YYYY-MM-DD');
  perform public.notify(new.id, 'payment_failed', 'Your weekly payment didn’t go through',
    case when enforced then 'New bookings are paused until it’s fixed.' else 'Update your card to keep booking.' end,
    '/agent/billing', true, key);
  for a in select * from public.notify_admins() loop
    perform public.notify(a, 'agent_payment_failed', coalesce(nullif(btrim(new.full_name), ''), 'An agent') || '’s weekly payment failed',
      case when enforced then 'Their new bookings are paused until it’s fixed.' else 'Stripe couldn’t charge their card.' end,
      '/admin/users?user=' || new.id, false, key);
  end loop;
  return new;
end;
$$;
drop trigger if exists profiles_billing_notify on public.profiles;
create trigger profiles_billing_notify after update of billing_status on public.profiles
  for each row execute function public.profiles_billing_notify();

-- ── admin: an invite was accepted ───────────────────────────────────────────
create or replace function public.rep_invites_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a     uuid;
  who   text;
  role_ text;
begin
  if new.used_at is null or old.used_at is not null then return new; end if;
  select full_name, role::text into who, role_ from profiles where id = new.used_by;
  role_ := coalesce(role_, new.role::text);
  for a in select * from public.notify_admins() loop
    perform public.notify(a, 'invite_accepted',
      coalesce(nullif(btrim(who), ''), new.invited_email, 'Someone') || ' joined as '
        || case role_ when 'agent' then 'an Agent' when 'fulfillment' then 'Fulfillment' when 'admin' then 'an Admin' else initcap(role_) end,
      case when a = new.created_by then 'Accepted your invite' else 'Accepted an invite' end,
      case when new.used_by is not null then '/admin/users?user=' || new.used_by else '/admin/users' end,
      false, 'invite:' || new.id);
  end loop;
  return new;
end;
$$;
drop trigger if exists rep_invites_notify on public.rep_invites;
create trigger rep_invites_notify after update of used_at on public.rep_invites
  for each row execute function public.rep_invites_notify();

-- ── scheduled: call times (every minute) ────────────────────────────────────
create or replace function public.notify_call_times(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  p policies;
  n integer := 0;
  mins integer;
begin
  -- 5 minutes before: Call client unlocks.
  for p in
    select * from policies
     where fulfillment_assigned and assigned_fulfillment_id is not null
       and fulfillment_stage is distinct from 'Complete' and archived_at is null
       and scheduled_call_at > p_now + interval '3 minutes' and scheduled_call_at <= p_now + interval '6 minutes'
  loop
    if public.notify(p.assigned_fulfillment_id, 'call_soon', 'Call ' || public.notify_client(p) || ' in 5 minutes',
         public.notify_when(p.scheduled_call_at, p.assigned_fulfillment_id)
           || coalesce(' · ' || nullif(btrim(p.carrier_name), ''), '') || ' · Call client unlocks now',
         '/fulfillment/desk?open=' || p.id, true,
         'soon:' || p.id || ':' || extract(epoch from p.scheduled_call_at)::bigint) is not null then
      n := n + 1;
    end if;
  end loop;

  -- Call time came and the call hasn't started (2–30 minutes past).
  for p in
    select * from policies
     where fulfillment_assigned and assigned_fulfillment_id is not null
       and fulfillment_stage is distinct from 'Complete' and archived_at is null
       and scheduled_call_at <= p_now - interval '2 minutes' and scheduled_call_at > p_now - interval '30 minutes'
       and call_live_since is null
       and (last_call_at is null or last_call_at < scheduled_call_at - interval '15 minutes')
  loop
    mins := floor(extract(epoch from (p_now - p.scheduled_call_at)) / 60);
    if public.notify(p.assigned_fulfillment_id, 'call_not_started',
         'Your ' || public.notify_when(p.scheduled_call_at, p.assigned_fulfillment_id) || ' call hasn’t started',
         public.notify_client(p) || ' · ' || mins || ' minute' || case when mins = 1 then '' else 's' end || ' past',
         '/fulfillment/desk?open=' || p.id, true,
         'late:' || p.id || ':' || extract(epoch from p.scheduled_call_at)::bigint) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ── scheduled: background job failures (every 5 minutes) ────────────────────
create or replace function public.notify_job_failures(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, cron as $$
declare
  j  record;
  a  uuid;
  n  integer := 0;
begin
  for j in
    select jb.jobname, count(*) filter (where d.start_time > p_now - interval '10 minutes') recent,
           count(*) today
      from cron.job_run_details d join cron.job jb on jb.jobid = d.jobid
     where d.status = 'failed' and d.start_time > p_now - interval '24 hours'
     group by jb.jobname
    having count(*) filter (where d.start_time > p_now - interval '10 minutes') > 0
  loop
    for a in select * from public.notify_admins() loop
      if public.notify(a, 'job_failed', 'The ' || j.jobname || ' job failed',
           j.today || ' failed run' || case when j.today = 1 then '' else 's' end || ' today · details in the 8 AM email',
           '/admin', false, 'job:' || j.jobname || ':' || to_char(p_now at time zone public.notify_tz(a), 'YYYY-MM-DD')) is not null then
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;

-- ── scheduled: 8 AM digests and Monday summaries (hourly) ───────────────────
-- What went wrong in the last 24 hours, as lines. Empty = nothing.
create or replace function public.notify_trouble_lines(p_since timestamptz)
returns text[] language plpgsql stable security definer set search_path = public, cron, net as $$
declare
  out text[] := '{}';
  r   record;
  k   integer;
begin
  for r in
    select jb.jobname, count(*) c, max(left(d.return_message, 140)) msg
      from cron.job_run_details d join cron.job jb on jb.jobid = d.jobid
     where d.status = 'failed' and d.start_time > p_since
     group by jb.jobname order by 2 desc
  loop
    out := out || ('Job "' || r.jobname || '" failed ' || r.c || ' time' || case when r.c = 1 then '' else 's' end
                   || coalesce(': ' || btrim(r.msg), ''));
  end loop;
  begin
    select count(*) into k from net._http_response where created > p_since and (status_code >= 400 or error_msg is not null);
    if k > 0 then out := out || (k || ' scheduled call' || case when k = 1 then '' else 's' end || ' to an edge function returned an error'); end if;
  exception when others then null;
  end;
  for r in select pay_date, status, note from fulfillment_pay_runs
            where status in ('short_balance', 'error') and updated_at > p_since loop
    out := out || ('Pay run ' || r.pay_date || ': ' || replace(r.status, '_', ' ') || coalesce(' (' || r.note || ')', ''));
  end loop;
  select count(*) into k from fulfillment_payouts where status = 'failed' and updated_at > p_since;
  if k > 0 then out := out || (k || ' rep transfer' || case when k = 1 then '' else 's' end || ' failed'); end if;
  for r in select full_name from profiles
            where role::text = 'agent' and billing_status in ('past_due', 'lapsed') and billing_updated_at > p_since loop
    out := out || (coalesce(r.full_name, 'An agent') || '’s weekly payment failed');
  end loop;
  select count(*) into k from notification_emails where status = 'failed' and created_at > p_since;
  if k > 0 then out := out || (k || ' notification email' || case when k = 1 then '' else 's' end || ' couldn’t be sent'); end if;
  return out;
end;
$$;

create or replace function public.notify_hourly(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  p      record;
  local  timestamp;
  day    text;
  k      integer;
  c2     integer;
  lines  text[];
  wk     timestamptz;
  n      integer := 0;
  paid   bigint;
begin
  for p in select id, role::text role, coalesce(nullif(timezone, ''), 'America/Chicago') tz
             from profiles where role::text in ('agent', 'admin') and coalesce(is_active, true) loop
    local := p_now at time zone p.tz;
    if extract(hour from local) <> 8 then continue; end if;
    day := to_char(local, 'YYYY-MM-DD');
    wk  := (date_trunc('week', local) - interval '7 days') at time zone p.tz;  -- last Monday 00:00

    if p.role = 'agent' then
      -- Needs attention: one bell item a day when anything is waiting on them.
      select count(*) into k from policies
       where agent_id = p.id and fulfillment_stage is distinct from 'Complete' and archived_at is null
         and last_call_outcome = 'no_answer' and recovery_step in ('number_check', 'call_directly');
      if k > 0 and public.notify(p.id, 'needs_attention', k || ' client' || case when k = 1 then ' needs' else 's need' end || ' attention',
           'Confirm a number or call them yourself', '/agent/clients?stage=needs', true, 'needs:' || day) is not null then
        n := n + 1;
      end if;
      -- Monday summary: bookings and cancels last week.
      if extract(isodow from local) = 1 then
        select count(*) filter (where fulfillment_assigned and created_at >= wk and created_at < wk + interval '7 days'),
               count(*) filter (where fulfillment_completed_at >= wk and fulfillment_completed_at < wk + interval '7 days')
          into k, c2 from policies where agent_id = p.id;
        perform public.notify_queue_email(p.id, 'monday_summary',
          'Your week: ' || k || ' booking' || case when k = 1 then '' else 's' end || ', ' || c2 || ' cancel' || case when c2 = 1 then '' else 's' end,
          'Last week you booked ' || k || ' call' || case when k = 1 then '' else 's' end || ' with Fulfillment and '
            || c2 || ' polic' || case when c2 = 1 then 'y was' else 'ies were' end || ' cancelled.',
          '/agent/clients', 'monday:' || p.id || ':' || day);
      end if;
    else
      -- 8 AM: anything that went wrong. Not sent when nothing did.
      lines := public.notify_trouble_lines(p_now - interval '24 hours');
      if coalesce(array_length(lines, 1), 0) > 0 then
        perform public.notify_queue_email(p.id, 'daily_digest',
          array_length(lines, 1) || ' thing' || case when array_length(lines, 1) = 1 then '' else 's' end || ' went wrong in the last 24 hours',
          '- ' || array_to_string(lines, E'\n- '), '/admin', 'digest:' || p.id || ':' || day);
      end if;
      if extract(isodow from local) = 1 then
        select coalesce(sum(amount_cents), 0) into paid from fulfillment_payouts
         where status = 'paid' and paid_at >= wk and paid_at < p_now;
        select count(*) into k from policies where fulfillment_assigned and created_at >= wk and created_at < wk + interval '7 days';
        select count(*) into c2 from policies where fulfillment_completed_at >= wk and fulfillment_completed_at < wk + interval '7 days';
        perform public.notify_queue_email(p.id, 'monday_summary',
          'Last week: ' || k || ' booking' || case when k = 1 then '' else 's' end || ', ' || c2 || ' cancel'
            || case when c2 = 1 then '' else 's' end || ', ' || public.notify_money(paid) || ' paid out',
          'Bookings: ' || k || E'\nCancels: ' || c2 || E'\nPaid to reps since last Monday: ' || public.notify_money(paid),
          '/admin', 'monday:' || p.id || ':' || day);
      end if;
    end if;
  end loop;
  return n;
end;
$$;

-- ── client RPCs ─────────────────────────────────────────────────────────────
-- Mark some (or, with null, all) of my notifications read.
create or replace function public.notifications_mark_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  k integer;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  update notifications set read = true, read_at = now()
   where profile_id = auth.uid() and not read and (p_ids is null or id = any(p_ids));
  get diagnostics k = row_count;
  return k;
end;
$$;

-- The red banner: a money problem that needs fixing, or null.
create or replace function public.my_money_banner()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me       profiles;
  run      fulfillment_pay_runs;
  po       fulfillment_payouts;
  acct     fulfillment_payout_accounts;
  waiting  bigint;
  k        integer;
  enforced boolean := coalesce((select agent_billing_enforced from app_settings where id = 1), false);
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then return null; end if;

  if me.role::text = 'agent' then
    if not coalesce(me.billing_exempt, false) and me.billing_status in ('past_due', 'lapsed') then
      return jsonb_build_object('kind', 'payment_failed', 'title', 'Your weekly payment didn’t go through',
        'sub', case when enforced then 'New bookings are paused until it’s fixed. Calls already booked still happen.'
                    else 'Update your card to keep booking with Fulfillment.' end,
        'btn', 'Update card', 'link', '/agent/billing');
    end if;
    return null;
  end if;

  if me.role::text = 'fulfillment' then
    select * into po from fulfillment_payouts where rep_id = me.id order by period_start desc, updated_at desc limit 1;
    if po.status = 'failed' then
      return jsonb_build_object('kind', 'pay_failed', 'title', 'Your pay of ' || public.notify_money(po.amount_cents) || ' didn’t go out',
        'sub', coalesce(nullif(btrim(po.failure_reason), ''), 'It tries again next Monday.'),
        'btn', 'Check payout settings', 'link', '/fulfillment/pay?settings=1');
    end if;
    select * into acct from fulfillment_payout_accounts where rep_id = me.id;
    if not (coalesce(acct.payouts_enabled, false) and coalesce(acct.transfers_active, false)) then
      -- Held payouts hand their cancels back (payout_id null), so this counts them too.
      select coalesce(sum(amount_cents), 0) into waiting from fulfillment_cancels
       where rep_id = me.id and paid_at is null and status in ('checking', 'needs_listen', 'verified', 'verified_by_admin');
      if waiting > 0 then
        return jsonb_build_object('kind', 'no_bank', 'title', 'Connect your bank to get paid',
          'sub', public.notify_money(waiting) || ' is waiting for Monday. It’s held until a bank is added.',
          'btn', 'Connect bank', 'link', '/fulfillment/pay?settings=1');
      end if;
    end if;
    return null;
  end if;

  if me.role::text = 'admin' then
    select * into run from fulfillment_pay_runs order by pay_date desc limit 1;
    if run.status = 'short_balance' then
      return jsonb_build_object('kind', 'short_balance',
        'title', 'Monday’s payout is ' || public.notify_money(greatest(coalesce(run.needed_cents, 0) - coalesce(run.balance_cents, 0), 0)) || ' short',
        'sub', 'Stripe has ' || public.notify_money(coalesce(run.balance_cents, 0)) || ' and the run needs '
               || public.notify_money(coalesce(run.needed_cents, 0)) || '. Nobody is paid until it’s covered.',
        'btn', 'Open Payouts', 'link', '/admin/payouts');
    elsif run.status = 'error' then
      return jsonb_build_object('kind', 'run_error', 'title', 'Monday’s payout didn’t finish',
        'sub', coalesce(nullif(btrim(run.note), ''), 'The run stopped partway. It tries again tomorrow.'),
        'btn', 'Open Payouts', 'link', '/admin/payouts');
    end if;
    select count(*) into k from fulfillment_payouts f where f.status = 'failed';
    if k > 0 then
      return jsonb_build_object('kind', 'transfer_failed',
        'title', k || ' rep transfer' || case when k = 1 then '' else 's' end || ' failed',
        'sub', 'They retry next Monday. Check the rep''s bank in Payouts.',
        'btn', 'Open Payouts', 'link', '/admin/payouts');
    end if;
  end if;
  return null;
end;
$$;

-- Notification settings: my role's types, and whether email is on.
create or replace function public.my_notification_settings()
returns table (type text, label text, email_on boolean, sort integer)
language sql stable security definer set search_path = public as $$
  select t.type, t.label, coalesce(public.notify_email_on(p.id, t.type), false), t.sort
    from notification_types t join profiles p on p.id = auth.uid()
   where p.role::text = any(t.roles) and t.fires and t.email_via is not null
   order by t.sort
$$;

create or replace function public.set_notification_email(p_type text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  t notification_types;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into t from notification_types where type = p_type;
  if t.type is null or t.email_via is null
     or not exists (select 1 from profiles where id = auth.uid() and role::text = any(t.roles)) then
    raise exception 'Not a notification you get' using errcode = '22023';
  end if;
  if t.email_via = 'pay-week' then
    if p_type = 'paid' then update profiles set payout_email_sent = coalesce(p_on, false) where id = auth.uid();
    else update profiles set payout_email_problem = coalesce(p_on, false) where id = auth.uid(); end if;
  else
    update profiles
       set notification_prefs = jsonb_set(coalesce(notification_prefs, '{}'::jsonb), '{email}',
             coalesce(notification_prefs -> 'email', '{}'::jsonb) || jsonb_build_object(p_type, coalesce(p_on, false)))
     where id = auth.uid();
  end if;
end;
$$;

-- Live Room (Team tools): an admin tells agents and admins it's open.
create or replace function public.notify_live_room()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r uuid;
  n integer := 0;
  stamp text := to_char(now(), 'YYYYMMDDHH24MI');
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  for r in select id from profiles where role::text in ('agent', 'admin') and coalesce(is_active, true) and id <> auth.uid() loop
    if public.notify(r, 'live_room', 'Live Room is open', 'Join now from Team', '/agent/hierarchy#meetings',
         false, 'live:' || stamp) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- ── email sender support (service role only) ────────────────────────────────
create or replace function public.notify_claim_emails(p_limit integer default 25)
returns table (id uuid, to_email text, to_name text, subject text, body text, link text, type text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select e.id from notification_emails e
     where e.status = 'queued' and e.send_after <= now()
     order by e.send_after limit p_limit for update skip locked
  ), upd as (
    update notification_emails e set status = 'sending', attempts = e.attempts + 1
      from due where e.id = due.id
    returning e.id, e.profile_id, e.subject, e.body, e.link, e.type
  )
  select upd.id, p.email, p.full_name, upd.subject, upd.body, upd.link, upd.type
    from upd join profiles p on p.id = upd.profile_id;
end;
$$;

create or replace function public.notify_finish_email(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update notification_emails
     set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         send_after = case when p_ok then send_after else now() + interval '5 minutes' end,
         error = case when p_ok then null else left(p_error, 500) end
   where id = p_id and status = 'sending';
end;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.notify_tz(uuid)', 'public.notify_send_after(uuid, boolean, timestamptz)',
    'public.notify_email_on(uuid, text)', 'public.notify_when(timestamptz, uuid, boolean)',
    'public.notify_queue_email(uuid, text, text, text, text, text, uuid)',
    'public.notify(uuid, text, text, text, text, boolean, text, jsonb)', 'public.notify_admins()',
    'public.notify_call_times(timestamptz)', 'public.notify_job_failures(timestamptz)',
    'public.notify_trouble_lines(timestamptz)', 'public.notify_hourly(timestamptz)',
    'public.notify_claim_emails(integer)', 'public.notify_finish_email(uuid, boolean, text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.notify_claim_emails(integer) to service_role;
grant execute on function public.notify_finish_email(uuid, boolean, text) to service_role;
revoke all on function public.notifications_mark_read(uuid[]) from public, anon;
revoke all on function public.my_money_banner() from public, anon;
revoke all on function public.my_notification_settings() from public, anon;
revoke all on function public.set_notification_email(text, boolean) from public, anon;
revoke all on function public.notify_live_room() from public, anon;
grant execute on function public.notifications_mark_read(uuid[]) to authenticated;
grant execute on function public.my_money_banner() to authenticated;
grant execute on function public.my_notification_settings() to authenticated;
grant execute on function public.set_notification_email(text, boolean) to authenticated;
grant execute on function public.notify_live_room() to authenticated;

-- ── schedules ───────────────────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('notify-call-times', 'notify-job-failures', 'notify-hourly', 'notify-email',
                     'recovery-sms', 'redistribute-no-answers', 'process-reminders', 'trigger-re-engagement');
end $$;
select cron.schedule('notify-call-times', '* * * * *', $$select public.notify_call_times()$$);
select cron.schedule('notify-job-failures', '*/5 * * * *', $$select public.notify_job_failures()$$);
select cron.schedule('notify-hourly', '1 * * * *', $$select public.notify_hourly()$$);
select cron.schedule('notify-email', '* * * * *',
  $$select public.fulfillment_cron_post('notify-email', '{}'::jsonb)
     where exists (select 1 from public.notification_emails where status = 'queued' and send_after <= now())$$);

-- The four that failed every run: same schedules and jobs, now authenticated
-- with the Vault secret instead of the never-set app.* settings.
select cron.schedule('recovery-sms', '*/5 * * * *', $$select public.fulfillment_cron_post('recovery-sms', '{}'::jsonb)$$);
select cron.schedule('redistribute-no-answers', '*/5 * * * *', $$select public.fulfillment_cron_post('redistribute-no-answers', '{}'::jsonb)$$);
select cron.schedule('process-reminders', '* * * * *', $$select public.fulfillment_cron_post('process-reminders', '{}'::jsonb)$$);
select cron.schedule('trigger-re-engagement', '15 6 * * *', $$select public.fulfillment_cron_post('trigger-re-engagement', '{}'::jsonb)$$);
