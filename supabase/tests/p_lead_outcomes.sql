-- p_lead_outcomes — pgTAP checks for 215_lead_outcomes.sql: Sold only records, Follow up
-- takes a date, Not interested takes a reason, and agent_inbounds() says when a follow-up
-- is due.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No robot
-- can run SQL against Ohvara, and none did. Everything runs in one transaction that is
-- rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_lead_outcomes.sql` replays every migration into an in-memory PGlite
-- and runs this file there. It has no database URL and can't reach Ohvara. A pass there
-- is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agents A and B (active), C (inactive), D (the demo side), admin Z. Leads (last
-- two characters of the id):
--   a1 sold, three arguments        a2 sold, with a policy     a3 follow up
--   a4 not interested               a5 one lead through all three outcomes
--   a6 no outcome                   b1 B's                     c1 C's
--   d1 D's, a sample lead           ee nobody holds it         f1 a cancellation lead

begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_lead_outcomes_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8207-00000000000a'::uuid, 'agent_a'),
    ('aaaaaaaa-aaaa-4aaa-8207-00000000000b'::uuid, 'agent_b'),
    ('aaaaaaaa-aaaa-4aaa-8207-00000000000c'::uuid, 'agent_c'),
    ('aaaaaaaa-aaaa-4aaa-8207-00000000000d'::uuid, 'agent_d'),
    ('dddddddd-dddd-4ddd-8207-000000000001'::uuid, 'admin_z')
  ) as u(id, n);
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8207-000000000001';
update public.profiles set is_demo = true where id = 'aaaaaaaa-aaaa-4aaa-8207-00000000000d';

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, assigned_rep_id, is_sample)
select ('cccccccc-cccc-4ccc-8207-0000000000' || l.k)::uuid, 'Lead ' || l.k, 'Lead ' || l.k, l.phone, 'TX', l.t, 'meta', l.rep::uuid, l.sample
  from (values
    ('a1', '+15125552071', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000a', false),
    ('a2', '+15125552072', 'policy_help',         'aaaaaaaa-aaaa-4aaa-8207-00000000000a', false),
    ('a3', '+15125552073', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000a', false),
    ('a4', '+15125552074', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000a', false),
    ('a5', '+15125552075', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000a', false),
    ('a6', '+15125552076', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000a', false),
    ('b1', '+15125552077', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000b', false),
    ('c1', '+15125552078', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000c', false),
    ('d1', '+15125552079', 'mortgage_protection', 'aaaaaaaa-aaaa-4aaa-8207-00000000000d', true),
    ('ee', '+15125552080', 'mortgage_protection', null, false)
  ) as l(k, phone, t, rep, sample);
insert into public.leads (id, business_name, phone, state)
values ('cccccccc-cccc-4ccc-8207-0000000000f1', 'Lead f1', '+15125552081', 'TX');

-- C's access goes off after C's lead is in place.
update public.profiles set is_active = false where id = 'aaaaaaaa-aaaa-4aaa-8207-00000000000c';

-- A's second lead points at a policy, the case the old Sold seeded onto.
insert into public.policies (id, agent_id, client_first_name, client_last_name, status, fulfillment_assigned, replaced_old_policy)
values ('eeeeeeee-eeee-4eee-8207-000000000001', 'aaaaaaaa-aaaa-4aaa-8207-00000000000a', 'Case', 'Sold', 'In Effect', false, false);
update public.leads set client_policy_id = 'eeeeeeee-eeee-4eee-8207-000000000001'
 where id = 'cccccccc-cccc-4ccc-8207-0000000000a2';

create temp table before_all as select (select count(*) from public.servicing_tasks) as tasks;

-- ── a. The shape ────────────────────────────────────────────────────────────
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_inbound_outcome'), 1::bigint,
          'a1 exactly one set_inbound_outcome exists');
select is(to_regprocedure('public.set_inbound_outcome(uuid, text, text)'), null, 'a2 the three-argument signature is gone');
select is((select pg_get_function_arguments(oid) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_inbound_outcome'),
          'p_lead uuid, p_outcome text, p_note text DEFAULT NULL::text, p_follow_up_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text',
          'a3 the arguments and defaults are as the contract says');
select is((select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text
                             || ':' || coalesce(array_to_string(p.proconfig, ';'), ''), ',' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('agent_inbounds', 'set_inbound_outcome')),
          'agent_inbounds:invoker:s:search_path=public,set_inbound_outcome:definer:v:search_path=public',
          'a4 definer, invoker, stable and search_path are as the contract says');
select ok(not has_function_privilege('public', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
          and has_function_privilege('authenticated', p.oid, 'execute'),
          format('a5 %s is closed to public and anon, open to authenticated', p.proname))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('agent_inbounds', 'set_inbound_outcome')
 order by p.proname;
select is((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)
             from information_schema.columns
            where table_schema = 'public' and table_name = 'leads' and column_name in ('follow_up_at', 'outcome_reason')),
          'follow_up_at:timestamp with time zone:YES,outcome_reason:text:YES', 'a6 both columns are there, nullable');
select throws_ok($$ update public.leads set outcome_reason = repeat('x', 501) where id = 'cccccccc-cccc-4ccc-8207-0000000000a6' $$,
                 '23514', null, 'a7 the table refuses a reason over 500 characters');
select is(to_regclass('public.lead_text_templates'), null, 'a8 no template table: this file texts nobody');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'agent_send_lead_text'), 0::bigint,
          'a9 no send function');
select ok(obj_description('public.servicing_tasks'::regclass) not like '%set_inbound_outcome%'
          and obj_description('public.servicing_tasks'::regclass) like '%servicing_seed_steps%',
          'a10 the servicing_tasks comment no longer names set_inbound_outcome as a writer');

-- ── b. Sold only records ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
-- The argument names useInbounds.js:179 sends, exactly.
select is(public.set_inbound_outcome(p_lead => 'cccccccc-cccc-4ccc-8207-0000000000a1', p_outcome => 'sold', p_note => 'Signed today'), 'sold',
          'b1 the three-argument call still works');
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a2', 'sold'), 'sold', 'b2 so does the two-argument one, on a lead with a policy');
reset role;
select is((select string_agg(right(id::text, 2) || ':' || outcome || ':' || right(outcome_by::text, 1) || ':' || inbound_stage || ':' || agent_status || ':' || (outcome_at = now()), ',' order by id)
             from public.leads where id in ('cccccccc-cccc-4ccc-8207-0000000000a1', 'cccccccc-cccc-4ccc-8207-0000000000a2')),
          'a1:sold:a:sold:closed:true,a2:sold:a:sold:closed:true', 'b3 both record outcome, outcome_at, outcome_by and stage sold');
select is((select count(*) from public.servicing_tasks), (select tasks from before_all), 'b4 no servicing task anywhere');
select is((select count(*) from public.servicing_tasks where lead_id in ('cccccccc-cccc-4ccc-8207-0000000000a1', 'cccccccc-cccc-4ccc-8207-0000000000a2')
                                                          or policy_id = 'eeeeeeee-eeee-4eee-8207-000000000001'), 0::bigint,
          'b5 none on these leads or the policy');
select is((select count(*) from public.inbound_events where kind = 'became_client'
             and lead_id in ('cccccccc-cccc-4ccc-8207-0000000000a1', 'cccccccc-cccc-4ccc-8207-0000000000a2')), 0::bigint,
          'b6 no became_client row');
select is((select string_agg(kind || ':' || label || ':' || (detail ->> 'outcome') || ':' || (detail ->> 'from_stage') || ':' || coalesce(detail ->> 'note', '-') || ':' || actor_role, ',')
             from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a1'),
          'outcome:Sold:sold:new:Signed today:agent', 'b7 one outcome event, with the note');
select is((select count(*) from public.inbound_events
            where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a1' and detail ?| array['follow_up_at', 'reason']), 0::bigint,
          'b8 and no date or reason on it');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a1', 'sold', null, now() + interval '1 day', 'Ignored'), 'sold',
          'b9 Sold with a stray date and reason still works');
reset role;
select is((select (follow_up_at is null) || ':' || (outcome_reason is null) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a1'),
          'true:true', 'b10 and stores neither');
select is((select count(*) from public.servicing_tasks), (select tasks from before_all), 'b11 pressing Sold again seeds nothing either');

-- ── c. Follow up takes a date in the future ─────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a3', 'follow_up') $$,
                 '22023', 'Pick a follow up date', 'c1 Follow up with no date is refused');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a3', 'follow_up', 'Call Friday') $$,
                 '22023', 'Pick a follow up date', 'c2 so is the three-argument call');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a3', 'follow_up', null, now() - interval '1 minute') $$,
                 '22023', 'Pick a follow up date in the future', 'c3 a date in the past is refused');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a3', 'follow_up', null, now()) $$,
                 '22023', 'Pick a follow up date in the future', 'c4 and so is right now');
reset role;
select is((select concat_ws(':', coalesce(outcome, '-'), inbound_stage, follow_up_at is null) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a3'),
          '-:new:t', 'c5 the refused calls changed nothing');
select is((select count(*) from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a3'), 0::bigint, 'c6 and logged nothing');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a3', 'follow_up', 'Call Friday', now() + interval '3 days'), 'follow_up',
          'c7 a date in the future is taken');
reset role;
select is((select concat_ws(':', outcome, inbound_stage, agent_status, follow_up_at = now() + interval '3 days', outcome_reason is null)
             from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a3'),
          'follow_up:follow_up:contacted:t:t', 'c8 it is stored in follow_up_at');
select is((select concat_ws(':', kind, label, detail ->> 'outcome', detail ->> 'note', (detail ->> 'follow_up_at')::timestamptz = now() + interval '3 days')
             from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a3'),
          'outcome:Follow up:follow_up:Call Friday:t', 'c9 and on the one event it logs');
select is((select count(*) from public.servicing_tasks), (select tasks from before_all), 'c10 and no servicing task');

-- ── d. Not interested takes a reason ────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a4', 'not_interested') $$,
                 '22023', 'Say why they are not interested', 'd1 Not interested with no reason is refused');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a4', 'not_interested', 'A note is not a reason') $$,
                 '22023', 'Say why they are not interested', 'd2 a note does not count');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a4', 'not_interested', null, null, '') $$,
                 '22023', 'Say why they are not interested', 'd3 an empty reason is refused');
select throws_ok(format('select public.set_inbound_outcome(%L, %L, null, null, %L)', 'cccccccc-cccc-4ccc-8207-0000000000a4', 'not_interested', E'  \n\t '),
                 '22023', 'Say why they are not interested', 'd4 so is one of only spaces and line breaks');
select throws_ok(format('select public.set_inbound_outcome(%L, %L, null, null, %L)', 'cccccccc-cccc-4ccc-8207-0000000000a4', 'not_interested', repeat('x', 501)),
                 '22023', 'Keep the reason to 500 characters', 'd5 501 characters is refused');
reset role;
select is((select concat_ws(':', coalesce(outcome, '-'), inbound_stage, outcome_reason is null) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a4'),
          '-:new:t', 'd6 the refused calls changed nothing');
select is((select count(*) from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a4'), 0::bigint, 'd7 and logged nothing');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a4', 'not_interested', null, null, '  Has a policy elsewhere  '), 'lost',
          'd8 a reason is taken and the lead reads lost');
reset role;
select is((select concat_ws(':', outcome, inbound_stage, agent_status, outcome_reason, follow_up_at is null)
             from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a4'),
          'not_interested:lost:bad:Has a policy elsewhere:t', 'd9 it is stored, trimmed');
select is((select concat_ws(':', kind, label, detail ->> 'outcome', detail ->> 'reason')
             from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a4'),
          'outcome:Not interested:not_interested:Has a policy elsewhere', 'd10 and on the one event it logs');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a4', 'not_interested', null, null, '   ' || repeat('y', 500) || '   '), 'lost',
          'd11 exactly 500 after trimming is taken');
reset role;
select is((select length(outcome_reason) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a4'), 500, 'd12 and stored whole');

-- ── e. Each outcome replaces the last one's date and reason ─────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a5', 'follow_up', null, now() + interval '1 day');
select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a5', 'not_interested', null, null, 'Changed their mind');
reset role;
select is((select concat_ws(':', follow_up_at is null, outcome_reason) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a5'),
          't:Changed their mind', 'e1 Not interested clears the follow up date');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a5', 'follow_up', null, now() + interval '2 days');
reset role;
select is((select concat_ws(':', follow_up_at = now() + interval '2 days', outcome_reason is null) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a5'),
          't:t', 'e2 Follow up clears the reason');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a5', 'sold');
reset role;
select is((select concat_ws(':', outcome, follow_up_at is null, outcome_reason is null) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000a5'),
          'sold:t:t', 'e3 Sold clears the date');
select is((select count(*) from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a5' and kind = 'outcome'
              and detail ? 'follow_up_at') || '/' ||
          (select count(*) from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a5' and kind = 'outcome'
              and detail ->> 'reason' = 'Changed their mind'),
          '2/1', 'e4 the event log keeps both dates and the reason');

-- ── f. agent_inbounds ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select string_agg(right(lead_id::text, 2), ',' order by lead_id) from public.agent_inbounds()), 'a1,a2,a3,a4,a5,a6',
          'f1 A still lists only A''s leads');
select is((select follow_up_at = now() + interval '3 days' and not follow_up_due and outcome_reason is null
             from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a3'), true,
          'f2 a follow-up in the future comes back with its date, not due');
select is((select follow_up_due from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a6'), false,
          'f3 a lead with no outcome is not due, and not null');
select is((select outcome_reason from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a4'), repeat('y', 500),
          'f4 a reason comes back');
select is((select contact_name || ':' || inbound_product || ':' || inbound_stage from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a3'),
          'Lead a3:booked_appointment:follow_up', 'f5 the old columns still read the same');
select is((select live_call_result from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a3'), null,
          'f6 and live_call_result stays null on a booked appointment');
reset role;

-- The clock passes the date. Set by the owner: no call can write a past date.
update public.leads set follow_up_at = now() - interval '1 minute' where id = 'cccccccc-cccc-4ccc-8207-0000000000a3';
update public.leads set follow_up_at = now() where id = 'cccccccc-cccc-4ccc-8207-0000000000a5';
update public.leads set outcome = 'follow_up' where id = 'cccccccc-cccc-4ccc-8207-0000000000a5';
update public.leads set follow_up_at = now() - interval '1 minute' where id = 'cccccccc-cccc-4ccc-8207-0000000000a2';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is((select follow_up_due from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a3'), true,
          'f7 a follow-up past its date is due');
select is((select follow_up_due from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a5'), true,
          'f8 and at its date exactly');
select is((select follow_up_due from public.agent_inbounds() where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a2'), false,
          'f9 a date left on a sold lead is never due');
reset role;

-- ── g. Who is refused ───────────────────────────────────────────────────────
create temp table before_refused as
  select (select count(*) from public.inbound_events) as events,
         (select string_agg(row(id, outcome, outcome_at, inbound_stage, follow_up_at, outcome_reason)::text, ',' order by id)
            from public.leads where id in ('cccccccc-cccc-4ccc-8207-0000000000b1', 'cccccccc-cccc-4ccc-8207-0000000000c1', 'cccccccc-cccc-4ccc-8207-0000000000ee')) as leads;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000b1', 'sold') $$,
                 '42501', 'Only the lead''s agent can do this', 'g1 another agent cannot mark a lead sold');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000b1', 'follow_up', null, now() + interval '1 day') $$,
                 '42501', 'Only the lead''s agent can do this', 'g2 nor follow up, with a good date');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000b1', 'not_interested', null, null, 'Mine now') $$,
                 '42501', 'Only the lead''s agent can do this', 'g3 nor not interested, with a good reason');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000b1', 'follow_up') $$,
                 '42501', 'Only the lead''s agent can do this', 'g4 and a stranger with no date hears only that');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000ee', 'follow_up', null, now() + interval '1 day') $$,
                 '42501', 'Only the lead''s agent can do this', 'g5 nobody''s lead is refused too');
select throws_ok($$ select public.set_inbound_outcome('99999999-9999-4999-8999-999999999999', 'sold') $$,
                 '42501', 'Only the lead''s agent can do this', 'g6 a lead that doesn''t exist gets the same answer');
select throws_ok($$ select public.set_inbound_outcome(null, 'sold') $$, '22004', 'lead is required', 'g7 no lead raises 22004');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a6', 'maybe') $$, '22023', 'Unknown outcome maybe', 'g8 an unknown outcome raises 22023');
select throws_ok($$ update public.leads set outcome_reason = 'x', follow_up_at = now() where id = 'cccccccc-cccc-4ccc-8207-0000000000a6' $$,
                 '42501', 'Only the lead status can be changed', 'g9 an agent cannot write the two columns directly');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000c1', 'follow_up', null, now() + interval '1 day') $$,
                 '42501', 'Only the lead''s agent can do this', 'g10 an inactive agent cannot act on their own lead');
reset role;
select set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000a6', 'sold') $$,
                 '42501', 'permission denied for function set_inbound_outcome', 'g11 anon is refused the write');
select throws_ok($$ select * from public.agent_inbounds() $$,
                 '42501', 'permission denied for function agent_inbounds', 'g12 anon is refused the list');
reset role;
select is((select string_agg(row(id, outcome, outcome_at, inbound_stage, follow_up_at, outcome_reason)::text, ',' order by id)
             from public.leads where id in ('cccccccc-cccc-4ccc-8207-0000000000b1', 'cccccccc-cccc-4ccc-8207-0000000000c1', 'cccccccc-cccc-4ccc-8207-0000000000ee')),
          (select leads from before_refused), 'g13 no refused call changed a lead');
select is((select count(*) from public.inbound_events), (select events from before_refused), 'g14 or wrote an event');

-- ── h. The admin, and the refusals only an admin reaches ────────────────────
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8207-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000b1', 'follow_up', null, now() + interval '1 day'), 'follow_up',
          'h1 an admin sets an outcome on B''s lead');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000b1', 'follow_up') $$,
                 '22023', 'Pick a follow up date', 'h2 and needs a date like anyone');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000ee', 'sold') $$,
                 '22023', 'Give the lead to an agent before marking it sold', 'h3 nobody''s lead can''t be sold');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000f1', 'sold') $$,
                 '22023', 'This is not an inbound lead', 'h4 a cancellation lead is refused');
select throws_ok($$ select public.set_inbound_outcome('99999999-9999-4999-8999-999999999999', 'sold') $$,
                 'P0002', 'Lead not found', 'h5 a lead that doesn''t exist is not found');
reset role;

-- ── i. Demo and sample ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000d","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8207-0000000000d1', 'sold'), 'sold', 'i1 a demo agent''s sample lead takes an outcome like any other');
reset role;
select is((select concat_ws(':', outcome, is_sample) from public.leads where id = 'cccccccc-cccc-4ccc-8207-0000000000d1'), 'sold:t', 'i2 and stays a sample lead');

-- ── j. The feed ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8207-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
create temp table feed as
  select * from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', 'aaaaaaaa-aaaa-4aaa-8207-00000000000a', 5000);
reset role;
select is((select count(*) from feed where lead_id = 'cccccccc-cccc-4ccc-8207-0000000000a3' and kind = 'outcome' and title = 'Outcome marked: follow up.'), 1::bigint,
          'j1 a follow up shows in the feed as before');
select is((select count(*) from feed where meta::text like '%yyyyyyyy%'), 0::bigint, 'j2 and the reason doesn''t travel into it');

select * from finish();
rollback;
