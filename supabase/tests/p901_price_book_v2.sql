-- p901_price_book_v2 — pgTAP checks for p901_price_book_v2.sql: price book version 2 is final and in effect from the
-- day it's applied (three packages, servicing only $499, $299 setup, no minimum term), version 1 is kept, and Meta
-- only at launch: Call ads (Google) off means all form ads and no Monday move; switched on, the P889 split runs.
--
-- RUN: `npm run test:sql -- supabase/tests/p901_price_book_v2.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- P909: the replay also loads p909_final_pricing.sql (version 3, effective the replay day). This file checks version 2,
-- so version 3 is set aside here (rolled back at the end); it has its own checks in p909_final_pricing.sql.
alter table public.billing_price_book disable trigger billing_price_book_block;
delete from public.billing_price_book where version > 2;
alter table public.billing_price_book enable trigger billing_price_book_block;

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p901_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a9010000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a9010000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Ann Transfers')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin' where id = 'a9010000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true where id = 'a9010000-0000-4000-8000-00000000000a';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.day(d text) returns void language sql as $$ select set_config('ohvara.today', d, true) $$;

-- The day version 2 took effect (the day the migration was applied).
select pg_temp.day((select effective_from::text from public.billing_price_book where version = 2));

-- ── a. version 2 is final and in effect ─────────────────────────────────────
select is((public.price_book()->>'version')::int, 2, 'a1 version 2 is in effect from the day it was applied');
select is(public.price_book()->>'status', 'final', 'a2 the prices are final');
select is(jsonb_array_length(public.price_book()->'tiers'), 3, 'a3 three packages, no Scale');
select is(public.billing_tier_for(5000)->>'monthly_cents', '79900', 'a4 $50 a day is Starter, $799');
select is(public.billing_tier_for(5100)->>'key', 'growth', 'a5 $51 a day is Growth');
select is(public.billing_tier_for(20000)->>'monthly_cents', '169900', 'a6 $200 a day is Growth, $1,699');
select is(public.billing_tier_for(20100)->>'key', 'pro', 'a7 $201 a day is Pro');
select is(public.billing_tier_for(90000)->>'monthly_cents', '299900', 'a8 any spend over $200 is Pro, $2,999');
select is((public.price_book()->>'servicing_only_cents')::int, 49900, 'a9 servicing only is $499');
select is(public.price_book()->'setup', '{"mode": "fee", "fee_cents": 29900, "min_months": 0}'::jsonb, 'a10 $299 setup once, no minimum term');
select is((public.price_book()->>'paid_min_daily_cents')::int, 5000, 'a11 lead spend minimum stays $50 a day');
select is((select status from public.billing_price_book where version = 1), 'draft', 'a12 version 1 is kept');
select is((public.price_book('2026-11-01')->>'version')::int, 1, 'a13 before version 2 starts, version 1 applies');
select throws_ok($$ update public.billing_price_book set book = '{}'::jsonb where version = 2 $$, '42501', null, 'a14 version 2 can''t be rewritten');

-- ── b. Meta only at launch: call ads off ────────────────────────────────────
select is((select call_ads_on from public.lead_split_rules), false, 'b1 Call ads (Google) is off');
select is(public.lead_product_split('both', 70, 10000),
          '{"form_cents": 10000, "call_cents": 0, "form_pct": 100, "reason": "call_ads_off"}'::jsonb, 'b2 a transfer agent runs 100% form ads');
select is(public.lead_product_split('appts', 70, 10000)->>'reason', 'appts_only', 'b3 appointments only is unchanged');
select is(public.lead_split_weekly(), 0, 'b4 the Monday move holds while call ads are off');

-- ── c. switched on, the P889 split runs; the switch is admin only and logged ─
select pg_temp.as_user('a9010000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.admin_lead_split_rules_save('{"call_ads_on": true}'::jsonb) $$, '42501', null, 'c1 an agent can''t turn call ads on');
select pg_temp.as_user('a9010000-0000-4000-8000-000000000001');
select is((public.admin_lead_split_rules_save('{"call_ads_on": true}'::jsonb))->>'call_ads_on', 'true', 'c2 an admin turns call ads on');
select pg_temp.as_owner();
select is((select reason from public.agent_lead_split_log where kind = 'rules' order by id desc limit 1), 'Call ads (Google) turned on', 'c3 logged');
select is(public.lead_product_split('both', 70, 10000)->>'reason', 'split', 'c4 the split runs again');
select is((public.lead_product_split('both', 70, 10000)->>'call_cents')::int, 3000, 'c5 at the 70/30 start');
select is(public.lead_product_split('both', 70, 5000)->>'reason', 'call_min', 'c6 and the call minimum still applies');

select * from finish();
rollback;
