-- 257_plan_change (Prompt 921, Brayden Nov 9 17:16; applied on live Nov 9 with Brayden's yes): plan changes are paid fairly.
--
-- Before: a plan followed the daily spend band and changed "from the next bill" (P884/P920), so an agent could move
-- to Pro, spend up to $500 a day for the rest of the month and pay Pro only from next month. Lead spend itself was
-- safe (charged nightly); the plan fee wasn't.
--
-- Now:
--   1. Moving up (Starter → Growth → Pro): the prorated difference is charged now, for the days left in this billing
--      month: (new price − old price) × days left ÷ days in the month, rounded to the cent. It is a one-off charge
--      (kind 'plan_upgrade', an off-session PaymentIntent through lead-spend, like the nightly charges), so the
--      bill date never moves; the next bill is the full new price. The higher band opens ONLY when the charge is
--      paid. Declined → nothing changes (plan, band and spend stay; the agent sees Fix card), and a declined upgrade
--      is never retried by itself (the agent switches again). Founding agents are prorated on their locked prices.
--   2. Moving down: from the next bill date (next_tier_key + next_tier_from). No refund; the agent keeps the higher
--      band until then. On that date the daily sweep switches the plan, and a daily spend above the new band is set
--      to the top of the new band (the nightly charge follows).
--   3. One change at a time: an upgrade (once paid) cancels a pending downgrade; a second upgrade in the same month
--      charges only the new difference (old price = the plan they're on now); switching back to the plan they're on
--      is Undo for a pending downgrade.
--   4. The spend cap: lead_spend_set refuses a daily spend above the plan's band (hint 'over_plan'); the plan no
--      longer follows the spend. The top plan's cap is the agent's max (billing_max_daily, an admin can raise it).
--   5. Admins: admin_billing_plan_set (switch now, no charge, logged), admin_billing_pending_downgrades (the list).
--
-- The sums match src/lib/planChange.js (src/p921.test.js checks both). Tests: supabase/tests/p921_plan_change.sql.
-- Wrappers: lead_spend_charge_result and billing_daily_sweep are renamed (…_p910 / …_p884) and wrapped, so their long
-- bodies aren't copied here. A later migration that redefines either must keep the plan_upgrade / plan roll-over step.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.agent_billing_plans add column if not exists next_tier_from date;
comment on column public.agent_billing_plans.next_tier_from is
  'P921: the bill date a scheduled downgrade (next_tier_key) takes effect. Null = none scheduled.';

alter table public.lead_spend_charges drop constraint lead_spend_charges_kind_check;
alter table public.lead_spend_charges add constraint lead_spend_charges_kind_check
  check (kind in ('weekly', 'change', 'va_cost', 'nightly', 'plan_upgrade'));
alter table public.lead_spend_charges
  add column tier_from        text,
  add column tier_to          text,
  add column days_left        int check (days_left >= 0),
  add column days_in_month    int check (days_in_month between 28 and 31),
  add column plan_daily_cents int check (plan_daily_cents >= 0);
alter table public.lead_spend_charges add constraint lead_spend_charges_upgrade_check
  check (kind <> 'plan_upgrade' or (tier_from is not null and tier_to is not null and days_left > 0 and days_in_month is not null));

-- ── 2. The billing month: the bill date before and after today ──────────────
-- The next bill: the Stripe period end when there is one in the future, else the monthly anniversary of the first
-- paid day (paid_start, or the setup payment), else the 1st of next month. start = the bill before it.
create or replace function public.billing_bill_month(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; today date := billing_today(); pe date; anchor date; k int; nxt date; st date;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  select (billing_current_period_end at time zone 'America/Chicago')::date into pe from profiles where id = p_agent;
  if pe is not null and pe > today then
    nxt := pe; st := (pe - interval '1 month')::date;
  else
    anchor := coalesce(pl.paid_start, (pl.setup_paid_at at time zone 'America/Chicago')::date);
    if anchor is null or anchor > today then
      nxt := (date_trunc('month', today) + interval '1 month')::date; st := date_trunc('month', today)::date;
    else
      k := (extract(year from age(today, anchor)) * 12 + extract(month from age(today, anchor)))::int;
      while (anchor + make_interval(months => k + 1))::date <= today loop k := k + 1; end loop;
      while k > 0 and (anchor + make_interval(months => k))::date > today loop k := k - 1; end loop;
      st := (anchor + make_interval(months => k))::date;
      nxt := (anchor + make_interval(months => k + 1))::date;
    end if;
  end if;
  return jsonb_build_object('start', st, 'next', nxt, 'days', nxt - st, 'left', greatest(0, least(nxt - st, nxt - today)));
end; $$;

-- ── 3. The plan an agent is on, and its spend cap ───────────────────────────
-- From their own book (founding prices while locked). No tier saved yet → the plan for their spend.
create or replace function public.billing_current_tier(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; book jsonb := billing_book_for(p_agent); t jsonb;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  select x into t from jsonb_array_elements(book->'tiers') x where x->>'key' = pl.tier_key;
  return coalesce(t, billing_tier_in(book, lead_spend_daily_total(p_agent, billing_today() + 1)));
end; $$;

-- The most a day the plan allows (cents): its band's top; the top plan's is the agent's max.
create or replace function public.billing_tier_cap(p_agent uuid, p_tier jsonb) returns int language sql stable
security definer set search_path = public as $$
  select case
    when p_tier->'to' is null or p_tier->'to' = 'null'::jsonb
      or not exists (select 1 from jsonb_array_elements(billing_book_for(p_agent)->'tiers') x where (x->>'from')::int > (p_tier->>'from')::int)
      then billing_max_daily(p_agent)
    else least((p_tier->>'to')::int * 100, billing_max_daily(p_agent)) end
$$;

-- ── 4. The daily spend, moved for a plan change (the agent's lead product when set, else appointments only) ──
create or replace function public.billing_set_daily(p_agent uuid, p_cents int) returns void language plpgsql
security definer set search_path = public as $$
declare lp record;
begin
  if p_cents is null or p_cents = lead_spend_daily_total(p_agent, billing_today() + 1) then return; end if;
  select * into lp from agent_lead_product where agent_id = p_agent;
  if lp.agent_id is not null then
    perform lead_product_set(p_cents, lp.mode, lp.live_hours, lp.tz, p_agent);
  else
    perform lead_spend_set(p_cents, 0, p_agent);
  end if;
end; $$;

-- ── 5. Switch the plan now (an upgrade once paid, a downgrade on its date, an admin) ──
-- p_daily_cents: where the daily spend goes (null = keep it); either way it's capped at the new band's top.
create or replace function public.billing_plan_apply(p_agent uuid, p_tier text, p_daily_cents int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl agent_billing_plans; book jsonb := billing_book_for(p_agent); t jsonb; cap int; cur int; want int;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent for update;
  select x into t from jsonb_array_elements(book->'tiers') x where x->>'key' = p_tier;
  if t is null then raise exception 'No such plan' using errcode = '22023'; end if;
  update agent_billing_plans set tier_key = p_tier, tier_version = (book->>'version')::int, next_tier_key = null, next_tier_from = null,
         updated_at = now() where agent_id = p_agent;
  perform billing_log(p_agent, 'tier', jsonb_build_object('tier', pl.tier_key, 'next', pl.next_tier_key, 'next_from', pl.next_tier_from),
                      jsonb_build_object('tier', p_tier), p_reason);
  cap := billing_tier_cap(p_agent, t);
  cur := lead_spend_daily_total(p_agent, billing_today() + 1);
  want := least(coalesce(p_daily_cents, cur), cap);
  if want >= coalesce((price_book()->>'paid_min_daily_cents')::int, 5000) and want <> cur then perform billing_set_daily(p_agent, want); end if;
  perform lead_spend_refresh_control(p_agent);
  return jsonb_build_object('tier', t, 'daily_cents', lead_spend_daily_total(p_agent, billing_today() + 1));
end; $$;

-- ── 6. What a switch would do (the confirm), and the switch itself ──────────
create or replace function public.billing_plan_quote_for(p_agent uuid, p_tier text) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; book jsonb := billing_book_for(p_agent); cur jsonb := billing_current_tier(p_agent); t jsonb;
        m jsonb := billing_bill_month(p_agent); dir text; amt int := 0; ci int; ti int;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  select x into t from jsonb_array_elements(book->'tiers') x where x->>'key' = p_tier;
  if t is null then raise exception 'No such plan' using errcode = '22023'; end if;
  ci := (cur->>'from')::int; ti := (t->>'from')::int;
  dir := case when t->>'key' = cur->>'key' then case when pl.next_tier_key is not null then 'undo' else 'same' end
              when ti > ci then 'up' else 'down' end;
  if dir = 'up' then
    amt := greatest(0, round(((t->>'monthly_cents')::int - (cur->>'monthly_cents')::int)::numeric * (m->>'left')::int / (m->>'days')::int)::int);
  end if;
  return jsonb_build_object('direction', dir, 'from', cur, 'to', t, 'amount_cents', amt, 'days_left', (m->>'left')::int,
                            'days_in_month', (m->>'days')::int, 'next_bill', m->>'next', 'month_start', m->>'start',
                            'pending', case when pl.next_tier_key is not null then jsonb_build_object('tier', pl.next_tier_key, 'from', pl.next_tier_from) end,
                            'locked_until', book->'locked_until');
end; $$;

create or replace function public.billing_plan_quote(p_tier text) returns jsonb language plpgsql stable
security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return billing_plan_quote_for(auth.uid(), p_tier);
end; $$;

-- The agent switches plan (or the service role for them). p_daily_cents: the spend they picked in the new band
-- (null = the nearest spot in it). Up → a 'plan_upgrade' charge (lead-spend charges it straight away); the plan
-- changes when it's paid. Down → scheduled for the next bill. Same plan → Undo a scheduled downgrade.
create or replace function public.billing_plan_change(p_tier text, p_daily_cents int default null, p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans; q jsonb; t jsonb; cur jsonb; ch uuid; d int; lo int; hi int;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_agent is not null and p_agent <> coalesce(auth.uid(), p_agent) and not is_admin() then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  if (select role from profiles where id = me) is distinct from 'agent' then raise exception 'Agents only' using errcode = '42501'; end if;
  pl := billing_plan(me);
  select * into pl from agent_billing_plans where agent_id = me for update;
  if pl.products = 'servicing' then raise exception 'Servicing only has no lead plan to switch' using errcode = 'P0001', hint = 'servicing_only'; end if;
  if exists (select 1 from lead_spend_charges where agent_id = me and kind = 'plan_upgrade' and status in ('due', 'processing')) then
    raise exception 'Your last plan change is still going through. Try again in a minute.' using errcode = 'P0001', hint = 'busy';
  end if;
  -- The plan they're on is saved from here on (an agent who never set one is on the plan for their spend).
  if pl.tier_key is null then
    cur := billing_current_tier(me);
    update agent_billing_plans set tier_key = cur->>'key', tier_version = (billing_book_for(me)->>'version')::int, updated_at = now() where agent_id = me;
  end if;
  q := billing_plan_quote_for(me, p_tier);
  t := q->'to'; cur := q->'from';

  if q->>'direction' in ('same', 'undo') then
    if q->>'direction' = 'undo' then
      update agent_billing_plans set next_tier_key = null, next_tier_from = null, updated_at = now() where agent_id = me;
      perform billing_log(me, 'tier_next', jsonb_build_object('tier', pl.next_tier_key, 'from', pl.next_tier_from), jsonb_build_object('tier', null),
                          'Undo: stays on ' || (cur->>'label'));
    end if;
    return q;
  end if;

  if q->>'direction' = 'down' then
    update agent_billing_plans set next_tier_key = t->>'key', next_tier_from = (q->>'next_bill')::date, updated_at = now() where agent_id = me;
    perform billing_log(me, 'tier_next', jsonb_build_object('tier', cur->>'key'), jsonb_build_object('tier', t->>'key', 'from', q->>'next_bill'),
                        'Moving down: from the next bill');
    perform notify(me, 'billing_tier_change', 'Your plan changes on ' || to_char((q->>'next_bill')::date, 'Mon FMDD'),
                   'You move to ' || (t->>'label') || ' on ' || to_char((q->>'next_bill')::date, 'Mon FMDD') || '. You keep '
                   || (cur->>'label') || ' and its spend range until then.', '/billing', false,
                   'tier-down:' || me || ':' || (t->>'key') || ':' || (q->>'next_bill'), null);
    return q;
  end if;

  -- Up. Where the daily spend lands in the new band (the confirm said so), once it's paid.
  lo := greatest((price_book()->>'paid_min_daily_cents')::int, ceil((t->>'from')::numeric / 5) * 500);
  hi := billing_tier_cap(me, t);
  d := least(hi, greatest(lo, coalesce(p_daily_cents, lead_spend_daily_total(me, billing_today() + 1))));
  -- A declined upgrade from before is never retried: this switch replaces it.
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · replaced by a new plan change', 300), updated_at = now()
   where agent_id = me and kind = 'plan_upgrade' and status = 'failed';
  if (q->>'amount_cents')::int <= 0 then
    perform billing_plan_apply(me, t->>'key', d, 'Moving up: nothing left to prorate');
    return q || jsonb_build_object('applied', true);
  end if;
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, tier_from, tier_to, days_left, days_in_month, plan_daily_cents)
  values (me, billing_week_of(billing_today()), 'plan_upgrade', (q->>'amount_cents')::int,
          'plan_upgrade:' || me || ':' || (t->>'key') || ':' || gen_random_uuid(),
          'Upgrade to ' || (t->>'label') || ', ' || (q->>'days_left') || ' day' || case when (q->>'days_left')::int = 1 then '' else 's' end,
          cur->>'key', t->>'key', (q->>'days_left')::int, (q->>'days_in_month')::int, d)
  returning id into ch;
  perform billing_log(me, 'plan_upgrade', jsonb_build_object('tier', cur->>'key'),
                      jsonb_build_object('tier', t->>'key', 'cents', (q->>'amount_cents')::int, 'days_left', q->'days_left', 'charge', ch), 'Moving up: charged now');
  return q || jsonb_build_object('charge_id', ch);
end; $$;

-- What Billing shows: the plan, a scheduled downgrade, the billing month, an upgrade going through or declined.
create or replace function public.billing_plan_state(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; up lead_spend_charges;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  select * into up from lead_spend_charges where agent_id = p_agent and kind = 'plan_upgrade' and status in ('due', 'processing', 'failed')
   order by created_at desc limit 1;
  return jsonb_build_object('tier', billing_current_tier(p_agent), 'cap_cents', billing_tier_cap(p_agent, billing_current_tier(p_agent)),
    'pending', case when pl.next_tier_key is not null then jsonb_build_object('tier', pl.next_tier_key, 'from', pl.next_tier_from) end,
    'month', billing_bill_month(p_agent),
    'upgrade', case when up.id is not null then jsonb_build_object('id', up.id, 'to', up.tier_to, 'cents', up.amount_cents, 'status', up.status,
                                                                   'failure', up.failure, 'days_left', up.days_left) end);
end; $$;

create or replace function public.my_plan_state() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return billing_plan_state(auth.uid());
end; $$;

-- ── 7. Admins ───────────────────────────────────────────────────────────────
-- Switch an agent's plan now, no charge (a goodwill move or a fix), logged with the reason.
create or replace function public.admin_billing_plan_set(p_agent uuid, p_tier text, p_reason text) returns jsonb language plpgsql
security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why' using errcode = '22023'; end if;
  return billing_plan_apply(p_agent, p_tier, null, 'Admin: ' || left(p_reason, 400));
end; $$;

create or replace function public.admin_billing_pending_downgrades() returns jsonb language plpgsql stable
security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('agent_id', p.agent_id, 'name', pr.full_name, 'tier', p.tier_key, 'next_tier', p.next_tier_key,
                                                       'from', p.next_tier_from, 'daily_cents', lead_spend_daily_total(p.agent_id, billing_today() + 1))
                                    order by p.next_tier_from, pr.full_name)
                     from agent_billing_plans p join profiles pr on pr.id = p.agent_id where p.next_tier_key is not null), '[]'::jsonb);
end; $$;

-- ── 8. The charge result: an upgrade's own branch, everything else as P910 ──
alter function public.lead_spend_charge_result(uuid, text, text, text) rename to lead_spend_charge_result_p910;

create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges; t jsonb; was text;
begin
  select * into c from lead_spend_charges where id = p_id;
  if not found then raise exception 'no such charge'; end if;
  if c.kind <> 'plan_upgrade' then return lead_spend_charge_result_p910(p_id, p_status, p_pi, p_failure); end if;
  if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
  select * into c from lead_spend_charges where id = p_id for update;
  if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = p_id;
  select x into t from jsonb_array_elements(billing_book_for(c.agent_id)->'tiers') x where x->>'key' = c.tier_to;
  was := (select x->>'label' from jsonb_array_elements(billing_book_for(c.agent_id)->'tiers') x where x->>'key' = c.tier_from);
  if p_status = 'paid' then
    -- The higher band opens now; a scheduled downgrade is cancelled (one change at a time).
    perform billing_plan_apply(c.agent_id, c.tier_to, c.plan_daily_cents, 'Moving up: paid ' || c.note);
    perform billing_log(c.agent_id, 'charge_paid', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'tier', c.tier_to, 'pi', p_pi), null);
    perform notify(c.agent_id, 'billing_charged', 'You''re on ' || coalesce(t->>'label', c.tier_to),
                   'Paid $' || to_char(c.amount_cents / 100.0, 'FM999,990.00') || ' for the ' || c.days_left || ' day'
                   || case when c.days_left = 1 then '' else 's' end || ' left this month. Your ' || coalesce(t->>'label', c.tier_to)
                   || ' spend range is open now.', '/billing', false, 'upgrade-paid:' || c.id, jsonb_build_object('cents', c.amount_cents));
  elsif p_status = 'failed' then
    perform billing_log(c.agent_id, 'charge_failed', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'tier', c.tier_to, 'failure', p_failure), null);
    perform notify(c.agent_id, 'billing_charge_failed', 'Your upgrade didn''t go through',
                   'Nothing changed: you''re still on ' || coalesce(was, c.tier_from) || '. Fix your card, then switch again.',
                   '/billing', true, 'upgrade-failed:' || c.id || ':' || c.attempts, null);
  end if;
  return jsonb_build_object('status', p_status);
end; $$;

-- A declined upgrade is never retried by itself (Fix card retries lead spend only; the agent switches again).
create or replace function public.lead_spend_retry(p_agent uuid default null) returns int language plpgsql
security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); n int;
begin
  if me is null or (p_agent is not null and p_agent <> coalesce(auth.uid(), p_agent) and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  update lead_spend_charges set status = 'due', failure = null, updated_at = now()
   where agent_id = me and status = 'failed' and kind <> 'plan_upgrade';
  get diagnostics n = row_count;
  perform lead_spend_refresh_control(me);
  return n;
end; $$;

-- ── 9. The bill date: scheduled downgrades take over ────────────────────────
create or replace function public.billing_plan_rollover(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare a record; n int := 0; d date := coalesce(p_day, billing_today()); t jsonb;
begin
  for a in select agent_id, next_tier_key from agent_billing_plans where next_tier_key is not null and next_tier_from <= d loop
    perform billing_plan_apply(a.agent_id, a.next_tier_key, null, 'Moving down: the new bill');
    select x into t from jsonb_array_elements(billing_book_for(a.agent_id)->'tiers') x where x->>'key' = a.next_tier_key;
    perform notify(a.agent_id, 'billing_tier_change', 'You''re on ' || coalesce(t->>'label', a.next_tier_key),
                   'Your plan changed with today''s bill. Daily spend is up to $' || (billing_tier_cap(a.agent_id, t) / 100) || ' a day.',
                   '/billing', false, 'tier-rolled:' || a.agent_id || ':' || d, null);
    n := n + 1;
  end loop;
  return n;
end; $$;

alter function public.billing_daily_sweep() rename to billing_daily_sweep_p884;
create or replace function public.billing_daily_sweep() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- Plans first: a spend capped by a downgrade lands in agent_lead_spend before the spend changes are swept in.
  n := billing_plan_rollover();
  return n + billing_daily_sweep_p884();
end; $$;

-- A renewed Stripe period (agent-billing) is a new bill too: a waiting downgrade takes over, through the same path.
create or replace function public.billing_period_rolled(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare pl agent_billing_plans;
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if pl.agent_id is null or pl.next_tier_key is null then return; end if;
  perform billing_plan_apply(p_agent, pl.next_tier_key, null, 'New bill: scheduled plan change');
end; $$;

-- ── 10. Daily spend stays inside the plan's band (P884's setter, minus "the plan follows the spend") ──
create or replace function public.lead_spend_set(p_appts_cents int, p_live_cents int, p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans; today date := billing_today();
        tomorrow date := billing_today() + 1; wk date := billing_week_of(billing_today());
        days_left int := 7 - extract(isodow from billing_today())::int;
        old_a int; old_l int; total int := coalesce(p_appts_cents, 0) + coalesce(p_live_cents, 0);
        v_min int := coalesce((price_book()->>'paid_min_daily_cents')::int, 5000); extra int; ch uuid; tier jsonb; cap int;
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
  -- P921: the first spend picks the plan; after that the spend can't go over the plan's band (switch plan first).
  if pl.plan = 'paid' and pl.products <> 'servicing' then
    if pl.tier_key is null then
      tier := billing_tier_in(billing_book_for(me), total);
      update agent_billing_plans set tier_key = tier->>'key', tier_version = (billing_book_for(me)->>'version')::int, updated_at = now() where agent_id = me;
    else
      tier := billing_current_tier(me);
      cap := billing_tier_cap(me, tier);
      if total > cap then
        raise exception 'Your % plan goes up to $% a day. Switch plan to spend more.', tier->>'label', cap / 100
          using errcode = 'P0001', hint = 'over_plan';
      end if;
    end if;
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
  perform lead_spend_refresh_control(me);
  return jsonb_build_object('from', tomorrow, 'charge_id', ch, 'extra_cents', greatest(extra, 0), 'tier', coalesce(tier, billing_current_tier(me)));
end; $$;

-- ── 11. Grants ──────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'billing_bill_month(uuid)', 'billing_current_tier(uuid)', 'billing_tier_cap(uuid,jsonb)', 'billing_set_daily(uuid,integer)',
    'billing_plan_apply(uuid,text,integer,text)', 'billing_plan_quote_for(uuid,text)', 'billing_plan_quote(text)',
    'billing_plan_change(text,integer,uuid)', 'billing_plan_state(uuid)', 'my_plan_state()', 'admin_billing_plan_set(uuid,text,text)',
    'admin_billing_pending_downgrades()', 'lead_spend_charge_result(uuid,text,text,text)', 'lead_spend_charge_result_p910(uuid,text,text,text)',
    'lead_spend_retry(uuid)', 'billing_plan_rollover(date)', 'billing_daily_sweep()', 'billing_daily_sweep_p884()', 'billing_period_rolled(uuid)',
    'lead_spend_set(integer,integer,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- What a signed-in user may call (each checks the caller inside).
  foreach f in array array['billing_plan_quote(text)', 'billing_plan_change(text,integer,uuid)', 'my_plan_state()',
    'admin_billing_plan_set(uuid,text,text)', 'admin_billing_pending_downgrades()', 'lead_spend_retry(uuid)', 'lead_spend_set(integer,integer,uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Agents who already have a spend but no saved plan get the plan for their spend saved now, so the cap holds.
update public.agent_billing_plans p
   set tier_key = public.billing_tier_in(public.billing_book_for(p.agent_id), public.lead_spend_daily_total(p.agent_id, public.billing_today() + 1))->>'key',
       updated_at = now()
 where p.tier_key is null and p.plan = 'paid' and p.products <> 'servicing'
   and public.lead_spend_daily_total(p.agent_id, public.billing_today() + 1) > 0;
