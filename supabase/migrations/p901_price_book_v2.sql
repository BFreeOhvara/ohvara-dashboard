-- P901 — Lock the real prices, and Meta only at launch. NOT APPLIED (Brayden applies it with the others).
-- Needs p884_billing_engine.sql and p889_one_lead_product.sql applied first.
--
-- 1. Price book version 2, FINAL (Brayden, Nov 7 22:16–22:27: "price it like the system already existed"):
--      Starter  up to $50 a day     $799 a month
--      Growth   $51 to $200 a day   $1,699 a month
--      Pro      over $200 a day     $2,999 a month
--      Servicing only (no leads)    $499 a month; servicing is included in every lead package
--      Setup fee $299 once. Month to month, cancel anytime: no minimum term.
--      Lead spend stays prepaid weekly on top, $50 a day minimum.
--    No Scale/custom tier. Effective the day this file is applied. Version 1 (the P884 draft) stays: the book is
--    append-only. src/lib/priceBook.js BOOK mirrors these numbers (src/p901.test.js checks it).
--
-- 2. Meta only at launch (Brayden, Nov 7 22:39): lead_split_rules.call_ads_on, default OFF. While it's off every
--    agent runs 100% form ads / 0% call ads (reason 'call_ads_off'), the Monday rebalance holds, and nothing is
--    logged as a move. The split code, the 70/30 start and the rebalance stay as they are and pick up again the day
--    an admin turns Call ads (Google) on (admin_lead_split_rules_save { call_ads_on: true }). Live transfers still
--    happen from form leads (the AI or a VA calls, Check agent, transfer); agents' "Appointments + live transfers"
--    setting stays.

do $$
begin
  if to_regclass('public.billing_price_book') is null then raise exception 'p901: apply p884_billing_engine.sql first'; end if;
  if to_regclass('public.lead_split_rules') is null then raise exception 'p901: apply p889_one_lead_product.sql first'; end if;
  if exists (select 1 from public.billing_price_book where version = 2) then raise exception 'p901: price book version 2 already exists'; end if;
end $$;

-- ── 1. Price book version 2, final ──────────────────────────────────────────
insert into public.billing_price_book (version, effective_from, status, book, note) values (2, billing_today(), 'final',
  jsonb_build_object(
    'tiers', jsonb_build_array(
      jsonb_build_object('key', 'starter', 'label', 'Starter', 'from', 0,   'to', 50,   'monthly_cents', 79900),
      jsonb_build_object('key', 'growth',  'label', 'Growth',  'from', 51,  'to', 200,  'monthly_cents', 169900),
      jsonb_build_object('key', 'pro',     'label', 'Pro',     'from', 201, 'to', null, 'monthly_cents', 299900)),
    'servicing_only_cents', 49900,
    'paid_min_daily_cents', 5000,
    'setup', jsonb_build_object('mode', 'fee', 'fee_cents', 29900, 'min_months', 0),
    'grace_days', 3,
    'card_fee_rate', 0.03,
    'low_days', 2),
  'P901: final prices (Brayden, Nov 7). Three packages, servicing only $499, $299 setup, month to month.');

-- ── 2. Call ads (Google): off ───────────────────────────────────────────────
alter table public.lead_split_rules add column call_ads_on boolean not null default false;
comment on column public.lead_split_rules.call_ads_on is
  'P901: Call ads (Google). Off at launch: every agent runs 100% form ads and the Monday rebalance holds.';

-- What runs from a daily total (cents): { form_cents, call_cents, form_pct, reason }. P889, plus the switch (P901).
create or replace function public.lead_product_split(p_mode text, p_form_pct int, p_daily_cents int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r lead_split_rules; pct int; v_call int; d int := greatest(coalesce(p_daily_cents, 0), 0);
begin
  select * into r from lead_split_rules where id;
  if p_mode is distinct from 'both' then
    return jsonb_build_object('form_cents', d, 'call_cents', 0, 'form_pct', 100, 'reason', 'appts_only');
  end if;
  -- P901: call ads off → all form ads.
  if not coalesce(r.call_ads_on, false) then
    return jsonb_build_object('form_cents', d, 'call_cents', 0, 'form_pct', 100, 'reason', 'call_ads_off');
  end if;
  pct := lead_split_clamp(coalesce(p_form_pct, r.start_form_pct), r);
  -- Whole dollars, as the screens round them.
  v_call := (round(d * (100 - pct) / 100.0 / 100.0) * 100)::int;
  if v_call < r.call_min_daily_cents then
    return jsonb_build_object('form_cents', d, 'call_cents', 0, 'form_pct', 100, 'reason', 'call_min');
  end if;
  return jsonb_build_object('form_cents', d - v_call, 'call_cents', v_call, 'form_pct', pct, 'reason', 'split');
end; $$;

-- The Monday move. P889, except it holds (no moves, nothing logged) while call ads are off.
create or replace function public.lead_split_weekly(p_week date default null) returns int language plpgsql
security definer set search_path = public as $$
declare r lead_split_rules; wk date := coalesce(p_week, billing_week_of(billing_today())); a record; nums jsonb; nx jsonb; n int := 0;
begin
  select * into r from lead_split_rules where id;
  if not coalesce(r.call_ads_on, false) then return 0; end if; -- P901
  for a in select p.agent_id, s.form_pct, s.locked from agent_lead_product p join agent_lead_split s using (agent_id)
            join profiles pr on pr.id = p.agent_id
           where p.mode = 'both' and pr.role = 'agent' loop
    -- Once per agent per week (a re-run is a no-op).
    continue when exists (select 1 from agent_lead_split_log where agent_id = a.agent_id and kind = 'weekly' and week_start = wk);
    nums := lead_split_numbers(a.agent_id, wk - 7 * r.lookback_weeks, wk - 1);
    nx := lead_split_next(a.form_pct, a.locked, nums);
    insert into agent_lead_split_log (agent_id, kind, week_start, before_pct, after_pct, reason, numbers)
    values (a.agent_id, 'weekly', wk, a.form_pct, (nx->>'form_pct')::int, nx->>'reason', nx->'numbers' || jsonb_build_object('metric', nx->>'metric'));
    if (nx->>'moved')::int <> 0 then
      update agent_lead_split set form_pct = (nx->>'form_pct')::int, updated_at = now() where agent_id = a.agent_id;
      perform lead_product_resplit(a.agent_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end; $$;

-- Admin view: P889, with no "next Monday" move while call ads are off.
create or replace function public.admin_lead_split_view(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare r lead_split_rules; p agent_lead_product; s agent_lead_split; wk date := billing_week_of(billing_today()); nums jsonb;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into r from lead_split_rules where id;
  select * into p from agent_lead_product where agent_id = p_agent;
  select * into s from agent_lead_split where agent_id = p_agent;
  nums := lead_split_numbers(p_agent, wk - 7 * r.lookback_weeks, wk - 1);
  return jsonb_build_object(
    'rules', to_jsonb(r), 'product', to_jsonb(p), 'split', to_jsonb(s),
    'daily_cents', lead_spend_daily_total(p_agent),
    'today', lead_product_split(p.mode, s.form_pct, lead_spend_daily_total(p_agent)),
    'next', case when p.mode = 'both' and r.call_ads_on then lead_split_next(s.form_pct, coalesce(s.locked, false), nums) end,
    'controls', (select jsonb_agg(to_jsonb(c)) from agent_campaign_control c where c.agent_id = p_agent),
    'log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id desc) from (select * from agent_lead_split_log where agent_id = p_agent order by id desc limit 30) l), '[]'::jsonb));
end; $$;

-- Rules save: P889, plus the switch. Flipping it re-splits every transfer agent so the engine follows the same day.
create or replace function public.admin_lead_split_rules_save(p_rules jsonb) returns jsonb language plpgsql
security definer set search_path = public as $$
declare before lead_split_rules; after lead_split_rules; a uuid;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into before from lead_split_rules where id;
  update lead_split_rules set
    start_form_pct = coalesce((p_rules->>'start_form_pct')::int, start_form_pct),
    max_step = coalesce((p_rules->>'max_step')::int, max_step),
    floor_pct = coalesce((p_rules->>'floor_pct')::int, floor_pct),
    min_sales = coalesce((p_rules->>'min_sales')::int, min_sales),
    call_min_daily_cents = coalesce((p_rules->>'call_min_daily_cents')::int, call_min_daily_cents),
    hold_within = coalesce((p_rules->>'hold_within')::numeric, hold_within),
    lookback_weeks = coalesce((p_rules->>'lookback_weeks')::int, lookback_weeks),
    call_ads_on = coalesce((p_rules->>'call_ads_on')::boolean, call_ads_on),
    updated_at = now(), updated_by = auth.uid()
  where id returning * into after;
  insert into agent_lead_split_log (agent_id, kind, reason, numbers, by_user)
  values (null, 'rules', case when before.call_ads_on is distinct from after.call_ads_on
                              then case when after.call_ads_on then 'Call ads (Google) turned on' else 'Call ads (Google) turned off' end
                              else 'Split rules changed' end,
          jsonb_build_object('before', to_jsonb(before), 'after', to_jsonb(after)), auth.uid());
  if before.call_ads_on is distinct from after.call_ads_on then
    for a in select agent_id from agent_lead_product where mode = 'both' loop perform lead_product_resplit(a); end loop;
  end if;
  return to_jsonb(after);
end; $$;

-- Grants stay as P889 set them (create or replace keeps them); restated so this file stands on its own.
do $$
declare f text;
begin
  foreach f in array array['lead_product_split(text,integer,integer)', 'lead_split_weekly(date)', 'admin_lead_split_view(uuid)',
    'admin_lead_split_rules_save(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['admin_lead_split_view(uuid)', 'admin_lead_split_rules_save(jsonb)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Every transfer agent's spend and engine split follow the switch (off) from today.
do $$
declare a uuid;
begin
  for a in select agent_id from public.agent_lead_product where mode = 'both' loop perform public.lead_product_resplit(a); end loop;
end $$;
