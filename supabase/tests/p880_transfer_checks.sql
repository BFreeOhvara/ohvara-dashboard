-- p880_transfer_checks â€” pgTAP checks for the P880 migration (p880_transfer_checks.sql, unnumbered): the checks
-- table and its RLS, one open check per agent, the phone report, reach, the sweep (30 s timer, call ended â†’
-- cancelled + callback) and the daily app health check (booking only + agent and admin told).
--
-- RUN: `npm run test:sql -- supabase/tests/p880_transfer_checks.sql` (local PGlite). One transaction, rolled
-- back. Never against Ohvara's live database.
--
-- Cast: agent A (passed both tests, one phone), agent B (no phone), VA V, other VA W, admin Z.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p880_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('a8800000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent'),
    ('a8800000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent'),
    ('a8800000-0000-4000-8000-00000000000f'::uuid, 'va_v', 'fulfillment'),
    ('a8800000-0000-4000-8000-00000000000e'::uuid, 'va_w', 'fulfillment'),
    ('a8800000-0000-4000-8000-000000000009'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set is_active = true where id::text like 'a8800000-%';
update public.profiles set role = 'fulfillment' where id in ('a8800000-0000-4000-8000-00000000000f', 'a8800000-0000-4000-8000-00000000000e');
update public.profiles set role = 'admin' where id = 'a8800000-0000-4000-8000-000000000009';

insert into public.push_devices (profile_id, token, platform) values ('a8800000-0000-4000-8000-00000000000a', 'p880-token-agent-a-000000', 'ios');
insert into public.transfer_readiness (agent_id, push_ok_at, call_ok_at, booking_only)
values ('a8800000-0000-4000-8000-00000000000a', now(), now(), false);
insert into public.leads (id, business_name, contact_name, phone, lead_type, assigned_rep_id)
values ('a8800000-0000-4000-8000-0000000000c1'::uuid, 'Rosa Diaz', 'Rosa Diaz', '5125550100', 'policy_help', 'a8800000-0000-4000-8000-00000000000a')
on conflict do nothing;
insert into public.help_calls (call_sid, status, va_id, lead_id)
values ('CAp880live', 'live', 'a8800000-0000-4000-8000-00000000000f', 'a8800000-0000-4000-8000-0000000000c1'::uuid),
       ('CAp880gone', 'live', 'a8800000-0000-4000-8000-00000000000f', 'a8800000-0000-4000-8000-0000000000c1'::uuid);

-- â”€â”€ a. The table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
select has_table('public', 'transfer_checks', 'a1 transfer_checks exists');
select has_table('public', 'transfer_readiness', 'a2 transfer_readiness exists');
select has_column('public', 'push_devices', 'time_sensitive', 'a3 push_devices.time_sensitive');
insert into public.transfer_checks (id, call_sid, va_id, agent_id, lead_id, summary, status, sent_at, expires_at)
values ('c8800000-0000-4000-8000-000000000001', 'CAp880live', 'a8800000-0000-4000-8000-00000000000f', 'a8800000-0000-4000-8000-00000000000a',
        'a8800000-0000-4000-8000-0000000000c1'::uuid, '{"name":"Rosa Diaz"}', 'sent', now(), now() + interval '30 seconds');
select throws_ok($$ insert into public.transfer_checks (agent_id, status) values ('a8800000-0000-4000-8000-00000000000a', 'sent') $$,
  '23505', null, 'a4 one open check per agent');
select lives_ok($$ insert into public.transfer_checks (agent_id, status, is_test) values ('a8800000-0000-4000-8000-00000000000a', 'sent', true) $$,
  'a5 a Setup test check does not count against it');
select throws_ok($$ insert into public.transfer_checks (agent_id, status) values ('a8800000-0000-4000-8000-00000000000b', 'maybe') $$,
  '23514', null, 'a6 status is one of the known steps');
select is((select seen_token from public.transfer_checks where id = 'c8800000-0000-4000-8000-000000000001') ~ '^[0-9a-f]{32}$', true,
  'a7 every check gets a 32-hex seen token');

-- â”€â”€ b. RLS: the VA on the call, the agent asked, admins â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a8800000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select is((select count(*) from public.transfer_checks where not is_test), 1::bigint, 'b1 the VA reads their check');
select throws_ok($$ update public.transfer_checks set status = 'connected' $$, '42501', null, 'b2 the VA can''t write it');
select set_config('request.jwt.claims', '{"sub":"a8800000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
select is((select count(*) from public.transfer_checks), 0::bigint, 'b3 another VA sees nothing');
select set_config('request.jwt.claims', '{"sub":"a8800000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is((select count(*) from public.transfer_checks), 2::bigint, 'b4 the agent reads their checks (and their test)');
select throws_ok($$ insert into public.transfer_checks (agent_id) values ('a8800000-0000-4000-8000-00000000000a') $$, '42501', null, 'b5 the agent can''t insert');
select set_config('request.jwt.claims', '{"sub":"a8800000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select is((select count(*) from public.transfer_checks), 0::bigint, 'b6 another agent sees nothing');

-- â”€â”€ c. Phone report and reach â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
select set_config('request.jwt.claims', '{"sub":"a8800000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.push_report('p880-token-agent-a-000000', 'granted', 'on');
select is((select ready from public.transfer_reach('a8800000-0000-4000-8000-00000000000a')), true, 'c1 agent A is reachable');
select is((select count(*) from public.transfer_reach('a8800000-0000-4000-8000-00000000000b')), 0::bigint, 'c2 an agent can''t read another agent''s reach');
select set_config('request.jwt.claims', '{"sub":"a8800000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select is((select reason from public.transfer_reach('a8800000-0000-4000-8000-00000000000b')), 'no_device', 'c3 the VA sees why B is not reachable');
select throws_ok($$ select * from public.transfer_reach_for('a8800000-0000-4000-8000-00000000000b') $$, '42501', null, 'c4 the service version is service only');
select is((select count(*) from public.admin_unreachable_agents()), 0::bigint, 'c5 the admin list is admins only');
select set_config('request.jwt.claims', '{"sub":"a8800000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select ok(exists (select 1 from public.admin_unreachable_agents() where agent_id = 'a8800000-0000-4000-8000-00000000000b' and reason = 'no_device'),
  'c6 admin sees agent B as unreachable, no phone');
select ok(not exists (select 1 from public.admin_unreachable_agents() where agent_id = 'a8800000-0000-4000-8000-00000000000a'), 'c7 and not agent A');
reset role;
update public.push_devices set permission = 'denied' where token = 'p880-token-agent-a-000000';
select is((select reason from public.transfer_reach_for('a8800000-0000-4000-8000-00000000000a')), 'notifications_off', 'c8 notifications turned off: not reachable');
update public.push_devices set permission = 'granted' where token = 'p880-token-agent-a-000000';

-- â”€â”€ d. The sweep â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
update public.transfer_checks set expires_at = now() - interval '1 second' where id = 'c8800000-0000-4000-8000-000000000001';
select public.transfer_checks_sweep();
select is((select status from public.transfer_checks where id = 'c8800000-0000-4000-8000-000000000001'), 'no_answer', 'd1 past 30 s â†’ no_answer');
insert into public.transfer_checks (id, call_sid, va_id, agent_id, lead_id, status)
values ('c8800000-0000-4000-8000-000000000002', 'CAp880gone', 'a8800000-0000-4000-8000-00000000000f', 'a8800000-0000-4000-8000-00000000000a',
        'a8800000-0000-4000-8000-0000000000c1'::uuid, 'yes');
update public.help_calls set status = 'ended' where call_sid = 'CAp880gone';
select public.transfer_checks_sweep();
select is((select status from public.transfer_checks where id = 'c8800000-0000-4000-8000-000000000002'), 'cancelled', 'd2 the call ended after Yes â†’ cancelled');
select is((select va_outcome from public.leads where id = 'a8800000-0000-4000-8000-0000000000c1'::uuid), 'callback', 'd3 and the lead is a VA callback');
select ok((select va_callback_at from public.leads where id = 'a8800000-0000-4000-8000-0000000000c1'::uuid) > now(), 'd4 a few minutes out');

-- â”€â”€ e. The daily app health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
update public.push_devices set last_seen_at = now() - interval '20 days' where token = 'p880-token-agent-a-000000';
select is(public.transfer_health_daily(), 1, 'e1 one agent switched to booking only');
select is((select booking_only from public.transfer_readiness where agent_id = 'a8800000-0000-4000-8000-00000000000a'), true, 'e2 agent A is booking only');
select ok(exists (select 1 from public.notifications where profile_id = 'a8800000-0000-4000-8000-00000000000a' and type = 'live_calls_unreachable')
          and exists (select 1 from public.notifications where profile_id = 'a8800000-0000-4000-8000-000000000009' and type = 'live_calls_unreachable'),
  'e3 the agent and the admin are told');

select * from finish();
rollback;
