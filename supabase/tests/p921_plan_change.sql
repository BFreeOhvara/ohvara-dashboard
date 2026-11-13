-- p921_plan_change — pgTAP checks for p921_plan_change.sql: moving up charges the price difference now (P990/273: no days) and opens
-- the band only once paid; declined → nothing changes and nothing retries; moving down waits for the bill date, then
-- caps the spend; undo; a second upgrade charges only the new difference; founding prices; the spend cap.
--
-- RUN: `npm run test:sql -- supabase/tests/p921_plan_change.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p921_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a9210000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'Ann Up'),
    ('a9210000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'Ben Down'),
    ('a9210000-0000-4000-8000-00000000000c'::uuid, 'agent_c', 'Cy Founding')
  ) as u(id, n, full_name);
update public.profiles set role = 'agent', is_active = true, billing_status = 'active' where id::text like 'a9210000-%';

create function pg_temp.a() returns uuid language sql as $$ select 'a9210000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'a9210000-0000-4000-8000-00000000000b'::uuid $$;
create function pg_temp.c() returns uuid language sql as $$ select 'a9210000-0000-4000-8000-00000000000c'::uuid $$;
create function pg_temp.day(d date) returns void language sql as $$ select set_config('ohvara.today', d::text, true) $$;
create function pg_temp.tier(x uuid) returns text language sql as $$ select tier_key from public.agent_billing_plans where agent_id = x $$;
create function pg_temp.next(x uuid) returns text language sql as $$ select coalesce(next_tier_key, '-') || '@' || coalesce(next_tier_from::text, '-') from public.agent_billing_plans where agent_id = x $$;
create function pg_temp.up(x uuid) returns public.lead_spend_charges language sql as $$
  select * from public.lead_spend_charges where agent_id = x and kind = 'plan_upgrade' order by status in ('due', 'processing') desc, created_at desc limit 1
$$;
create function pg_temp.settle(x uuid, s text) returns jsonb language plpgsql as $$
declare c public.lead_spend_charges := pg_temp.up(x);
begin
  update public.lead_spend_charges set status = 'processing', attempts = attempts + 1, updated_at = now() where id = c.id and status = 'due';
  return public.lead_spend_charge_result(c.id, s, 'pi_' || substr(c.id::text, 1, 8), case when s = 'failed' then 'Card declined' end);
end; $$;
create function pg_temp.spend(x uuid) returns int language sql as $$ select public.lead_spend_daily_total(x, public.billing_today() + 1) $$;

-- The books dated so v3 (final) is in effect from Nov 2 (they're dated the replay day otherwise), no founding places except where set.
alter table public.billing_price_book disable trigger billing_price_book_block;
update public.billing_price_book set effective_from = case version when 1 then date '2026-10-01' when 2 then date '2026-10-15' else date '2026-11-02' end;
alter table public.billing_price_book enable trigger billing_price_book_block;
update public.billing_settings set founding_count = 0;
-- Every agent's month runs from the 1st (paid since Nov 1); today is Nov 16 (15 days left of 30).
update public.agent_billing_plans set paid_start = null where agent_id::text like 'a9210000-%';
select pg_temp.day('2026-11-16');
select public.billing_card_saved(id, 'Visa ending 4242') from public.profiles where id::text like 'a9210000-%';
insert into public.agent_billing_plans (agent_id, paid_start) select id, '2026-11-01' from public.profiles where id::text like 'a9210000-%'
on conflict (agent_id) do update set paid_start = excluded.paid_start;
select public.lead_spend_set(15000, 0, pg_temp.a());
select public.lead_spend_set(25000, 0, pg_temp.b());

-- ── a. the billing month ────────────────────────────────────────────────────
select is(public.billing_bill_month(pg_temp.a()), '{"start":"2026-11-01","next":"2026-12-01","days":30,"left":15}'::jsonb, 'a1 Nov 1 to Dec 1, 15 days left on Nov 16');
select is(pg_temp.tier(pg_temp.a()), 'growth', 'a2 $150 a day starts on Growth');
select is(pg_temp.tier(pg_temp.b()), 'pro', 'a3 $250 a day starts on Pro');

-- ── b. the spend can't go over the plan's band ──────────────────────────────
select throws_ok($$ select public.lead_spend_set(30000, 0, pg_temp.a()) $$, 'P0001', 'Your Growth plan goes up to $200 a day. Switch plan to spend more.', 'b1 Growth can''t spend $300');
select lives_ok($$ select public.lead_spend_set(20000, 0, pg_temp.a()) $$, 'b2 the top of the band is fine');
select is(pg_temp.tier(pg_temp.a()), 'growth', 'b3 the plan no longer follows the spend');

-- ── c. moving up: charged now, the band opens when it's paid ───────────────
select is((public.billing_plan_change('pro', null, pg_temp.a()))->>'amount_cents', '150000', 'c1 Growth → Pro on Nov 16: the difference, $1,500.00 (P990: no days)');
select is(pg_temp.tier(pg_temp.a()), 'growth', 'c2 still Growth while the charge is going through');
select throws_ok($$ select public.lead_spend_set(30000, 0, pg_temp.a()) $$, 'P0001', null, 'c3 the Pro band isn''t open before it''s paid');
select throws_ok($$ select public.billing_plan_change('pro', null, pg_temp.a()) $$, 'P0001', 'Your last plan change is still going through. Try again in a minute.', 'c4 one change at a time');
select is((pg_temp.up(pg_temp.a())).note, 'Upgrade to Pro, the difference from Growth', 'c5 the charge''s label');

-- declined → nothing changes, and it isn't retried
select is((pg_temp.settle(pg_temp.a(), 'failed'))->>'status', 'failed', 'c6 the card is declined');
select is(pg_temp.tier(pg_temp.a()), 'growth', 'c7 declined: still Growth');
select is(pg_temp.spend(pg_temp.a()), 20000, 'c8 declined: spend unchanged');
select ok((select title from public.notifications where profile_id = pg_temp.a() and type = 'billing_charge_failed' order by created_at desc limit 1) = 'Your upgrade didn''t go through', 'c9 Fix card notice');
select is(public.lead_spend_retry(pg_temp.a()), 0, 'c10 Fix card doesn''t retry the upgrade');
select is(public.lead_spend_charge_failed(pg_temp.a()), false, 'c11 a declined upgrade never stops leads');

-- again, paid → Pro opens, spend lands where the confirm said
select is((public.billing_plan_change('pro', 25000, pg_temp.a()))->>'amount_cents', '150000', 'c12 switching again charges again');
select is((select string_agg(status, ',' order by status) from public.lead_spend_charges where agent_id = pg_temp.a() and kind = 'plan_upgrade'), 'cancelled,due', 'c13 the declined one is replaced, never charged');
select is((pg_temp.settle(pg_temp.a(), 'paid'))->>'status', 'paid', 'c14 paid');
select is(pg_temp.tier(pg_temp.a()), 'pro', 'c15 now Pro');
select is(pg_temp.spend(pg_temp.a()), 25000, 'c16 spend moved to $250 from tomorrow');
select lives_ok($$ select public.lead_spend_set(50000, 0, pg_temp.a()) $$, 'c17 Pro band open: $500');

-- ── d. moving down: from the next bill, no refund, capped then ─────────────
select is((public.billing_plan_change('starter', null, pg_temp.b()))->>'direction', 'down', 'd1 Pro → Starter is a move down');
select is(pg_temp.next(pg_temp.b()), 'starter@2026-12-01', 'd2 scheduled for Dec 1');
select is((select count(*)::int from public.lead_spend_charges where agent_id = pg_temp.b() and kind = 'plan_upgrade'), 0, 'd3 nothing charged, nothing refunded');
select lives_ok($$ select public.lead_spend_set(40000, 0, pg_temp.b()) $$, 'd4 keeps the Pro band until then');
select is((public.billing_plan_change('pro', null, pg_temp.b()))->>'direction', 'undo', 'd5 switching back to Pro is Undo');
select is(pg_temp.next(pg_temp.b()), '-@-', 'd6 nothing scheduled');
select public.billing_plan_change('starter', null, pg_temp.b());
select pg_temp.day('2026-11-30');
select is(public.billing_plan_rollover(), 0, 'd7 nothing happens before the bill date');
select pg_temp.day('2026-12-01');
select is(public.billing_daily_sweep() >= 1, true, 'd8 the bill date sweep');
select is(pg_temp.tier(pg_temp.b()) || ' ' || pg_temp.spend(pg_temp.b()), 'starter 7500', 'd9 Starter, spend set to the top of the band ($75)');

-- ── e. a pending downgrade, then an upgrade; a second upgrade; founding prices ──
select pg_temp.day('2026-12-16');
select public.lead_spend_set(15000, 0, pg_temp.c());
select public.billing_plan_change('starter', null, pg_temp.c());
select is((public.billing_plan_change('pro', null, pg_temp.c()))->>'amount_cents', '150000', 'e1 Growth → Pro with Starter pending: Pro − Growth (P990: no days)');
select pg_temp.settle(pg_temp.c(), 'paid');
select is(pg_temp.tier(pg_temp.c()) || ' ' || pg_temp.next(pg_temp.c()), 'pro -@-', 'e2 the upgrade cancels the pending downgrade');
select is(public.billing_plan_quote_for(pg_temp.b(), 'pro')->>'amount_cents', '230000', 'e3 a second upgrade, Starter → Pro on Dec 16: 2,999 − 699 (P990: no days)');
update public.agent_billing_plans set founding_version = 1, founding_until = '2027-12-01' where agent_id = pg_temp.b();
select is(public.billing_plan_quote_for(pg_temp.b(), 'growth')->>'amount_cents', '80000', 'e4 founding (v1 book): the difference uses the locked prices, 1,797 − 997');

select * from finish();
rollback;
