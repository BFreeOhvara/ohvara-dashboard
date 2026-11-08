-- p909_final_pricing — final pricing, model B (Prompt 909; Brayden, Nov 8 01:18–01:36: "I just want it to make the most
-- sense", and never lose money on an agent). NOT NUMBERED, NOT APPLIED: money code, Brayden numbers and applies it after
-- p884_billing_engine, p889_one_lead_product, p890_cleanup, p891_book_import and p901_price_book_v2.
-- Additive: new rows, columns, tables, functions and triggers. Versions 1 and 2 of the price book stay (append-only).
-- src/lib/priceBook.js mirrors version 3 and BILLING_SETTINGS (src/p909.test.js checks them number for number).
--
-- 1. Price book version 3, FINAL, effective the day this file is applied:
--      Starter  $50 to $75 a day     $699 a month
--      Growth   $76 to $200 a day    $1,499 a month
--      Pro      $201 to $500 a day   $2,999 a month
--      plus 12% of lead spend on every lead plan ("covers the AI calls and the team working every lead").
--      Servicing only: $499 a month up to 100 clients, +$200 for each extra 100 (client count on the bill date).
--      Lead plans include servicing for every policy sold through Ohvara plus up to 50 clients the agent adds (P891);
--      above 50 added clients, +$200 for each extra 100.
--      Setup $299 once, not refunded. Month to month, cancel anytime; unspent lead-spend credit is refunded at cancel.
--      Pilot agents still pay only their lead spend (P884): no plan fee, no 12%, no setup.
--    The plan follows the daily spend band; a band change applies from the next monthly bill (P884, unchanged).
--
-- 2. billing_settings (admin, one row): max daily spend $500 (one agent can be raised by hand:
--    agent_billing_plans.max_daily_cents), the nightly charge hour (8 PM Central), the morning retry hour (8 AM), and
--    the founding lock (first 20 paying agents keep their prices for 12 months). charge_mode 'nightly' turns on
--    section 4; 'weekly' is the P884 engine as it was (the older database tests set it, nothing else should).
--
-- 3. Max $500 a day, min $50 (P884's paid minimum): checked in the database whoever writes the spend (a constraint
--    trigger on agent_lead_spend, hint 'max_daily'), so the agent screens and the edge function can't get round it.
--
-- 4. Lead spend is charged NIGHTLY to the card on file (Brayden 01:25). No bank transfer, no weekly prepay, no rollover,
--    no separate card fee:
--      * Every agent attaches a card in setup; leads don't start without one (billing_runs lead_spend 'no_card').
--        The lead-spend function's card_check action records it (billing_card_saved) after reading Stripe.
--      * Each evening at charge_hour (Central) lead_spend_nightly() makes one 'nightly' charge per agent: tomorrow's
--        spend minus their credit, plus 12% of that. Credit = what earlier days were charged and Meta didn't spend
--        (the true-up), so the difference and its 12% come off the next night's charge. If credit covers tomorrow,
--        nothing is charged.
--      * Approved: the spend lands in the wallet for tomorrow (the 12% doesn't: it's Ohvara's fee). Declined:
--        tomorrow's ads don't run, the agent gets a Fix card notice, and it's tried once more at retry_hour the next
--        morning. A declined day that passes is let go: those ads never ran, so nothing is owed for them. The plan's
--        failed-payment rules (P884: grace, suspension) are unchanged.
--      * Spend changes and pauses take effect from the next charge (a change still starts at midnight, P884). P884's
--        weekly and mid-week 'change' charges are no longer made (lead_spend_charge_nightly_only drops them).
--      * Statement descriptor OHVARA LEADS (the lead-spend function).
--
-- 5. Founding agents: the first founding_count paying agents (a paid plan, first money in) get founding_until = start
--    + founding_months and keep the price book version they joined on until then (billing_book_for).
--
-- FRONTEND CONTRACT (agent: my_billing(), admin: admin_billing_view(), both via billing_view):
--   + nightly (bool), settings { charge_hour, retry_hour, max_daily_cents, min_daily_cents }, card { on_file, label },
--     credit_cents, refund_cents (unspent credit and its 12%, refunded at cancel), next_charge { for_day, spend_cents,
--     credit_cents, net_cents, fee_cents, fee_rate, total_cents, at_hour, status }, founding { no, until, version } | null,
--     membership.clients { total, sold, added, included, over, extra_cents }, charges[].{ for_day, spend_cents,
--     fee_cents, credit_cents }.
--   rpc billing_added_clients_quote(p_new int)      Add clients: the count and the cost before saving.
--   rpc admin_billing_settings_save(p_settings jsonb), admin_billing_max_daily_set(p_agent uuid, p_cents int|null).
--   rpc admin_billing_revenue(p_from date, p_to date) plan fees and the 12% apart, per agent.
--   lead_spend_set / lead_product_set refuse over the max: P0001, hint 'max_daily'.

do $$
begin
  if to_regclass('public.billing_price_book') is null then raise exception 'p909: apply p884_billing_engine.sql first'; end if;
  if to_regclass('public.lead_split_rules') is null then raise exception 'p909: apply p889_one_lead_product.sql first'; end if;
  if to_regclass('public.agent_lead_pause') is null then raise exception 'p909: apply p890_cleanup.sql first'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'policies' and column_name = 'source') then
    raise exception 'p909: apply p891_book_import.sql first';
  end if;
  if not exists (select 1 from public.billing_price_book where version = 2) then raise exception 'p909: apply p901_price_book_v2.sql first'; end if;
  if exists (select 1 from public.billing_price_book where version = 3) then raise exception 'p909: price book version 3 already exists'; end if;
end $$;

-- ── 1. Price book version 3, final ──────────────────────────────────────────
insert into public.billing_price_book (version, effective_from, status, book, note) values (3, billing_today(), 'final',
  jsonb_build_object(
    'tiers', jsonb_build_array(
      jsonb_build_object('key', 'starter', 'label', 'Starter', 'from', 50,  'to', 75,  'monthly_cents', 69900),
      jsonb_build_object('key', 'growth',  'label', 'Growth',  'from', 76,  'to', 200, 'monthly_cents', 149900),
      jsonb_build_object('key', 'pro',     'label', 'Pro',     'from', 201, 'to', 500, 'monthly_cents', 299900)),
    'lead_fee_rate', 0.12,
    'servicing_only_cents', 49900,
    'servicing_base_clients', 100,
    'servicing_step_clients', 100,
    'servicing_step_cents', 20000,
    'included_added_clients', 50,
    'paid_min_daily_cents', 5000,
    'setup', jsonb_build_object('mode', 'fee', 'fee_cents', 29900, 'min_months', 0, 'refundable', false),
    'grace_days', 3,
    'card_fee_rate', 0.03,
    'low_days', 2),
  'P909: final prices, model B (Brayden, Nov 8). Plans by daily spend + 12% of lead spend, servicing by book size, $299 setup.');

-- ── 2. Settings (admin, one row) ────────────────────────────────────────────
create table public.billing_settings (
  id               boolean primary key default true check (id),
  charge_mode      text not null default 'nightly' check (charge_mode in ('nightly', 'weekly')),
  max_daily_cents  int not null default 50000 check (max_daily_cents between 5000 and 100000),
  charge_hour      int not null default 20 check (charge_hour between 12 and 23),
  retry_hour       int not null default 8 check (retry_hour between 5 and 11),
  founding_count   int not null default 20 check (founding_count between 0 and 1000),
  founding_months  int not null default 12 check (founding_months between 1 and 60),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id) on delete set null
);
insert into public.billing_settings default values;
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from public, anon, authenticated;
grant select on public.billing_settings to authenticated;
create policy bs_read on public.billing_settings for select to authenticated using (true);
comment on table public.billing_settings is
  'P909: max daily spend, the nightly charge and retry hours (Central), the founding lock. charge_mode weekly = the P884 engine (old tests only).';

create or replace function public.billing_nightly() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select charge_mode = 'nightly' from billing_settings where id), false)
$$;

-- Per agent: the max-spend override, the card on file, the founding place.
alter table public.agent_billing_plans
  add column max_daily_cents  int check (max_daily_cents between 5000 and 100000),
  add column card_on_file_at  timestamptz,
  add column card_label       text check (char_length(card_label) <= 60),
  add column founding_no      int check (founding_no > 0),
  add column founding_until   date,
  add column founding_version int;
create unique index agent_billing_plans_founding_idx on public.agent_billing_plans (founding_no) where founding_no is not null;

-- ── 3. Which book an agent is on (the founding lock), and the plan for a spend ─
create or replace function public.billing_book_for(p_agent uuid, p_on date default null) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; d date := coalesce(p_on, billing_today()); b jsonb;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if pl.founding_version is not null and pl.founding_until > d then
    select bk.book || jsonb_build_object('version', bk.version, 'effective_from', bk.effective_from, 'status', bk.status,
                                         'locked_until', pl.founding_until)
      into b from billing_price_book bk where bk.version = pl.founding_version;
    if b is not null then return b; end if;
  end if;
  return price_book(d);
end; $$;

-- The plan for a daily spend (whole dollars) in a book. Under the first band → the first; over the last → the last.
create or replace function public.billing_tier_in(p_book jsonb, p_daily_cents int) returns jsonb language sql immutable as $$
  with d as (select round(greatest(coalesce(p_daily_cents, 0), 0) / 100.0) as v),
       t as (select x.value as t from jsonb_array_elements(coalesce(p_book->'tiers', '[]'::jsonb)) x)
  select coalesce(
    (select t.t from t, d where d.v >= (t.t->>'from')::numeric and (t.t->'to' = 'null'::jsonb or d.v <= (t.t->>'to')::numeric)
      order by (t.t->>'from')::numeric limit 1),
    (select t.t from t, d where d.v < (t.t->>'from')::numeric order by (t.t->>'from')::numeric limit 1),
    (select t.t from t order by (t.t->>'from')::numeric desc limit 1))
$$;

create or replace function public.billing_tier_for(p_daily_cents int, p_on date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select billing_tier_in(price_book(p_on), p_daily_cents) || jsonb_build_object('version', (price_book(p_on)->>'version')::int)
$$;

-- ── 4. Founding agents: the first N paying agents keep their prices for M months ─
create or replace function public.billing_founding_claim() returns trigger language plpgsql
security definer set search_path = public as $$
declare st billing_settings; n int; since date := coalesce(new.paid_start, (new.setup_paid_at at time zone 'America/Chicago')::date);
begin
  if new.founding_no is not null or new.plan <> 'paid' or since is null then return new; end if;
  if exists (select 1 from profiles where id = new.agent_id and (coalesce(billing_exempt, false) or role <> 'agent')) then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('billing_founding', 0));
  select * into st from billing_settings where id;
  select count(*) into n from agent_billing_plans where founding_no is not null;
  if n >= coalesce(st.founding_count, 0) then return new; end if;
  new.founding_no := (select coalesce(max(founding_no), 0) + 1 from agent_billing_plans);
  new.founding_until := (since + make_interval(months => st.founding_months))::date;
  new.founding_version := (price_book(since)->>'version')::int;
  perform billing_log(new.agent_id, 'founding', null,
                      jsonb_build_object('no', new.founding_no, 'until', new.founding_until, 'version', new.founding_version),
                      'Founding agent: prices kept until ' || to_char(new.founding_until, 'Mon FMDD, YYYY'));
  return new;
end; $$;
create trigger billing_founding_claim before insert or update of plan, paid_start, setup_paid_at on public.agent_billing_plans
  for each row execute function public.billing_founding_claim();

-- ── 5. Max daily spend ($500, admin setting; one agent raised by hand) ──────
create or replace function public.billing_max_daily(p_agent uuid) returns int language sql stable security definer
set search_path = public as $$
  select coalesce((select max_daily_cents from agent_billing_plans where agent_id = p_agent),
                  (select max_daily_cents from billing_settings where id), 50000)
$$;

-- A requested change (next_cents) over the agent's max is refused, whoever writes it. Fires at the end of the
-- statement, so both lead-type rows of one change are in when the total is checked. The midnight promote
-- (next_cents back to null) never trips it.
create or replace function public.lead_spend_max_guard() returns trigger language plpgsql
security definer set search_path = public as $$
declare tot int; mx int;
begin
  if new.next_cents is null then return null; end if;
  if tg_op = 'UPDATE' and new.next_cents is not distinct from old.next_cents and new.next_from is not distinct from old.next_from then
    return null;
  end if;
  select coalesce(sum(coalesce(next_cents, daily_cents)), 0) into tot from agent_lead_spend where agent_id = new.agent_id;
  mx := billing_max_daily(new.agent_id);
  if tot > mx then
    raise exception 'Daily lead spend can be up to $% a day', mx / 100 using errcode = 'P0001', hint = 'max_daily';
  end if;
  return null;
end; $$;
create constraint trigger lead_spend_max_guard after insert or update on public.agent_lead_spend
  deferrable initially immediate for each row execute function public.lead_spend_max_guard();

-- ── 6. The card on file (required before leads start) ──────────────────────
-- The lead-spend function calls this after reading the customer's default card from Stripe (never a card number).
create or replace function public.billing_card_saved(p_agent uuid, p_label text) returns void language plpgsql
security definer set search_path = public as $$
declare pl agent_billing_plans;
begin
  pl := billing_plan(p_agent);
  update agent_billing_plans set card_on_file_at = case when p_label is null then null else now() end,
         card_label = left(p_label, 60), updated_at = now() where agent_id = p_agent;
  if pl.card_label is distinct from p_label then
    perform billing_log(p_agent, 'card', jsonb_build_object('label', pl.card_label), jsonb_build_object('label', p_label), null);
  end if;
  perform lead_spend_refresh_control(p_agent);
end; $$;

-- The agent's Stripe customer id, for the lead-spend function's card check (service role only).
create or replace function public.billing_customer_of(p_agent uuid) returns text language sql stable security definer
set search_path = public as $$
  select stripe_customer_id from profiles where id = p_agent and role = 'agent'
$$;

-- Agents who already have a Stripe customer from the old retainer (113) count as having a card on file.
insert into public.agent_billing_plans (agent_id, card_on_file_at)
select p.id, now() from public.profiles p where p.role = 'agent' and p.stripe_customer_id is not null
on conflict (agent_id) do update set card_on_file_at = coalesce(agent_billing_plans.card_on_file_at, excluded.card_on_file_at);

-- ── 7. Nightly charges ──────────────────────────────────────────────────────
alter table public.lead_spend_charges drop constraint lead_spend_charges_kind_check;
alter table public.lead_spend_charges add constraint lead_spend_charges_kind_check
  check (kind in ('weekly', 'change', 'va_cost', 'nightly'));
alter table public.lead_spend_charges
  add column for_day      date,
  add column spend_cents  int check (spend_cents >= 0),
  add column fee_cents    int check (fee_cents >= 0),
  add column credit_cents int check (credit_cents >= 0),
  add column fee_rate     numeric(5, 4);
alter table public.lead_spend_charges add constraint lead_spend_charges_nightly_check
  check (kind <> 'nightly' or (for_day is not null and spend_cents > 0 and fee_cents is not null and amount_cents = spend_cents + fee_cents));
create index lead_spend_charges_day_idx on public.lead_spend_charges (agent_id, for_day) where kind = 'nightly';
comment on column public.lead_spend_charges.fee_cents is
  'P909: the 12% on lead spend (nightly charges). Ohvara''s fee: it is not added to the wallet; spend_cents is.';

-- P884's weekly charge and mid-week raise charge are no longer made: spend is charged night by night.
create or replace function public.lead_spend_charge_nightly_only() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.kind in ('weekly', 'change') and billing_nightly() then return null; end if;
  return new;
end; $$;
create trigger lead_spend_charge_nightly_only before insert on public.lead_spend_charges
  for each row execute function public.lead_spend_charge_nightly_only();

-- A declined charge stops ads from its day; a nightly charge made for tomorrow doesn't stop tonight's.
create or replace function public.lead_spend_charge_failed(p_agent uuid) returns boolean language sql stable
security definer set search_path = public as $$
  select exists (select 1 from lead_spend_charges where agent_id = p_agent and status = 'failed'
                    and (kind in ('weekly', 'change') or (kind = 'nightly' and for_day <= billing_today())))
$$;
create or replace function public.lead_spend_charging(p_agent uuid) returns boolean language sql stable
security definer set search_path = public as $$
  select exists (select 1 from lead_spend_charges where agent_id = p_agent and status in ('due', 'processing')
                    and (kind in ('weekly', 'change') or (kind = 'nightly' and for_day <= billing_today())))
$$;

-- What runs right now. P884's matrix, plus: no card → no leads; today's charge not approved yet → waiting; no
-- "running low" (a nightly balance is one day by design).
create or replace function public.billing_runs(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare st text := billing_status_of(p_agent); pl agent_billing_plans; bal int := lead_spend_balance(p_agent);
        daily int := lead_spend_daily_total(p_agent); spend text; nightly boolean := billing_nightly(); today date := billing_today();
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
    when nightly and pl.card_on_file_at is null then 'no_card'
    when nightly and exists (select 1 from lead_spend_charges c where c.agent_id = p_agent and c.kind = 'nightly'
                                and c.for_day = today and c.status in ('due', 'processing')) then 'waiting_payment'
    when bal <= 0 and lead_spend_charging(p_agent) then 'waiting_payment'
    when bal <= 0 then 'out'
    when not nightly and bal < daily * coalesce((price_book()->>'low_days')::int, 2) then 'low'
    else 'running' end;
  return jsonb_build_object(
    'status', st,
    'lead_spend', spend,
    'ads', spend in ('running', 'low'),
    'pipeline', case when st in ('suspended', 'cancelled') then 'held' else 'yes' end,
    'transfers', st not in ('suspended', 'cancelled', 'none'),
    'servicing', st not in ('suspended', 'cancelled', 'none') and coalesce(pl.products, 'both') <> 'leads',
    'workspace', case when st = 'suspended' then 'billing_only' when st = 'cancelled' then 'none'
                      when st in ('past_due', 'waiting_acceptance') or spend in ('stopped_payment', 'no_card') then 'banner' else 'full' end);
end; $$;

-- P884's engine refresh, without the "running low / used up" notices when charging nightly (the balance is meant to
-- reach zero at the end of each day; the next night's charge refills it).
create or replace function public.lead_spend_refresh_control(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare r jsonb := billing_runs(p_agent); bal int := lead_spend_balance(p_agent); t text;
        d_a int := lead_spend_daily(p_agent, 'appts'); d_l int := lead_spend_daily(p_agent, 'live');
        d int; v_cap int; v_run boolean; v_reason text; wk date := billing_week_of(billing_today()); v_prev text;
begin
  select c0.reason into v_prev from agent_campaign_control c0 where c0.agent_id = p_agent and c0.lead_type = 'appts';
  foreach t in array array['appts', 'live'] loop
    d := case t when 'appts' then d_a else d_l end;
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
  if billing_nightly() then return; end if;
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

-- The 12%: lead plans only (pilot agents pay just their spend), from the agent's book (founding lock included).
create or replace function public.lead_spend_fee_rate(p_agent uuid, p_on date default null) returns numeric language sql stable
security definer set search_path = public as $$
  select case when coalesce((select plan from agent_billing_plans where agent_id = p_agent), 'paid') = 'pilot' then 0::numeric
              else coalesce((billing_book_for(p_agent, p_on)->>'lead_fee_rate')::numeric, 0) end
$$;

-- Credit: wallet money not needed for the rest of p_day (earlier days charged and not spent: the true-up).
create or replace function public.lead_spend_credit(p_agent uuid, p_day date default null) returns int language plpgsql stable
security definer set search_path = public as $$
declare d date := coalesce(p_day, billing_today()); bal int := lead_spend_balance(p_agent); billed int; reserved int := 0;
begin
  if (billing_runs(p_agent)->>'ads')::boolean then
    select coalesce(sum(billed_cents), 0) into billed from lead_spend_delivered where agent_id = p_agent and day = d;
    reserved := greatest(0, lead_spend_daily_total(p_agent, d) - billed);
  end if;
  return greatest(0, bal - least(bal, reserved));
end; $$;

-- Tonight's charge for one agent (for tomorrow): what it is, or would be at the current spend.
create or replace function public.lead_spend_next_charge(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare tmr date := billing_today() + 1; c lead_spend_charges; spend int := lead_spend_daily_total(p_agent, billing_today() + 1);
        credit int; net int; rate numeric := lead_spend_fee_rate(p_agent, billing_today() + 1); hr int;
begin
  select charge_hour into hr from billing_settings where id;
  select * into c from lead_spend_charges where agent_id = p_agent and kind = 'nightly' and for_day = tmr order by created_at desc limit 1;
  if c.id is not null then
    return jsonb_build_object('for_day', tmr, 'spend_cents', c.spend_cents + c.credit_cents, 'credit_cents', c.credit_cents,
      'net_cents', c.spend_cents, 'fee_cents', c.fee_cents, 'fee_rate', c.fee_rate, 'total_cents', c.amount_cents, 'at_hour', hr, 'status', c.status);
  end if;
  credit := lead_spend_credit(p_agent);
  net := greatest(0, spend - credit);
  return jsonb_build_object('for_day', tmr, 'spend_cents', spend, 'credit_cents', spend - net, 'net_cents', net,
    'fee_cents', round(net * rate)::int, 'fee_rate', rate, 'total_cents', net + round(net * rate)::int, 'at_hour', hr, 'status', 'planned');
end; $$;

-- Each evening: one charge per agent for tomorrow = (tomorrow's spend - credit) + 12% of that. Safe to run again
-- (one charge per agent per day). Agents paused for tomorrow, without a card, servicing only, or whose plan is past
-- due are skipped: nothing is charged for ads that won't run.
create or replace function public.lead_spend_nightly(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare v_day date := coalesce(p_day, billing_today()); tmr date := coalesce(p_day, billing_today()) + 1; a record;
        pl agent_billing_plans; spend int; credit int; net int; rate numeric; fee int; n int := 0;
begin
  if not billing_nightly() then return 0; end if;
  -- A declined day that has passed is let go: those ads never ran, so nothing is owed for them.
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · day passed, nothing owed', 300), updated_at = now()
   where kind = 'nightly' and status = 'failed' and for_day <= v_day;
  for a in select p.id from profiles p where p.role = 'agent' and coalesce(p.is_active, true) loop
    select * into pl from agent_billing_plans where agent_id = a.id;
    continue when pl.agent_id is null or pl.card_on_file_at is null or pl.products = 'servicing' or pl.spend_paused;
    continue when billing_status_of(a.id) not in ('pilot', 'active', 'waiting_acceptance');
    continue when exists (select 1 from agent_lead_pause z where z.agent_id = a.id and z.active and (z.resume_on is null or z.resume_on > tmr));
    continue when exists (select 1 from lead_spend_charges c where c.agent_id = a.id and c.kind = 'nightly' and c.for_day = tmr);
    spend := lead_spend_daily_total(a.id, tmr);
    continue when spend <= 0;
    credit := lead_spend_credit(a.id, v_day);
    net := greatest(0, spend - credit);
    if net = 0 then
      if not exists (select 1 from agent_billing_events e where e.agent_id = a.id and e.kind = 'nightly_covered' and e.after->>'for_day' = tmr::text) then
        perform billing_log(a.id, 'nightly_covered', null, jsonb_build_object('for_day', tmr, 'spend_cents', spend, 'credit_cents', credit),
                            'Credit covers tomorrow: nothing charged');
      end if;
      continue;
    end if;
    rate := lead_spend_fee_rate(a.id, tmr);
    fee := round(net * rate)::int;
    insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, credit_cents, fee_rate)
    values (a.id, billing_week_of(tmr), 'nightly', net + fee, 'nightly:' || a.id || ':' || tmr,
            'Lead spend for ' || to_char(tmr, 'Dy, Mon FMDD') || ': $' || to_char(net / 100.0, 'FM999990.00')
              || case when fee > 0 then ' + ' || round(rate * 100) || '% ($' || to_char(fee / 100.0, 'FM999990.00') || ')' else '' end
              || case when spend > net then ' · $' || to_char((spend - net) / 100.0, 'FM999990.00') || ' credit used' else '' end,
            tmr, net, fee, spend - net, rate)
    on conflict (key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end; $$;

-- The next morning: a declined charge for today is tried once more.
create or replace function public.lead_spend_morning_retry(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare n int; a uuid;
begin
  if not billing_nightly() then return 0; end if;
  update lead_spend_charges set status = 'due', failure = null, note = left(coalesce(note, '') || ' · morning retry', 300), updated_at = now()
   where kind = 'nightly' and status = 'failed' and for_day = coalesce(p_day, billing_today()) and attempts < 2;
  get diagnostics n = row_count;
  for a in select distinct agent_id from lead_spend_charges where kind = 'nightly' and for_day = coalesce(p_day, billing_today()) loop
    perform lead_spend_refresh_control(a);
  end loop;
  return n;
end; $$;

-- Every hour (cron): keep the engine instructions current (a new day's charge decides what runs), let go of declined
-- days that passed, retry this morning's declines at retry_hour, and make tonight's charges from charge_hour on
-- (a missed hour is caught up the next one).
create or replace function public.lead_spend_hourly(p_at timestamptz default null) returns jsonb language plpgsql
security definer set search_path = public as $$
declare h int := extract(hour from (coalesce(p_at, now()) at time zone 'America/Chicago'))::int; st billing_settings;
        r jsonb := '{}'::jsonb; a uuid; n int := 0;
begin
  if not billing_nightly() then return r; end if;
  select * into st from billing_settings where id;
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · day passed, nothing owed', 300), updated_at = now()
   where kind = 'nightly' and status = 'failed' and for_day < billing_today();
  for a in select agent_id from agent_billing_plans where products <> 'servicing' loop
    perform lead_spend_refresh_control(a); n := n + 1;
  end loop;
  r := jsonb_build_object('refreshed', n);
  if h >= st.retry_hour and h < st.charge_hour then r := r || jsonb_build_object('retried', lead_spend_morning_retry()); end if;
  if h >= st.charge_hour then r := r || jsonb_build_object('charged', lead_spend_nightly()); end if;
  return r;
end; $$;

-- The result of one charge (P884), plus nightly charges: the spend (not the 12%) lands in the wallet, a later approval
-- settles that day's earlier decline, and the first money in on a paid plan starts it (and claims a founding place).
create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges; st billing_settings; day_words text;
begin
  if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
  select * into c from lead_spend_charges where id = p_id for update;
  if not found then raise exception 'no such charge'; end if;
  if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
  select * into st from billing_settings where id;
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = p_id;
  day_words := case when c.for_day = billing_today() then 'Today''s' else 'Tomorrow''s' end;
  if p_status = 'paid' then
    if c.kind in ('weekly', 'change') then
      insert into lead_spend_ledger (agent_id, kind, cents, week_start, ref, note)
      values (c.agent_id, 'topup', c.amount_cents, billing_week_of(billing_today()), coalesce(p_pi, 'charge:' || c.id), c.note)
      on conflict do nothing;
      update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · settled by a later payment', 300), updated_at = now()
       where agent_id = c.agent_id and status = 'failed' and kind in ('weekly', 'change') and week_start <= c.week_start;
    elsif c.kind = 'nightly' then
      insert into lead_spend_ledger (agent_id, kind, cents, week_start, day, ref, note)
      values (c.agent_id, 'topup', c.spend_cents, billing_week_of(c.for_day), c.for_day, coalesce(p_pi, 'charge:' || c.id), c.note)
      on conflict do nothing;
      update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · settled by a later payment', 300), updated_at = now()
       where agent_id = c.agent_id and status = 'failed' and kind = 'nightly' and for_day <= c.for_day and id <> c.id;
      update agent_billing_plans set paid_start = billing_today(), updated_at = now()
       where agent_id = c.agent_id and plan = 'paid' and paid_start is null;
    end if;
    perform billing_log(c.agent_id, 'charge_paid', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'spend_cents', c.spend_cents,
                        'fee_cents', c.fee_cents, 'for_day', c.for_day, 'pi', p_pi), null);
    -- Nightly approvals are routine (one a day): a notice only when one went through after a decline.
    if c.kind <> 'nightly' or c.attempts > 1 then
      perform notify(c.agent_id, 'billing_charged', 'Payment received',
                     case c.kind when 'va_cost' then 'Team time for last week, paid.'
                                 when 'nightly' then 'Your card went through. ' || day_words || ' leads are on.'
                                 else 'Lead spend for this week is paid. Your leads are on.' end,
                     '/billing', false, 'charged:' || c.id, jsonb_build_object('cents', c.amount_cents));
    end if;
  elsif p_status = 'failed' then
    perform billing_log(c.agent_id, 'charge_failed', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'for_day', c.for_day, 'failure', p_failure), null);
    perform notify(c.agent_id, 'billing_charge_failed', 'Your card didn''t go through',
                   case when c.kind = 'nightly' and c.attempts < 2 and c.for_day > billing_today()
                          then day_words || ' leads are off until it''s paid. Fix your card, or we try again at '
                               || to_char(make_time(coalesce(st.retry_hour, 8), 0, 0), 'FMHH12 AM') || '.'
                        when c.kind = 'nightly' then day_words || ' leads are off. Fix your card and we try again straight away.'
                        else 'New leads are stopped until it''s paid. Update your card and we''ll try again straight away.' end,
                   '/billing', true, 'lead-failed:' || c.id || ':' || c.attempts, null);
    perform notify(adm.id, 'billing_payment_problem', 'A lead spend payment failed',
                   coalesce((select full_name from profiles where id = c.agent_id), 'An agent') || ': ' || coalesce(p_failure, 'declined'),
                   '/admin', true, 'lead-failed:' || c.id || ':' || c.attempts || ':' || adm.id, null)
      from profiles adm where adm.role = 'admin' and coalesce(adm.is_active, true);
  end if;
  perform lead_spend_refresh_control(c.agent_id);
  return jsonb_build_object('status', p_status);
end; $$;

-- ── 8. Servicing by book size ───────────────────────────────────────────────
-- Clients being serviced: live policies (Submitted, In Effect, Undrafted), sold through Ohvara or added by the agent.
create or replace function public.billing_client_counts(p_agent uuid) returns jsonb language sql stable
security definer set search_path = public as $$
  select jsonb_build_object('total', count(*), 'sold', count(*) filter (where source is distinct from 'agent_added'),
                            'added', count(*) filter (where source = 'agent_added'))
    from policies where agent_id = p_agent and archived_at is null and status in ('Submitted', 'In Effect', 'Undrafted')
$$;

-- +$200 for each started 100 over the included count.
create or replace function public.billing_extra_clients_cents(p_book jsonb, p_over int) returns int language sql immutable as $$
  select case when coalesce(p_over, 0) <= 0 or p_book->'servicing_step_cents' is null then 0
              else ceil(p_over / coalesce((p_book->>'servicing_step_clients')::numeric, 100))::int * (p_book->>'servicing_step_cents')::int end
$$;

-- What the next membership bill holds (848 builds the monthly Stripe bill from this). P884, plus: the agent's own
-- book (founding lock), extra clients by book size, the 12% rate and the founding place.
create or replace function public.agent_membership_due(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; pb jsonb := billing_book_for(p_agent); tier jsonb; mode text; fee int; v_months int; term_end date;
        base int; monthly int; cc jsonb := billing_client_counts(p_agent); incl int; cnt int; over int := 0; extra int := 0; lines jsonb;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if pl.agent_id is null then pl.plan := 'paid'; pl.products := 'both'; end if;
  if pl.plan = 'pilot' then
    return jsonb_build_object('plan', 'pilot', 'membership_cents', 0, 'setup_cents', 0, 'lines', '[]'::jsonb,
                              'clients', cc || jsonb_build_object('included', null, 'over', 0, 'extra_cents', 0), 'lead_fee_rate', 0);
  end if;
  if pl.products = 'servicing' then
    base := (pb->>'servicing_only_cents')::int;
    tier := jsonb_build_object('key', 'servicing', 'label', 'Servicing only', 'monthly_cents', base);
    incl := (pb->>'servicing_base_clients')::int; cnt := (cc->>'total')::int;
  else
    select t into tier from jsonb_array_elements(pb->'tiers') t where t->>'key' = pl.tier_key;
    tier := coalesce(tier, billing_tier_in(pb, lead_spend_daily_total(p_agent)));
    base := nullif(tier->>'monthly_cents', '')::int;
    incl := (pb->>'included_added_clients')::int; cnt := (cc->>'added')::int;
  end if;
  if incl is not null then over := greatest(0, cnt - incl); extra := billing_extra_clients_cents(pb, over); end if;
  monthly := base + extra;
  mode := coalesce(pl.setup_mode, pb->'setup'->>'mode');
  fee := case when pl.setup_paid_at is not null then 0 when mode = 'fee' then coalesce(pl.setup_fee_cents, (pb->'setup'->>'fee_cents')::int) else 0 end;
  v_months := case when mode = 'none_min_term' then coalesce(pl.min_term_months, (pb->'setup'->>'min_months')::int) else 0 end;
  term_end := case when v_months > 0 and pl.paid_start is not null then (pl.paid_start + make_interval(0, v_months))::date end;
  lines := jsonb_build_array(jsonb_build_object('label', case when pl.products = 'servicing' then 'Servicing only' else 'Plan, ' || (tier->>'label') end, 'cents', base));
  if extra > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('label', 'Extra clients: ' || over || ' over the ' || incl || ' included', 'cents', extra));
  end if;
  if fee > 0 then lines := lines || jsonb_build_array(jsonb_build_object('label', 'Setup (one time)', 'cents', fee)); end if;
  return jsonb_build_object(
    'plan', 'paid', 'tier', tier, 'next_tier', pl.next_tier_key, 'price_version', coalesce(pl.tier_version, (pb->>'version')::int),
    'membership_cents', monthly, 'plan_cents', base, 'extra_clients_cents', extra, 'setup_mode', mode, 'setup_cents', fee, 'min_term_end', term_end,
    'early_cancel_cents', case when term_end is not null and term_end > billing_today() and monthly is not null
                               then monthly * greatest(1, ceil(extract(epoch from (term_end::timestamp - billing_today()::timestamp)) / (86400 * 30.4))::int) else 0 end,
    'clients', cc || jsonb_build_object('included', incl, 'over', over, 'extra_cents', extra),
    'lead_fee_rate', lead_spend_fee_rate(p_agent),
    'lines', lines);
end; $$;

-- Add clients (P891): the count and the cost before saving.
create or replace function public.billing_added_clients_quote(p_new int) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare me uuid := auth.uid(); pl agent_billing_plans; pb jsonb; cc jsonb; svc boolean; incl int; now_n int; after_n int;
        x_now int; x_after int;
begin
  if me is null or not exists (select 1 from profiles where id = me and role = 'agent') then
    raise exception 'Only an agent can add clients' using errcode = '42501';
  end if;
  if p_new is null or p_new < 0 or p_new > 2000 then raise exception 'Between 0 and 2,000 clients' using errcode = '22023'; end if;
  select * into pl from agent_billing_plans where agent_id = me;
  pb := billing_book_for(me); cc := billing_client_counts(me);
  svc := coalesce(pl.products, 'both') = 'servicing';
  incl := case when coalesce(pl.plan, 'paid') = 'pilot' then null when svc then (pb->>'servicing_base_clients')::int else (pb->>'included_added_clients')::int end;
  now_n := case when svc then (cc->>'total')::int else (cc->>'added')::int end;
  after_n := now_n + p_new;
  x_now := case when incl is null then 0 else billing_extra_clients_cents(pb, now_n - incl) end;
  x_after := case when incl is null then 0 else billing_extra_clients_cents(pb, after_n - incl) end;
  return jsonb_build_object('counts', case when svc then 'all' else 'added' end, 'included', incl, 'count_now', now_n, 'count_after', after_n,
    'extra_now_cents', x_now, 'extra_after_cents', x_after, 'change_cents', x_after - x_now,
    'step_clients', coalesce((pb->>'servicing_step_clients')::int, 100), 'step_cents', coalesce((pb->>'servicing_step_cents')::int, 0),
    'pilot', coalesce(pl.plan, 'paid') = 'pilot');
end; $$;

-- ── 9. The billing read: P884's view plus the nightly charge, the card, credit, founding, settings ─
create or replace function public.billing_view(p_agent uuid, p_admin boolean) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; wk date := billing_week_of(billing_today()); v jsonb; st billing_settings; bal int := lead_spend_balance(p_agent);
        rate numeric := lead_spend_fee_rate(p_agent);
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  select * into st from billing_settings where id;
  v := jsonb_build_object(
    'plan', coalesce(pl.plan, 'paid'), 'products', coalesce(pl.products, 'both'), 'pilot_start', pl.pilot_start,
    'state', billing_runs(p_agent),
    'balance_cents', bal,
    'spend', jsonb_build_object('appts', lead_spend_daily(p_agent, 'appts'), 'live', lead_spend_daily(p_agent, 'live'),
                                'next', (select jsonb_object_agg(lead_type, next_cents) from agent_lead_spend where agent_id = p_agent and next_from is not null),
                                'next_from', (select min(next_from) from agent_lead_spend where agent_id = p_agent)),
    'week', lead_spend_week_report(p_agent, wk),
    'membership', agent_membership_due(p_agent),
    'to_paid', pl.to_paid,
    'va_cost', case when coalesce(pl.va_cost_on, false) then pilot_va_cost(p_agent, wk, billing_today()) end,
    'charges', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'week_start', week_start, 'cents', amount_cents,
                                  'status', status, 'failure', failure, 'note', note, 'at', created_at, 'for_day', for_day,
                                  'spend_cents', spend_cents, 'fee_cents', fee_cents, 'credit_cents', credit_cents) order by created_at desc)
                           from (select * from lead_spend_charges where agent_id = p_agent order by created_at desc limit 30) c), '[]'::jsonb),
    'grace_until', (select billing_grace_until from profiles where id = p_agent),
    'price_book', billing_book_for(p_agent),
    'nightly', billing_nightly(),
    'settings', jsonb_build_object('charge_hour', st.charge_hour, 'retry_hour', st.retry_hour, 'max_daily_cents', billing_max_daily(p_agent),
                                   'min_daily_cents', (price_book()->>'paid_min_daily_cents')::int),
    'card', jsonb_build_object('on_file', pl.card_on_file_at is not null, 'label', pl.card_label),
    'credit_cents', lead_spend_credit(p_agent),
    'refund_cents', bal + round(bal * rate)::int,
    'next_charge', lead_spend_next_charge(p_agent),
    'founding', case when pl.founding_no is not null then jsonb_build_object('no', pl.founding_no, 'until', pl.founding_until,
                                                                              'version', pl.founding_version, 'active', pl.founding_until > billing_today()) end);
  if p_admin then
    v := v || jsonb_build_object(
      'pilot_note', pl.pilot_note, 'va_cost_on', coalesce(pl.va_cost_on, false), 'va_rate_cents', coalesce(pl.va_rate_cents, 800),
      'max_daily_override_cents', pl.max_daily_cents,
      'controls', (select jsonb_agg(to_jsonb(c)) from agent_campaign_control c where c.agent_id = p_agent),
      'ledger', (select jsonb_agg(to_jsonb(l) order by l.id desc) from (select * from lead_spend_ledger where agent_id = p_agent order by id desc limit 50) l),
      'events', (select jsonb_agg(to_jsonb(e) order by e.id desc) from (select * from agent_billing_events where agent_id = p_agent order by id desc limit 50) e));
  end if;
  return v;
end; $$;

-- ── 10. Admin ───────────────────────────────────────────────────────────────
create or replace function public.admin_billing_settings_save(p_settings jsonb) returns jsonb language plpgsql
security definer set search_path = public as $$
declare before billing_settings; after billing_settings;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into before from billing_settings where id;
  update billing_settings set
    max_daily_cents = coalesce((p_settings->>'max_daily_cents')::int, max_daily_cents),
    charge_hour = coalesce((p_settings->>'charge_hour')::int, charge_hour),
    retry_hour = coalesce((p_settings->>'retry_hour')::int, retry_hour),
    founding_count = coalesce((p_settings->>'founding_count')::int, founding_count),
    founding_months = coalesce((p_settings->>'founding_months')::int, founding_months),
    updated_at = now(), updated_by = auth.uid()
  where id returning * into after;
  insert into agent_billing_events (agent_id, kind, before, after, reason, by_user)
  select auth.uid(), 'billing_settings', to_jsonb(before), to_jsonb(after), 'Billing settings changed', auth.uid()
   where auth.uid() is not null;
  return to_jsonb(after);
end; $$;

-- One agent's max daily spend, raised (or lowered) by hand; null goes back to the setting.
create or replace function public.admin_billing_max_daily_set(p_agent uuid, p_cents int) returns int language plpgsql
security definer set search_path = public as $$
declare pl agent_billing_plans;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if (select role from profiles where id = p_agent) is distinct from 'agent' then raise exception 'Not an agent'; end if;
  if p_cents is not null and p_cents not between 5000 and 100000 then raise exception 'Between $50 and $1,000 a day' using errcode = '22023'; end if;
  pl := billing_plan(p_agent);
  update agent_billing_plans set max_daily_cents = p_cents, updated_at = now() where agent_id = p_agent;
  perform billing_log(p_agent, 'max_daily', jsonb_build_object('cents', pl.max_daily_cents), jsonb_build_object('cents', p_cents),
                      case when p_cents is null then 'Back to the standard max' else 'Max raised by hand' end);
  return billing_max_daily(p_agent);
end; $$;

-- Revenue between two days: lead spend passed through, the 12% and plan fees, apart (and per agent).
create or replace function public.admin_billing_revenue(p_from date, p_to date) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare rows jsonb;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r order by r->>'name'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'agent_id', p.id, 'name', p.full_name, 'plan', coalesce(pl.plan, 'paid'), 'products', coalesce(pl.products, 'both'),
      'plan_fee_cents', case when coalesce(pl.plan, 'paid') = 'pilot' then 0 else coalesce((agent_membership_due(p.id)->>'membership_cents')::int, 0) end,
      'lead_spend_cents', coalesce((select sum(case when c.kind = 'nightly' then c.spend_cents else c.amount_cents end) from lead_spend_charges c
                                     where c.agent_id = p.id and c.status = 'paid' and c.kind in ('nightly', 'weekly', 'change')
                                       and coalesce(c.for_day, (c.created_at at time zone 'America/Chicago')::date) between p_from and p_to), 0),
      'lead_fee_cents', coalesce((select sum(c.fee_cents) from lead_spend_charges c where c.agent_id = p.id and c.status = 'paid'
                                   and c.kind = 'nightly' and c.for_day between p_from and p_to), 0)) as r
      from profiles p left join agent_billing_plans pl on pl.agent_id = p.id
     where p.role = 'agent' and coalesce(p.is_active, true)) x;
  return jsonb_build_object('from', p_from, 'to', p_to, 'agents', rows,
    'plan_fees_monthly_cents', (select coalesce(sum((r->>'plan_fee_cents')::int), 0) from jsonb_array_elements(rows) r),
    'lead_spend_cents', (select coalesce(sum((r->>'lead_spend_cents')::int), 0) from jsonb_array_elements(rows) r),
    'lead_fee_cents', (select coalesce(sum((r->>'lead_fee_cents')::int), 0) from jsonb_array_elements(rows) r));
end; $$;

-- ── 11. Founding places for agents already paying (in the order they started) ─
do $$
declare st public.billing_settings; a record; n int := coalesce((select max(founding_no) from public.agent_billing_plans), 0);
        v3 date := (select effective_from from public.billing_price_book where version = 3);
begin
  select * into st from public.billing_settings where id;
  for a in select pl.agent_id, coalesce(pl.paid_start, (pl.setup_paid_at at time zone 'America/Chicago')::date) as since
             from public.agent_billing_plans pl join public.profiles p on p.id = pl.agent_id
            where pl.plan = 'paid' and pl.founding_no is null and p.role = 'agent' and not coalesce(p.billing_exempt, false)
              and coalesce(pl.paid_start, (pl.setup_paid_at at time zone 'America/Chicago')::date) is not null
            order by 2, pl.agent_id loop
    exit when n >= st.founding_count;
    n := n + 1;
    update public.agent_billing_plans
       set founding_no = n, founding_version = 3,
           founding_until = (greatest(a.since, v3) + make_interval(months => st.founding_months))::date
     where agent_id = a.agent_id;
  end loop;
end $$;

-- ── 12. Grants ──────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'billing_nightly()', 'billing_book_for(uuid,date)', 'billing_tier_in(jsonb,integer)', 'billing_tier_for(integer,date)',
    'billing_max_daily(uuid)', 'billing_card_saved(uuid,text)', 'billing_customer_of(uuid)', 'lead_spend_charge_failed(uuid)', 'lead_spend_charging(uuid)',
    'billing_runs(uuid)', 'lead_spend_refresh_control(uuid)', 'lead_spend_fee_rate(uuid,date)', 'lead_spend_credit(uuid,date)',
    'lead_spend_next_charge(uuid)', 'lead_spend_nightly(date)', 'lead_spend_morning_retry(date)', 'lead_spend_hourly(timestamptz)',
    'lead_spend_charge_result(uuid,text,text,text)', 'billing_client_counts(uuid)', 'billing_extra_clients_cents(jsonb,integer)',
    'agent_membership_due(uuid)', 'billing_added_clients_quote(integer)', 'billing_view(uuid,boolean)',
    'admin_billing_settings_save(jsonb)', 'admin_billing_max_daily_set(uuid,integer)', 'admin_billing_revenue(date,date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- What a signed-in user may call (each checks the caller inside). billing_tier_for stays callable (P884).
  foreach f in array array['billing_tier_for(integer,date)', 'billing_added_clients_quote(integer)', 'admin_billing_settings_save(jsonb)',
    'admin_billing_max_daily_set(uuid,integer)', 'admin_billing_revenue(date,date)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── 13. Cron: every hour at :02 (the lead-spend function still charges what's due every 15 minutes) ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lead-spend-hourly';
    perform cron.schedule('lead-spend-hourly', '2 * * * *', 'select public.lead_spend_hourly()');
  end if;
end $$;

-- Every agent's engine instructions follow the new rules from today.
do $$
declare a uuid;
begin
  for a in select agent_id from public.agent_billing_plans where products <> 'servicing' loop perform public.lead_spend_refresh_control(a); end loop;
end $$;
