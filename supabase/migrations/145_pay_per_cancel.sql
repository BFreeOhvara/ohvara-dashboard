-- Prompt 764 — Fulfillment pay per verified cancel.
--
-- Reps are no longer paid by the hour. Each cancel a rep logs (the result
-- Cancelled, i.e. fulfillment_stage → Complete) is one row here, worth the pay
-- rate at the moment it was logged ($10 by default). A cancel is "verified"
-- when the call recording shows the carrier confirming it (AI, edge function
-- fulfillment-cancel-check) or when Brayden listens and says pay it. Verified
-- cancels are paid automatically every Monday 8 AM Central (edge function
-- fulfillment-pay-week, called by pg_cron); nobody approves.
--
--   recovery_config            recording_live (off), recording_notice,
--                              pay_per_cancel_cents (1000), weekly_min_cents
--                              (null = off), weekly_cancel_cap (40),
--                              payouts_paused (off)
--   fulfillment_recordings     one row per recorded call (the rep's browser
--                              leg). Admin-only. Audio stays at Twilio.
--   fulfillment_cancels        one row per cancel (one active per policy).
--                              Rep reads their own; nobody writes except the
--                              functions below.
--   fulfillment_cancel_checks  the AI check: transcript, quote, raw answer.
--                              Admin-only.
--   fulfillment_cancel_events  append-only audit of every status change.
--   fulfillment_pay_runs       one row per Monday pay run, with its totals.
--
-- Hours: fulfillment_pay shifts, fulfillment_hour_fixes and their data stay;
-- they no longer feed pay.

-- ── settings ────────────────────────────────────────────────────────────────
alter table public.recovery_config
  add column if not exists recording_live boolean not null default false,
  add column if not exists recording_notice text not null default 'This call may be recorded.',
  add column if not exists pay_per_cancel_cents integer not null default 1000,
  add column if not exists weekly_min_cents integer,
  add column if not exists weekly_cancel_cap integer not null default 40,
  add column if not exists payouts_paused boolean not null default false;
alter table public.recovery_config drop constraint if exists recovery_config_p764_check;
alter table public.recovery_config add constraint recovery_config_p764_check check (
  length(btrim(recording_notice)) between 3 and 300
  and pay_per_cancel_cents between 0 and 100000
  and (weekly_min_cents is null or weekly_min_cents between 1 and 1000000)
  and weekly_cancel_cap between 1 and 1000
);
grant update (recording_live, recording_notice, pay_per_cancel_cents, weekly_min_cents, weekly_cancel_cap, payouts_paused)
  on public.recovery_config to authenticated;

-- The recording notice plays once per outside leg.
alter table public.fulfillment_voice_legs add column if not exists notice_at timestamptz;

-- ── recordings ──────────────────────────────────────────────────────────────
create table if not exists public.fulfillment_recordings (
  id                uuid primary key default gen_random_uuid(),
  call_sid          text not null unique,     -- the rep's browser leg that joined
  policy_id         uuid not null references public.policies(id) on delete cascade,
  rep_id            uuid references public.profiles(id) on delete set null,
  conference_sid    text,
  recording_sid     text unique,
  status            text not null default 'recording' check (status in ('recording', 'ready', 'failed')),
  duration_seconds  integer,
  error             text,
  created_at        timestamptz not null default now(),
  ready_at          timestamptz
);
create index if not exists fulfillment_recordings_policy_idx on public.fulfillment_recordings (policy_id, created_at desc);
alter table public.fulfillment_recordings enable row level security;
drop policy if exists frec_admin_select on public.fulfillment_recordings;
create policy frec_admin_select on public.fulfillment_recordings for select using (public.is_admin());
revoke all on public.fulfillment_recordings from anon, authenticated;
grant select on public.fulfillment_recordings to authenticated;

-- ── cancels ─────────────────────────────────────────────────────────────────
create table if not exists public.fulfillment_cancels (
  id                 uuid primary key default gen_random_uuid(),
  policy_id          uuid references public.policies(id) on delete set null,
  rep_id             uuid references public.profiles(id) on delete set null,
  agent_id           uuid references public.profiles(id) on delete set null,
  client_name        text,
  carrier_name       text,
  agent_name         text,
  logged_at          timestamptz not null default now(),
  week_start         date not null check (extract(isodow from week_start) = 1),  -- the rep's Monday
  amount_cents       integer not null check (amount_cents >= 0),
  status             text not null default 'checking'
                       check (status in ('checking', 'needs_listen', 'verified', 'verified_by_admin', 'not_paid', 'void')),
  reason             text check (reason in ('no_recording', 'unclear', 'stt_error', 'ai_error', 'refused', 'agent_flag', 'over_cap')),
  listen_at_seconds  numeric(8,1),            -- where to listen (AI's best guess)
  recording_id       uuid references public.fulfillment_recordings(id) on delete set null,
  verified_at        timestamptz,
  decided_by         uuid references public.profiles(id) on delete set null,
  decided_at         timestamptz,
  decision_note      text,
  check_attempts     integer not null default 0,
  check_started_at   timestamptz,
  next_check_at      timestamptz,
  payout_id          uuid references public.fulfillment_payouts(id) on delete set null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (paid_at is null or payout_id is not null)
);
create unique index if not exists fulfillment_cancels_one_active on public.fulfillment_cancels (policy_id) where status <> 'void';
create index if not exists fulfillment_cancels_rep_week on public.fulfillment_cancels (rep_id, week_start desc);
create index if not exists fulfillment_cancels_checking on public.fulfillment_cancels (logged_at) where status = 'checking';
create index if not exists fulfillment_cancels_payout on public.fulfillment_cancels (payout_id) where payout_id is not null;

alter table public.fulfillment_cancels enable row level security;
drop policy if exists fc_select on public.fulfillment_cancels;
create policy fc_select on public.fulfillment_cancels for select using (rep_id = auth.uid() or public.is_admin());
-- No insert / update / delete for anyone: the trigger and functions below
-- (security definer) are the only writers. A rep can't change their own status.
revoke all on public.fulfillment_cancels from anon, authenticated;
grant select on public.fulfillment_cancels to authenticated;

create table if not exists public.fulfillment_cancel_checks (
  id             uuid primary key default gen_random_uuid(),
  cancel_id      uuid not null references public.fulfillment_cancels(id) on delete cascade,
  recording_id   uuid references public.fulfillment_recordings(id) on delete set null,
  stt_provider   text,
  transcript     text,
  ai_model       text,
  ai_raw         text,
  confirmed      boolean,
  quote          text,
  at_seconds     numeric(8,1),
  reason         text,
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists fulfillment_cancel_checks_cancel on public.fulfillment_cancel_checks (cancel_id, created_at desc);
alter table public.fulfillment_cancel_checks enable row level security;
drop policy if exists fcc_admin_select on public.fulfillment_cancel_checks;
create policy fcc_admin_select on public.fulfillment_cancel_checks for select using (public.is_admin());
revoke all on public.fulfillment_cancel_checks from anon, authenticated;
grant select on public.fulfillment_cancel_checks to authenticated;

create table if not exists public.fulfillment_cancel_events (
  id           uuid primary key default gen_random_uuid(),
  cancel_id    uuid not null references public.fulfillment_cancels(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  reason       text,
  note         text,
  actor        uuid references public.profiles(id) on delete set null,
  at           timestamptz not null default clock_timestamp()
);
create index if not exists fulfillment_cancel_events_cancel on public.fulfillment_cancel_events (cancel_id, at);
alter table public.fulfillment_cancel_events enable row level security;
drop policy if exists fce_admin_select on public.fulfillment_cancel_events;
create policy fce_admin_select on public.fulfillment_cancel_events for select using (public.is_admin());
revoke all on public.fulfillment_cancel_events from anon, authenticated;
grant select on public.fulfillment_cancel_events to authenticated;

-- ── pay runs + payout rows ──────────────────────────────────────────────────
create table if not exists public.fulfillment_pay_runs (
  id             uuid primary key default gen_random_uuid(),
  pay_date       date not null unique check (extract(isodow from pay_date) = 1),
  period_start   date not null,
  status         text not null default 'running'
                   check (status in ('running', 'done', 'off', 'paused', 'short_balance', 'error')),
  attempts       integer not null default 1,
  reps           integer not null default 0,
  paid_reps      integer not null default 0,
  held_reps      integer not null default 0,
  failed_reps    integer not null default 0,
  cancels        integer not null default 0,
  paid_cents     bigint not null default 0,
  held_cents     bigint not null default 0,
  failed_cents   bigint not null default 0,
  needed_cents   bigint,
  balance_cents  bigint,
  note           text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.fulfillment_pay_runs enable row level security;
drop policy if exists fpr_admin_select on public.fulfillment_pay_runs;
create policy fpr_admin_select on public.fulfillment_pay_runs for select using (public.is_admin());
revoke all on public.fulfillment_pay_runs from anon, authenticated;
grant select on public.fulfillment_pay_runs to authenticated;

alter table public.fulfillment_payouts
  add column if not exists cancels integer not null default 0,
  add column if not exists topup_cents integer not null default 0,
  add column if not exists run_id uuid references public.fulfillment_pay_runs(id) on delete set null;

-- Nobody approves any more, and payouts are written only by the pay run
-- (service role). Admin keeps read.
drop policy if exists fp_admin_insert on public.fulfillment_payouts;
drop policy if exists fp_admin_update on public.fulfillment_payouts;
drop policy if exists fp_admin_delete on public.fulfillment_payouts;
revoke insert, update, delete on public.fulfillment_payouts from authenticated;

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.fulfillment_rep_tz(p_rep uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from profiles where id = p_rep), 'America/Chicago')
$$;

-- A cancel counts as paid (or being paid) once its payout is sending or paid.
create or replace function public.fulfillment_cancel_locked(c public.fulfillment_cancels)
returns boolean language sql stable security definer set search_path = public as $$
  select c.paid_at is not null or exists (
    select 1 from fulfillment_payouts p where p.id = c.payout_id and p.status in ('approved', 'paid'))
$$;

-- Every status change (and the first insert) writes one audit row. The note
-- comes from the function that made the change (set_config, this transaction).
create or replace function public.fulfillment_cancels_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and coalesce(current_setting('ohvara.cancel_note', true), '') = '' then
    new.updated_at := now();
    return new;
  end if;
  insert into fulfillment_cancel_events (cancel_id, from_status, to_status, reason, note, actor)
  values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.reason,
          nullif(current_setting('ohvara.cancel_note', true), ''), auth.uid());
  perform set_config('ohvara.cancel_note', '', true);
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;

-- A paid (or sending) cancel's status and amount never change.
create or replace function public.fulfillment_cancels_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status or new.amount_cents is distinct from old.amount_cents)
     and public.fulfillment_cancel_locked(old) then
    raise exception 'This cancel is already paid, so it can''t change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_cancels_guard on public.fulfillment_cancels;
create trigger fulfillment_cancels_guard before update on public.fulfillment_cancels
  for each row execute function public.fulfillment_cancels_guard();
-- BEFORE so the event row and updated_at land in the same write; the insert
-- event is written AFTER (the row must exist for the foreign key).
drop trigger if exists fulfillment_cancels_audit_upd on public.fulfillment_cancels;
create trigger fulfillment_cancels_audit_upd before update on public.fulfillment_cancels
  for each row execute function public.fulfillment_cancels_audit();
drop trigger if exists fulfillment_cancels_audit_ins on public.fulfillment_cancels;
create trigger fulfillment_cancels_audit_ins after insert on public.fulfillment_cancels
  for each row execute function public.fulfillment_cancels_audit();

-- ── a cancel per Cancelled result ───────────────────────────────────────────
-- Fires on every path that saves the result: the pop-up phone's Save, Mark
-- cancelled, and fulfillment_correct_result (both directions).
create or replace function public.fulfillment_cancel_on_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c        fulfillment_cancels;
  v_tz     text;
  v_rate   integer;
  v_carrier text;
  v_agent  text;
  v_rec    boolean;
begin
  if new.fulfillment_stage is not distinct from old.fulfillment_stage or not coalesce(new.fulfillment_assigned, false) then
    return new;
  end if;

  if new.fulfillment_stage = 'Complete' then
    if new.assigned_fulfillment_id is null then return new; end if;
    -- Already has one (e.g. a paid cancel whose result went back and forth).
    if exists (select 1 from fulfillment_cancels where policy_id = new.id and status <> 'void') then
      return new;
    end if;
    v_tz := public.fulfillment_rep_tz(new.assigned_fulfillment_id);
    select pay_per_cancel_cents into v_rate from recovery_config limit 1;
    select nullif(btrim(d.current_carrier), '') into v_carrier from policy_fulfillment_details d where d.policy_id = new.id;
    select full_name into v_agent from profiles where id = new.agent_id;
    -- A recorded call on this cancellation in the last 6 hours.
    v_rec := exists (
      select 1 from fulfillment_recordings r
       where r.policy_id = new.id and r.status in ('recording', 'ready') and r.created_at > now() - interval '6 hours');
    insert into fulfillment_cancels (policy_id, rep_id, agent_id, client_name, carrier_name, agent_name,
                                     week_start, amount_cents, status, reason)
    values (new.id, new.assigned_fulfillment_id, new.agent_id,
            nullif(btrim(coalesce(new.client_first_name, '') || ' ' || coalesce(new.client_last_name, '')), ''),
            coalesce(v_carrier, nullif(btrim(new.carrier_name), '')), v_agent,
            date_trunc('week', now() at time zone v_tz)::date, coalesce(v_rate, 1000),
            case when v_rec then 'checking' else 'needs_listen' end,
            case when v_rec then null else 'no_recording' end);
  elsif old.fulfillment_stage = 'Complete' then
    select * into c from fulfillment_cancels where policy_id = new.id and status <> 'void' for update;
    if found then
      if public.fulfillment_cancel_locked(c) then
        if not public.is_admin() then
          raise exception 'This cancel is already paid. Message Brayden to change the result.' using errcode = '42501';
        end if;
        -- Admin changed a paid one: the payment stands; keep a record.
        perform set_config('ohvara.cancel_note', 'Result changed after it was paid', true);
        update fulfillment_cancels set updated_at = now() where id = c.id;
      else
        perform set_config('ohvara.cancel_note', 'Result changed from Cancelled', true);
        update fulfillment_cancels set status = 'void', verified_at = null, payout_id = null where id = c.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists policies_fulfillment_cancel on public.policies;
create trigger policies_fulfillment_cancel after update of fulfillment_stage on public.policies
  for each row execute function public.fulfillment_cancel_on_result();

-- ── AI result (service role: fulfillment-cancel-check) ──────────────────────
-- Acts only on a cancel still being checked. confirmed → verified (or held as
-- over_cap past the weekly cap); anything else → needs_listen. Never not_paid.
create or replace function public.fulfillment_cancel_check_result(
  p_cancel uuid, p_confirmed boolean, p_reason text, p_at numeric, p_recording uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  c      fulfillment_cancels;
  v_cap  integer;
  v_n    integer;
begin
  select * into c from fulfillment_cancels where id = p_cancel for update;
  if not found or c.status <> 'checking' then return coalesce(c.status, 'missing'); end if;
  if p_confirmed then
    select weekly_cancel_cap into v_cap from recovery_config limit 1;
    select count(*) into v_n from fulfillment_cancels
     where rep_id = c.rep_id and week_start = c.week_start and id <> c.id and status in ('verified', 'verified_by_admin');
    if v_n >= coalesce(v_cap, 40) then
      perform set_config('ohvara.cancel_note', 'Over the weekly cap', true);
      update fulfillment_cancels set status = 'needs_listen', reason = 'over_cap', listen_at_seconds = p_at,
             recording_id = coalesce(p_recording, recording_id), check_started_at = null, next_check_at = null
       where id = c.id;
      return 'needs_listen';
    end if;
    update fulfillment_cancels set status = 'verified', reason = null, verified_at = now(), listen_at_seconds = p_at,
           recording_id = coalesce(p_recording, recording_id), check_started_at = null, next_check_at = null
     where id = c.id;
    return 'verified';
  end if;
  update fulfillment_cancels
     set status = 'needs_listen',
         reason = case when p_reason in ('no_recording', 'unclear', 'stt_error', 'ai_error', 'refused') then p_reason else 'unclear' end,
         listen_at_seconds = p_at, recording_id = coalesce(p_recording, recording_id),
         check_started_at = null, next_check_at = null
   where id = c.id;
  return 'needs_listen';
end;
$$;

-- ── admin decides ───────────────────────────────────────────────────────────
create or replace function public.fulfillment_decide_cancel(p_cancel uuid, p_pay boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c fulfillment_cancels;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can decide a cancel' using errcode = '42501';
  end if;
  if p_pay is null then raise exception 'Pay or don''t pay?' using errcode = '22023'; end if;
  if not p_pay and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why it isn''t paid' using errcode = '22023';
  end if;
  select * into c from fulfillment_cancels where id = p_cancel for update;
  if not found then raise exception 'Cancel not found' using errcode = 'P0002'; end if;
  if c.status = 'void' then raise exception 'That cancel was undone' using errcode = '22023'; end if;
  if public.fulfillment_cancel_locked(c) then raise exception 'That cancel is already paid' using errcode = '22023'; end if;

  perform set_config('ohvara.cancel_note', coalesce(nullif(btrim(p_note), ''), case when p_pay then 'Paid after a listen' else 'Not paid' end), true);
  update fulfillment_cancels
     set status = case when p_pay then 'verified_by_admin' else 'not_paid' end,
         verified_at = case when p_pay then now() end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), ''),
         check_started_at = null, next_check_at = null
   where id = c.id;
end;
$$;

-- ── the agent flags one ─────────────────────────────────────────────────────
-- The agent who owns the client, within 2 days of logging, before it's paid.
-- Moves it to Needs a listen even when it was verified. (Button: later prompt.)
create or replace function public.agent_flag_cancel(p_cancel uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c     fulfillment_cancels;
  v_own uuid;
  a     record;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say what looks wrong' using errcode = '22023';
  end if;
  select * into c from fulfillment_cancels where id = p_cancel for update;
  if not found then raise exception 'Cancel not found' using errcode = 'P0002'; end if;
  select agent_id into v_own from policies where id = c.policy_id;
  if auth.uid() is null or auth.uid() is distinct from coalesce(v_own, c.agent_id) then
    raise exception 'Only the client''s agent can flag this' using errcode = '42501';
  end if;
  if c.logged_at < now() - interval '2 days' then
    raise exception 'Flags close 2 days after the cancel is logged' using errcode = '22023';
  end if;
  if c.status in ('void', 'not_paid') then raise exception 'That cancel isn''t being paid' using errcode = '22023'; end if;
  if public.fulfillment_cancel_locked(c) then raise exception 'That cancel is already paid' using errcode = '22023'; end if;

  perform set_config('ohvara.cancel_note', 'Agent flag: ' || left(btrim(p_reason), 500), true);
  update fulfillment_cancels
     set status = 'needs_listen', reason = 'agent_flag', verified_at = null, check_started_at = null, next_check_at = null
   where id = c.id;

  for a in select id from profiles where role = 'admin' loop
    insert into notifications (profile_id, type, message, data)
    values (a.id, 'cancel_flagged',
            coalesce(c.client_name, 'A client') || '''s cancel was flagged by the agent. Needs a listen.',
            jsonb_build_object('cancel_id', c.id, 'policy_id', c.policy_id, 'link', '/admin/payouts'));
  end loop;
end;
$$;

-- ── pay math (server only) ──────────────────────────────────────────────────
-- What a pay run would pay one rep for the week starting p_period_start:
-- every verified cancel not yet paid or being paid that was logged before that
-- week ended (later weeks wait for their own Monday), plus the weekly minimum
-- top-up when it's on and the rep has at least one verified cancel that week.
create or replace function public.fulfillment_payable(p_rep uuid, p_period_start date)
returns table (cancel_ids uuid[], cancels integer, cancels_cents integer, week_verified integer, topup_cents integer, amount_cents integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cut timestamptz := (p_period_start + 7)::timestamp at time zone public.fulfillment_rep_tz(p_rep);
  v_min integer;
begin
  if auth.uid() is not null and p_rep is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select weekly_min_cents into v_min from recovery_config limit 1;
  select coalesce(array_agg(c.id order by c.logged_at), '{}'), count(*)::int, coalesce(sum(c.amount_cents), 0)::int,
         (count(*) filter (where c.week_start = p_period_start))::int
    into cancel_ids, cancels, cancels_cents, week_verified
    from fulfillment_cancels c
   where c.rep_id = p_rep and c.status in ('verified', 'verified_by_admin')
     and c.paid_at is null and c.logged_at < v_cut
     and not public.fulfillment_cancel_locked(c);
  topup_cents := case when v_min is not null and week_verified > 0 and cancels_cents < v_min then v_min - cancels_cents else 0 end;
  amount_cents := cancels_cents + topup_cents;
  return next;
end;
$$;

-- Kept for the old callers: same name, now the cancel figures for one week.
drop function if exists public.fulfillment_week_figures(uuid, date, timestamptz);
create function public.fulfillment_week_figures(p_rep uuid, p_start date, p_now timestamptz default now())
returns table (period_start date, period_end date, cancels integer, verified_cents integer, checking_cents integer,
               needs_listen integer, earned_cents integer, ended boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and p_rep is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if extract(isodow from p_start) <> 1 then
    raise exception 'A pay week starts on a Monday' using errcode = '22023';
  end if;
  period_start := p_start;
  period_end   := p_start + 6;
  select count(*) filter (where c.status <> 'void')::int,
         coalesce(sum(c.amount_cents) filter (where c.status in ('verified', 'verified_by_admin')), 0)::int,
         coalesce(sum(c.amount_cents) filter (where c.status = 'checking'), 0)::int,
         (count(*) filter (where c.status = 'needs_listen'))::int
    into cancels, verified_cents, checking_cents, needs_listen
    from fulfillment_cancels c where c.rep_id = p_rep and c.week_start = p_start;
  earned_cents := verified_cents + checking_cents;
  ended := p_now >= ((p_start + 7)::timestamp at time zone public.fulfillment_rep_tz(p_rep));
  return next;
end;
$$;

-- Pay weeks are no longer built from the schedule. Kept so an old page can
-- still call it.
create or replace function public.fulfillment_sync_payouts(p_rep uuid default null)
returns integer language sql stable security definer set search_path = public as $$ select 0 $$;

create or replace function public.fulfillment_fix_hours(p_rep uuid, p_start date, p_days jsonb, p_reason text)
returns table (period_start date, hours numeric, amount_cents integer, changed integer)
language plpgsql volatile security definer set search_path = public as $$
begin
  raise exception 'Pay is per cancel now, so hours don''t change pay' using errcode = 'P0001';
end;
$$;

-- ── the pay run's writes (service role: fulfillment-pay-week) ───────────────
-- Claim one rep's payout for the run: recompute, write the row as approved
-- (sending) and reserve its cancels so nothing else can pay them. A row
-- already approved (a crashed run) comes back as it is, to be resumed with the
-- same Stripe idempotency key. p_hold: the rep can't receive money yet, so the
-- row is written as held and nothing is reserved (it rolls to the next run).
create or replace function public.fulfillment_claim_payout(p_rep uuid, p_period_start date, p_run uuid, p_hold boolean default false, p_reason text default null)
returns public.fulfillment_payouts language plpgsql volatile security definer set search_path = public as $$
declare
  cur public.fulfillment_payouts;
  f   record;
begin
  select * into cur from fulfillment_payouts where rep_id = p_rep and period_start = p_period_start for update;
  if found and cur.status = 'paid' then return null; end if;
  if found and cur.status = 'approved' then return cur; end if;
  select * into f from public.fulfillment_payable(p_rep, p_period_start);
  if f.amount_cents <= 0 then return null; end if;

  insert into fulfillment_payouts as fo (rep_id, period_start, period_end, amount_cents, cancels, topup_cents, status, run_id, failure_reason)
  values (p_rep, p_period_start, p_period_start + 6, f.amount_cents, f.cancels, f.topup_cents,
          case when p_hold then 'held' else 'approved' end, p_run, case when p_hold then p_reason end)
  on conflict (rep_id, period_start) do update
     set amount_cents = excluded.amount_cents, cancels = excluded.cancels, topup_cents = excluded.topup_cents,
         status = excluded.status, run_id = excluded.run_id, failure_reason = excluded.failure_reason,
         hours = 0, rate_cents = 0
  returning * into cur;
  if not p_hold then
    update fulfillment_cancels set payout_id = cur.id where id = any (f.cancel_ids) and payout_id is null;
  end if;
  return cur;
end;
$$;

-- The transfer went through (paid) or didn't (failed: its cancels are freed
-- for the next run).
create or replace function public.fulfillment_finish_payout(p_payout uuid, p_ok boolean, p_transfer text, p_paid_to text, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_ok then
    update fulfillment_payouts set status = 'paid', stripe_transfer_id = p_transfer, paid_at = now(), paid_to = p_paid_to, failure_reason = null
     where id = p_payout;
    update fulfillment_cancels set paid_at = now() where payout_id = p_payout and paid_at is null;
  else
    update fulfillment_payouts set status = 'failed', failure_reason = p_reason where id = p_payout and status <> 'paid';
  end if;
end;
$$;

-- A payout that fails or is reversed later (transfer.reversed) frees its
-- cancels, so the next run pays them.
create or replace function public.fulfillment_payouts_release()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('failed', 'held') and old.status is distinct from new.status then
    update fulfillment_cancels set payout_id = null, paid_at = null where payout_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists fulfillment_payouts_release on public.fulfillment_payouts;
create trigger fulfillment_payouts_release after update of status on public.fulfillment_payouts
  for each row execute function public.fulfillment_payouts_release();

-- ── cron → edge functions ───────────────────────────────────────────────────
-- A random secret kept in Vault; pg_cron sends it, the functions check it with
-- fulfillment_cron_ok (service role only). It never leaves the database.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'fulfillment_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                                'fulfillment_cron_secret', 'P764: pg_cron → fulfillment-pay-week / fulfillment-cancel-check');
  end if;
end $$;

create or replace function public.fulfillment_cron_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets where name = 'fulfillment_cron_secret' and decrypted_secret = p_secret)
$$;

create or replace function public.fulfillment_cron_post(p_fn text, p_body jsonb)
returns bigint language sql volatile security definer set search_path = public as $$
  select net.http_post(
    url     := 'https://jjextitmbptoaolacocs.supabase.co/functions/v1/' || p_fn,
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-ohvara-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'fulfillment_cron_secret')),
    body    := p_body)
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function public.fulfillment_rep_tz(uuid) from public, anon;
revoke all on function public.fulfillment_cancel_locked(public.fulfillment_cancels) from public, anon;
revoke all on function public.fulfillment_cancel_check_result(uuid, boolean, text, numeric, uuid) from public, anon, authenticated;
revoke all on function public.fulfillment_decide_cancel(uuid, boolean, text) from public, anon;
revoke all on function public.agent_flag_cancel(uuid, text) from public, anon;
revoke all on function public.fulfillment_payable(uuid, date) from public, anon;
revoke all on function public.fulfillment_week_figures(uuid, date, timestamptz) from public, anon;
revoke all on function public.fulfillment_claim_payout(uuid, date, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.fulfillment_finish_payout(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.fulfillment_cron_ok(text) from public, anon, authenticated;
revoke all on function public.fulfillment_cron_post(text, jsonb) from public, anon, authenticated;
grant execute on function public.fulfillment_rep_tz(uuid) to authenticated, service_role;
grant execute on function public.fulfillment_cancel_locked(public.fulfillment_cancels) to authenticated, service_role;
grant execute on function public.fulfillment_cancel_check_result(uuid, boolean, text, numeric, uuid) to service_role;
grant execute on function public.fulfillment_decide_cancel(uuid, boolean, text) to authenticated;
grant execute on function public.agent_flag_cancel(uuid, text) to authenticated;
grant execute on function public.fulfillment_payable(uuid, date) to authenticated, service_role;
grant execute on function public.fulfillment_week_figures(uuid, date, timestamptz) to authenticated, service_role;
grant execute on function public.fulfillment_claim_payout(uuid, date, uuid, boolean, text) to service_role;
grant execute on function public.fulfillment_finish_payout(uuid, boolean, text, text, text) to service_role;
grant execute on function public.fulfillment_cron_ok(text) to service_role;

-- ── schedules ───────────────────────────────────────────────────────────────
-- Pay run: daily at 13:05 and 14:05 UTC (8:05 AM Central in summer / winter).
-- The function pays on Monday from 8 AM Central and, if a run didn't finish
-- (payouts off, paused, short balance), tries again each following day.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('fulfillment-pay-run', 'fulfillment-cancel-check');
end $$;
select cron.schedule('fulfillment-pay-run', '5 13,14 * * *',
  $$select public.fulfillment_cron_post('fulfillment-pay-week', '{"action":"run"}'::jsonb)$$);
-- AI checks: every 2 minutes, only while a cancel is waiting on one.
select cron.schedule('fulfillment-cancel-check', '*/2 * * * *',
  $$select public.fulfillment_cron_post('fulfillment-cancel-check', '{"action":"sweep"}'::jsonb)
     where exists (select 1 from public.fulfillment_cancels where status = 'checking')$$);
