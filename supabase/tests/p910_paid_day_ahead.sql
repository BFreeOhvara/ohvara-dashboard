-- p910_paid_day_ahead — pgTAP checks for p910_paid_day_ahead.sql: two days paid at the start, then the day after
-- tomorrow each evening; money for days ahead is held (not today's cap, not credit); a decline leaves tomorrow
-- running and the unpaid day dark; a payment settles only its own day; retries each morning.
--
-- RUN: `npm run test:sql -- supabase/tests/p910_paid_day_ahead.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p910_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a9100000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'Ann Ahead'),
    ('a9100000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'Ben Declined')
  ) as u(id, n, full_name);
update public.profiles set role = 'agent', is_active = true, billing_status = 'active' where id::text like 'a9100000-%';
update public.profiles set is_active = false where role = 'agent' and id::text not like 'a9100000-%';

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
create function pg_temp.cap(a uuid) returns int language sql as $$
  select coalesce(sum(cap_cents), 0)::int from public.agent_campaign_control where agent_id = a
$$;
create function pg_temp.n(a uuid) returns int language sql as $$
  select count(*)::int from public.lead_spend_charges where agent_id = a and kind = 'nightly'
$$;

select pg_temp.day(0);
select public.billing_card_saved(id, 'Visa ending 4242') from public.profiles where id::text like 'a9100000-%';
select public.lead_spend_set(10000, 0, id) from public.profiles where id::text like 'a9100000-%';

-- ── a. the start: two days paid ─────────────────────────────────────────────
select is(public.lead_spend_days_ahead(), 2, 'a1 two days ahead by default');
select is(public.lead_spend_nightly(), 4, 'a2 the first evening charges tomorrow and the day after, for each agent');
select ok((pg_temp.ch('a9100000-0000-4000-8000-00000000000a', 1)).id is not null and (pg_temp.ch('a9100000-0000-4000-8000-00000000000a', 2)).id is not null, 'a3 day 1 and day 2');
select is(public.lead_spend_nightly(), 0, 'a4 running it again makes no second charge');
select pg_temp.pay('a9100000-0000-4000-8000-00000000000a', 1, 'paid');
select pg_temp.pay('a9100000-0000-4000-8000-00000000000a', 2, 'paid');
select pg_temp.pay('a9100000-0000-4000-8000-00000000000b', 1, 'paid');
select pg_temp.pay('a9100000-0000-4000-8000-00000000000b', 2, 'paid');
select is(public.lead_spend_balance('a9100000-0000-4000-8000-00000000000a'), 20000, 'a5 both days'' spend is in the wallet');
select is(pg_temp.runs('a9100000-0000-4000-8000-00000000000a', 'lead_spend'), 'off', 'a6 today stays off: spend starts tomorrow');

-- ── b. a paid day runs on its own money only ───────────────────────────────
select pg_temp.day(1);
select public.lead_spend_refresh_control('a9100000-0000-4000-8000-00000000000a');
select is(pg_temp.runs('a9100000-0000-4000-8000-00000000000a', 'ads'), 'true', 'b1 day 1 is paid: ads run');
select is(public.lead_spend_ahead_cents('a9100000-0000-4000-8000-00000000000a'), 10000, 'b2 day 2''s money is held for day 2');
select is(pg_temp.cap('a9100000-0000-4000-8000-00000000000a'), 10000, 'b3 today''s cap is today''s $100, not the $200 in the wallet');
select is(public.lead_spend_credit('a9100000-0000-4000-8000-00000000000a'), 0, 'b4 day 2''s money is not credit');
select is(public.lead_spend_next_charge('a9100000-0000-4000-8000-00000000000a')->>'for_day', pg_temp.e(3)::text, 'b5 the next charge is for the day after tomorrow');
select is(public.lead_spend_nightly(), 2, 'b6 each evening after: one charge each, for the day after tomorrow');
select is(pg_temp.n('a9100000-0000-4000-8000-00000000000a'), 3, 'b7 days 1, 2, 3');

-- ── c. declined: tomorrow still runs, the unpaid day doesn't ───────────────
select pg_temp.pay('a9100000-0000-4000-8000-00000000000a', 3, 'paid');
select is((pg_temp.pay('a9100000-0000-4000-8000-00000000000b', 3, 'failed'))->>'status', 'failed', 'c1 Ben''s card is declined for day 3');
select is(pg_temp.runs('a9100000-0000-4000-8000-00000000000b', 'ads'), 'true', 'c2 today (paid) keeps running');
select ok((select coalesce(detail, '') from public.notifications where profile_id = 'a9100000-0000-4000-8000-00000000000b' and type = 'billing_charge_failed' order by created_at desc limit 1)
          like 'Tomorrow is paid and still runs.%leads are off unless it''s paid before it starts.%8 AM.', 'c3 Fix card notice: tomorrow runs, the day after is off, we retry at 8 AM');
select pg_temp.day(2);
-- Day 1's spend is reported (the true-up), as each morning.
select public.lead_spend_record_delivered(id, 'appts', pg_temp.e(1), 10000) from public.profiles where id::text like 'a9100000-%';
select is(public.lead_spend_morning_retry(), 1, 'c4 the morning retry');
select pg_temp.pay('a9100000-0000-4000-8000-00000000000b', 3, 'failed');
select is(pg_temp.runs('a9100000-0000-4000-8000-00000000000b', 'ads'), 'true', 'c5 day 2 (tomorrow at the decline) runs');
select is(public.lead_spend_nightly(), 1, 'c6 no new day is charged while Ben''s declined day is open; Ann''s day 4 is');
select pg_temp.day(3);
select public.lead_spend_record_delivered(id, 'appts', pg_temp.e(2), 10000) from public.profiles where id::text like 'a9100000-%';
select public.lead_spend_refresh_control('a9100000-0000-4000-8000-00000000000b'); -- the hourly job
select is(pg_temp.runs('a9100000-0000-4000-8000-00000000000b', 'lead_spend'), 'stopped_payment', 'c7 day 3 was never paid: ads off');
select is(pg_temp.cap('a9100000-0000-4000-8000-00000000000b'), 0, 'c8 and a zero cap');

-- A day let go in the evening still runs nothing, even with money in the wallet.
select public.lead_spend_nightly();
select is((pg_temp.ch('a9100000-0000-4000-8000-00000000000b', 3)).status, 'cancelled', 'c9 the unpaid day is let go: nothing owed');
select is(pg_temp.runs('a9100000-0000-4000-8000-00000000000b', 'lead_spend'), 'unpaid_day', 'c10 and it stays dark (no grace)');

-- ── d. a payment settles only its own day ───────────────────────────────────
select pg_temp.pay('a9100000-0000-4000-8000-00000000000b', 4, 'paid');
select is(pg_temp.runs('a9100000-0000-4000-8000-00000000000b', 'ads'), 'false', 'd1 paying day 4 doesn''t switch on unpaid day 3');

select * from finish();
rollback;
