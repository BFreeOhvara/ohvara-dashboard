-- p_va_shifts — pgTAP checks for 231_va_shifts.sql (Prompt 851): the VA rota,
-- day-off requests, their RLS, and auto-assign preferring on-shift VAs behind
-- app_settings.va_shift_assign_live.
--
-- RUN: `npm run test:sql -- supabase/tests/p_va_shifts.sql` (PGlite, in memory)
-- or `supabase test db` on a LOCAL stack. One transaction, rolled back. Never
-- run it against Ohvara's live database.
--
-- Cast: admin Z, agent G, VAs V1 and V2 (active), V3 (access off).
-- Days are counted from va_today() (Central): D2 = two days ahead, D3 = three.
-- V1 is on the rota D2 and D3 08:00-18:00 Central; V2 on D2 12:00-18:00 only.

begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_va_shifts_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('dddddddd-dddd-4ddd-8ddd-000000000001'::uuid, 'admin_z', 'agent'),
    ('dddddddd-dddd-4ddd-8ddd-000000000002'::uuid, 'agent_g', 'agent'),
    ('eeeeeeee-eeee-4eee-8eee-000000000001'::uuid, 'va_one',  'fulfillment'),
    ('eeeeeeee-eeee-4eee-8eee-000000000002'::uuid, 'va_two',  'fulfillment'),
    ('eeeeeeee-eeee-4eee-8eee-000000000003'::uuid, 'va_off',  'fulfillment')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8ddd-000000000001';
update public.profiles set is_active = false where id = 'eeeeeeee-eeee-4eee-8eee-000000000003';
-- Only this test's VAs count for auto-assign.
update public.profiles set is_active = false
 where role = 'fulfillment' and id not in ('eeeeeeee-eeee-4eee-8eee-000000000001', 'eeeeeeee-eeee-4eee-8eee-000000000002', 'eeeeeeee-eeee-4eee-8eee-000000000003');

create function pg_temp.at_ct(d integer, t text) returns timestamptz language sql stable as $$
  select ((public.va_today() + d) + t::time) at time zone 'America/Chicago'
$$;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;

-- ── a. structure and the flag ───────────────────────────────────────────────
select has_table('public', 'va_shifts', 'a1 va_shifts exists');
select has_table('public', 'va_day_off_requests', 'a2 va_day_off_requests exists');
select is((select va_shift_assign_live from public.app_settings where id = 1), false, 'a3 the auto-assign flag starts OFF');
select is((select relrowsecurity from pg_class where oid = 'public.va_shifts'::regclass), true, 'a4 RLS on va_shifts');
select is((select relrowsecurity from pg_class where oid = 'public.va_day_off_requests'::regclass), true, 'a5 RLS on va_day_off_requests');
select ok(not has_function_privilege('anon', 'public.va_shift_week(date, integer, uuid)', 'execute'), 'a6 anon cannot run va_shift_week');
select ok(not has_function_privilege('authenticated', 'public.fulfillment_pick_rep(timestamptz, uuid, uuid, uuid)', 'execute'), 'a7 pick_rep stays server-only');
select ok(not has_function_privilege('authenticated', 'public.va_on_shift_at(uuid, timestamptz)', 'execute'), 'a8 va_on_shift_at stays server-only');

-- ── b. admins build the rota ────────────────────────────────────────────────
select pg_temp.as_user('dddddddd-dddd-4ddd-8ddd-000000000001');
select lives_ok($$
  insert into public.va_shifts (va_id, shift_date, starts, ends) values
    ('eeeeeeee-eeee-4eee-8eee-000000000001', public.va_today() + 2, '08:00', '18:00'),
    ('eeeeeeee-eeee-4eee-8eee-000000000001', public.va_today() + 3, '08:00', '18:00'),
    ('eeeeeeee-eeee-4eee-8eee-000000000002', public.va_today() + 2, '12:00', '18:00')
$$, 'b1 an admin adds shifts');
select is((select created_by from public.va_shifts where va_id = 'eeeeeeee-eeee-4eee-8eee-000000000002'),
          'dddddddd-dddd-4ddd-8ddd-000000000001'::uuid, 'b2 created_by is the admin');
select throws_ok($$ insert into public.va_shifts (va_id, shift_date) values ('dddddddd-dddd-4ddd-8ddd-000000000002', public.va_today() + 2) $$,
                 '22023', 'Shifts are for VAs (Fulfillment logins) only', 'b3 an agent cannot be put on the rota');
select throws_ok($$ insert into public.va_shifts (va_id, shift_date, tz) values ('eeeeeeee-eeee-4eee-8eee-000000000002', public.va_today() + 5, 'Mars/Olympus') $$,
                 '22023', 'Unknown time zone Mars/Olympus', 'b4 a made-up time zone is refused');
select throws_ok($$ insert into public.va_shifts (va_id, shift_date, starts, ends) values ('eeeeeeee-eeee-4eee-8eee-000000000002', public.va_today() + 6, '18:00', '08:00') $$,
                 '23514', null, 'b5 a shift must end after it starts');
select throws_ok($$ insert into public.va_shifts (va_id, shift_date) values ('eeeeeeee-eeee-4eee-8eee-000000000001', public.va_today() + 2) $$,
                 '23505', null, 'b6 one shift per VA per day');
reset role;

-- ── c. who can read and write shifts ────────────────────────────────────────
select set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.va_shifts $$, '42501', null, 'c1 anon cannot read the rota');
reset role;

select pg_temp.as_user('dddddddd-dddd-4ddd-8ddd-000000000002');
select is((select count(*)::int from public.va_shifts), 0, 'c2 an agent sees no shifts');
select throws_ok($$ select * from public.va_shifts_today() $$, '42501', 'Only the Ohvara team and VAs can see the rota', 'c3 an agent cannot call va_shifts_today');
select throws_ok($$ select * from public.va_shift_week() $$, '42501', 'Only the Ohvara team and VAs can see the rota', 'c4 an agent cannot call va_shift_week');
select throws_ok($$ insert into public.va_shifts (va_id, shift_date) values ('eeeeeeee-eeee-4eee-8eee-000000000002', public.va_today() + 9) $$,
                 '42501', null, 'c5 an agent cannot add a shift');
reset role;

select pg_temp.as_user('eeeeeeee-eeee-4eee-8eee-000000000001');
select is((select count(*)::int from public.va_shifts), 3, 'c6 a VA sees the whole rota');
select throws_ok($$ insert into public.va_shifts (va_id, shift_date) values ('eeeeeeee-eeee-4eee-8eee-000000000001', public.va_today() + 9) $$,
                 '42501', null, 'c7 a VA cannot add a shift, even their own');
update public.va_shifts set ends = '12:00' where va_id = 'eeeeeeee-eeee-4eee-8eee-000000000001';
delete from public.va_shifts where va_id = 'eeeeeeee-eeee-4eee-8eee-000000000002';
reset role;
select is((select count(*)::int from public.va_shifts where ends = '18:00'), 3, 'c8 a VA''s update changed nothing');
select is((select count(*)::int from public.va_shifts where va_id = 'eeeeeeee-eeee-4eee-8eee-000000000002'), 1, 'c9 a VA''s delete removed nothing');

-- ── d. asking for a day off ─────────────────────────────────────────────────
select pg_temp.as_user('eeeeeeee-eeee-4eee-8eee-000000000002');
select isnt(public.va_request_day_off(public.va_today() + 2, '  Doctor''s appointment  '), null, 'd1 V2 asks for D2 off');
select throws_ok($$ select public.va_request_day_off(public.va_today() - 1, null) $$, '22023', 'Pick a day that is still ahead', 'd2 a day already gone is refused');
select throws_ok($$ select public.va_request_day_off(public.va_today() + 200, null) $$, '22023', 'Ask no more than four months ahead', 'd3 too far ahead is refused');
select lives_ok($$ insert into public.va_day_off_requests (va_id, off_date, status, decided_by)
                   values ('eeeeeeee-eeee-4eee-8eee-000000000002', public.va_today() + 7, 'approved', 'eeeeeeee-eeee-4eee-8eee-000000000002') $$,
                'd4 a VA writing the table directly ...');
select is((select status || coalesce(decided_by::text, '-') from public.va_day_off_requests where off_date = public.va_today() + 7),
          'pending-', 'd5 ... always lands as pending, undecided');
select throws_ok($$ insert into public.va_day_off_requests (va_id, off_date) values ('eeeeeeee-eeee-4eee-8eee-000000000001', public.va_today() + 8) $$,
                 '42501', null, 'd6 a VA cannot ask off for someone else');
update public.va_day_off_requests set status = 'approved' where off_date = public.va_today() + 2;
reset role;
select is((select status from public.va_day_off_requests where off_date = public.va_today() + 2), 'approved', 'd7 P915: the VA''s own booking is booked at once (no approval since P913)');
select is((select reason from public.va_day_off_requests where off_date = public.va_today() + 2), 'Doctor''s appointment', 'd8 the reason is trimmed');
select is((select count(*)::int from public.notifications where profile_id = 'dddddddd-dddd-4ddd-8ddd-000000000001' and type = 'va_day_off_requested'),
          1, 'd9 the admin is told (one in-app notification, the RPC ask only)');

select pg_temp.as_user('eeeeeeee-eeee-4eee-8eee-000000000001');
select is((select count(*)::int from public.va_day_off_requests), 0, 'd10 V1 cannot see V2''s requests');
select is((select count(*)::int from public.va_shift_week(public.va_today() + 2, 1) where off_status is not null), 1, 'd11 P915: V2''s booked day shows on the rota');
select throws_ok($$ select public.va_decide_day_off((select id from public.va_day_off_requests limit 1), true) $$,
                 '42501', 'Only the Ohvara team can decide a day off', 'd12 a VA cannot decide a day off');
reset role;

select pg_temp.as_user('eeeeeeee-eeee-4eee-8eee-000000000003');
select throws_ok($$ select public.va_request_day_off(public.va_today() + 2, null) $$, '42501', 'Only VAs can ask for a day off', 'd13 a VA with access off cannot ask');
reset role;
select pg_temp.as_user('dddddddd-dddd-4ddd-8ddd-000000000002');
select throws_ok($$ select public.va_request_day_off(public.va_today() + 2, null) $$, '42501', 'Only VAs can ask for a day off', 'd14 an agent cannot ask');
reset role;

-- ── e. the admin decides ────────────────────────────────────────────────────
select pg_temp.as_user('dddddddd-dddd-4ddd-8ddd-000000000001');
select is((select count(*)::int from public.va_day_off_requests), 2, 'e1 the admin sees every request');
select is(public.va_decide_day_off((select id from public.va_day_off_requests where off_date = public.va_today() + 2), true), 'approved', 'e2 approve D2');
select is(public.va_decide_day_off((select id from public.va_day_off_requests where off_date = public.va_today() + 7), false), 'declined', 'e3 decline D7');
select is((select decided_by from public.va_day_off_requests where off_date = public.va_today() + 2), null, 'e4 P915: a booked day needed no deciding (approving it again changes nothing)');
select throws_ok($$ select public.va_decide_day_off('99999999-9999-4999-8999-999999999999', true) $$, 'P0002', 'Request not found', 'e5 an unknown request');
select is((select count(*)::int from public.va_shifts_today(public.va_today() + 2)), 1, 'e6 D2 on shift: V1 only (V2 is off)');
select is((select off_status from public.va_shift_week(public.va_today() + 2, 1) where va_id = 'eeeeeeee-eeee-4eee-8eee-000000000002'), 'approved', 'e7 the rota shows V2 off');
reset role;
select is((select count(*)::int from public.notifications where profile_id = 'eeeeeeee-eeee-4eee-8eee-000000000002' and type = 'va_day_off_decided'),
          1, 'e8 V2 is told the one real decision (the decline)');
select is((select count(*)::int from public.notification_emails where type in ('va_day_off_requested', 'va_day_off_decided')),
          0, 'e8b no email is queued for either');

select pg_temp.as_user('eeeeeeee-eeee-4eee-8eee-000000000001');
select is((select off_status from public.va_shift_week(public.va_today() + 2, 1) where va_id = 'eeeeeeee-eeee-4eee-8eee-000000000002'), 'approved', 'e9 V1 sees V2''s approved day off');
select is((select off_reason from public.va_shift_week(public.va_today() + 2, 1) where va_id = 'eeeeeeee-eeee-4eee-8eee-000000000002'), null, 'e10 but not the reason');
select throws_ok($$ select * from public.va_shift_week(null, 7, 'eeeeeeee-eeee-4eee-8eee-000000000002') $$, '42501', 'You can only see your own week', 'e11 V1 cannot ask for V2''s week');
reset role;

-- ── f. asking again, taking it back ─────────────────────────────────────────
select pg_temp.as_user('eeeeeeee-eeee-4eee-8eee-000000000002');
select lives_ok($$ select public.va_request_day_off(public.va_today() + 7, 'Moving house') $$, 'f1 V2 asks again for the declined day');
select is((select status from public.va_day_off_requests where off_date = public.va_today() + 7), 'approved', 'f2 P915: asking again books it');
select is(public.va_cancel_day_off(public.va_today() + 7), true, 'f3 V2 takes it back');
select is((select count(*)::int from public.va_day_off_requests where off_date = public.va_today() + 7), 0, 'f4 the request is gone');
select is(public.va_request_day_off(public.va_today() + 2, 'again'), (select id from public.va_day_off_requests where off_date = public.va_today() + 2), 'f5 asking again for an approved day keeps it');
select is((select status || ':' || reason from public.va_day_off_requests where off_date = public.va_today() + 2), 'approved:Doctor''s appointment', 'f6 and leaves it as approved');
reset role;

-- ── g. auto-assign ──────────────────────────────────────────────────────────
-- D3 10:00 Central: V1 is on shift, V2 is not. V1 has the lower id, so the 156
-- order (no load, never assigned) picks V1 either way; use D2 14:00 instead,
-- where V1 is on shift and V2 is off (approved), and 07:00 D3 where nobody is.
-- To see the flag move a pick, make V1 the busier rep: one open item.
select ok(public.va_on_shift_at('eeeeeeee-eeee-4eee-8eee-000000000001', pg_temp.at_ct(3, '10:00')), 'g1 V1 is on shift D3 10:00');
select ok(not public.va_on_shift_at('eeeeeeee-eeee-4eee-8eee-000000000002', pg_temp.at_ct(2, '14:00')), 'g2 V2 is not (approved day off)');

-- V2 back on for D3 afternoon; V1 busier. (As the table owner, no signed-in user.)
select set_config('request.jwt.claims', '', true);
insert into public.va_shifts (va_id, shift_date, starts, ends) values ('eeeeeeee-eeee-4eee-8eee-000000000002', public.va_today() + 3, '13:00', '18:00');
update public.profiles set is_active = false where id = 'eeeeeeee-eeee-4eee-8eee-000000000002';
insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, state, status, effective_date,
                             fulfillment_assigned, scheduled_call_at)
values ('dddddddd-dddd-4ddd-8ddd-000000000002', 'Busy', 'One', '5125550100', 'TX', 'In Effect', current_date,
        true, pg_temp.at_ct(5, '09:00'));
update public.profiles set is_active = true where id = 'eeeeeeee-eeee-4eee-8eee-000000000002';
select is((select assigned_fulfillment_id from public.policies where client_last_name = 'One'), 'eeeeeeee-eeee-4eee-8eee-000000000001'::uuid, 'g3 setup: V1 holds one open item');

-- D3 10:00: V1 on shift (busy), V2 not on yet (free).
select is(public.fulfillment_pick_rep(pg_temp.at_ct(3, '10:00')), 'eeeeeeee-eeee-4eee-8eee-000000000002'::uuid, 'g4 flag OFF: least loaded (V2), as before');
update public.app_settings set va_shift_assign_live = true where id = 1;
select is(public.fulfillment_pick_rep(pg_temp.at_ct(3, '10:00')), 'eeeeeeee-eeee-4eee-8eee-000000000001'::uuid, 'g5 flag ON: the VA on shift (V1)');
select is(public.fulfillment_pick_rep(pg_temp.at_ct(3, '15:00')), 'eeeeeeee-eeee-4eee-8eee-000000000002'::uuid, 'g6 flag ON, both on shift: least loaded (V2)');
select is(public.fulfillment_pick_rep(pg_temp.at_ct(3, '15:00'), null, 'eeeeeeee-eeee-4eee-8eee-000000000002'), 'eeeeeeee-eeee-4eee-8eee-000000000001'::uuid, 'g7 pass-on exclusion still works');
select is(public.fulfillment_pick_rep(pg_temp.at_ct(2, '14:00')), 'eeeeeeee-eeee-4eee-8eee-000000000001'::uuid, 'g8 flag ON: a VA on a day off is passed over');
select is(public.fulfillment_pick_rep(pg_temp.at_ct(3, '07:00')), 'eeeeeeee-eeee-4eee-8eee-000000000002'::uuid, 'g9 flag ON, nobody on shift: falls back to the old pick, never unassigned');

-- End to end through the booking trigger.
insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, state, status, effective_date,
                             fulfillment_assigned, scheduled_call_at)
values ('dddddddd-dddd-4ddd-8ddd-000000000002', 'Shift', 'Two', '5125550101', 'TX', 'In Effect', current_date,
        true, pg_temp.at_ct(3, '10:30'));
select is((select assigned_fulfillment_id from public.policies where client_last_name = 'Two'), 'eeeeeeee-eeee-4eee-8eee-000000000001'::uuid, 'g10 a booking at D3 10:30 lands on the VA on shift');

select * from finish();
rollback;
