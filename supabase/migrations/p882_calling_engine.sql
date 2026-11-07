-- P882 — The calling engine: ring the next free VA, real hold, keypad and merge, and the pre-dial safety check.
--
-- NOT NUMBERED, NOT APPLIED. Brayden gives it a number and applies it (Parallel rule 4). Additive only: new
-- tables, new columns, new functions, notification types and one cron job. Nothing is dropped, renamed or emptied
-- except one check constraint and one RLS policy on fulfillment_voice_legs, which are re-created wider (a line's
-- legs) and keep every row they allowed before.
--
-- APPLY ORDER: after 137 (fulfillment_voice_legs), 145 (fulfillment_cron_post), 156 (notify), 157 (sms_opt_outs),
-- 175 (leads.va_*), 179 (help_calls), 180 (inbound_events), 183 (lead_sms_match), 231 (va_shifts). 230 (GHL) is
-- optional: an opt-out written here reaches GoHighLevel through 230's sms_opt_outs trigger when 230 is applied.
--
-- How it works (How Ohvara Works → Speed to lead, How VAs make calls, Decisions Q15/16, Q51):
--   va_presence     one row per VA (and per admin covering the desk): available, ringing, on_call, wrap, away,
--                   offline, on_hold_carrier (on a carrier hold with no client on the line). The portal beats
--                   every 10 s (va_beat); 30 s of silence pulls the VA out of routing.
--   call_queue      the work that rings a person: an inbound caller, a new lead, a due callback, a carrier hold
--                   handed off, a dropped call to rescue. route_tick offers each item to ONE free person (the
--                   longest idle), 15 s to answer, then the next one. Never everyone.
--   va_lines        one call (a Twilio conference) a VA is running, so hold / keypad / merge / drop work for every
--                   call type, not only cancellations. The VA's browser joins with { line_id }.
--   predial_check   before every call and text: consent on file, not opted out or on do-not-call, inside the
--                   lead's legal hours (every zone of their state), under the state's attempt cap.
--   mark_do_not_call one tap: opted out of calls and texts everywhere (GoHighLevel through 230's trigger), queued
--                   calls cancelled, scheduled texts skipped.
--   No call recording at launch (Q51): nothing here records, and recording_party is kept only as rule data.

do $$
begin
  if to_regclass('public.help_calls') is null then raise exception 'p882 needs 179_help_calls applied first'; end if;
  if to_regclass('public.va_shifts') is null then raise exception 'p882 needs 231_va_shifts applied first'; end if;
  if to_regclass('public.sms_opt_outs') is null then raise exception 'p882 needs 157_text_consent applied first'; end if;
  if to_regclass('public.fulfillment_voice_legs') is null then raise exception 'p882 needs 137_portal_phone applied first'; end if;
  if to_regclass('public.inbound_events') is null then raise exception 'p882 needs 180_agent_inbounds applied first'; end if;
  if to_regprocedure('public.notify(uuid, text, text, text, text, boolean, text, jsonb)') is null then
    raise exception 'p882 needs 156_phone_app applied first';
  end if;
end $$;

-- ── 1. State rules (N-J-18): hours, attempt caps, recording party. Admin-maintained, counsel review flagged ─────
create table if not exists public.state_call_rules (
  state            text primary key check (state ~ '^[A-Z]{2}$'),
  tz               text[] not null check (cardinality(tz) > 0),
  call_start       time not null default '08:00',
  call_end         time not null default '21:00',
  sun_start        time,                        -- Sunday override (both or neither)
  sun_end          time,
  max_attempts_24h int check (max_attempts_24h is null or max_attempts_24h > 0),
  recording_party  text not null default 'one' check (recording_party in ('one', 'all')),
  counsel_reviewed boolean not null default false,
  reviewed_at      timestamptz,
  notes            text check (notes is null or char_length(notes) <= 1000),
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint state_call_rules_window check (call_end > call_start),
  constraint state_call_rules_sunday check ((sun_start is null) = (sun_end is null) and (sun_end is null or sun_end > sun_start))
);
comment on table public.state_call_rules is
  'P882: when calls and texts may go out, per state, in every zone of the state. Seeded defaults, NOT counsel-reviewed.';

-- Seed: federal 8 AM-9 PM; FL, OK, MD 8 AM-8 PM and 3 attempts in 24 h (their telemarketing acts); WA 8 AM-8 PM;
-- TX 9 AM-9 PM, Sunday noon-9 PM. Recording party is data only (no recording at launch, Q51).
insert into public.state_call_rules (state, tz, call_start, call_end, sun_start, sun_end, max_attempts_24h, recording_party, notes)
select s.state, s.tz, coalesce(s.cs, '08:00'), coalesce(s.ce, '21:00'), s.ss, s.se, s.cap, coalesce(s.rec, 'one'),
       'Seeded default (P882). Needs counsel review.'
  from (values
    ('AL', array['America/Chicago'], null::time, null::time, null::time, null::time, null::int, null),
    ('AK', array['America/Anchorage', 'America/Adak'], null, null, null, null, null, null),
    ('AZ', array['America/Phoenix'], null, null, null, null, null, null),
    ('AR', array['America/Chicago'], null, null, null, null, null, null),
    ('CA', array['America/Los_Angeles'], null, null, null, null, null, 'all'),
    ('CO', array['America/Denver'], null, null, null, null, null, null),
    ('CT', array['America/New_York'], null, null, null, null, null, 'all'),
    ('DE', array['America/New_York'], null, null, null, null, null, 'all'),
    ('DC', array['America/New_York'], null, null, null, null, null, null),
    ('FL', array['America/New_York', 'America/Chicago'], '08:00', '20:00', null, null, 3, 'all'),
    ('GA', array['America/New_York'], null, null, null, null, null, null),
    ('HI', array['Pacific/Honolulu'], null, null, null, null, null, null),
    ('ID', array['America/Boise', 'America/Los_Angeles'], null, null, null, null, null, null),
    ('IL', array['America/Chicago'], null, null, null, null, null, 'all'),
    ('IN', array['America/Indiana/Indianapolis', 'America/Chicago'], null, null, null, null, null, null),
    ('IA', array['America/Chicago'], null, null, null, null, null, null),
    ('KS', array['America/Chicago', 'America/Denver'], null, null, null, null, null, null),
    ('KY', array['America/New_York', 'America/Chicago'], null, null, null, null, null, null),
    ('LA', array['America/Chicago'], null, null, null, null, null, null),
    ('ME', array['America/New_York'], null, null, null, null, null, null),
    ('MD', array['America/New_York'], '08:00', '20:00', null, null, 3, 'all'),
    ('MA', array['America/New_York'], null, null, null, null, null, 'all'),
    ('MI', array['America/Detroit', 'America/Menominee'], null, null, null, null, null, 'all'),
    ('MN', array['America/Chicago'], null, null, null, null, null, null),
    ('MS', array['America/Chicago'], null, null, null, null, null, null),
    ('MO', array['America/Chicago'], null, null, null, null, null, null),
    ('MT', array['America/Denver'], null, null, null, null, null, 'all'),
    ('NE', array['America/Chicago', 'America/Denver'], null, null, null, null, null, null),
    ('NV', array['America/Los_Angeles'], null, null, null, null, null, 'all'),
    ('NH', array['America/New_York'], null, null, null, null, null, 'all'),
    ('NJ', array['America/New_York'], null, null, null, null, null, null),
    ('NM', array['America/Denver'], null, null, null, null, null, null),
    ('NY', array['America/New_York'], null, null, null, null, null, null),
    ('NC', array['America/New_York'], null, null, null, null, null, null),
    ('ND', array['America/Chicago', 'America/Denver'], null, null, null, null, null, null),
    ('OH', array['America/New_York'], null, null, null, null, null, null),
    ('OK', array['America/Chicago'], '08:00', '20:00', null, null, 3, null),
    ('OR', array['America/Los_Angeles', 'America/Boise'], null, null, null, null, null, 'all'),
    ('PA', array['America/New_York'], null, null, null, null, null, 'all'),
    ('RI', array['America/New_York'], null, null, null, null, null, null),
    ('SC', array['America/New_York'], null, null, null, null, null, null),
    ('SD', array['America/Chicago', 'America/Denver'], null, null, null, null, null, null),
    ('TN', array['America/Chicago', 'America/New_York'], null, null, null, null, null, null),
    ('TX', array['America/Chicago', 'America/Denver'], '09:00', '21:00', '12:00', '21:00', null, null),
    ('UT', array['America/Denver'], null, null, null, null, null, null),
    ('VT', array['America/New_York'], null, null, null, null, null, null),
    ('VA', array['America/New_York'], null, null, null, null, null, null),
    ('WA', array['America/Los_Angeles'], '08:00', '20:00', null, null, null, 'all'),
    ('WV', array['America/New_York'], null, null, null, null, null, null),
    ('WI', array['America/Chicago'], null, null, null, null, null, null),
    ('WY', array['America/Denver'], null, null, null, null, null, null),
    ('PR', array['America/Puerto_Rico'], null, null, null, null, null, null)
  ) as s(state, tz, cs, ce, ss, se, cap, rec)
on conflict (state) do nothing;

alter table public.state_call_rules enable row level security;
revoke all on public.state_call_rules from anon, authenticated;
grant select on public.state_call_rules to authenticated;
drop policy if exists state_call_rules_read on public.state_call_rules;
create policy state_call_rules_read on public.state_call_rules for select to authenticated
  using (public.is_admin() or public.is_fulfillment());

-- ── 2. Do-not-call list, attempts, call-in consent ──────────────────────────────────────────────────────────────
create table if not exists public.dnc_numbers (
  phone               text primary key,          -- E.164
  internal            boolean not null default false,  -- asked us not to call (one-tap Do not call, STOP)
  national            boolean not null default false,  -- on the national registry (from a scrub)
  national_checked_at timestamptz,
  source              text,
  note                text check (note is null or char_length(note) <= 500),
  added_by            uuid references public.profiles(id) on delete set null,
  added_at            timestamptz not null default now()
);
alter table public.dnc_numbers enable row level security;
revoke all on public.dnc_numbers from anon, authenticated;
grant select on public.dnc_numbers to authenticated;
drop policy if exists dnc_numbers_read on public.dnc_numbers;
create policy dnc_numbers_read on public.dnc_numbers for select to authenticated using (public.is_admin());

create table if not exists public.call_attempts (
  id        bigserial primary key,
  phone     text not null,
  lead_id   uuid references public.leads(id) on delete set null,
  policy_id uuid references public.policies(id) on delete set null,
  line_id   uuid,
  va_id     uuid references public.profiles(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists call_attempts_phone_at_idx on public.call_attempts (phone, at desc);
alter table public.call_attempts enable row level security;
revoke all on public.call_attempts from anon, authenticated;
grant select on public.call_attempts to authenticated;
drop policy if exists call_attempts_read on public.call_attempts;
create policy call_attempts_read on public.call_attempts for select to authenticated using (public.is_admin());

-- A lead who called in gave consent by calling (P879 "call-in consent line"); stamped by help-voice.
alter table public.leads add column if not exists call_consent_at timestamptz;

-- The words the phone leaves on a voicemail and says to an after-hours caller. Client-facing wording is Brayden's:
-- null = the phone refuses the voicemail drop, and help-voice uses its plain default greeting.
alter table public.recovery_config add column if not exists voicemail_text text check (voicemail_text is null or char_length(voicemail_text) <= 600);
alter table public.recovery_config add column if not exists after_hours_text text check (after_hours_text is null or char_length(after_hours_text) <= 600);

-- ── 3. Pre-dial (N-J-17, N-F-14) ────────────────────────────────────────────────────────────────────────────────
-- Inside the window at p_at in EVERY zone of the state (a state that spans two zones must be open in both).
create or replace function public.call_window_ok(r public.state_call_rules, p_at timestamptz)
returns boolean language plpgsql stable set search_path = public as $$
declare z text; lt timestamp; s time; e time;
begin
  foreach z in array r.tz loop
    lt := p_at at time zone z;
    if extract(dow from lt) = 0 and r.sun_start is not null then s := r.sun_start; e := r.sun_end;
    else s := r.call_start; e := r.call_end; end if;
    if lt::time < s or lt::time >= e then return false; end if;
  end loop;
  return true;
end;
$$;

-- The first moment at or after p_at when the window is open in every zone: the candidates are p_at itself and each
-- zone's opening time on the next four days.
create or replace function public.call_window_next(r public.state_call_rules, p_at timestamptz)
returns timestamptz language plpgsql stable set search_path = public as $$
declare z text; d int; c timestamptz; best timestamptz; day date; s time;
begin
  if public.call_window_ok(r, p_at) then return p_at; end if;
  foreach z in array r.tz loop
    for d in 0..4 loop
      day := (p_at at time zone z)::date + d;
      s := case when extract(dow from day) = 0 and r.sun_start is not null then r.sun_start else r.call_start end;
      c := (day + s) at time zone z;
      if c >= p_at and public.call_window_ok(r, c) and (best is null or c < best) then best := c; end if;
    end loop;
  end loop;
  return best;
end;
$$;

-- The check itself (server side; no caller check, so a lead inserted by anyone still gets queued).
-- Consent on file: the form's consent (written), a call-in (p_called_in, or leads.call_consent_at), or an
-- existing client (a policy). Someone who just called us with no state on file is called back inside desk hours.
create or replace function public.predial_eval(p_phone text, p_state text default null, p_lead uuid default null,
  p_channel text default 'call', p_at timestamptz default now(), p_policy uuid default null, p_called_in boolean default false)
returns table (ok boolean, reason text, next_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  e       text := public.sms_e164(p_phone);
  l       public.leads;
  pst     text;
  r       public.state_call_rules;
  written boolean := false;
  consent boolean := false;
  d       public.dnc_numbers;
  n       int;
  oldest  timestamptz;
begin
  if p_channel not in ('call', 'text') then raise exception 'channel must be call or text' using errcode = '22023'; end if;
  if p_lead is not null then select * into l from public.leads where id = p_lead; end if;
  if p_policy is not null then select state, coalesce(e, public.sms_e164(client_phone)) into pst, e from public.policies where id = p_policy; end if;
  e := coalesce(e, public.sms_e164(l.phone));
  if e is null then return query select false, 'no_phone', null::timestamptz; return; end if;

  if public.sms_is_opted_out(e) then return query select false, 'opted_out', null::timestamptz; return; end if;
  select * into d from public.dnc_numbers where phone = e;
  if d.internal then return query select false, 'dnc', null::timestamptz; return; end if;

  written := l.id is not null and coalesce(l.qualifier_answers ->> 'consent_at', '') <> '';
  consent := written or coalesce(p_called_in, false) or l.call_consent_at is not null or p_policy is not null
             or (l.id is null and exists (select 1 from public.policies p where public.sms_e164(p.client_phone) = e));
  if not consent then return query select false, 'no_consent', null::timestamptz; return; end if;
  if d.national and not written and p_policy is null and not coalesce(p_called_in, false) then
    return query select false, 'national_dnc', null::timestamptz; return;
  end if;

  select * into r from public.state_call_rules where state = upper(trim(coalesce(p_state, l.state, pst, '')));
  if r.state is null and coalesce(p_called_in, false) then
    if public.route_desk_open(p_at) then return query select true, null::text, null::timestamptz;
    else return query select false, 'outside_hours', public.route_desk_next(p_at); end if;
    return;
  end if;
  if r.state is null then return query select false, 'unknown_state', null::timestamptz; return; end if;
  if not public.call_window_ok(r, p_at) then
    return query select false, 'outside_hours', public.call_window_next(r, p_at); return;
  end if;

  if p_channel = 'call' and r.max_attempts_24h is not null then
    select count(*), min(at) into n, oldest from public.call_attempts
     where phone = e and at > p_at - interval '24 hours' and at <= p_at;
    if n >= r.max_attempts_24h then
      return query select false, 'attempt_cap', public.call_window_next(r, oldest + interval '24 hours'); return;
    end if;
  end if;
  return query select true, null::text, null::timestamptz;
end;
$$;

-- The same check for the portal and fulfillment-call (VAs and admins; the service role passes through).
create or replace function public.predial_check(p_phone text, p_state text default null, p_lead uuid default null,
  p_channel text default 'call', p_at timestamptz default now(), p_policy uuid default null)
returns table (ok boolean, reason text, next_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not (public.is_admin() or public.is_fulfillment()) then
    raise exception 'Only Fulfillment can check a call' using errcode = '42501';
  end if;
  return query select * from public.predial_eval(p_phone, p_state, p_lead, p_channel, p_at, p_policy, false);
end;
$$;

-- fulfillment-call logs each real outbound attempt (the cap counts these).
create or replace function public.predial_log_attempt(p_phone text, p_lead uuid, p_policy uuid, p_line uuid, p_va uuid)
returns void language sql volatile security definer set search_path = public as $$
  insert into public.call_attempts (phone, lead_id, policy_id, line_id, va_id)
  select public.sms_e164(p_phone), p_lead, p_policy, p_line, p_va where public.sms_e164(p_phone) is not null
$$;

-- ── 4. Presence (N-F-03, N-F-10, N-F-12, N-F-33) ───────────────────────────────────────────────────────────────
create table if not exists public.va_presence (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  status            text not null default 'offline' check (status in (
                      'offline', 'available', 'ringing', 'on_call', 'wrap', 'away', 'on_hold_carrier')),
  is_desk           boolean not null default false,   -- an admin covering the desk
  since             timestamptz not null default now(),
  idle_since        timestamptz,                      -- when they last became free: longest idle rings first
  last_seen         timestamptz,
  missed_rings      int not null default 0,
  pulled_at         timestamptz,
  pulled_reason     text,
  silent_alerted_at timestamptz,
  wrap_started_at   timestamptz,
  wrap_extra        int not null default 0,           -- each +60 s asked for, counted
  wrap_alerted_at   timestamptz,
  line_id           uuid,
  paused_task       jsonb check (paused_task is null or jsonb_typeof(paused_task) = 'object'),
  updated_at        timestamptz not null default now()
);
alter table public.va_presence enable row level security;
revoke all on public.va_presence from anon, authenticated;
grant select on public.va_presence to authenticated;
drop policy if exists va_presence_read on public.va_presence;
create policy va_presence_read on public.va_presence for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_fulfillment());

-- Every status stretch, so desk time (admins) is logged apart from VA hours and pay.
create table if not exists public.presence_log (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null,
  is_desk    boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists presence_log_user_idx on public.presence_log (user_id, started_at desc);
alter table public.presence_log enable row level security;
revoke all on public.presence_log from anon, authenticated;
grant select on public.presence_log to authenticated;
drop policy if exists presence_log_read on public.presence_log;
create policy presence_log_read on public.presence_log for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.presence_log_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.is_desk is not distinct from old.is_desk then
    return new;
  end if;
  update public.presence_log set ended_at = now() where user_id = new.user_id and ended_at is null;
  insert into public.presence_log (user_id, status, is_desk) values (new.user_id, new.status, new.is_desk);
  return new;
end;
$$;
drop trigger if exists presence_log_row on public.va_presence;
create trigger presence_log_row after insert or update on public.va_presence
  for each row execute function public.presence_log_row();

-- ── 5. Lines: one call a VA runs, any type (N-F-13, N-F-27, N-F-37) ─────────────────────────────────────────────
create table if not exists public.va_lines (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('lead', 'servicing', 'inbound', 'carrier')),
  conference   text unique,                 -- 'line-<id>', or 'help-<CallSid>' for an inbound caller
  lead_id      uuid references public.leads(id) on delete set null,
  policy_id    uuid references public.policies(id) on delete set null,
  help_call_sid text,
  va_id        uuid references public.profiles(id) on delete set null,
  va_call_sid  text,
  status       text not null default 'open' check (status in ('open', 'live', 'rescue', 'handoff', 'ended')),
  rescue_until timestamptz,
  detail       jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  queue_item   uuid,
  created_at   timestamptz not null default now(),
  live_at      timestamptz,
  ended_at     timestamptz,
  end_reason   text
);
create index if not exists va_lines_va_idx on public.va_lines (va_id, created_at desc);
create or replace function public.line_conference_name()
returns trigger language plpgsql set search_path = public as $$
begin
  new.conference := coalesce(new.conference, 'line-' || new.id::text);
  return new;
end;
$$;
drop trigger if exists line_conference_name on public.va_lines;
create trigger line_conference_name before insert on public.va_lines for each row execute function public.line_conference_name();
alter table public.va_lines enable row level security;
revoke all on public.va_lines from anon, authenticated;
grant select on public.va_lines to authenticated;
drop policy if exists va_lines_read on public.va_lines;
create policy va_lines_read on public.va_lines for select to authenticated
  using (va_id = auth.uid() or public.is_admin());

-- The legs of a line: same table as the cancellation phone, wider party list.
alter table public.fulfillment_voice_legs add column if not exists line_id uuid references public.va_lines(id) on delete cascade;
alter table public.fulfillment_voice_legs alter column policy_id drop not null;
alter table public.fulfillment_voice_legs drop constraint if exists fulfillment_voice_legs_party_check;
alter table public.fulfillment_voice_legs add constraint fulfillment_voice_legs_party_check
  check (party in ('client', 'carrier', 'lead', 'agent'));
alter table public.fulfillment_voice_legs drop constraint if exists fulfillment_voice_legs_owner;
alter table public.fulfillment_voice_legs add constraint fulfillment_voice_legs_owner
  check (policy_id is not null or line_id is not null);
create index if not exists fulfillment_voice_legs_line_idx on public.fulfillment_voice_legs (line_id, started_at desc);
drop policy if exists fulfillment_voice_legs_read on public.fulfillment_voice_legs;
create policy fulfillment_voice_legs_read on public.fulfillment_voice_legs
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.policies p where p.id = policy_id and p.assigned_fulfillment_id = auth.uid())
    or exists (select 1 from public.va_lines v where v.id = line_id and v.va_id = auth.uid())
  );

-- ── 6. The queue (N-F-10, N-F-16, N-F-42, N-J-03) ──────────────────────────────────────────────────────────────
create table if not exists public.call_queue (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('inbound', 'new_lead', 'callback', 'hold_handoff', 'rescue')),
  priority         int not null,              -- 0 a person is waiting on the line, 1 new lead, 2 callback, 3 hold
  lead_id          uuid references public.leads(id) on delete cascade,
  policy_id        uuid references public.policies(id) on delete set null,
  help_call_sid    text,
  line_id          uuid references public.va_lines(id) on delete set null,
  phone            text,
  state            text,
  name             text,
  status           text not null default 'waiting' check (status in (
                     'held', 'waiting', 'offered', 'taken', 'cancelled', 'done', 'expired')),
  ready_at         timestamptz not null default now(),   -- waiting since (after any hold)
  hold_until       timestamptz,
  hold_reason      text,
  due_at           timestamptz,               -- a callback's promised time
  promiser_id      uuid references public.profiles(id) on delete set null,
  offered_to       uuid references public.profiles(id) on delete set null,
  offered_at       timestamptz,
  offer_expires_at timestamptz,
  pull_hold        boolean not null default false,  -- offered to a VA on a carrier hold with no client
  missed_by        uuid[] not null default '{}',
  exclude          uuid[] not null default '{}',     -- never offer to these (the VA whose call dropped)
  taken_by         uuid references public.profiles(id) on delete set null,
  taken_at         timestamptz,
  alerts           int not null default 0,
  last_alert_at    timestamptz,
  speed_miss       boolean not null default false,
  late_alerted     boolean not null default false,
  detail           jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  cancel_reason    text,
  created_at       timestamptz not null default now()
);
create unique index if not exists call_queue_one_open_per_lead
  on public.call_queue (lead_id, kind) where lead_id is not null and status in ('held', 'waiting', 'offered');
create unique index if not exists call_queue_one_open_per_help
  on public.call_queue (help_call_sid) where help_call_sid is not null and status in ('held', 'waiting', 'offered');
create index if not exists call_queue_open_idx on public.call_queue (priority, ready_at) where status in ('held', 'waiting', 'offered');
alter table public.call_queue enable row level security;
revoke all on public.call_queue from anon, authenticated;
grant select on public.call_queue to authenticated;
drop policy if exists call_queue_read on public.call_queue;
-- Every VA and admin sees what's waiting (the timer at the top for everyone); writes only through the functions.
create policy call_queue_read on public.call_queue for select to authenticated
  using (public.is_admin() or public.is_fulfillment());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'call_queue') then
      alter publication supabase_realtime add table public.call_queue;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'va_presence') then
      alter publication supabase_realtime add table public.va_presence;
    end if;
  end if;
end $$;

-- ── 7. Notification types ───────────────────────────────────────────────────────────────────────────────────────
-- money = true here only means "ignores quiet hours" (156): a ring or a waiting lead can't wait for morning.
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select t.type, t.roles, t.label, false, null, t.bell, true, true, true,
       coalesce((select max(sort) from public.notification_types), 0) + t.n
  from (values
    ('va_ring', array['fulfillment', 'admin'], 'A call is ringing for you', false, 1),
    ('va_pulled', array['fulfillment', 'admin'], 'Taken out of the call rotation', true, 2),
    ('lead_waiting', array['admin'], 'A lead is waiting for a VA', true, 3),
    ('va_missed_rings', array['admin'], 'A VA missed two calls in a row', true, 4),
    ('va_silent', array['admin'], 'A VA on shift has gone quiet', true, 5),
    ('wrap_stuck', array['admin'], 'A VA has been in wrap-up over 3 minutes', true, 6),
    ('callback_late', array['admin'], 'A promised callback is late', true, 7),
    ('va_needs_help', array['admin'], 'A VA asked for help on a call', true, 8),
    ('overtime_request', array['admin'], 'A VA asked to stay on a carrier hold', true, 9)
  ) as t(type, roles, label, bell, n)
 where not exists (select 1 from public.notification_types x where x.type = t.type);

create or replace function public.route_notify_admins(p_type text, p_title text, p_detail text, p_link text, p_dedupe text)
returns int language plpgsql security definer set search_path = public as $$
declare a uuid; n int := 0;
begin
  for a in select id from public.profiles where role::text = 'admin' and coalesce(is_active, true)
             and not coalesce(is_demo, false) loop
    begin
      perform public.notify(a, p_type, p_title, p_detail, p_link, true, p_dedupe || ':' || a::text, '{}'::jsonb);
      n := n + 1;
    exception when others then raise warning 'route_notify_admins %: %', p_type, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

-- ── 8. Routing ──────────────────────────────────────────────────────────────────────────────────────────────────
-- VA hours are 8 AM-6 PM Central (standing rule). Outside them, calls wait for the morning (Q15/16).
create or replace function public.route_desk_open(p_at timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select (p_at at time zone 'America/Chicago')::time >= time '08:00'
     and (p_at at time zone 'America/Chicago')::time <  time '18:00'
$$;
create or replace function public.route_desk_next(p_at timestamptz default now())
returns timestamptz language sql stable set search_path = public as $$
  select case
    when public.route_desk_open(p_at) then p_at
    when (p_at at time zone 'America/Chicago')::time < time '08:00'
      then (((p_at at time zone 'America/Chicago')::date) + time '08:00') at time zone 'America/Chicago'
    else (((p_at at time zone 'America/Chicago')::date + 1) + time '08:00') at time zone 'America/Chicago'
  end
$$;

-- Who can take a call right now: beat in the last 30 s, active, and either a VA on shift or an admin on the desk.
create or replace function public.route_can_take(p public.va_presence, p_at timestamptz default now())
returns boolean language sql stable security definer set search_path = public as $$
  select p.last_seen > p_at - interval '30 seconds'
     and exists (select 1 from public.profiles pr where pr.id = p.user_id and coalesce(pr.is_active, true)
                   and not coalesce(pr.is_demo, false)
                   and ((pr.role::text = 'admin' and p.is_desk)
                        or (pr.role::text = 'fulfillment' and public.va_on_shift_at(p.user_id, p_at))))
$$;

-- Offer one item to ONE person: the promiser first for a callback, else the longest idle. A new lead with nobody
-- free may go to a VA sitting on a carrier hold with no client (that hold is handed off when they accept).
create or replace function public.route_offer(p_item uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare q public.call_queue; who uuid; pull boolean := false;
begin
  select * into q from public.call_queue where id = p_item and status = 'waiting' for update skip locked;
  if q.id is null then return null; end if;
  if q.kind = 'callback' and q.promiser_id is not null and not (q.promiser_id = any(q.missed_by || q.exclude)) then
    select p.user_id into who from public.va_presence p
     where p.user_id = q.promiser_id and p.status = 'available' and public.route_can_take(p);
  end if;
  if who is null then
    select p.user_id into who from public.va_presence p
     where p.status = 'available' and public.route_can_take(p)
       and not (p.user_id = any(q.missed_by || q.exclude))
     order by p.idle_since asc nulls last, p.user_id
     limit 1 for update skip locked;
  end if;
  if who is null and q.kind in ('new_lead', 'inbound') then
    select p.user_id into who from public.va_presence p
     where p.status = 'on_hold_carrier' and public.route_can_take(p)
       and not (p.user_id = any(q.missed_by || q.exclude))
     order by p.since asc, p.user_id
     limit 1 for update skip locked;
    pull := who is not null;
  end if;
  if who is null then return null; end if;

  update public.call_queue
     set status = 'offered', offered_to = who, offered_at = now(), offer_expires_at = now() + interval '15 seconds',
         pull_hold = pull
   where id = q.id;
  update public.va_presence set status = case when pull then status else 'ringing' end, updated_at = now()
   where user_id = who;
  begin
    perform public.notify(who, 'va_ring',
      case q.kind when 'inbound' then 'Someone is calling in' when 'new_lead' then 'New lead: call now'
                  when 'callback' then 'Callback due now' when 'hold_handoff' then 'A carrier hold was handed to you'
                  else 'A dropped call needs you' end,
      coalesce(q.name, 'Answer in the portal'), '/fulfillment', true, 'ring:' || q.id::text,
      jsonb_build_object('queue_id', q.id, 'kind', q.kind));
  exception when others then raise warning 'va_ring notify: %', sqlerrm;
  end;
  return who;
end;
$$;

-- An offer that wasn't taken: counted against the VA (2 in a row = Away + admins told), and the item goes back.
create or replace function public.route_missed(p_item uuid, p_counted boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare q public.call_queue; p public.va_presence; who uuid;
begin
  select * into q from public.call_queue where id = p_item and status = 'offered' for update;
  if q.id is null then return; end if;
  who := q.offered_to;
  update public.call_queue
     set status = 'waiting', missed_by = case when p_counted and who is not null then array_append(missed_by, who) else missed_by end,
         offered_to = null, offered_at = null, offer_expires_at = null, pull_hold = false
   where id = p_item;
  if who is null then return; end if;
  -- A VA offered the call while sitting on a carrier hold stays on that hold.
  if p_counted then
    update public.va_presence
       set missed_rings = missed_rings + 1,
           status = case when status not in ('ringing', 'available') then status
                         when missed_rings + 1 >= 2 then 'away' else 'available' end,
           since = case when status in ('ringing', 'available') and missed_rings + 1 >= 2 then now() else since end,
           updated_at = now()
     where user_id = who
     returning * into p;
    if p.missed_rings >= 2 and p.status = 'away' then
      perform public.route_notify_admins('va_missed_rings',
        coalesce((select full_name from public.profiles where id = who), 'A VA') || ' missed 2 calls in a row',
        'Set to Away. They go back on when they press Available.', '/admin/team', 'missed:' || who || ':' || q.id);
    end if;
  else
    update public.va_presence set status = 'available', updated_at = now() where user_id = who and status = 'ringing';
  end if;
end;
$$;

-- Put an item on the queue. Outbound kinds go through the pre-dial check: blocked for good (opted out, do not
-- call, no consent, unknown state) → cancelled with the reason; outside hours or over the cap → held until the
-- window opens; after VA hours → held until 8 AM Central at the earliest.
create or replace function public.route_enqueue(p_kind text, p_lead uuid default null, p_phone text default null,
  p_state text default null, p_name text default null, p_help_sid text default null, p_line uuid default null,
  p_due timestamptz default null, p_promiser uuid default null, p_detail jsonb default '{}'::jsonb,
  p_exclude uuid[] default '{}', p_policy uuid default null, p_offer boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l    public.leads;
  chk  record;
  st   text := 'waiting';
  hold timestamptz;
  why  text;
  id_  uuid;
  pri  int := case p_kind when 'inbound' then 0 when 'rescue' then 0 when 'new_lead' then 1 when 'callback' then 2 else 3 end;
begin
  if p_lead is not null then select * into l from public.leads where id = p_lead; end if;
  if p_kind in ('new_lead', 'callback') then
    select * into chk from public.predial_eval(coalesce(p_phone, l.phone), coalesce(p_state, l.state), p_lead, 'call', now(),
      p_policy, coalesce(p_detail, '{}'::jsonb) ? 'help_call_sid');
    if not chk.ok and chk.reason in ('outside_hours', 'attempt_cap') then
      st := 'held'; hold := chk.next_at; why := chk.reason;
    elsif not chk.ok then
      st := 'cancelled'; why := chk.reason;
    end if;
    if st <> 'cancelled' and not public.route_desk_open(coalesce(hold, now())) then
      st := 'held'; hold := public.route_desk_next(coalesce(hold, now())); why := coalesce(why, 'after_hours');
    end if;
  end if;

  insert into public.call_queue (kind, priority, lead_id, policy_id, help_call_sid, line_id, phone, state, name, status,
                                 ready_at, hold_until, hold_reason, due_at, promiser_id, detail, exclude, cancel_reason)
  values (p_kind, pri, p_lead, p_policy, p_help_sid, p_line, public.sms_e164(coalesce(p_phone, l.phone)),
          upper(nullif(trim(coalesce(p_state, l.state, '')), '')), coalesce(p_name, l.contact_name, l.business_name),
          st, coalesce(hold, now()), hold, why, p_due, p_promiser, coalesce(p_detail, '{}'::jsonb), coalesce(p_exclude, '{}'),
          case when st = 'cancelled' then why end)
  on conflict do nothing
  returning id into id_;
  if id_ is not null and st = 'waiting' and p_offer then perform public.route_offer(id_); end if;
  return id_;
end;
$$;

-- A new lead (form, any typed lead) rings the next free VA right away (speed to lead).
create or replace function public.route_new_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_type is distinct from 'cancellation' and new.phone is not null then
    begin
      perform public.route_enqueue('new_lead', new.id);
    exception when others then raise warning 'route_new_lead %: %', new.id, sqlerrm;  -- never blocks the lead
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_route_new on public.leads;
create trigger leads_route_new after insert on public.leads for each row execute function public.route_new_lead();

-- Cancel every queued call to a number (or lead): opt-outs from anywhere (STOP, GoHighLevel DND, Do not call).
create or replace function public.route_cancel_phone(p_phone text, p_lead uuid, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare e text := public.sms_e164(p_phone); n int; r record;
begin
  for r in select id, offered_to from public.call_queue
            where status in ('held', 'waiting', 'offered') and kind in ('new_lead', 'callback')
              and ((e is not null and phone = e) or (p_lead is not null and lead_id = p_lead)) loop
    update public.va_presence set status = 'available', updated_at = now() where user_id = r.offered_to and status = 'ringing';
  end loop;
  update public.call_queue set status = 'cancelled', cancel_reason = p_reason, offered_to = null
   where status in ('held', 'waiting', 'offered') and kind in ('new_lead', 'callback')
     and ((e is not null and phone = e) or (p_lead is not null and lead_id = p_lead));
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.route_opt_out_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.opted_out and (tg_op = 'INSERT' or not old.opted_out) then
    begin
      perform public.route_cancel_phone(new.phone, null, 'opted_out');
      update public.inbound_events e set state = 'skipped', detail = e.detail || jsonb_build_object('skipped', 'opted_out')
       where e.state = 'scheduled' and e.kind in ('text_sent', 'reminder', 'va_call')
         and e.lead_id in (select id from public.leads where public.sms_e164(phone) = new.phone);
    exception when others then raise warning 'route_opt_out_sync: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists sms_opt_outs_calls on public.sms_opt_outs;
create trigger sms_opt_outs_calls after insert or update of opted_out on public.sms_opt_outs
  for each row execute function public.route_opt_out_sync();

-- The sweep: run every 10 s by cron and on every VA beat. One at a time (advisory lock).
create or replace function public.route_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; chk record; offered int := 0; who uuid; nm text; ended int := 0;
begin
  if not pg_try_advisory_xact_lock(882001) then return jsonb_build_object('skipped', true); end if;

  -- a. Offers nobody took in 15 s: a counted miss.
  for r in select id from public.call_queue where status = 'offered' and offer_expires_at < now() loop
    perform public.route_missed(r.id, true);
  end loop;

  -- b. Quiet for 30 s: out of routing (an offer to them goes back, uncounted), and told.
  for r in select p.* from public.va_presence p
            where p.status in ('available', 'ringing') and (p.last_seen is null or p.last_seen < now() - interval '30 seconds') loop
    for who in select id from public.call_queue where status = 'offered' and offered_to = r.user_id loop
      perform public.route_missed(who, false);
    end loop;
    update public.va_presence set status = 'offline', since = now(), pulled_at = now(), pulled_reason = 'silent', updated_at = now()
     where user_id = r.user_id;
    begin
      perform public.notify(r.user_id, 'va_pulled', 'You were taken out of the call rotation',
        'Your portal stopped answering. Open it and press Available to get calls again.', '/fulfillment', true,
        'pulled:' || r.user_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), '{}'::jsonb);
    exception when others then raise warning 'va_pulled: %', sqlerrm;
    end;
  end loop;
  -- 15 minutes quiet while on shift: admins told once.
  for r in select p.user_id from public.va_presence p join public.profiles pr on pr.id = p.user_id
            where pr.role::text = 'fulfillment' and p.pulled_reason = 'silent' and p.silent_alerted_at is null
              and p.pulled_at < now() - interval '15 minutes' + interval '30 seconds'
              and public.va_on_shift_at(p.user_id, now()) loop
    update public.va_presence set silent_alerted_at = now() where user_id = r.user_id;
    perform public.route_notify_admins('va_silent',
      coalesce((select full_name from public.profiles where id = r.user_id), 'A VA') || ' has been quiet for 15 minutes',
      'They are on shift but their portal is not answering.', '/admin/team', 'silent:' || r.user_id || ':' || to_char(now(), 'YYYYMMDD'));
  end loop;

  -- c. Wrap-up past 3 minutes: admins told once per wrap.
  for r in select p.user_id from public.va_presence p
            where p.status = 'wrap' and p.wrap_alerted_at is null and p.wrap_started_at < now() - interval '3 minutes' loop
    update public.va_presence set wrap_alerted_at = now() where user_id = r.user_id;
    perform public.route_notify_admins('wrap_stuck',
      coalesce((select full_name from public.profiles where id = r.user_id), 'A VA') || ' has been in wrap-up over 3 minutes',
      'The call outcome is not logged yet.', '/admin/team', 'wrap:' || r.user_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end loop;

  -- d. Callbacks at the promised time (the promiser first), ahead of servicing.
  for r in select l.id, l.va_callback_at, l.va_last_worked_by from public.leads l
            where l.va_outcome = 'callback' and l.va_callback_at <= now() and l.va_callback_at > now() - interval '2 days'
              and not exists (select 1 from public.call_queue q where q.lead_id = l.id and q.kind = 'callback'
                                and (q.status in ('held', 'waiting', 'offered', 'taken') or q.due_at = l.va_callback_at)) loop
    perform public.route_enqueue('callback', r.id, p_due => r.va_callback_at, p_promiser => r.va_last_worked_by, p_offer => false);
  end loop;
  -- More than 5 minutes late: admins told once.
  for r in select q.* from public.call_queue q
            where q.kind = 'callback' and q.status in ('waiting', 'offered') and not q.late_alerted
              and q.due_at < now() - interval '5 minutes' loop
    update public.call_queue set late_alerted = true where id = r.id;
    perform public.route_notify_admins('callback_late', 'Callback late: ' || coalesce(r.name, 'a lead'),
      'Promised for ' || to_char(r.due_at at time zone 'America/Chicago', 'HH12:MI AM') || ' CT and nobody has called yet.',
      '/admin/team', 'late:' || r.id);
  end loop;

  -- e. Held items whose window opened: check again.
  for r in select * from public.call_queue where status = 'held' and hold_until is not null and hold_until <= now() loop
    select * into chk from public.predial_eval(r.phone, r.state, r.lead_id, 'call', now(), r.policy_id, r.detail ? 'help_call_sid');
    if chk.ok and public.route_desk_open() then
      update public.call_queue set status = 'waiting', ready_at = now(), hold_until = null where id = r.id;
    elsif chk.ok then
      update public.call_queue set hold_until = public.route_desk_next(), hold_reason = 'after_hours' where id = r.id;
    elsif chk.reason in ('outside_hours', 'attempt_cap') then
      update public.call_queue set hold_until = greatest(chk.next_at, now() + interval '1 minute'), hold_reason = chk.reason where id = r.id;
    else
      update public.call_queue set status = 'cancelled', cancel_reason = chk.reason where id = r.id;
    end if;
  end loop;

  -- f. Dropped calls: the VA didn't rejoin in 60 s → the next VA gets it with the notes. Nobody in another 60 s →
  --    the line is ended by fulfillment-call (Twilio) and becomes a callback.
  for r in select v.* from public.va_lines v where v.status = 'rescue' and v.rescue_until < now()
              and not exists (select 1 from public.call_queue q where q.line_id = v.id and q.kind = 'rescue') loop
    select coalesce(l.contact_name, l.business_name) into nm from public.leads l where l.id = r.lead_id;
    perform public.route_enqueue('rescue', r.lead_id, p_line => r.id, p_name => nm, p_policy => r.policy_id,
      p_detail => r.detail, p_exclude => array_remove(array[r.va_id], null), p_offer => false);
  end loop;
  for r in select q.*, v.va_id as old_va from public.call_queue q join public.va_lines v on v.id = q.line_id
            where q.kind = 'rescue' and q.status in ('waiting', 'offered') and q.ready_at < now() - interval '60 seconds'
              and v.status = 'rescue' loop
    update public.call_queue set status = 'expired', cancel_reason = 'no_va_in_time', offered_to = null where id = r.id;
    update public.va_presence set status = 'available', updated_at = now() where user_id = r.offered_to and status = 'ringing';
    update public.va_lines set status = 'ended', ended_at = now(), end_reason = 'rescue_timeout' where id = r.line_id;
    if r.lead_id is not null or r.policy_id is not null then
      perform public.route_enqueue('callback', r.lead_id, p_due => now(), p_promiser => r.old_va, p_policy => r.policy_id,
        p_name => r.name, p_detail => jsonb_build_object('from', 'dropped_call'));
    end if;
    begin
      perform public.fulfillment_cron_post('fulfillment-call', jsonb_build_object('cron', 'end_line', 'line_id', r.line_id));
    exception when others then raise warning 'end_line post: %', sqlerrm;
    end;
    ended := ended + 1;
  end loop;

  -- g. Inbound callers nobody took in 2 minutes: help-voice ends the wait and they become a callback.
  for r in select q.* from public.call_queue q
            where q.kind = 'inbound' and q.status in ('waiting', 'offered') and q.ready_at < now() - interval '2 minutes' loop
    update public.call_queue set status = 'expired', cancel_reason = 'no_va_in_time', offered_to = null where id = r.id;
    update public.va_presence set status = 'available', updated_at = now() where user_id = r.offered_to and status = 'ringing';
    perform public.route_enqueue('callback', r.lead_id, p_phone => r.phone, p_name => r.name, p_due => now(),
      p_detail => jsonb_build_object('from', 'inbound_no_answer', 'help_call_sid', r.help_call_sid));
    begin
      perform public.fulfillment_cron_post('help-voice', jsonb_build_object('cron', 'timeout', 'call', r.help_call_sid));
    exception when others then raise warning 'help timeout post: %', sqlerrm;
    end;
  end loop;

  -- h. Waiting 60 s: both admins pushed, then every 3 minutes; counted as a speed miss.
  for r in select q.* from public.call_queue q
            where q.status in ('waiting', 'offered') and q.kind in ('inbound', 'new_lead', 'callback')
              and q.ready_at < now() - interval '60 seconds'
              and (q.alerts = 0 or q.last_alert_at < now() - interval '3 minutes') loop
    update public.call_queue set alerts = alerts + 1, last_alert_at = now(),
           speed_miss = speed_miss or kind in ('inbound', 'new_lead')
     where id = r.id;
    perform public.route_notify_admins('lead_waiting',
      case r.kind when 'inbound' then 'A caller is waiting' when 'callback' then 'A callback is waiting' else 'A new lead is waiting' end
        || ': ' || coalesce(r.name, 'no name'),
      'Waiting ' || greatest(1, floor(extract(epoch from now() - r.ready_at) / 60))::int || ' min with no VA free.',
      '/admin/team', 'wait:' || r.id || ':' || (r.alerts + 1));
  end loop;

  -- i. Offer what's waiting: highest priority, then longest wait. Stops when nobody is free.
  for r in select id from public.call_queue where status = 'waiting'
            order by priority, coalesce(due_at, ready_at), ready_at loop
    if public.route_offer(r.id) is null then
      -- nobody free for this one; a lower item can't do better unless it may pull a VA off hold
      if not exists (select 1 from public.va_presence p where p.status in ('available', 'on_hold_carrier') and public.route_can_take(p)) then
        exit;
      end if;
    else
      offered := offered + 1;
    end if;
  end loop;
  return jsonb_build_object('offered', offered, 'ended', ended);
end;
$$;

-- ── 9. What the VA's portal calls ───────────────────────────────────────────────────────────────────────────────
create or replace function public.route_presence_json(p public.va_presence)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('status', p.status, 'since', p.since, 'missed_rings', p.missed_rings,
    'wrap_started_at', p.wrap_started_at, 'wrap_extra', p.wrap_extra, 'is_desk', p.is_desk,
    'paused_task', p.paused_task, 'line_id', p.line_id, 'pulled_reason', p.pulled_reason)
$$;

-- The heartbeat, every 10 s while the portal is open. p_status: 'available' | 'away' | 'offline' (null = just
-- beat). p_paused: the task a ring interrupted (kept, shown back at the top after the call); 'null' clears it.
create or replace function public.va_beat(p_status text default null, p_paused jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p   public.va_presence;
  q   public.call_queue;
  adm boolean := public.is_admin();
begin
  if uid is null or not (public.is_fulfillment() or adm) then
    raise exception 'Only Fulfillment can take calls' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('available', 'away', 'offline') then
    raise exception 'status must be available, away or offline' using errcode = '22023';
  end if;
  insert into public.va_presence (user_id, status, last_seen) values (uid, 'offline', now())
  on conflict (user_id) do update set last_seen = now(), updated_at = now();
  select * into p from public.va_presence where user_id = uid for update;

  if p_status = 'available' and p.status <> 'available' then
    if p.status in ('on_call', 'ringing', 'on_hold_carrier') then
      raise exception 'Finish the call first' using errcode = '55000';
    end if;
    if p.status = 'wrap' then raise exception 'Log the outcome first' using errcode = '55000'; end if;
    if adm and not p.is_desk then raise exception 'Turn on the desk first' using errcode = '55000'; end if;
    if not adm and not public.va_on_shift_at(uid, now()) then
      raise exception 'You are not on shift right now' using errcode = '55000';
    end if;
    update public.va_presence set status = 'available', since = now(), idle_since = now(), missed_rings = 0,
           pulled_at = null, pulled_reason = null, silent_alerted_at = null
     where user_id = uid returning * into p;
  elsif p_status in ('away', 'offline') and p.status <> p_status then
    if p.status in ('on_call', 'on_hold_carrier', 'wrap') then
      raise exception 'Finish the call first' using errcode = '55000';
    end if;
    for q in select * from public.call_queue where status = 'offered' and offered_to = uid loop
      perform public.route_missed(q.id, false);
    end loop;
    update public.va_presence set status = p_status, since = now() where user_id = uid returning * into p;
  end if;
  if p_paused is not null then
    update public.va_presence set paused_task = case when p_paused = 'null'::jsonb then null else p_paused end
     where user_id = uid returning * into p;
  end if;

  perform public.route_tick();
  select * into p from public.va_presence where user_id = uid;
  select * into q from public.call_queue where status = 'offered' and offered_to = uid order by offered_at desc limit 1;
  return jsonb_build_object(
    'presence', public.route_presence_json(p),
    'offer', case when q.id is null then null else jsonb_build_object(
      'id', q.id, 'kind', q.kind, 'lead_id', q.lead_id, 'policy_id', q.policy_id, 'help_call_sid', q.help_call_sid,
      'line_id', q.line_id, 'name', q.name, 'state', q.state, 'phone_last4', right(q.phone, 4),
      'offered_at', q.offered_at, 'expires_at', q.offer_expires_at, 'pull_hold', q.pull_hold, 'detail', q.detail) end,
    'waiting', (select count(*) from public.call_queue where status in ('waiting', 'offered')),
    'oldest_wait_at', (select min(ready_at) from public.call_queue where status in ('waiting', 'offered')),
    'server_now', now());
end;
$$;

-- Answer: the item becomes this VA's line. The browser then joins with { line_id }.
create or replace function public.route_accept(p_item uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  q    public.call_queue;
  me   public.va_presence;
  ln   uuid;
  held public.va_lines;
begin
  if uid is null or not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take calls' using errcode = '42501';
  end if;
  update public.call_queue set status = 'taken', taken_by = uid, taken_at = now()
   where id = p_item and status = 'offered' and offered_to = uid and offer_expires_at > now() - interval '3 seconds'
   returning * into q;
  if q.id is null then raise exception 'This call went to someone else' using errcode = '55006'; end if;
  select * into me from public.va_presence where user_id = uid for update;

  -- Pulled off a carrier hold: that hold goes to the next free VA (no client was on it).
  if q.pull_hold and me.line_id is not null then
    update public.va_lines set status = 'handoff', va_id = null where id = me.line_id and status in ('live', 'open')
    returning * into held;
    if held.id is not null then
      perform public.route_enqueue('hold_handoff', held.lead_id, p_line => held.id, p_policy => held.policy_id,
        p_detail => held.detail || jsonb_build_object('reason', 'pulled_for_new_lead', 'from', uid),
        p_exclude => array[uid]);
    end if;
  end if;

  if q.kind in ('hold_handoff', 'rescue') and q.line_id is not null then
    update public.va_lines set va_id = uid, status = 'open', queue_item = q.id
     where id = q.line_id and status <> 'ended' returning id into ln;
    if ln is null then raise exception 'That call has already ended' using errcode = '55000'; end if;
  else
    insert into public.va_lines (kind, conference, lead_id, policy_id, help_call_sid, va_id, queue_item, detail)
    values (case when q.kind = 'inbound' then 'inbound' else 'lead' end,
            case when q.kind = 'inbound' then 'help-' || q.help_call_sid end,
            q.lead_id, q.policy_id, q.help_call_sid, uid, q.id, q.detail)
    returning id into ln;
    update public.call_queue set line_id = ln where id = q.id;
    if q.lead_id is not null then
      update public.leads set va_claimed_by = uid, va_claim_expires_at = now() + interval '15 minutes' where id = q.lead_id;
    end if;
  end if;

  update public.va_presence set status = 'on_call', since = now(), line_id = ln, missed_rings = 0, updated_at = now()
   where user_id = uid;
  return jsonb_build_object('line_id', ln, 'kind', q.kind, 'lead_id', q.lead_id, 'policy_id', q.policy_id,
    'help_call_sid', q.help_call_sid, 'detail', q.detail);
end;
$$;

-- Not now: a counted miss.
create or replace function public.route_pass(p_item uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.va_presence;
begin
  if uid is null or not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take calls' using errcode = '42501';
  end if;
  if not exists (select 1 from public.call_queue where id = p_item and status = 'offered' and offered_to = uid) then
    raise exception 'That call is not ringing for you' using errcode = '55000';
  end if;
  perform public.route_missed(p_item, true);
  perform public.route_tick();
  select * into p from public.va_presence where user_id = uid;
  return public.route_presence_json(p);
end;
$$;

-- Wrap-up: the outcome is required before Available. 60 s, then +60 s at a time (counted).
create or replace function public.va_wrap_done(p_outcome text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.va_presence;
begin
  if uid is null or not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take calls' using errcode = '42501';
  end if;
  if coalesce(trim(p_outcome), '') = '' then raise exception 'Pick how the call went first' using errcode = '22023'; end if;
  update public.va_presence
     set status = 'available', since = now(), idle_since = now(), wrap_started_at = null, wrap_alerted_at = null, line_id = null
   where user_id = uid and status = 'wrap' returning * into p;
  if p.user_id is null then raise exception 'You are not in wrap-up' using errcode = '55000'; end if;
  update public.presence_log set detail = detail || jsonb_build_object('outcome', left(p_outcome, 60))
   where user_id = uid and ended_at is not null and status = 'wrap'
     and id = (select max(id) from public.presence_log where user_id = uid and status = 'wrap');
  perform public.route_tick();
  return public.route_presence_json(p);
end;
$$;

create or replace function public.va_wrap_more()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.va_presence;
begin
  if uid is null or not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take calls' using errcode = '42501';
  end if;
  update public.va_presence set wrap_extra = wrap_extra + 1 where user_id = uid and status = 'wrap' returning * into p;
  if p.user_id is null then raise exception 'You are not in wrap-up' using errcode = '55000'; end if;
  return public.route_presence_json(p);
end;
$$;

-- Admins go Available as the desk and get routing; desk time is logged (presence_log.is_desk) apart from VA pay.
create or replace function public.admin_set_desk(p_on boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.va_presence;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  insert into public.va_presence (user_id, status, is_desk, last_seen, idle_since)
  values (uid, case when p_on then 'available' else 'offline' end, coalesce(p_on, false), now(), now())
  on conflict (user_id) do update
    set is_desk = coalesce(p_on, false), last_seen = now(),
        status = case when va_presence.status in ('on_call', 'wrap', 'on_hold_carrier') then va_presence.status
                      when p_on then 'available' else 'offline' end,
        idle_since = case when p_on then now() else va_presence.idle_since end, since = now()
  returning * into p;
  if p_on then perform public.route_tick(); end if;
  return public.route_presence_json(p);
end;
$$;

-- One tap on the call screen: opted out of calls and texts everywhere, in one transaction.
create or replace function public.mark_do_not_call(p_phone text default null, p_lead uuid default null,
  p_policy uuid default null, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  e     text;
  calls int;
  texts int;
  leads_ uuid[];
begin
  if uid is null or not (public.is_fulfillment() or public.is_admin()) then
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
  -- Texts and GoHighLevel: the opt-out list (230's trigger sends it to GoHighLevel, as DND).
  perform public.sms_set_opt(e, true, 'do_not_call');
  update public.leads set va_callback_at = null where id = any(leads_) and va_outcome = 'callback';
  insert into public.inbound_events (lead_id, kind, state, label, detail, actor_id, actor_role)
  select id, 'note', 'done', 'Do not call: opted out of calls and texts', jsonb_build_object('do_not_call', true), uid,
         case when public.is_admin() then 'admin' else 'fulfillment' end
    from unnest(leads_) as id;
  return jsonb_build_object('phone_last4', right(e, 4), 'cancelled_calls', calls, 'cancelled_texts', texts);
end;
$$;

-- Need help on a call: both admins pushed; they listen, whisper or join from the push.
create or replace function public.va_need_help(p_line uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); v public.va_lines;
begin
  select * into v from public.va_lines where id = p_line;
  if v.id is null or v.va_id is distinct from uid then raise exception 'Not your call' using errcode = '42501'; end if;
  perform public.route_notify_admins('va_needs_help',
    coalesce((select full_name from public.profiles where id = uid), 'A VA') || ' needs help on a call',
    'Listen, whisper or join.', '/admin/team?line=' || p_line, 'help:' || p_line || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
end;
$$;

-- Shift-end carrier hold with nobody on shift to take it: ask the admins to approve staying on.
create or replace function public.va_overtime_request(p_line uuid, p_minutes int default 30)
returns void language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); v public.va_lines;
begin
  select * into v from public.va_lines where id = p_line;
  if v.id is null or v.va_id is distinct from uid then raise exception 'Not your call' using errcode = '42501'; end if;
  perform public.route_notify_admins('overtime_request',
    coalesce((select full_name from public.profiles where id = uid), 'A VA') || ' asks to stay on a carrier hold',
    'Up to ' || greatest(5, least(coalesce(p_minutes, 30), 120)) || ' more minutes past their shift.',
    '/admin/team?line=' || p_line, 'ot:' || p_line);
end;
$$;

-- ── 10. What the edge functions call (service role only) ──────────────────────────────────────────────────────
-- fulfillment-call: a VA opens a line from a task (no free dialing: a lead they hold, or a policy assigned to them).
create or replace function public.line_open(p_va uuid, p_lead uuid, p_policy uuid, p_kind text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare ln uuid; adm boolean; p public.va_presence;
begin
  select role::text = 'admin' into adm from public.profiles where id = p_va;
  if p_lead is null and p_policy is null then raise exception 'A call starts from a task' using errcode = '22023'; end if;
  select * into p from public.va_presence where user_id = p_va;
  if p.status = 'wrap' then raise exception 'Log the last call''s outcome first' using errcode = '55000'; end if;
  if p.status = 'ringing' then raise exception 'A call is ringing for you: answer it or press Not now' using errcode = '55000'; end if;
  if p.status in ('on_call', 'on_hold_carrier') and exists (
       select 1 from public.va_lines v where v.id = p.line_id and v.status in ('open', 'live', 'rescue')) then
    raise exception 'You are already on a call' using errcode = '55000';
  end if;
  if p_lead is not null and not coalesce(adm, false) and not exists (
       select 1 from public.leads l where l.id = p_lead
          and ((l.va_claimed_by = p_va and l.va_claim_expires_at > now()) or l.va_last_worked_by = p_va)) then
    raise exception 'Take this lead from your queue first' using errcode = '42501';
  end if;
  if p_policy is not null and p_lead is null and not coalesce(adm, false) and not exists (
       select 1 from public.policies p where p.id = p_policy and p.assigned_fulfillment_id = p_va) then
    raise exception 'This client is assigned to another VA' using errcode = '42501';
  end if;
  insert into public.va_lines (kind, lead_id, policy_id, va_id)
  values (coalesce(p_kind, case when p_lead is not null then 'lead' else 'servicing' end), p_lead, p_policy, p_va)
  returning id into ln;
  insert into public.va_presence (user_id, status, line_id, last_seen) values (p_va, 'on_call', ln, now())
  on conflict (user_id) do update set status = 'on_call', since = now(), line_id = ln;
  return ln;
end;
$$;

-- fulfillment-voice: the VA's browser joined (or rejoined after a drop).
create or replace function public.line_va_joined(p_line uuid, p_va uuid, p_call_sid text)
returns public.va_lines language plpgsql volatile security definer set search_path = public as $$
declare v public.va_lines;
begin
  update public.va_lines set status = 'live', va_call_sid = p_call_sid, live_at = coalesce(live_at, now()), rescue_until = null
   where id = p_line and va_id = p_va and status in ('open', 'live', 'rescue') returning * into v;
  if v.id is not null then
    -- A rescue item for this line is no longer needed once the original VA is back.
    update public.call_queue set status = 'done' where line_id = p_line and kind = 'rescue' and status in ('waiting', 'offered');
    update public.va_presence set status = 'on_call', line_id = p_line, updated_at = now() where user_id = p_va;
  end if;
  return v;
end;
$$;

-- fulfillment-voice: the VA's leg left without End: the others stay on the line with a hold message, and the
-- VA has 60 s to come back. Returns true when the rescue started.
create or replace function public.line_va_left(p_line uuid, p_call_sid text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v public.va_lines;
begin
  update public.va_lines set status = 'rescue', rescue_until = now() + interval '60 seconds'
   where id = p_line and status = 'live' and va_call_sid = p_call_sid returning * into v;
  return v.id is not null;
end;
$$;

-- The line is over (End for everyone, the conference ended, or the rescue ran out): the VA goes to wrap-up.
create or replace function public.line_ended(p_line uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v public.va_lines;
begin
  update public.va_lines set status = 'ended', ended_at = now(), end_reason = coalesce(end_reason, p_reason)
   where id = p_line and status <> 'ended' returning * into v;
  if v.id is null then return; end if;
  update public.call_queue set status = 'done' where line_id = p_line and status = 'taken';
  if v.va_id is not null then
    update public.va_presence set status = 'wrap', since = now(), wrap_started_at = now(), wrap_extra = 0, wrap_alerted_at = null
     where user_id = v.va_id and line_id = p_line and status in ('on_call', 'on_hold_carrier');
  end if;
end;
$$;

-- fulfillment-call / fulfillment-voice, after any leg change: only a carrier on the line (no client, lead or
-- agent) = "on a carrier hold with no client", which a new lead may pull the VA off (route_offer).
create or replace function public.line_hold_state(p_line uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare carrier_only boolean;
begin
  select bool_or(party = 'carrier') and not bool_or(party <> 'carrier') into carrier_only
    from public.fulfillment_voice_legs where line_id = p_line and status = 'live';
  update public.va_presence p set status = case when coalesce(carrier_only, false) then 'on_hold_carrier' else 'on_call' end,
         updated_at = now()
    from public.va_lines v
   where v.id = p_line and p.user_id = v.va_id and p.line_id = p_line and p.status in ('on_call', 'on_hold_carrier');
end;
$$;

-- fulfillment-call "Re-queue": nobody to hand the hold to and no overtime. The call ends; the client gets a
-- callback when the desk next opens (the automatic text is the engine's).
create or replace function public.line_requeue(p_line uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v public.va_lines;
begin
  select * into v from public.va_lines where id = p_line;
  if v.id is null then return; end if;
  perform public.line_ended(p_line, 'requeued');
  if v.lead_id is not null or v.policy_id is not null then
    perform public.route_enqueue('callback', v.lead_id, p_policy => v.policy_id, p_due => public.route_desk_next(now() + interval '1 minute'),
      p_promiser => v.va_id, p_detail => v.detail || jsonb_build_object('from', 'shift_end_requeue'), p_offer => false);
  end if;
end;
$$;

-- fulfillment-call: hand a carrier hold to the next on-shift VA (shift end, or by choice). 'queued' when another
-- VA is on shift now (they get it when free), 'no_one' when nobody is: the VA asks for overtime or re-queues.
create or replace function public.line_handoff(p_line uuid, p_va uuid, p_detail jsonb)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v public.va_lines;
begin
  select * into v from public.va_lines where id = p_line and va_id = p_va and status in ('open', 'live');
  if v.id is null then raise exception 'Not your call' using errcode = '42501'; end if;
  if not exists (select 1 from public.va_presence p
                  where p.user_id <> p_va and p.status in ('available', 'on_call', 'wrap', 'ringing', 'on_hold_carrier')
                    and public.route_can_take(p)) then
    return 'no_one';
  end if;
  update public.va_lines set status = 'handoff', va_id = null, detail = detail || coalesce(p_detail, '{}'::jsonb) where id = p_line;
  perform public.route_enqueue('hold_handoff', v.lead_id, p_line => p_line, p_policy => v.policy_id,
    p_detail => v.detail || coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('from', p_va), p_exclude => array[p_va]);
  update public.va_presence set status = 'available', since = now(), idle_since = now(), line_id = null
   where user_id = p_va and line_id = p_line;
  return 'queued';
end;
$$;

-- help-voice: someone called in. Links the lead (their consent is the call), queues them to ring one VA.
create or replace function public.route_inbound(p_call_sid text, p_caller text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare lead uuid := public.lead_sms_match(p_caller); q uuid; nm text; st text;
begin
  if lead is not null then
    update public.leads set call_consent_at = coalesce(call_consent_at, now()) where id = lead
    returning coalesce(contact_name, business_name), state into nm, st;
    update public.help_calls set lead_id = lead where call_sid = p_call_sid and lead_id is null;
  end if;
  q := public.route_enqueue('inbound', lead, p_phone => p_caller, p_state => st, p_name => coalesce(nm, 'Caller ending ' || right(public.sms_e164(p_caller), 4)),
                            p_help_sid => p_call_sid);
  return jsonb_build_object('queue_id', q, 'lead_id', lead,
    'offered', (select offered_to is not null from public.call_queue where id = q));
end;
$$;

-- help-voice: the caller hung up before a VA took them.
create or replace function public.route_inbound_gone(p_call_sid text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  for r in select id, offered_to from public.call_queue where help_call_sid = p_call_sid and status in ('waiting', 'offered', 'held') loop
    update public.va_presence set status = 'available', updated_at = now() where user_id = r.offered_to and status = 'ringing';
  end loop;
  update public.call_queue set status = 'cancelled', cancel_reason = 'caller_hung_up', offered_to = null
   where help_call_sid = p_call_sid and status in ('waiting', 'offered', 'held');
end;
$$;

-- help-voice after hours (Q15/16): the caller heard the greeting; a VA calls them when the desk opens.
create or replace function public.route_after_hours_call(p_call_sid text, p_caller text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare lead uuid := public.lead_sms_match(p_caller); q uuid;
begin
  if lead is not null then
    update public.leads set call_consent_at = coalesce(call_consent_at, now()) where id = lead;
    update public.help_calls set lead_id = lead where call_sid = p_call_sid and lead_id is null;
  end if;
  q := public.route_enqueue('callback', lead, p_phone => p_caller, p_due => public.route_desk_next(),
    p_name => case when lead is null then 'Caller ending ' || right(public.sms_e164(p_caller), 4) end,
    p_detail => jsonb_build_object('from', 'after_hours_call', 'help_call_sid', p_call_sid));
  return q;
end;
$$;

-- ── 11. Admin: state rules ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_state_rule(p_state text, p_start time, p_end time, p_sun_start time default null,
  p_sun_end time default null, p_cap int default null, p_recording text default null, p_reviewed boolean default null,
  p_notes text default null)
returns public.state_call_rules language plpgsql volatile security definer set search_path = public as $$
declare r public.state_call_rules;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.state_call_rules
     set call_start = coalesce(p_start, call_start), call_end = coalesce(p_end, call_end),
         sun_start = p_sun_start, sun_end = p_sun_end, max_attempts_24h = p_cap,
         recording_party = coalesce(p_recording, recording_party),
         counsel_reviewed = coalesce(p_reviewed, counsel_reviewed),
         reviewed_at = case when p_reviewed then now() when p_reviewed = false then null else reviewed_at end,
         notes = coalesce(p_notes, notes), updated_by = auth.uid(), updated_at = now()
   where state = upper(trim(p_state)) returning * into r;
  if r.state is null then raise exception 'Unknown state %', p_state using errcode = 'P0002'; end if;
  return r;
end;
$$;

-- ── 12. Grants ──────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.call_window_ok(public.state_call_rules, timestamptz)', 'public.call_window_next(public.state_call_rules, timestamptz)',
    'public.predial_eval(text, text, uuid, text, timestamptz, uuid, boolean)',
    'public.predial_log_attempt(text, uuid, uuid, uuid, uuid)', 'public.route_notify_admins(text, text, text, text, text)',
    'public.route_can_take(public.va_presence, timestamptz)', 'public.route_offer(uuid)', 'public.route_missed(uuid, boolean)',
    'public.route_enqueue(text, uuid, text, text, text, text, uuid, timestamptz, uuid, jsonb, uuid[], uuid, boolean)',
    'public.route_cancel_phone(text, uuid, text)', 'public.route_tick()',
    'public.line_open(uuid, uuid, uuid, text)', 'public.line_va_joined(uuid, uuid, text)', 'public.line_va_left(uuid, text)',
    'public.line_ended(uuid, text)', 'public.line_hold_state(uuid)', 'public.line_requeue(uuid)', 'public.line_handoff(uuid, uuid, jsonb)',
    'public.route_inbound(text, text)', 'public.route_inbound_gone(text)', 'public.route_after_hours_call(text, text)',
    'public.route_new_lead()', 'public.route_opt_out_sync()', 'public.presence_log_row()', 'public.line_conference_name()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.predial_check(text, text, uuid, text, timestamptz, uuid)', 'public.va_beat(text, jsonb)', 'public.route_accept(uuid)',
    'public.route_pass(uuid)', 'public.va_wrap_done(text)', 'public.va_wrap_more()', 'public.admin_set_desk(boolean)',
    'public.mark_do_not_call(text, uuid, uuid, text)', 'public.va_need_help(uuid)', 'public.va_overtime_request(uuid, integer)',
    'public.admin_set_state_rule(text, time, time, time, time, integer, text, boolean, text)',
    'public.route_presence_json(public.va_presence)', 'public.route_desk_open(timestamptz)', 'public.route_desk_next(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ── 13. The sweep every 10 seconds (pg_cron 1.5+ takes "N seconds") ────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('route-tick', '10 seconds', 'select public.route_tick()');
  end if;
end $$;
