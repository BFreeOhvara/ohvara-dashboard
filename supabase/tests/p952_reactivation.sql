-- p952_reactivation — pgTAP checks for 267_reactivation.sql: a messy list is cleaned and priced, the charge runs
-- through the lead-spend door, nothing is scrubbed while no scrub provider is connected, the stub scrub takes DNC
-- numbers off (and pays them back), nothing dials while reactivation_live is off, a reached person lands on the board
-- as Reactivated, stop → our do-not-call list, a list with too many stops pauses itself, reactivation people stay
-- hidden until delivered, the reactivation pool never lends a main number, and nobody signed in can flip the flag.
--
-- RUN: `npm run test:sql -- supabase/tests/p952_reactivation.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a9520000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'p952_agent@example.invalid',
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'), jsonb_build_object('full_name', 'Nate Agent'), now(), now()),
       ('00000000-0000-0000-0000-000000000000', 'a9520000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'p952_admin@example.invalid',
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'), jsonb_build_object('full_name', 'Ada Admin'), now(), now());
update public.profiles set role = 'agent', is_active = true, is_demo = false where id = 'a9520000-0000-4000-8000-00000000000a';
update public.profiles set role = 'admin', is_active = true, is_demo = false where id = 'a9520000-0000-4000-8000-00000000000b';

create function pg_temp.as_agent() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"a9520000-0000-4000-8000-00000000000a","role":"authenticated"}', true), set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"a9520000-0000-4000-8000-00000000000b","role":"authenticated"}', true), set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

-- Setup: licensed in TX, GA, FL; one existing lead; one number on our do-not-call list; a 100-minimum.
select pg_temp.as_owner();
insert into public.recovery_config (id) values (true) on conflict do nothing;
update public.recovery_config set reactivation_live = false, ai_caller_live = false;
insert into public.agent_lead_settings (agent_id, states, licensed_states, licensed_at)
values ('a9520000-0000-4000-8000-00000000000a', '{TX,GA,FL}', '{TX,GA,FL}', now())
on conflict (agent_id) do update set states = excluded.states, licensed_states = excluded.licensed_states;
insert into public.leads (business_name, contact_name, phone, state, lead_type, assigned_rep_id)
values ('x', 'Old Lead', '+17135552004', 'TX', 'cancellation', 'a9520000-0000-4000-8000-00000000000a');
insert into public.dnc_numbers (phone, internal, source) values ('+13055552005', true, 'test') on conflict (phone) do update set internal = true;

-- The rows: 103 good TX numbers + bad, duplicate, existing, unlicensed, DNC.
create temp table p952_rows as
select jsonb_agg(r) as rows from (
  select jsonb_build_object('first', 'Pat' || g, 'last', 'Lee', 'phone', '(512) 6' || lpad(g::text, 2, '0') || '-' || lpad((2000 + g)::text, 4, '0'), 'state', 'TX', 'age', '55', 'mortgage_cents', '21000000') r
    from generate_series(1, 103) g
  union all select jsonb_build_object('first', 'Bad', 'phone', '123', 'state', 'TX')
  union all select jsonb_build_object('first', 'Dup', 'phone', '512-601-2001', 'state', 'TX')
  union all select jsonb_build_object('first', 'Existing', 'phone', '7135552004', 'state', 'TX')
  union all select jsonb_build_object('first', 'Unlicensed', 'phone', '6025552003', 'state', 'AZ')
  union all select jsonb_build_object('first', 'NewYork', 'phone', '2125552006', 'state', 'NY')
  union all select jsonb_build_object('first', 'Dnc', 'phone', '3055552005', 'state', 'FL')
) x;
grant select on p952_rows to authenticated;
-- the stub scrub will flag these two later
insert into public.state_call_rules (state, tz) values ('TX', array['America/Chicago']) on conflict do nothing;

-- ── a. the flag and the guard ───────────────────────────────────────────────────────────────────────────────────────
select is((select reactivation_live from public.recovery_config limit 1), false, 'a1 reactivation_live starts off');
select pg_temp.as_admin();
select throws_ok($$ update public.recovery_config set reactivation_live = true $$, '42501', null, 'a2 a signed-in admin cannot turn reactivation on');
select throws_ok($$ update public.reactivation_settings set scrub_provider = 'stub' $$, '42501', null, 'a3 nor connect a scrub provider');
select lives_ok($$ select public.admin_reactivation_settings_save(200, 100, 5) $$, 'a4 an admin can save the price, minimum and attempts');

-- ── b. import: cleaning, minimum, price ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_agent();
select is((public.reactivation_terms() ->> 'price_cents')::int, 200, 'b1 terms: $2 per lead');
select is((public.reactivation_terms() -> 'licensed'), '["TX", "GA", "FL"]'::jsonb, 'b2 terms: the agent''s licensed states');
select throws_ok($$ select public.reactivation_create('No tick', (select rows from p952_rows), false) $$, 'P0001', 'Tick the line about the list first', 'b3 no tick, no list');
select throws_ok($$ select public.reactivation_create('Small', '[{"first":"A","phone":"5126012001","state":"TX"}]'::jsonb, true) $$, 'P0001', null, 'b4 under the 100 minimum is refused');
create temp table p952_made as select public.reactivation_create('Aged pack March', (select rows from p952_rows), true) as r;
select is((select (r ->> 'callable')::int from p952_made), 103, 'b5 103 callable after cleaning');
select is((select r -> 'removed' from p952_made), '{"dnc": 1, "existing": 1, "duplicate": 1, "bad_number": 1, "unlicensed": 2}'::jsonb, 'b6 removed: bad, duplicate, existing, 2 unlicensed (AZ, NY), DNC');
select is((select (r ->> 'amount_cents')::int from p952_made), 20600, 'b7 price $206 = 103 x $2; removed are free');
select is((select count(*)::int from public.reactivation_contacts), 0, 'b8 the agent cannot read the people rows directly');
select is((select jsonb_array_length(public.my_reactivation_lists())), 1, 'b9 the agent sees their list');
select pg_temp.as_owner();
select is((select status from public.reactivation_lists), 'draft', 'b10 a new list waits for payment');

-- ── c. the charge (lead-spend's door) ───────────────────────────────────────────────────────────────────────────────
create temp table p952_ch as select public.reactivation_charge_start((select id from public.reactivation_lists), 'a9520000-0000-4000-8000-00000000000a') as r;
select is((select kind || ':' || amount_cents || ':' || note from public.lead_spend_charges where id = (select (r ->> 'charge_id')::uuid from p952_ch)),
          'reactivation:20600:Reactivation · 103 leads · $206', 'c1 one reactivation charge, OHVARA LEADS line');
select throws_ok($$ select public.reactivation_charge_start((select id from public.reactivation_lists), 'a9520000-0000-4000-8000-00000000000b') $$, '42501', null, 'c2 not someone else''s list');
select is((select count(*)::int from public.lead_spend_claim_charges(5, 'a9520000-0000-4000-8000-00000000000a')), 1, 'c3 the charge engine claims it');
select is((public.lead_spend_charge_result((select (r ->> 'charge_id')::uuid from p952_ch), 'paid', 'pi_test_1') ->> 'status'), 'paid', 'c4 paid');
select is((select status from public.reactivation_lists), 'waiting_scrub', 'c5 paid → waiting for the scrub');
select is((select count(*)::int from public.reactivation_contacts where status = 'waiting_scrub'), 103, 'c6 nobody is callable before the scrub');
select throws_ok($$ select public.reactivation_charge_start((select id from public.reactivation_lists), 'a9520000-0000-4000-8000-00000000000a') $$, 'P0001', 'This list is already paid', 'c7 never charged twice');

-- ── d. the scrub ────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.reactivation_scrub_claim()), 0, 'd1 no provider connected → nothing is scrubbed, the list waits');
update public.reactivation_settings set scrub_provider = 'stub';   -- CC, as the database owner
select is((select count(*)::int from public.reactivation_scrub_claim()), 1, 'd2 with a provider the list is claimed');
select is((public.reactivation_scrub_done((select id from public.reactivation_lists),
          '[{"phone":"+15126012001","reason":"national_dnc"},{"phone":"+15126022002","reason":"litigator"}]'::jsonb, 'stub') ->> 'refund_cents')::int,
          400, 'd3 two flagged → $4 back');
select is((select status || ':' || callable || ':' || refund_due_cents from public.reactivation_lists), 'working:101:400', 'd4 working, 101 callable, $4 to pay back');
select is((select national from public.dnc_numbers where phone = '+15126012001'), true, 'd5 the national DNC number is remembered');
select is((select count(*)::int from public.reactivation_refunds_due()), 1, 'd6 the refund is due on the same charge');
select lives_ok($$ select public.reactivation_refunded((select id from public.reactivation_lists), 400) $$, 'd7 refund recorded');
select is((select refunded_cents from public.lead_spend_charges where kind = 'reactivation'), 400, 'd8 the charge shows $4 refunded');

-- ── e. nothing dials while the flag is off ─────────────────────────────────────────────────────────────────────────
update public.reactivation_contacts set next_at = now() - interval '1 minute' where status = 'queued';
select is((public.reactivation_tick() ->> 'off')::boolean, true, 'e1 flag off → the dialer does nothing');
select is((select count(*)::int from public.ai_calls where reactivation_contact_id is not null), 0, 'e2 no calls made');
select is((select count(*)::int from public.leads where reactivation_id is not null), 0, 'e3 no lead rows made');

-- ── f. flag on: the dialer and the AI's rules ──────────────────────────────────────────────────────────────────────
update public.recovery_config set reactivation_live = true;
select is((select max_attempts_24h from public.state_call_rules where state = 'FL'), 3, 'f0 FL keeps its stricter 3-a-day cap');
select ok((public.reactivation_tick() ? 'started'), 'f1 flag on → the dialer runs');
-- Whether it dialed depends on the clock (8 AM-8 PM Central for TX); either way nobody is dialed outside hours.
select ok((select count(*) filter (where status = 'calling') <= 30 and (count(*) filter (where status = 'calling') = 0 or public.reactivation_window_ok('TX', now()))
             and count(*) filter (where status = 'calling' and lead_id is null) = 0 from public.reactivation_contacts),
          'f2 at most 30 a minute, only inside their hours, each with its own hidden lead row');
select ok(not public.reactivation_window_ok('TX', '2026-11-10 13:30:00+00'::timestamptz), 'f3 7:30 AM Central is closed');
select ok(public.reactivation_window_ok('TX', '2026-11-10 16:00:00+00'::timestamptz), 'f4 10 AM Central / 9 AM El Paso is open (both TX zones)');
select ok(not public.reactivation_window_ok('TX', '2026-11-11 02:30:00+00'::timestamptz), 'f5 8:30 PM Central is closed (8 PM stop, not 9)');

-- A person dialed by hand the way the tick does it (deterministic, whatever the clock says).
create temp table p952_p as select id, phone from public.reactivation_contacts where status in ('queued', 'calling') order by phone limit 1;
insert into public.leads (business_name, contact_name, phone, state, lead_type, assigned_rep_id, inbound_stage, reactivation_id, qualifier_answers)
select 'Reactivation', 'Pat Test', phone, 'TX', 'mortgage_protection', 'a9520000-0000-4000-8000-00000000000a', 'contacting', id, '{"reactivation": true}'::jsonb from p952_p;
update public.reactivation_contacts set lead_id = (select id from public.leads where reactivation_id = (select id from p952_p)), status = 'calling'
 where id = (select id from p952_p);
select is((select count(*)::int from public.call_queue where lead_id = (select lead_id from public.reactivation_contacts where id = (select id from p952_p))), 0,
          'f6 a reactivation lead never rings the VA desk');
select is((select count(*)::int from public.ai_calls where lead_id = (select lead_id from public.reactivation_contacts where id = (select id from p952_p)) and reactivation_contact_id is null), 0,
          'f7 nor starts speed to lead');
insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, reactivation_contact_id)
select lead_id, agent_id, 1, now(), id from public.reactivation_contacts where id = (select id from p952_p);
select is((public.deedstone_from('a9520000-0000-4000-8000-00000000000a', 'ai_call', (select id::text from public.ai_calls where reactivation_contact_id = (select id from p952_p))) ->> 'phone'),
          null, 'f8 no reactivation number → no caller ID (never a main number)');

-- ── g. hidden until delivered, then on the board as Reactivated ───────────────────────────────────────────────────
select pg_temp.as_agent();
select is((select count(*)::int from public.leads where reactivation_id is not null), 0, 'g1 the agent can''t see a reactivation person before they''re reached');
select pg_temp.as_owner();
select is((public.ai_caller_result((select id from public.ai_calls where reactivation_contact_id = (select id from p952_p)), 'booked',
           jsonb_build_object('duration_secs', 120, 'booked_for', now() + interval '1 day')) ->> 'status'), 'booked', 'g2 booked');
select is((select inbound_stage || ':' || (reactivated_at is not null) || ':' || (delivered_at is not null) || ':' || coalesce(text_flow, 'none')
             from public.leads where reactivation_id = (select id from p952_p)), 'booked:true:true:none', 'g3 booked, delivered, no text flow');
select pg_temp.as_agent();
select is((select count(*)::int from public.leads where reactivation_id is not null and (qualifier_answers ->> 'reactivation')::boolean), 1, 'g4 now on the agent''s board, tagged Reactivated');
select pg_temp.as_owner();
select is((select count(*)::int from public.ghl_outbox where lead_id = (select lead_id from public.reactivation_contacts where id = (select id from p952_p))), 0, 'g5 nothing goes to GoHighLevel (no texts)');

-- ── h. stop → our do-not-call list; too many stops pause the list ─────────────────────────────────────────────────
create temp table p952_stop as select id, phone from public.reactivation_contacts where status in ('queued', 'calling') order by phone offset 1 limit 25;
insert into public.leads (business_name, phone, state, lead_type, assigned_rep_id, inbound_stage, reactivation_id)
select 'Reactivation', phone, 'TX', 'mortgage_protection', 'a9520000-0000-4000-8000-00000000000a', 'contacting', id from p952_stop;
update public.reactivation_contacts rc set lead_id = l.id from public.leads l where l.reactivation_id = rc.id and rc.id in (select id from p952_stop);
insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, reactivation_contact_id)
select lead_id, agent_id, 1, now(), id from public.reactivation_contacts where id in (select id from p952_stop);
-- 5 stop first, then not interested: at 20 reached (5 stops = 25% > 5%) the list pauses
select count(public.ai_caller_result(c.id, case when rn <= 5 then 'opt_out' else 'hard_no' end, '{}'::jsonb))
  from (select c.id, row_number() over (order by c.id) rn from public.ai_calls c where c.reactivation_contact_id in (select id from p952_stop)) c;
select is((select internal from public.dnc_numbers where phone = (select phone from p952_stop order by phone limit 1)), true, 'h1 stop or not interested → on our do-not-call list');
select is((select status from public.reactivation_lists), 'paused', 'h2 too many stops → the list paused itself');
select ok((select pause_reason from public.reactivation_lists) like '5 of 20 people reached asked us to stop%', 'h3 with the reason');
select is((select count(*)::int from public.notifications where type = 'reactivation_paused' and profile_id = 'a9520000-0000-4000-8000-00000000000b'), 1, 'h4 the admin is told (to-do + bell)');
select is((select reason from public.ai_caller_takes((select lead_id from public.reactivation_contacts where id = (select id from p952_p)))), 'list_paused', 'h5 a paused list dials nobody');

-- ── i. no-answer cadence: next try on day 2, never a 2-minute retry ────────────────────────────────────────────────
update public.reactivation_lists set status = 'working';
create temp table p952_na as select id, phone from public.reactivation_contacts where status in ('queued', 'calling') and lead_id is null order by phone limit 1;
insert into public.leads (business_name, phone, state, lead_type, assigned_rep_id, inbound_stage, reactivation_id)
select 'Reactivation', phone, 'TX', 'mortgage_protection', 'a9520000-0000-4000-8000-00000000000a', 'contacting', id from p952_na;
update public.reactivation_contacts rc set lead_id = l.id from public.leads l where l.reactivation_id = rc.id and rc.id = (select id from p952_na);
insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, reactivation_contact_id)
select lead_id, agent_id, 1, now(), id from public.reactivation_contacts where id = (select id from p952_na);
select is((public.ai_caller_result((select id from public.ai_calls where reactivation_contact_id = (select id from p952_na)), 'no_answer', '{}'::jsonb) ->> 'status'), 'queued', 'i1 no answer → back in line');
select is((select count(*)::int from public.ai_calls where reactivation_contact_id = (select id from p952_na)), 1, 'i2 no 2-minute retry row');
select ok((select next_at >= now() + interval '12 hours' from public.reactivation_contacts where id = (select id from p952_na)), 'i3 next try is the next cadence day');

-- ── j. the pool ────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_admin();
select lives_ok($$ select public.admin_deedstone_number_save(null, '5125550199', 'React 1', null, null, true, 'reactivation') $$, 'j1 an admin adds a reactivation number');
select lives_ok($$ select public.admin_deedstone_number_save(null, '5125550188', 'Main 1', null, null, true, 'main') $$, 'j2 and a main number');
select pg_temp.as_owner();
select is((public.deedstone_from('a9520000-0000-4000-8000-00000000000a', 'ai_call', (select id::text from public.ai_calls where reactivation_contact_id = (select id from p952_na))) ->> 'phone'),
          '+15125550199', 'j3 a reactivation call uses the reactivation number');
select is((public.deedstone_assign('a9520000-0000-4000-8000-00000000000a')).phone, '+15125550188', 'j4 an agent is never given a reactivation number');

select * from finish();
rollback;
