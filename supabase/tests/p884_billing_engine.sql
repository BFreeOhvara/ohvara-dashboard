-- p884_billing_engine — pgTAP checks for p884_billing_engine.sql: one versioned price source, tiers by daily spend,
-- prepaid weekly lead spend with rollover, mid-week raises, delivered spend capped at the balance and the agreement
-- (overspend absorbed, revisions trued up), ads that stop when the money stops and resume when paid, failed payment
-- (Q4), the pilot (spend only + VA cost line), pilot → paid with acceptance, setup fee switch, tier from next bill,
-- and who can read or call what.
--
-- RUN: `npm run test:sql -- supabase/tests/p884_billing_engine.sql` (PGlite, in memory). Never against live.
-- The date is pinned with ohvara.today: Wed Nov 11 2026 (week of Mon Nov 9).
--
-- Cast: admin Z, agent A (paid), agent B (pilot), agent C (paid, never subscribed).

begin;
create extension if not exists pgtap with schema extensions;
select plan(101);

-- P901: the replay also loads p901_price_book_v2.sql (version 2, final, effective the replay day). This file checks the
-- P884 engine on its own draft version 1, so version 2 is set aside here (inside this transaction, rolled back at the
-- end). Version 2 has its own checks in supabase/tests/p901_price_book_v2.sql.
alter table public.billing_price_book disable trigger billing_price_book_block;
delete from public.billing_price_book where version > 1;
alter table public.billing_price_book enable trigger billing_price_book_block;

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p884_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a8840000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a8840000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Ann Paid'),
    ('a8840000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent', 'Ben Pilot'),
    ('a8840000-0000-4000-8000-00000000000c'::uuid, 'agent_c', 'agent', 'Cal New')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin' where id = 'a8840000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true where id::text like 'a8840000-%' and id <> 'a8840000-0000-4000-8000-000000000001';
update public.profiles set billing_status = 'active' where id = 'a8840000-0000-4000-8000-00000000000a';
-- Only this test's agents.
update public.profiles set is_active = false where role = 'agent' and id::text not like 'a8840000-%';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.day(d text) returns void language sql as $$ select set_config('ohvara.today', d, true) $$;
create function pg_temp.ctl(a uuid, t text) returns public.agent_campaign_control language sql as $$
  select * from public.agent_campaign_control where agent_id = a and lead_type = t
$$;
create function pg_temp.runs(a uuid, k text) returns text language sql as $$ select public.billing_runs(a)->>k $$;
create function pg_temp.notes(a uuid, t text) returns int language sql as $$
  select count(*)::int from public.notifications where profile_id = a and type = t
$$;
select pg_temp.day('2026-11-11');

-- ── a. one price source ──────────────────────────────────────────────────────
select is((public.price_book()->>'version')::int, 1, 'a1 version 1 is in effect');
select is(public.price_book()->>'status', 'draft', 'a2 prices are drafts');
select is(public.billing_tier_for(5049)->>'key', 'starter', 'a3 $50.49 a day is Starter');
select is(public.billing_tier_for(7500)->>'key', 'growth', 'a4 $75 a day is Growth');
select is(public.billing_tier_for(15000)->>'monthly_cents', '349700', 'a5 $150 a day is Pro at the draft price');
select is(public.billing_tier_for(25000)->>'key', 'scale', 'a6 $250 a day is Scale');
select throws_ok($$ update public.billing_price_book set book = '{}'::jsonb where version = 1 $$, '42501', null, 'a7 a price version can''t be rewritten');
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.admin_price_book_save(public.price_book(), '2026-11-20', 'x') $$, '42501', null, 'a8 an agent can''t change prices');
select pg_temp.as_user('a8840000-0000-4000-8000-000000000001');
select is(public.admin_price_book_save(public.price_book(), '2026-12-01', 'same prices, new version'), 2, 'a9 an admin saves a new draft version');
select is((public.price_book()->>'version')::int, 1, 'a10 it waits for its date');
select is((public.price_book('2026-12-01')->>'version')::int, 2, 'a11 and takes over on it');
select throws_ok($$ select public.admin_price_book_save(public.price_book(), '2026-11-01', 'x') $$, 'P0001', null, 'a12 never back-dated');

-- ── b. grants ────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.lead_spend_record_delivered(uuid, text, date, integer, text)', 'execute'), 'b1 only the server records delivered spend');
select ok(not has_function_privilege('authenticated', 'public.lead_spend_charge_result(uuid, text, text, text)', 'execute'), 'b2 only the server records a charge result');
select ok(not has_function_privilege('authenticated', 'public.campaign_control_confirm(uuid, text, text, timestamptz)', 'execute'), 'b3 only the engine confirms');
select ok(not has_function_privilege('authenticated', 'public.lead_spend_week_open(date)', 'execute'), 'b4 the week opens on the server only');
select ok(has_function_privilege('authenticated', 'public.my_billing()', 'execute'), 'b5 an agent reads their billing');
select is((select count(*)::int from public.notification_types where type like 'billing_%'), 7, 'b6 seven billing notification types');

-- ── c. paid agent A sets spend mid-week ──────────────────────────────────────
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.lead_spend_set(3000, 1000) $$, 'P0001', 'Paid plans need at least $50 a day. Pause instead?', 'c1 paid minimum $50 a day, with Pause instead');
select is((public.lead_spend_set(5000, 2500))->>'extra_cents', '30000', 'c2 a raise charges the 4 days left this week ($75 x 4)');
select pg_temp.as_owner();
select is((select amount_cents from public.lead_spend_charges where agent_id = 'a8840000-0000-4000-8000-00000000000a' and kind = 'change'), 30000, 'c3 one change charge');
select is((select agreed_appts + agreed_live from public.lead_spend_weeks where agent_id = 'a8840000-0000-4000-8000-00000000000a' and week_start = '2026-11-09'), 30000, 'c4 the week agrees what was charged');
select is((select tier_key from public.agent_billing_plans where agent_id = 'a8840000-0000-4000-8000-00000000000a'), 'growth', 'c5 the first tier is set: Growth');
select is(public.lead_spend_daily('a8840000-0000-4000-8000-00000000000a', 'appts'), 0, 'c6 the change starts at midnight, not now');
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000a', 'lead_spend'), 'off', 'c7 nothing runs today at $0');

-- ── d. the charge is paid; midnight comes; ads run with a cap ────────────────
select is((select count(*)::int from public.lead_spend_claim_charges(25)), 1, 'd1 the function claims the due charge');
select is((select status from public.lead_spend_charges where kind = 'change' and agent_id = 'a8840000-0000-4000-8000-00000000000a'), 'processing', 'd2 marked processing');
select is((public.lead_spend_charge_result((select id from public.lead_spend_charges where kind = 'change' and agent_id = 'a8840000-0000-4000-8000-00000000000a'), 'paid', 'pi_a1'))->>'status', 'paid', 'd3 paid');
select is((public.lead_spend_charge_result((select id from public.lead_spend_charges where kind = 'change' and agent_id = 'a8840000-0000-4000-8000-00000000000a'), 'paid', 'pi_a1'))->>'duplicate', 'true', 'd4 a repeat result is a no-op');
select is(public.lead_spend_balance('a8840000-0000-4000-8000-00000000000a'), 30000, 'd5 the wallet holds $300 once');
select pg_temp.day('2026-11-12');
select ok(public.billing_daily_sweep() >= 1, 'd6 the midnight sweep applies the spend');
select is(public.lead_spend_daily('a8840000-0000-4000-8000-00000000000a', 'appts'), 5000, 'd7 $50 a day on appointments');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'appts')).run, true, 'd8 appointment ads run');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'appts')).cap_cents, 20000, 'd9 cap = its share of the balance');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'live')).cap_cents, 10000, 'd10 live calls get the rest');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'live')).daily_budget_cents, 2500, 'd11 daily budget = their spend');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'appts')).pushed_at, null, 'd12 pending push for the engine');

-- ── e. delivered spend, true-up, overspend absorbed, out of money ────────────
select is((public.lead_spend_record_delivered('a8840000-0000-4000-8000-00000000000a', 'appts', '2026-11-12', 6000))->>'billed', '6000', 'e1 delivered spend debits the wallet');
select is((public.lead_spend_record_delivered('a8840000-0000-4000-8000-00000000000a', 'appts', '2026-11-12', 6000))->>'billed', '0', 'e2 the same report twice bills once');
select is((public.lead_spend_record_delivered('a8840000-0000-4000-8000-00000000000a', 'appts', '2026-11-12', 5000))->>'billed', '-1000', 'e3 a day revised down gives $10 back');
select is(public.lead_spend_balance('a8840000-0000-4000-8000-00000000000a'), 25000, 'e4 balance after the true-up');
select is((public.lead_spend_record_delivered('a8840000-0000-4000-8000-00000000000a', 'appts', '2026-11-13', 25000))->>'absorbed', '10000', 'e5 over the agreed week: Ohvara absorbs $100 (Q12)');
select is(public.lead_spend_balance('a8840000-0000-4000-8000-00000000000a'), 10000, 'e6 only the agreed amount was billed');
select is((public.lead_spend_record_delivered('a8840000-0000-4000-8000-00000000000a', 'live', '2026-11-13', 12000))->>'absorbed', '2000', 'e7 past the funded balance is absorbed too');
select is(public.lead_spend_balance('a8840000-0000-4000-8000-00000000000a'), 0, 'e8 never below zero');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'appts')).run, false, 'e9 the money ran out: ads stop');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'live')).reason, 'out', 'e10 with the reason');
select is(pg_temp.notes('a8840000-0000-4000-8000-00000000000a', 'billing_balance_out'), 1, 'e11 the agent is told once');
select is(((public.lead_spend_week_report('a8840000-0000-4000-8000-00000000000a', '2026-11-09'))->'types'->'appts'->>'absorbed_cents'), '10000', 'e12 the week report shows what was absorbed');
select is(((public.lead_spend_week_report('a8840000-0000-4000-8000-00000000000a', '2026-11-09'))->>'collected_cents'), '30000', 'e13 and what was collected');
select throws_ok($$ delete from public.lead_spend_ledger $$, '42501', null, 'e14 the ledger is append-only');

-- ── f. failed membership payment (Q4) ────────────────────────────────────────
select public.admin_lead_spend_adjust('a8840000-0000-4000-8000-00000000000a', 5000, 'test credit') is not null from (select pg_temp.as_user('a8840000-0000-4000-8000-000000000001')) s;
select pg_temp.as_owner();
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000a', 'ads'), 'true', 'f1 funded again: ads resume');
update public.profiles set billing_status = 'past_due', billing_grace_until = now() + interval '3 days' where id = 'a8840000-0000-4000-8000-00000000000a';
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000a', 'lead_spend'), 'stopped_payment', 'f2 lead spend stops at once');
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'appts')).run, false, 'f3 the engine is told to stop');
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000a', 'servicing'), 'true', 'f4 servicing runs during the grace');
select is(pg_temp.notes('a8840000-0000-4000-8000-00000000000a', 'billing_charge_failed'), 1, 'f5 the agent is told');
update public.profiles set billing_grace_until = now() - interval '1 minute' where id = 'a8840000-0000-4000-8000-00000000000a';
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000a', 'status'), 'suspended', 'f6 after the grace: Suspended');
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000a', 'servicing'), 'false', 'f7 servicing pauses');
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000a', 'pipeline'), 'held', 'f8 leads are held, never dropped');
update public.profiles set billing_status = 'active', billing_grace_until = null where id = 'a8840000-0000-4000-8000-00000000000a';
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'appts')).run, true, 'f9 paid again: ads resume');

-- ── g. pilot agent B: spend only, any amount, failed charge, retry ───────────
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000b');
select throws_ok($$ select public.admin_billing_pilot_set('a8840000-0000-4000-8000-00000000000b', true) $$, '42501', null, 'g1 an agent can''t put themselves in the pilot');
select pg_temp.as_user('a8840000-0000-4000-8000-000000000001');
select lives_ok($$ select public.admin_billing_pilot_set('a8840000-0000-4000-8000-00000000000b', true, null, 'first pilot') $$, 'g2 admin turns the pilot on');
select is((select (after->>'plan') from public.agent_billing_events where agent_id = 'a8840000-0000-4000-8000-00000000000b' and kind = 'pilot'), 'pilot', 'g3 logged with before and after');
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000b');
select is((public.lead_spend_set(1000, 0))->>'extra_cents', '3000', 'g4 pilot: $10 a day is fine, no minimum');
select is((public.my_billing())->'membership'->>'membership_cents', '0', 'g5 no membership in the pilot');
select pg_temp.as_owner();
select is((select count(*)::int from public.lead_spend_claim_charges(25)), 1, 'g6 B''s charge is claimed');
select is((public.lead_spend_charge_result((select id from public.lead_spend_charges where agent_id = 'a8840000-0000-4000-8000-00000000000b'), 'failed', 'pi_b1', 'card_declined'))->>'status', 'failed', 'g7 declined');
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000b', 'lead_spend'), 'stopped_payment', 'g8 lead spend stops at once');
select is(pg_temp.notes('a8840000-0000-4000-8000-000000000001', 'billing_payment_problem'), 1, 'g9 admins are alerted');
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000b');
select is(public.lead_spend_retry(), 1, 'g10 the agent retries after fixing the card');
select pg_temp.as_owner();
select is((select status from public.lead_spend_charges where agent_id = 'a8840000-0000-4000-8000-00000000000b'), 'due', 'g11 back to due');
select lives_ok($$ select public.lead_spend_charge_result((select id from public.lead_spend_charges where agent_id = 'a8840000-0000-4000-8000-00000000000b'), 'paid', 'pi_b2') $$, 'g12 paid');
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000b', 'lead_spend'), 'off', 'g13 not stopped any more (spend starts tomorrow)');

-- ── h. next week opens: rollover, weekly charge, the VA cost line ───────────
select public.admin_billing_va_cost_set('a8840000-0000-4000-8000-00000000000b', true, 900) is null from (select pg_temp.as_user('a8840000-0000-4000-8000-000000000001')) s;
select pg_temp.as_owner();
select pg_temp.day('2026-11-16');
select ok(public.lead_spend_week_open() >= 1, 'h1 the week opens');
select is((select rolled_in_cents from public.lead_spend_weeks where agent_id = 'a8840000-0000-4000-8000-00000000000b' and week_start = '2026-11-16'), 3000, 'h2 B''s unspent $30 rolled over');
select is((select amount_cents from public.lead_spend_charges where agent_id = 'a8840000-0000-4000-8000-00000000000b' and kind = 'weekly'), 4000, 'h3 so B pays only $40 of the $70 week');
select is((select amount_cents from public.lead_spend_charges where agent_id = 'a8840000-0000-4000-8000-00000000000a' and kind = 'weekly'), 52500 - 5000, 'h4 A pays the week less their balance');
select is((select count(*)::int from public.lead_spend_charges where agent_id = 'a8840000-0000-4000-8000-00000000000c'), 0, 'h5 C never subscribed: nothing charged');
select is((public.billing_view('a8840000-0000-4000-8000-00000000000b', false))->'va_cost'->>'on', 'true', 'h6 B''s VA cost line is on');

-- ── i. pilot → paid, setup fee, tier from the next bill ──────────────────────
select pg_temp.as_user('a8840000-0000-4000-8000-000000000001');
select throws_ok($$ select public.admin_billing_to_paid('a8840000-0000-4000-8000-00000000000b', '2026-11-19') $$, 'P0001', null, 'i1 at least 7 days'' notice');
select lives_ok($$ select public.admin_billing_to_paid('a8840000-0000-4000-8000-00000000000b', '2026-11-30') $$, 'i2 pilot to paid from Nov 30');
select pg_temp.as_owner();
select is(pg_temp.notes('a8840000-0000-4000-8000-00000000000b', 'billing_plan_notice'), 1, 'i3 B gets the notice');
select pg_temp.day('2026-11-30');
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000b', 'status'), 'waiting_acceptance', 'i4 not accepted by the date: waiting, still pilot');
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000b');
select is((public.billing_accept_paid('v1', 'test'))->>'frequency', 'monthly', 'i5 B accepts and authorises the monthly charge');
select pg_temp.as_owner();
select lives_ok($$ select public.billing_daily_sweep() $$, 'i6 sweep');
select is((select plan from public.agent_billing_plans where agent_id = 'a8840000-0000-4000-8000-00000000000b'), 'paid', 'i7 B is on a paid plan');
select is((select tier_key from public.agent_billing_plans where agent_id = 'a8840000-0000-4000-8000-00000000000b'), 'starter', 'i8 tier from their spend');
select is((public.agent_membership_due('a8840000-0000-4000-8000-00000000000a'))->>'setup_cents', '29700', 'i9 default setup fee (draft)');
select public.admin_billing_setup_set('a8840000-0000-4000-8000-00000000000a', 'none_min_term', null, 3) is null from (select pg_temp.as_user('a8840000-0000-4000-8000-000000000001')) s;
select pg_temp.as_owner();
select is((public.agent_membership_due('a8840000-0000-4000-8000-00000000000a'))->>'setup_cents', '0', 'i10 or none, with a minimum term');
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000a');
select lives_ok($$ select public.lead_spend_set(10000, 5000) $$, 'i11 A raises to $150 a day');
select pg_temp.as_owner();
select is((select tier_key || '>' || next_tier_key from public.agent_billing_plans where agent_id = 'a8840000-0000-4000-8000-00000000000a'), 'growth>pro', 'i12 Pro waits for the next bill');
select lives_ok($$ select public.billing_period_rolled('a8840000-0000-4000-8000-00000000000a') $$, 'i13 the bill renews');
select is((select tier_key from public.agent_billing_plans where agent_id = 'a8840000-0000-4000-8000-00000000000a'), 'pro', 'i14 now Pro');

-- ── j. who sees what ─────────────────────────────────────────────────────────
select pg_temp.as_user('a8840000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.lead_spend_ledger where agent_id = 'a8840000-0000-4000-8000-00000000000b'), 0, 'j1 an agent can''t see another agent''s wallet');
select is((select count(*)::int from public.agent_campaign_control), 0, 'j2 agents never see the engine instructions');
select ok(not (public.my_billing() ? 'controls'), 'j3 my_billing has no engine detail');
select throws_ok($$ insert into public.lead_spend_ledger (agent_id, kind, cents, week_start) values ('a8840000-0000-4000-8000-00000000000a', 'topup', 100000, '2026-11-30') $$, '42501', null, 'j4 an agent can''t write money');
select lives_ok($$ select public.lead_spend_pause(true) $$, 'j5 the agent pauses');
select pg_temp.as_owner();
select is((pg_temp.ctl('a8840000-0000-4000-8000-00000000000a', 'appts')).reason, 'paused', 'j6 the engine is told: paused');
select lives_ok($$ select public.campaign_control_confirm('a8840000-0000-4000-8000-00000000000a', 'appts', 'paused') $$, 'j7 the engine confirms');
update public.profiles set is_active = false where id = 'a8840000-0000-4000-8000-00000000000c';
select is(pg_temp.runs('a8840000-0000-4000-8000-00000000000c', 'status'), 'cancelled', 'j8 a closed account is Cancelled');

select * from finish();
rollback;
