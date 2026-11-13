-- p955_products — pgTAP checks for 268_products.sql: sign up for any mix of Leads, Servicing and Reactivation (right
-- charge each time, reactivation only = no charge), add a product in Billing (setup when due, the days left, the
-- first days of leads), remove one at the next bill date (or keep it), the monthly bill by product, revenue by product.
-- ROLLBACK-ONLY, its own test users. RUN: `npm run test:sql -- supabase/tests/p955_products.sql` (PGlite). Never live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p955_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a9550000-0000-4000-8000-00000000000a'::uuid, 'a', 'Ann All Three'),
    ('a9550000-0000-4000-8000-00000000000b'::uuid, 'b', 'Ben Servicing Reactivation'),
    ('a9550000-0000-4000-8000-00000000000c'::uuid, 'c', 'Cy Reactivation Only'),
    ('a9550000-0000-4000-8000-00000000000d'::uuid, 'd', 'Dee Leads Reactivation'),
    ('a9550000-0000-4000-8000-00000000000e'::uuid, 'e', 'Eve Admin')
  ) as u(id, n, full_name);
update public.profiles set role = 'agent', is_active = true, billing_status = 'none', signup_source = 'self' where id::text like 'a9550000-%';
update public.profiles set role = 'admin' where id = 'a9550000-0000-4000-8000-00000000000e';

create function pg_temp.a() returns uuid language sql as $$ select 'a9550000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'a9550000-0000-4000-8000-00000000000b'::uuid $$;
create function pg_temp.c() returns uuid language sql as $$ select 'a9550000-0000-4000-8000-00000000000c'::uuid $$;
create function pg_temp.d() returns uuid language sql as $$ select 'a9550000-0000-4000-8000-00000000000d'::uuid $$;
create function pg_temp.day(d date) returns void language sql as $$ select set_config('ohvara.today', d::text, true) $$;
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
create function pg_temp.pl(x uuid) returns public.agent_billing_plans language sql as $$
  select * from public.agent_billing_plans where agent_id = x
$$;

alter table public.billing_price_book disable trigger billing_price_book_block;
update public.billing_price_book set effective_from = case version when 1 then date '2026-10-01' when 2 then date '2026-10-15' else date '2026-11-02' end;
alter table public.billing_price_book enable trigger billing_price_book_block;
update public.billing_settings set founding_count = 0, charge_mode = 'nightly';
select pg_temp.day('2026-11-09');

-- ── a. quotes for each mix (prices unchanged) ───────────────────────────────
select is((public.billing_signup_quote('growth', 10000, pg_temp.a()))->>'total_cents', '202200', 'a1 the P933 call still works: Growth at $100/day');
select is((public.billing_signup_quote('growth', 10000, pg_temp.a(), '{leads}'))->>'total_cents', '202200', 'a2 Leads only: 299 + 1,499 + 200 + 24');
select is((public.billing_signup_quote(null, null, pg_temp.a(), '{servicing}'))->>'total_cents', '79800', 'a3 Servicing only: 299 + 499');
select is((public.billing_signup_quote('growth', 10000, pg_temp.a(), '{leads,servicing}'))->>'total_cents', (202200 + 49900)::text, 'a4 Leads + Servicing: one setup, both plans');
select is((public.billing_signup_quote(null, null, pg_temp.a(), '{reactivation}'))->>'total_cents', '0', 'a5 Reactivation only: nothing today');
select is((public.billing_signup_quote('starter', 6000, pg_temp.a(), '{reactivation,leads}'))->>'total_cents', (29900 + 69900 + 12000 + 1440)::text, 'a6 Leads + Reactivation = Leads');
select is((public.billing_signup_quote(null, null, pg_temp.a(), '{servicing,reactivation}'))->>'total_cents', '79800', 'a7 Servicing + Reactivation = Servicing');
select is((public.billing_signup_quote('growth', 10000, pg_temp.a(), '{reactivation,servicing,leads}'))->'products', '["leads", "servicing", "reactivation"]'::jsonb, 'a8 products come back in one order');
select throws_ok($$ select public.billing_signup_quote(null, null, pg_temp.a(), '{}') $$, '22023', 'Pick at least one', 'a9 nothing picked');
select is(jsonb_array_length((public.billing_signup_quote('growth', 10000, pg_temp.a(), '{leads,servicing}'))->'lines'), 2, 'a10 two lines: the plan and Servicing');

-- ── b. reactivation only: a card on file, no charge, the portal opens ───────
select throws_ok($$ select public.billing_signup_start(null, null, pg_temp.c(), '{reactivation}') $$, 'P0001', 'Add a card first', 'b1 needs a card');
select public.billing_card_saved(id, 'Visa ending 4242') from public.profiles where id::text like 'a9550000-%' and role = 'agent';
select is((public.billing_signup_start(null, null, pg_temp.c(), '{reactivation}'))->>'free', 'true', 'b2 Cy signs up for Reactivation only');
select is((select count(*)::int from public.lead_spend_charges where agent_id = pg_temp.c()), 0, 'b3 nothing charged');
select ok(public.servicing_active(pg_temp.c()) and not public.leads_active(pg_temp.c()), 'b4 the portal opens; no leads');
select is((pg_temp.pl(pg_temp.c())).picked, '{reactivation}'::text[], 'b5 picked: reactivation');
select is((pg_temp.pl(pg_temp.c())).products, 'servicing', 'b6 the old column says no lead spend');
select is((public.agent_membership_due(pg_temp.c()))->>'membership_cents', '0', 'b7 no monthly charge');
select throws_ok($$ select public.billing_signup_start(null, null, pg_temp.c(), '{reactivation}') $$, 'P0001', 'You''ve already signed up', 'b8 once');
select ok(exists (select 1 from public.notifications where type = 'new_agent_paid' and detail like 'Cy Reactivation Only signed up for Reactivation only%'), 'b9 admins hear about it');

-- ── c. all three ────────────────────────────────────────────────────────────
select is((public.billing_signup_start('growth', 10000, pg_temp.a(), '{leads,servicing,reactivation}'))->>'total_cents', (202200 + 49900)::text, 'c1 Ann: all three, $2,521');
select is((pg_temp.last(pg_temp.a(), 'signup')).amount_cents, 252100, 'c2 one charge');
select is((pg_temp.last(pg_temp.a(), 'signup')).servicing_cents, 49900, 'c3 its servicing part');
select is((pg_temp.last(pg_temp.a(), 'signup')).note,
  'Sign-up: setup $299.00 · Growth plan, first month $1,499.00 · Servicing, first month $499.00 · first 2 days: $200.00 to your ads · $24.00 booking desk', 'c4 its words');
select is(pg_temp.run(pg_temp.a(), 'paid'), 1, 'c5 paid');
select ok((pg_temp.pl(pg_temp.a())).signed_up_at is not null and (pg_temp.pl(pg_temp.a())).leads_setup_at is not null, 'c6 signed up, Leads set up');
select is((pg_temp.pl(pg_temp.a())).picked, '{leads,servicing,reactivation}'::text[], 'c7 picked: all three');
select is((public.agent_membership_due(pg_temp.a()))->>'membership_cents', (149900 + 49900)::text, 'c8 monthly: Growth + Servicing');
select is((public.agent_membership_due(pg_temp.a()))->'clients'->>'included', '150', 'c9 150 added clients included');

-- ── d. servicing + reactivation; leads + reactivation ───────────────────────
select is((public.billing_signup_start(null, null, pg_temp.b(), '{servicing,reactivation}'))->>'total_cents', '79800', 'd1 Ben: Servicing + Reactivation');
select is(pg_temp.run(pg_temp.b(), 'paid'), 1, 'd2 paid');
select ok((pg_temp.pl(pg_temp.b())).leads_setup_at is null and (pg_temp.pl(pg_temp.b())).setup_paid_at is not null, 'd3 setup paid, Leads not set up');
select is((select leads_status from public.profiles where id = pg_temp.b()), 'none', 'd4 no leads');
select is((public.billing_signup_start('starter', 6000, pg_temp.d(), '{leads,reactivation}'))->>'total_cents', (29900 + 69900 + 12000 + 1440)::text, 'd5 Dee: Leads + Reactivation');
select is(pg_temp.run(pg_temp.d(), 'paid'), 1, 'd6 paid');
select is((public.agent_membership_due(pg_temp.d()))->>'membership_cents', '69900', 'd7 monthly: Starter only');

-- ── e. add Leads to Ben's servicing account (Nov 19; P990: the difference from Servicing, same billing day) ────
select pg_temp.day('2026-11-19');
select throws_ok($$ select public.billing_product_add('leads', 'starter', 6000, pg_temp.b()) $$, 'P0001', 'Finish your details first', 'e1 Leads needs states and hours first');
select set_config('request.jwt.claims', '{"sub":"a9550000-0000-4000-8000-00000000000b","role":"authenticated"}', true), set_config('role', 'authenticated', true);
select lives_ok($$ select public.save_signup_details(jsonb_build_object('states', jsonb_build_array('TX', 'OK', 'LA'), 'licensed', true,
  'timezone', 'America/Chicago', 'working_hours', jsonb_build_array(jsonb_build_object('weekday', 1, 'start', '09:00', 'end', '17:00')),
  'live_transfers', false)) $$, 'e2 a servicing account can save the Leads details');
select is((public.billing_product_quote('leads', 'starter', 6000))->>'total_cents', (29900 + 20000 + 12000 + 1440)::text, 'e3 quote: setup + (Starter − Servicing) + 2 days');
select throws_ok($$ select public.billing_product_add('leads', 'starter', 6000) $$, '42501', null, 'e4 agents can''t make the charge themselves (lead-spend does)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((public.billing_product_add('leads', 'starter', 6000, pg_temp.b()))->>'status', 'due', 'e5 the add charge');
select is((pg_temp.last(pg_temp.b(), 'product_add')).note,
  'Added Starter plan · setup $299.00 · the difference from Servicing $200.00 · first 2 days: $120.00 to your ads · $14.40 booking desk', 'e6 its words');
select is(pg_temp.run(pg_temp.b(), 'paid'), 1, 'e7 paid');
select ok('leads' = any((pg_temp.pl(pg_temp.b())).picked) and not 'servicing' = any((pg_temp.pl(pg_temp.b())).picked), 'e8 Leads is on; Servicing stops (included)');
select ok(public.leads_active(pg_temp.b()) and (pg_temp.pl(pg_temp.b())).tier_key = 'starter', 'e9 leads active on Starter');
select is((select count(*)::int from public.lead_spend_charges where agent_id = pg_temp.b() and kind = 'nightly' and status = 'paid'), 2, 'e10 the first two days paid');
select throws_ok($$ select public.billing_product_quote('leads', 'starter', 6000, pg_temp.b()) $$, 'P0001', 'You already have it', 'e11 not twice');

-- ── f. add Servicing to Cy's reactivation-only account: a full month from today ──
select is((public.billing_product_quote('servicing', null, null, pg_temp.c()))->>'total_cents', '79800', 'f1 setup + a full month (no month running)');
select is((public.billing_product_add('servicing', null, null, pg_temp.c()))->>'status', 'due', 'f2 charge made');
select is(pg_temp.run(pg_temp.c(), 'paid'), 1, 'f3 paid');
select ok((pg_temp.pl(pg_temp.c())).paid_start = date '2026-11-19' and (pg_temp.pl(pg_temp.c())).picked = '{servicing,reactivation}', 'f4 bill date Nov 19, Servicing on');

-- ── g. remove at the next bill date, keep, roll over ────────────────────────
select is((public.billing_product_remove('servicing', pg_temp.a()))->>'ends', '2026-12-09', 'g1 Ann removes Servicing: ends Dec 9');
select is((public.agent_membership_due(pg_temp.a()))->>'membership_cents', (149900 + 49900)::text, 'g2 still billed until then');
select is((public.billing_product_keep('servicing', pg_temp.a()))->>'kept', 'true', 'g3 she keeps it after all');
select ok((pg_temp.pl(pg_temp.a())).picked_next is null, 'g4 nothing waiting');
select is((public.billing_product_remove('leads', pg_temp.a()))->'keeps', '["servicing", "reactivation"]'::jsonb, 'g5 removes Leads instead');
select throws_ok($$ select public.billing_product_remove('servicing', pg_temp.d()) $$, 'P0001', 'You don''t have it', 'g7 Dee has no Servicing');
select is((public.billing_product_remove('leads', pg_temp.d()))->'keeps', '["reactivation"]'::jsonb, 'g8 Dee drops Leads: keeps Reactivation, no monthly');
select pg_temp.day('2026-12-09');
select is(public.billing_products_rollover(), 2, 'g9 Dec 9: both removals happen');
select ok(not public.leads_active(pg_temp.a()) and (pg_temp.pl(pg_temp.a())).picked = '{servicing,reactivation}', 'g10 Ann: no leads now');
select is(public.billing_plan_month_run(), 2, 'g11 Ann and Ben billed (Cy on Dec 19; Dee, reactivation only, never)');
select is((pg_temp.last(pg_temp.a(), 'plan_month')).amount_cents, 49900, 'g12 Ann pays Servicing only');
select throws_ok($$ select public.billing_product_remove('reactivation', pg_temp.d()) $$, 'P0001', null, 'g13 can''t remove your only product');

-- ── h. revenue by product; doors ────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"a9550000-0000-4000-8000-00000000000e","role":"authenticated"}', true), set_config('role', 'authenticated', true);
select is((public.admin_billing_revenue('2026-11-01', '2026-11-30'))->'by_product'->>'servicing', (49900 + 49900 + 49900)::text, 'h1 November servicing: Ann, Ben, Cy');
select is((public.admin_billing_revenue('2026-11-01', '2026-11-30'))->'by_product'->>'setup', (29900 * 5)::text, 'h2 setup: Ann, Ben (x2: servicing, then Leads), Cy, Dee');
reset role;
select set_config('request.jwt.claims', '', true);
select ok(not has_function_privilege('authenticated', 'public.billing_product_add(text,text,integer,uuid)', 'execute'), 'h3 adding goes through lead-spend only');
select ok(has_function_privilege('authenticated', 'public.billing_product_remove(text,uuid)', 'execute'), 'h4 an agent can remove');

select * from finish();
rollback;
