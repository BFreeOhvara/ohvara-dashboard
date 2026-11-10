-- 260_billing_live (Prompt 933, Brayden Nov 9): billing goes live on the final prices. NOT APPLIED until Brayden's yes.
--
-- Before (P927 found): lead spend charged only on an sk_test_ key, the $299 setup and the monthly plans weren't billed
-- anywhere, and a new sign-up still got the old weekly Stripe checkout. Now every charge is one off-session
-- PaymentIntent on the card on file, made by the database and run by the lead-spend function (like the nightly and
-- P921 upgrade charges), so there is one engine and one source of prices (price book v3 via billing_book_for):
--
--   1. Sign-up ('signup' charge): $299 setup + the first month of the plan + the first days_ahead (2) days of lead
--      spend + the booking desk (12% of that spend). billing_signup_quote shows it; billing_signup_start saves the
--      plan and spend and makes the charge. Paid: setup and the plan are paid, the bill date is today, the two days are
--      paid nightly rows (the wallet gets the spend, P910), the portal opens. Declined: nothing changes, no retry by
--      itself (the agent fixes the card and pays again).
--   2. Monthly plan ('plan_month'): on the bill date (billing_bill_month), the plan from the agent's own book (founding
--      prices while locked) + servicing extra clients counted that day (agent_membership_due). Runs after the P921
--      roll-over, so a downgrade is billed at its new price. Declined: past due with 3 days of grace (P884's rules:
--      leads stop, servicing keeps going until grace ends), retried each morning, 3 tries.
--   3. Live charging (billing_settings.live_charging, default OFF): the lead-spend function charges a live (sk_live_)
--      key only while it's on. Off = test mode as before. Turning it on is Brayden's yes (admin_billing_live_set).
--   4. Test accounts never charge: a due charge for a demo/test account (profiles.is_demo; P929's is_test implies it)
--      is cancelled before it's claimed, whatever made it; sign-up refuses them.
--   5. Booking desk: the 12% is named "booking desk" in every note the agent can see (a trigger words the nightly ones).
--   6. Stripe check (Admin): billing_settings remembers the last webhook (billing_webhook_seen) and the catalog sync.
--   7. Revenue: setup and plan fees collected, apart; demo/test accounts left out; recent charges (admin_billing_charges).
--
-- Wrappers (the long bodies aren't copied): lead_spend_claim_charges, lead_spend_charge_result, billing_daily_sweep and
-- lead_spend_morning_retry are renamed …_p932 and wrapped. A later migration that redefines one keeps these steps.
-- Tests: supabase/tests/p933_billing_live.sql (PGlite).

-- ── 1. Settings ─────────────────────────────────────────────────────────────
alter table public.billing_settings
  add column if not exists live_charging     boolean not null default false,
  add column if not exists live_charging_at  timestamptz,
  add column if not exists live_charging_by  uuid references public.profiles(id) on delete set null,
  add column if not exists last_webhook_at   timestamptz,
  add column if not exists last_webhook_type text check (char_length(last_webhook_type) <= 80),
  add column if not exists last_webhook_live boolean,
  add column if not exists catalog           jsonb;
comment on column public.billing_settings.live_charging is
  'P933: real charges on a live Stripe key. Off = test mode (only an sk_test_ key charges). Turned on with Brayden''s yes.';
comment on column public.billing_settings.catalog is
  'P933: the Stripe products/prices made from price book v3, per mode: { test: {...}, live: {...} } (ids and amounts only).';

-- ── 2. Charges ──────────────────────────────────────────────────────────────
alter table public.lead_spend_charges drop constraint lead_spend_charges_kind_check;
alter table public.lead_spend_charges add constraint lead_spend_charges_kind_check
  check (kind in ('weekly', 'change', 'va_cost', 'nightly', 'plan_upgrade', 'signup', 'plan_month', 'live_check'));
alter table public.lead_spend_charges
  add column if not exists setup_cents    int check (setup_cents >= 0),
  add column if not exists plan_cents     int check (plan_cents >= 0),
  add column if not exists extra_cents    int check (extra_cents >= 0),
  add column if not exists bill_from      date,
  add column if not exists bill_to        date,
  add column if not exists refunded_cents int not null default 0 check (refunded_cents >= 0);
alter table public.lead_spend_charges add constraint lead_spend_charges_signup_check
  check (kind <> 'signup' or (tier_to is not null and setup_cents is not null and plan_cents is not null
                              and amount_cents = setup_cents + plan_cents + coalesce(spend_cents, 0) + coalesce(fee_cents, 0)));
alter table public.lead_spend_charges add constraint lead_spend_charges_month_check
  check (kind <> 'plan_month' or (plan_cents is not null and bill_from is not null and bill_to is not null
                                  and amount_cents = plan_cents + coalesce(extra_cents, 0)));

-- The booking desk: nightly notes name the 12% that way ("$100 to your ads · $12 booking desk"), never "+ 12%".
create or replace function public.lead_spend_charge_words() returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'nightly' and new.for_day is not null and new.spend_cents is not null then
    new.note := left('Lead spend for ' || to_char(new.for_day, 'Dy, Mon FMDD') || ': $' || to_char(new.spend_cents / 100.0, 'FM999,990.00')
                || ' to your ads' || case when coalesce(new.fee_cents, 0) > 0
                                          then ' · $' || to_char(new.fee_cents / 100.0, 'FM999,990.00') || ' booking desk' else '' end
                || case when coalesce(new.credit_cents, 0) > 0
                        then ' · $' || to_char(new.credit_cents / 100.0, 'FM999,990.00') || ' credit used' else '' end
                || case when new.note like '%sign-up%' then ' · paid with your sign-up' else '' end, 300);
  end if;
  return new;
end; $$;
drop trigger if exists lead_spend_charge_words on public.lead_spend_charges;
create trigger lead_spend_charge_words before insert on public.lead_spend_charges
  for each row execute function public.lead_spend_charge_words();

-- Admins hear about a new paid agent (bell + email, no push).
insert into public.notification_types (type, roles, label, email_default, email_via, in_bell, push, money, fires, sort)
select 'new_agent_paid', array['admin'], 'A new agent paid and started', true, 'notify', true, false, true, true,
       coalesce((select max(sort) from public.notification_types), 0) + 1
 where not exists (select 1 from public.notification_types t where t.type = 'new_agent_paid');

-- ── 3. Live charging ────────────────────────────────────────────────────────
create or replace function public.billing_live_charging() returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce((select live_charging from billing_settings where id), false)
$$;

create or replace function public.admin_billing_live_set(p_on boolean) returns jsonb language plpgsql
security definer set search_path = public as $$
declare before billing_settings; after billing_settings;
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_on is null then raise exception 'On or off' using errcode = '22023'; end if;
  select * into before from billing_settings where id;
  update billing_settings set live_charging = p_on, live_charging_at = now(), live_charging_by = auth.uid(), updated_at = now(), updated_by = auth.uid()
   where id returning * into after;
  insert into agent_billing_events (agent_id, kind, before, after, reason, by_user)
  values (auth.uid(), 'billing_settings', jsonb_build_object('live_charging', before.live_charging),
          jsonb_build_object('live_charging', p_on), case when p_on then 'Live charging turned on' else 'Live charging turned off' end, auth.uid());
  return jsonb_build_object('live_charging', after.live_charging, 'at', after.live_charging_at);
end; $$;

-- The billing webhook saw an event (agent-billing, service role). Only the type and the mode are kept.
create or replace function public.billing_webhook_seen(p_type text, p_live boolean) returns void language sql
security definer set search_path = public as $$
  update billing_settings set last_webhook_at = now(), last_webhook_type = left(p_type, 80), last_webhook_live = p_live where id
$$;

-- The catalog sync result (agent-billing stripe_catalog, service role): { mode, products: [...] }.
create or replace function public.billing_catalog_saved(p_mode text, p_catalog jsonb) returns void language sql
security definer set search_path = public as $$
  update billing_settings set catalog = coalesce(catalog, '{}'::jsonb) || jsonb_build_object(p_mode, p_catalog || jsonb_build_object('at', now()))
   where id and p_mode in ('test', 'live')
$$;

-- ── 4. Sign-up: the quote and the charge ────────────────────────────────────
-- p_tier: starter | growth | pro (p_daily_cents inside its band) | servicing (servicing only, no lead spend).
create or replace function public.billing_signup_quote(p_tier text, p_daily_cents int, p_agent uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); book jsonb; t jsonb; setup int; plan int; rate numeric := 0;
        ahead int := coalesce(lead_spend_days_ahead(), 2); days jsonb := '[]'::jsonb; k int; spend int := 0; fee int := 0;
        d int := coalesce(p_daily_cents, 0); lo int; hi int; maxd int;
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  book := billing_book_for(me);
  setup := coalesce((book->'setup'->>'fee_cents')::int, 0);
  if p_tier = 'servicing' then
    plan := (book->>'servicing_only_cents')::int;
    t := jsonb_build_object('key', 'servicing', 'label', 'Servicing only', 'monthly_cents', plan);
    d := 0;
  else
    select x into t from jsonb_array_elements(book->'tiers') x where x->>'key' = p_tier;
    if t is null then raise exception 'Pick a plan' using errcode = '22023', hint = 'bad_tier'; end if;
    plan := (t->>'monthly_cents')::int;
    maxd := billing_max_daily(me);
    lo := greatest((t->>'from')::int * 100, coalesce((book->>'paid_min_daily_cents')::int, 5000));
    hi := least(coalesce(nullif(t->>'to', '')::int * 100, maxd), maxd);
    if d < lo or d > hi then
      raise exception 'For % the daily spend is $% to $% a day', t->>'label', lo / 100, hi / 100 using errcode = '22023', hint = 'over_plan';
    end if;
    rate := coalesce((book->>'lead_fee_rate')::numeric, 0);
    for k in 1 .. ahead loop
      days := days || jsonb_build_array(jsonb_build_object('day', billing_today() + k, 'spend_cents', d, 'fee_cents', round(d * rate)::int));
      spend := spend + d; fee := fee + round(d * rate)::int;
    end loop;
  end if;
  return jsonb_build_object('tier', t->>'key', 'label', t->>'label', 'daily_cents', d, 'setup_cents', setup, 'plan_cents', plan,
    'days', days, 'spend_cents', spend, 'fee_cents', fee, 'fee_rate', rate, 'total_cents', setup + plan + spend + fee,
    'version', (book->>'version')::int,
    'founding_left', greatest(0, coalesce((select founding_count from billing_settings where id), 0)
                                 - (select count(*) from agent_billing_plans where founding_no is not null))::int);
end; $$;

-- Saves the plan and spend and makes the sign-up charge (the lead-spend function runs it straight away). One open
-- sign-up charge at a time: a second call returns it. Called by the lead-spend function with p_agent = the caller.
create or replace function public.billing_signup_start(p_tier text, p_daily_cents int, p_agent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := coalesce(p_agent, auth.uid()); p record; pl agent_billing_plans; q jsonb; open_c lead_spend_charges;
        n int; ch uuid; words text;
begin
  if me is null or (p_agent is not null and auth.uid() is not null and p_agent <> auth.uid() and not is_admin()) then
    raise exception 'Not your account' using errcode = '42501';
  end if;
  select role, is_demo, billing_exempt, coalesce(is_active, true) as active into p from profiles where id = me;
  if p.role is distinct from 'agent' then raise exception 'Only agents are billed' using errcode = '42501'; end if;
  if p.is_demo then raise exception 'Test accounts are never charged' using hint = 'test_account'; end if;
  if p.billing_exempt then raise exception 'Your account isn''t billed' using hint = 'comped'; end if;
  pl := billing_plan(me);
  if pl.setup_paid_at is not null then raise exception 'You''ve already signed up' using hint = 'already_paid'; end if;
  if pl.card_on_file_at is null then raise exception 'Add a card first' using hint = 'no_card'; end if;
  perform pg_advisory_xact_lock(hashtextextended('billing_signup:' || me, 0));
  select * into open_c from lead_spend_charges where agent_id = me and kind = 'signup' and status in ('due', 'processing') limit 1;
  if found then
    return jsonb_build_object('charge_id', open_c.id, 'total_cents', open_c.amount_cents, 'status', open_c.status, 'existing', true);
  end if;
  q := billing_signup_quote(p_tier, p_daily_cents, me);
  -- An earlier declined sign-up is replaced (it charged nothing).
  update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · replaced', 300), updated_at = now()
   where agent_id = me and kind = 'signup' and status = 'failed';
  select count(*) into n from lead_spend_charges where agent_id = me and kind = 'signup';
  update agent_billing_plans set plan = 'paid', products = case when p_tier = 'servicing' then 'servicing' else 'both' end,
         tier_key = case when p_tier = 'servicing' then null else p_tier end, tier_version = (q->>'version')::int,
         next_tier_key = null, next_tier_from = null, updated_at = now()
   where agent_id = me;
  if p_tier <> 'servicing' then perform billing_set_daily(me, (q->>'daily_cents')::int); end if;
  words := 'Sign-up: setup $' || to_char((q->>'setup_cents')::int / 100.0, 'FM999,990.00') || ' · ' || (q->>'label')
           || ' plan, first month $' || to_char((q->>'plan_cents')::int / 100.0, 'FM999,990.00')
           || case when (q->>'spend_cents')::int > 0
                   then ' · first ' || jsonb_array_length(q->'days') || ' days: $' || to_char((q->>'spend_cents')::int / 100.0, 'FM999,990.00')
                        || ' to your ads · $' || to_char((q->>'fee_cents')::int / 100.0, 'FM999,990.00') || ' booking desk' else '' end;
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, fee_rate,
                                  setup_cents, plan_cents, tier_to, bill_from, bill_to)
  values (me, billing_week_of(billing_today()), 'signup', (q->>'total_cents')::int, 'signup:' || me || ':' || (n + 1), left(words, 300),
          case when (q->>'spend_cents')::int > 0 then billing_today() + 1 end, (q->>'spend_cents')::int, (q->>'fee_cents')::int,
          (q->>'fee_rate')::numeric, (q->>'setup_cents')::int, (q->>'plan_cents')::int, q->>'tier',
          billing_today(), (billing_today() + interval '1 month')::date)
  returning id into ch;
  perform billing_log(me, 'signup_charge', null, q, 'Sign-up charge made');
  return q || jsonb_build_object('charge_id', ch, 'status', 'due');
end; $$;

-- ── 5. The result of a sign-up, a monthly plan or a live check ──────────────
create or replace function public.billing_charge_result_p933(c lead_spend_charges, p_status text, p_pi text, p_failure text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; k int; nid uuid; grace int; label text;
        period_end timestamptz := ((c.bill_to)::timestamp at time zone 'America/Chicago');
begin
  update lead_spend_charges set status = p_status, stripe_pi = coalesce(p_pi, stripe_pi),
         failure = case when p_status = 'failed' then left(coalesce(p_failure, 'Declined'), 300) else null end, updated_at = now()
   where id = c.id;
  if c.kind = 'live_check' then
    perform billing_log(c.agent_id, 'live_check', null, jsonb_build_object('status', p_status, 'cents', c.amount_cents, 'pi', p_pi), 'Live $1 check');
    return jsonb_build_object('status', p_status);
  end if;
  if p_status = 'processing' then return jsonb_build_object('status', p_status); end if;
  grace := coalesce((billing_book_for(c.agent_id)->>'grace_days')::int, 3);
  label := coalesce((select x->>'label' from jsonb_array_elements(billing_book_for(c.agent_id)->'tiers') x where x->>'key' = c.tier_to),
                    case when c.tier_to = 'servicing' then 'Servicing only' else c.tier_to end);

  if c.kind = 'signup' and p_status = 'paid' then
    update agent_billing_plans set setup_paid_at = now(), paid_start = c.bill_from, updated_at = now() where agent_id = c.agent_id;
    update profiles set billing_status = 'active', billing_current_period_end = period_end, billing_grace_until = null,
           billing_updated_at = now(), has_servicing = true,
           leads_status = case when c.tier_to = 'servicing' then 'none' else 'active' end
     where id = c.agent_id;
    -- The first days of lead spend: paid nightly rows (the wallet gets the spend; the ads run those days).
    if coalesce(c.spend_cents, 0) > 0 then
      for k in 1 .. coalesce(lead_spend_days_ahead(), 2) loop
        continue when exists (select 1 from lead_spend_charges x where x.agent_id = c.agent_id and x.kind = 'nightly' and x.for_day = c.bill_from + k);
        insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, credit_cents,
                                        fee_rate, status, attempts, stripe_pi)
        values (c.agent_id, billing_week_of(c.bill_from + k), 'nightly',
                (c.spend_cents / coalesce(lead_spend_days_ahead(), 2)) + round((c.spend_cents / coalesce(lead_spend_days_ahead(), 2)) * c.fee_rate)::int,
                'nightly:' || c.agent_id || ':' || (c.bill_from + k), 'sign-up', c.bill_from + k,
                c.spend_cents / coalesce(lead_spend_days_ahead(), 2), round((c.spend_cents / coalesce(lead_spend_days_ahead(), 2)) * c.fee_rate)::int, 0,
                c.fee_rate, 'processing', 1, p_pi)
        returning id into nid;
        perform lead_spend_charge_result_p932(nid, 'paid', p_pi, null);
      end loop;
    end if;
    perform billing_log(c.agent_id, 'charge_paid', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'setup_cents', c.setup_cents,
                        'plan_cents', c.plan_cents, 'spend_cents', c.spend_cents, 'fee_cents', c.fee_cents, 'tier', c.tier_to, 'pi', p_pi), null);
    perform notify(c.agent_id, 'billing_charged', 'You''re all set',
                   'Paid $' || to_char(c.amount_cents / 100.0, 'FM999,990.00') || ': setup, your ' || label || ' plan for this month'
                   || case when coalesce(c.spend_cents, 0) > 0 then ' and your first days of leads.' else '.' end,
                   '/billing', false, 'signup-paid:' || c.id, jsonb_build_object('cents', c.amount_cents));
    perform notify(adm.id, 'new_agent_paid', 'New agent paid',
                   coalesce((select full_name from profiles where id = c.agent_id), 'An agent') || ' signed up on ' || label
                   || ': $' || to_char(c.amount_cents / 100.0, 'FM999,990.00'), '/admin', false, 'signup-paid:' || c.id || ':' || adm.id, null)
      from profiles adm where adm.role = 'admin' and coalesce(adm.is_active, true);
  elsif c.kind = 'signup' and p_status = 'failed' then
    perform billing_log(c.agent_id, 'charge_failed', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'failure', p_failure), null);
    perform notify(c.agent_id, 'billing_charge_failed', 'Your card didn''t go through',
                   'Nothing was charged and nothing started. Try another card.', '/billing', true, 'signup-failed:' || c.id || ':' || c.attempts, null);
  elsif c.kind = 'plan_month' and p_status = 'paid' then
    update profiles set billing_status = 'active', billing_current_period_end = period_end, billing_grace_until = null, billing_updated_at = now()
     where id = c.agent_id;
    update lead_spend_charges set status = 'cancelled', note = left(coalesce(note, '') || ' · settled by a later payment', 300), updated_at = now()
     where agent_id = c.agent_id and kind = 'plan_month' and status = 'failed' and id <> c.id and bill_from <= c.bill_from;
    perform billing_log(c.agent_id, 'charge_paid', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'plan_cents', c.plan_cents,
                        'extra_cents', c.extra_cents, 'from', c.bill_from, 'to', c.bill_to, 'pi', p_pi), null);
    perform notify(c.agent_id, 'billing_charged', 'Plan paid',
                   'Paid $' || to_char(c.amount_cents / 100.0, 'FM999,990.00') || ' for ' || label || ', '
                   || to_char(c.bill_from, 'Mon FMDD') || ' to ' || to_char(c.bill_to, 'Mon FMDD') || '.',
                   '/billing', false, 'month-paid:' || c.id, jsonb_build_object('cents', c.amount_cents));
    perform lead_spend_refresh_control(c.agent_id);
  elsif c.kind = 'plan_month' and p_status = 'failed' then
    update profiles set billing_status = 'past_due', billing_updated_at = now(),
           billing_grace_until = coalesce(case when billing_status = 'past_due' then billing_grace_until end, now() + make_interval(days => grace))
     where id = c.agent_id;
    perform billing_log(c.agent_id, 'charge_failed', null, jsonb_build_object('kind', c.kind, 'cents', c.amount_cents, 'failure', p_failure), null);
    perform notify(c.agent_id, 'billing_charge_failed', 'Your plan payment didn''t go through',
                   'New leads are stopped until it''s paid. Servicing keeps going for ' || grace || ' days. Update your card and we try again straight away.',
                   '/billing', true, 'month-failed:' || c.id || ':' || c.attempts, null);
    perform notify(adm.id, 'billing_payment_problem', 'A plan payment failed',
                   coalesce((select full_name from profiles where id = c.agent_id), 'An agent') || ': ' || coalesce(p_failure, 'declined'),
                   '/admin', true, 'month-failed:' || c.id || ':' || c.attempts || ':' || adm.id, null)
      from profiles adm where adm.role = 'admin' and coalesce(adm.is_active, true);
    perform lead_spend_refresh_control(c.agent_id);
  end if;
  return jsonb_build_object('status', p_status);
end; $$;

alter function public.lead_spend_charge_result(uuid, text, text, text) rename to lead_spend_charge_result_p932;
create or replace function public.lead_spend_charge_result(p_id uuid, p_status text, p_pi text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lead_spend_charges;
begin
  select * into c from lead_spend_charges where id = p_id;
  if not found then raise exception 'no such charge'; end if;
  if c.kind not in ('signup', 'plan_month', 'live_check') then return lead_spend_charge_result_p932(p_id, p_status, p_pi, p_failure); end if;
  if p_status not in ('paid', 'processing', 'failed') then raise exception 'bad status'; end if;
  select * into c from lead_spend_charges where id = p_id for update;
  if c.status in ('paid', 'cancelled') then return jsonb_build_object('status', c.status, 'duplicate', true); end if;
  return billing_charge_result_p933(c, p_status, p_pi, p_failure);
end; $$;

-- A refund the lead-spend function made (the live check, unused spend at cancel). Adds up, never past the charge.
create or replace function public.billing_charge_refunded(p_id uuid, p_cents int) returns jsonb language plpgsql
security definer set search_path = public as $$
declare c lead_spend_charges;
begin
  update lead_spend_charges set refunded_cents = least(amount_cents, refunded_cents + greatest(0, p_cents)), updated_at = now()
   where id = p_id returning * into c;
  if not found then raise exception 'no such charge'; end if;
  perform billing_log(c.agent_id, 'refund', null, jsonb_build_object('charge', c.id, 'cents', p_cents, 'refunded_cents', c.refunded_cents), null);
  return jsonb_build_object('refunded_cents', c.refunded_cents);
end; $$;

-- The live check (P927/P933): one $1 charge on the admin's own saved card, refunded straight away by the lead-spend
-- function. Admins only; the function runs it on Brayden's yes.
create or replace function public.billing_live_check_start(p_admin uuid) returns jsonb language plpgsql
security definer set search_path = public as $$
declare ch uuid; n int;
begin
  if (select role from profiles where id = p_admin) is distinct from 'admin' then raise exception 'Admins only' using errcode = '42501'; end if;
  if exists (select 1 from lead_spend_charges where agent_id = p_admin and kind = 'live_check' and status in ('due', 'processing')) then
    raise exception 'A check is already running' using hint = 'busy';
  end if;
  select count(*) into n from lead_spend_charges where agent_id = p_admin and kind = 'live_check';
  insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note)
  values (p_admin, billing_week_of(billing_today()), 'live_check', 100, 'live_check:' || p_admin || ':' || (n + 1), 'Live check: $1, refunded')
  returning id into ch;
  return jsonb_build_object('charge_id', ch);
end; $$;

-- ── 6. Test accounts never charge; the claim is the one door every charge goes through ──
alter function public.lead_spend_claim_charges(int, uuid) rename to lead_spend_claim_charges_p932;
create or replace function public.lead_spend_claim_charges(p_limit int default 25, p_agent uuid default null)
returns setof jsonb language plpgsql security definer set search_path = public as $$
begin
  update lead_spend_charges c set status = 'cancelled', note = left(coalesce(c.note, '') || ' · test account, never charged', 300), updated_at = now()
   where c.status = 'due' and (p_agent is null or c.agent_id = p_agent)
     and exists (select 1 from profiles p where p.id = c.agent_id and p.is_demo);
  return query select * from lead_spend_claim_charges_p932(p_limit, p_agent);
end; $$;

-- ── 7. The monthly plan, on the bill date ───────────────────────────────────
create or replace function public.billing_plan_month_run(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare d date := coalesce(p_day, billing_today()); a record; bm jsonb; m jsonb; n int := 0; plan int; extra int; label text;
begin
  for a in select pl.agent_id from agent_billing_plans pl join profiles p on p.id = pl.agent_id
            where pl.plan = 'paid' and pl.setup_paid_at is not null and pl.paid_start is not null and pl.paid_start < d
              and p.role = 'agent' and coalesce(p.is_active, true) and not p.is_demo and not coalesce(p.billing_exempt, false)
              and coalesce(p.billing_status, 'none') not in ('canceled', 'lapsed', 'exempt') loop
    bm := billing_bill_month(a.agent_id);
    continue when (bm->>'start')::date <> d;
    continue when exists (select 1 from lead_spend_charges c where c.key = 'plan_month:' || a.agent_id || ':' || d);
    m := agent_membership_due(a.agent_id);
    plan := coalesce((m->>'plan_cents')::int, 0); extra := coalesce((m->>'extra_clients_cents')::int, 0);
    continue when plan + extra <= 0;
    label := coalesce(m->'tier'->>'label', 'Plan');
    insert into lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, plan_cents, extra_cents, tier_to, bill_from, bill_to)
    values (a.agent_id, billing_week_of(d), 'plan_month', plan + extra, 'plan_month:' || a.agent_id || ':' || d,
            left(label || ' plan, ' || to_char(d, 'Mon FMDD') || ' to ' || to_char((bm->>'next')::date, 'Mon FMDD')
                 || case when extra > 0 then ' · extra clients $' || to_char(extra / 100.0, 'FM999,990.00') else '' end, 300),
            plan, extra, coalesce(m->'tier'->>'key', 'servicing'), d, (bm->>'next')::date)
    on conflict (key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end; $$;

alter function public.billing_daily_sweep() rename to billing_daily_sweep_p932;
create or replace function public.billing_daily_sweep() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  n := billing_daily_sweep_p932();          -- P921 roll-over first, so a downgrade is billed at its new price
  return n + billing_plan_month_run();
end; $$;

-- Morning retries: a declined plan month is tried each morning, 3 tries in all (nightly retries are unchanged).
alter function public.lead_spend_morning_retry(date) rename to lead_spend_morning_retry_p932;
create or replace function public.lead_spend_morning_retry(p_day date default null) returns int language plpgsql
security definer set search_path = public as $$
declare n int; m int;
begin
  n := lead_spend_morning_retry_p932(p_day);
  update lead_spend_charges set status = 'due', failure = null, note = left(coalesce(note, '') || ' · morning retry', 300), updated_at = now()
   where kind = 'plan_month' and status = 'failed' and attempts < 3
     and updated_at < (coalesce(p_day, billing_today())::timestamp at time zone 'America/Chicago');
  get diagnostics m = row_count;
  return n + m;
end; $$;

-- ── 8. Admin: revenue with setup and plan fees collected, and recent charges ──
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
                                   and c.kind = 'nightly' and c.for_day between p_from and p_to), 0),
      'setup_cents', coalesce((select sum(c.setup_cents) from lead_spend_charges c where c.agent_id = p.id and c.status = 'paid'
                                and c.kind = 'signup' and (c.updated_at at time zone 'America/Chicago')::date between p_from and p_to), 0),
      'plan_paid_cents', coalesce((select sum(case when c.kind = 'signup' then c.plan_cents else c.amount_cents end) from lead_spend_charges c
                                    where c.agent_id = p.id and c.status = 'paid' and c.kind in ('signup', 'plan_month', 'plan_upgrade')
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
    'live_charging', billing_live_charging());
end; $$;

-- The last charges, every kind, newest first (the live check included). Names, amounts and status only.
create or replace function public.admin_billing_charges(p_limit int default 30) returns jsonb language plpgsql stable
security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'agent', coalesce(p.full_name, p.email), 'kind', c.kind, 'cents', c.amount_cents,
                        'spend_cents', c.spend_cents, 'fee_cents', c.fee_cents, 'setup_cents', c.setup_cents, 'plan_cents', c.plan_cents,
                        'extra_cents', c.extra_cents, 'refunded_cents', c.refunded_cents, 'status', c.status, 'failure', c.failure,
                        'note', c.note, 'for_day', c.for_day, 'at', c.updated_at) order by c.updated_at desc)
                     from (select * from lead_spend_charges order by updated_at desc limit greatest(1, least(coalesce(p_limit, 30), 200))) c
                     join profiles p on p.id = c.agent_id), '[]'::jsonb);
end; $$;

-- ── 9. Doors (P922: nothing new is open to anon) ────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'lead_spend_charge_words()', 'billing_live_charging()', 'admin_billing_live_set(boolean)', 'billing_webhook_seen(text,boolean)',
    'billing_catalog_saved(text,jsonb)', 'billing_signup_quote(text,integer,uuid)', 'billing_signup_start(text,integer,uuid)',
    'billing_charge_result_p933(lead_spend_charges,text,text,text)', 'lead_spend_charge_result(uuid,text,text,text)', 'billing_live_check_start(uuid)',
    'lead_spend_charge_result_p932(uuid,text,text,text)', 'billing_charge_refunded(uuid,integer)',
    'lead_spend_claim_charges(integer,uuid)', 'lead_spend_claim_charges_p932(integer,uuid)', 'billing_plan_month_run(date)',
    'billing_daily_sweep()', 'billing_daily_sweep_p932()', 'lead_spend_morning_retry(date)', 'lead_spend_morning_retry_p932(date)',
    'admin_billing_revenue(date,date)', 'admin_billing_charges(integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Signed-in callers (each checks the caller inside).
  foreach f in array array['admin_billing_live_set(boolean)', 'billing_signup_quote(text,integer,uuid)',
    'admin_billing_revenue(date,date)', 'admin_billing_charges(integer)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
