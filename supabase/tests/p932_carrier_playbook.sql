-- p932_carrier_playbook — pgTAP checks for supabase/migrations/262_carrier_playbook.sql (Prompt 932): the researched
-- carrier playbook, edits by admin and VAs (logged), the easiest path for a change (stamped on new change tasks),
-- the hold line settings, the AI front desk's live numbers and the callback it books, and route_tick giving
-- hold-line callers up to max_wait_min.
--
-- RUN: `npm run test:sql -- supabase/tests/p932_carrier_playbook.sql` (PGlite, in memory). One transaction, rolled
-- back. Never run it against Ohvara's live database.
--
-- Cast: admin Z, agent G, VAs V1 V2.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p932_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.fname), now(), now()
  from (values
    ('d9320000-0000-4000-8000-000000000001'::uuid, 'admin_z', 'agent', 'Zed Admin'),
    ('d9320000-0000-4000-8000-000000000002'::uuid, 'agent_g', 'agent', 'Gail Agent'),
    ('e9320000-0000-4000-8000-000000000001'::uuid, 'va_one', 'fulfillment', 'Vera One'),
    ('e9320000-0000-4000-8000-000000000002'::uuid, 'va_two', 'fulfillment', 'Sarah Two')
  ) as u(id, n, role, fname);
update public.profiles set role = 'admin' where id = 'd9320000-0000-4000-8000-000000000001';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create or replace function public.route_desk_open(p_at timestamptz default now())
returns boolean language sql stable as $$ select true $$;

-- ── a. the seed ──────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(distinct carrier_key)::int from public.carrier_playbook), 16, 'a1 16 carriers researched');
select is((select count(*)::int from public.carrier_playbook), 80, 'a2 a method for each of the 5 changes');
select is((select count(*)::int from public.carrier_playbook where method = 'esign' and (send_via is null or send_to is null)), 0,
  'a3 every e-sign entry says where the form goes');
select is((select count(*)::int from public.carrier_playbook where checked_on is null or source_url is null), 0, 'a4 source and date on every entry');
select ok((select bool_and(status = 'check') from public.carrier_playbook where method = 'check'), 'a5 not confirmed → "check on first call"');

-- ── b. the easiest path ──────────────────────────────────────────────────────────────────────────────────────
select is(public.servicing_path('Americo', 'beneficiary_change') ->> 'path', 'esign', 'b1 Americo beneficiary → e-sign');
select is(public.servicing_path('Americo Financial Life', 'payment_change') ->> 'path', 'esign', 'b2 matched by an alias');
select is(public.servicing_path('Globe Life', 'cancel_old') ->> 'path', 'merge', 'b3 Globe Life cancel → merge call');
select is(public.servicing_path('Brand New Mutual', 'address_change') ->> 'learn', 'true', 'b4 unknown carrier → learn it on the call');
select is(public.servicing_path('Americo', 'annual_review'), null, 'b5 not a change → no path');

insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, state, status, effective_date, fulfillment_assigned, replaced_old_policy, new_carrier_name)
values ('b9320000-0000-4000-8000-000000000001', 'd9320000-0000-4000-8000-000000000002', 'Gloria', 'Hayes', '2145550401', 'TX', 'In Effect', current_date - 40, false, false, 'Foresters');
insert into public.servicing_tasks (agent_id, policy_id, kind) values ('d9320000-0000-4000-8000-000000000002', 'b9320000-0000-4000-8000-000000000001', 'beneficiary_change');
select is((select path ->> 'path' from public.servicing_tasks where policy_id = 'b9320000-0000-4000-8000-000000000001' and kind = 'beneficiary_change'),
  'esign', 'b6 a new change task gets its path stamped');
select is((select path ->> 'to' from public.servicing_tasks where policy_id = 'b9320000-0000-4000-8000-000000000001' and kind = 'beneficiary_change'),
  '(877) 329-4631', 'b7 … with where the form goes');

-- ── c. editing (admin and VAs, logged) ───────────────────────────────────────────────────────────────────────
select pg_temp.as_user('d9320000-0000-4000-8000-000000000002');
select throws_ok($$ select public.playbook_save('cat-transamerica', 'address', '{"method":"online"}') $$, '42501', null, 'c1 an agent cannot edit');
select pg_temp.as_user('e9320000-0000-4000-8000-000000000001');
select throws_ok($$ select public.playbook_save('cat-transamerica', 'address', '{"method":"esign","send_via":"mail"}') $$, '22023', null,
  'c2 e-sign needs fax, email or upload');
select is((public.playbook_save('cat-transamerica', 'address', '{"method":"esign","send_via":"fax","send_to":"(800) 555-0100","form_name":"TA address form","have_ready":["Policy number"]}')).status,
  'confirmed', 'c3 a VA saves what they learned');
select is(public.servicing_path('Transamerica', 'address_change') ->> 'path', 'esign', 'c4 the path follows the edit');
select is((select count(*)::int from public.carrier_playbook_log where carrier_key = 'cat-transamerica' and action = 'address' and before is not null
           and edited_by = 'e9320000-0000-4000-8000-000000000001'), 1, 'c5 the edit is logged with the row before');
select is((public.playbook_save(null, 'cancel', '{"method":"merge","phone":"(800) 555-0199"}', 'Brand New Mutual')).carrier_key,
  'new-brand-new-mutual', 'c6 a new carrier learned on a call');
select is(public.servicing_path('Brand New Mutual', 'cancel') ->> 'known', 'true', 'c7 … and it is known next time');
select is((select count(*)::int from public.carrier_playbook_log), 2, 'c8 VAs read the log');
select pg_temp.as_user('d9320000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.carrier_playbook_log), 0, 'c9 agents cannot read the log');

-- ── d. the hold line ─────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.admin_set_hold_line('{"track":"warm"}') $$, '42501', null, 'd1 only admin sets the hold line');
select pg_temp.as_user('d9320000-0000-4000-8000-000000000001');
select throws_ok($$ select public.admin_set_hold_line('{"track":"custom"}') $$, '22023', 'Upload a track first', 'd2 custom needs an upload');
select is((public.admin_set_hold_line('{"track":"warm","max_wait_min":8}')).max_wait_min, 8, 'd3 admin picks the track and the longest wait');

-- ── e. the front desk ────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_owner();
update public.recovery_config set voice_live = true;
insert into public.va_presence (user_id, status) values
  ('e9320000-0000-4000-8000-000000000001', 'on_call'), ('e9320000-0000-4000-8000-000000000002', 'on_call');
insert into public.help_calls (call_sid, caller_number, status, created_at) values
  ('CAp932a', '+12145550400', 'ringing', now() - interval '2 minutes'),
  ('CAp932b', '+12145550401', 'ringing', now() - interval '1 minute');
insert into public.call_queue (kind, priority, help_call_sid, phone, name, status, ready_at) values
  ('inbound', 0, 'CAp932a', '+12145550400', 'Caller ending 0400', 'waiting', now() - interval '2 minutes'),
  ('inbound', 0, 'CAp932b', '+12145550401', 'Gloria Hayes', 'waiting', now() - interval '1 minute');
select is((public.front_desk_start('CAp932b') -> 'client' ->> 'name'), 'Gloria Hayes', 'e1 the caller is recognised by number');
select ok((select hold_line from public.help_calls where call_sid = 'CAp932b') and
          (select (detail ->> 'hold_line')::boolean from public.call_queue where help_call_sid = 'CAp932b'), 'e2 on the hold line');
select is((public.front_desk_state('CAp932b') ->> 'ahead')::int * 10 + (public.front_desk_state('CAp932b') ->> 'busy')::int, 12,
  'e3 live numbers: 1 ahead, 2 VAs on calls');
select public.front_desk_save('CAp932b', '{"need":"beneficiary","summary":"Gloria Hayes · Foresters\nBeneficiary change","status":"holding"}');
select is((select detail ->> 'front_desk' from public.call_queue where help_call_sid = 'CAp932b'), E'Gloria Hayes · Foresters\nBeneficiary change',
  'e4 the summary rides on the queue item to the VA who takes it');
select ok((public.front_desk_callback('CAp932b', 'pressed_1') ->> 'text') ~ '^Deedstone Insurance: a specialist will call you back at ',
  'e5 press 1 → callback booked and the text drafted');
select is((select count(*)::int from public.call_queue where kind = 'callback' and detail ->> 'help_call_sid' = 'CAp932b' and status in ('waiting', 'offered', 'held')),
  1, 'e6 … one callback on the queue, the wait ended');

rollback;
