-- p884_billing_engine — prepaid weekly lead spend, the pilot, membership by spend tier, and ads that stop when the
-- money stops (Prompt 884; brain/ohvara/How Ohvara Works.md "Pricing direction" + "Decisions from the P875 questions").
--
-- NOT NUMBERED, NOT APPLIED. Money code: Brayden numbers and applies it (after 176, 188, 230, p880, p881, p882).
-- Additive only: new tables, functions, triggers, notification types and cron jobs. Nothing existing is dropped or
-- rewritten. Stripe stays in test mode: the lead-spend edge function refuses any key that isn't sk_test_.
--
-- One price source (N-L-08). billing_price_book holds every price as versioned data with an effective date: the
-- membership tiers by daily spend, servicing-only, the paid daily minimum, the setup fee switch default, the grace
-- days and the card fee rate. Every version is a DRAFT until Brayden marks one final (after the pilot). Versions are
-- append-only; a new price is a new version. Superseded (kept, no longer read by new code): lead_prices (176, a
-- per-lead price), agent_billing_tiers (119, weekly booking caps), app_settings.agent_billing_weekly_cents and the
-- inbound_* settings (113/188, the old weekly retainer). src/lib/priceBook.js mirrors version 1 for sample mode.
--
-- The model (Q1, Q4, Q12, Q26, Q64):
--   * Each agent sets a daily spend per lead type (appts = booked appointments, live = live calls). 100% of it buys
--     their own leads. It is collected PREPAID WEEKLY (Monday, Central): the charge is what the week needs minus what
--     is left in the balance, so unspent money rolls into next week. A raise mid-week charges the difference for the
--     days left; a cut charges nothing and the extra rolls over.
--   * The engine (GoHighLevel, Jordan) reports delivered spend per agent, type and day. That debits the balance, but
--     never more than the balance and never more than what the agent agreed for the week; anything over is ABSORBED
--     by Ohvara (Q12) and logged. A revised day is trued up (difference only).
--   * agent_campaign_control tells the engine, per agent and type, run or stop, the daily budget and the spend cap
--     (= the funded balance for that type). Ads stop when the balance runs out and resume when it's paid; the cap means
--     the engine can't spend past the money. Pending push = pushed_at is null or < changed_at (same as P881's
--     agent_targeting_states). The engine confirms with campaign_control_confirm.
--   * Pilot agents pay only lead spend (no membership, setup or fee), plus an optional VA cost line per agent (Q64).
--     Paid agents also pay a monthly membership whose tier comes from total daily spend; a tier change applies from
--     the next bill. Setup fee: a fee, or none with a minimum term (per agent; default from the price book).
--   * Failed payment (Q4): lead spend stops at once; the membership gets grace_days (3) of grace, servicing runs
--     during the grace; after it the agent is Suspended. Bank and card numbers are never stored (Stripe only).
--
-- WHAT RUNS IN EACH BILLING STATUS (N-G-17), from billing_runs():
--   status                 ads/lead spend   pipeline leads (VA calls, bookings)   transfers   servicing   workspace
--   pilot / active         yes if funded    yes                                   yes         yes         full
--   out of money           no (stopped)     yes, leads already in                 yes         yes         full
--   lead charge failed     no (stopped)     yes                                   yes         yes         full + banner
--   past due (in grace)    no (stopped)     yes                                   yes         yes         full + banner
--   suspended (grace over) no               held for the agent, never dropped     no          paused      Billing only
--   paused (by the agent)  no               yes                                   yes         yes         full
--   waiting acceptance     as pilot         yes                                   yes         yes         full + notice
--   cancelled / left       no               held for admin                        no          no          none
--
-- Tables: billing_price_book, agent_billing_plans, agent_billing_events, agent_lead_spend, lead_spend_weeks,
--   lead_spend_ledger, lead_spend_delivered, lead_spend_charges, agent_campaign_control.
-- Agent RPCs: my_billing, lead_spend_set, lead_spend_pause, billing_accept_paid.
-- Admin RPCs: admin_price_book_save, admin_billing_pilot_set, admin_billing_va_cost_set, admin_billing_to_paid,
--   admin_billing_setup_set, admin_billing_view, admin_lead_spend_adjust.
-- Service role: lead_spend_record_delivered (858's spend feed), campaign_control_confirm (engine),
--   lead_spend_claim_charges + lead_spend_charge_result (the lead-spend function), billing_period_rolled
--   (agent-billing), lead_spend_week_open + billing_daily_sweep (cron).

do $$
begin
  if to_regclass('public.notification_types') is null then raise exception 'p884 needs 146 applied first'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,text,boolean,text,jsonb)') is null then raise exception 'p884 needs notify() (146)'; end if;
  if to_regclass('public.billing_price_book') is not null then raise exception 'p884: billing_price_book already exists'; end if;
end $$;

-- ── 1. Time: Ohvara's week is Monday to Sunday, Central ─────────────────────
-- ohvara.today lets the database tests pin the date (a session setting; nothing an app caller can set).
create or replace function public.billing_today() returns date language sql stable as $$
  select coalesce(nullif(current_setting('ohvara.today', true), '')::date, (now() at time zone 'America/Chicago')::date)
$$;
create or replace function public.billing_week_of(p_day date) returns date language sql immutable as $$
  select (p_day - (extract(isodow from p_day)::int - 1))
$$;

-- ── 2. The price book (N-L-08) ──────────────────────────────────────────────
create table public.billing_price_book (
  version         int primary key check (version > 0),
  effective_from  date not null,
  status          text not null default 'draft' check (status in ('draft', 'final')),
  book            jsonb not null check (jsonb_typeof(book) = 'object'),
  note            text check (char_length(note) <= 500),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.billing_price_book enable row level security;
revoke all on public.billing_price_book from public, anon, authenticated;
grant select on public.billing_price_book to authenticated;
create policy bpb_read on public.billing_price_book for select to authenticated using (true);
comment on table public.billing_price_book is
  'P884: every price as versioned data. Append-only; the price on a date is the newest version effective by then. Drafts until Brayden marks one final.';

insert into public.billing_price_book (version, effective_from, status, book, note) values (1, date '2026-11-01', 'draft',
  jsonb_build_object(
    'tiers', jsonb_build_array(
      jsonb_build_object('key', 'starter', 'label', 'Starter', 'from', 0,   'to', 50,  'monthly_cents', 99700),
      jsonb_build_object('key', 'growth',  'label', 'Growth',  'from', 51,  'to', 100, 'monthly_cents', 179700),
      jsonb_build_object('key', 'pro',     'label', 'Pro',     'from', 101, 'to', 200, 'monthly_cents', 349700),
      jsonb_build_object('key', 'scale',   'label', 'Scale',   'from', 201, 'to', null, 'monthly_cents', null)),
    'servicing_only_cents', 49700,
    'paid_min_daily_cents', 5000,
    'setup', jsonb_build_object('mode', 'fee', 'fee_cents', 29700, 'min_months', 3),
    'grace_days', 3,
    'card_fee_rate', 0.03,
    'low_days', 2),
  'Draft prices from How Ohvara Works, Nov 7. Not final.');

create or replace function public.billing_price_book_block_change() returns trigger language plpgsql as $$
begin
  -- Marking a draft final is the one allowed change (status only).
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'final'
     and new.book = old.book and new.effective_from = old.effective_from and new.version = old.version then
    return new;
  end if;
  raise exception 'billing_price_book is append-only: save a new version' using errcode = '42501';
end; $$;
create trigger billing_price_book_block before update or delete on public.billing_price_book
  for each row execute function public.billing_price_book_block_change();

create or replace function public.price_book(p_on date default null) returns jsonb language sql stable security definer
set search_path = public as $$
  select b.book || jsonb_build_object('version', b.version, 'effective_from', b.effective_from, 'status', b.status)
    from billing_price_book b
   where b.effective_from <= coalesce(p_on, billing_today())
   order by b.effective_from desc, b.version desc limit 1
$$;

-- The tier for a total daily spend (whole dollars, as the Billing page rounds).
create or replace function public.billing_tier_for(p_daily_cents int, p_on date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select t || jsonb_build_object('version', (price_book(p_on)->>'version')::int)
    from jsonb_array_elements(price_book(p_on)->'tiers') t
   where round(greatest(p_daily_cents, 0) / 100.0) >= (t->>'from')::numeric
     and (t->'to' = 'null'::jsonb or round(greatest(p_daily_cents, 0) / 100.0) <= (t->>'to')::numeric)
   order by (t->>'from')::numeric limit 1
$$;

create or replace function public.admin_price_book_save(p_book jsonb, p_effective date, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v int; t jsonb;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_effective is null or p_effective < billing_today() then raise exception 'A new price starts today or later'; end if;
  if jsonb_typeof(p_book->'tiers') <> 'array' or jsonb_array_length(p_book->'tiers') = 0 then raise exception 'tiers missing'; end if;
  for t in select * from jsonb_array_elements(p_book->'tiers') loop
    if coalesce(t->>'key', '') = '' or coalesce(t->>'label', '') = '' or (t->>'from') is null then raise exception 'each tier needs key, label and from'; end if;
    if t->'monthly_cents' <> 'null'::jsonb and (t->>'monthly_cents')::int < 0 then raise exception 'tier price below 0'; end if;
  end loop;
  if coalesce((p_book->>'paid_min_daily_cents')::int, -1) < 0 or coalesce((p_book->>'grace_days')::int, -1) < 0
     or coalesce((p_book->>'servicing_only_cents')::int, -1) < 0 or p_book->'setup' is null then
    raise exception 'paid_min_daily_cents, servicing_only_cents, grace_days and setup are required';
  end if;
  select coalesce(max(version), 0) + 1 into v from billing_price_book;
  insert into billing_price_book (version, effective_from, book, note, created_by)
  values (v, p_effective, p_book - 'version' - 'effective_from' - 'status', p_note, auth.uid());
  return v;
end; $$;

-- ── 3. Plans and the event history ──────────────────────────────────────────
create table public.agent_billing_plans (
  agent_id         uuid primary key references public.profiles(id),
  plan             text not null default 'paid' check (plan in ('pilot', 'paid')),
  products         text not null default 'both' check (products in ('leads', 'servicing', 'both')),
  pilot_start      date,
  pilot_note       text check (char_length(pilot_note) <= 1000),
  va_cost_on       boolean not null default false,
  va_rate_cents    int not null default 800 check (va_rate_cents between 0 and 10000),
  setup_mode       text check (setup_mode in ('fee', 'none_min_term')),
  setup_fee_cents  int check (setup_fee_cents >= 0),
  min_term_months  int check (min_term_months between 0 and 24),
  paid_start       date,
  setup_paid_at    timestamptz,
  tier_key         text,
  tier_version     int,
  next_tier_key    text,
  to_paid          jsonb check (to_paid is null or jsonb_typeof(to_paid) = 'object'),
  spend_paused     boolean not null default false,
  updated_at       timestamptz not null default now()
);
alter table public.agent_billing_plans enable row level security;
revoke all on public.agent_billing_plans from public, anon, authenticated;
grant select on public.agent_billing_plans to authenticated;
create policy abp_read on public.agent_billing_plans for select to authenticated using (agent_id = auth.uid() or is_admin());

create table public.agent_billing_events (
  id        bigint generated always as identity primary key,
  agent_id  uuid not null references public.profiles(id),
  kind      text not null,
  before    jsonb,
  after     jsonb,
  reason    text check (char_length(reason) <= 500),
  by_user   uuid references public.profiles(id) on delete set null,
  at        timestamptz not null default now()
);
create index agent_billing_events_agent_idx on public.agent_billing_events (agent_id, at desc);
alter table public.agent_billing_events enable row level security;
revoke all on public.agent_billing_events from public, anon, authenticated;
grant select on public.agent_billing_events to authenticated;
create policy abe_read on public.agent_billing_events for select to authenticated using (agent_id = auth.uid() or is_admin());

create or replace function public.billing_append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end; $$;
create trigger agent_billing_events_block before update or delete on public.agent_billing_events
  for each row execute function public.billing_append_only();

create or replace function public.billing_log(p_agent uuid, p_kind text, p_before jsonb, p_after jsonb, p_reason text default null)
returns void language sql security definer set search_path = public as $$
  insert into agent_billing_events (agent_id, kind, before, after, reason, by_user)
  values (p_agent, p_kind, p_before, p_after, p_reason, auth.uid())
$$;

-- The agent's plan row, made on first use.
create or replace function public.billing_plan(p_agent uuid) returns public.agent_billing_plans
language plpgsql security definer set search_path = public as $$
declare r agent_billing_plans;
begin
  insert into agent_billing_plans (agent_id) values (p_agent) on conflict (agent_id) do nothing;
  select * into r from agent_billing_plans where agent_id = p_agent;
  return r;
end; $$;

-- ── 4. Daily spend per lead type ────────────────────────────────────────────
create table public.agent_lead_spend (
  agent_id     uuid not null references public.profiles(id),
  lead_type    text not null check (lead_type in ('appts', 'live')),
  daily_cents  int not null default 0 check (daily_cents between 0 and 100000),
  next_cents   int check (next_cents between 0 and 100000),
  next_from    date,
  updated_at   timestamptz not null default now(),
  primary key (agent_id, lead_type)
);
alter table public.agent_lead_spend enable row level security;
revoke all on public.agent_lead_spend from public, anon, authenticated;
grant select on public.agent_lead_spend to authenticated;
create policy als_read on public.agent_lead_spend for select to authenticated using (agent_id = auth.uid() or is_admin());

-- Carry over the old weekly amounts (188) as a daily spend, once.
insert into public.agent_lead_spend (agent_id, lead_type, daily_cents)
select s.agent_id, case s.inbound_type when 'live_call' then 'live' else 'appts' end, round(s.weekly_cents / 7.0)::int
  from public.agent_inbound_spend s
 where not s.paused and s.weekly_cents > 0
on conflict do nothing;

-- The spend in effect on a day (a change starts at midnight).
create or replace function public.lead_spend_daily(p_agent uuid, p_type text, p_on date default null) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case when s.next_from is not null and s.next_from <= coalesce(p_on, billing_today())
                               then s.next_cents else s.daily_cents end
                     from agent_lead_spend s where s.agent_id = p_agent and s.lead_type = p_type), 0)
$$;
create or replace function public.lead_spend_daily_total(p_agent uuid, p_on date default null) returns int
language sql stable as $$
  select public.lead_spend_daily(p_agent, 'appts', p_on) + public.lead_spend_daily(p_agent, 'live', p_on)
$$;

-- ── 5. The wallet: weeks, ledger, delivered spend, charges ─────────────────
create table public.lead_spend_weeks (
  agent_id        uuid not null references public.profiles(id),
  week_start      date not null check (extract(isodow from week_start) = 1),
  rolled_in_cents int not null default 0,
  agreed_appts    int not null default 0 check (agreed_appts >= 0),
  agreed_live     int not null default 0 check (agreed_live >= 0),
  opened_at       timestamptz not null default now(),
  primary key (agent_id, week_start)
);
alter table public.lead_spend_weeks enable row level security;
revoke all on public.lead_spend_weeks from public, anon, authenticated;
grant select on public.lead_spend_weeks to authenticated;
create policy lsw_read on public.lead_spend_weeks for select to authenticated using (agent_id = auth.uid() or is_admin());

create table public.lead_spend_ledger (
  id             bigint generated always as identity primary key,
  agent_id       uuid not null references public.profiles(id),
  kind           text not null check (kind in ('topup', 'spend', 'absorbed', 'adjust')),
  lead_type      text check (lead_type in ('appts', 'live')),
  cents          int not null,
  week_start     date not null,
  day            date,
  ref            text,
  note           text check (char_length(note) <= 500),
  balance_after  int not null check (balance_after >= 0),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  check ((kind = 'topup' and cents > 0) or (kind = 'spend' and cents < 0) or (kind = 'absorbed' and cents > 0) or kind = 'adjust'),
  check (kind not in ('spend', 'absorbed') or lead_type is not null)
);
create unique index lead_spend_ledger_ref_idx on public.lead_spend_ledger (kind, ref) where ref is not null;
create index lead_spend_ledger_agent_idx on public.lead_spend_ledger (agent_id, id desc);
alter table public.lead_spend_ledger enable row level security;
revoke all on public.lead_spend_ledger from public, anon, authenticated;
grant select on public.lead_spend_ledger to authenticated;
create policy lsl_read on public.lead_spend_ledger for select to authenticated using (agent_id = auth.uid() or is_admin());
comment on table public.lead_spend_ledger is
  'P884 prepaid lead-spend wallet. topup > 0 (a paid charge), spend < 0 (delivered spend), absorbed > 0 (spend Ohvara covered: does not touch the balance), adjust either sign. Append-only; balance_after never below 0.';

create trigger lead_spend_ledger_block before update or delete on public.lead_spend_ledger
  for each row execute function public.billing_append_only();

create or replace function public.lead_spend_ledger_before_insert() returns trigger language plpgsql
security definer set search_path = public as $$
declare prev int;
begin
  perform pg_advisory_xact_lock(hashtextextended('lead_spend:' || new.agent_id::text, 0));
  select balance_after into prev from lead_spend_ledger where agent_id = new.agent_id order by id desc limit 1;
  new.balance_after := coalesce(prev, 0) + case when new.kind = 'absorbed' then 0 else new.cents end;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end; $$;
create trigger lead_spend_ledger_balance before insert on public.lead_spend_ledger
  for each row execute function public.lead_spend_ledger_before_insert();

create or replace function public.lead_spend_balance(p_agent uuid) returns int language sql stable security definer
set search_path = public as $$
  select coalesce((select balance_after from lead_spend_ledger where agent_id = p_agent order by id desc limit 1), 0)
$$;

create table public.lead_spend_delivered (
  agent_id        uuid not null references public.profiles(id),
  lead_type       text not null check (lead_type in ('appts', 'live')),
  day             date not null,
  reported_cents  int not null default 0 check (reported_cents >= 0),
  billed_cents    int not null default 0 check (billed_cents >= 0),
  absorbed_cents  int not null default 0 check (absorbed_cents >= 0),
  source          text,
  updated_at      timestamptz not null default now(),
  primary key (agent_id, lead_type, day)
);
alter table public.lead_spend_delivered enable row level security;
revoke all on public.lead_spend_delivered from public, anon, authenticated;
grant select on public.lead_spend_delivered to authenticated;
create policy lsd_read on public.lead_spend_delivered for select to authenticated using (agent_id = auth.uid() or is_admin());

create table public.lead_spend_charges (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.profiles(id),
  week_start    date not null,
  kind          text not null check (kind in ('weekly', 'change', 'va_cost')),
  amount_cents  int not null check (amount_cents > 0),
  status        text not null default 'due' check (status in ('due', 'processing', 'paid', 'failed', 'cancelled')),
  key           text not null unique,
  attempts      int not null default 0,
  stripe_pi     text,
  failure       text check (char_length(failure) <= 300),
  note          text check (char_length(note) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index lead_spend_charges_open_idx on public.lead_spend_charges (status, updated_at) where status in ('due', 'processing', 'failed');
create index lead_spend_charges_agent_idx on public.lead_spend_charges (agent_id, created_at desc);
alter table public.lead_spend_charges enable row level security;
revoke all on public.lead_spend_charges from public, anon, authenticated;
grant select on public.lead_spend_charges to authenticated;
create policy lsc_read on public.lead_spend_charges for select to authenticated using (agent_id = auth.uid() or is_admin());

-- ── 6. The hand-off to the engine (N-G-06, N-G-18, N-A-42) ──────────────────
create table public.agent_campaign_control (
  agent_id            uuid not null references public.profiles(id),
  lead_type           text not null check (lead_type in ('appts', 'live')),
  run                 boolean not null default false,
  daily_budget_cents  int not null default 0 check (daily_budget_cents >= 0),
  cap_cents           int not null default 0 check (cap_cents >= 0),
  reason              text not null default 'off',
  changed_at          timestamptz not null default now(),
  pushed_at           timestamptz,
  engine_state        text,
  engine_at           timestamptz,
  primary key (agent_id, lead_type)
);
alter table public.agent_campaign_control enable row level security;
revoke all on public.agent_campaign_control from public, anon, authenticated;
grant select on public.agent_campaign_control to authenticated;
create policy acc_admin_read on public.agent_campaign_control for select to authenticated using (is_admin());
comment on table public.agent_campaign_control is
  'P884 → GoHighLevel (Jordan): run/stop, daily budget and spend cap (the funded balance) per agent and lead type. Pending push = pushed_at is null or < changed_at. Agents never see this table.';

-- ── 7. Status, the run matrix and the control refresh ──────────────────────
create or replace function public.billing_status_of(p_agent uuid) returns text language plpgsql stable
security definer set search_path = public as $$
declare p record; pl agent_billing_plans;
begin
  select role, is_active, billing_exempt, billing_status, billing_grace_until into p from profiles where id = p_agent;
  if not found or p.role <> 'agent' then return 'none'; end if;
  if coalesce(p.is_active, true) = false then return 'cancelled'; end if;
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if pl.agent_id is not null and pl.plan = 'pilot' then
    return case when pl.to_paid is not null and (pl.to_paid->>'accepted_at') is null
                     and (pl.to_paid->>'start')::date <= billing_today() then 'waiting_acceptance'
                when pl.spend_paused then 'paused' else 'pilot' end;
  end if;
  if p.billing_exempt or p.billing_status = 'exempt' then return case when pl.spend_paused then 'paused' else 'active' end; end if;
  if p.billing_status = 'past_due' then
    return case when p.billing_grace_until is not null and p.billing_grace_until < now() then 'suspended' else 'past_due' end;
  end if;
  if p.billing_status in ('lapsed', 'canceled') then return 'cancelled'; end if;
  if p.billing_status = 'none' then return 'not_started'; end if;
  return case when coalesce(pl.spend_paused, false) then 'paused' else 'active' end;
end; $$;

create or replace function public.lead_spend_charge_failed(p_agent uuid) returns boolean language sql stable
security definer set search_path = public as $$
  select exists (select 1 from lead_spend_charges where agent_id = p_agent and kind in ('weekly', 'change') and status = 'failed')
$$;
create or replace function public.lead_spend_charging(p_agent uuid) returns boolean language sql stable
security definer set search_path = public as $$
  select exists (select 1 from lead_spend_charges where agent_id = p_agent and kind in ('weekly', 'change') and status in ('due', 'processing'))
$$;

-- What runs right now (the matrix in the header).
create or replace function public.billing_runs(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare st text := billing_status_of(p_agent); pl agent_billing_plans; bal int := lead_spend_balance(p_agent);
        daily int := lead_spend_daily_total(p_agent); spend text;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  spend := case
    when st in ('cancelled', 'none') then 'off'
    when st in ('past_due', 'suspended') then 'stopped_payment'
    when st = 'not_started' then 'not_started'
    when coalesce(pl.products, 'both') = 'servicing' then 'not_bought'
    when lead_spend_charge_failed(p_agent) then 'stopped_payment'
    when st = 'paused' then 'paused'
    when daily = 0 then 'off'
    when bal <= 0 and lead_spend_charging(p_agent) then 'waiting_payment'
    when bal <= 0 then 'out'
    when bal < daily * coalesce((price_book()->>'low_days')::int, 2) then 'low'
    else 'running' end;
  return jsonb_build_object(
    'status', st,
    'lead_spend', spend,
    'ads', spend in ('running', 'low'),
    'pipeline', case when st in ('suspended', 'cancelled') then 'held' else 'yes' end,
    'transfers', st not in ('suspended', 'cancelled', 'none'),
    'servicing', st not in ('suspended', 'cancelled', 'none') and coalesce(pl.products, 'both') <> 'leads',
    'workspace', case when st = 'suspended' then 'billing_only' when st = 'cancelled' then 'none'
                      when st in ('past_due', 'waiting_acceptance') or spend = 'stopped_payment' then 'banner' else 'full' end);
end; $$;

-- Recompute the engine instructions for one agent. Notifies on low / used up.
create or replace function public.lead_spend_refresh_control(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare r jsonb := billing_runs(p_agent); bal int := lead_spend_balance(p_agent); t text;
        d_a int := lead_spend_daily(p_agent, 'appts'); d_l int := lead_spend_daily(p_agent, 'live');
        d int; v_cap int; v_run boolean; v_reason text; wk date := billing_week_of(billing_today()); v_prev text;
begin
  select c0.reason into v_prev from agent_campaign_control c0 where c0.agent_id = p_agent and c0.lead_type = 'appts';
  foreach t in array array['appts', 'live'] loop
    d := case t when 'appts' then d_a else d_l end;
    -- The balance is split by the agent's own spend split; the remainder cent goes to appointments.
    v_cap := case when d_a + d_l = 0 or bal <= 0 then 0
                when t = 'live' then (bal::bigint * d_l / (d_a + d_l))::int
                else bal - (bal::bigint * d_l / (d_a + d_l))::int end;
    v_reason := case when (r->>'lead_spend') in ('running', 'low') and d = 0 then 'off'
                   when (r->>'lead_spend') in ('running', 'low') then 'funded'
                   else r->>'lead_spend' end;
    v_run := v_reason = 'funded' and v_cap > 0;
    insert into agent_campaign_control as c (agent_id, lead_type, run, daily_budget_cents, cap_cents, reason)
    values (p_agent, t, v_run, case when v_run then least(d, v_cap) else 0 end, case when v_run then v_cap else 0 end, v_reason)
    on conflict (agent_id, lead_type) do update
       set run = excluded.run, daily_budget_cents = excluded.daily_budget_cents, cap_cents = excluded.cap_cents,
           reason = excluded.reason, changed_at = now()
     where (c.run, c.daily_budget_cents, c.cap_cents, c.reason)
           is distinct from (excluded.run, excluded.daily_budget_cents, excluded.cap_cents, excluded.reason);
  end loop;
  if (r->>'lead_spend') = 'low' then
    perform notify(p_agent, 'billing_balance_low', 'Lead spend balance is running low',
                   'About ' || greatest(1, bal / greatest(d_a + d_l, 1)) || ' day(s) of leads left this week.',
                   '/billing', false, 'lead-low:' || p_agent || ':' || wk, jsonb_build_object('balance_cents', bal));
  elsif (r->>'lead_spend') = 'out' and v_prev is distinct from 'out' then
    perform notify(p_agent, 'billing_balance_out', 'Your lead spend is used up',
                   'New leads start again when next week''s spend is paid, or when you add more now.',
                   '/billing', true, 'lead-out:' || p_agent || ':' || wk, jsonb_build_object('balance_cents', bal));
  end if;
end; $$;

-- Membership changes (agent-billing writes profiles) refresh the engine and keep the history.
create or replace function public.billing_profile_changed() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.role = 'agent' and (new.billing_status is distinct from old.billing_status or new.is_active is distinct from old.is_active
     or new.billing_exempt is distinct from old.billing_exempt) then
    perform billing_log(new.id, 'membership_status', jsonb_build_object('status', old.billing_status),
                        jsonb_build_object('status', new.billing_status, 'grace_until', new.billing_grace_until), null);
    perform lead_spend_refresh_control(new.id);
    if new.billing_status = 'past_due' and old.billing_status is distinct from 'past_due' then
      perform notify(new.id, 'billing_charge_failed', 'Your payment didn''t go through',
                     'New leads are stopped until it''s paid. Your clients are still looked after until '
                     || to_char(new.billing_grace_until at time zone 'America/Chicago', 'Dy Mon FMDD') || '. Update your card to fix it.',
                     '/billing', true, 'member-failed:' || new.id || ':' || coalesce(new.billing_grace_until::text, ''), null);
    end if;
  end if;
  return new;
end; $$;
create trigger billing_profile_changed after update of billing_status, billing_grace_until, is_active, billing_exempt on public.profiles
  for each row execute function public.billing_profile_changed();

-- ── 8. Weeks, spend changes and charges ─────────────────────────────────────
create or replace function public.lead_spend_ensure_week(p_agent uuid, p_week date) returns public.lead_spend_weeks
language plpgsql security definer set search_path = public as $$
declare w lead_spend_weeks; today date := billing_today();
        -- A week opened mid-week agrees only today..Sunday at today's spend; a whole week agrees 7 days.
        days int := case when billing_week_of(today) = p_week then 8 - extract(isodow from today)::int else 7 end;
        d date := case when billing_week_of(today) = p_week then today else p_week end;
begin
  insert into lead_spend_weeks (agent_id, week_start, rolled_in_cents, agreed_appts, agreed_live)
  values (p_agent, p_week, lead_spend_balance(p_agent), lead_spend_daily(p_agent, 'appts', d) * days, lead_spend_daily(p_agent, 'live', d) * days)
  on conflict (agent_id, week_start) do nothing;
  select * into w from lead_spend_weeks where agent_id = p_agent and week_start = p_week;
  return w;
end; $$;

-- Set the daily spend per type (N-G-21, N-G-41, N-G-10). The agent for themselves, or the service role for anyone.
-- Starts at midnight Central tomorrow. A raise adds a charge for the rest of this week; a cut charges nothing.
create or replace function public.lead_spend_set(p_appts_cents int, p_live_cents int, p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans; today date := billing_today();
        tomorrow date := billing_today() + 1; wk date := billing_week_of(billing_today());
        days_left int := 7 - extract(isodow from billing_today())::int;
        old_a int; old_l int; total int := coalesce(p_appts_cents, 0) + coalesce(p_live_cents, 0);
        v_min int := coalesce((price_book()->>'paid_min_daily_cents')::int, 5000); extra int; ch uuid; tier jsonb;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_agent is not null and p_agent <> coalesce(auth.uid(), p_agent) and not is_admin() then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  if (select role from profiles where id = me) is distinct from 'agent' then raise exception 'Agents only' using errcode = '42501'; end if;
  if coalesce(p_appts_cents, 0) < 0 or coalesce(p_live_cents, 0) < 0 or total > 100000 then raise exception 'Spend out of range'; end if;
  pl := billing_plan(me);
  if pl.plan = 'paid' and total < v_min then
    raise exception 'Paid plans need at least $% a day. Pause instead?', v_min / 100 using errcode = 'P0001', hint = 'min_daily';
  end if;
  old_a := lead_spend_daily(me, 'appts', tomorrow); old_l := lead_spend_daily(me, 'live', tomorrow);
  insert into agent_lead_spend (agent_id, lead_type, daily_cents, next_cents, next_from)
  values (me, 'appts', 0, coalesce(p_appts_cents, 0), tomorrow), (me, 'live', 0, coalesce(p_live_cents, 0), tomorrow)
  on conflict (agent_id, lead_type) do update
     set daily_cents = lead_spend_daily(excluded.agent_id, excluded.lead_type, today),
         next_cents = excluded.next_cents, next_from = excluded.next_from, updated_at = now();
  perform lead_spend_ensure_week(me, wk);
  update lead_spend_weeks
     set agreed_appts = greatest(0, agreed_appts + (coalesce(p_appts_cents, 0) - old_a) * days_left),
         agreed_live  = greatest(0, agreed_live + (coalesce(p_live_cents, 0) - old_l) * days_left)
   where agent_id = me and week_start = wk;
  perform billing_log(me, 'spend', jsonb_build_object('appts', old_a, 'live', old_l),
                      jsonb_build_object('appts', coalesce(p_appts_cents, 0), 'live', coalesce(p_live_cents, 0), 'from', tomorrow), null);
  extra := (total - (old_a + old_l)) * days_left;
  if extra > 0 and pl.products <> 'servicing' and billing_status_of(me) in ('pilot', 'active', 'waiting_acceptance') then
    insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note)
    values (me, wk, 'change', extra, 'change:' || me || ':' || wk || ':' || extract(epoch from clock_timestamp())::bigint,
            'Raised spend for ' || days_left || ' day(s) left this week')
    returning id into ch;
  end if;
  -- Tier (paid plans): the first tier is set now; a change applies from the next bill (N-G-10).
  if pl.plan = 'paid' then
    tier := billing_tier_for(total);
    if pl.tier_key is null then
      update agent_billing_plans set tier_key = tier->>'key', tier_version = (tier->>'version')::int, updated_at = now() where agent_id = me;
    elsif tier->>'key' is distinct from coalesce(pl.next_tier_key, pl.tier_key) then
      update agent_billing_plans set next_tier_key = case when tier->>'key' = pl.tier_key then null else tier->>'key' end, updated_at = now()
       where agent_id = me;
      perform billing_log(me, 'tier_next', jsonb_build_object('tier', coalesce(pl.next_tier_key, pl.tier_key)),
                          jsonb_build_object('tier', tier->>'key'), 'Daily spend now $' || round(total / 100.0));
      perform notify(me, 'billing_tier_change', 'Your membership changes with your next bill',
                     'Your daily spend puts you on ' || (tier->>'label') || ' from your next bill.', '/billing', false,
                     'tier:' || me || ':' || (tier->>'key') || ':' || today, null);
    end if;
  end if;
  perform lead_spend_refresh_control(me);
  return jsonb_build_object('from', tomorrow, 'charge_id', ch, 'extra_cents', greatest(extra, 0), 'tier', tier);
end; $$;

create or replace function public.lead_spend_pause(p_paused boolean, p_agent uuid default null) returns void language plpgsql
security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans;
begin
  if me is null or (p_agent is not null and p_agent <> coalesce(auth.uid(), p_agent) and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  pl := billing_plan(me);
  if pl.spend_paused = p_paused then return; end if;
  update agent_billing_plans set spend_paused = p_paused, updated_at = now() where agent_id = me;
  perform billing_log(me, 'pause', jsonb_build_object('paused', pl.spend_paused), jsonb_build_object('paused', p_paused), null);
  perform lead_spend_refresh_control(me);
end; $$;

-- Open a week: record the rollover and what the week needs, and make the weekly charge (and the pilot VA cost line).
create or replace function public.lead_spend_week_open(p_week date default null) returns int language plpgsql
security definer set search_path = public as $$
declare wk date := coalesce(p_week, billing_week_of(billing_today())); a record; w lead_spend_weeks; need int; n int := 0; va jsonb;
begin
  for a in select p.id from profiles p where p.role = 'agent' and coalesce(p.is_active, true) loop
    -- Apply spend changes that start by this week.
    update agent_lead_spend set daily_cents = next_cents, next_cents = null, next_from = null, updated_at = now()
     where agent_id = a.id and next_from is not null and next_from <= wk;
    w := lead_spend_ensure_week(a.id, wk);
    if billing_status_of(a.id) in ('pilot', 'active', 'waiting_acceptance', 'past_due')
       and coalesce((select products from agent_billing_plans where agent_id = a.id), 'both') <> 'servicing' then
      need := w.agreed_appts + w.agreed_live - lead_spend_balance(a.id);
      if need > 0 then
        insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note)
        values (a.id, wk, 'weekly', need, 'weekly:' || a.id || ':' || wk,
                'Week of ' || to_char(wk, 'Mon FMDD') || ' (' || w.rolled_in_cents || ' cents rolled over)')
        on conflict (key) do nothing;
        if found then n := n + 1; end if;
      end if;
    end if;
    -- The optional pilot VA cost line, for last week (Q64).
    if exists (select 1 from agent_billing_plans where agent_id = a.id and plan = 'pilot' and va_cost_on) then
      va := pilot_va_cost(a.id, wk - 7, wk - 1);
      if (va->>'cents')::int > 0 then
        insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note)
        values (a.id, wk - 7, 'va_cost', (va->>'cents')::int, 'va_cost:' || a.id || ':' || (wk - 7),
                'Team time on your leads and clients: ' || (va->>'minutes') || ' min at $' || round((va->>'rate_cents')::int / 100.0, 2) || '/hr')
        on conflict (key) do nothing;
      end if;
    end if;
    perform lead_spend_refresh_control(a.id);
  end loop;
  return n;
end; $$;

-- VA time on an agent's leads and clients (calls that went live), at the agreed hourly rate, at cost.
create or replace function public.pilot_va_cost(p_agent uuid, p_from date, p_to date) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; mins numeric := 0;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if to_regclass('public.va_lines') is not null then
    execute $q$
      select coalesce(sum(extract(epoch from (coalesce(l.ended_at, l.live_at) - l.live_at)) / 60), 0)
        from va_lines l
        left join leads ld on ld.id = l.lead_id
        left join policies po on po.id = l.policy_id
       where l.live_at is not null
         and (ld.assigned_rep_id = $1 or po.agent_id = $1)
         and (l.live_at at time zone 'America/Chicago')::date between $2 and $3 $q$
      into mins using p_agent, p_from, p_to;
  end if;
  return jsonb_build_object('on', coalesce(pl.va_cost_on, false), 'minutes', round(mins)::int,
                            'rate_cents', coalesce(pl.va_rate_cents, 800),
                            'cents', case when coalesce(pl.va_cost_on, false) then round(mins * coalesce(pl.va_rate_cents, 800) / 60.0)::int else 0 end);
end; $$;

-- The lead-spend function claims charges to run (due, plus processing ones to re-check).
create or replace function public.lead_spend_claim_charges(p_limit int default 25, p_agent uuid default null)
returns setof jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges;
begin
  for c in select * from lead_spend_charges
            -- Due ones, and processing ones left 2+ minutes (a re-check, or a crash before Stripe answered: the
            -- function retries with the same idempotency key, so Stripe never charges twice).
            where (status = 'due' or (status = 'processing' and updated_at < now() - interval '2 minutes'))
              and (p_agent is null or agent_id = p_agent)
            order by created_at limit greatest(1, least(p_limit, 100)) for update skip locked loop
    update lead_spend_charges set status = 'processing', attempts = attempts + case when c.status = 'due' then 1 else 0 end,
           updated_at = now() where id = c.id returning * into c;
    return next to_jsonb(c) || jsonb_build_object('customer', (select stripe_customer_id from profiles where id = c.agent_id),
                                                  'recheck', c.stripe_pi is not null);
  end loop;
end; $$;

-- The result of one charge. Paid lead spend lands in the wallet; ads resume.
create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges;
begin
  if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
  select * into c from lead_spend_charges where id = p_id for update;
  if not found then raise exception 'no such charge'; end if;
  if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = p_id;
  if p_status = 'paid' then
    if c.kind in ('weekly', 'change') then
      insert into lead_spend_ledger (agent_id, kind, cents, week_start, ref, note)
      values (c.agent_id, 'topup', c.amount_cents, billing_week_of(billing_today()), coalesce(p_pi, 'charge:' || c.id), c.note)
      on conflict do nothing;
      -- A later payment settles earlier failed lead-spend charges for the same week.
      update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · settled by a later payment', 300), updated_at = now()
       where agent_id = c.agent_id and status = 'failed' and kind in ('weekly', 'change') and week_start <= c.week_start;
    end if;
    perform billing_log(c.agent_id, 'charge_paid', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'pi', p_pi), null);
    perform notify(c.agent_id, 'billing_charged', 'Payment received',
                   case c.kind when 'va_cost' then 'Team time for last week, paid.' else 'Lead spend for this week is paid. Your leads are on.' end,
                   '/billing', false, 'charged:' || c.id, jsonb_build_object('cents', c.amount_cents));
  elsif p_status = 'failed' then
    perform billing_log(c.agent_id, 'charge_failed', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'failure', p_failure), null);
    perform notify(c.agent_id, 'billing_charge_failed', 'Your payment didn''t go through',
                   'New leads are stopped until it''s paid. Update your card and we''ll try again straight away.',
                   '/billing', true, 'lead-failed:' || c.id || ':' || c.attempts, null);
    perform notify(adm.id, 'billing_payment_problem', 'A lead spend payment failed',
                   coalesce((select full_name from profiles where id = c.agent_id), 'An agent') || ': ' || coalesce(p_failure, 'declined'),
                   '/admin', true, 'lead-failed:' || c.id || ':' || c.attempts || ':' || adm.id, null)
      from profiles adm where adm.role = 'admin' and coalesce(adm.is_active, true);
  end if;
  perform lead_spend_refresh_control(c.agent_id);
  return jsonb_build_object('status', p_status);
end; $$;

-- Retry an agent's failed charges now (after a card update): back to due.
create or replace function public.lead_spend_retry(p_agent uuid default null) returns int language plpgsql
security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); n int;
begin
  if me is null or (p_agent is not null and p_agent <> coalesce(auth.uid(), p_agent) and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  update lead_spend_charges set status = 'due', failure = null, updated_at = now() where agent_id = me and status = 'failed';
  get diagnostics n = row_count;
  perform lead_spend_refresh_control(me);
  return n;
end; $$;

-- ── 9. Delivered spend from the engine, with the true-up (N-G-05, Q12) ──────
-- 858's spend feed calls this once per agent, type and day, with the engine's latest total for that day.
create or replace function public.lead_spend_record_delivered(p_agent uuid, p_type text, p_day date, p_cents int, p_source text default 'engine')
returns jsonb language plpgsql security definer set search_path = public as $$
declare d lead_spend_delivered; wk date := billing_week_of(p_day); w lead_spend_weeks; delta int; bal int; agreed_left int;
        bill int := 0; absorb int := 0; back int; from_abs int;
begin
  if p_type not in ('appts', 'live') or p_cents is null or p_cents < 0 then raise exception 'bad delivered spend'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lead_spend:' || p_agent::text, 0));
  insert into lead_spend_delivered (agent_id, lead_type, day) values (p_agent, p_type, p_day) on conflict do nothing;
  select * into d from lead_spend_delivered where agent_id = p_agent and lead_type = p_type and day = p_day for update;
  delta := p_cents - (d.billed_cents + d.absorbed_cents);
  if delta = 0 then
    update lead_spend_delivered set reported_cents = p_cents, source = p_source, updated_at = now() where agent_id = p_agent and lead_type = p_type and day = p_day;
    return jsonb_build_object('billed', 0, 'absorbed', 0);
  end if;
  w := lead_spend_ensure_week(p_agent, wk);
  if delta > 0 then
    bal := lead_spend_balance(p_agent);
    agreed_left := greatest(0, case p_type when 'appts' then w.agreed_appts else w.agreed_live end
                     - coalesce((select sum(billed_cents) from lead_spend_delivered where agent_id = p_agent and lead_type = p_type and day between wk and wk + 6), 0));
    bill := least(delta, bal, agreed_left);
    absorb := delta - bill;
    if bill > 0 then
      insert into lead_spend_ledger (agent_id, kind, lead_type, cents, week_start, day, ref, note)
      values (p_agent, 'spend', p_type, -bill, wk, p_day, p_type || ':' || p_agent || ':' || p_day || ':' || (d.billed_cents + bill), 'Delivered lead spend');
    end if;
    if absorb > 0 then
      insert into lead_spend_ledger (agent_id, kind, lead_type, cents, week_start, day, ref, note)
      values (p_agent, 'absorbed', p_type, absorb, wk, p_day, p_type || ':' || p_agent || ':' || p_day || ':abs:' || (d.absorbed_cents + absorb),
              'Over the agreed or funded amount: Ohvara covers it');
      perform billing_log(p_agent, 'absorbed', null, jsonb_build_object('type', p_type, 'day', p_day, 'cents', absorb), 'Overspend absorbed (Q12)');
    end if;
    update lead_spend_delivered set reported_cents = p_cents, billed_cents = billed_cents + bill, absorbed_cents = absorbed_cents + absorb,
           source = p_source, updated_at = now() where agent_id = p_agent and lead_type = p_type and day = p_day;
  else
    -- Revised down: take it off what Ohvara absorbed first, then give the rest back to the balance.
    back := -delta;
    from_abs := least(back, d.absorbed_cents);
    back := least(back - from_abs, d.billed_cents);
    if back > 0 then
      insert into lead_spend_ledger (agent_id, kind, lead_type, cents, week_start, day, ref, note)
      values (p_agent, 'adjust', p_type, back, wk, p_day, p_type || ':' || p_agent || ':' || p_day || ':back:' || (d.billed_cents - back),
              'Delivered spend revised down: returned to the balance');
    end if;
    update lead_spend_delivered set reported_cents = p_cents, billed_cents = billed_cents - back, absorbed_cents = absorbed_cents - from_abs,
           source = p_source, updated_at = now() where agent_id = p_agent and lead_type = p_type and day = p_day;
    bill := -back; absorb := -from_abs;
  end if;
  perform lead_spend_refresh_control(p_agent);
  return jsonb_build_object('billed', bill, 'absorbed', absorb, 'balance', lead_spend_balance(p_agent));
end; $$;

-- The engine confirms what it did with a control row (paused, live, budget set...).
create or replace function public.campaign_control_confirm(p_agent uuid, p_type text, p_state text, p_pushed_at timestamptz default null)
returns void language sql security definer set search_path = public as $$
  update agent_campaign_control
     set engine_state = left(p_state, 60), engine_at = now(), pushed_at = coalesce(p_pushed_at, now())
   where agent_id = p_agent and lead_type = p_type
$$;

-- An admin correction to the balance, with a reason (N-G-38).
create or replace function public.admin_lead_spend_adjust(p_agent uuid, p_cents int, p_reason text) returns int language plpgsql
security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_cents = 0 or coalesce(trim(p_reason), '') = '' then raise exception 'An amount and a reason are needed'; end if;
  insert into lead_spend_ledger (agent_id, kind, cents, week_start, note)
  values (p_agent, 'adjust', p_cents, billing_week_of(billing_today()), left(p_reason, 500));
  perform billing_log(p_agent, 'adjust', null, jsonb_build_object('cents', p_cents), p_reason);
  perform lead_spend_refresh_control(p_agent);
  return lead_spend_balance(p_agent);
end; $$;

-- ── 10. Pilot, pilot → paid, setup fee, membership (N-G-01, N-G-08, N-G-12, Q64) ──
create or replace function public.admin_billing_pilot_set(p_agent uuid, p_on boolean, p_start date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl agent_billing_plans;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if (select role from profiles where id = p_agent) is distinct from 'agent' then raise exception 'Not an agent'; end if;
  pl := billing_plan(p_agent);
  update agent_billing_plans
     set plan = case when p_on then 'pilot' else 'paid' end,
         pilot_start = case when p_on then coalesce(p_start, pl.pilot_start, billing_today()) else pl.pilot_start end,
         pilot_note = coalesce(p_note, pilot_note),
         paid_start = case when p_on then paid_start else coalesce(paid_start, billing_today()) end,
         to_paid = case when p_on then to_paid else null end,
         updated_at = now()
   where agent_id = p_agent;
  perform billing_log(p_agent, 'pilot', jsonb_build_object('plan', pl.plan, 'start', pl.pilot_start, 'note', pl.pilot_note),
                      jsonb_build_object('plan', case when p_on then 'pilot' else 'paid' end, 'start', coalesce(p_start, pl.pilot_start), 'note', coalesce(p_note, pl.pilot_note)), null);
  perform lead_spend_refresh_control(p_agent);
end; $$;

create or replace function public.admin_billing_va_cost_set(p_agent uuid, p_on boolean, p_rate_cents int default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl agent_billing_plans;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  pl := billing_plan(p_agent);
  update agent_billing_plans set va_cost_on = p_on, va_rate_cents = coalesce(p_rate_cents, va_rate_cents), updated_at = now() where agent_id = p_agent;
  perform billing_log(p_agent, 'va_cost', jsonb_build_object('on', pl.va_cost_on, 'rate_cents', pl.va_rate_cents),
                      jsonb_build_object('on', p_on, 'rate_cents', coalesce(p_rate_cents, pl.va_rate_cents)), null);
end; $$;

-- Pilot → paid: the plan starts on a date, the agent gets notice and must accept before any membership charge.
create or replace function public.admin_billing_to_paid(p_agent uuid, p_start date) returns void language plpgsql
security definer set search_path = public as $$
declare pl agent_billing_plans; tier jsonb;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  pl := billing_plan(p_agent);
  if pl.plan <> 'pilot' then raise exception 'Only a pilot agent moves to a paid plan'; end if;
  if p_start is null or p_start < billing_today() + 7 then raise exception 'Give at least 7 days'' notice'; end if;
  tier := billing_tier_for(lead_spend_daily_total(p_agent));
  update agent_billing_plans set to_paid = jsonb_build_object('start', p_start, 'notice_at', now(), 'accepted_at', null,
         'tier', tier->>'key', 'monthly_cents', tier->'monthly_cents', 'version', tier->'version'), updated_at = now()
   where agent_id = p_agent;
  perform billing_log(p_agent, 'to_paid', jsonb_build_object('plan', 'pilot'), jsonb_build_object('start', p_start, 'tier', tier->>'key'), null);
  perform notify(p_agent, 'billing_plan_notice', 'Your plan changes on ' || to_char(p_start, 'Mon FMDD'),
                 'The pilot ends. From then you pay a monthly membership (' || (tier->>'label') || ') plus your lead spend. Review and accept it.',
                 '/billing', true, 'to-paid:' || p_agent || ':' || p_start, jsonb_build_object('start', p_start));
end; $$;

-- The agent accepts the paid plan and authorises the charge (amount, how often, terms version, device). N-G-03 / N-G-08.
create or replace function public.billing_accept_paid(p_terms_version text, p_device text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pl agent_billing_plans; auth jsonb;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into pl from agent_billing_plans where agent_id = me;
  if pl.to_paid is null then raise exception 'Nothing to accept'; end if;
  auth := jsonb_build_object('accepted_at', now(), 'terms_version', left(p_terms_version, 40), 'device', left(p_device, 200),
                             'amount_cents', pl.to_paid->'monthly_cents', 'frequency', 'monthly');
  update agent_billing_plans set to_paid = to_paid || auth, updated_at = now() where agent_id = me;
  perform billing_log(me, 'accepted_paid', null, auth, null);
  return pl.to_paid || auth;
end; $$;

create or replace function public.admin_billing_setup_set(p_agent uuid, p_mode text, p_fee_cents int default null, p_min_months int default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl agent_billing_plans;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_mode not in ('fee', 'none_min_term') then raise exception 'mode is fee or none_min_term'; end if;
  pl := billing_plan(p_agent);
  update agent_billing_plans set setup_mode = p_mode,
         setup_fee_cents = case when p_mode = 'fee' then coalesce(p_fee_cents, (price_book()->'setup'->>'fee_cents')::int) else 0 end,
         min_term_months = case when p_mode = 'none_min_term' then coalesce(p_min_months, (price_book()->'setup'->>'min_months')::int) else 0 end,
         updated_at = now()
   where agent_id = p_agent;
  perform billing_log(p_agent, 'setup', jsonb_build_object('mode', pl.setup_mode, 'fee_cents', pl.setup_fee_cents, 'min_months', pl.min_term_months),
                      jsonb_build_object('mode', p_mode, 'fee_cents', p_fee_cents, 'min_months', p_min_months), null);
end; $$;

-- What the next membership bill holds (848 builds the monthly Stripe bill from this). Pilot: nothing.
create or replace function public.agent_membership_due(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; pb jsonb := price_book(); tier jsonb; mode text; fee int; v_months int; term_end date; monthly int;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if pl.agent_id is null then pl.plan := 'paid'; pl.products := 'both'; end if;
  if pl.plan = 'pilot' then return jsonb_build_object('plan', 'pilot', 'membership_cents', 0, 'setup_cents', 0, 'lines', '[]'::jsonb); end if;
  if pl.products = 'servicing' then
    monthly := (pb->>'servicing_only_cents')::int;
    tier := jsonb_build_object('key', 'servicing', 'label', 'Servicing only', 'monthly_cents', monthly);
  else
    select t into tier from jsonb_array_elements(pb->'tiers') t where t->>'key' = pl.tier_key;
    tier := coalesce(tier, billing_tier_for(lead_spend_daily_total(p_agent)));
    monthly := nullif(tier->>'monthly_cents', '')::int;
  end if;
  mode := coalesce(pl.setup_mode, pb->'setup'->>'mode');
  fee := case when pl.setup_paid_at is not null then 0 when mode = 'fee' then coalesce(pl.setup_fee_cents, (pb->'setup'->>'fee_cents')::int) else 0 end;
  v_months := case when mode = 'none_min_term' then coalesce(pl.min_term_months, (pb->'setup'->>'min_months')::int) else 0 end;
  term_end := case when v_months > 0 and pl.paid_start is not null then (pl.paid_start + make_interval(0, v_months))::date end;
  return jsonb_build_object(
    'plan', 'paid', 'tier', tier, 'next_tier', pl.next_tier_key, 'price_version', coalesce(pl.tier_version, (pb->>'version')::int),
    'membership_cents', monthly, 'setup_mode', mode, 'setup_cents', fee, 'min_term_end', term_end,
    'early_cancel_cents', case when term_end is not null and term_end > billing_today() and monthly is not null
                               then monthly * greatest(1, ceil(extract(epoch from (term_end::timestamp - billing_today()::timestamp)) / (86400 * 30.4))::int) else 0 end,
    'lines', jsonb_build_array(jsonb_build_object('label', 'Membership, ' || (tier->>'label'), 'cents', monthly))
             || case when fee > 0 then jsonb_build_array(jsonb_build_object('label', 'Setup (one time)', 'cents', fee)) else '[]'::jsonb end);
end; $$;

-- agent-billing calls this when a membership period renews: the next tier takes over (N-G-10).
create or replace function public.billing_period_rolled(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare pl agent_billing_plans;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if pl.agent_id is null or pl.next_tier_key is null then return; end if;
  update agent_billing_plans set tier_key = next_tier_key, next_tier_key = null, tier_version = (price_book()->>'version')::int, updated_at = now()
   where agent_id = p_agent;
  perform billing_log(p_agent, 'tier', jsonb_build_object('tier', pl.tier_key), jsonb_build_object('tier', pl.next_tier_key), 'New bill: daily spend changed tier');
end; $$;

-- ── 11. The daily sweep: spend changes at midnight, pilot → paid dates, suspensions ──
create or replace function public.billing_daily_sweep() returns int language plpgsql security definer set search_path = public as $$
declare a record; n int := 0; today date := billing_today(); d int; st text; tier jsonb;
begin
  for a in select s.agent_id from agent_lead_spend s where s.next_from is not null and s.next_from <= today group by s.agent_id loop
    update agent_lead_spend set daily_cents = next_cents, next_cents = null, next_from = null, updated_at = now()
     where agent_id = a.agent_id and next_from is not null and next_from <= today;
    perform lead_spend_refresh_control(a.agent_id); n := n + 1;
  end loop;
  for a in select * from agent_billing_plans where plan = 'pilot' and to_paid is not null loop
    d := (a.to_paid->>'start')::date - today;
    if d in (7, 3, 1) and (a.to_paid->>'accepted_at') is null then
      perform notify(a.agent_id, 'billing_plan_notice', 'Your plan changes in ' || d || ' day' || case when d = 1 then '' else 's' end,
                     'Review and accept your plan so your leads keep running.', '/billing', true,
                     'to-paid:' || a.agent_id || ':' || (a.to_paid->>'start') || ':' || d, null);
    elsif d <= 0 and (a.to_paid->>'accepted_at') is not null then
      tier := billing_tier_for(lead_spend_daily_total(a.agent_id));
      update agent_billing_plans set plan = 'paid', paid_start = today, tier_key = tier->>'key', tier_version = (tier->>'version')::int,
             to_paid = null, updated_at = now() where agent_id = a.agent_id;
      perform billing_log(a.agent_id, 'pilot', jsonb_build_object('plan', 'pilot'), jsonb_build_object('plan', 'paid', 'tier', tier->>'key'), 'Accepted plan started');
      perform lead_spend_refresh_control(a.agent_id); n := n + 1;
    end if;
  end loop;
  for a in select id, billing_grace_until from profiles where role = 'agent' and billing_status = 'past_due'
            and billing_grace_until < now() loop
    perform notify(a.id, 'billing_charge_failed', 'Your account is on hold',
                   'Your membership wasn''t paid in time, so work for your clients is paused. Update your card to start again.',
                   '/billing', true, 'suspended:' || a.id || ':' || a.billing_grace_until, null);
    perform lead_spend_refresh_control(a.id);
  end loop;
  return n;
end; $$;

-- ── 12. Reads: the agent's own billing and the admin console ────────────────
create or replace function public.lead_spend_week_report(p_agent uuid, p_week date) returns jsonb language sql stable
security definer set search_path = public as $$
  select jsonb_build_object(
    'week_start', p_week,
    'rolled_in_cents', coalesce(w.rolled_in_cents, 0),
    'collected_cents', coalesce((select sum(cents) from lead_spend_ledger where agent_id = p_agent and kind = 'topup' and week_start = p_week), 0),
    'types', jsonb_build_object(
      'appts', jsonb_build_object('agreed_cents', coalesce(w.agreed_appts, 0),
        'delivered_cents', coalesce((select sum(billed_cents + absorbed_cents) from lead_spend_delivered where agent_id = p_agent and lead_type = 'appts' and day between p_week and p_week + 6), 0),
        'billed_cents', coalesce((select sum(billed_cents) from lead_spend_delivered where agent_id = p_agent and lead_type = 'appts' and day between p_week and p_week + 6), 0),
        'absorbed_cents', coalesce((select sum(absorbed_cents) from lead_spend_delivered where agent_id = p_agent and lead_type = 'appts' and day between p_week and p_week + 6), 0)),
      'live', jsonb_build_object('agreed_cents', coalesce(w.agreed_live, 0),
        'delivered_cents', coalesce((select sum(billed_cents + absorbed_cents) from lead_spend_delivered where agent_id = p_agent and lead_type = 'live' and day between p_week and p_week + 6), 0),
        'billed_cents', coalesce((select sum(billed_cents) from lead_spend_delivered where agent_id = p_agent and lead_type = 'live' and day between p_week and p_week + 6), 0),
        'absorbed_cents', coalesce((select sum(absorbed_cents) from lead_spend_delivered where agent_id = p_agent and lead_type = 'live' and day between p_week and p_week + 6), 0))))
  from (select 1) one left join lead_spend_weeks w on w.agent_id = p_agent and w.week_start = p_week
$$;

create or replace function public.billing_view(p_agent uuid, p_admin boolean) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; wk date := billing_week_of(billing_today()); v jsonb;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  v := jsonb_build_object(
    'plan', coalesce(pl.plan, 'paid'), 'products', coalesce(pl.products, 'both'), 'pilot_start', pl.pilot_start,
    'state', billing_runs(p_agent),
    'balance_cents', lead_spend_balance(p_agent),
    'spend', jsonb_build_object('appts', lead_spend_daily(p_agent, 'appts'), 'live', lead_spend_daily(p_agent, 'live'),
                                'next', (select jsonb_object_agg(lead_type, next_cents) from agent_lead_spend where agent_id = p_agent and next_from is not null),
                                'next_from', (select min(next_from) from agent_lead_spend where agent_id = p_agent)),
    'week', lead_spend_week_report(p_agent, wk),
    'membership', agent_membership_due(p_agent),
    'to_paid', pl.to_paid,
    'va_cost', case when coalesce(pl.va_cost_on, false) then pilot_va_cost(p_agent, wk, billing_today()) end,
    'charges', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'week_start', week_start, 'cents', amount_cents,
                                  'status', status, 'failure', failure, 'note', note, 'at', created_at) order by created_at desc)
                           from (select * from lead_spend_charges where agent_id = p_agent order by created_at desc limit 20) c), '[]'::jsonb),
    'grace_until', (select billing_grace_until from profiles where id = p_agent),
    'price_book', price_book());
  if p_admin then
    v := v || jsonb_build_object(
      'pilot_note', pl.pilot_note, 'va_cost_on', coalesce(pl.va_cost_on, false), 'va_rate_cents', coalesce(pl.va_rate_cents, 800),
      'controls', (select jsonb_agg(to_jsonb(c)) from agent_campaign_control c where c.agent_id = p_agent),
      'ledger', (select jsonb_agg(to_jsonb(l) order by l.id desc) from (select * from lead_spend_ledger where agent_id = p_agent order by id desc limit 50) l),
      'events', (select jsonb_agg(to_jsonb(e) order by e.id desc) from (select * from agent_billing_events where agent_id = p_agent order by id desc limit 50) e));
  end if;
  return v;
end; $$;

create or replace function public.my_billing() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return billing_view(auth.uid(), false);
end; $$;
create or replace function public.admin_billing_view(p_agent uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return billing_view(p_agent, true);
end; $$;

-- ── 13. Notifications ───────────────────────────────────────────────────────
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select v.type, v.roles, v.label, true, 'notify', true, v.push, true, true,
       coalesce((select max(sort) from public.notification_types), 0) + v.n
  from (values
    ('billing_charge_failed',   array['agent'], 'A payment didn''t go through',        true,  1),
    ('billing_balance_low',     array['agent'], 'Lead spend balance running low',      false, 2),
    ('billing_balance_out',     array['agent'], 'Lead spend used up',                  true,  3),
    ('billing_charged',         array['agent'], 'Payment received',                    false, 4),
    ('billing_tier_change',     array['agent'], 'Membership changes with next bill',   false, 5),
    ('billing_plan_notice',     array['agent'], 'Your plan is changing',               true,  6),
    ('billing_payment_problem', array['admin'], 'An agent''s payment failed',          true,  7)
  ) as v(type, roles, label, push, n)
 where not exists (select 1 from public.notification_types t where t.type = v.type);

-- ── 14. Grants ──────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'billing_today()', 'billing_week_of(date)', 'price_book(date)', 'billing_tier_for(integer,date)', 'admin_price_book_save(jsonb,date,text)',
    'billing_log(uuid,text,jsonb,jsonb,text)', 'billing_plan(uuid)', 'lead_spend_daily(uuid,text,date)', 'lead_spend_daily_total(uuid,date)',
    'lead_spend_balance(uuid)', 'billing_status_of(uuid)', 'lead_spend_charge_failed(uuid)', 'lead_spend_charging(uuid)', 'billing_runs(uuid)',
    'lead_spend_refresh_control(uuid)', 'lead_spend_ensure_week(uuid,date)', 'lead_spend_set(integer,integer,uuid)', 'lead_spend_pause(boolean,uuid)',
    'lead_spend_week_open(date)', 'pilot_va_cost(uuid,date,date)', 'lead_spend_claim_charges(integer,uuid)', 'lead_spend_charge_result(uuid,text,text,text)',
    'lead_spend_retry(uuid)', 'lead_spend_record_delivered(uuid,text,date,integer,text)', 'campaign_control_confirm(uuid,text,text,timestamptz)',
    'admin_lead_spend_adjust(uuid,integer,text)', 'admin_billing_pilot_set(uuid,boolean,date,text)', 'admin_billing_va_cost_set(uuid,boolean,integer)',
    'admin_billing_to_paid(uuid,date)', 'billing_accept_paid(text,text)', 'admin_billing_setup_set(uuid,text,integer,integer)',
    'agent_membership_due(uuid)', 'billing_period_rolled(uuid)', 'billing_daily_sweep()', 'lead_spend_week_report(uuid,date)',
    'billing_view(uuid,boolean)', 'my_billing()', 'admin_billing_view(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- What a signed-in user may call (each checks the caller inside).
  foreach f in array array[
    'price_book(date)', 'billing_tier_for(integer,date)', 'admin_price_book_save(jsonb,date,text)', 'lead_spend_set(integer,integer,uuid)',
    'lead_spend_pause(boolean,uuid)', 'lead_spend_retry(uuid)', 'admin_lead_spend_adjust(uuid,integer,text)',
    'admin_billing_pilot_set(uuid,boolean,date,text)', 'admin_billing_va_cost_set(uuid,boolean,integer)', 'admin_billing_to_paid(uuid,date)',
    'billing_accept_paid(text,text)', 'admin_billing_setup_set(uuid,text,integer,integer)', 'my_billing()', 'admin_billing_view(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── 15. Cron: the week opens Monday 12:05 AM Central; the daily sweep at 12:10 AM; charges run every 15 minutes ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('lead-spend-week-open', 'billing-daily-sweep', 'lead-spend-run');
    perform cron.schedule('lead-spend-week-open', '5 6 * * 1', 'select public.lead_spend_week_open()');
    perform cron.schedule('billing-daily-sweep', '10 6 * * *', 'select public.billing_daily_sweep()');
    if to_regprocedure('public.fulfillment_cron_post(text, jsonb)') is not null then
      perform cron.schedule('lead-spend-run', '*/15 * * * *',
        $c$select public.fulfillment_cron_post('lead-spend', '{"action":"run"}'::jsonb)$c$);
    end if;
  end if;
end $$;
