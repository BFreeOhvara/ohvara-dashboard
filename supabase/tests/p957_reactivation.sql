-- p957_reactivation — pgTAP checks for 269_reactivation_per_delivered.sql: free to upload, $20 per delivered
-- appointment or live call, the card check (prepaid, shared card), pay before the lead shows, a declined charge pauses
-- every list until it's paid, transfers under 30 s are free, one charge per person (free rebook after a no-show),
-- new-account limits, duplicate people flagged, texts only after a yes on the call, and the admin's watch list.
--
-- RUN: `npm run test:sql -- supabase/tests/p957_reactivation.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'), jsonb_build_object('full_name', u.name), now(), now()
  from (values ('a9570000-0000-4000-8000-00000000000a'::uuid, 'p957_a@example.invalid', 'Ana Agent'),
               ('a9570000-0000-4000-8000-00000000000b'::uuid, 'p957_b@example.invalid', 'Ben Agent'),
               ('a9570000-0000-4000-8000-00000000000c'::uuid, 'p957_c@example.invalid', 'Cal Agent'),
               ('a9570000-0000-4000-8000-00000000000d'::uuid, 'p957_d@example.invalid', 'Dee Admin')) u(id, email, name);
update public.profiles set role = 'agent', is_active = true, is_demo = false where id in ('a9570000-0000-4000-8000-00000000000a', 'a9570000-0000-4000-8000-00000000000b', 'a9570000-0000-4000-8000-00000000000c');
update public.profiles set role = 'admin', is_active = true, is_demo = false where id = 'a9570000-0000-4000-8000-00000000000d';

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true), set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
-- A list of n good TX numbers starting at (512) 7xx-xxxx offset o.
create function pg_temp.rows(n int, o int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('first', 'P' || g, 'last', 'Q', 'phone', '512' || (7000000 + o + g)::text, 'state', 'TX'))
    from generate_series(1, n) g
$$;
grant execute on function pg_temp.rows(int, int) to authenticated;
create function pg_temp.dial(p_contact uuid) returns uuid language plpgsql as $$
declare lid uuid; cid uuid; rc public.reactivation_contacts;
begin
  select * into rc from public.reactivation_contacts where id = p_contact;
  lid := rc.lead_id;
  if lid is null then
    insert into public.leads (business_name, contact_name, phone, state, lead_type, assigned_rep_id, inbound_stage, reactivation_id, qualifier_answers)
    values ('Reactivation', rc.first_name || ' Q', rc.phone, 'TX', 'mortgage_protection', rc.agent_id, 'contacting', rc.id, '{"reactivation": true}')
    returning id into lid;
    update public.reactivation_contacts set lead_id = lid, status = 'calling' where id = rc.id;
  else
    update public.reactivation_contacts set status = 'calling' where id = rc.id;
  end if;
  insert into public.ai_calls (lead_id, agent_id, attempt, lead_in_at, reactivation_contact_id)
  values (lid, rc.agent_id, least(rc.attempts + 1, 10), now(), rc.id) returning id into cid;
  return cid;
end $$;

select pg_temp.as_owner();
insert into public.recovery_config (id) values (true) on conflict do nothing;
update public.recovery_config set reactivation_live = false, sms_live = false;
insert into public.state_call_rules (state, tz) values ('TX', array['America/Chicago']) on conflict do nothing;
insert into public.agent_lead_settings (agent_id, states, licensed_states, licensed_at)
select a, '{TX}', '{TX}', now() from unnest(array['a9570000-0000-4000-8000-00000000000a', 'a9570000-0000-4000-8000-00000000000b', 'a9570000-0000-4000-8000-00000000000c']::uuid[]) a
on conflict (agent_id) do update set states = excluded.states, licensed_states = excluded.licensed_states;

-- ── a. free upload, new-account limits ─────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000a');
select is((public.reactivation_terms() ->> 'delivered_cents')::int, 2000, 'a1 $20 per delivered');
select is((public.reactivation_terms() -> 'limits' ->> 'max_callable')::int, 300, 'a2 a new account: up to 300 people');
create temp table p957_a1 as select public.reactivation_create('Big pack', pg_temp.rows(350, 0), true) as r;
select is((select (r ->> 'callable')::int || ':' || (r -> 'removed' ->> 'over_limit') || ':' || (r ->> 'amount_cents') from p957_a1), '300:50:0',
          'a3 350 uploaded → 300 kept, 50 over the new-account limit, nothing charged');
select pg_temp.as_owner();
select throws_ok($$ select public.reactivation_start_list((select (r ->> 'list_id')::uuid from p957_a1), 'a9570000-0000-4000-8000-00000000000a') $$,
                 'P0001', 'Check your card first', 'a4 no card check → no start');

-- ── b. the card check ──────────────────────────────────────────────────────────────────────────────────────────────
select is((public.reactivation_card_record('a9570000-0000-4000-8000-00000000000a', 'pm_pre', 'fp_pre', 'prepaid', 'visa', '0000', 'prepaid') ->> 'ok')::boolean, false, 'b1 a prepaid card fails');
select ok(not public.reactivation_card_ok('a9570000-0000-4000-8000-00000000000a'), 'b2 so the list can''t start');
select is((public.reactivation_card_record('a9570000-0000-4000-8000-00000000000a', 'pm_a', 'fp_a', 'credit', 'visa', '4242', 'ok') ->> 'ok')::boolean, true, 'b3 a good card passes');
select ok(public.reactivation_card_ok('a9570000-0000-4000-8000-00000000000a'), 'b4 checked');
select ok(public.reactivation_card_shared('a9570000-0000-4000-8000-00000000000b', 'fp_a'), 'b5 the same card on a second account is caught');
select is((public.reactivation_card_record('a9570000-0000-4000-8000-00000000000b', 'pm_b', 'fp_a', 'credit', 'visa', '4242', 'shared') ->> 'code'), 'shared', 'b6 recorded as shared');
select is((select count(*)::int from public.notifications where type = 'reactivation_watch' and profile_id = 'a9570000-0000-4000-8000-00000000000d'), 1, 'b7 the admins are told');
select is((public.reactivation_start_list((select (r ->> 'list_id')::uuid from p957_a1), 'a9570000-0000-4000-8000-00000000000a') ->> 'status'), 'waiting_scrub', 'b8 card ok → the list starts, free');
select is((select count(*)::int from public.lead_spend_charges where agent_id = 'a9570000-0000-4000-8000-00000000000a'), 0, 'b9 no charge to start');
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.reactivation_create('More', pg_temp.rows(5, 1000), true) $$, 'P0001', null, 'b10 no room left until 3 are paid');
select throws_ok($$ select public.reactivation_card_record('a9570000-0000-4000-8000-00000000000a', 'x', 'x', 'credit', 'v', '1', 'ok') $$, '42501', null, 'b11 an agent can''t mark their own card checked');
select throws_ok($$ select public.reactivation_start_list((select id from public.reactivation_lists limit 1), 'a9570000-0000-4000-8000-00000000000a') $$, '42501', null, 'b12 nor start a list without lead-spend');

-- ── c. same person on two accounts: flagged ──────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000c');
create temp table p957_c1 as select public.reactivation_create('C pack', pg_temp.rows(20, 0), true) as r;
select is((select (r ->> 'dupes')::int from p957_c1), 20, 'c1 the 20 people Ana already uploaded are flagged');
select pg_temp.as_owner();
select is((select count(*)::int from public.reactivation_contacts where agent_id = 'a9570000-0000-4000-8000-00000000000c' and dupe), 20, 'c2 each one marked');

-- ── d. booked → $20 charged → only then the agent sees them ─────────────────────────────────────────────────────────
update public.reactivation_settings set scrub_provider = 'stub';
select public.reactivation_scrub_done((select (r ->> 'list_id')::uuid from p957_a1), '[]'::jsonb, 'stub');
update public.reactivation_contacts set next_at = now() + interval '7 days' where status = 'queued';   -- the dialer stays out of the way
update public.recovery_config set reactivation_live = true;
create temp table p957_ppl as select id, row_number() over (order by phone) n from public.reactivation_contacts
 where list_id = (select (r ->> 'list_id')::uuid from p957_a1) and status = 'queued';
create temp table p957_c as select pg_temp.dial((select id from p957_ppl where n = 1)) as call1;
select is((public.ai_caller_result((select call1 from p957_c), 'booked', jsonb_build_object('booked_for', now() + interval '2 days')) -> 'delivery' ->> 'status'), 'pending', 'd1 booked → a delivery');
select is((select kind || ':' || amount_cents || ':' || status from public.lead_spend_charges where agent_id = 'a9570000-0000-4000-8000-00000000000a'),
          'reactivation_delivery:2000:due', 'd2 one $20 charge made at once');
select is((select status from public.reactivation_deliveries where call_id = (select call1 from p957_c)), 'charging', 'd3 the delivery waits for it');
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.leads where reactivation_id is not null), 0, 'd4 before the charge is paid the agent sees nobody');
select pg_temp.as_owner();
select is((public.lead_spend_charge_result((select id from public.lead_spend_charges where kind = 'reactivation_delivery'), 'paid', 'pi_d1') ->> 'status'), 'paid', 'd5 paid');
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.leads where reactivation_id is not null and reactivated_at is not null and delivered_at is not null), 1, 'd6 paid → on the board, Delivered');
select pg_temp.as_owner();
select is((select count(*)::int from public.notifications where type = 'reactivation_delivered' and profile_id = 'a9570000-0000-4000-8000-00000000000a'), 1, 'd7 the agent is told');

-- ── e. no-show → the AI rebooks, free ───────────────────────────────────────────────────────────────────────────────
insert into public.inbound_events (lead_id, agent_id, kind, label, state)
select lead_id, agent_id, 'no_show', 'No-show', 'done' from public.reactivation_contacts where id = (select id from p957_ppl where n = 1);
select is((select status || ':' || rebook from public.reactivation_contacts where id = (select id from p957_ppl where n = 1)), 'queued:true', 'e1 a no-show puts them back in line for a rebook');
insert into p957_c (call1) select pg_temp.dial((select id from p957_ppl where n = 1));
select is((select count(*)::int from public.ai_calls where reactivation_contact_id = (select id from p957_ppl where n = 1) and status <> 'done'), 1, 'e2 the rebook call is made');
select is((public.ai_caller_result((select c.id from public.ai_calls c where c.reactivation_contact_id = (select id from p957_ppl where n = 1) and c.status <> 'done'),
           'booked', jsonb_build_object('booked_for', now() + interval '3 days')) -> 'delivery' ->> 'status'), 'free_rebook', 'e3 rebooked → free');
select is((select count(*)::int from public.lead_spend_charges where kind = 'reactivation_delivery'), 1, 'e4 still only one charge for that person');

-- ── f. declined → every list pauses until the card is fixed ─────────────────────────────────────────────────────────
create temp table p957_f as select pg_temp.dial((select id from p957_ppl where n = 2)) as call2;
select public.ai_caller_result((select call2 from p957_f), 'booked', jsonb_build_object('booked_for', now() + interval '2 days'));
select is((public.lead_spend_charge_result((select c.id from public.lead_spend_charges c join public.reactivation_deliveries d on d.charge_id = c.id where d.call_id = (select call2 from p957_f)),
           'failed', 'pi_f', 'Your card was declined.') ->> 'status'), 'failed', 'f1 the $20 is declined');
select is((select status || ':' || pause_kind from public.reactivation_lists where id = (select (r ->> 'list_id')::uuid from p957_a1)), 'paused:card', 'f2 the list pauses at once');
select is((select count(*)::int from public.notifications where type = 'reactivation_card_paused' and profile_id = 'a9570000-0000-4000-8000-00000000000a'), 1, 'f3 the agent is asked to update the card');
select is((select reason from public.ai_caller_takes((select lead_id from public.reactivation_contacts where id = (select id from p957_ppl where n = 1)))), 'list_paused', 'f4 nobody is called');
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.leads where reactivation_id is not null and reactivated_at is not null), 1, 'f5 the declined person stays hidden');
select pg_temp.as_owner();
select is(public.lead_spend_retry('a9570000-0000-4000-8000-00000000000a'), 1, 'f6 a fixed card retries the charge');
select is((public.lead_spend_charge_result((select c.id from public.lead_spend_charges c join public.reactivation_deliveries d on d.charge_id = c.id where d.call_id = (select call2 from p957_f)),
           'paid', 'pi_f2') ->> 'status'), 'paid', 'f7 paid this time');
select is((select status from public.reactivation_lists where id = (select (r ->> 'list_id')::uuid from p957_a1)), 'working', 'f8 the list calls again');

-- ── g. live transfers: charged once connected 30 s; shorter is free ─────────────────────────────────────────────────
create temp table p957_g as select pg_temp.dial((select id from p957_ppl where n = 3)) as t1, pg_temp.dial((select id from p957_ppl where n = 4)) as t2;
select public.ai_caller_result((select t1 from p957_g), 'transferred', '{}'::jsonb);
select public.ai_caller_result((select t2 from p957_g), 'transferred', '{}'::jsonb);
select is((select count(*)::int from public.reactivation_deliveries where call_id in ((select t1 from p957_g), (select t2 from p957_g)) and status = 'pending' and charge_id is null), 2,
          'g1 a transfer isn''t charged at the moment it connects');
select is((public.reactivation_transfer_secs((select t1 from p957_g), 12) ->> 'status'), 'short', 'g2 connected 12 s → free');
select is((public.reactivation_transfer_secs((select t2 from p957_g), 95) ->> 'status'), 'pending', 'g3 connected 95 s → owed');
update public.reactivation_deliveries set bill_after = now() - interval '1 second' where call_id in ((select t1 from p957_g), (select t2 from p957_g));
select is((public.reactivation_tick() ->> 'billed')::int, 1, 'g4 the dialer charges the 30-second transfer (only that one)');
select is((select status from public.reactivation_deliveries where call_id = (select t2 from p957_g)), 'charging', 'g5 charging');
select public.lead_spend_charge_result((select charge_id from public.reactivation_deliveries where call_id = (select t2 from p957_g)), 'paid', 'pi_g2');
select is((public.reactivation_transfer_secs((select t2 from p957_g), 8) ->> 'status'), 'refund_due', 'g6 a late report under 30 s → paid back');
select is((select count(*)::int from public.reactivation_refunds_due() r where r ? 'delivery_id'), 1, 'g7 the refund is due');

-- ── h. texts only after a yes on the call ───────────────────────────────────────────────────────────────────────────
create temp table p957_h as select pg_temp.dial((select id from p957_ppl where n = 5)) as y, pg_temp.dial((select id from p957_ppl where n = 6)) as n;
update public.ai_calls set booked_for = (((now() at time zone 'America/Chicago')::date + 3) + time '15:00') at time zone 'America/Chicago' where id in ((select y from p957_h), (select n from p957_h));
select is((public.reactivation_text_consent((select y from p957_h), true) ->> 'queued')::int, 4, 'h1 yes → confirmation + 3 reminders queued');
select is((public.reactivation_text_consent((select n from p957_h), false) ->> 'queued')::int, 0, 'h2 no → nothing');
select is((select text_ok::text || ':' || (text_ok_call is not null) from public.reactivation_contacts where id = (select id from p957_ppl where n = 5)), 'true:true', 'h3 the yes is kept with the call');
select is((select qualifier_answers ->> 'sms_consent_source' from public.leads where id = (select lead_id from public.ai_calls where id = (select y from p957_h))), 'reactivation_call', 'h4 and on the lead');
select is((select count(*)::int from public.reactivation_texts_claim()), 0, 'h5 texts are off → nothing is sent, they wait');
select is((select count(*)::int from public.reactivation_texts where status = 'queued'), 4, 'h6 still queued');
select is((select count(*)::int from public.ghl_outbox where lead_id in (select lead_id from public.reactivation_contacts where agent_id = 'a9570000-0000-4000-8000-00000000000a')), 0,
          'h7 nothing about them goes to GoHighLevel');

-- ── i. admin: settings, the watch list, waive ───────────────────────────────────────────────────────────────────────
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000d');
select is((public.admin_reactivation_settings_save(p_delivered_cents => 2500, p_watch_calls => 10) ->> 'delivered_cents')::int, 2500, 'i1 the admin sets the price per delivered');
select pg_temp.as_owner();
update public.reactivation_lists set status = 'working' where agent_id = 'a9570000-0000-4000-8000-00000000000c';
select count(pg_temp.dial(id)) from (select id from public.reactivation_contacts where agent_id = 'a9570000-0000-4000-8000-00000000000c' limit 12) x;
update public.ai_calls set status = 'done', outcome = 'no_answer', cost_cents = 15 where agent_id = 'a9570000-0000-4000-8000-00000000000c';
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000d');
select is((select (a ->> 'watch')::boolean from jsonb_array_elements(public.admin_reactivation_view() -> 'accounts') a where a ->> 'agent_id' = 'a9570000-0000-4000-8000-00000000000c'), true,
          'i2 12 calls and nothing paid → on the watch list');
select is((select (a ->> 'paid')::int from jsonb_array_elements(public.admin_reactivation_view() -> 'accounts') a where a ->> 'agent_id' = 'a9570000-0000-4000-8000-00000000000a'), 3,
          'i3 Ana: 3 paid deliveries');
select is((select (a -> 'limits' ->> 'is_new')::boolean from jsonb_array_elements(public.admin_reactivation_view() -> 'accounts') a where a ->> 'agent_id' = 'a9570000-0000-4000-8000-00000000000a'), false,
          'i4 3 paid → normal limits');
select pg_temp.as_user('a9570000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.admin_reactivation_view() $$, '42501', null, 'i5 agents can''t see the admin view');
select is((select count(*)::int from public.reactivation_cards), 0, 'i6 nor the card checks');

select * from finish();
rollback;
