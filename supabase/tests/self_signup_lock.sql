-- self_signup_lock — pgTAP checks for 190_self_signup_lock.sql: a self-signup agent
-- who has paid for nothing is locked out in the database, not only in the UI.
--
-- ROLLBACK-ONLY. CC runs this after migration 190 is applied, signed in as a test
-- agent. It changes nothing: the whole file is one transaction that ends in
-- ROLLBACK, so every user, row, grant and function it makes (including the
-- pgTAP extension) disappears. It makes its own test users (sl_*@example.invalid)
-- and switches to them with set local role + request.jwt.claims; it never reads
-- or touches a real account. No robot ever runs it against Ohvara.
-- Before that, on this computer only: `npm run test:sql -- supabase/tests/self_signup_lock.sql`
-- replays every migration into an in-memory PGlite and runs this file there. It
-- has no database URL and can't reach Ohvara. A pass there is not a pass on the
-- real stack: it is a stand-in for Supabase.
--
-- Cast: L locked (self, nothing bought), S servicing (self, active), E leads-only
-- (self, leads active), P lapsed (self, past_due after grace), I invited agent,
-- F fulfillment, Z admin.
--
-- Closed by 190 for a locked self-signup (its header): profiles (staff directory),
-- commission_schedule, recovery_config, training_videos, carriers, app_settings,
-- notification_types, sms_consent_scripts, team_conversations, team_messages,
-- appointments, calls, clients, commissions, follow_up_queue, no_answer_queue,
-- leads, messages, and the functions team_activity and my_standing_threads.
-- Left open on purpose: agent_billing_tiers, membership_tiers, lead_prices,
-- prepaid_topup_options (the price lists it needs to choose a plan).

begin;
create extension if not exists pgtap with schema extensions;
select plan(151);

-- ── seed (as the table owner) ───────────────────────────────────────────────
-- A self-signup is made the real way: the pending row first, then the account,
-- so handle_new_user stamps signup_source and the terms in the one insert.
insert into public.pending_signups (email, role, source, terms_version, terms_accepted_at)
select 'sl_' || n || '@example.invalid', 'agent', 'self', '2026-10-30', now()
  from unnest(array['locked', 'servicing', 'leads', 'lapsed']) n;

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'sl_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('5e1f0000-0000-4000-8000-000000000001'::uuid, 'locked',    'agent'),
    ('5e1f0000-0000-4000-8000-000000000002'::uuid, 'servicing', 'agent'),
    ('5e1f0000-0000-4000-8000-000000000003'::uuid, 'leads',     'agent'),
    ('5e1f0000-0000-4000-8000-000000000004'::uuid, 'lapsed',    'agent'),
    ('1a110000-0000-4000-8000-000000000001'::uuid, 'invited',   'agent'),
    ('fa110000-0000-4000-8000-000000000001'::uuid, 'rep',       'fulfillment'),
    ('ad110000-0000-4000-8000-000000000001'::uuid, 'admin',     'agent')
  ) as u(id, n, role);

update public.profiles set role = 'admin' where id = 'ad110000-0000-4000-8000-000000000001';
update public.app_settings set agent_billing_enforced = false, submit_live = true where id = 1;
update public.profiles set billing_status = 'active' where id = '5e1f0000-0000-4000-8000-000000000002';
update public.profiles set leads_status = 'active' where id = '5e1f0000-0000-4000-8000-000000000003';
update public.profiles set billing_status = 'past_due', billing_grace_until = now() - interval '1 day'
 where id = '5e1f0000-0000-4000-8000-000000000004';

-- Something in each table a locked account must not read.
insert into public.training_videos (title, youtube_url) values ('SL video', 'https://example.invalid/v');
insert into public.carriers (id, name, is_active) values ('c0c0c0c0-0000-4000-8000-000000000001', 'SL Carrier', true);
insert into public.clients (business_name, tier) values ('SL Client', 'basic');
-- A booked deal by the invited agent: what team_activity() hands out.
insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned)
values ('1a110000-0000-4000-8000-000000000001', 'SL', 'Booked', true);
-- A policy L already owns, for the agent RPC check in section d. (Since 147 an
-- agent has no direct UPDATE or DELETE on policies: every change is an RPC.)
insert into public.policies (id, agent_id, client_first_name, client_last_name)
values ('b00c0000-0000-4000-8000-000000000001', '5e1f0000-0000-4000-8000-000000000001', 'SL', 'Own');

-- Counts as the owner, by table: what a normal signed-in user should see.
create function public.sl_rows(p_table text) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute format('select count(*) from public.%I', p_table) into n;
  return n;
end
$f$;
grant execute on function public.sl_rows(text) to authenticated;

-- closed = a locked self-signup must see none of it (profiles: only itself).
create temp table chk (t text primary key, closed boolean not null, n bigint);
insert into chk (t, closed)
select t, true from unnest(array['profiles', 'commission_schedule', 'recovery_config', 'training_videos', 'carriers',
                                 'app_settings', 'notification_types', 'sms_consent_scripts', 'clients']) t;
insert into chk (t, closed)
select t, false from unnest(array['agent_billing_tiers', 'membership_tiers', 'lead_prices', 'prepaid_topup_options']) t
 where to_regclass('public.' || t) is not null;
update chk set n = public.sl_rows(t);
grant select on chk to authenticated;

-- ── a. the shape ────────────────────────────────────────────────────────────
select is((select count(*) from chk where closed and n = 0 and t <> 'profiles'), 0::bigint,
          'a1 every closed table has rows for a normal user to see, so "locked sees none" proves something');
select is((select signup_source || '|' || terms_version || '|' || (terms_accepted_at is not null)
             from public.profiles where id = '5e1f0000-0000-4000-8000-000000000001'),
          'self|2026-10-30|true', 'a2 handle_new_user stamped source self and the terms from the pending row');
select is((select signup_source from public.profiles where id = '1a110000-0000-4000-8000-000000000001'),
          'invite', 'a3 an account with no pending row is an invited account');
select is((select count(*) from public.pending_signups where email like 'sl\_%@example.invalid'), 0::bigint,
          'a4 the pending rows were consumed by the sign-up');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'app_settings' and column_name = 'self_signup_open'),
          'false', 'a5 self_signup_open defaults to off');
select ok(not has_table_privilege('authenticated', 'public.signup_attempts', 'select')
          and not has_table_privilege('authenticated', 'public.signup_attempts', 'insert')
          and not has_table_privilege('anon', 'public.signup_attempts', 'select'),
          'a6 signup_attempts is closed to the app roles');
select ok(not has_table_privilege('authenticated', 'public.pending_signups', 'select')
          and not has_table_privilege('anon', 'public.pending_signups', 'insert'),
          'a7 pending_signups is closed to the app roles');
select ok(not has_function_privilege('authenticated', 'public.servicing_active(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.leads_active(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.agent_portal_access(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.is_locked_self_signup()', 'execute')
          and has_function_privilege('authenticated', 'public.agent_portal_access(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.is_locked_self_signup()', 'execute'),
          'a8 the helpers are internal, and the two public ones are for signed-in users only');

-- Every write table the migration lists carries the lock trigger.
select is((
  select count(*) from unnest(array[
    'policies', 'policy_fulfillment_details', 'policy_messages', 'policy_message_reads',
    'direct_messages', 'direct_message_reads', 'messages', 'team_conversations', 'team_messages',
    'agent_lead_settings', 'agent_duty', 'agent_licenses', 'agent_carrier_appointments', 'agent_monthly_goals',
    'leads', 'inbound_events', 'service_requests', 'servicing_tasks', 'fulfillment_cancels',
    'appointments', 'calls', 'closer_followups', 'training_progress', 'bug_reports']) t
   where to_regclass('public.' || t) is not null
     and not exists (select 1 from pg_trigger g
                      where g.tgrelid = to_regclass('public.' || t) and g.tgname = 'a0_block_locked_self_signup' and not g.tgisinternal)
  ), 0::bigint, 'a9 no listed write table is missing the a0_block_locked_self_signup trigger');
select is((select count(*) from pg_trigger where tgrelid = 'public.policies'::regclass
             and tgname = 'a0_block_self_signup_no_servicing' and not tgisinternal),
          1::bigint, 'a10 policies carries the no-Servicing trigger');

-- Every read policy the migration lists was closed (a policy renamed on the live
-- database would be skipped by 190 and show up here).
select ok(coalesce(p.qual, '') like '%is_locked_self_signup%',
          format('a11 policy %s on %s is closed to a locked self-signup', l.pol, l.tbl))
  from (values
    ('profiles', 'profiles_select'), ('commission_schedule', 'commission_schedule_select_authenticated'),
    ('recovery_config', 'recovery_config_read'), ('training_videos', 'training_videos_select'),
    ('carriers', 'carriers_select'), ('app_settings', 'Everyone reads app settings'),
    ('notification_types', 'Signed-in read notification types'), ('sms_consent_scripts', 'sms_consent_scripts_read'),
    ('team_conversations', 'team_conversations_select'), ('team_messages', 'team_messages_select'),
    ('appointments', 'appointments_closer_select'), ('calls', 'calls_rep_own'), ('calls', 'calls_rep_select'),
    ('clients', 'Closers view clients'), ('commissions', 'commissions_select'),
    ('follow_up_queue', 'fuq_admin_closer_select'), ('no_answer_queue', 'naq_admin_closer_select'),
    ('leads', 'leads_rep_select'), ('messages', 'messages_select_closer_inbox')
  ) as l(tbl, pol)
  left join pg_policies p on p.schemaname = 'public' and p.tablename = l.tbl and p.policyname = l.pol
 order by l.tbl, l.pol;

-- ── b. the lock function and the access answer ──────────────────────────────
select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), true, 'b1 L (nothing bought) is locked');
select is(public.agent_portal_access(), '{"self": true, "servicing": false, "leads": false, "unlocked": false}'::jsonb,
          'b2 L: agent_portal_access says self, no Servicing, no Leads, not unlocked');
select is((select signup_source from public.get_my_profile()), 'self', 'b3 L reads their own signup_source through get_my_profile');
select throws_ok($$ select public.agent_portal_access('5e1f0000-0000-4000-8000-000000000002') $$, '42501', 'Not allowed',
                 'b4 L asking for another agent''s access raises 42501');
select throws_ok($$ select public.agent_portal_access('1a110000-0000-4000-8000-000000000001') $$, '42501', 'Not allowed',
                 'b5 L asking for an invited agent''s access raises 42501');
reset role;

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000004","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), true, 'b6 P (past_due after grace) is locked');
select is((public.agent_portal_access() ->> 'unlocked')::boolean, false, 'b7 P is not unlocked');
reset role;

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), false, 'b8 S (Servicing active) is not locked');
select is(public.agent_portal_access(), '{"self": true, "servicing": true, "leads": false, "unlocked": true}'::jsonb,
          'b9 S: unlocked with Servicing');
select throws_ok($$ select public.agent_portal_access('5e1f0000-0000-4000-8000-000000000001') $$, '42501', 'Not allowed',
                 'b10 S asking for another agent''s access raises 42501 too');
reset role;

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000003","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), false, 'b11 E (Leads only) is not locked');
select is(public.agent_portal_access(), '{"self": true, "servicing": false, "leads": true, "unlocked": true}'::jsonb,
          'b12 E: unlocked with Leads, without Servicing');
reset role;

select set_config('request.jwt.claims', '{"sub":"1a110000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), false, 'b13 an invited agent is never locked, whatever they have bought');
select is((public.agent_portal_access() ->> 'self')::boolean, false, 'b14 an invited agent is not a self-signup');
select throws_ok($$ select public.agent_portal_access('5e1f0000-0000-4000-8000-000000000001') $$, '42501', 'Not allowed',
                 'b15 an invited agent asking for another agent''s access raises 42501');
reset role;

select set_config('request.jwt.claims', '{"sub":"fa110000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), false, 'b16 fulfillment is never locked');
reset role;

select set_config('request.jwt.claims', '{"sub":"ad110000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.is_locked_self_signup(), false, 'b17 an admin is never locked');
select is((public.agent_portal_access() ->> 'unlocked')::boolean, true, 'b18 an admin is unlocked');
select is((public.agent_portal_access('5e1f0000-0000-4000-8000-000000000001') ->> 'unlocked')::boolean, false,
          'b19 an admin can ask about L, and L is not unlocked');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('role', 'anon', true);
select throws_ok($$ select public.agent_portal_access('5e1f0000-0000-4000-8000-000000000001') $$, '42501', null,
                 'b20 a signed-out caller cannot call agent_portal_access');
select throws_ok($$ select public.is_locked_self_signup() $$, '42501', null,
                 'b21 a signed-out caller cannot call is_locked_self_signup');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('role', 'service_role', true);
select is((public.agent_portal_access('5e1f0000-0000-4000-8000-000000000001') ->> 'unlocked')::boolean, false,
          'b22 the service role (the edge functions) can ask about L');
reset role;

-- ── c. the guard trigger: a self-signup cannot unflag itself ────────────────
select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ update public.profiles set signup_source = 'invite' where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c1 L cannot change their own signup_source');
select throws_ok($$ update public.profiles set terms_accepted_at = null where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c2 L cannot clear terms_accepted_at');
select throws_ok($$ update public.profiles set terms_version = 'x' where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c3 L cannot change terms_version');
select throws_ok($$ update public.profiles set leads_status = 'active' where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c4 L cannot give themselves Leads');
select throws_ok($$ update public.profiles set leads_weekly_cents = 1 where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c5 L cannot change leads_weekly_cents');
select throws_ok($$ update public.profiles set billing_status = 'active' where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c6 L cannot mark themselves paid');
select throws_ok($$ update public.profiles set billing_exempt = true where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c7 L cannot comp themselves');
select throws_ok($$ update public.profiles set has_servicing = false where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Only an admin can change that part of a profile', 'c8 L cannot touch has_servicing');
select throws_ok($$ update public.profiles set role = 'admin' where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                 '42501', 'Change role or access from the Users page', 'c9 L cannot make themselves an admin');
select lives_ok($$ update public.profiles set full_name = 'Renamed' where id = '5e1f0000-0000-4000-8000-000000000001' $$,
                'c10 L can still edit their own name (profiles stays open)');
reset role;
select is((select signup_source || '|' || terms_version || '|' || leads_status || '|' || leads_weekly_cents || '|' || billing_status
             from public.profiles where id = '5e1f0000-0000-4000-8000-000000000001'),
          'self|2026-10-30|none|0|none', 'c11 none of those attempts changed the row');

-- ── d. writes: locked, and Leads-only ───────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name)
                    values ('5e1f0000-0000-4000-8000-000000000001', 'No', 'Plan') $$,
                 '42501', 'Choose a plan to unlock your portal.', 'd1 L cannot insert a policy');
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned)
                    values ('5e1f0000-0000-4000-8000-000000000001', 'No', 'Plan', true) $$,
                 '42501', 'Choose a plan to unlock your portal.', 'd2 L cannot submit a deal either');
select throws_ok($$ select public.agent_set_booking_carrier('b00c0000-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-000000000001') $$,
                 '42501', 'Choose a plan to unlock your portal.', 'd3 L cannot change their own policy through an agent RPC (security definer)');
reset role;
select is((select count(*) || '|' || coalesce(min(carrier_name), 'none') from public.policies where agent_id = '5e1f0000-0000-4000-8000-000000000001'), '1|none',
          'd4 nothing of L''s was saved or changed');

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000004","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name)
                    values ('5e1f0000-0000-4000-8000-000000000004', 'Lapsed', 'Plan') $$,
                 '42501', 'Choose a plan to unlock your portal.', 'd5 P (lapsed) cannot insert a policy');
reset role;

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000003","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name)
                    values ('5e1f0000-0000-4000-8000-000000000003', 'Leads', 'Only') $$,
                 '42501', 'Add a Servicing plan to submit deals.', 'd6 E (Leads only, no Servicing) cannot insert a policy');
select throws_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name, fulfillment_assigned)
                    values ('5e1f0000-0000-4000-8000-000000000003', 'Leads', 'Only', true) $$,
                 '42501', 'Add a Servicing plan to submit deals.', 'd7 E cannot book a call either');
reset role;
select is((select count(*) from public.policies where agent_id = '5e1f0000-0000-4000-8000-000000000003'), 0::bigint,
          'd8 nothing of E''s was saved');

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ insert into public.policies (id, agent_id, client_first_name, client_last_name)
                   values ('b00c0000-0000-4000-8000-000000000002', '5e1f0000-0000-4000-8000-000000000002', 'Paid', 'Servicing') $$,
                'd9 S (Servicing active) can insert a policy');
select lives_ok($$ select public.agent_set_booking_carrier('b00c0000-0000-4000-8000-000000000002', 'c0c0c0c0-0000-4000-8000-000000000001') $$,
                'd9b S can change their own policy through the same agent RPC');
reset role;

select set_config('request.jwt.claims', '{"sub":"1a110000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ insert into public.policies (agent_id, client_first_name, client_last_name)
                   values ('1a110000-0000-4000-8000-000000000001', 'Invited', 'Agent') $$,
                'd10 an invited agent can insert a policy');
reset role;

-- The service role (edge functions, cron) and an admin are not stopped by it.
insert into public.policies (agent_id, client_first_name, client_last_name)
values ('5e1f0000-0000-4000-8000-000000000001', 'Service', 'Role');
select is((select count(*) from public.policies where agent_id = '5e1f0000-0000-4000-8000-000000000001'), 2::bigint,
          'd11 a write with no signed-in user (service role, cron) is not blocked');

-- ── e. reads: what a locked account cannot see ──────────────────────────────
select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.sl_rows(c.t), case when c.closed then (case when c.t = 'profiles' then 1 else 0 end)::bigint else c.n end,
          format('e1 L reads %s rows of %s', case when c.closed then (case when c.t = 'profiles' then 'only their own' else 'no' end) else 'all' end, c.t))
  from chk c order by c.t;
select is((select count(*) from public.team_activity()), 0::bigint, 'e2 L gets no rows from team_activity (every agent''s name, photo, bookings)');
select is((select count(*) from public.my_standing_threads() where peer_id is not null), 0::bigint,
          'e3 L sees no Fulfillment person in my_standing_threads');
select is((select count(*) from public.my_standing_threads() where peer_key = 'admin'), 1::bigint,
          'e4 L keeps the thread with admin');
reset role;

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000004","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.sl_rows('commission_schedule') + public.sl_rows('training_videos') + public.sl_rows('clients'), 0::bigint,
          'e5 P (lapsed) is closed out of the same tables');
select is((select count(*) from public.team_activity()), 0::bigint, 'e6 P gets no rows from team_activity');
reset role;

-- ── f. reads: everyone else still sees their normal rows ────────────────────
select set_config('request.jwt.claims', '{"sub":"1a110000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.sl_rows(c.t), c.n, format('f1 an invited agent reads all %s rows of %s', c.n, c.t)) from chk c order by c.t;
select cmp_ok((select count(*) from public.team_activity()), '>=', 1::bigint, 'f2 an invited agent still gets team_activity');
select cmp_ok((select count(*) from public.my_standing_threads() where peer_id is not null), '>=', 1::bigint,
              'f3 an invited agent still sees the Fulfillment people');
reset role;

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.sl_rows(c.t), c.n, format('f4 an unlocked self-signup (Servicing) reads all %s rows of %s', c.n, c.t)) from chk c order by c.t;
select cmp_ok((select count(*) from public.team_activity()), '>=', 1::bigint, 'f5 an unlocked self-signup still gets team_activity');
select cmp_ok((select count(*) from public.my_standing_threads() where peer_id is not null), '>=', 1::bigint,
              'f6 an unlocked self-signup still sees the Fulfillment people');
reset role;

select set_config('request.jwt.claims', '{"sub":"5e1f0000-0000-4000-8000-000000000003","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.sl_rows(c.t), c.n, format('f7 a Leads-only payer reads all %s rows of %s', c.n, c.t)) from chk c order by c.t;
reset role;

select set_config('request.jwt.claims', '{"sub":"ad110000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.sl_rows(c.t), c.n, format('f8 an admin reads all %s rows of %s', c.n, c.t)) from chk c order by c.t;
select cmp_ok((select count(*) from public.team_activity()), '>=', 1::bigint, 'f9 an admin still gets team_activity');
reset role;

select set_config('request.jwt.claims', '{"sub":"fa110000-0000-4000-8000-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.sl_rows('profiles'), (select n from chk where t = 'profiles'), 'f10 fulfillment still reads the whole staff directory');
select is(public.sl_rows('commission_schedule'), (select n from chk where t = 'commission_schedule'), 'f11 fulfillment still reads commission_schedule');
reset role;

select * from finish();
rollback;
