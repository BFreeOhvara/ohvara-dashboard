-- p950_no_live_switches — pgTAP checks for 266_no_live_switches.sql: a signed-in admin cannot change any live flag
-- (texts, portal calls, AI caller, owner payouts, VA payouts, recording, invite texts, sample data, live charging),
-- every route is closed (direct update, the AI caller save, the old live-charging RPC), the other settings still save,
-- and the service role / database owner (CC, with Brayden's yes) can still change them.
--
-- RUN: `npm run test:sql -- supabase/tests/p950_no_live_switches.sql` (PGlite, in memory). Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a9500000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'p950_admin@example.invalid',
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'), jsonb_build_object('full_name', 'Ada Admin'), now(), now());
update public.profiles set role = 'admin', is_active = true where id = 'a9500000-0000-4000-8000-00000000000a';

create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"a9500000-0000-4000-8000-00000000000a","role":"authenticated"}', true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

-- ── a. the starting point: everything off, sample data on ───────────────────────────────────────────────────────────
select pg_temp.as_owner();
insert into public.recovery_config (id) values (true) on conflict do nothing;
insert into public.app_settings (id) values (1) on conflict do nothing;
update public.recovery_config set sms_live = false, voice_live = false, ai_caller_live = false, owner_payouts_live = false,
       payouts_live = false, recording_live = false, invite_sms_live = false;
update public.app_settings set show_sample_data = true;
select is((select count(*)::int from public.recovery_config where sms_live or voice_live or ai_caller_live or owner_payouts_live or payouts_live or recording_live or invite_sms_live), 0, 'a1 every recovery_config live flag is off');
select is((select live_charging from public.billing_settings where id), false, 'a2 live charging is off');
select is((select count(*)::int from pg_trigger where tgname in ('recovery_config_live_guard', 'app_settings_live_guard', 'billing_settings_live_guard') and not tgisinternal), 3, 'a3 the guard is on all three tables');

-- ── b. a signed-in admin cannot change any of them ─────────────────────────────────────────────────────────────────
select pg_temp.as_admin();
select throws_ok($$ update public.recovery_config set sms_live = true $$, '42501', null, 'b1 admin cannot turn texts on');
select throws_ok($$ update public.recovery_config set voice_live = true $$, '42501', null, 'b2 admin cannot turn portal calls on');
select throws_ok($$ update public.recovery_config set ai_caller_live = true $$, '42501', null, 'b3 admin cannot turn the AI caller on');
select throws_ok($$ update public.recovery_config set owner_payouts_live = true $$, '42501', null, 'b4 admin cannot turn owner payouts on');
select throws_ok($$ update public.recovery_config set payouts_live = true $$, '42501', null, 'b5 admin cannot turn VA payouts on');
select throws_ok($$ update public.recovery_config set recording_live = true $$, '42501', null, 'b6 admin cannot turn recording on');
select throws_ok($$ update public.recovery_config set invite_sms_live = true $$, '42501', null, 'b7 admin cannot turn invite texts on');
select throws_ok($$ update public.app_settings set show_sample_data = false $$, '42501', 'The live switches are not changed in the portal. Ohvara turns them on with Brayden''s yes.', 'b8 admin cannot turn sample data off');
select throws_ok($$ update public.billing_settings set live_charging = true $$, '42501', null, 'b9 admin cannot update live charging directly');
select throws_ok($$ select public.admin_billing_live_set(true) $$, '42501', null, 'b10 the old live-charging RPC is closed to admins');
select throws_ok($$ select public.admin_ai_caller_save('{"live": true}'::jsonb) $$, '42501', null, 'b11 the AI caller save cannot flip the switch');

-- ── c. the other settings still save ───────────────────────────────────────────────────────────────────────────────
select lives_ok($$ update public.app_settings set daily_room_url = 'https://example.invalid/room' $$, 'c1 admin can still save the Live Room link');
select lives_ok($$ update public.recovery_config set recording_notice = 'This call may be recorded.' $$, 'c2 admin can still save the recording notice');
select lives_ok($$ select public.admin_ai_caller_save('{"max_call_secs": 300}'::jsonb) $$, 'c3 admin can still save the AI caller settings (no switch)');

-- ── d. nothing moved ───────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_owner();
select is((select count(*)::int from public.recovery_config where sms_live or voice_live or ai_caller_live or owner_payouts_live or payouts_live or recording_live or invite_sms_live), 0, 'd1 every flag is still off');
select is((select show_sample_data from public.app_settings), true, 'd2 sample data is still on');
select is((select live_charging from public.billing_settings where id), false, 'd3 live charging is still off');

-- ── e. CC with Brayden's yes (service role / database owner) still can, and can stop it again ───────────────────────
select pg_temp.as_service();
select lives_ok($$ update public.recovery_config set sms_live = true $$, 'e1 the service role can turn texts on');
select is((select sms_live from public.recovery_config), true, 'e2 and it is on');
select lives_ok($$ update public.recovery_config set sms_live = false $$, 'e3 the emergency stop: one update turns it off');
select lives_ok($$ update public.billing_settings set live_charging = true $$, 'e4 the service role can turn live charging on');
select lives_ok($$ update public.billing_settings set live_charging = false $$, 'e5 and off again, in one step');

select * from finish();
rollback;
