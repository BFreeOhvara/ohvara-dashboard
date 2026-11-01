-- p_agent_settings — pgTAP checks for 197_agent_settings.sql: each agent's time
-- zone, working hours, live-transfer phone, on-duty default and push and email
-- choices, the two functions that read and save them, and the working-hours helper.
--
-- RUN: `npm run test:sql -- supabase/tests/p_agent_settings.sql` (local PGlite) or
-- `supabase test db` on a LOCAL stack only. Everything runs in one transaction that
-- is rolled back. Never run it against Ohvara's live database (jjextitmbptoaolacocs),
-- and never apply migrations to it from here.
--
-- Cast: agents A and B (active), VA V (Fulfillment), deactivated agent D, locked
-- self-signup L, C closed by account_delete, Z admin. H (Chicago) and N (New York)
-- are the helper's agents.

begin;
create extension if not exists pgtap with schema extensions;
select plan(214);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into public.pending_signups (email, role, source, terms_version, terms_accepted_at)
values ('p_agent_settings_locked@example.invalid', 'agent', 'self', '2026-10-30', now());

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_agent_settings_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('a9700000-0000-4000-8000-00000000000a'::uuid, 'agent_a',  'agent'),
    ('a9700000-0000-4000-8000-00000000000b'::uuid, 'agent_b',  'agent'),
    ('a9700000-0000-4000-8000-00000000000f'::uuid, 'va_v',     'fulfillment'),
    ('a9700000-0000-4000-8000-00000000000d'::uuid, 'agent_d',  'agent'),
    ('a9700000-0000-4000-8000-000000000001'::uuid, 'locked',   'agent'),
    ('a9700000-0000-4000-8000-00000000000c'::uuid, 'agent_c',  'agent'),
    ('a9700000-0000-4000-8000-000000000002'::uuid, 'agent_h',  'agent'),
    ('a9700000-0000-4000-8000-000000000003'::uuid, 'agent_n',  'agent'),
    ('a9700000-0000-4000-8000-000000000009'::uuid, 'admin_z',  'agent')
  ) as u(id, n, role);

update public.profiles set is_active = true where id::text like 'a9700000-%';
update public.profiles set role = 'admin' where id = 'a9700000-0000-4000-8000-000000000009';
update public.profiles set is_active = false where id = 'a9700000-0000-4000-8000-00000000000d';
update public.profiles set timezone = 'America/Chicago' where id = 'a9700000-0000-4000-8000-000000000002';
update public.profiles set timezone = 'America/New_York' where id = 'a9700000-0000-4000-8000-000000000003';

-- Everything a save can change, as text, read past RLS.
create function public.pas_state(p_agent uuid) returns text
language sql stable security definer set search_path = public as $f$
  select jsonb_build_object(
    'tz', p.timezone, 'stamp', p.timezone_confirmed_at, 'phone', p.live_transfer_phone,
    'default', p.on_duty_default, 'prefs', p.notification_prefs,
    'hours', (select jsonb_agg(h order by h.weekday) from agent_working_hours h where h.agent_id = p.id))::text
  from profiles p where p.id = p_agent
$f$;
grant execute on function public.pas_state(uuid) to authenticated;

-- A save that should be refused, as whoever is signed in: 'errcode|same' when
-- nothing changed, 'saved' when it wasn't refused.
create function public.pas_try(p jsonb) returns text language plpgsql as $f$
declare
  v_before text := public.pas_state(auth.uid());
  v_state  text;
begin
  begin
    perform public.save_my_agent_settings(p);
    return 'saved';
  exception when others then
    v_state := sqlstate;
  end;
  return v_state || '|' || case when public.pas_state(auth.uid()) is not distinct from v_before then 'same' else 'CHANGED' end;
end
$f$;
grant execute on function public.pas_try(jsonb) to authenticated;

-- One type's field out of a settings document.
create function public.pas_pick(doc jsonb, t text, f text) returns text language sql immutable as $f$
  select n ->> f from jsonb_array_elements(doc -> 'notifications') n where n ->> 'type' = t
$f$;
grant execute on function public.pas_pick(jsonb, text, text) to authenticated;

-- For one type: flip email, then flip push. Each must change alone, and no other type may move.
create function public.pas_indep(t text) returns text language plpgsql as $f$
declare
  v_before jsonb := public.my_agent_settings();
  v_after  jsonb;
  v_rest   jsonb;
  v_on     boolean;
begin
  select jsonb_agg(n) into v_rest from jsonb_array_elements(v_before -> 'notifications') n where n ->> 'type' <> t;

  v_on := not public.pas_pick(v_before, t, 'email_on')::boolean;
  v_after := public.save_my_agent_settings(jsonb_build_object('notifications', jsonb_build_array(jsonb_build_object('type', t, 'email', v_on))));
  if public.pas_pick(v_after, t, 'email_on')::boolean <> v_on then return 'email did not change'; end if;
  if public.pas_pick(v_after, t, 'push_on') <> public.pas_pick(v_before, t, 'push_on') then return 'email moved push'; end if;
  if (select jsonb_agg(n) from jsonb_array_elements(v_after -> 'notifications') n where n ->> 'type' <> t) <> v_rest then return 'email moved another type'; end if;

  v_before := v_after;
  v_on := not public.pas_pick(v_before, t, 'push_on')::boolean;
  v_after := public.save_my_agent_settings(jsonb_build_object('notifications', jsonb_build_array(jsonb_build_object('type', t, 'push', v_on))));
  if public.pas_pick(v_after, t, 'push_on')::boolean <> v_on then return 'push did not change'; end if;
  if public.pas_pick(v_after, t, 'email_on') <> public.pas_pick(v_before, t, 'email_on') then return 'push moved email'; end if;
  if (select jsonb_agg(n) from jsonb_array_elements(v_after -> 'notifications') n where n ->> 'type' <> t) <> v_rest then return 'push moved another type'; end if;
  return 'ok';
end
$f$;
grant execute on function public.pas_indep(text) to authenticated;

-- Replaces a helper agent's week with one range (owner, no signed-in user).
create function public.pas_hours(p_agent uuid, p_day int, p_start time, p_end time) returns void language plpgsql as $f$
begin
  delete from public.agent_working_hours where agent_id = p_agent;
  insert into public.agent_working_hours (agent_id, weekday, start_time, end_time) values (p_agent, p_day, p_start, p_end);
end
$f$;

select set_config('pas.sent_before', (select count(*)::text from net.http_request_queue), true);

-- ── a. The shape ────────────────────────────────────────────────────────────
select is((select jsonb_object_agg(type, label || '|' || sort) from public.notification_types
            where type in ('new_lead', 'live_call_ringing', 'appointment_1h', 'request_done')),
          '{"new_lead":"New lead|60","live_call_ringing":"Live call ringing|61","appointment_1h":"Appointment in 1 hour|62","request_done":"Request done|63"}'::jsonb,
          'a1 the four new types have their labels and sort');
select is((select count(*) from public.notification_types
            where type in ('new_lead', 'live_call_ringing', 'appointment_1h', 'request_done')
              and roles = '{agent}' and not email_default and email_via = 'notify' and in_bell and push and not money and not fires),
          4::bigint, 'a2 all four: agent, email off, via notify, bell, push, not money, not firing');
select is((select count(*) from public.notification_types
            where (type = 'needs_attention' and fires and email_via = 'notify' and not email_default and not push and sort = 14)
               or (type = 'payment_failed' and fires and email_via = 'notify' and email_default and push and money and sort = 16)),
          2::bigint, 'a3 the two reused types are as 146 left them');
select ok(exists (select 1 from pg_timezone_names where name = 'America/Chicago')
          and exists (select 1 from pg_timezone_names where name = 'America/New_York'),
          'a4 pg_timezone_names resolves both zones here');
select is(((timestamptz '2026-03-08 14:00:00+00' at time zone 'America/Chicago')::text
           || ' ' || (timestamptz '2026-03-01 15:00:00+00' at time zone 'America/Chicago')::text),
          '2026-03-08 09:00:00 2026-03-01 09:00:00', 'a5 the zone data knows the DST change');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=public']) from pg_proc
            where oid in ('public.agent_settings_types()'::regprocedure, 'public.my_agent_settings()'::regprocedure,
                          'public.save_my_agent_settings(jsonb)'::regprocedure,
                          'public.agent_in_working_hours(uuid, timestamptz)'::regprocedure)),
          'a6 every new function is security definer with search_path = public');
select ok((select relrowsecurity from pg_class where oid = 'public.agent_working_hours'::regclass),
          'a7 agent_working_hours has RLS on');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.agent_working_hours'::regclass and tgname = 'a0_block_inactive_writer'),
          'a8 agent_working_hours has the a0_block_inactive_writer trigger');
select throws_ok($$ insert into public.agent_working_hours values ('a9700000-0000-4000-8000-000000000002', 1, '22:00', '02:00') $$,
          '23514', null::text, 'a9 an overnight range cannot be stored');
select throws_ok($$ insert into public.agent_working_hours values ('a9700000-0000-4000-8000-000000000002', 8, '09:00', '17:00') $$,
          '23514', null::text, 'a10 weekday 8 cannot be stored');

-- Nothing saved yet: the registry's defaults.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is(public.my_agent_settings(),
  '{"timezone":"America/Chicago","working_hours":[],"live_transfer_phone":null,"on_duty_default":false,"notifications":[
    {"type":"new_lead","label":"New lead","fires":false,"email_on":false,"push_on":true},
    {"type":"live_call_ringing","label":"Live call ringing","fires":false,"email_on":false,"push_on":true},
    {"type":"appointment_1h","label":"Appointment in 1 hour","fires":false,"email_on":false,"push_on":true},
    {"type":"needs_attention","label":"Clients that need attention (daily)","fires":true,"email_on":false,"push_on":false},
    {"type":"request_done","label":"Request done","fires":false,"email_on":false,"push_on":true},
    {"type":"payment_failed","label":"Weekly payment failed","fires":true,"email_on":true,"push_on":true}]}'::jsonb,
  'a11 a fresh agent reads the registry defaults, all six types, no hours');
select is((select count(*) from public.my_notification_settings()
            where type in ('new_lead', 'live_call_ringing', 'appointment_1h', 'request_done')), 0::bigint,
          'a12 today''s Settings list does not gain the new types');
select is((select count(*) from public.my_notification_settings() where type in ('needs_attention', 'payment_failed')), 2::bigint,
          'a13 today''s Settings list still has the reused types');
select lives_ok($$ select public.set_notification_email('new_lead', true) $$,
          'a14 set_notification_email accepts a new type (email_via is notify)');
select is(public.pas_pick(public.my_agent_settings(), 'new_lead', 'email_on'), 'true',
          'a15 and my_agent_settings reads it back');
select public.set_notification_email('new_lead', false);
reset role;

-- ── b. Round trip ───────────────────────────────────────────────────────────
update public.profiles set phone = '+15125550100' where id = 'a9700000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is(public.my_agent_settings() -> 'live_transfer_phone', 'null'::jsonb,
          'b1 no fallback from live_transfer_phone to profiles.phone');
create temp table pas_saved on commit drop as
select public.save_my_agent_settings('{
  "timezone":"America/New_York",
  "working_hours":[
    {"weekday":7,"start":"10:00","end":"12:00"},
    {"weekday":1,"start":"09:00","end":"17:00"},
    {"weekday":2,"start":"09:30","end":"17:30"},
    {"weekday":3,"start":"00:00","end":"24:00"},
    {"weekday":4,"start":"08:15","end":"16:45"},
    {"weekday":5,"start":"22:00","end":"24:00"},
    {"weekday":6,"start":"11:00","end":"11:01"}],
  "live_transfer_phone":"+15125550101",
  "on_duty_default":true,
  "notifications":[
    {"type":"new_lead","email":true,"push":false},
    {"type":"live_call_ringing","email":true,"push":false},
    {"type":"appointment_1h","email":true,"push":false},
    {"type":"needs_attention","email":true,"push":true},
    {"type":"request_done","email":true,"push":false},
    {"type":"payment_failed","email":false,"push":false}]
}'::jsonb) as doc;
select is(public.my_agent_settings(),
  '{"timezone":"America/New_York",
    "working_hours":[
      {"weekday":1,"start":"09:00","end":"17:00"},
      {"weekday":2,"start":"09:30","end":"17:30"},
      {"weekday":3,"start":"00:00","end":"24:00"},
      {"weekday":4,"start":"08:15","end":"16:45"},
      {"weekday":5,"start":"22:00","end":"24:00"},
      {"weekday":6,"start":"11:00","end":"11:01"},
      {"weekday":7,"start":"10:00","end":"12:00"}],
    "live_transfer_phone":"+15125550101",
    "on_duty_default":true,
    "notifications":[
      {"type":"new_lead","label":"New lead","fires":false,"email_on":true,"push_on":false},
      {"type":"live_call_ringing","label":"Live call ringing","fires":false,"email_on":true,"push_on":false},
      {"type":"appointment_1h","label":"Appointment in 1 hour","fires":false,"email_on":true,"push_on":false},
      {"type":"needs_attention","label":"Clients that need attention (daily)","fires":true,"email_on":true,"push_on":true},
      {"type":"request_done","label":"Request done","fires":false,"email_on":true,"push_on":false},
      {"type":"payment_failed","label":"Weekly payment failed","fires":true,"email_on":false,"push_on":false}]}'::jsonb,
  'b2 a full save reads back: zone, seven days including a 24:00 end, phone, default, six email and push values');
select is((select doc from pas_saved), public.my_agent_settings(), 'b3 the save returns the same shape as the read');

select is((public.save_my_agent_settings('{"on_duty_default":false}'::jsonb) - 'on_duty_default'),
          ((select doc from pas_saved) - 'on_duty_default'), 'b4 a partial save leaves every other field alone');
select is(public.my_agent_settings() -> 'on_duty_default', 'false'::jsonb, 'b5 and changes the field it names');
select is(public.save_my_agent_settings('{}'::jsonb), public.my_agent_settings(), 'b6 an empty save changes nothing');

select is(public.save_my_agent_settings('{"working_hours":[{"weekday":2,"start":"10:00","end":"11:00"}]}'::jsonb) -> 'working_hours',
          '[{"weekday":2,"start":"10:00","end":"11:00"}]'::jsonb, 'b7 a working_hours save replaces the whole week');
select is(public.my_agent_settings() -> 'live_transfer_phone', '"+15125550101"'::jsonb, 'b8 the hours save left the phone alone');
reset role;
select ok(public.agent_in_working_hours('a9700000-0000-4000-8000-00000000000a', '2026-03-03 15:30:00+00'),
          'b9 the listed day is open (Tuesday 10:30 AM New York)');
select ok(not public.agent_in_working_hours('a9700000-0000-4000-8000-00000000000a', '2026-03-02 15:30:00+00'),
          'b10 an unlisted day is closed (Monday 10:30 AM New York)');
set local role authenticated;
select is(public.save_my_agent_settings('{"working_hours":[]}'::jsonb) -> 'working_hours', '[]'::jsonb, 'b11 [] closes every day');
select is(public.save_my_agent_settings('{"live_transfer_phone":null}'::jsonb) -> 'live_transfer_phone', 'null'::jsonb, 'b12 JSON null clears the phone');
reset role;
select is((select live_transfer_phone from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), null::text,
          'b13 the column is null');
select is((select phone from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), '+15125550100',
          'b14 profiles.phone was never touched');

-- ── c. Isolation ────────────────────────────────────────────────────────────
update public.profiles set live_transfer_phone = '+15125550202', on_duty_default = true,
       notification_prefs = '{"email":{"new_lead":true},"push_types":{"new_lead":false}}'
 where id = 'a9700000-0000-4000-8000-00000000000b';
select set_config('request.jwt.claims', '', true);
insert into public.agent_working_hours values ('a9700000-0000-4000-8000-00000000000b', 1, '08:00', '09:00');
insert into public.agent_working_hours values ('a9700000-0000-4000-8000-00000000000a', 1, '06:00', '07:00');
select set_config('pas.b', public.pas_state('a9700000-0000-4000-8000-00000000000b'), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is((public.my_agent_settings() ->> 'live_transfer_phone'), null::text, 'c1 A''s read shows A''s phone, not B''s');
select is((public.my_agent_settings() -> 'working_hours' -> 0 ->> 'start'), '06:00', 'c2 A''s read shows A''s hours, not B''s');
select is((public.save_my_agent_settings('{"live_transfer_phone":"+15125550303","working_hours":[{"weekday":1,"start":"06:00","end":"07:00"}],"on_duty_default":false,"notifications":[{"type":"new_lead","email":false,"push":true}]}'::jsonb) ->> 'live_transfer_phone'),
          '+15125550303', 'c3 A saves');
select is(public.pas_state('a9700000-0000-4000-8000-00000000000b'), current_setting('pas.b'), 'c4 A''s save did not touch B');
with u as (update public.profiles set live_transfer_phone = '+15125550999' where id = 'a9700000-0000-4000-8000-00000000000b' returning 1)
select is(count(*), 0::bigint, 'c5 A updating B''s live_transfer_phone changes 0 rows') from u;
select is(public.pas_state('a9700000-0000-4000-8000-00000000000b'), current_setting('pas.b'), 'c6 B is still the same after that');
select throws_ok($$ select live_transfer_phone from public.profiles where id = 'a9700000-0000-4000-8000-00000000000b' $$,
          '42501', null::text, 'c7 A cannot select B''s live_transfer_phone');
select throws_ok($$ select on_duty_default from public.profiles where id = 'a9700000-0000-4000-8000-00000000000b' $$,
          '42501', null::text, 'c8 A cannot select B''s on_duty_default');
select throws_ok($$ select live_transfer_phone from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a' $$,
          '42501', null::text, 'c9 A cannot select their own live_transfer_phone directly');
select throws_ok($$ select on_duty_default from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a' $$,
          '42501', null::text, 'c10 A cannot select their own on_duty_default directly');
select throws_ok($$ insert into public.agent_working_hours values ('a9700000-0000-4000-8000-00000000000a', 2, '09:00', '10:00') $$,
          '42501', null::text, 'c11 A cannot insert their own hours directly');
select throws_ok($$ insert into public.agent_working_hours values ('a9700000-0000-4000-8000-00000000000b', 2, '09:00', '10:00') $$,
          '42501', null::text, 'c12 A cannot insert B''s hours');
select throws_ok($$ update public.agent_working_hours set end_time = '23:00' where agent_id = 'a9700000-0000-4000-8000-00000000000a' $$,
          '42501', null::text, 'c13 A cannot update their own hours directly');
select throws_ok($$ update public.agent_working_hours set end_time = '23:00' where agent_id = 'a9700000-0000-4000-8000-00000000000b' $$,
          '42501', null::text, 'c14 A cannot update B''s hours');
select throws_ok($$ delete from public.agent_working_hours where agent_id = 'a9700000-0000-4000-8000-00000000000a' $$,
          '42501', null::text, 'c15 A cannot delete their own hours directly');
select throws_ok($$ delete from public.agent_working_hours where agent_id = 'a9700000-0000-4000-8000-00000000000b' $$,
          '42501', null::text, 'c16 A cannot delete B''s hours');
select is((select count(*) from public.agent_working_hours where agent_id = 'a9700000-0000-4000-8000-00000000000b'), 0::bigint,
          'c17 A cannot select B''s hours');
select is((select count(*) from public.agent_working_hours where agent_id = 'a9700000-0000-4000-8000-00000000000a'), 1::bigint,
          'c18 A can select their own hours');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select is((select count(*) from public.agent_working_hours), 0::bigint, 'c19 a VA reads no hours directly');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select is((select count(*) from public.agent_working_hours where agent_id in ('a9700000-0000-4000-8000-00000000000a', 'a9700000-0000-4000-8000-00000000000b')),
          2::bigint, 'c20 an admin reads every agent''s hours');
select throws_ok($$ select public.my_agent_settings() $$, '42501', null::text, 'c21 an admin has no agent settings to read');
select is(public.pas_try('{"on_duty_default":true}'), '42501|same', 'c22 an admin cannot save agent settings');
reset role;

-- ── d. Grants ───────────────────────────────────────────────────────────────
select ok(not has_table_privilege('anon', 'public.agent_working_hours', 'select,insert,update,delete,truncate,references,trigger'),
          'd1 anon has nothing on agent_working_hours');
select ok(has_table_privilege('authenticated', 'public.agent_working_hours', 'select'),
          'd2 authenticated can select agent_working_hours');
select ok(not has_table_privilege('authenticated', 'public.agent_working_hours', 'insert,update,delete,truncate,references,trigger'),
          'd3 authenticated has nothing else on agent_working_hours');
select ok(not has_function_privilege('public', 'public.agent_in_working_hours(uuid, timestamptz)', 'execute'), 'd4 public cannot run agent_in_working_hours');
select ok(not has_function_privilege('anon', 'public.agent_in_working_hours(uuid, timestamptz)', 'execute'), 'd5 anon cannot run agent_in_working_hours');
select ok(not has_function_privilege('authenticated', 'public.agent_in_working_hours(uuid, timestamptz)', 'execute'), 'd6 authenticated cannot run agent_in_working_hours');
select ok(has_function_privilege('service_role', 'public.agent_in_working_hours(uuid, timestamptz)', 'execute'), 'd7 service_role can run agent_in_working_hours');
select ok(not has_function_privilege('public', 'public.my_agent_settings()', 'execute'), 'd8 public cannot run my_agent_settings');
select ok(not has_function_privilege('anon', 'public.my_agent_settings()', 'execute'), 'd9 anon cannot run my_agent_settings');
select ok(not has_function_privilege('service_role', 'public.my_agent_settings()', 'execute'), 'd10 service_role cannot run my_agent_settings');
select ok(has_function_privilege('authenticated', 'public.my_agent_settings()', 'execute'), 'd11 authenticated can run my_agent_settings');
select ok(not has_function_privilege('public', 'public.save_my_agent_settings(jsonb)', 'execute'), 'd12 public cannot run save_my_agent_settings');
select ok(not has_function_privilege('anon', 'public.save_my_agent_settings(jsonb)', 'execute'), 'd13 anon cannot run save_my_agent_settings');
select ok(not has_function_privilege('service_role', 'public.save_my_agent_settings(jsonb)', 'execute'), 'd14 service_role cannot run save_my_agent_settings');
select ok(has_function_privilege('authenticated', 'public.save_my_agent_settings(jsonb)', 'execute'), 'd15 authenticated can run save_my_agent_settings');
select ok(not has_function_privilege('public', 'public.agent_settings_types()', 'execute'), 'd16 public cannot run the private six-types function');
select ok(not has_function_privilege('anon', 'public.agent_settings_types()', 'execute'), 'd17 anon cannot run the private six-types function');
select ok(not has_function_privilege('authenticated', 'public.agent_settings_types()', 'execute'), 'd18 authenticated cannot run the private six-types function');
select ok(not has_function_privilege('authenticated', 'public.account_delete(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.account_delete(uuid)', 'execute')
          and not has_function_privilege('public', 'public.account_delete(uuid)', 'execute'), 'd19 account_delete stays closed to the browser');
select ok(has_function_privilege('service_role', 'public.account_delete(uuid)', 'execute'), 'd20 service_role can run account_delete');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'live_transfer_phone', 'select')
          and not has_column_privilege('authenticated', 'public.profiles', 'on_duty_default', 'select'),
          'd21 neither new column joined the 112 select grant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.agent_in_working_hours('a9700000-0000-4000-8000-00000000000b', now()) $$,
          '42501', null::text, 'd22 A cannot probe B''s hours through the helper');
select throws_ok($$ select public.agent_settings_types() $$, '42501', null::text, 'd23 A cannot run the private six-types function');
reset role;

-- ── e. account_delete ───────────────────────────────────────────────────────
update public.profiles set live_transfer_phone = '+15125550404', on_duty_default = true, timezone = 'America/Denver',
       notification_prefs = '{"email":{"new_lead":true},"push_types":{"new_lead":false},"push":false}'
 where id = 'a9700000-0000-4000-8000-00000000000c';
select set_config('request.jwt.claims', '', true);
insert into public.agent_working_hours values
  ('a9700000-0000-4000-8000-00000000000c', 1, '09:00', '17:00'),
  ('a9700000-0000-4000-8000-00000000000c', 2, '09:00', '17:00');
select is(public.account_delete('a9700000-0000-4000-8000-00000000000c') ->> 'deleted', 'true', 'e1 account_delete closes C');
select is((select count(*) from public.agent_working_hours where agent_id = 'a9700000-0000-4000-8000-00000000000c'), 0::bigint,
          'e2 C''s working hours are gone');
select is((select live_transfer_phone from public.profiles where id = 'a9700000-0000-4000-8000-00000000000c'), null::text,
          'e3 C''s live-transfer phone is gone');
select is((select on_duty_default from public.profiles where id = 'a9700000-0000-4000-8000-00000000000c'), false,
          'e4 C''s on-duty default is off');
select is((select notification_prefs from public.profiles where id = 'a9700000-0000-4000-8000-00000000000c'), '{}'::jsonb,
          'e5 C''s notification choices are gone');
select is((select timezone from public.profiles where id = 'a9700000-0000-4000-8000-00000000000c'), 'America/Denver',
          'e6 C''s time zone stays as it is today');
select ok((select not is_active and deleted_at is not null and full_name = 'Deleted user' and phone is null
             from public.profiles where id = 'a9700000-0000-4000-8000-00000000000c'),
          'e7 the rest of account_delete still ran');
select is(public.account_delete('a9700000-0000-4000-8000-00000000000c') ->> 'already', 'true', 'e8 a second call says already');

-- ── f. Who can save ─────────────────────────────────────────────────────────
-- Closed account: the leftover session.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select is(public.pas_try('{"live_transfer_phone":"+15125550405","working_hours":[{"weekday":1,"start":"09:00","end":"17:00"}]}'),
          '42501|same', 'f1 a closed account''s leftover session cannot put the phone and hours back');
select throws_ok($$ select public.my_agent_settings() $$, '42501', null::text, 'f2 a closed account cannot read');
reset role;

-- Closed with is_active turned back on by mistake: deleted_at alone still stops it.
update public.profiles set is_active = true where id = 'a9700000-0000-4000-8000-00000000000c';
set local role authenticated;
select is(public.pas_try('{"on_duty_default":true}'), '42501|same', 'f3 deleted_at alone refuses a save');
select throws_ok($$ select public.my_agent_settings() $$, '42501', null::text, 'f4 deleted_at alone refuses a read');
reset role;
update public.profiles set is_active = false where id = 'a9700000-0000-4000-8000-00000000000c';

-- Deactivated.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
select is(public.pas_try('{"timezone":"America/Denver","live_transfer_phone":"+15125550406"}'), '42501|same', 'f5 a deactivated agent cannot save');
select throws_ok($$ select public.my_agent_settings() $$, '42501', null::text, 'f6 a deactivated agent cannot read');
reset role;

-- Fulfillment.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select is(public.pas_try('{"timezone":"America/Denver","on_duty_default":true}'), '42501|same', 'f7 a fulfillment rep cannot save');
select throws_ok($$ select public.my_agent_settings() $$, '42501', null::text, 'f8 a fulfillment rep cannot read');
reset role;

-- Locked self-signup: reads its own, saves nothing.
select is((select signup_source from public.profiles where id = 'a9700000-0000-4000-8000-000000000001'), 'self',
          'f9 L is a self-signup');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(public.is_locked_self_signup(), 'f10 L is locked');
select is(public.my_agent_settings() ->> 'timezone', 'America/Chicago', 'f11 a locked self-signup can read its own settings');
select is(public.pas_try('{"timezone":"America/Denver","on_duty_default":true}'), '42501|same', 'f12 a locked self-signup cannot save');
select throws_ok($$ select public.save_my_agent_settings('{"on_duty_default":true}'::jsonb) $$,
          '42501', 'Choose a plan to unlock your portal.', 'f13 and is told to choose a plan');
reset role;
update public.profiles set billing_status = 'active' where id = 'a9700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.save_my_agent_settings('{"on_duty_default":true}'::jsonb) ->> 'on_duty_default', 'true',
          'f14 the same agent can save once they have a plan');
reset role;

-- Signed out.
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.my_agent_settings() $$, '42501', 'Not signed in', 'f15 a signed-out read is refused');
select throws_ok($$ select public.save_my_agent_settings('{"on_duty_default":true}'::jsonb) $$, '42501', 'Not signed in', 'f16 a signed-out save is refused');
reset role;
set local role anon;
select throws_ok($$ select public.my_agent_settings() $$, '42501', null::text, 'f17 anon cannot read');
select throws_ok($$ select public.save_my_agent_settings('{"on_duty_default":true}'::jsonb) $$, '42501', null::text, 'f18 anon cannot save');
reset role;

-- ── g. The helper ───────────────────────────────────────────────────────────
-- H is America/Chicago, N is America/New_York. As the owner, no signed-in user.
select pas_hours('a9700000-0000-4000-8000-000000000002', 1, '09:00', '17:00');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 18:00:00+00'), true, 'g1 inside (Monday noon Chicago)');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 14:59:00+00'), false, 'g2 outside (Monday 8:59 AM)');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 15:00:00+00'), true, 'g3 exact start is true');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 23:00:00+00'), false, 'g4 exact end is false');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-03 18:00:00+00'), false, 'g5 a closed day is false');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000003', '2026-03-02 18:00:00+00'), false, 'g6 no hours is false');
select is(public.agent_in_working_hours('00000000-0000-4000-8000-000000000000', '2026-03-02 18:00:00+00'), false, 'g7 an unknown agent is false');
select is(public.agent_in_working_hours(null, '2026-03-02 18:00:00+00'), false, 'g8 a null agent is false');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', null), false, 'g9 a null time is false');

-- DST: Chicago, Sunday 09:00-17:00.
select pas_hours('a9700000-0000-4000-8000-000000000002', 7, '09:00', '17:00');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-08 13:59:59+00'), false, 'g10 spring-forward Sunday, 8:59:59 AM CDT');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-08 14:00:00+00'), true,  'g11 spring-forward Sunday, 9:00 AM CDT');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-08 21:59:59+00'), true,  'g12 spring-forward Sunday, 4:59:59 PM CDT');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-08 22:00:00+00'), false, 'g13 spring-forward Sunday, 5:00 PM CDT');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-01 15:00:00+00'), true,  'g14 the Sunday before, 9:00 AM CST');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-01 14:30:00+00'), false, 'g15 the Sunday before, 8:30 AM CST');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-11-01 15:00:00+00'), true,  'g16 fall-back Sunday, 9:00 AM CST');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-11-01 14:30:00+00'), false, 'g17 fall-back Sunday, 8:30 AM CST');

-- A second zone, same instant.
select pas_hours('a9700000-0000-4000-8000-000000000003', 7, '09:00', '17:00');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000003', '2026-03-08 13:30:00+00'), true,  'g18 New York: 9:30 AM, working');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-08 13:30:00+00'), false, 'g19 Chicago: 8:30 AM, same hours, same instant, not working');

-- The hour that happens twice.
select pas_hours('a9700000-0000-4000-8000-000000000002', 7, '01:00', '02:00');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-11-01 06:30:00+00'), true,  'g20 repeated hour, first 1:30 AM');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-11-01 07:30:00+00'), true,  'g21 repeated hour, second 1:30 AM');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-11-01 08:00:00+00'), false, 'g22 repeated hour, 2:00 AM CST');

-- The hour that never happens.
select pas_hours('a9700000-0000-4000-8000-000000000002', 7, '02:00', '03:00');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-08 07:59:59+00'), false, 'g23 skipped hour, 1:59:59 AM CST');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-08 08:00:00+00'), false, 'g24 skipped hour, 3:00 AM CDT');

-- The weekday comes from the local date: Sunday 11 PM Chicago is Monday in UTC.
select pas_hours('a9700000-0000-4000-8000-000000000002', 7, '22:00', '24:00');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-11-02 05:00:00+00'), true, 'g25 Sunday 11 PM Chicago with Monday closed');
select pas_hours('a9700000-0000-4000-8000-000000000002', 1, '00:00', '24:00');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-11-02 05:00:00+00'), false, 'g26 Monday open all day, Sunday closed: still Sunday in Chicago');

-- A zone that can be changed directly is never trusted. Open all week, so only the zone can say no.
delete from public.agent_working_hours where agent_id = 'a9700000-0000-4000-8000-000000000002';
insert into public.agent_working_hours (agent_id, weekday, start_time, end_time)
select 'a9700000-0000-4000-8000-000000000002', d, '00:00', '24:00' from generate_series(1, 7) d;
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 18:00:00+00'), true, 'g27 open all week in a real zone');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-000000000002","role":"authenticated"}', true);
update public.profiles set timezone = 'Foo3' where id = 'a9700000-0000-4000-8000-000000000002';
reset role;
select set_config('request.jwt.claims', '', true);
select is((select timezone from public.profiles where id = 'a9700000-0000-4000-8000-000000000002'), 'Foo3', 'g28 an agent can write a bad zone directly');
select ok((timestamptz '2026-03-02 18:00:00+00' at time zone 'Foo3') is not null, 'g29 AT TIME ZONE accepts Foo3, so trying it is no check');
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 18:00:00+00'), false, 'g30 the POSIX-style Foo3 is false');
update public.profiles set timezone = 'Mars/Base' where id = 'a9700000-0000-4000-8000-000000000002';
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 18:00:00+00'), false, 'g31 Mars/Base is false');
update public.profiles set timezone = '' where id = 'a9700000-0000-4000-8000-000000000002';
select is(public.agent_in_working_hours('a9700000-0000-4000-8000-000000000002', '2026-03-02 18:00:00+00'), false, 'g32 an empty zone is false');

-- ── h. Refused, with nothing saved ──────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is(public.pas_try('{"timezone":"Mars/Base"}'), '22023|same', 'h1 zone Mars/Base');
select is(public.pas_try('{"timezone":"Foo3"}'), '22023|same', 'h2 zone Foo3');
select is(public.pas_try('{"timezone":""}'), '22023|same', 'h3 empty zone');
select is(public.pas_try('{"timezone":null}'), '22023|same', 'h4 null zone');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"17:00","end":"09:00"}]}'), '22023|same', 'h5 start after end');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"09:00","end":"09:00"}]}'), '22023|same', 'h6 start equal to end');
select throws_ok($$ select public.save_my_agent_settings('{"working_hours":[{"weekday":1,"start":"22:00","end":"02:00"}]}'::jsonb) $$,
          '22023', 'Hours must end after they start. Overnight hours aren''t allowed.', 'h7 the message says overnight hours aren''t allowed');
select is(public.pas_try('{"working_hours":[{"weekday":0,"start":"09:00","end":"17:00"}]}'), '22023|same', 'h8 weekday 0');
select is(public.pas_try('{"working_hours":[{"weekday":8,"start":"09:00","end":"17:00"}]}'), '22023|same', 'h9 weekday 8');
select is(public.pas_try('{"working_hours":[{"weekday":1.5,"start":"09:00","end":"17:00"}]}'), '22023|same', 'h10 weekday 1.5');
select is(public.pas_try('{"working_hours":[{"weekday":"1","start":"09:00","end":"17:00"}]}'), '22023|same', 'h11 weekday as a string');
select is(public.pas_try('{"working_hours":[{"start":"09:00","end":"17:00"}]}'), '22023|same', 'h12 no weekday');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":1,"start":"18:00","end":"19:00"}]}'), '22023|same', 'h13 duplicate weekday');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"9:00","end":"17:00"}]}'), '22023|same', 'h14 time not HH:MM');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"09:00:00","end":"17:00"}]}'), '22023|same', 'h15 time with seconds');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"24:00","end":"24:00"}]}'), '22023|same', 'h16 start of 24:00');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"09:00","end":"24:01"}]}'), '22023|same', 'h17 end of 24:01');
select is(public.pas_try('{"working_hours":[{"weekday":1,"start":"09:00"}]}'), '22023|same', 'h18 no end');
select is(public.pas_try('{"working_hours":{"weekday":1}}'), '22023|same', 'h19 working_hours not an array');
select is(public.pas_try('{"working_hours":null}'), '22023|same', 'h20 working_hours null');
select is(public.pas_try('{"working_hours":[7]}'), '22023|same', 'h21 a day that is not an object');
select is(public.pas_try('{"live_transfer_phone":"5125551234"}'), '22023|same', 'h22 phone 5125551234');
select is(public.pas_try('{"live_transfer_phone":""}'), '22023|same', 'h23 empty phone');
select is(public.pas_try('{"live_transfer_phone":15125551234}'), '22023|same', 'h24 phone as a number');
select is(public.pas_try('{"on_duty_default":"true"}'), '22023|same', 'h25 default as a string');
select is(public.pas_try('{"on_duty_default":null}'), '22023|same', 'h26 default null');
select is(public.pas_try('{"notifications":[{"type":"made_up","email":true}]}'), '22023|same', 'h27 made-up notification type');
select is(public.pas_try('{"notifications":[{"type":"paid","email":true}]}'), '22023|same', 'h28 type paid');
select is(public.pas_try('{"notifications":[{"type":"message","push":true}]}'), '22023|same', 'h29 type message');
select is(public.pas_try('{"notifications":[{"email":true}]}'), '22023|same', 'h30 no type');
select is(public.pas_try('{"notifications":[{"type":"new_lead","email":"yes"}]}'), '22023|same', 'h31 non-boolean email');
select is(public.pas_try('{"notifications":[{"type":"new_lead","push":1}]}'), '22023|same', 'h32 non-boolean push');
select is(public.pas_try('{"notifications":[{"type":"new_lead","email":null}]}'), '22023|same', 'h33 null email');
select is(public.pas_try('{"notifications":{"type":"new_lead"}}'), '22023|same', 'h34 notifications not an array');
select is(public.pas_try('{"nope":1}'), '22023|same', 'h35 unknown top-level key');
select is(public.pas_try('[]'), '22023|same', 'h36 p is an array');
select is(public.pas_try('5'), '22023|same', 'h37 p is a number');
select is(public.pas_try(null), '22023|same', 'h38 p is null');
select is(public.pas_try('{"timezone":"America/Denver","on_duty_default":true,"live_transfer_phone":"+15125550505","working_hours":[],"notifications":[{"type":"new_lead","email":true}],"nope":1}'),
          '22023|same', 'h39 good fields beside an unknown key: nothing saved');
select is(public.pas_try('{"timezone":"America/Denver","on_duty_default":true,"working_hours":[],"notifications":[{"type":"new_lead","email":"yes"}]}'),
          '22023|same', 'h40 good fields beside a bad last field: nothing saved');
select throws_ok($$ update public.profiles set live_transfer_phone = '5125551234' where id = 'a9700000-0000-4000-8000-00000000000a' $$,
          '23514', null::text, 'h41 a direct self-update of a bad phone is refused by the CHECK');
select throws_ok($$ update public.profiles set live_transfer_phone = '' where id = 'a9700000-0000-4000-8000-00000000000a' $$,
          '23514', null::text, 'h42 a direct self-update of an empty phone is refused by the CHECK');
reset role;

-- ── i. Time zone stamp ──────────────────────────────────────────────────────
update public.profiles set timezone = 'America/Chicago', timezone_confirmed_at = '2020-01-01 00:00:00+00'
 where id = 'a9700000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9700000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is(public.save_my_agent_settings('{"timezone":"America/Chicago"}'::jsonb) ->> 'timezone', 'America/Chicago', 'i1 save the same zone');
reset role;
select is((select timezone_confirmed_at from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), '2020-01-01 00:00:00+00'::timestamptz,
          'i2 the same zone leaves the stamp alone');
set local role authenticated;
select is(public.save_my_agent_settings('{"on_duty_default":false}'::jsonb) ->> 'timezone', 'America/Chicago', 'i3 a save with no zone');
reset role;
select is((select timezone_confirmed_at from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), '2020-01-01 00:00:00+00'::timestamptz,
          'i4 no zone in the save leaves the stamp alone');
set local role authenticated;
select is(public.save_my_agent_settings('{"timezone":"America/Denver"}'::jsonb) ->> 'timezone', 'America/Denver', 'i5 save a different zone');
reset role;
select is((select timezone_confirmed_at from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), now(),
          'i6 a different zone moves the stamp');

-- ── j. Push and email, per type ─────────────────────────────────────────────
update public.profiles set notification_prefs = '{"push":false,"email":{"message":false,"policy_cancelled":true}}'
 where id = 'a9700000-0000-4000-8000-00000000000a';
set local role authenticated;
select is(public.pas_indep(t), 'ok', 'j1 ' || t || ': email and push each change alone, no other type moves')
  from unnest(array['new_lead', 'live_call_ringing', 'appointment_1h', 'needs_attention', 'request_done', 'payment_failed']) t;
reset role;
select is((select notification_prefs -> 'push' from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), 'false'::jsonb,
          'j2 the top-level push switch survives, still a boolean');
select is(public.push_on('a9700000-0000-4000-8000-00000000000a'), false, 'j3 push_on still reads it');
select is((select notification_prefs -> 'email' -> 'message' from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), 'false'::jsonb,
          'j4 another email key survives');
select is((select notification_prefs -> 'email' -> 'policy_cancelled' from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), 'true'::jsonb,
          'j5 and so does a second one');
select is((select array_agg(k order by k) from public.profiles, jsonb_object_keys(notification_prefs -> 'push_types') k where id = 'a9700000-0000-4000-8000-00000000000a'),
          array['appointment_1h', 'live_call_ringing', 'needs_attention', 'new_lead', 'payment_failed', 'request_done'],
          'j6 push choices live under push_types');
update public.profiles set notification_prefs = '{"email":{"new_lead":true},"push_types":{"new_lead":false}}'
 where id = 'a9700000-0000-4000-8000-00000000000a';
set local role authenticated;
select is(public.pas_pick(public.save_my_agent_settings('{"notifications":[{"type":"needs_attention"}]}'::jsonb), 'new_lead', 'email_on'), 'true',
          'j7 a type with neither email nor push changes nothing');
reset role;
select is((select notification_prefs -> 'email' from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'), '{"new_lead":true}'::jsonb,
          'j8 and adds no key');

-- ── k. Bad shapes written directly ──────────────────────────────────────────
set local role authenticated;
update public.profiles set notification_prefs = '5' where id = 'a9700000-0000-4000-8000-00000000000a';
select lives_ok($$ select public.my_agent_settings() $$, 'k1 the read survives prefs that are a number');
select is(public.pas_pick(public.my_agent_settings(), 'payment_failed', 'email_on'), 'true', 'k2 and falls back to the registry');
select is(public.pas_pick(public.save_my_agent_settings('{"notifications":[{"type":"new_lead","push":false}]}'::jsonb), 'new_lead', 'push_on'), 'false',
          'k3 a save repairs prefs that are a number');
reset role;
select is((select notification_prefs from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'),
          '{"email":{},"push_types":{"new_lead":false}}'::jsonb, 'k4 and merges into an object, not an array');

set local role authenticated;
update public.profiles set notification_prefs = '[1]' where id = 'a9700000-0000-4000-8000-00000000000a';
select lives_ok($$ select public.my_agent_settings() $$, 'k5 the read survives prefs that are an array');
select is(public.pas_pick(public.save_my_agent_settings('{"notifications":[{"type":"new_lead","email":true}]}'::jsonb), 'new_lead', 'email_on'), 'true',
          'k6 a save repairs prefs that are an array');
update public.profiles set notification_prefs = '{"push":false,"email":7,"push_types":"x"}' where id = 'a9700000-0000-4000-8000-00000000000a';
select lives_ok($$ select public.my_agent_settings() $$, 'k7 the read survives email and push_types that aren''t objects');
select is(public.pas_pick(public.my_agent_settings(), 'new_lead', 'push_on'), 'true', 'k8 and falls back to the registry');
select is(public.pas_pick(public.save_my_agent_settings('{"notifications":[{"type":"request_done","email":true,"push":false}]}'::jsonb), 'request_done', 'email_on'), 'true',
          'k9 a save repairs email and push_types');
reset role;
select is((select notification_prefs from public.profiles where id = 'a9700000-0000-4000-8000-00000000000a'),
          '{"push":false,"email":{"request_done":true},"push_types":{"request_done":false}}'::jsonb,
          'k10 merged into objects, the push switch kept');

set local role authenticated;
update public.profiles set notification_prefs = '{"email":{"new_lead":"yes","payment_failed":"no"},"push_types":{"new_lead":"no","payment_failed":0}}'
 where id = 'a9700000-0000-4000-8000-00000000000a';
select lives_ok($$ select public.my_agent_settings() $$, 'k11 the read survives non-boolean values');
select is(public.pas_pick(public.my_agent_settings(), 'new_lead', 'email_on'), 'false', 'k12 non-boolean email falls back to email_default (off)');
select is(public.pas_pick(public.my_agent_settings(), 'payment_failed', 'email_on'), 'true', 'k13 non-boolean email falls back to email_default (on)');
select is(public.pas_pick(public.my_agent_settings(), 'new_lead', 'push_on'), 'true', 'k14 non-boolean push falls back to the registry (on)');
select is(public.pas_pick(public.save_my_agent_settings('{"notifications":[{"type":"new_lead","email":true}]}'::jsonb), 'new_lead', 'email_on'), 'true',
          'k15 a save overwrites a non-boolean value');
select is(public.pas_pick(public.my_agent_settings(), 'payment_failed', 'email_on'), 'true', 'k16 the other type''s bad value still reads as the default');
reset role;

-- ── l. Nothing sent, duty untouched ─────────────────────────────────────────
select is((select count(*) from public.agent_duty where agent_id::text like 'a9700000-%'), 0::bigint,
          'l1 saving the default never wrote agent_duty');
-- account_delete tells the admins (Z, section e); that is its own message, not this feature's.
select is((select count(*) from public.notifications where profile_id::text like 'a9700000-%' and type <> 'account_deleted'), 0::bigint, 'l2 no bell row');
select is((select count(*) from public.notification_emails where profile_id::text like 'a9700000-%' and type <> 'account_deleted'), 0::bigint, 'l3 no email queued');
select is((select count(*) from public.notification_pushes where profile_id::text like 'a9700000-%'), 0::bigint, 'l4 no push queued');
select is((select count(*)::text from net.http_request_queue), current_setting('pas.sent_before'), 'l5 no outside request');

select * from finish();
rollback;
