-- p_va_desk — pgTAP checks for the VA desk functions in 175_va_desk.sql
-- (Roadmap Goal 8: a Fulfillment login works the queue, claims, saves the
-- checklist and records the outcome, and sees no prices).
--
-- RUN: `supabase test db` on a LOCAL stack only (supabase start, supabase db
-- reset). Everything runs in one transaction that is rolled back. Never run it
-- against Ohvara's live database. 175 needs 166 and 173 applied first.
--
-- The test is written from the plan. Where the plan names a function 175 does
-- not have, the nearest real one is tested and the gap is said here:
--   * There is no va_save_checklist, va_log_attempt, va_record_transfer or
--     va_book. Checklist, attempt, transfer and booking all go through
--     va_set_lead_outcome (needs the caller's live claim) and
--     va_save_policy_help_lead (the transfer target is checked there too).
--   * There is no weekly cap anywhere in 175, so that assertion is skipped
--     (section g) until a function enforces one.
--
-- Cast: agent A (active), agent B (access off), V1 and V2 (Fulfillment), V3
-- (Fulfillment with access off). Leads (last two digits of the id):
--   01 new, 3 days old        02 not reached      03 callback, due
--   04 callback, not due      05 new, V2 holds it (live claim)
--   06 new, V2's claim expired   07 already has an agent   08 cancellation

begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_va_desk_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002'::uuid, 'agent_b', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid, 'va_one',  'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002'::uuid, 'va_two',  'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-000000000003'::uuid, 'va_off',  'fulfillment')
  ) as u(id, n, role);
update public.profiles set is_active = false
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003');

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source,
                          va_outcome, va_callback_at, va_attempts, va_claimed_by, va_claim_expires_at,
                          assigned_rep_id, created_at)
values
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'Lead 01', 'Lead 01', '+15125550101', 'TX', 'policy_help', 'google', null, null, 0, null, null, null, now() - interval '3 days'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', 'Lead 02', 'Lead 02', '+15125550102', 'TX', 'policy_help', 'google', 'not_reached', null, 1, null, null, null, now() - interval '2 days'),
  ('cccccccc-cccc-4ccc-8ccc-000000000003', 'Lead 03', 'Lead 03', '+15125550103', 'TX', 'policy_help', 'google', 'callback', now() - interval '1 hour', 1, null, null, null, now() - interval '4 days'),
  ('cccccccc-cccc-4ccc-8ccc-000000000004', 'Lead 04', 'Lead 04', '+15125550104', 'TX', 'policy_help', 'google', 'callback', now() + interval '1 day', 1, null, null, null, now() - interval '4 days'),
  ('cccccccc-cccc-4ccc-8ccc-000000000005', 'Lead 05', 'Lead 05', '+15125550105', 'TX', 'policy_help', 'google', null, null, 0, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', now() + interval '10 minutes', null, now() - interval '5 days'),
  ('cccccccc-cccc-4ccc-8ccc-000000000006', 'Lead 06', 'Lead 06', '+15125550106', 'TX', 'policy_help', 'google', null, null, 0, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', now() - interval '5 minutes', null, now() - interval '1 day'),
  ('cccccccc-cccc-4ccc-8ccc-000000000007', 'Lead 07', 'Lead 07', '+15125550107', 'TX', 'policy_help', 'google', null, null, 0, null, null, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', now() - interval '6 days'),
  ('cccccccc-cccc-4ccc-8ccc-000000000008', 'Lead 08', 'Lead 08', '+15125550108', 'TX', 'cancellation', null, null, null, 0, null, null, null, now() - interval '7 days');

-- Row counts of every table that can hold an outbound message, before anything runs.
create temp table va_before as
select (select count(*) from public.notification_emails) as emails,
       (select count(*) from public.notification_pushes) as pushes,
       (select count(*) from public.recovery_sms_log)    as sms;

-- ── a. Only Fulfillment (or admin) can run any va_* function ────────────────
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_%'),
  array['va_agent_roster', 'va_claim', 'va_queue', 'va_release', 'va_save_policy_help_lead', 'va_set_lead_outcome'],
  'a0 the va_* functions are exactly the six this test covers (a new one needs new cases)');

select ok(not has_function_privilege('anon', p.oid, 'execute'),
          format('a1 anon has no execute on %s', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_%'
 order by p.proname;

select set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
select throws_ok($$ select * from public.va_queue() $$, '42501', 'permission denied for function va_queue',
                 'a2 anon calling va_queue is refused');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select * from public.va_agent_roster() $$, '42501', 'Only Fulfillment can see the agent list',
                 'a3 an agent cannot call va_agent_roster');
select throws_ok($$ select * from public.va_queue() $$, '42501', 'Only Fulfillment can see the call queue',
                 'a3 an agent cannot call va_queue');
select throws_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000001') $$, '42501', 'Only Fulfillment can take a lead',
                 'a3 an agent cannot call va_claim');
select throws_ok($$ select public.va_release('cccccccc-cccc-4ccc-8ccc-000000000001') $$, '42501', 'Only Fulfillment can release a lead',
                 'a3 an agent cannot call va_release');
select throws_ok($$ select public.va_save_policy_help_lead('A', 'B', '5125550000', 'Austin', 'TX', '{}'::jsonb) $$, '42501', 'Only Fulfillment can save a call',
                 'a3 an agent cannot call va_save_policy_help_lead');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000001', null, 'not_reached') $$, '42501', 'Only Fulfillment can update a call',
                 'a3 an agent cannot call va_set_lead_outcome');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000003","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select * from public.va_queue() $$, '42501', 'Only Fulfillment can see the call queue',
                 'a4 a Fulfillment login with access off cannot call va_queue');
select throws_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000001') $$, '42501', 'Only Fulfillment can take a lead',
                 'a4 a Fulfillment login with access off cannot call va_claim');
reset role;

-- ── b. The queue ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);

select is(
  (select array_agg(right(q.lead_id::text, 2) order by q.lead_id) from public.va_queue() q
    where q.lead_id::text like 'cccccccc-cccc-4ccc-8ccc-0000000000%'),
  array['01', '02', '03', '06'],
  'b1 queue holds the new, not-reached, due-callback and expired-claim leads and nothing else');
select is(
  (select string_agg(right(q.lead_id::text, 2) || ':' || q.bucket, ',' order by q.lead_id) from public.va_queue() q
    where q.lead_id::text like 'cccccccc-cccc-4ccc-8ccc-0000000000%'),
  '01:new,02:not_reached,03:callback_due,06:new',
  'b2 buckets are new, not_reached and callback_due');
select is(
  (select string_agg(right(x.lead_id::text, 2), ',') from
     (select q.lead_id from public.va_queue() q where q.lead_id::text like 'cccccccc-cccc-4ccc-8ccc-0000000000%') x),
  '03,01,06,02',
  'b3 callback_due comes first, then new (oldest first), then not_reached');
select is((select count(*) from public.va_queue() q where q.lead_id = 'cccccccc-cccc-4ccc-8ccc-000000000005'), 0::bigint,
          'b4 a lead another VA holds with a live claim is hidden');
select is((select count(*) from public.va_queue() q where q.lead_id = 'cccccccc-cccc-4ccc-8ccc-000000000004'), 0::bigint,
          'b5 a callback that is not due yet is hidden');
select is((select count(*) from public.va_queue() q where q.lead_id = 'cccccccc-cccc-4ccc-8ccc-000000000007'), 0::bigint,
          'b6 a lead that already has an agent is hidden');
select is((select count(*) from public.va_queue() q where q.lead_id = 'cccccccc-cccc-4ccc-8ccc-000000000008'), 0::bigint,
          'b7 a cancellation lead is hidden');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(
  (select string_agg(right(q.lead_id::text, 2) || ':' || q.claimed_by_me, ',' order by q.lead_id) from public.va_queue() q
    where q.lead_id in ('cccccccc-cccc-4ccc-8ccc-000000000005', 'cccccccc-cccc-4ccc-8ccc-000000000006')),
  '05:true,06:false',
  'b8 the VA who holds a lead still sees it as theirs; an expired claim shows as not theirs');
reset role;

-- ── c. A live claim blocks a second claim ───────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000001') $$,
                'c1 the first VA can claim a new lead');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000001') $$, '55006', 'Another VA is on this lead',
                 'c2 a second VA claiming a live-claimed lead is rejected');
select is((select count(*) from public.va_queue() q where q.lead_id = 'cccccccc-cccc-4ccc-8ccc-000000000001'), 0::bigint,
          'c3 the second VA no longer sees the live-claimed lead in the queue');
reset role;

select is((select va_claimed_by from public.leads where id = 'cccccccc-cccc-4ccc-8ccc-000000000001'),
          'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid,
          'c4 the rejected claim left the first VA holding the lead');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000001') $$,
                'c5 the holder claiming again renews the claim');
reset role;

-- ── d. Expired claims and release ───────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000006') $$,
                'd1 a lead whose claim expired can be claimed by another VA');
reset role;
select is((select va_claimed_by from public.leads where id = 'cccccccc-cccc-4ccc-8ccc-000000000006'),
          'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid,
          'd2 the new VA now holds the lead whose claim had expired');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.va_release('cccccccc-cccc-4ccc-8ccc-000000000006'), true,
          'd3 va_release returns true when it gives back your own claim');
reset role;
select is((select va_claimed_by is null and va_claim_expires_at is null from public.leads where id = 'cccccccc-cccc-4ccc-8ccc-000000000006'),
          true, 'd4 a released lead has no holder and no expiry');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000006') $$,
                'd5 another VA can claim a released lead at once');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.va_release('cccccccc-cccc-4ccc-8ccc-000000000006'), false,
          'd6 va_release cannot free a claim that belongs to another VA');
reset role;

update public.leads set va_claim_expires_at = now() - interval '1 minute'
 where id = 'cccccccc-cccc-4ccc-8ccc-000000000001';
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000001') $$,
                'd7 a claim pushed into the past can be taken by another VA');
reset role;
-- State now: V2 holds 01, 05 and 06 with live claims. 02 is free.

-- ── e. No saving work on a lead you don't hold ─────────────────────────────
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000001', null, 'not_reached', null, null, '{"carrier":"X"}'::jsonb) $$,
                 '55006', 'Take the lead first (a claim lasts 15 minutes)',
                 'e1 a VA cannot save a checklist or log an attempt on a lead another VA holds');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'transferred') $$,
                 '55006', 'Take the lead first (a claim lasts 15 minutes)',
                 'e2 a VA cannot record a transfer on a lead another VA holds');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'booked') $$,
                 '55006', 'Take the lead first (a claim lasts 15 minutes)',
                 'e3 a VA cannot book a lead another VA holds');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000001', null, 'callback', now() + interval '1 day') $$,
                 '55006', 'Take the lead first (a claim lasts 15 minutes)',
                 'e4 a VA cannot set a callback on a lead another VA holds');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'booked') $$,
                 '55006', 'Take the lead first (a claim lasts 15 minutes)',
                 'e5 a VA cannot book a lead nobody has claimed');
select throws_ok($$ select public.va_save_policy_help_lead('Lead', 'Five', '(512) 555-0105', 'Austin', 'TX', '{"carrier":"X"}'::jsonb) $$,
                 '55006', 'Another VA is on this caller''s lead',
                 'e6 a VA cannot save a checklist onto a caller whose lead another VA holds');
reset role;

update public.leads set va_claim_expires_at = now() - interval '1 minute'
 where id = 'cccccccc-cccc-4ccc-8ccc-000000000006';
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'booked') $$,
                 '55006', 'Take the lead first (a claim lasts 15 minutes)',
                 'e7 the VA whose claim expired cannot book the lead');
reset role;

select is(
  (select string_agg(right(id::text, 2) || ':' || va_attempts || ':' || coalesce(va_outcome, '-') || ':' ||
                     (va_checklist is not null) || ':' || (transfer_agent_id is not null), ',' order by id)
     from public.leads where id in ('cccccccc-cccc-4ccc-8ccc-000000000001', 'cccccccc-cccc-4ccc-8ccc-000000000002', 'cccccccc-cccc-4ccc-8ccc-000000000006')),
  '01:0:-:false:false,02:1:not_reached:false:false,06:0:-:false:false',
  'e8 none of the refused calls changed attempts, outcome, checklist or transfer');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000001', null, 'not_reached', null, null, '{"carrier":"X"}'::jsonb) $$,
                'e9 the VA who holds the lead can save the checklist and log the attempt');
reset role;
select is(
  (select va_attempts || ':' || va_outcome || ':' || (va_checklist->>'carrier') || ':' || (va_claimed_by is null)
     from public.leads where id = 'cccccccc-cccc-4ccc-8ccc-000000000001'),
  '1:not_reached:X:true',
  'e10 that call counted one attempt, kept the checklist and ended the claim');

-- ── f. A transfer target has to be an active agent ──────────────────────────
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000006') $$,
                'f0 the VA takes lead 06 again so only the target can be what is wrong');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'transferred') $$,
                 '22023', 'That agent is not available',
                 'f1 a transfer to a Fulfillment user is rejected');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'booked') $$,
                 '22023', 'That agent is not available',
                 'f2 a booking for a Fulfillment user is rejected');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'transferred') $$,
                 '22023', 'That agent is not available',
                 'f3 a transfer to an agent whose access is off is rejected');
select throws_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000006', '99999999-9999-4999-8999-999999999999', 'transferred') $$,
                 '22023', 'That agent is not available',
                 'f4 a transfer to an id that is nobody is rejected');
select throws_ok($$ select public.va_save_policy_help_lead('New', 'Caller', '5125550199', 'Austin', 'TX', '{}'::jsonb, 'transfer', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001') $$,
                 '22023', 'That agent is not available',
                 'f5 saving a caller with a transfer to a non-agent is rejected');
reset role;
select is(
  (select coalesce(transfer_agent_id::text, '-') || ':' || coalesce(transfer_status, '-') || ':' || (va_claimed_by is not null)
     from public.leads where id = 'cccccccc-cccc-4ccc-8ccc-000000000006'),
  '-:-:true',
  'f6 the rejected transfers wrote no transfer and the VA still holds the lead');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$ select public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'transferred') $$,
                'f7 a transfer to an active agent is accepted');
reset role;
select is(
  (select transfer_agent_id::text || ':' || transfer_status || ':' || va_outcome || ':' || (va_claimed_by is null) || ':' || (assigned_rep_id is null)
     from public.leads where id = 'cccccccc-cccc-4ccc-8ccc-000000000006'),
  'aaaaaaaa-aaaa-4aaa-8aaa-000000000001:requested:transferred:true:true',
  'f8 the transfer is a record only: agent and status set, claim ended, assigned_rep_id untouched');

-- ── g. Booking sends nothing ────────────────────────────────────────────────
select skip(1, 'g1 weekly cap: 175 has no va_book and no weekly cap, so there is nothing to test yet');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select lives_ok($$
  do $do$ begin
    perform public.va_claim('cccccccc-cccc-4ccc-8ccc-000000000002');
    perform public.va_set_lead_outcome('cccccccc-cccc-4ccc-8ccc-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'booked');
  end $do$
$$, 'g2 a VA can claim a lead and book it for an active agent');
reset role;
select is(
  (select va_outcome || ':' || transfer_agent_id::text || ':' || (va_claimed_by is null)
     from public.leads where id = 'cccccccc-cccc-4ccc-8ccc-000000000002'),
  'booked:aaaaaaaa-aaaa-4aaa-8aaa-000000000001:true',
  'g3 the booking is recorded for that agent and the claim ended');
select is(
  (select ((select count(*) from public.notification_emails) - b.emails) || ',' ||
          ((select count(*) from public.notification_pushes) - b.pushes) || ',' ||
          ((select count(*) from public.recovery_sms_log) - b.sms)
     from va_before b),
  '0,0,0',
  'g4 nothing was written to the email, push or SMS tables by any call in this file');
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_%'
      and p.prosrc ~* '(notification_emails|notification_pushes|recovery_sms_log|net\.http|pg_notify)'),
  0::bigint,
  'g5 no va_* function body mentions an outbound message table, http call or notify');

-- ── h. No price, money, consent, tracking or email in what comes back ───────
select is(
  (select count(*) from pg_proc p, lateral unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_%'
      and a.m in ('o', 't', 'b')
      and a.n ~* '(price|cents|charge|balance|consent|utm|email)'),
  0::bigint,
  'h1 no va_* result column is named price, cents, charge, balance, consent, utm or email');
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_%'
      and pg_get_function_result(p.oid) ~* '(price|cents|charge|balance|consent|utm|email)'),
  0::bigint,
  'h2 no va_* return type text mentions price, cents, charge, balance, consent, utm or email');
select is(
  (select count(*) from pg_proc p, lateral unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.pronamespace = 'public'::regnamespace and p.proname = 'va_queue' and a.m = 't'),
  15::bigint,
  'h3 the column check sees va_queue''s 15 result columns (so h1 is not passing on an empty list)');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(
  (select count(*) from public.va_queue() q, lateral jsonb_object_keys(to_jsonb(q)) k
    where k ~* '(price|cents|charge|balance|consent|utm|email)'),
  0::bigint,
  'h4 the rows va_queue really returns carry no such key');
reset role;

-- ── i. Every va_* function is security definer with a fixed search_path ─────
select ok(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'),
          format('i1 %s is security definer with search_path set', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'va\_%'
 order by p.proname;

select * from finish();
rollback;
