-- 268_products (Prompt 955, Brayden Nov 11): pick what you need. Three products, any mix, prices unchanged (book v3):
--   Leads        a plan by daily spend band + the booking desk + $299 setup. Servicing of what's sold through Ohvara
--                stays included (+50 added clients).
--   Servicing    $499 a month up to 100 clients, +$200 per extra 100. $299 setup (once per account).
--   Reactivation $2 per callable lead per list (P952). No monthly plan, no setup fee.
-- Everyone gets the portal. NOT APPLIED until Brayden's yes.
--
--   1. agent_billing_plans.picked (text[]) = what the agent bought. products (the old one-word column) follows it for
--      the code that still reads it: Leads in → 'both', else 'servicing' (no lead spend, no nightly charge).
--      picked_next / picked_next_from = a removal waiting for the next bill date (P921 downgrade rules).
--      signed_up_at = the sign-up finished (paid, or free for reactivation only). leads_setup_at = the Leads setup paid.
--   2. Sign-up: billing_signup_quote / billing_signup_start take p_products. Leads and/or Servicing = one charge
--      (one $299 setup + each plan's first month + the first 2 days of leads). Reactivation only = no charge: a card on
--      file and the portal opens.
--   3. Billing: billing_product_quote / billing_product_add (a 'product_add' charge: setup when not paid yet + the
--      plan for the days left this bill month, or a full month from today when there is no running month + the
--      first 2 days of leads) / billing_product_remove (ends at the next bill date; reactivation at once) /
--      billing_product_keep (undo a removal). Adding Leads asks the sign-up details first (states, hours).
--   4. Monthly bill (agent_membership_due): Leads plan + Servicing, extra clients by the included count
--      (Leads 50 added · Servicing 100 · both 150 added). Reactivation only = nothing monthly.
--   5. Admin revenue splits by product (leads · servicing · reactivation · setup).
-- Tests: supabase/tests/p955_products.sql (PGlite).

-- ── 1. What each agent bought ───────────────────────────────────────────────
alter table public.agent_billing_plans
  add column if not exists picked           text[] not null default '{leads}',
  add column if not exists picked_next      text[],
  add column if not exists picked_next_from date,
  add column if not exists signed_up_at     timestamptz,
  add column if not exists leads_setup_at   timestamptz;
alter table public.agent_billing_plans add constraint agent_billing_plans_picked_check
  check (cardinality(picked) between 1 and 3 and picked <@ array['leads', 'servicing', 'reactivation']);
alter table public.agent_billing_plans add constraint agent_billing_plans_picked_next_check
  check (picked_next is null or (cardinality(picked_next) between 1 and 3 and picked_next <@ array['leads', 'servicing', 'reactivation']
                                 and picked_next_from is not null));
comment on column public.agent_billing_plans.picked is
  'P955: the products bought: leads, servicing, reactivation (any mix). products follows it (leads → both, else servicing).';

-- Existing accounts: servicing only stays servicing; every other account has Leads.
update public.agent_billing_plans set picked = case when products = 'servicing' then '{servicing}'::text[] else '{leads}'::text[] end,
       signed_up_at = coalesce(signed_up_at, setup_paid_at),
       leads_setup_at = case when products <> 'servicing' then coalesce(leads_setup_at, setup_paid_at) else leads_setup_at end;

-- One order, no repeats: leads, servicing, reactivation.
create or replace function public.billing_products_norm(p text[]) returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(x order by array_position(array['leads', 'servicing', 'reactivation'], x)), '{}')
    from (select distinct x from unnest(p) x where x in ('leads', 'servicing', 'reactivation')) s
$$;

create or replace function public.billing_products_sync() returns trigger language plpgsql set search_path = public as $$
begin
  new.picked := billing_products_norm(new.picked);
  if new.picked_next is not null then new.picked_next := billing_products_norm(new.picked_next); end if;
  if tg_op = 'INSERT' or new.picked is distinct from old.picked then
    new.products := case when 'leads' = any(new.picked) then 'both' else 'servicing' end;
  elsif new.products is distinct from old.products then
    -- Old code that still sets products (P933's sign-up) moves picked with it.
    new.picked := case when new.products = 'servicing' then '{servicing}'::text[] else billing_products_norm(new.picked || '{leads}') end;
  end if;
  return new;
end; $$;
drop trigger if exists agent_billing_plans_products on public.agent_billing_plans;
create trigger agent_billing_plans_products before insert or update on public.agent_billing_plans
  for each row execute function public.billing_products_sync();

create or replace function public.billing_has(p_agent uuid, p_product text) returns boolean language sql stable
security definer set search_path = public as $$
  select coalesce((select p_product = any(picked) from agent_billing_plans where agent_id = p_agent), p_product = 'leads')
$$;

-- ── 2. Charges know their products ─────────────────────────────────────────
alter table public.lead_spend_charges
  add column if not exists products        text[],
  add column if not exists servicing_cents int check (servicing_cents >= 0);
alter table public.lead_spend_charges drop constraint lead_spend_charges_kind_check;
alter table public.lead_spend_charges add constraint lead_spend_charges_kind_check
  check (kind in ('weekly', 'change', 'va_cost', 'nightly', 'plan_upgrade', 'signup', 'plan_month', 'live_check', 'reactivation', 'product_add'));
alter table public.lead_spend_charges add constraint lead_spend_charges_product_add_check
  check (kind <> 'product_add' or (products is not null and tier_to is not null and setup_cents is not null and plan_cents is not null
                                   and amount_cents = setup_cents + plan_cents + coalesce(spend_cents, 0) + coalesce(fee_cents, 0)));
-- Servicing-only charges already on the books: their plan is servicing.
update public.lead_spend_charges set servicing_cents = plan_cents
 where kind in ('signup', 'plan_month') and tier_to = 'servicing' and servicing_cents is null and plan_cents is not null;

-- ── 3. Sign-up: pick one or more ────────────────────────────────────────────
alter function public.billing_signup_quote(text, int, uuid) rename to billing_signup_quote_p933;
alter function public.billing_signup_start(text, int, uuid) rename to billing_signup_start_p933;

-- p_products null = the P933 way (p_tier 'servicing' = servicing only, else Leads).
create or replace function public.billing_signup_quote(p_tier text, p_daily_cents int, p_agent uuid default null, p_products text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); v_picked text[]; leads boolean; svc boolean; q jsonb; book jsonb; s int := 0;
        lines jsonb := '[]'::jsonb;
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  v_picked := billing_products_norm(coalesce(p_products, case when p_tier = 'servicing' then '{servicing}'::text[] else '{leads}'::text[] end));
  if cardinality(v_picked) = 0 then raise exception 'Pick at least one' using errcode = '22023', hint = 'no_products'; end if;
  leads := 'leads' = any(v_picked); svc := 'servicing' = any(v_picked);
  book := billing_book_for(me);
  if leads then
    q := billing_signup_quote_p933(p_tier, p_daily_cents, me);
    lines := jsonb_build_array(jsonb_build_object('key', 'leads', 'label', (q->>'label') || ' plan, first month', 'cents', (q->>'plan_cents')::int));
  elsif svc then
    q := billing_signup_quote_p933('servicing', null, me);
  else
    q := jsonb_build_object('tier', 'reactivation', 'label', 'Reactivation', 'daily_cents', 0, 'setup_cents', 0, 'plan_cents', 0,
      'days', '[]'::jsonb, 'spend_cents', 0, 'fee_cents', 0, 'fee_rate', 0, 'total_cents', 0, 'version', (book->>'version')::int, 'founding_left', 0);
  end if;
  if svc then
    s := (book->>'servicing_only_cents')::int;
    lines := lines || jsonb_build_array(jsonb_build_object('key', 'servicing', 'label', 'Servicing, first month', 'cents', s));
  end if;
  if leads and svc then
    q := q || jsonb_build_object('label', (q->>'label') || ' + Servicing', 'plan_cents', (q->>'plan_cents')::int + s,
                                 'total_cents', (q->>'total_cents')::int + s);
  end if;
  return q || jsonb_build_object('products', to_jsonb(v_picked), 'lead_plan_cents', case when leads then (q->>'plan_cents')::int - s else 0 end,
    'servicing_cents', s, 'lines', lines, 'free', not (leads or svc));
end; $$;

create or replace function public.billing_signup_start(p_tier text, p_daily_cents int, p_agent uuid default null, p_products text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); v_picked text[]; leads boolean; svc boolean; p record; pl agent_billing_plans;
        q jsonb; r jsonb; s int;
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  v_picked := billing_products_norm(coalesce(p_products, case when p_tier = 'servicing' then '{servicing}'::text[] else '{leads}'::text[] end));
  if cardinality(v_picked) = 0 then raise exception 'Pick at least one' using errcode = '22023', hint = 'no_products'; end if;
  leads := 'leads' = any(v_picked); svc := 'servicing' = any(v_picked);
  pl := billing_plan(me);
  if pl.signed_up_at is not null or pl.setup_paid_at is not null then raise exception 'You''ve already signed up' using hint = 'already_paid'; end if;

  if not (leads or svc) then
    -- Reactivation only: nothing is charged now (each list is paid when it's uploaded). A card on file, then open.
    select role, is_demo, billing_exempt into p from profiles where id = me;
    if p.role is distinct from 'agent' then raise exception 'Only agents are billed' using errcode = '42501'; end if;
    if p.is_demo then raise exception 'Test accounts are never charged' using hint = 'test_account'; end if;
    if p.billing_exempt then raise exception 'Your account isn''t billed' using hint = 'comped'; end if;
    if pl.card_on_file_at is null then raise exception 'Add a card first' using hint = 'no_card'; end if;
    update agent_billing_plans set plan = 'paid', picked = v_picked, signed_up_at = now(), tier_key = null, updated_at = now()
     where agent_id = me;
    update profiles set billing_status = 'active', billing_grace_until = null, billing_updated_at = now(), has_servicing = true,
           leads_status = 'none' where id = me;
    perform billing_log(me, 'signup_free', null, jsonb_build_object('products', v_picked), 'Signed up: reactivation only, nothing charged');
    perform notify(adm.id, 'new_agent_paid', 'New agent signed up',
                   coalesce((select full_name from profiles where id = me), 'An agent') || ' signed up for Reactivation only (no monthly plan).',
                   '/admin', false, 'signup-free:' || me || ':' || adm.id, null)
      from profiles adm where adm.role = 'admin' and coalesce(adm.is_active, true);
    return jsonb_build_object('status', 'paid', 'free', true, 'total_cents', 0, 'products', to_jsonb(v_picked));
  end if;

  r := billing_signup_start_p933(case when leads then p_tier else 'servicing' end, case when leads then p_daily_cents end, me);
  if coalesce((r->>'existing')::boolean, false) then return r; end if;
  update agent_billing_plans set picked = v_picked, updated_at = now() where agent_id = me;
  if leads and svc then
    s := (billing_book_for(me)->>'servicing_only_cents')::int;
    update lead_spend_charges set amount_cents = amount_cents + s, plan_cents = plan_cents + s, servicing_cents = s, products = v_picked,
           note = left(regexp_replace(note, ' plan, first month (\$[0-9,.]+)', ' plan, first month \1 · Servicing, first month $'
                                      || to_char(s / 100.0, 'FM999,990.00')), 300)
     where id = (r->>'charge_id')::uuid;
    r := r || jsonb_build_object('total_cents', (r->>'total_cents')::int + s, 'plan_cents', (r->>'plan_cents')::int + s,
                                 'label', (r->>'label') || ' + Servicing');
  else
    update lead_spend_charges set products = v_picked, servicing_cents = case when svc then plan_cents end where id = (r->>'charge_id')::uuid;
  end if;
  return r || jsonb_build_object('products', to_jsonb(v_picked), 'servicing_cents', coalesce(s, case when svc then (r->>'plan_cents')::int else 0 end));
end; $$;

-- ── 4. Add a product in Billing ─────────────────────────────────────────────
-- What adding p_product costs now. Leads needs p_tier + p_daily_cents (inside the band, like the sign-up).
create or replace function public.billing_product_quote(p_product text, p_tier text default null, p_daily_cents int default null,
                                                        p_agent uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans; book jsonb; bm jsonb; running boolean; monthly int;
        plan int; setup int; sq jsonb; label text; tier text; left_days int; days int;
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
      'days', '[]'::jsonb, 'spend_cents', 0, 'fee_cents', 0, 'fee_rate', 0, 'total_cents', 0, 'prorated', false);
  end if;
  book := billing_book_for(me);
  -- A month is running when Leads or Servicing is on and the first bill date has passed.
  running := pl.paid_start is not null and pl.paid_start <= billing_today() and ('leads' = any(pl.picked) or 'servicing' = any(pl.picked));
  bm := billing_bill_month(me);
  left_days := case when running then (bm->>'left')::int end;
  days := case when running then (bm->>'days')::int end;
  if p_product = 'servicing' then
    monthly := (book->>'servicing_only_cents')::int; label := 'Servicing'; tier := 'servicing';
    setup := case when pl.setup_paid_at is null then coalesce((book->'setup'->>'fee_cents')::int, 0) else 0 end;
    sq := jsonb_build_object('days', '[]'::jsonb, 'spend_cents', 0, 'fee_cents', 0, 'fee_rate', 0, 'daily_cents', 0);
  else
    sq := billing_signup_quote_p933(p_tier, p_daily_cents, me);   -- the band check, the first days of leads
    monthly := (sq->>'plan_cents')::int; label := sq->>'label'; tier := sq->>'tier';
    setup := case when pl.leads_setup_at is null then coalesce((book->'setup'->>'fee_cents')::int, 0) else 0 end;
  end if;
  plan := case when running then greatest(0, round(monthly::numeric * left_days / greatest(days, 1))::int) else monthly end;
  return jsonb_build_object('product', p_product, 'tier', tier, 'label', label, 'monthly_cents', monthly, 'plan_cents', plan,
    'prorated', running, 'days_left', left_days, 'days_in_month', days,
    'bill_from', case when running then bm->>'start' else billing_today()::text end,
    'bill_to', case when running then bm->>'next' else (billing_today() + interval '1 month')::date::text end,
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
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, fee_rate,
                                  setup_cents, plan_cents, servicing_cents, tier_to, bill_from, bill_to, days_left, days_in_month,
                                  plan_daily_cents, products)
  values (me, billing_week_of(billing_today()), 'product_add', (q->>'total_cents')::int, 'product_add:' || me || ':' || (n + 1),
          left('Added ' || (q->>'label') || case when p_product = 'leads' then ' plan' else '' end
               || case when (q->>'setup_cents')::int > 0 then ' · setup $' || to_char((q->>'setup_cents')::int / 100.0, 'FM999,990.00') else '' end
               || case when (q->>'prorated')::boolean then ' · ' || (q->>'days_left') || ' days left this month $'
                       else ' · first month $' end || to_char((q->>'plan_cents')::int / 100.0, 'FM999,990.00')
               || case when (q->>'spend_cents')::int > 0
                       then ' · first ' || jsonb_array_length(q->'days') || ' days: $' || to_char((q->>'spend_cents')::int / 100.0, 'FM999,990.00')
                            || ' to your ads · $' || to_char((q->>'fee_cents')::int / 100.0, 'FM999,990.00') || ' booking desk' else '' end, 300),
          case when (q->>'spend_cents')::int > 0 then billing_today() + 1 end, nullif((q->>'spend_cents')::int, 0), nullif((q->>'fee_cents')::int, 0),
          (q->>'fee_rate')::numeric, (q->>'setup_cents')::int, (q->>'plan_cents')::int,
          case when p_product = 'servicing' then (q->>'plan_cents')::int end, q->>'tier', (q->>'bill_from')::date, (q->>'bill_to')::date,
          nullif((q->>'days_left')::int, 0), (q->>'days_in_month')::int, nullif((q->>'daily_cents')::int, 0), array[p_product])
  returning id into ch;
  perform billing_log(me, 'product_add_charge', null, q, 'Adding ' || (q->>'label'));
  return q || jsonb_build_object('charge_id', ch, 'status', 'due');
end; $$;

-- Paid: the product is on. Leads: its plan, its daily spend, the first days of leads paid (like the sign-up).
create or replace function public.billing_product_add_result(c lead_spend_charges, p_status text, p_pi text, p_failure text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare prod text := c.products[1]; pl agent_billing_plans; k int; nid uuid; ahead int := coalesce(lead_spend_days_ahead(), 2);
        label text; day_spend int; day_fee int;
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
  update agent_billing_plans set picked = picked || array[prod],
         picked_next = case when picked_next is null then null else picked_next || array[prod] end,
         setup_paid_at = coalesce(setup_paid_at, now()), signed_up_at = coalesce(signed_up_at, now()),
         leads_setup_at = case when prod = 'leads' then coalesce(leads_setup_at, now()) else leads_setup_at end,
         paid_start = case when c.days_left is null then c.bill_from else coalesce(paid_start, c.bill_from) end,
         tier_key = case when prod = 'leads' then c.tier_to else tier_key end,
         tier_version = case when prod = 'leads' then (billing_book_for(c.agent_id)->>'version')::int else tier_version end,
         next_tier_key = case when prod = 'leads' then null else next_tier_key end,
         next_tier_from = case when prod = 'leads' then null else next_tier_from end,
         spend_paused = case when prod = 'leads' then false else spend_paused end, updated_at = now()
   where agent_id = c.agent_id;
  update profiles set billing_status = 'active', billing_grace_until = null, billing_updated_at = now(), has_servicing = true,
         billing_current_period_end = case when c.days_left is null then (c.bill_to::timestamp at time zone 'America/Chicago') else billing_current_period_end end,
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
                      jsonb_build_object('products', pl.picked || array[prod], 'cents', c.amount_cents, 'pi', p_pi), 'Added ' || label);
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

-- The sign-up result also records the products bought (signed_up_at, leads_setup_at). One door for every result.
alter function public.lead_spend_charge_result(uuid, text, text, text) rename to lead_spend_charge_result_p952;
create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges; r jsonb;
begin
  select * into c from lead_spend_charges where id = p_id;
  if not found then raise exception 'no such charge'; end if;
  if c.kind = 'product_add' then
    if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
    select * into c from lead_spend_charges where id = p_id for update;
    if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
    return billing_product_add_result(c, p_status, p_pi, p_failure);
  end if;
  r := lead_spend_charge_result_p952(p_id, p_status, p_pi, p_failure);
  if c.kind = 'signup' and p_status = 'paid' then
    update agent_billing_plans set signed_up_at = coalesce(signed_up_at, now()),
           leads_setup_at = case when c.tier_to <> 'servicing' then coalesce(leads_setup_at, now()) else leads_setup_at end
     where agent_id = c.agent_id;
  end if;
  return r;
end; $$;

-- ── 5. Remove a product (ends at the next bill date), or keep it ────────────
create or replace function public.billing_product_remove(p_product text, p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans; nxt text[]; ends date;
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  select * into pl from agent_billing_plans where agent_id = me for update;
  if pl.agent_id is null or not (p_product = any(pl.picked)) then raise exception 'You don''t have it' using errcode = 'P0001', hint = 'not_have'; end if;
  if pl.picked_next is not null and not (p_product = any(pl.picked_next)) then
    return jsonb_build_object('product', p_product, 'ends', pl.picked_next_from, 'keeps', to_jsonb(pl.picked_next), 'existing', true);
  end if;
  if p_product = 'reactivation' then
    if cardinality(pl.picked) = 1 then
      raise exception 'It''s your only product. Add another first, or write to us to close your account.' using errcode = 'P0001', hint = 'only_product';
    end if;
    update agent_billing_plans set picked = array_remove(picked, 'reactivation'),
           picked_next = case when picked_next is null then null else array_remove(picked_next, 'reactivation') end, updated_at = now()
     where agent_id = me;
    perform billing_log(me, 'product_removed', jsonb_build_object('products', pl.picked), jsonb_build_object('products', array_remove(pl.picked, 'reactivation')),
                        'Removed Reactivation (lists already paid keep calling)');
    return jsonb_build_object('product', p_product, 'ends', billing_today(), 'keeps', to_jsonb(array_remove(pl.picked, 'reactivation')));
  end if;
  nxt := array_remove(coalesce(pl.picked_next, pl.picked), p_product);
  -- Nothing monthly left: the portal stays, with Reactivation (pay per list, no monthly plan).
  if not ('leads' = any(nxt) or 'servicing' = any(nxt)) then nxt := billing_products_norm(nxt || '{reactivation}'::text[]); end if;
  ends := (billing_bill_month(me)->>'next')::date;
  update agent_billing_plans set picked_next = nxt, picked_next_from = ends,
         next_tier_key = case when p_product = 'leads' then null else next_tier_key end,
         next_tier_from = case when p_product = 'leads' then null else next_tier_from end, updated_at = now()
   where agent_id = me;
  perform billing_log(me, 'product_remove', jsonb_build_object('products', pl.picked), jsonb_build_object('products', nxt, 'from', ends),
                      'Removing ' || initcap(p_product) || ' on the next bill date');
  return jsonb_build_object('product', p_product, 'ends', ends, 'keeps', to_jsonb(nxt));
end; $$;

create or replace function public.billing_product_keep(p_product text, p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); pl agent_billing_plans; nxt text[];
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  select * into pl from agent_billing_plans where agent_id = me for update;
  if pl.picked_next is null or not (p_product = any(pl.picked)) or p_product = any(pl.picked_next) then
    return jsonb_build_object('product', p_product, 'kept', true, 'unchanged', true);
  end if;
  nxt := billing_products_norm(pl.picked_next || array[p_product]);
  -- Reactivation was only added to fill the gap; with a monthly product back it goes again unless they had it.
  if not ('reactivation' = any(pl.picked)) then nxt := array_remove(nxt, 'reactivation'); end if;
  update agent_billing_plans set picked_next = case when nxt = picked then null else nxt end,
         picked_next_from = case when nxt = picked then null else picked_next_from end, updated_at = now()
   where agent_id = me;
  perform billing_log(me, 'product_keep', null, jsonb_build_object('product', p_product), 'Kept ' || initcap(p_product));
  return jsonb_build_object('product', p_product, 'kept', true);
end; $$;

-- On the bill date: the removals happen (before the month is billed). Leads off = no plan, no nightly spend.
create or replace function public.billing_products_rollover(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare d date := coalesce(p_day, billing_today()); a agent_billing_plans; n int := 0;
begin
  for a in select * from agent_billing_plans where picked_next is not null and picked_next_from <= d for update loop
    update agent_billing_plans set picked = picked_next, picked_next = null, picked_next_from = null,
           tier_key = case when 'leads' = any(picked_next) then tier_key end,
           next_tier_key = case when 'leads' = any(picked_next) then next_tier_key end,
           next_tier_from = case when 'leads' = any(picked_next) then next_tier_from end,
           spend_paused = case when 'leads' = any(picked_next) then spend_paused else true end, updated_at = now()
     where agent_id = a.agent_id;
    if 'leads' = any(a.picked) and not ('leads' = any(a.picked_next)) then
      update profiles set leads_status = 'none' where id = a.agent_id;
    end if;
    perform billing_log(a.agent_id, 'products', jsonb_build_object('products', a.picked), jsonb_build_object('products', a.picked_next), 'Removal took effect');
    perform notify(a.agent_id, 'billing_charged', 'Your products changed',
                   'From today: ' || array_to_string(array(select initcap(x) from unnest(a.picked_next) x), ', ') || '.',
                   '/billing', false, 'products:' || a.agent_id || ':' || d, null);
    n := n + 1;
  end loop;
  return n;
end; $$;

alter function public.billing_daily_sweep() rename to billing_daily_sweep_p933;
create or replace function public.billing_daily_sweep() returns int language plpgsql security definer set search_path = public as $$
begin
  return billing_products_rollover() + billing_daily_sweep_p933();
end; $$;

-- ── 6. The monthly bill by product ─────────────────────────────────────────
create or replace function public.agent_membership_due(p_agent uuid) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare pl agent_billing_plans; pb jsonb := billing_book_for(p_agent); tier jsonb; mode text; fee int; v_months int; term_end date;
        lead_base int := 0; svc_base int := 0; base int; monthly int; cc jsonb := billing_client_counts(p_agent); incl int; cnt int;
        over int := 0; extra int := 0; lines jsonb := '[]'::jsonb; leads boolean; svc boolean; picked text[];
begin
  select * into pl from agent_billing_plans where agent_id = p_agent;
  if pl.agent_id is null then pl.plan := 'paid'; pl.picked := '{leads}'; end if;
  picked := coalesce(pl.picked, '{leads}');
  if pl.plan = 'pilot' then
    return jsonb_build_object('plan', 'pilot', 'membership_cents', 0, 'setup_cents', 0, 'lines', '[]'::jsonb, 'products', to_jsonb(picked),
                              'clients', cc || jsonb_build_object('included', null, 'over', 0, 'extra_cents', 0), 'lead_fee_rate', 0);
  end if;
  leads := 'leads' = any(picked); svc := 'servicing' = any(picked);
  if leads then
    select t into tier from jsonb_array_elements(pb->'tiers') t where t->>'key' = pl.tier_key;
    tier := coalesce(tier, billing_tier_in(pb, lead_spend_daily_total(p_agent)));
    lead_base := coalesce(nullif(tier->>'monthly_cents', '')::int, 0);
    lines := lines || jsonb_build_array(jsonb_build_object('key', 'leads', 'label', 'Plan, ' || (tier->>'label'), 'cents', lead_base));
  end if;
  if svc then
    svc_base := (pb->>'servicing_only_cents')::int;
    lines := lines || jsonb_build_array(jsonb_build_object('key', 'servicing', 'label', case when leads then 'Servicing' else 'Servicing only' end, 'cents', svc_base));
    if not leads then tier := jsonb_build_object('key', 'servicing', 'label', 'Servicing only', 'monthly_cents', svc_base); end if;
  end if;
  if not (leads or svc) then tier := jsonb_build_object('key', 'reactivation', 'label', 'Reactivation', 'monthly_cents', 0); end if;
  -- Included clients: Leads 50 added · Servicing 100 (all clients) · both 150 added. Reactivation only: what they sell is theirs, included.
  incl := case when leads and svc then (pb->>'included_added_clients')::int + (pb->>'servicing_base_clients')::int
               when leads then (pb->>'included_added_clients')::int
               when svc then (pb->>'servicing_base_clients')::int end;
  cnt := case when svc and not leads then (cc->>'total')::int else (cc->>'added')::int end;
  if incl is not null then over := greatest(0, cnt - incl); extra := billing_extra_clients_cents(pb, over); end if;
  base := lead_base + svc_base;
  monthly := base + extra;
  mode := coalesce(pl.setup_mode, pb->'setup'->>'mode');
  fee := case when pl.setup_paid_at is not null or not (leads or svc) then 0
              when mode = 'fee' then coalesce(pl.setup_fee_cents, (pb->'setup'->>'fee_cents')::int) else 0 end;
  v_months := case when mode = 'none_min_term' then coalesce(pl.min_term_months, (pb->'setup'->>'min_months')::int) else 0 end;
  term_end := case when v_months > 0 and pl.paid_start is not null then (pl.paid_start + make_interval(0, v_months))::date end;
  if extra > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('key', 'extra', 'label', 'Extra clients: ' || over || ' over the ' || incl || ' included', 'cents', extra));
  end if;
  if fee > 0 then lines := lines || jsonb_build_array(jsonb_build_object('key', 'setup', 'label', 'Setup (one time)', 'cents', fee)); end if;
  return jsonb_build_object(
    'plan', 'paid', 'tier', tier, 'next_tier', pl.next_tier_key, 'price_version', coalesce(pl.tier_version, (pb->>'version')::int),
    'products', to_jsonb(picked), 'products_next', to_jsonb(pl.picked_next), 'products_next_from', pl.picked_next_from,
    'membership_cents', monthly, 'plan_cents', base, 'lead_plan_cents', lead_base, 'servicing_cents', svc_base,
    'extra_clients_cents', extra, 'setup_mode', mode, 'setup_cents', fee, 'min_term_end', term_end,
    'early_cancel_cents', case when term_end is not null and term_end > billing_today() and monthly is not null
                               then monthly * greatest(1, ceil(extract(epoch from (term_end::timestamp - billing_today()::timestamp)) / (86400 * 30.4))::int) else 0 end,
    'clients', cc || jsonb_build_object('included', incl, 'over', over, 'extra_cents', extra),
    'lead_fee_rate', case when leads then lead_spend_fee_rate(p_agent) else 0 end,
    'lines', lines);
end; $$;

create or replace function public.billing_added_clients_quote(p_new int) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare me uuid := auth.uid(); m jsonb; pl agent_billing_plans; pb jsonb; cc jsonb; all_n boolean; incl int; now_n int; after_n int;
        x_now int; x_after int;
begin
  if me is null or not exists (select 1 from profiles where id = me and role = 'agent') then
    raise exception 'Only an agent can add clients' using errcode = '42501';
  end if;
  if p_new is null or p_new < 0 or p_new > 2000 then raise exception 'Between 0 and 2,000 clients' using errcode = '22023'; end if;
  select * into pl from agent_billing_plans where agent_id = me;
  pb := billing_book_for(me); cc := billing_client_counts(me); m := agent_membership_due(me);
  incl := nullif(m->'clients'->>'included', '')::int;
  all_n := 'servicing' = any(coalesce(pl.picked, '{leads}')) and not ('leads' = any(coalesce(pl.picked, '{leads}')));
  now_n := case when all_n then (cc->>'total')::int else (cc->>'added')::int end;
  after_n := now_n + p_new;
  x_now := case when incl is null then 0 else billing_extra_clients_cents(pb, now_n - incl) end;
  x_after := case when incl is null then 0 else billing_extra_clients_cents(pb, after_n - incl) end;
  return jsonb_build_object('counts', case when all_n then 'all' else 'added' end, 'included', incl, 'count_now', now_n, 'count_after', after_n,
    'extra_now_cents', x_now, 'extra_after_cents', x_after, 'change_cents', x_after - x_now,
    'step_clients', coalesce((pb->>'servicing_step_clients')::int, 100), 'step_cents', coalesce((pb->>'servicing_step_cents')::int, 0),
    'pilot', coalesce(pl.plan, 'paid') = 'pilot');
end; $$;

-- The monthly charge records its servicing part (Revenue by product).
create or replace function public.billing_plan_month_run(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare d date := coalesce(p_day, billing_today()); a record; bm jsonb; m jsonb; n int := 0; plan int; extra int; label text;
begin
  for a in select pl.agent_id from agent_billing_plans pl join profiles p on p.id = pl.agent_id
            where pl.plan = 'paid' and pl.setup_paid_at is not null and pl.paid_start is not null and pl.paid_start < d
              and ('leads' = any(pl.picked) or 'servicing' = any(pl.picked))
              and p.role = 'agent' and coalesce(p.is_active, true) and not p.is_demo and not coalesce(p.billing_exempt, false)
              and coalesce(p.billing_status, 'none') not in ('canceled', 'lapsed', 'exempt') loop
    bm := billing_bill_month(a.agent_id);
    continue when (bm->>'start')::date <> d;
    continue when exists (select 1 from lead_spend_charges c where c.key = 'plan_month:' || a.agent_id || ':' || d);
    m := agent_membership_due(a.agent_id);
    plan := coalesce((m->>'plan_cents')::int, 0); extra := coalesce((m->>'extra_clients_cents')::int, 0);
    continue when plan + extra <= 0;
    label := coalesce(m->'tier'->>'label', 'Plan') || case when (m->>'lead_plan_cents')::int > 0 and (m->>'servicing_cents')::int > 0 then ' + Servicing' else '' end;
    insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, plan_cents, extra_cents, servicing_cents, products,
                                    tier_to, bill_from, bill_to)
    values (a.agent_id, billing_week_of(d), 'plan_month', plan + extra, 'plan_month:' || a.agent_id || ':' || d,
            left(label || ' plan, ' || to_char(d, 'Mon FMDD') || ' to ' || to_char((bm->>'next')::date, 'Mon FMDD')
                 || case when extra > 0 then ' · extra clients $' || to_char(extra / 100.0, 'FM999,990.00') else '' end, 300),
            plan, extra, nullif((m->>'servicing_cents')::int, 0), array(select jsonb_array_elements_text(m->'products')),
            coalesce(m->'tier'->>'key', 'servicing'), d, (bm->>'next')::date)
    on conflict (key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end; $$;

-- ── 7. Admin: revenue by product ───────────────────────────────────────────
-- Leads = lead plan fees (sign-up, month, upgrades, added) + the booking desk. Servicing = servicing plan fees + extra
-- clients. Reactivation = lists paid, less refunds. Setup apart. Lead spend (to the ads) stays its own line.
create or replace function public.admin_billing_revenue(p_from date, p_to date) returns jsonb language plpgsql stable
security definer set search_path = public as $$
declare rows jsonb;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(r order by r->>'name'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'agent_id', p.id, 'name', p.full_name, 'plan', coalesce(pl.plan, 'paid'), 'products', coalesce(pl.products, 'both'),
      'picked', to_jsonb(coalesce(pl.picked, '{leads}'::text[])), 'picked_next', to_jsonb(pl.picked_next), 'picked_next_from', pl.picked_next_from,
      'plan_fee_cents', case when coalesce(pl.plan, 'paid') = 'pilot' then 0 else coalesce((agent_membership_due(p.id)->>'membership_cents')::int, 0) end,
      'lead_spend_cents', coalesce((select sum(case when c.kind = 'nightly' then c.spend_cents else c.amount_cents end) from lead_spend_charges c
                                     where c.agent_id = p.id and c.status = 'paid' and c.kind in ('nightly', 'weekly', 'change')
                                       and coalesce(c.for_day, (c.created_at at time zone 'America/Chicago')::date) between p_from and p_to), 0),
      'lead_fee_cents', coalesce((select sum(c.fee_cents) from lead_spend_charges c where c.agent_id = p.id and c.status = 'paid'
                                   and c.kind = 'nightly' and c.for_day between p_from and p_to), 0),
      'setup_cents', coalesce((select sum(c.setup_cents) from lead_spend_charges c where c.agent_id = p.id and c.status = 'paid'
                                and c.kind in ('signup', 'product_add') and (c.updated_at at time zone 'America/Chicago')::date between p_from and p_to), 0),
      'plan_paid_cents', coalesce((select sum(case when c.kind in ('signup', 'product_add') then c.plan_cents else c.amount_cents end) from lead_spend_charges c
                                    where c.agent_id = p.id and c.status = 'paid' and c.kind in ('signup', 'plan_month', 'plan_upgrade', 'product_add')
                                      and (c.updated_at at time zone 'America/Chicago')::date between p_from and p_to), 0),
      'leads_cents', coalesce((select sum(case when c.kind = 'plan_upgrade' then c.amount_cents
                                               when c.kind = 'nightly' then coalesce(c.fee_cents, 0)
                                               when c.tier_to = 'servicing' then 0
                                               else coalesce(c.plan_cents, 0) - coalesce(c.servicing_cents, 0) end)
                                 from lead_spend_charges c where c.agent_id = p.id and c.status = 'paid'
                                  and c.kind in ('signup', 'plan_month', 'plan_upgrade', 'product_add', 'nightly')
                                  and coalesce(case when c.kind = 'nightly' then c.for_day end, (c.updated_at at time zone 'America/Chicago')::date) between p_from and p_to), 0),
      'servicing_cents', coalesce((select sum(coalesce(c.servicing_cents, case when c.tier_to = 'servicing' then c.plan_cents else 0 end) + coalesce(c.extra_cents, 0))
                                     from lead_spend_charges c where c.agent_id = p.id and c.status = 'paid' and c.kind in ('signup', 'plan_month', 'product_add')
                                      and (c.updated_at at time zone 'America/Chicago')::date between p_from and p_to), 0),
      'reactivation_cents', coalesce((select sum(c.amount_cents - c.refunded_cents) from lead_spend_charges c where c.agent_id = p.id
                                        and c.status = 'paid' and c.kind = 'reactivation'
                                        and (c.updated_at at time zone 'America/Chicago')::date between p_from and p_to), 0),
      'refunded_cents', coalesce((select sum(c.refunded_cents) from lead_spend_charges c where c.agent_id = p.id
                                   and (c.updated_at at time zone 'America/Chicago')::date between p_from and p_to), 0)) as r
      from profiles p left join agent_billing_plans pl on pl.agent_id = p.id
     where p.role = 'agent' and coalesce(p.is_active, true) and not p.is_demo) x;
  return jsonb_build_object('from', p_from, 'to', p_to, 'agents', rows,
    'plan_fees_monthly_cents', (select coalesce(sum((r->>'plan_fee_cents')::int), 0) from jsonb_array_elements(rows) r),
    'lead_spend_cents', (select coalesce(sum((r->>'lead_spend_cents')::int), 0) from jsonb_array_elements(rows) r),
    'lead_fee_cents', (select coalesce(sum((r->>'lead_fee_cents')::int), 0) from jsonb_array_elements(rows) r),
    'setup_cents', (select coalesce(sum((r->>'setup_cents')::int), 0) from jsonb_array_elements(rows) r),
    'plan_paid_cents', (select coalesce(sum((r->>'plan_paid_cents')::int), 0) from jsonb_array_elements(rows) r),
    'refunded_cents', (select coalesce(sum((r->>'refunded_cents')::int), 0) from jsonb_array_elements(rows) r),
    'by_product', jsonb_build_object(
      'leads', (select coalesce(sum((r->>'leads_cents')::int), 0) from jsonb_array_elements(rows) r),
      'servicing', (select coalesce(sum((r->>'servicing_cents')::int), 0) from jsonb_array_elements(rows) r),
      'reactivation', (select coalesce(sum((r->>'reactivation_cents')::int), 0) from jsonb_array_elements(rows) r),
      'setup', (select coalesce(sum((r->>'setup_cents')::int), 0) from jsonb_array_elements(rows) r)),
    'counts', jsonb_build_object(
      'leads', (select count(*) from jsonb_array_elements(rows) r where r->'picked' ? 'leads'),
      'servicing', (select count(*) from jsonb_array_elements(rows) r where r->'picked' ? 'servicing'),
      'reactivation', (select count(*) from jsonb_array_elements(rows) r where r->'picked' ? 'reactivation')),
    'live_charging', billing_live_charging());
end; $$;

-- The charges list says which product a charge was for (an added product shows as "Added Servicing").
create or replace function public.admin_billing_charges(p_limit int default 30) returns jsonb language plpgsql stable
security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'agent', coalesce(p.full_name, p.email), 'kind', c.kind, 'cents', c.amount_cents,
                        'spend_cents', c.spend_cents, 'fee_cents', c.fee_cents, 'setup_cents', c.setup_cents, 'plan_cents', c.plan_cents,
                        'extra_cents', c.extra_cents, 'servicing_cents', c.servicing_cents, 'products', to_jsonb(c.products),
                        'refunded_cents', c.refunded_cents, 'status', c.status, 'failure', c.failure,
                        'note', c.note, 'for_day', c.for_day, 'at', c.updated_at) order by c.updated_at desc)
                     from (select * from lead_spend_charges order by updated_at desc limit greatest(1, least(coalesce(p_limit, 30), 200))) c
                     join profiles p on p.id = c.agent_id), '[]'::jsonb);
end; $$;

-- ── 8. Sign-up details: also when adding Leads later (P941 allowed them only before the setup was paid) ──
create or replace function public.save_signup_details(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me      profiles;
  el      jsonb;
  k       text;
  v_states text[];
  v_day   smallint;
  v_days  smallint[] := '{}';
  v_live  boolean;
  v_phone text;
  v_start time;
  v_end   time;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into me from profiles where id = auth.uid() for update;
  if not found or me.role::text <> 'agent' or not coalesce(me.is_active, false) or me.deleted_at is not null then
    raise exception 'Only an active agent can sign up' using errcode = '42501';
  end if;
  if exists (select 1 from agent_billing_plans b where b.agent_id = me.id
                and (b.leads_setup_at is not null or (b.setup_paid_at is not null and 'leads' = any(b.picked)))) then
    raise exception 'You''ve already signed up. Change these in Settings.' using errcode = 'P0001', hint = 'already_paid';
  end if;

  -- Check everything first, so one bad field means nothing is saved.
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Details must be a JSON object' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('states', 'licensed', 'timezone', 'working_hours', 'live_transfers', 'live_transfer_phone') then
      raise exception 'Unknown detail: %', k using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(p -> 'states') is distinct from 'array' then raise exception 'Pick your states' using errcode = '22023'; end if;
  select array_agg(distinct upper(btrim(x)) order by upper(btrim(x))) into v_states from jsonb_array_elements_text(p -> 'states') x;
  v_states := coalesce(v_states, '{}');
  if exists (select 1 from unnest(v_states) s where s !~ '^[A-Z]{2}$') then raise exception 'That isn''t a state' using errcode = '22023'; end if;
  if cardinality(v_states) < 3 or cardinality(v_states) > 10 then
    raise exception 'Pick 3 to 10 states' using errcode = '22023', hint = 'states';
  end if;
  if v_states && public.licence_not_taking() then
    raise exception 'We aren''t taking % yet', (select string_agg(s, ', ') from unnest(v_states) s where s = any (public.licence_not_taking()))
      using errcode = '22023', hint = 'states';
  end if;
  if (p -> 'licensed') is distinct from 'true'::jsonb then
    raise exception 'Tick the box to confirm you''re licensed in every state you picked' using errcode = '22023', hint = 'licence';
  end if;

  if jsonb_typeof(p -> 'timezone') is distinct from 'string' or not exists (select 1 from pg_timezone_names where name = p ->> 'timezone') then
    raise exception 'Pick your time zone' using errcode = '22023', hint = 'timezone';
  end if;

  if jsonb_typeof(p -> 'working_hours') is distinct from 'array' or jsonb_array_length(p -> 'working_hours') = 0 then
    raise exception 'Set the hours you take calls' using errcode = '22023', hint = 'hours';
  end if;
  for el in select jsonb_array_elements(p -> 'working_hours') loop
    if jsonb_typeof(el -> 'weekday') is distinct from 'number' or el ->> 'weekday' !~ '^[1-7]$' then
      raise exception 'Each day needs a weekday from 1 to 7' using errcode = '22023';
    end if;
    v_day := (el ->> 'weekday')::smallint;
    if v_day = any (v_days) then raise exception 'That day is listed twice' using errcode = '22023'; end if;
    v_days := v_days || v_day;
    if jsonb_typeof(el -> 'start') is distinct from 'string' or jsonb_typeof(el -> 'end') is distinct from 'string'
       or el ->> 'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or el ->> 'end' !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
      raise exception 'Times must look like 09:00' using errcode = '22023';
    end if;
    if (el ->> 'start')::time >= (el ->> 'end')::time then
      raise exception 'Hours must end after they start. Overnight hours aren''t allowed.' using errcode = '22023', hint = 'hours';
    end if;
  end loop;

  if jsonb_typeof(p -> 'live_transfers') is distinct from 'boolean' then
    raise exception 'Say whether you take live transfers' using errcode = '22023', hint = 'live';
  end if;
  v_live := (p ->> 'live_transfers')::boolean;
  v_phone := case when v_live then p ->> 'live_transfer_phone' end;
  if v_live and (v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception 'Add the phone live transfers ring (like +15125551234)' using errcode = '22023', hint = 'phone';
  end if;

  -- Save. The flag lets this one writer through the locked-sign-up guard on agent_lead_settings (this transaction only).
  perform set_config('ohvara.signup_details', 'on', true);
  insert into agent_lead_settings (agent_id, states, licensed_at, licensed_states, updated_at)
  values (me.id, v_states, now(), v_states, now())
  on conflict (agent_id) do update set states = excluded.states, licensed_at = now(), licensed_states = excluded.licensed_states, updated_at = now();
  perform set_config('ohvara.signup_details', '', true);

  delete from agent_working_hours where agent_id = me.id;
  insert into agent_working_hours (agent_id, weekday, start_time, end_time)
  select me.id, (d.v ->> 'weekday')::smallint, (d.v ->> 'start')::time, (d.v ->> 'end')::time
    from jsonb_array_elements(p -> 'working_hours') d(v);
  select min(start_time), max(end_time) into v_start, v_end from agent_working_hours where agent_id = me.id;

  update profiles set timezone = p ->> 'timezone', timezone_confirmed_at = now(),
         working_hours_start = v_start, working_hours_end = v_end, live_transfer_phone = v_phone
   where id = me.id;

  return public.my_signup_details();
end; $$;
revoke execute on function public.save_signup_details(jsonb) from public, anon;
grant  execute on function public.save_signup_details(jsonb) to authenticated;

-- ── 9. Doors ────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'billing_products_norm(text[])', 'billing_products_sync()', 'billing_has(uuid,text)',
    'billing_signup_quote(text,integer,uuid,text[])', 'billing_signup_start(text,integer,uuid,text[])',
    'billing_signup_quote_p933(text,integer,uuid)', 'billing_signup_start_p933(text,integer,uuid)',
    'billing_product_quote(text,text,integer,uuid)', 'billing_product_add(text,text,integer,uuid)',
    'billing_product_add_result(lead_spend_charges,text,text,text)', 'lead_spend_charge_result(uuid,text,text,text)',
    'lead_spend_charge_result_p952(uuid,text,text,text)', 'billing_product_remove(text,uuid)', 'billing_product_keep(text,uuid)',
    'billing_products_rollover(date)', 'billing_daily_sweep()', 'billing_daily_sweep_p933()', 'agent_membership_due(uuid)',
    'billing_added_clients_quote(integer)', 'billing_plan_month_run(date)', 'admin_billing_revenue(date,date)', 'admin_billing_charges(integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Signed-in callers (each checks the caller inside). Adding a paid product goes through lead-spend (it charges).
  foreach f in array array['billing_signup_quote(text,integer,uuid,text[])', 'billing_product_quote(text,text,integer,uuid)',
    'billing_product_remove(text,uuid)', 'billing_product_keep(text,uuid)', 'billing_added_clients_quote(integer)',
    'admin_billing_revenue(date,date)', 'admin_billing_charges(integer)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
