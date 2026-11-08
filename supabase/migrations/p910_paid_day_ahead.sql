-- p910_paid_day_ahead — one paid day ahead (P910 step 11). NOT APPLIED: runs after p909_final_pricing.sql.
--
-- The model:
--   * At the start the agent pays for two days (tomorrow and the day after). Each evening after that the system
--     charges the day after tomorrow, so tomorrow is always paid already.
--   * If a charge is declined: tomorrow still runs (it was paid the night before), the agent gets a Fix card notice,
--     the charge is retried each morning (up to 3 tries in all), and a day that isn't paid runs no ads.
--   * Ads never run on an unpaid day. Today runs only if today's nightly charge is paid (or credit covered it). Money
--     already charged for days still to come is held for those days: it is never spendable today, never counted as
--     credit, and never in today's cap. There is no grace for lead spend (P884: a past-due plan already stops it).
--
-- Leaks closed here (P909 had them once two days could be paid at once):
--   1. billing_runs never checked that TODAY is paid: with tomorrow's money in the wallet, a declined or let-go
--      charge for today still left a balance, so ads ran. Now 'unpaid_day' unless today is paid.
--   2. lead_spend_credit and lead_spend_refresh_control counted the whole wallet: future paid days' money would come
--      off tonight's charge (paid twice over by the same money) and lift today's cap. Now they leave it out.
--   3. lead_spend_charge_result settled every earlier declined day when a later one was paid: paying Thursday would
--      wipe Wednesday's decline without Wednesday ever being paid. Now a payment settles only its own day.
--
-- billing_settings.days_ahead (default 2) — 1 keeps P909's charge-tomorrow-only rhythm (used by P909's tests).

alter table public.billing_settings
  add column if not exists days_ahead int not null default 2 check (days_ahead between 1 and 2);
comment on column public.billing_settings.days_ahead is
  'P910: how many days ahead lead spend is paid. 2 = the day after tomorrow is charged each evening (two days at the start).';

create or replace function public.lead_spend_days_ahead() returns int language sql stable security definer
set search_path = public as $$
  select coalesce((select days_ahead from billing_settings where id), 2)
$$;

-- Money already charged (or credit already set aside) for days after p_day: held for those days.
create or replace function public.lead_spend_ahead_cents(p_agent uuid, p_day date default null) returns int language sql stable
security definer set search_path = public as $$
  select (coalesce((select sum(case when c.status = 'paid' then c.spend_cents else 0 end
                               + case when c.status <> 'cancelled' then coalesce(c.credit_cents, 0) else 0 end)
                      from lead_spend_charges c
                     where c.agent_id = p_agent and c.kind = 'nightly' and c.for_day > coalesce(p_day, billing_today())), 0)
        + coalesce((select sum((e.after->>'spend_cents')::int) from agent_billing_events e
                     where e.agent_id = p_agent and e.kind = 'nightly_covered'
                       and (e.after->>'for_day')::date > coalesce(p_day, billing_today())), 0))::int
$$;

-- Is p_day paid: its nightly charge went through, or credit covered it.
create or replace function public.lead_spend_day_paid(p_agent uuid, p_day date default null) returns boolean language sql stable
security definer set search_path = public as $$
  select exists (select 1 from lead_spend_charges c where c.agent_id = p_agent and c.kind = 'nightly'
                    and c.for_day = coalesce(p_day, billing_today()) and c.status = 'paid')
      or exists (select 1 from agent_billing_events e where e.agent_id = p_agent and e.kind = 'nightly_covered'
                    and e.after->>'for_day' = coalesce(p_day, billing_today())::text)
$$;

-- What runs right now (P909), plus: in nightly mode ads run only on a paid day, and only today's money counts.
create or replace function public.billing_runs(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare st text := billing_status_of(p_agent); pl agent_billing_plans; nightly boolean := billing_nightly(); today date := billing_today();
        bal int := lead_spend_balance(p_agent) - case when billing_nightly() then lead_spend_ahead_cents(p_agent) else 0 end;
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
    when nightly and pl.card_on_file_at is null then 'no_card'
    when nightly and exists (select 1 from lead_spend_charges c where c.agent_id = p_agent and c.kind = 'nightly'
                                and c.for_day = today and c.status in ('due', 'processing')) then 'waiting_payment'
    when nightly and not lead_spend_day_paid(p_agent, today) then 'unpaid_day'
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

-- P909's engine refresh: the cap is today's money only (days paid ahead are left out).
create or replace function public.lead_spend_refresh_control(p_agent uuid) returns void language plpgsql
security definer set search_path = public as $$
declare r jsonb := billing_runs(p_agent); t text;
        bal int := greatest(0, lead_spend_balance(p_agent) - case when billing_nightly() then lead_spend_ahead_cents(p_agent) else 0 end);
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

-- Credit: wallet money not needed for the rest of p_day and not held for days already paid ahead.
create or replace function public.lead_spend_credit(p_agent uuid, p_day date default null) returns int language plpgsql stable
security definer set search_path = public as $$
declare d date := coalesce(p_day, billing_today()); bal int := lead_spend_balance(p_agent); billed int; reserved int := 0;
begin
  if (billing_runs(p_agent)->>'ads')::boolean then
    select coalesce(sum(billed_cents), 0) into billed from lead_spend_delivered where agent_id = p_agent and day = d;
    reserved := greatest(0, lead_spend_daily_total(p_agent, d) - billed);
  end if;
  reserved := reserved + lead_spend_ahead_cents(p_agent, d);
  return greatest(0, bal - least(bal, reserved));
end; $$;

-- The next charge: the first day ahead not charged yet (at the start, tomorrow and the day after), else the last
-- day ahead's charge.
create or replace function public.lead_spend_next_charge(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare today date := billing_today(); n int := lead_spend_days_ahead(); v_for date; c lead_spend_charges;
        spend int; credit int; net int; rate numeric; hr int;
begin
  select charge_hour into hr from billing_settings where id;
  select min(g)::date into v_for from generate_series(today + 1, today + n, interval '1 day') g
   where not exists (select 1 from lead_spend_charges x where x.agent_id = p_agent and x.kind = 'nightly' and x.for_day = g::date);
  v_for := coalesce(v_for, today + n);
  select * into c from lead_spend_charges where agent_id = p_agent and kind = 'nightly' and for_day = v_for order by created_at desc limit 1;
  if c.id is not null then
    return jsonb_build_object('for_day', v_for, 'spend_cents', c.spend_cents + c.credit_cents, 'credit_cents', c.credit_cents,
      'net_cents', c.spend_cents, 'fee_cents', c.fee_cents, 'fee_rate', c.fee_rate, 'total_cents', c.amount_cents, 'at_hour', hr,
      'status', c.status, 'days_ahead', n);
  end if;
  spend := lead_spend_daily_total(p_agent, v_for);
  rate := lead_spend_fee_rate(p_agent, v_for);
  credit := lead_spend_credit(p_agent);
  net := greatest(0, spend - credit);
  return jsonb_build_object('for_day', v_for, 'spend_cents', spend, 'credit_cents', spend - net, 'net_cents', net,
    'fee_cents', round(net * rate)::int, 'fee_rate', rate, 'total_cents', net + round(net * rate)::int, 'at_hour', hr,
    'status', 'planned', 'days_ahead', n);
end; $$;

-- Each evening: every day ahead (tomorrow .. today + days_ahead) that has no charge yet is charged: two days at the
-- start, then only the day after tomorrow. Safe to run again (one charge per agent per day). Skipped as in P909
-- (paused for that day, no card, servicing only, plan not in good standing), and while a declined day ahead is still
-- open: its retries run first, so a failing card isn't charged again for more days.
create or replace function public.lead_spend_nightly(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare v_day date := coalesce(p_day, billing_today()); a record; dd date; k int;
        pl agent_billing_plans; spend int; credit int; net int; rate numeric; fee int; n int := 0;
begin
  if not billing_nightly() then return 0; end if;
  -- A declined day that has started and not been paid by evening is let go: its ads never ran (billing_runs: an
  -- unpaid day runs nothing), so nothing is owed for it.
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · day passed, nothing owed', 300), updated_at = now()
   where kind = 'nightly' and status = 'failed' and for_day <= v_day;
  for a in select p.id from profiles p where p.role = 'agent' and coalesce(p.is_active, true) loop
    select * into pl from agent_billing_plans where agent_id = a.id;
    continue when pl.agent_id is null or pl.card_on_file_at is null or pl.products = 'servicing' or pl.spend_paused;
    continue when billing_status_of(a.id) not in ('pilot', 'active', 'waiting_acceptance');
    continue when exists (select 1 from lead_spend_charges c where c.agent_id = a.id and c.kind = 'nightly'
                             and c.status = 'failed' and c.for_day > v_day);
    for k in 1 .. lead_spend_days_ahead() loop
      dd := v_day + k;
      continue when exists (select 1 from agent_lead_pause z where z.agent_id = a.id and z.active and (z.resume_on is null or z.resume_on > dd));
      continue when exists (select 1 from lead_spend_charges c where c.agent_id = a.id and c.kind = 'nightly' and c.for_day = dd);
      spend := lead_spend_daily_total(a.id, dd);
      continue when spend <= 0;
      credit := lead_spend_credit(a.id, v_day);
      net := greatest(0, spend - credit);
      if net = 0 then
        if not exists (select 1 from agent_billing_events e where e.agent_id = a.id and e.kind = 'nightly_covered' and e.after->>'for_day' = dd::text) then
          perform billing_log(a.id, 'nightly_covered', null, jsonb_build_object('for_day', dd, 'spend_cents', spend, 'credit_cents', credit),
                              'Credit covers ' || to_char(dd, 'Dy, Mon FMDD') || ': nothing charged');
        end if;
        continue;
      end if;
      rate := lead_spend_fee_rate(a.id, dd);
      fee := round(net * rate)::int;
      insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, credit_cents, fee_rate)
      values (a.id, billing_week_of(dd), 'nightly', net + fee, 'nightly:' || a.id || ':' || dd,
              'Lead spend for ' || to_char(dd, 'Dy, Mon FMDD') || ': $' || to_char(net / 100.0, 'FM999990.00')
                || case when fee > 0 then ' + ' || round(rate * 100) || '% ($' || to_char(fee / 100.0, 'FM999990.00') || ')' else '' end
                || case when spend > net then ' · $' || to_char((spend - net) / 100.0, 'FM999990.00') || ' credit used' else '' end,
              dd, net, fee, spend - net, rate)
      on conflict (key) do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end; $$;

-- Each morning: a declined charge for today or a day ahead is tried again (up to 3 tries in all).
create or replace function public.lead_spend_morning_retry(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare n int; a uuid; d date := coalesce(p_day, billing_today());
begin
  if not billing_nightly() then return 0; end if;
  update lead_spend_charges set status = 'due', failure = null, note = left(coalesce(note, '') || ' · morning retry', 300), updated_at = now()
   where kind = 'nightly' and status = 'failed' and for_day >= d and attempts < 3;
  get diagnostics n = row_count;
  for a in select distinct agent_id from lead_spend_charges where kind = 'nightly' and for_day >= d loop
    perform lead_spend_refresh_control(a);
  end loop;
  return n;
end; $$;

-- The result of one charge (P909), with: a payment settles only its own day's earlier decline (never an earlier
-- unpaid day), and the words name the day (Today's, Tomorrow's, Wed's).
create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges; st billing_settings; day_words text; retry_words text;
begin
  if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
  select * into c from lead_spend_charges where id = p_id for update;
  if not found then raise exception 'no such charge'; end if;
  if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
  select * into st from billing_settings where id;
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = p_id;
  day_words := case when c.for_day = billing_today() then 'Today''s' when c.for_day = billing_today() + 1 then 'Tomorrow''s'
                    else to_char(c.for_day, 'FMDay') || '''s' end;
  retry_words := to_char(make_time(coalesce(st.retry_hour, 8), 0, 0), 'FMHH12 AM');
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
       where agent_id = c.agent_id and status = 'failed' and kind = 'nightly' and for_day = c.for_day and id <> c.id;
      update agent_billing_plans set paid_start = billing_today(), updated_at = now()
       where agent_id = c.agent_id and plan = 'paid' and paid_start is null;
    end if;
    perform billing_log(c.agent_id, 'charge_paid', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'spend_cents', c.spend_cents,
                        'fee_cents', c.fee_cents, 'for_day', c.for_day, 'pi', p_pi), null);
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
                   case when c.kind = 'nightly' and c.for_day > billing_today() + 1 and c.attempts < 3
                          then 'Tomorrow is paid and still runs. ' || day_words || ' leads are off unless it''s paid before it starts. '
                               || 'Fix your card, or we try again at ' || retry_words || '.'
                        when c.kind = 'nightly' and c.for_day > billing_today() and c.attempts < 3
                          then day_words || ' leads are off unless it''s paid before it starts. Fix your card, or we try again at '
                               || retry_words || '.'
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

-- Server-only, like P909's billing functions (the redefined ones keep P909's grants).
do $$
declare f text;
begin
  foreach f in array array['lead_spend_days_ahead()', 'lead_spend_ahead_cents(uuid,date)', 'lead_spend_day_paid(uuid,date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
