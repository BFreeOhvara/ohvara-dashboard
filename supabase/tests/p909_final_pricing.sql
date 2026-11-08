-- p909_final_pricing — pgTAP checks for p909_final_pricing.sql: price book version 3 (plans by daily spend band, 12% of
-- lead spend, servicing by book size), the $500 max and admin override, the nightly card charge (spend x 1.12, the
-- true-up credit, declined → ads off the next day → morning retry → a passed day let go), the 50 included added
-- clients, the founding lock, the admin revenue split and the grants.
--
-- RUN: `npm run test:sql -- supabase/tests/p909_final_pricing.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p909_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a9090000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a9090000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Ann Paid'),
    ('a9090000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent', 'Ben Pilot'),
    ('a9090000-0000-4000-8000-00000000000c'::uuid, 'agent_c', 'agent', 'Cal NoCard'),
    ('a9090000-0000-4000-8000-00000000000d'::uuid, 'agent_d', 'agent', 'Dee Servicing'),
    ('a9090000-0000-4000-8000-00000000000e'::uuid, 'agent_e', 'agent', 'Eve Added'),
    ('a9090000-0000-4000-8000-00000000000f'::uuid, 'agent_f', 'agent', 'Fay Late')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin' where id = 'a9090000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true, billing_status = 'active'
 where id::text like 'a9090000-%' and id <> 'a9090000-0000-4000-8000-000000000001';
update public.profiles set is_active = false where role = 'agent' and id::text not like 'a9090000-%';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
-- Days counted from the day version 3 took effect (the day the migration was applied).
create function pg_temp.e(n int) returns date language sql as $$
  select effective_from + n from public.billing_price_book where version = 3
$$;
create function pg_temp.day(n int) returns void language sql as $$ select set_config('ohvara.today', pg_temp.e(n)::text, true) $$;
create function pg_temp.runs(a uuid, k text) returns text language sql as $$ select public.billing_runs(a)->>k $$;
create function pg_temp.ch(a uuid, d int) returns public.lead_spend_charges language sql as $$
  select * from public.lead_spend_charges where agent_id = a and kind = 'nightly' and for_day = pg_temp.e(d)
$$;
create function pg_temp.pay(a uuid, d int, s text) returns jsonb language plpgsql as $$
declare c public.lead_spend_charges := pg_temp.ch(a, d);
begin
  update public.lead_spend_charges set status = 'processing', attempts = attempts + 1, updated_at = now() where id = c.id and status = 'due';
  return public.lead_spend_charge_result(c.id, s, 'pi_' || substr(c.id::text, 1, 8) || '_' || c.attempts, case when s = 'failed' then 'Card declined' end);
end; $$;
create function pg_temp.added(a uuid, n int, src text) returns void language sql as $$
  insert into public.policies (agent_id, client_first_name, client_last_name, carrier_name, policy_number, status, effective_date, state, source)
  select a, 'C', 'N' || g, 'Harborline Life', 'P909-' || left(a::text, 4) || '-' || src || '-' || g || '-' || clock_timestamp()::text, 'In Effect', current_date, 'TX', src
    from generate_series(1, n) g
$$;
select pg_temp.day(0);
-- P910: these checks are for P909's one-day rhythm (charge tomorrow); p910_paid_day_ahead.sql tests two days ahead.
update public.billing_settings set days_ahead = 1 where id;


-- ── a. price book version 3 ─────────────────────────────────────────────────
select is((public.price_book()->>'version')::int, 3, 'a1 version 3 is in effect from the day it was applied');
select is(public.price_book()->>'status', 'final', 'a2 final');
select is((select count(*)::int from public.billing_price_book where version in (1, 2)), 2, 'a3 versions 1 and 2 are kept');
select is((select string_agg(public.billing_tier_for(c)->>'key', ',' order by c) from unnest(array[5000, 7500, 7600, 10000, 20000, 20100, 50000]) c),
          'starter,starter,growth,growth,growth,pro,pro', 'a4 bands: $50 $75 Starter, $76 $100 $200 Growth, $201 $500 Pro');
select is((select string_agg(public.billing_tier_for(c)->>'monthly_cents', ',' order by c) from unnest(array[5000, 7600, 20100]) c),
          '69900,149900,299900', 'a5 $699, $1,499, $2,999 a month');
select is(public.billing_tier_for(3000)->>'key', 'starter', 'a6 under $50 reads as Starter');
select is(public.billing_tier_for(60000)->>'key', 'pro', 'a7 over $500 (an admin raise) reads as Pro');
select is((public.price_book()->>'lead_fee_rate')::numeric, 0.12, 'a8 12% of lead spend');
select is(public.price_book()->'setup', '{"mode": "fee", "fee_cents": 29900, "min_months": 0, "refundable": false}'::jsonb, 'a9 $299 setup once, not refunded');

-- ── b. grants ───────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.lead_spend_nightly(date)', 'execute'), 'b1 only the server makes the nightly charges');
select ok(not has_function_privilege('authenticated', 'public.lead_spend_hourly(timestamptz)', 'execute'), 'b2 only cron runs the hourly job');
select ok(not has_function_privilege('authenticated', 'public.billing_card_saved(uuid, text)', 'execute'), 'b3 only the server records a card');
select ok(has_function_privilege('authenticated', 'public.billing_added_clients_quote(integer)', 'execute'), 'b4 an agent can quote added clients');

-- ── c. cards, plans, the max and the min ────────────────────────────────────
select public.billing_card_saved(id, 'Visa ending 4242') from public.profiles where id::text like 'a9090000-%' and id::text not like '%c' and role = 'agent';
select pg_temp.as_user('a9090000-0000-4000-8000-000000000001');
select public.admin_billing_pilot_set('a9090000-0000-4000-8000-00000000000b', true);
select pg_temp.as_owner();
update public.agent_billing_plans set products = 'servicing' where agent_id = 'a9090000-0000-4000-8000-00000000000d';
select pg_temp.as_user('a9090000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.lead_product_set(50100, 'appts') $$, 'P0001', 'Daily lead spend can be up to $500 a day', 'c1 over $500 a day is refused');
select throws_ok($$ select public.lead_product_set(4000, 'appts') $$, 'P0001', 'Paid plans need at least $50 a day. Pause instead?', 'c2 under $50 a day is refused');
select is((public.lead_product_set(10000, 'appts'))->>'daily_cents', '10000', 'c3 $100 a day is saved (from tomorrow)');
select is((select count(*)::int from public.lead_spend_charges where agent_id = 'a9090000-0000-4000-8000-00000000000a' and kind in ('weekly', 'change')), 0, 'c4 no weekly or mid-week raise charge');
select throws_ok($$ select public.admin_billing_max_daily_set('a9090000-0000-4000-8000-00000000000c', 60000) $$, '42501', null, 'c5 an agent can''t raise a max');
select pg_temp.as_owner();
select throws_ok($$ select public.lead_spend_set(60000, 0, 'a9090000-0000-4000-8000-00000000000c') $$, 'P0001', null, 'c6 the server can''t go over the max either');
select pg_temp.as_user('a9090000-0000-4000-8000-000000000001');
select is(public.admin_billing_max_daily_set('a9090000-0000-4000-8000-00000000000c', 60000), 60000, 'c7 admin raises one agent to $600');
select pg_temp.as_owner();
select is((public.lead_spend_set(60000, 0, 'a9090000-0000-4000-8000-00000000000c'))->>'from', pg_temp.e(1)::text, 'c8 and that agent can now set $600');
select is((select tier_key from public.agent_billing_plans where agent_id = 'a9090000-0000-4000-8000-00000000000a'), 'growth', 'c9 $100 a day is Growth');
select public.lead_spend_set(10000, 0, 'a9090000-0000-4000-8000-00000000000b');
select public.lead_spend_set(10000, 0, 'a9090000-0000-4000-8000-00000000000f');

-- ── d. the nightly charge ───────────────────────────────────────────────────
select is(public.lead_spend_nightly(), 3, 'd1 tonight: one charge each for the paid, pilot and late agents');
select is((pg_temp.ch('a9090000-0000-4000-8000-00000000000a', 1)).amount_cents, 11200, 'd2 $100 a day is charged $112');
select is(((pg_temp.ch('a9090000-0000-4000-8000-00000000000a', 1)).spend_cents, (pg_temp.ch('a9090000-0000-4000-8000-00000000000a', 1)).fee_cents), (10000, 1200), 'd3 $100 spend + $12 (12%)');
select is((pg_temp.ch('a9090000-0000-4000-8000-00000000000b', 1)).amount_cents, 10000, 'd4 a pilot agent pays only their spend');
select is((select count(*)::int from public.lead_spend_charges where agent_id = 'a9090000-0000-4000-8000-00000000000c'), 0, 'd5 no card: nothing charged');
select is(public.lead_spend_nightly(), 0, 'd6 running it again makes no second charge');
select is((pg_temp.pay('a9090000-0000-4000-8000-00000000000a', 1, 'paid'))->>'status', 'paid', 'd7 approved');
select is(public.lead_spend_balance('a9090000-0000-4000-8000-00000000000a'), 10000, 'd8 the spend lands in the wallet, the 12% doesn''t');
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000a', 'lead_spend'), 'off', 'd9 today stays off: the new spend starts tomorrow');
select pg_temp.pay('a9090000-0000-4000-8000-00000000000b', 1, 'paid');
select pg_temp.day(1);
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000a', 'ads'), 'true', 'd9b tomorrow, paid: ads run');
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000c', 'lead_spend'), 'no_card', 'd10 no card on file: leads don''t start');
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000f', 'lead_spend'), 'waiting_payment', 'd11 today''s charge not approved yet: leads wait');
select is(public.lead_spend_nightly(), 3, 'd12 next night: the same three agents, one charge each');
select pg_temp.pay('a9090000-0000-4000-8000-00000000000a', 2, 'paid');

-- ── e. the true-up: Meta spent $90 of the $100 → $10 and its 12% come off the next charge ─
select pg_temp.day(2);
select public.lead_spend_record_delivered('a9090000-0000-4000-8000-00000000000a', 'appts', pg_temp.e(1), 9000);
select is(public.lead_spend_credit('a9090000-0000-4000-8000-00000000000a'), 1000, 'e1 $10 credit from yesterday');
select is(public.lead_spend_nightly() >= 1, true, 'e2 tonight''s charges are made');
select is((pg_temp.ch('a9090000-0000-4000-8000-00000000000a', 3)).amount_cents, 10080, 'e3 tonight: $90 + 12% = $100.80 ($11.20 less)');
select is((pg_temp.ch('a9090000-0000-4000-8000-00000000000a', 3)).credit_cents, 1000, 'e4 with the $10 credit shown');
select pg_temp.pay('a9090000-0000-4000-8000-00000000000a', 3, 'paid');

-- ── f. declined → tomorrow's ads off → morning retry ────────────────────────
select pg_temp.day(3);
select public.lead_spend_record_delivered('a9090000-0000-4000-8000-00000000000a', 'appts', pg_temp.e(2), 10000);
select public.lead_spend_pause(true, 'a9090000-0000-4000-8000-00000000000b');
select public.lead_spend_nightly();
select is((pg_temp.pay('a9090000-0000-4000-8000-00000000000a', 4, 'failed'))->>'status', 'failed', 'f1 declined');
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000a', 'ads'), 'true', 'f2 tonight''s ads (already paid) keep running');
select is((select count(*)::int from public.notifications where profile_id = 'a9090000-0000-4000-8000-00000000000a' and type = 'billing_charge_failed'), 1, 'f3 the agent gets a Fix card notice');
select ok((select coalesce(detail, '') || ' ' || coalesce(message, '') from public.notifications where profile_id = 'a9090000-0000-4000-8000-00000000000a' and type = 'billing_charge_failed') like '%Tomorrow''s leads are off%8 AM.%', 'f4 it says tomorrow''s leads are off and when we retry');
select pg_temp.day(4);
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000a', 'lead_spend'), 'stopped_payment', 'f5 the next day: ads off');
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000a', 'ads'), 'false', 'f6 nothing runs');
select is(public.lead_spend_morning_retry(), 1, 'f7 the morning retry');
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000a', 'lead_spend'), 'waiting_payment', 'f8 still off until it goes through');
select is(public.lead_spend_morning_retry(), 0, 'f9 only once');
select pg_temp.pay('a9090000-0000-4000-8000-00000000000a', 4, 'paid');
select is(pg_temp.runs('a9090000-0000-4000-8000-00000000000a', 'ads'), 'true', 'f10 approved on the retry: ads back on');

-- A day that's never paid is let go: nothing owed.
select public.lead_spend_record_delivered('a9090000-0000-4000-8000-00000000000a', 'appts', pg_temp.e(3), 10000);
select public.lead_spend_nightly();
select pg_temp.pay('a9090000-0000-4000-8000-00000000000a', 5, 'failed');
select pg_temp.day(5);
select public.lead_spend_morning_retry();
select pg_temp.pay('a9090000-0000-4000-8000-00000000000a', 5, 'failed');
-- P910: day 4's spend is reported first; an unpaid day reserves nothing, so unreported money would read as credit.
select public.lead_spend_record_delivered('a9090000-0000-4000-8000-00000000000a', 'appts', pg_temp.e(4), 10000);
select public.lead_spend_nightly();
select is((pg_temp.ch('a9090000-0000-4000-8000-00000000000a', 5)).status, 'cancelled', 'f11 a declined day that passed is let go');
select is((select count(*)::int from public.lead_spend_charges where agent_id = 'a9090000-0000-4000-8000-00000000000a' and kind = 'nightly' and for_day = pg_temp.e(6)), 1, 'f12 and tomorrow is charged as usual');

-- ── g. pauses, the hourly job ───────────────────────────────────────────────
select is((select count(*)::int from public.lead_spend_charges where agent_id = 'a9090000-0000-4000-8000-00000000000b' and for_day = pg_temp.e(4)), 0, 'g1 a paused agent isn''t charged');
select ok(public.lead_spend_hourly((pg_temp.e(5)::text || ' 09:10')::timestamp at time zone 'America/Chicago') ? 'retried', 'g2 9 AM: the retry runs');
select ok(not (public.lead_spend_hourly((pg_temp.e(5)::text || ' 09:10')::timestamp at time zone 'America/Chicago') ? 'charged'), 'g3 and no charging');
select ok(public.lead_spend_hourly((pg_temp.e(5)::text || ' 20:05')::timestamp at time zone 'America/Chicago') ? 'charged', 'g4 8 PM: the nightly charge runs');
select public.lead_spend_pause(false, 'a9090000-0000-4000-8000-00000000000b');

-- ── h. servicing by book size ───────────────────────────────────────────────
select pg_temp.added('a9090000-0000-4000-8000-00000000000d', 80, 'ohvara');
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000d')->>'membership_cents')::int, 49900, 'h1 servicing only, 80 clients: $499');
select pg_temp.added('a9090000-0000-4000-8000-00000000000d', 20, 'agent_added');
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000d')->>'membership_cents')::int, 49900, 'h2 100 clients: $499');
select pg_temp.added('a9090000-0000-4000-8000-00000000000d', 150, 'ohvara');
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000d')->>'membership_cents')::int, 89900, 'h3 250 clients: $499 + 2 x $200 = $899');
select is(jsonb_array_length(public.agent_membership_due('a9090000-0000-4000-8000-00000000000d')->'lines') >= 2, true, 'h4 the extra clients are their own line');

-- Lead plans: sold clients are included, plus 50 the agent adds.
select public.lead_spend_set(10000, 0, 'a9090000-0000-4000-8000-00000000000e');
select pg_temp.added('a9090000-0000-4000-8000-00000000000e', 120, 'ohvara');
select pg_temp.added('a9090000-0000-4000-8000-00000000000e', 50, 'agent_added');
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000e')->>'extra_clients_cents')::int, 0, 'h5 sold clients + 50 added: nothing extra');
select pg_temp.as_user('a9090000-0000-4000-8000-00000000000e');
select is(public.billing_added_clients_quote(1)->>'change_cents', '20000', 'h6 Add clients: the 51st costs +$200 a month');
select is(public.billing_added_clients_quote(100)->>'change_cents', '20000', 'h7 100 more (150 added) is still +$200');
select is(public.billing_added_clients_quote(101)->>'change_cents', '40000', 'h8 101 more (151 added) is +$400');
select pg_temp.as_owner();
select pg_temp.added('a9090000-0000-4000-8000-00000000000e', 1, 'agent_added');
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000e')->>'membership_cents')::int, 149900 + 20000, 'h9 Growth + one extra 100');

-- ── i. founding agents ──────────────────────────────────────────────────────
select is((select founding_no from public.agent_billing_plans where agent_id = 'a9090000-0000-4000-8000-00000000000a'), 1, 'i1 the first paying agent is founding agent 1');
select is((select founding_until from public.agent_billing_plans where agent_id = 'a9090000-0000-4000-8000-00000000000a'), (pg_temp.e(0) + interval '12 months')::date, 'i2 for 12 months from their first payment');
select is((select founding_no from public.agent_billing_plans where agent_id = 'a9090000-0000-4000-8000-00000000000b'), null::int, 'i3 a pilot agent isn''t paying yet');
select pg_temp.as_user('a9090000-0000-4000-8000-000000000001');
select is((public.admin_billing_settings_save('{"founding_count": 1}'::jsonb)->>'founding_count')::int, 1, 'i4 admin sets the founding count');
select pg_temp.as_owner();
update public.agent_billing_plans set paid_start = pg_temp.e(5) where agent_id = 'a9090000-0000-4000-8000-00000000000e';
select is((select founding_no from public.agent_billing_plans where agent_id = 'a9090000-0000-4000-8000-00000000000e'), null::int, 'i5 past the count: no founding place');
-- A later price (version 4: Growth $1,599) doesn't reach the founding agent until their lock ends.
select pg_temp.as_user('a9090000-0000-4000-8000-000000000001');
select public.admin_price_book_save(jsonb_set(public.price_book(), '{tiers,1,monthly_cents}', '159900'), pg_temp.e(6), 'test: higher Growth');
select pg_temp.as_owner();
select pg_temp.day(6);
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000a')->>'plan_cents')::int, 149900, 'i6 the founding agent keeps $1,499');
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000e')->>'plan_cents')::int, 159900, 'i7 a later agent pays the new price');
select set_config('ohvara.today', ((select founding_until from public.agent_billing_plans where agent_id = 'a9090000-0000-4000-8000-00000000000a') + 1)::text, true);
select is((public.agent_membership_due('a9090000-0000-4000-8000-00000000000a')->>'plan_cents')::int, 159900, 'i8 after the lock ends, the new price');
select pg_temp.day(6);

-- ── j. reads ────────────────────────────────────────────────────────────────
select pg_temp.as_user('a9090000-0000-4000-8000-00000000000a');
select is(public.my_billing()->'founding'->>'until', (select founding_until::text from public.agent_billing_plans where agent_id = 'a9090000-0000-4000-8000-00000000000a'), 'j1 Billing shows the founding end date');
select is(public.my_billing()->'settings'->>'max_daily_cents', '50000', 'j2 Billing knows the max');
select is(public.my_billing()->'card'->>'label', 'Visa ending 4242', 'j3 and the card on file');
select ok(public.my_billing()->'next_charge' ? 'total_cents', 'j4 and tonight''s charge');
select pg_temp.as_user('a9090000-0000-4000-8000-000000000001');
select is((select (r->>'lead_fee_cents')::int from jsonb_array_elements(public.admin_billing_revenue(pg_temp.e(0), pg_temp.e(10))->'agents') r where r->>'agent_id' = 'a9090000-0000-4000-8000-00000000000a'),
          (select sum(fee_cents)::int from public.lead_spend_charges where agent_id = 'a9090000-0000-4000-8000-00000000000a' and kind = 'nightly' and status = 'paid'), 'j5 admin revenue: the 12% on its own');
select is((select (r->>'lead_fee_cents')::int from jsonb_array_elements(public.admin_billing_revenue(pg_temp.e(0), pg_temp.e(10))->'agents') r where r->>'agent_id' = 'a9090000-0000-4000-8000-00000000000b'),
          0, 'j6 a pilot agent paid no 12%');
select ok((select (r->>'plan_fee_cents')::int from jsonb_array_elements(public.admin_billing_revenue(pg_temp.e(0), pg_temp.e(10))->'agents') r where r->>'agent_id' = 'a9090000-0000-4000-8000-00000000000a') > 0,
          'j7 and the plan fee apart');
select pg_temp.as_user('a9090000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.admin_billing_revenue(current_date, current_date) $$, '42501', null, 'j8 agents can''t read revenue');

select * from finish();
rollback;
