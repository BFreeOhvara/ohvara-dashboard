-- p_agent_products — pgTAP checks for the agent_products migration: what each agent
-- has, Submit's limit and the policies trigger reading it, the VA path, the week.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_agent_products.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- The plan rows are this file's own, so no case leans on what the real rows hold.
-- Cast: S (seven), T (sixteen), B (sixteen, plus Leads), L (Leads only), N (neither),
-- Z (only 0-cent spend rows), P (a paused spend row), O (a tier with no cap), C (comped
-- on sixteen), Q (makes the deals), M (settings move under them), K (agent on another
-- clock), rep R (fulfillment, with a spend row), admin A. Carrier: open all week.

begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_products_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000001'::uuid, 's', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000002'::uuid, 't', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000003'::uuid, 'b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000004'::uuid, 'l', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000005'::uuid, 'n', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000006'::uuid, 'z', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000007'::uuid, 'p', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000008'::uuid, 'o', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-000000000009'::uuid, 'c', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-00000000000a'::uuid, 'q', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-00000000000b'::uuid, 'm', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8a01-00000000000c'::uuid, 'k', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8a01-000000000001'::uuid, 'r', 'fulfillment'),
    ('cccccccc-cccc-4ccc-8a01-000000000001'::uuid, 'a', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8a01-000000000001';

insert into public.agent_billing_tiers (key, name, weekly_cents, weekly_cap) values
  ('p_ap_seven',   'Test seven',   1111, 7),
  ('p_ap_sixteen', 'Test sixteen', 2222, 16),
  ('p_ap_open',    'Test open',    3333, null),
  ('p_ap_moving',  'Test moving',  4444, 2);

update public.profiles set billing_tier = 'p_ap_seven'   where id = 'aaaaaaaa-aaaa-4aaa-8a01-000000000001';
update public.profiles set billing_tier = 'p_ap_sixteen' where id in ('aaaaaaaa-aaaa-4aaa-8a01-000000000002', 'aaaaaaaa-aaaa-4aaa-8a01-000000000003', 'aaaaaaaa-aaaa-4aaa-8a01-00000000000a');
update public.profiles set billing_tier = 'p_ap_open'    where id = 'aaaaaaaa-aaaa-4aaa-8a01-000000000008';
update public.profiles set billing_tier = 'p_ap_moving'  where id = 'aaaaaaaa-aaaa-4aaa-8a01-00000000000b';
update public.profiles set billing_tier = 'p_ap_sixteen', billing_exempt = true where id = 'aaaaaaaa-aaaa-4aaa-8a01-000000000009';
update public.profiles set billing_tier = 'p_ap_seven', timezone = 'Asia/Tokyo' where id = 'aaaaaaaa-aaaa-4aaa-8a01-00000000000c';
update public.profiles set has_servicing = false
 where id in ('aaaaaaaa-aaaa-4aaa-8a01-000000000004', 'aaaaaaaa-aaaa-4aaa-8a01-000000000005',
              'aaaaaaaa-aaaa-4aaa-8a01-000000000006', 'aaaaaaaa-aaaa-4aaa-8a01-000000000007');

insert into public.agent_inbound_spend (agent_id, inbound_type, weekly_cents, paused) values
  ('aaaaaaaa-aaaa-4aaa-8a01-000000000003', 'live_call', 5000, false),
  ('aaaaaaaa-aaaa-4aaa-8a01-000000000003', 'booked_appointment', 6000, false),
  ('aaaaaaaa-aaaa-4aaa-8a01-000000000004', 'live_call', 7000, false),
  ('aaaaaaaa-aaaa-4aaa-8a01-000000000004', 'booked_appointment', 0, false),
  ('aaaaaaaa-aaaa-4aaa-8a01-000000000006', 'live_call', 0, false),
  ('aaaaaaaa-aaaa-4aaa-8a01-000000000006', 'booked_appointment', 0, true),
  ('aaaaaaaa-aaaa-4aaa-8a01-000000000007', 'live_call', 8000, true),
  ('bbbbbbbb-bbbb-4bbb-8a01-000000000001', 'live_call', 9000, false);

insert into public.carriers (id, name, is_active, hours, hours_tz, hours_status, hours_checked_at)
select 'dddddddd-dddd-4ddd-8a01-000000000001'::uuid, 'P Products Life', true, h.hours, 'America/Chicago', 'verified', now()
  from (select jsonb_object_agg(d, jsonb_build_object('open', '00:00', 'close', '23:59')) as hours
          from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d) h;

update public.app_settings set submit_live = true, agent_billing_enforced = true where id = 1;

-- Keeps the errcode, hint and words a call raised, so a check can name all three.
create function public.p_ap_err(p_sql text) returns text language plpgsql as $f$
declare v_state text; v_hint text; v_msg text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_msg = message_text;
  return v_state || '|' || coalesce(v_hint, '') || '|' || v_msg;
end
$f$;

create function public.p_ap_no(p_who text) returns uuid language sql as $f$
  select public.agent_submit_deal(
    p_first => 'No', p_last => p_who, p_phone => '5125550100', p_city => 'Austin', p_state => 'TX',
    p_timezone => 'America/Chicago', p_new_carrier => 'dddddddd-dddd-4ddd-8a01-000000000001',
    p_replaced => false, p_best_time => 'morning')
$f$;

create function public.p_ap_many(p_n integer) returns integer language plpgsql as $f$
declare i integer := 0;
begin
  while i < p_n loop
    perform public.p_ap_no('Bulk ' || i);
    i := i + 1;
  end loop;
  return i;
end
$f$;

-- A slot n half hours after noon tomorrow on the client's clock.
create function public.p_ap_slot(p_n integer) returns timestamptz language sql as $f$
  select (date_trunc('day', now() at time zone 'America/Chicago') + interval '1 day 12 hours'
          + make_interval(mins => p_n * 30)) at time zone 'America/Chicago'
$f$;

-- A valid direct booking, the insert useBookCall makes, for this agent at this slot.
create function public.p_ap_direct(p_agent uuid, p_who text, p_n integer) returns void language sql as $f$
  insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned, fulfillment_stage,
                               carrier_id, carrier_name, client_timezone, scheduled_call_at)
  values (p_agent, 'Direct', p_who, true, 'Pending',
          'dddddddd-dddd-4ddd-8a01-000000000001', 'P Products Life', 'America/Chicago', public.p_ap_slot(p_n))
$f$;

grant execute on function public.p_ap_err(text), public.p_ap_no(text), public.p_ap_many(integer), public.p_ap_slot(integer),
  public.p_ap_direct(uuid, text, integer) to authenticated;

create temp table counts (name text primary key, policies bigint, events bigint, tasks bigint);
grant all on counts to authenticated;

-- ── a. The shape ────────────────────────────────────────────────────────────
select is((select p.provolatile::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ';')
             from pg_proc p where p.oid = 'public.agent_products(uuid)'::regprocedure),
          's:true:search_path=public', 'a1 agent_products is stable, security definer, search_path public: it cannot write');
select ok(not has_function_privilege('anon', 'public.agent_products(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.agent_products(uuid)', 'execute'),
          'a2 agent_products is closed to anon, open to authenticated');
select ok(not has_function_privilege('anon', 'public.agent_week_bounds(text, timestamptz)', 'execute')
          and has_function_privilege('authenticated', 'public.agent_week_bounds(text, timestamptz)', 'execute'),
          'a3 agent_week_bounds is closed to anon, open to authenticated');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'agent_submit_deal'), 1::bigint,
          'a4 exactly one agent_submit_deal, no overload');
select ok(not has_function_privilege('anon', 'public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date)', 'execute')
          and has_function_privilege('authenticated', 'public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date)', 'execute'),
          'a5 Submit keeps its grants');
select ok(not has_function_privilege('anon', 'public.agent_weekly_usage(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.agent_weekly_usage(uuid)', 'execute'),
          'a6 agent_weekly_usage keeps its grants');
select is((select count(*) from pg_trigger where tgrelid = 'public.policies'::regclass and tgname = 'policies_enforce_weekly_cap' and not tgisinternal), 1::bigint,
          'a7 the trigger is still there');
select is((select count(*) from public.agent_billing_tiers where not price_is_test), 0::bigint, 'a8 every plan row starts as a test price');
select ok(position('fe2f2055' in col_description('public.app_settings'::regclass,
            (select attnum from pg_attribute where attrelid = 'public.app_settings'::regclass and attname = 'agent_billing_weekly_cents'))) > 0,
          'a9 the settings column comment says Checkout still reads it until the Billing goal moves it');

-- ── b. Who can read whom ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8a01-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select plan_key from public.agent_products()), 'p_ap_seven', 'b1 an agent reads their own, by default');
select throws_ok($$ select * from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000002') $$, '42501', 'Not allowed', 'b2 an agent cannot read another agent');
reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8a01-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select count(*) from public.agent_products('99999999-9999-4999-8a01-999999999999')), 0::bigint, 'b3 an unknown profile returns no row');

-- ── c. What each agent has (read as admin) ──────────────────────────────────
select is((select concat_ws('|', has_servicing, plan_key, plan_name, plan_size, weekly_cents, price_is_test, used, weekly_limit, at_limit, usage_text, has_leads, leads)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000001')),
          't|p_ap_seven|Test seven|7|1111|t|0|7|f|0 of 7 used this week, resets Monday|f|[]',
          'c1 Servicing 7 returns plan_size 7');
select is((select concat_ws('|', has_servicing, plan_key, plan_size, weekly_cents, used, weekly_limit, at_limit, usage_text, has_leads, leads)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000002')),
          't|p_ap_sixteen|16|2222|0|16|f|0 of 16 used this week, resets Monday|f|[]',
          'c2 Servicing 16 returns plan_size 16');

select is((select concat_ws('|', has_servicing, has_leads, leads::text)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000004')),
          'f|t|[{"type": "live_call", "paused": false, "weekly_cents": 7000}]',
          'c3 Leads only: has_servicing false, has_leads true, and the 0-cent row is left out');
select is((select num_nulls(plan_key, plan_name, plan_size, weekly_cents, price_is_test, used, weekly_limit, week_start, week_end, usage_text)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000004')),
          10, 'c4 Leads only: every plan and usage column is null');
select is((select at_limit from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000004')), false, 'c5 Leads only: at_limit false');

select is((select concat_ws('|', has_servicing, plan_size, weekly_limit, has_leads)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000003')),
          't|16|16|t', 'c6 Both: the plan and the leads');
select is((select leads from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000003')),
          '[{"type":"booked_appointment","weekly_cents":6000,"paused":false},{"type":"live_call","weekly_cents":5000,"paused":false}]'::jsonb,
          'c7 Both: leads ordered by type');

select is((select concat_ws('|', has_servicing, has_leads, leads, at_limit, num_nulls(plan_key, plan_size, used, weekly_limit, week_end, usage_text))
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000005')),
          'f|f|[]|f|6', 'c8 Neither: has_servicing false, has_leads false, leads []');
select is((select concat_ws('|', has_servicing, has_leads, leads)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000006')),
          'f|f|[]', 'c9 only 0-cent spend rows, one of them paused, reads as neither');
select is((select concat_ws('|', has_leads, leads::text)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000007')),
          't|[{"type": "live_call", "paused": true, "weekly_cents": 8000}]',
          'c10 a paused row above 0: has_leads true, listed with paused true');
select is((select concat_ws('|', has_servicing, has_leads, leads, at_limit, num_nulls(plan_key, plan_size, used, weekly_limit, week_end, usage_text))
             from public.agent_products('bbbbbbbb-bbbb-4bbb-8a01-000000000001')),
          'f|f|[]|f|6', 'c11 a non-agent role returns no products, even with a spend row');
select is((select concat_ws('|', has_servicing, has_leads, leads)
             from public.agent_products('cccccccc-cccc-4ccc-8a01-000000000001')),
          'f|f|[]', 'c12 an admin has no products either');
select is((select concat_ws('|', plan_key, plan_size is null, weekly_limit is null, at_limit, usage_text)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000008')),
          'p_ap_open|t|t|f|0 used this week, resets Monday',
          'c13 a tier with no cap: weekly_limit null, at_limit false, no "of" in usage_text');
select is((select concat_ws('|', plan_size, weekly_limit)
             from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-000000000009')),
          '16|16', 'c14 a comped agent keeps their tier''s cap (131)');

-- enforced is a true or false in every state, on and off.
select is((select count(*) from unnest(array['aaaaaaaa-aaaa-4aaa-8a01-000000000001', 'aaaaaaaa-aaaa-4aaa-8a01-000000000003', 'aaaaaaaa-aaaa-4aaa-8a01-000000000004',
                                             'aaaaaaaa-aaaa-4aaa-8a01-000000000005', 'aaaaaaaa-aaaa-4aaa-8a01-000000000008',
                                             'bbbbbbbb-bbbb-4bbb-8a01-000000000001', 'cccccccc-cccc-4ccc-8a01-000000000001']::uuid[]) a,
                   lateral public.agent_products(a) p
            where p.enforced is true), 7::bigint,
          'c15 enforced is true for Servicing, both, Leads only, neither, no cap, non-agent and admin');
reset role;
update public.app_settings set agent_billing_enforced = false where id = 1;
select set_config('role', 'authenticated', true);
select is((select count(*) from unnest(array['aaaaaaaa-aaaa-4aaa-8a01-000000000001', 'aaaaaaaa-aaaa-4aaa-8a01-000000000003', 'aaaaaaaa-aaaa-4aaa-8a01-000000000004',
                                             'aaaaaaaa-aaaa-4aaa-8a01-000000000005', 'aaaaaaaa-aaaa-4aaa-8a01-000000000008',
                                             'bbbbbbbb-bbbb-4bbb-8a01-000000000001', 'cccccccc-cccc-4ccc-8a01-000000000001']::uuid[]) a,
                   lateral public.agent_products(a) p
            where p.enforced is false), 7::bigint,
          'c16 enforced is false for all of them with the flag off');
reset role;
update public.app_settings set agent_billing_enforced = true where id = 1;

-- ── d. Leads only at Submit ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8a01-000000000004","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select weekly_limit from public.agent_products()), null::integer, 'd1 Leads only: weekly_limit is null');
select is(public.p_ap_err($$ select public.p_ap_no('Leads') $$), 'P0001|no_servicing|Servicing is not on your plan',
          'd2 Leads only: Submit raises hint no_servicing, with the agreed words');
select ok(public.p_ap_err($$ select public.p_ap_no('Leads') $$) !~* 'subscribe', 'd3 the refusal does not say subscribe');
select ok(coalesce((select usage_text from public.agent_products()), '') !~* 'subscribe', 'd4 nor does usage_text');
select is(public.p_ap_err($$ select public.p_ap_direct('aaaaaaaa-aaaa-4aaa-8a01-000000000004', 'Leads', 1) $$), 'P0001|no_servicing|Servicing is not on your plan',
          'd5 with enforcement on, a direct insert gets the same answer, not a limit');
reset role;
select is((select count(*) from public.policies where agent_id = 'aaaaaaaa-aaaa-4aaa-8a01-000000000004'), 0::bigint, 'd6 no policy was written');

-- ── e. At the limit, enforcement on ─────────────────────────────────────────
-- Not yet counting, for the UPDATE cases below. Written as the owner.
select set_config('request.jwt.claims', '', true);
insert into public.policies (id, agent_id, client_first_name, client_last_name, fulfillment_assigned)
values ('eeeeeeee-eeee-4eee-8a01-000000000001', 'aaaaaaaa-aaaa-4aaa-8a01-00000000000a', 'Not', 'Counting', false),
       ('eeeeeeee-eeee-4eee-8a01-000000000002', 'aaaaaaaa-aaaa-4aaa-8a01-00000000000a', 'Last', 'Week', true);
update public.policies set created_at = now() - interval '8 days' where id = 'eeeeeeee-eeee-4eee-8a01-000000000002';

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8a01-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_ap_many(16), 16, 'e1 16 Submits pass');
select is((select concat_ws('|', used, weekly_limit, at_limit, enforced, usage_text) from public.agent_products()),
          '16|16|t|t|16 of 16 used this week, resets Monday', 'e2 agent_products reads 16 of 16, at the limit');
insert into counts
select 'before',
       (select count(*) from public.policies where agent_id = auth.uid()),
       (select count(*) from public.policy_events where agent_id = auth.uid()),
       (select count(*) from public.servicing_tasks where agent_id = auth.uid());
select is(public.p_ap_err($$ select public.p_ap_no('Seventeenth') $$), 'P0001|weekly_cap|16 of 16 used this week, resets Monday',
          'e3 the 17th raises P0001, hint weekly_cap, 16 of 16 and Monday');
select is((select count(*) from public.policies where agent_id = auth.uid()), (select policies from counts where name = 'before'), 'e4 refused: no policy row written');
select is((select count(*) from public.policy_events where agent_id = auth.uid()), (select events from counts where name = 'before'), 'e5 refused: no policy_events row written');
select is((select count(*) from public.servicing_tasks where agent_id = auth.uid()), (select tasks from counts where name = 'before'), 'e6 refused: no step written');
select is((select used from public.agent_products()), 16, 'e7 used stays 16');
select is(public.p_ap_err($$ select public.p_ap_direct('aaaaaaaa-aaaa-4aaa-8a01-00000000000a', 'Direct', 1) $$), 'P0001|weekly_cap|16 of 16 used this week, resets Monday',
          'e8 a direct insert by the same agent is refused the same way');
select is((select used from public.agent_products()), 16, 'e9 used stays 16 after the direct insert');

-- A service request is not a booking.
select lives_ok(format('select public.agent_submit_service_request(%L, ''carrier_call'', ''x'', ''morning'')',
                       (select id from public.policies where agent_id = auth.uid() and client_first_name = 'No' limit 1)),
                'e10 a service request at 16 of 16 succeeds');
select is((select used from public.agent_products()), 16, 'e11 and used does not change');

-- Since 147 no policy gives an agent a direct UPDATE, so as written it reaches nothing.
update public.policies set fulfillment_assigned = true where id = 'eeeeeeee-eeee-4eee-8a01-000000000001';
select is((select fulfillment_assigned from public.policies where id = 'eeeeeeee-eeee-4eee-8a01-000000000001'), false,
          'e12 with today''s policies an agent''s direct UPDATE changes nothing');
reset role;

-- This transaction only: a policy so the agent's UPDATE reaches the trigger's UPDATE branch.
create policy p_ap_agent_update on public.policies for update to authenticated using (agent_id = auth.uid());
select set_config('role', 'authenticated', true);
select is(public.p_ap_err($$ update public.policies set fulfillment_assigned = true where id = 'eeeeeeee-eeee-4eee-8a01-000000000001' $$),
          'P0001|weekly_cap|16 of 16 used this week, resets Monday', 'e13 an UPDATE that flips a row to counting is refused the same way');
select is(public.p_ap_err(format($$ update public.policies set created_at = %L where id = 'eeeeeeee-eeee-4eee-8a01-000000000002' $$, now())),
          'P0001|weekly_cap|16 of 16 used this week, resets Monday', 'e14 so is one that moves a counted row into this week');
select is(public.p_ap_err($$ update public.policies set created_at = created_at
                              where id = (select id from public.policies where agent_id = auth.uid() and client_first_name = 'No' limit 1) $$),
          'no error', 'e15 a row already counting this week can still be updated at the limit');
select is((select used from public.agent_products()), 16, 'e16 used stays 16 after the UPDATEs');
reset role;
drop policy p_ap_agent_update on public.policies;

-- ── f. The VA path: a fulfillment user inserting for the agent ──────────────
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8a01-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'policies' and policyname = 'policies_insert_va'),
          'f1 policies_insert_va is what lets this insert in');
select is(public.p_ap_err($$ select public.p_ap_direct('aaaaaaaa-aaaa-4aaa-8a01-00000000000a', 'VA on', 2) $$), 'no error',
          'f2 enforcement on, agent at the limit: a VA insert succeeds, no 42501 and no refusal');
select throws_ok($$ select * from public.agent_products('aaaaaaaa-aaaa-4aaa-8a01-00000000000a') $$, '42501', 'Not allowed',
                 'f3 the VA still cannot read the agent''s products, so the trigger really stepped aside');
reset role;
update public.app_settings set agent_billing_enforced = false where id = 1;
select set_config('role', 'authenticated', true);
select is(public.p_ap_err($$ select public.p_ap_direct('aaaaaaaa-aaaa-4aaa-8a01-00000000000a', 'VA off', 3) $$), 'no error',
          'f4 enforcement off: a VA insert succeeds too');
reset role;

-- ── g. Enforcement off: read, never refused ─────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8a01-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select concat_ws('|', used, weekly_limit, at_limit, enforced, usage_text) from public.agent_products()),
          '18|16|t|f|18 of 16 used this week, resets Monday', 'g1 the two VA bookings count; the count and limit are returned with the flag off');
select is(public.p_ap_err($$ select public.p_ap_no('Off') $$), 'no error', 'g2 with the flag off Submit is not refused');
select is(public.p_ap_err($$ select public.p_ap_direct('aaaaaaaa-aaaa-4aaa-8a01-00000000000a', 'Off', 4) $$), 'no error', 'g3 nor is a direct insert');
reset role;
update public.app_settings set agent_billing_enforced = true where id = 1;

-- ── h. The rows decide, with no code change ─────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8a01-00000000000b","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select concat_ws('|', plan_size, weekly_cents, weekly_limit) from public.agent_products()), '2|4444|2', 'h1 the plan as it starts');
select is(public.p_ap_many(2), 2, 'h2 both deals pass');
select is(public.p_ap_err($$ select public.p_ap_no('Third') $$), 'P0001|weekly_cap|2 of 2 used this week, resets Monday', 'h3 the third is refused');
reset role;
update public.agent_billing_tiers set weekly_cap = 3, weekly_cents = 5555, price_is_test = false where key = 'p_ap_moving';
select set_config('role', 'authenticated', true);
select is((select concat_ws('|', plan_size, weekly_cents, price_is_test, weekly_limit, at_limit) from public.agent_products()), '3|5555|f|3|f',
          'h4 after the row changes, agent_products answers with the new size and price');
select is(public.p_ap_err($$ select public.p_ap_no('Third') $$), 'no error', 'h5 and Submit follows: the third passes');
select is(public.p_ap_err($$ select public.p_ap_no('Fourth') $$), 'P0001|weekly_cap|3 of 3 used this week, resets Monday', 'h6 the fourth is refused at the new limit');
reset role;
update public.agent_billing_tiers set weekly_cap = null where key = 'p_ap_moving';
select set_config('role', 'authenticated', true);
select is((select concat_ws('|', plan_size is null, weekly_limit is null, at_limit, usage_text) from public.agent_products()), 't|t|f|3 used this week, resets Monday',
          'h7 a cap taken off the row: no limit, no "of"');
select is(public.p_ap_err($$ select public.p_ap_no('Fourth') $$), 'no error', 'h8 and Submit is not refused');
reset role;

-- A comped agent is held to their tier like anyone else.
update public.agent_billing_tiers set weekly_cap = 1 where key = 'p_ap_sixteen';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8a01-000000000009","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.p_ap_many(1), 1, 'h9 a comped agent''s deal passes under the cap');
select is(public.p_ap_err($$ select public.p_ap_no('Over') $$), 'P0001|weekly_cap|1 of 1 used this week, resets Monday', 'h10 and is refused at it');
reset role;

-- ── i. The week ─────────────────────────────────────────────────────────────
-- The Sunday the clocks go back: this week is an hour longer than usual.
select is((select to_char(b.week_start at time zone 'America/Chicago', 'Dy Mon DD HH24:MI') || ' to ' || to_char(b.week_end at time zone 'America/Chicago', 'Dy Mon DD HH24:MI')
             from public.agent_week_bounds('America/Chicago', timestamp '2026-11-01 23:59:59' at time zone 'America/Chicago') b),
          'Mon Oct 26 00:00 to Mon Nov 02 00:00', 'i1 Chicago at 2026-11-01 23:59:59: Mon Oct 26 00:00 to Mon Nov 2 00:00');
select is((select b.week_end - b.week_start from public.agent_week_bounds('America/Chicago', timestamp '2026-11-01 23:59:59' at time zone 'America/Chicago') b),
          interval '7 days 1 hour', 'i2 that week really is 7 days and 1 hour long');
select is((select to_char(b.week_start at time zone 'America/Chicago', 'Dy Mon DD HH24:MI') || ' to ' || to_char(b.week_end at time zone 'America/Chicago', 'Dy Mon DD HH24:MI')
             from public.agent_week_bounds('America/Chicago', timestamp '2026-11-02 00:00:00' at time zone 'America/Chicago') b),
          'Mon Nov 02 00:00 to Mon Nov 09 00:00', 'i3 one second later the next week starts');
select is((select to_char(b.week_start at time zone 'America/Chicago', 'Dy Mon DD HH24:MI') || ' to ' || to_char(b.week_end at time zone 'America/Chicago', 'Dy Mon DD HH24:MI')
             from public.agent_week_bounds('America/Chicago', timestamp '2027-03-14 23:59:59' at time zone 'America/Chicago') b),
          'Mon Mar 08 00:00 to Mon Mar 15 00:00', 'i4 the Sunday the clocks go forward: still Monday to Monday');
select is((select b.week_end - b.week_start from public.agent_week_bounds('America/Chicago', timestamp '2027-03-14 23:59:59' at time zone 'America/Chicago') b),
          interval '6 days 23 hours', 'i5 that week is an hour shorter');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8a01-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select to_char(week_end at time zone 'Asia/Tokyo', 'Dy HH24:MI') from public.agent_products()), 'Mon 00:00', 'i6 an agent on another clock resets at their own Monday midnight');
select is((select usage_text from public.agent_products()), '0 of 7 used this week, resets Monday', 'i7 and the words use their clock');
select is((select p.week_start = b.week_start and p.week_end = b.week_end
             from public.agent_products() p, public.agent_week_bounds('Asia/Tokyo') b), true, 'i8 agent_products'' week is agent_week_bounds on their clock');
select is((select u.week_start = b.week_start and u.week_end = b.week_end
             from public.agent_weekly_usage() u, public.agent_week_bounds('Asia/Tokyo') b), true, 'i9 agent_weekly_usage reads the same helper');
reset role;

select * from finish();
rollback;
