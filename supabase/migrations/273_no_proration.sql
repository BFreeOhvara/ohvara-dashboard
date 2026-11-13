-- 273 — P990: billing without day-counting (Brayden, Nov 13, in the P990 session; his yes to this migration there).
--
--   1. Buying a plan or Servicing with no monthly plan running: the full price that day, and it renews on that same
--      day every month (the 31st renews on the last day of shorter months: anchor + n months, as billing_bill_month
--      already does). Nothing is ever worked out from "days left this month".
--   2. Moving up keeps the billing day and charges only the price difference today:
--        - a lower lead plan to a higher one (Starter → Growth → Pro): new price − old price (billing_plan_change);
--        - Servicing to a lead plan (Add Leads while Servicing runs): lead plan − Servicing. Servicing stops when it's
--          paid: the lead plan includes servicing, so the monthly bill is the lead plan alone from then on.
--   3. Moving down: from the next bill, no refund (unchanged).
--   4. Servicing can't be added on top of a lead plan any more (it's included): hint 'included'.
-- Lead spend (nightly), the setup fee and Reactivation ($20 per delivered) are unchanged. Prices are unchanged.
-- The days_left / days_in_month columns stay (old rows keep them); new charges leave them empty.

-- ── 1. An upgrade charge no longer carries days ─────────────────────────────
alter table public.lead_spend_charges drop constraint if exists lead_spend_charges_upgrade_check;
alter table public.lead_spend_charges add constraint lead_spend_charges_upgrade_check
  check (kind <> 'plan_upgrade' or (tier_from is not null and tier_to is not null));

-- ── 2. What a tier switch would do: up = the price difference, today ───────
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
  if dir = 'up' then amt := greatest(0, (t->>'monthly_cents')::int - (cur->>'monthly_cents')::int); end if;
  return jsonb_build_object('direction', dir, 'from', cur, 'to', t, 'amount_cents', amt,
                            'next_bill', m->>'next', 'month_start', m->>'start',
                            'pending', case when pl.next_tier_key is not null then jsonb_build_object('tier', pl.next_tier_key, 'from', pl.next_tier_from) end,
                            'locked_until', book->'locked_until');
end; $$;

-- ── 3. The switch: as 257, the upgrade charge is the difference (no days) ──
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

  lo := greatest((price_book()->>'paid_min_daily_cents')::int, ceil((t->>'from')::numeric / 5) * 500);
  hi := billing_tier_cap(me, t);
  d := least(hi, greatest(lo, coalesce(p_daily_cents, lead_spend_daily_total(me, billing_today() + 1))));
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · replaced by a new plan change', 300), updated_at = now()
   where agent_id = me and kind = 'plan_upgrade' and status = 'failed';
  if (q->>'amount_cents')::int <= 0 then
    perform billing_plan_apply(me, t->>'key', d, 'Moving up: no difference to pay');
    return q || jsonb_build_object('applied', true);
  end if;
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, tier_from, tier_to, plan_daily_cents)
  values (me, billing_week_of(billing_today()), 'plan_upgrade', (q->>'amount_cents')::int,
          'plan_upgrade:' || me || ':' || (t->>'key') || ':' || gen_random_uuid(),
          'Upgrade to ' || (t->>'label') || ', the difference from ' || (cur->>'label'),
          cur->>'key', t->>'key', d)
  returning id into ch;
  perform billing_log(me, 'plan_upgrade', jsonb_build_object('tier', cur->>'key'),
                      jsonb_build_object('tier', t->>'key', 'cents', (q->>'amount_cents')::int, 'charge', ch), 'Moving up: the difference, charged now');
  return q || jsonb_build_object('charge_id', ch);
end; $$;

-- ── 4. Adding a product: full price and a new billing day, or the difference from Servicing ──
create or replace function public.billing_product_quote(p_product text, p_tier text default null, p_daily_cents int default null,
                                                        p_agent uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans; book jsonb; bm jsonb; running boolean; monthly int;
        plan int; setup int; sq jsonb; label text; tier text; from_svc boolean := false; svc int; today date := billing_today();
        nxt date;
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  if p_product not in ('leads', 'servicing', 'reactivation') then raise exception 'Pick a product' using errcode = '22023', hint = 'bad_product'; end if;
  select * into pl from agent_billing_plans where agent_id = me;
  if pl.agent_id is null or (pl.signed_up_at is null and pl.setup_paid_at is null) then
    raise exception 'Sign up first' using errcode = 'P0001', hint = 'not_signed_up';
  end if;
  if p_product = any(pl.picked) then
    if pl.picked_next is not null and not (p_product = any(pl.picked_next)) then
      raise exception 'It''s set to end on %. Keep it instead.', to_char(pl.picked_next_from, 'Mon FMDD') using errcode = 'P0001', hint = 'pending_removal';
    end if;
    raise exception 'You already have it' using errcode = 'P0001', hint = 'already_have';
  end if;
  if p_product = 'reactivation' then
    return jsonb_build_object('product', 'reactivation', 'label', 'Reactivation', 'setup_cents', 0, 'plan_cents', 0, 'monthly_cents', 0,
      'days', '[]'::jsonb, 'spend_cents', 0, 'fee_cents', 0, 'fee_rate', 0, 'total_cents', 0, 'prorated', false, 'upgrade', false);
  end if;
  if p_product = 'servicing' and 'leads' = any(pl.picked) then
    raise exception 'Servicing is included in your lead plan' using errcode = 'P0001', hint = 'included';
  end if;
  book := billing_book_for(me);
  running := pl.paid_start is not null and pl.paid_start <= today and ('leads' = any(pl.picked) or 'servicing' = any(pl.picked));
  if p_product = 'servicing' then
    monthly := (book->>'servicing_only_cents')::int; label := 'Servicing'; tier := 'servicing';
    setup := case when pl.setup_paid_at is null then coalesce((book->'setup'->>'fee_cents')::int, 0) else 0 end;
    sq := jsonb_build_object('days', '[]'::jsonb, 'spend_cents', 0, 'fee_cents', 0, 'fee_rate', 0, 'daily_cents', 0);
  else
    sq := billing_signup_quote_p933(p_tier, p_daily_cents, me);
    monthly := (sq->>'plan_cents')::int; label := sq->>'label'; tier := sq->>'tier';
    setup := case when pl.leads_setup_at is null then coalesce((book->'setup'->>'fee_cents')::int, 0) else 0 end;
    from_svc := running and 'servicing' = any(pl.picked);
  end if;
  svc := (book->>'servicing_only_cents')::int;
  if from_svc then
    -- Servicing → a lead plan: the difference today, same billing day.
    bm := billing_bill_month(me);
    plan := greatest(0, monthly - svc);
    nxt := (bm->>'next')::date;
  else
    plan := monthly;
    nxt := (today + interval '1 month')::date;
  end if;
  return jsonb_build_object('product', p_product, 'tier', tier, 'label', label, 'monthly_cents', monthly, 'plan_cents', plan,
    'prorated', false, 'upgrade', from_svc, 'from_label', case when from_svc then 'Servicing' end, 'from_cents', case when from_svc then svc end,
    'days_left', null, 'days_in_month', null,
    'bill_from', case when from_svc then bm->>'start' else today::text end, 'bill_to', nxt::text,
    'setup_cents', setup, 'days', sq->'days', 'daily_cents', (sq->>'daily_cents')::int, 'spend_cents', (sq->>'spend_cents')::int,
    'fee_cents', (sq->>'fee_cents')::int, 'fee_rate', (sq->>'fee_rate')::numeric,
    'total_cents', setup + plan + (sq->>'spend_cents')::int + (sq->>'fee_cents')::int);
end; $$;

create or replace function public.billing_product_add(p_product text, p_tier text default null, p_daily_cents int default null,
                                                      p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); p record; pl agent_billing_plans; q jsonb; open_c lead_spend_charges; n int; ch uuid;
        missing text[];
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  select role, is_demo, billing_exempt into p from profiles where id = me;
  if p.role is distinct from 'agent' then raise exception 'Only agents are billed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('billing_product:' || me, 0));
  q := billing_product_quote(p_product, p_tier, p_daily_cents, me);
  select * into pl from agent_billing_plans where agent_id = me;
  if p_product = 'reactivation' then
    update agent_billing_plans set picked = picked || '{reactivation}'::text[], updated_at = now() where agent_id = me;
    perform billing_log(me, 'product_add', jsonb_build_object('products', pl.picked), jsonb_build_object('products', pl.picked || '{reactivation}'::text[]), 'Added Reactivation');
    return q || jsonb_build_object('status', 'added');
  end if;
  if p.is_demo then raise exception 'Test accounts are never charged' using hint = 'test_account'; end if;
  if p.billing_exempt then raise exception 'Your account isn''t billed' using hint = 'comped'; end if;
  if pl.card_on_file_at is null then raise exception 'Add a card first' using hint = 'no_card'; end if;
  if p_product = 'leads' then
    missing := signup_details_missing(me);
    if cardinality(coalesce(missing, '{}')) > 0 then
      raise exception 'Finish your details first' using errcode = 'P0001', hint = 'details_missing';
    end if;
  end if;
  select * into open_c from lead_spend_charges where agent_id = me and kind = 'product_add' and p_product = any(products)
     and status in ('due', 'processing') limit 1;
  if found then return jsonb_build_object('charge_id', open_c.id, 'total_cents', open_c.amount_cents, 'status', open_c.status, 'existing', true); end if;
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · replaced', 300), updated_at = now()
   where agent_id = me and kind = 'product_add' and p_product = any(products) and status = 'failed';
  select count(*) into n from lead_spend_charges where agent_id = me and kind = 'product_add';
  -- tier_from = 'servicing' marks an upgrade from Servicing (the billing day stays; Servicing stops once it's paid).
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, fee_rate,
                                  setup_cents, plan_cents, servicing_cents, tier_from, tier_to, bill_from, bill_to,
                                  plan_daily_cents, products)
  values (me, billing_week_of(billing_today()), 'product_add', (q->>'total_cents')::int, 'product_add:' || me || ':' || (n + 1),
          left('Added ' || (q->>'label') || case when p_product = 'leads' then ' plan' else '' end
               || case when (q->>'setup_cents')::int > 0 then ' · setup $' || to_char((q->>'setup_cents')::int / 100.0, 'FM999,990.00') else '' end
               || case when (q->>'upgrade')::boolean then ' · the difference from Servicing $' else ' · first month $' end
               || to_char((q->>'plan_cents')::int / 100.0, 'FM999,990.00')
               || case when (q->>'spend_cents')::int > 0
                       then ' · first ' || jsonb_array_length(q->'days') || ' days: $' || to_char((q->>'spend_cents')::int / 100.0, 'FM999,990.00')
                            || ' to your ads · $' || to_char((q->>'fee_cents')::int / 100.0, 'FM999,990.00') || ' booking desk' else '' end, 300),
          case when (q->>'spend_cents')::int > 0 then billing_today() + 1 end, nullif((q->>'spend_cents')::int, 0), nullif((q->>'fee_cents')::int, 0),
          (q->>'fee_rate')::numeric, (q->>'setup_cents')::int, (q->>'plan_cents')::int,
          case when p_product = 'servicing' then (q->>'plan_cents')::int end,
          case when (q->>'upgrade')::boolean then 'servicing' end, q->>'tier', (q->>'bill_from')::date, (q->>'bill_to')::date,
          nullif((q->>'daily_cents')::int, 0), array[p_product])
  returning id into ch;
  perform billing_log(me, 'product_add_charge', null, q, 'Adding ' || (q->>'label'));
  return q || jsonb_build_object('charge_id', ch, 'status', 'due');
end; $$;

-- Paid: the product is on. A new monthly product sets the billing day to the day it was bought; an upgrade from
-- Servicing keeps the day and drops Servicing (the lead plan includes it). Old charges with days_left (bought before
-- this migration, prorated into a running month) keep the day too.
create or replace function public.billing_product_add_result(c lead_spend_charges, p_status text, p_pi text, p_failure text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare prod text := c.products[1]; pl agent_billing_plans; k int; nid uuid; ahead int := coalesce(lead_spend_days_ahead(), 2);
        label text; day_spend int; day_fee int; keep_day boolean := c.days_left is not null or c.tier_from = 'servicing';
        from_svc boolean := c.tier_from = 'servicing';
begin
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = c.id;
  if p_status = 'processing' then return jsonb_build_object('status', p_status); end if;
  label := case prod when 'leads' then 'Leads' else 'Servicing' end;
  if p_status = 'failed' then
    perform billing_log(c.agent_id, 'charge_failed', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'failure', p_failure), null);
    perform notify(c.agent_id, 'billing_charge_failed', 'Your card didn''t go through',
                   'Nothing was charged and ' || label || ' wasn''t added. Try another card.', '/billing', true,
                   'product-failed:' || c.id || ':' || c.attempts, null);
    return jsonb_build_object('status', p_status);
  end if;
  select * into pl from agent_billing_plans where agent_id = c.agent_id for update;
  update agent_billing_plans set
         picked = case when from_svc then array_remove(picked, 'servicing') else picked end || array[prod],
         picked_next = case when picked_next is null then null
                            when from_svc then array_remove(picked_next, 'servicing') || array[prod] else picked_next || array[prod] end,
         setup_paid_at = coalesce(setup_paid_at, now()), signed_up_at = coalesce(signed_up_at, now()),
         leads_setup_at = case when prod = 'leads' then coalesce(leads_setup_at, now()) else leads_setup_at end,
         paid_start = case when keep_day then coalesce(paid_start, c.bill_from) else c.bill_from end,
         tier_key = case when prod = 'leads' then c.tier_to else tier_key end,
         tier_version = case when prod = 'leads' then (billing_book_for(c.agent_id)->>'version')::int else tier_version end,
         next_tier_key = case when prod = 'leads' then null else next_tier_key end,
         next_tier_from = case when prod = 'leads' then null else next_tier_from end,
         spend_paused = case when prod = 'leads' then false else spend_paused end, updated_at = now()
   where agent_id = c.agent_id;
  update profiles set billing_status = 'active', billing_grace_until = null, billing_updated_at = now(), has_servicing = true,
         billing_current_period_end = case when keep_day then billing_current_period_end else (c.bill_to::timestamp at time zone 'America/Chicago') end,
         leads_status = case when prod = 'leads' then 'active' else leads_status end
   where id = c.agent_id;
  if prod = 'leads' then
    perform billing_set_daily(c.agent_id, c.plan_daily_cents);
    if coalesce(c.spend_cents, 0) > 0 then
      day_spend := c.spend_cents / ahead; day_fee := round(day_spend * c.fee_rate)::int;
      for k in 1 .. ahead loop
        continue when exists (select 1 from lead_spend_charges x where x.agent_id = c.agent_id and x.kind = 'nightly' and x.for_day = billing_today() + k);
        insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, credit_cents,
                                        fee_rate, status, attempts, stripe_pi)
        values (c.agent_id, billing_week_of(billing_today() + k), 'nightly', day_spend + day_fee,
                'nightly:' || c.agent_id || ':' || (billing_today() + k), 'sign-up', billing_today() + k, day_spend, day_fee, 0,
                c.fee_rate, 'processing', 1, p_pi)
        returning id into nid;
        perform lead_spend_charge_result_p932(nid, 'paid', p_pi, null);
      end loop;
    end if;
  end if;
  perform billing_log(c.agent_id, 'product_added', jsonb_build_object('products', pl.picked),
                      jsonb_build_object('products', case when from_svc then array_remove(pl.picked, 'servicing') else pl.picked end || array[prod],
                                         'cents', c.amount_cents, 'pi', p_pi),
                      case when from_svc then 'Moved up from Servicing to ' || label else 'Added ' || label end);
  perform notify(c.agent_id, 'billing_charged', label || ' added',
                 'Paid $' || to_char(c.amount_cents / 100.0, 'FM999,990.00') || '. ' ||
                 case when prod = 'leads' then 'We''re setting up your leads now.' else 'Add your clients any time on Clients.' end,
                 '/billing', false, 'product-paid:' || c.id, jsonb_build_object('cents', c.amount_cents));
  perform notify(adm.id, 'new_agent_paid', 'Agent added ' || label,
                 coalesce((select full_name from profiles where id = c.agent_id), 'An agent') || ' added ' || label
                 || ': $' || to_char(c.amount_cents / 100.0, 'FM999,990.00'), '/admin', false, 'product-paid:' || c.id || ':' || adm.id, null)
    from profiles adm where adm.role = 'admin' and coalesce(adm.is_active, true);
  return jsonb_build_object('status', p_status, 'product', prod);
end; $$;
