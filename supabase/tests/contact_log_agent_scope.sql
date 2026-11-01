-- contact_log_agent_scope — pgTAP checks that a signed-in agent gets contact_log rows
-- for their own clients and leads and never another agent's.
--
-- RUN: at apply time, by the apply step, after contact_log's migration is applied. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one transaction
-- that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/contact_log_agent_scope.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It can't reach Ohvara. A pass there is not a pass on
-- the real stack: it is a stand-in for Supabase.
--
-- NEEDS contact_log(text, uuid, timestamptz, int) from 199_contact_log.sql. If that is
-- ever missing, a1 fails and the file stops with 42883 "function public.contact_log(text,
-- uuid) does not exist". That is on purpose: a security test that skips itself when the
-- function is gone reads as a pass.
--
-- Only names the function already returns are read, one by one, so a later migration
-- that adds columns doesn't break this file. p_contact_log.sql covers each source's
-- values, the demo wall, uplines and other roles; this file is only the agent wall.
--
-- Cast: agents A and B, no upline link. Every source has one row for each of them, so a
-- union branch that loses its check shows here.
--   policies (last digit)   1 A's client   2 B's client   3 and 4 the same person,
--                           on A's book and on B's
--   leads (last digit)      1 A's          2 B's          3 assigned to B, transferred to A

begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ── helpers ─────────────────────────────────────────────────────────────────
create temp table seen (who text not null, id text, lead_id uuid, policy_id uuid, agent_id uuid, channel text, body text,
                        has_recording boolean, is_sample boolean);
grant all on seen to authenticated;

create function public.p_cas_claims(p_caller uuid) returns text language sql as $f$
  select json_build_object('sub', p_caller, 'role', 'authenticated')::text
$f$;

-- Runs contact_log as this person and keeps what came back under a name.
create function public.p_cas_load(p_who text, p_caller uuid, p_key text default null, p_lead uuid default null)
returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', public.p_cas_claims(p_caller), true);
  perform set_config('role', 'authenticated', true);
  insert into seen (who, id, lead_id, policy_id, agent_id, channel, body, has_recording, is_sample)
  select p_who, c.id, c.lead_id, c.policy_id, c.agent_id, c.channel, c.body, c.has_recording, c.is_sample
    from public.contact_log(p_key, p_lead) c;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$f$;

create function public.p_cas_count(p_who text) returns bigint language sql as $f$
  select count(*) from seen s where s.who = p_who
$f$;

-- Reads the view as the table owner, so a check can pass one agent's key as the other.
create function public.p_cas_key(p_policy uuid) returns text language sql as $f$
  select s.client_key from public.policy_servicing_status s where s.policy_id = p_policy
$f$;

-- ── a. The function is there ────────────────────────────────────────────────
select ok(to_regprocedure('public.contact_log(text, uuid, timestamptz, int)') is not null,
          'a1 contact_log(text, uuid, timestamptz, int) exists');

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'contact_log_scope_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid, 'agent_a'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002'::uuid, 'agent_b')
  ) as u(id, n);

insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, status, effective_date,
                             fulfillment_assigned, fulfillment_stage, replaced_old_policy)
select v.id, v.agent, v.first, v.last, v.phone, 'In Effect', current_date - 100, true, 'Pending', false
  from (values
    ('dddddddd-dddd-4ddd-8ddd-000000000001'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid, 'Ann', 'Alpha',  '5125550101'),
    ('dddddddd-dddd-4ddd-8ddd-000000000002'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'::uuid, 'Bea', 'Beta',   '5125550102'),
    ('dddddddd-dddd-4ddd-8ddd-000000000003'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid, 'Sam', 'Shared', '5125550103'),
    ('dddddddd-dddd-4ddd-8ddd-000000000004'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'::uuid, 'Sam', 'Shared', '5125550103')
  ) as v(id, agent, first, last, phone);

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, assigned_rep_id, transfer_agent_id,
                          va_outcome, va_attempts, va_last_worked_at)
values
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'Lead A', 'Lead A', '+15125550201', 'TX', 'mortgage_protection',
   'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', null, 'not_reached', 1, '2026-10-01 10:10:00+00'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', 'Lead B', 'Lead B', '+15125550202', 'TX', 'mortgage_protection',
   'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', null, 'not_reached', 1, '2026-10-01 11:10:00+00'),
  ('cccccccc-cccc-4ccc-8ccc-000000000003', 'Lead B too', 'Lead B too', '+15125550203', 'TX', 'policy_help',
   'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', null, 0, null);

-- One row per source for each agent. The words carry whose they are.
insert into public.lead_followup_sms_log (lead_id, stage, status, created_at) values
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'just_submitted', 'sent', '2026-10-01 10:01:00+00'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', 'just_submitted', 'sent', '2026-10-01 11:01:00+00');

insert into public.lead_sms_replies (from_phone, body, twilio_sid, lead_id, received_at) values
  ('+15125550201', 'words for A', 'SM_scope_a',  'cccccccc-cccc-4ccc-8ccc-000000000001', '2026-10-01 10:02:00+00'),
  ('+15125550202', 'words for B', 'SM_scope_b',  'cccccccc-cccc-4ccc-8ccc-000000000002', '2026-10-01 11:02:00+00'),
  ('+15125550203', 'words for B', 'SM_scope_b2', 'cccccccc-cccc-4ccc-8ccc-000000000003', '2026-10-01 11:03:00+00');

insert into public.inbound_events (lead_id, agent_id, kind, state, at, label, detail) values
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'text_sent', 'done', '2026-10-01 10:03:00+00', 'Follow-up text', '{"step":"instant","seq":1}'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'text_sent', 'done', '2026-10-01 11:04:00+00', 'Follow-up text', '{"step":"instant","seq":1}');

insert into public.recovery_sms_log (policy_id, kind, ok, skipped, created_at) values
  ('dddddddd-dddd-4ddd-8ddd-000000000001', 'text1', true, null, '2026-10-01 10:04:00+00'),
  ('dddddddd-dddd-4ddd-8ddd-000000000002', 'text1', true, null, '2026-10-01 11:05:00+00'),
  ('dddddddd-dddd-4ddd-8ddd-000000000003', 'text1', true, null, '2026-10-01 10:05:00+00'),
  ('dddddddd-dddd-4ddd-8ddd-000000000004', 'text1', true, null, '2026-10-01 11:06:00+00');

insert into public.appointments (id, lead_id, scheduled_at) values
  ('eeeeeeee-eeee-4eee-8eee-000000000001', 'cccccccc-cccc-4ccc-8ccc-000000000001', '2026-10-02 15:00:00+00'),
  ('eeeeeeee-eeee-4eee-8eee-000000000002', 'cccccccc-cccc-4ccc-8ccc-000000000002', '2026-10-02 16:00:00+00');
insert into public.reminder_log (appointment_id, scheduled_time, send_time, status, channel, message_body, twilio_message_sid) values
  ('eeeeeeee-eeee-4eee-8eee-000000000001', '2026-10-01 10:06:00+00', '2026-10-01 10:06:00+00', 'sent', 'sms', 'words for A', 'SM_scope_rem_a'),
  ('eeeeeeee-eeee-4eee-8eee-000000000002', '2026-10-01 11:07:00+00', '2026-10-01 11:07:00+00', 'sent', 'sms', 'words for B', 'SM_scope_rem_b');

insert into public.calls (lead_id, rep_id, call_outcome, created_at) values
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'no_answer', '2026-10-01 10:07:00+00'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'no_answer', '2026-10-01 11:08:00+00');

insert into public.help_calls (call_sid, lead_id, status, outcome, created_at) values
  ('CA_scope_help_a', 'cccccccc-cccc-4ccc-8ccc-000000000001', 'ended', 'booked', '2026-10-01 10:08:00+00'),
  ('CA_scope_help_b', 'cccccccc-cccc-4ccc-8ccc-000000000002', 'ended', 'booked', '2026-10-01 11:09:00+00');

insert into public.policy_events (policy_id, agent_id, kind, actor_name, actor_role, detail, at) values
  ('dddddddd-dddd-4ddd-8ddd-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'no_answer', 'Rita Rep', 'fulfillment', '{"attempt":1}', '2026-10-01 10:09:00+00'),
  ('dddddddd-dddd-4ddd-8ddd-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'no_answer', 'Rita Rep', 'fulfillment', '{"attempt":1}', '2026-10-01 11:11:00+00');

insert into public.fulfillment_voice_legs (call_sid, policy_id, party, status, started_at, answered_at, end_reason) values
  ('CA_scope_leg_a', 'dddddddd-dddd-4ddd-8ddd-000000000001', 'client', 'ended', '2026-10-01 10:11:00+00', null, 'no-answer'),
  ('CA_scope_leg_b', 'dddddddd-dddd-4ddd-8ddd-000000000002', 'client', 'ended', '2026-10-01 11:12:00+00', null, 'no-answer');

-- Every call the checks read, loaded once. The names say who asked for what.
select public.p_cas_load('a_all',       'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'),
       public.p_cas_load('a_own_key',   'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000001')),
       public.p_cas_load('a_own_lead',  'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', null, 'cccccccc-cccc-4ccc-8ccc-000000000001'),
       public.p_cas_load('a_b_key',     'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000002')),
       public.p_cas_load('a_b_lead',    'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', null, 'cccccccc-cccc-4ccc-8ccc-000000000002'),
       public.p_cas_load('a_b_transfer','aaaaaaaa-aaaa-4aaa-8aaa-000000000001', null, 'cccccccc-cccc-4ccc-8ccc-000000000003'),
       public.p_cas_load('a_shared',    'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000003')),
       public.p_cas_load('a_b_shared',  'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000004')),
       public.p_cas_load('b_all',       'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'),
       public.p_cas_load('b_own_key',   'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000002')),
       public.p_cas_load('b_a_key',     'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000001')),
       public.p_cas_load('b_a_lead',    'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', null, 'cccccccc-cccc-4ccc-8ccc-000000000001');

-- ── b. A gets A's own rows. Without this, every zero below proves nothing ───
select is(public.p_cas_count('a_all'), 11::bigint, 'b1 A with no filter gets all 11 of A''s rows: ten sources and the shared client');
select is((select count(*) from seen where who = 'a_all' and channel = 'text'), 6::bigint, 'b2 six of them are texts');
select is((select count(*) from seen where who = 'a_all' and channel = 'call'), 5::bigint, 'b3 five of them are calls');
select is(public.p_cas_count('a_own_key'), 3::bigint, 'b4 A asking for A''s client gets that client''s 3 rows');
select is((select count(*) from seen where who = 'a_own_key' and policy_id = 'dddddddd-dddd-4ddd-8ddd-000000000001'), 3::bigint,
          'b5 and all 3 are on that policy');
select is(public.p_cas_count('a_own_lead'), 7::bigint, 'b6 A asking for A''s lead gets that lead''s 7 rows');
select is((select count(*) from seen where who = 'a_own_lead' and lead_id = 'cccccccc-cccc-4ccc-8ccc-000000000001'), 7::bigint,
          'b7 and all 7 are on that lead');
select is((select count(*) from seen where who = 'a_all' and body = 'words for A'), 2::bigint, 'b8 A sees the words on A''s own rows');

-- ── c. A never gets B's rows ────────────────────────────────────────────────
select is(public.p_cas_count('a_b_key'), 0::bigint, 'c1 A asking for B''s client gets zero rows');
select is(public.p_cas_count('a_b_lead'), 0::bigint, 'c2 A asking for B''s lead gets zero rows');
select is(public.p_cas_count('a_b_transfer'), 0::bigint, 'c3 a lead assigned to B and transferred to A is B''s: zero rows');
select is((select count(*) from seen where who like 'a\_%' and agent_id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'), 0::bigint,
          'c4 no call by A returned a row with B as the agent');
select is((select count(*) from seen where who like 'a\_%'
            and policy_id in ('dddddddd-dddd-4ddd-8ddd-000000000002', 'dddddddd-dddd-4ddd-8ddd-000000000004')), 0::bigint,
          'c5 no call by A returned B''s policies');
select is((select count(*) from seen where who like 'a\_%'
            and lead_id in ('cccccccc-cccc-4ccc-8ccc-000000000002', 'cccccccc-cccc-4ccc-8ccc-000000000003')), 0::bigint,
          'c6 no call by A returned B''s leads');
select is((select count(*) from seen where who like 'a\_%' and body = 'words for B'), 0::bigint, 'c7 no call by A returned B''s words');

-- ── d. The same person on both books ────────────────────────────────────────
select isnt(public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000003'), public.p_cas_key('dddddddd-dddd-4ddd-8ddd-000000000004'),
            'd1 the same person has a different key on each agent''s book');
select is(public.p_cas_count('a_shared'), 1::bigint, 'd2 A asking with A''s key for them gets A''s row');
select is((select count(*) from seen where who = 'a_shared' and policy_id = 'dddddddd-dddd-4ddd-8ddd-000000000003'), 1::bigint,
          'd3 and it is on A''s policy');
select is(public.p_cas_count('a_b_shared'), 0::bigint, 'd4 A asking with B''s key for them gets zero rows');

-- ── e. The same wall the other way ──────────────────────────────────────────
select is(public.p_cas_count('b_all'), 12::bigint, 'e1 B with no filter gets all 12 of B''s rows, the transferred lead''s reply included');
select is(public.p_cas_count('b_own_key'), 3::bigint, 'e2 B asking for B''s client gets that client''s 3 rows');
select is(public.p_cas_count('b_a_key'), 0::bigint, 'e3 B asking for A''s client gets zero rows');
select is(public.p_cas_count('b_a_lead'), 0::bigint, 'e4 B asking for A''s lead gets zero rows');
select is((select count(*) from seen x join seen y on y.id = x.id where x.who = 'a_all' and y.who = 'b_all'), 0::bigint,
          'e5 A and B share no row');

-- ── f. The function is the only way in ──────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.contact_log(text, uuid, timestamptz, int)', 'execute'), 'f1 anon has no execute');
select set_config('request.jwt.claims', '', true), set_config('role', 'authenticated', true);
select is((select count(*) from public.contact_log()), 0::bigint, 'f2 authenticated with no user in the claims gets zero rows');
select set_config('request.jwt.claims', public.p_cas_claims('aaaaaaaa-aaaa-4aaa-8aaa-000000000001'), true);
select throws_ok($$ select * from public.lead_followup_sms_log $$, '42501', 'permission denied for table lead_followup_sms_log',
                 'f3 a signed-in agent can''t read lead_followup_sms_log');
select throws_ok($$ select * from public.recovery_sms_log $$, '42501', 'permission denied for table recovery_sms_log',
                 'f4 a signed-in agent can''t read recovery_sms_log');
select throws_ok($$ select * from public.lead_sms_replies $$, '42501', 'permission denied for table lead_sms_replies',
                 'f5 a signed-in agent can''t read lead_sms_replies');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*) from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relname like '%contact\_log%' and c.relkind in ('r', 'v', 'm')
              and has_table_privilege('authenticated', c.oid, 'select')), 0::bigint,
          'f6 no contact log table or view is open to a signed-in user');
select ok((select p.prosecdef and p.proconfig @> array['search_path=public'] from pg_proc p
            where p.oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure),
          'f7 contact_log is security definer with a pinned search_path');

-- ── g. has_recording: true only for a ready recording on the caller's own client ──
-- As the table owner, after the counts above. A conference per leg, so each outcome shows
-- on its own row. A recording's call_sid is the rep's leg, never the client's.
insert into public.fulfillment_voice_legs (call_sid, policy_id, party, conference_sid, status, started_at) values
  ('CA_rec_ready',   'dddddddd-dddd-4ddd-8ddd-000000000001', 'client',  'CF_a_ready',   'ended', '2026-10-02 10:00:00+00'),
  ('CA_rec_going',   'dddddddd-dddd-4ddd-8ddd-000000000001', 'client',  'CF_a_going',   'ended', '2026-10-02 10:01:00+00'),
  ('CA_rec_failed',  'dddddddd-dddd-4ddd-8ddd-000000000001', 'client',  'CF_a_failed',  'ended', '2026-10-02 10:02:00+00'),
  ('CA_rec_none',    'dddddddd-dddd-4ddd-8ddd-000000000001', 'client',  'CF_a_none',    'ended', '2026-10-02 10:03:00+00'),
  ('CA_rec_null',    'dddddddd-dddd-4ddd-8ddd-000000000001', 'client',  null,           'ended', '2026-10-02 10:04:00+00'),
  ('CA_rec_b_conf',  'dddddddd-dddd-4ddd-8ddd-000000000001', 'client',  'CF_b_ready',   'ended', '2026-10-02 10:05:00+00'),
  ('CA_rec_by_sid',  'dddddddd-dddd-4ddd-8ddd-000000000001', 'client',  'CF_a_by_sid',  'ended', '2026-10-02 10:06:00+00'),
  ('CA_rec_b',       'dddddddd-dddd-4ddd-8ddd-000000000002', 'client',  'CF_b_ready',   'ended', '2026-10-02 11:00:00+00');
insert into public.fulfillment_recordings (call_sid, policy_id, conference_sid, recording_sid, status) values
  ('CA_rep_ready',   'dddddddd-dddd-4ddd-8ddd-000000000001', 'CF_a_ready',  'RE_scope_ready',  'ready'),
  ('CA_rep_going',   'dddddddd-dddd-4ddd-8ddd-000000000001', 'CF_a_going',  null,              'recording'),
  ('CA_rep_failed',  'dddddddd-dddd-4ddd-8ddd-000000000001', 'CF_a_failed', 'RE_scope_failed', 'failed'),
  ('CA_rep_null',    'dddddddd-dddd-4ddd-8ddd-000000000001', null,          'RE_scope_null',   'ready'),
  ('CA_rec_by_sid',  'dddddddd-dddd-4ddd-8ddd-000000000001', 'CF_a_other',  'RE_scope_by_sid', 'ready'),
  ('CA_rep_b',       'dddddddd-dddd-4ddd-8ddd-000000000002', 'CF_b_ready',  'RE_scope_b',      'ready');

-- ── h. is_sample: the row's own flag, and the policy's where the source has none ──
insert into public.lead_followup_sms_log (lead_id, stage, status, is_sample, created_at) values
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'not_reached', 'sent', true, '2026-10-02 10:10:00+00');
update public.policies set is_sample = true where id = 'dddddddd-dddd-4ddd-8ddd-000000000003';

select public.p_cas_load('a_new', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'),
       public.p_cas_load('b_new', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002');

create function public.p_cas_rec(p_who text, p_sid text) returns boolean language sql as $f$
  select s.has_recording from seen s where s.who = p_who and s.id = 'fulfillment_voice_legs:' || p_sid
$f$;

select is(public.p_cas_rec('a_new', 'CA_rec_ready'), true, 'g1 A''s client leg with a ready recording reads true');
select is(public.p_cas_rec('a_new', 'CA_rec_going'), false, 'g2 still recording reads false');
select is(public.p_cas_rec('a_new', 'CA_rec_failed'), false, 'g3 a failed recording reads false');
select is(public.p_cas_rec('a_new', 'CA_rec_none'), false, 'g4 no recording reads false');
select is(public.p_cas_rec('a_new', 'CA_rec_null'), false, 'g5 no conference never matches a recording with no conference');
select is(public.p_cas_rec('a_new', 'CA_rec_b_conf'), false, 'g6 B''s ready recording does not turn A''s leg true, even on the same conference');
select is(public.p_cas_rec('a_new', 'CA_rec_by_sid'), false, 'g7 a recording that shares only the call_sid reads false');
select is(public.p_cas_rec('b_new', 'CA_rec_b'), true, 'g8 B''s own leg reads true for B');
select is(public.p_cas_rec('a_new', 'CA_rec_b'), null, 'g9 and A does not get that row at all');
select is((select count(*) from seen where who = 'a_new' and has_recording and id not like 'fulfillment_voice_legs:%'), 0::bigint,
          'g10 no other source ever reads true');
select is((select count(*) from seen where who = 'a_new' and has_recording), 1::bigint, 'g11 A has exactly one true row');
select ok(pg_get_function_result('public.contact_log(text, uuid, timestamptz, int)'::regprocedure) !~ '(recording_sid|recording_id|recording_url)',
          'g12 no recording sid, id or URL column comes back');

select is((select is_sample from seen where who = 'a_new' and body is null and id in (
             select 'lead_followup_sms_log:' || f.id::text from public.lead_followup_sms_log f where f.is_sample)), true,
          'h1 a follow-up marked sample reads is_sample true');
select is((select is_sample from seen where who = 'a_new' and policy_id = 'dddddddd-dddd-4ddd-8ddd-000000000003'), true,
          'h2 a recovery text, which has no flag of its own, reads its sample policy''s');

select * from finish();
rollback;
