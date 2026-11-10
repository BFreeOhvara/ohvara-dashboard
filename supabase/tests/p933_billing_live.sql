-- p933_billing_live — pgTAP checks for 260_billing_live.sql: the sign-up charge per plan (setup + first month + 2 days
-- of lead spend + booking desk), what paying it opens, a declined sign-up, the monthly plan on the bill date (with a
-- P921 downgrade and servicing extra clients), a declined month → past due + morning retries, test accounts never
-- charged, the Live charging switch, booking desk words, revenue.
--
-- RUN: `npm run test:sql -- supabase/tests/p933_billing_live.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p933_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a9330000-0000-4000-8000-00000000000a'::uuid, 'a', 'Ann Growth'),
    ('a9330000-0000-4000-8000-00000000000b'::uuid, 'b', 'Ben Servicing'),
    ('a9330000-0000-4000-8000-00000000000c'::uuid, 'c', 'Cy Declined'),
    ('a9330000-0000-4000-8000-00000000000d'::uuid, 'd', 'Dee Test'),
    ('a9330000-0000-4000-8000-00000000000e'::uuid, 'e', 'Eve Admin')
  ) as u(id, n, full_name);
update public.profiles set role = 'agent', is_active = true, billing_status = 'none', signup_source = 'self' where id::text like 'a9330000-%';
update public.profiles set role = 'admin' where id = 'a9330000-0000-4000-8000-00000000000e';
update public.profiles set is_demo = true where id = 'a9330000-0000-4000-8000-00000000000d';

create function pg_temp.a() returns uuid language sql as $$ select 'a9330000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'a9330000-0000-4000-8000-00000000000b'::uuid $$;
create function pg_temp.c() returns uuid language sql as $$ select 'a9330000-0000-4000-8000-00000000000c'::uuid $$;
create function pg_temp.d() returns uuid language sql as $$ select 'a9330000-0000-4000-8000-00000000000d'::uuid $$;
create function pg_temp.day(d date) returns void language sql as $$ select set_config('ohvara.today', d::text, true) $$;
-- What the lead-spend function does: claim, then report Stripe's answer.
create function pg_temp.run(x uuid, s text) returns int language plpgsql as $$
declare j jsonb; n int := 0;
begin
  for j in select * from public.lead_spend_claim_charges(25, x) loop
    perform public.lead_spend_charge_result((j->>'id')::uuid, s, 'pi_' || substr(j->>'id', 1, 8), case when s = 'failed' then 'Card declined' end);
    n := n + 1;
  end loop;
  return n;
end; $$;
create function pg_temp.last(x uuid, k text) returns public.lead_spend_charges language sql as $$
  select * from public.lead_spend_charges where agent_id = x and kind = k order by created_at desc, id desc limit 1
$$;

alter table public.billing_price_book disable trigger billing_price_book_block;
update public.billing_price_book set effective_from = case version when 1 then date '2026-10-01' when 2 then date '2026-10-15' else date '2026-11-02' end;
alter table public.billing_price_book enable trigger billing_price_book_block;
update public.billing_settings set founding_count = 0, charge_mode = 'nightly';
select pg_temp.day('2026-11-09');

-- ── a. the quote ────────────────────────────────────────────────────────────
select is((public.billing_signup_quote('growth', 10000, pg_temp.a()))->>'total_cents', '202200', 'a1 Growth at $100/day: 299 + 1,499 + 200 + 24 = $2,022');
select is((public.billing_signup_quote('starter', 5000, pg_temp.a()))->>'total_cents', (29900 + 69900 + 10000 + 1200)::text, 'a2 Starter at $50/day');
select is((public.billing_signup_quote('pro', 50000, pg_temp.a()))->>'total_cents', (29900 + 299900 + 100000 + 12000)::text, 'a3 Pro at $500/day');
select is((public.billing_signup_quote('servicing', null, pg_temp.b()))->>'total_cents', (29900 + 49900)::text, 'a4 Servicing only: setup + $499, no lead spend');
select throws_ok($$ select public.billing_signup_quote('growth', 5000, pg_temp.a()) $$, '22023', null, 'a5 $50/day isn''t in Growth''s band');
select throws_ok($$ select public.billing_signup_quote('gold', 5000, pg_temp.a()) $$, '22023', 'Pick a plan', 'a6 no such plan');

-- ── b. sign-up needs a card; test accounts never ────────────────────────────
select throws_ok($$ select public.billing_signup_start('growth', 10000, pg_temp.a()) $$, 'P0001', 'Add a card first', 'b1 no card, no charge');
select public.billing_card_saved(id, 'Visa ending 4242') from public.profiles where id::text like 'a9330000-%';
select throws_ok($$ select public.billing_signup_start('growth', 10000, pg_temp.d()) $$, 'P0001', 'Test accounts are never charged', 'b2 a test account is refused');
select is((public.billing_signup_start('growth', 10000, pg_temp.a()))->>'total_cents', '202200', 'b3 Ann signs up on Growth at $100/day');
select is((public.billing_signup_start('growth', 10000, pg_temp.a()))->>'existing', 'true', 'b4 a second tap returns the same charge');
select is((select count(*)::int from public.lead_spend_charges where agent_id = pg_temp.a() and kind = 'signup'), 1, 'b5 one sign-up charge');
select is((pg_temp.last(pg_temp.a(), 'signup')).note,
  'Sign-up: setup $299.00 · Growth plan, first month $1,499.00 · first 2 days: $200.00 to your ads · $24.00 booking desk', 'b6 its words name the booking desk');
select ok((pg_temp.last(pg_temp.a(), 'signup')).note not like '%12%%', 'b7 no bare 12% in the words');

-- ── c. paid: setup and the plan paid, two days of leads paid, the portal opens ──
select is(pg_temp.run(pg_temp.a(), 'paid'), 1, 'c1 the charge runs');
select is((pg_temp.last(pg_temp.a(), 'signup')).status, 'paid', 'c2 paid');
select ok((select setup_paid_at is not null and paid_start = date '2026-11-09' and tier_key = 'growth' from public.agent_billing_plans where agent_id = pg_temp.a()), 'c3 setup paid, bill date Nov 9, Growth');
select is((select billing_status from public.profiles where id = pg_temp.a()), 'active', 'c4 billing active');
select ok(public.servicing_active(pg_temp.a()) and public.leads_active(pg_temp.a()), 'c5 the portal opens (servicing and leads on)');
select is((select count(*)::int from public.lead_spend_charges where agent_id = pg_temp.a() and kind = 'nightly' and status = 'paid' and for_day in ('2026-11-10', '2026-11-11')), 2, 'c6 Nov 10 and 11 are paid days');
select ok(public.lead_spend_day_paid(pg_temp.a(), '2026-11-10') and public.lead_spend_day_paid(pg_temp.a(), '2026-11-11'), 'c7 the ads run those days');
select is((select note from public.lead_spend_charges where agent_id = pg_temp.a() and kind = 'nightly' and for_day = '2026-11-10'),
  'Lead spend for Tue, Nov 10: $100.00 to your ads · $12.00 booking desk · paid with your sign-up', 'c8 a nightly row''s words');
select is(public.lead_spend_nightly('2026-11-09'), 0, 'c9 tonight charges nothing more (both days are paid)');
select ok(exists (select 1 from public.notifications where profile_id = pg_temp.a() and type = 'billing_charged' and title = 'You''re all set'), 'c10 You''re all set');
select is((public.lead_spend_nightly('2026-11-10')), 1, 'c11 the next evening charges Nov 12 as usual');
select is((select note from public.lead_spend_charges where agent_id = pg_temp.a() and kind = 'nightly' and for_day = '2026-11-12'), 'Lead spend for Thu, Nov 12: $100.00 to your ads · $12.00 booking desk', 'c12 nightly words: no "+ 12%"');
select throws_ok($$ select public.billing_signup_start('growth', 10000, pg_temp.a()) $$, 'P0001', 'You''ve already signed up', 'c13 no second sign-up');

-- ── d. servicing only; a declined sign-up ───────────────────────────────────
select is((public.billing_signup_start('servicing', null, pg_temp.b()))->>'total_cents', '79800', 'd1 Ben: servicing only $798');
select is(pg_temp.run(pg_temp.b(), 'paid'), 1, 'd2 paid');
select is((select leads_status || '/' || billing_status from public.profiles where id = pg_temp.b()), 'none/active', 'd3 servicing on, no leads');
select is((select count(*)::int from public.lead_spend_charges where agent_id = pg_temp.b() and kind = 'nightly'), 0, 'd4 no lead spend');
select is((public.billing_signup_start('starter', 6000, pg_temp.c()))->>'total_cents', (29900 + 69900 + 12000 + 1440)::text, 'd5 Cy: Starter at $60/day');
select is(pg_temp.run(pg_temp.c(), 'failed'), 1, 'd6 declined');
select ok((select setup_paid_at is null from public.agent_billing_plans where agent_id = pg_temp.c()) and (select billing_status from public.profiles where id = pg_temp.c()) = 'none', 'd7 declined: nothing paid, still locked');
select is((public.billing_signup_start('starter', 6000, pg_temp.c()))->>'status', 'due', 'd8 a new card: a fresh charge (the declined one is replaced)');

-- ── e. the monthly plan on the bill date ────────────────────────────────────
select pg_temp.day('2026-11-20');
select is(public.billing_plan_month_run(), 0, 'e1 nothing before the bill date');
select pg_temp.day('2026-12-09');
select is(public.billing_plan_month_run(), 2, 'e2 Dec 9: Ann and Ben billed');
select is(public.billing_plan_month_run(), 0, 'e3 once per bill date');
select is((pg_temp.last(pg_temp.a(), 'plan_month')).note, 'Growth plan, Dec 9 to Jan 9', 'e4 Ann''s month');
select is((pg_temp.last(pg_temp.a(), 'plan_month')).amount_cents, 149900, 'e5 $1,499');
select ok(pg_temp.run(pg_temp.a(), 'paid') >= 1 and (pg_temp.last(pg_temp.a(), 'plan_month')).status = 'paid', 'e6 Ann pays');
select is((select (billing_current_period_end at time zone 'America/Chicago')::date from public.profiles where id = pg_temp.a()), date '2027-01-09', 'e7 paid through Jan 9');
select is(pg_temp.run(pg_temp.b(), 'failed'), 1, 'e8 Ben''s card is declined');
select is((select billing_status from public.profiles where id = pg_temp.b()), 'past_due', 'e9 past due, with grace');
select pg_temp.day('2026-12-10');
update public.lead_spend_charges set updated_at = now() - interval '2 days' where agent_id = pg_temp.b() and kind = 'plan_month';
select ok(public.lead_spend_morning_retry() >= 1 and (pg_temp.last(pg_temp.b(), 'plan_month')).status = 'due', 'e10 tried again the next morning');

-- ── f. test accounts, the switch, revenue ───────────────────────────────────
insert into public.lead_spend_charges (agent_id, week_start, kind, amount_cents, key, note, for_day, spend_cents, fee_cents, fee_rate)
values (pg_temp.d(), public.billing_week_of('2026-12-11'), 'nightly', 11200, 'nightly:test:1', 'x', '2026-12-11', 10000, 1200, 0.12);
select is(pg_temp.run(pg_temp.d(), 'paid'), 0, 'f1 a test account''s charge is never claimed');
select is((pg_temp.last(pg_temp.d(), 'nightly')).status, 'cancelled', 'f2 it''s cancelled: test account, never charged');
select is(public.billing_live_charging(), false, 'f3 Live charging is off by default');

select * from finish();
rollback;
