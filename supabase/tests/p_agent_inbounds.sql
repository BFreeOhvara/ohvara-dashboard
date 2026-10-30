-- p_agent_inbounds — pgTAP checks for who can see and change an inbound's
-- outcome and notes: agent_inbounds(), inbound_events RLS, set_inbound_outcome
-- and add_inbound_note (180_agent_inbounds.sql, with the caller check fixed by
-- 181_fix_inbound_agent_checks.sql).
--
-- RUN: on a LOCAL database only (`supabase test db` on a local stack, or a
-- local PGlite with pgTAP). Everything runs in one transaction that is rolled
-- back. Never run it against Ohvara's live database. Needs 180 AND 181
-- applied (180 needs 166, 173, 174 and 175 first).
--
-- What it covers:
--   a. visibility: agent A's agent_inbounds() and inbound_events hold only A's
--      leads (not B's, the inactive agent's, or the unassigned one)
--   b. A sets follow_up, then not_interested, and adds a note on A's own lead;
--      the lead and the events read as 180 writes them
--   c. A marks A's other lead sold: three servicing tasks and one
--      became_client event, once, even when sold is pressed twice
--   d. refusals (42501): A on B's lead; A on the unassigned lead (follow_up,
--      not_interested, sold, note); inactive C on C's own lead; C on the
--      unassigned lead. None of them changes a lead or writes an event.
--   e. the admin passes on A's, B's and the unassigned lead
--
-- Why the refusals pin the message too: inbound_events has 151's
-- block_inactive_writer trigger, so an inactive caller's write fails with
-- 42501 ("Your access is off") even when the caller check lets them through.
-- Checking "Only the lead's agent can do this" proves the caller check itself
-- refused.
--
-- Without 181 (180 alone), A's refusals on the unassigned lead fail: d3, d4
-- and d6 (the caller check is null, not false, when assigned_rep_id is null,
-- so the call goes through) and d5 (sold is still refused, but by 180's
-- 22023 "Give the lead to an agent", not the caller check). d11, d14 and d15
-- fail with them, because A's calls changed that lead and wrote events. C's
-- refusals pass either way (run on PGlite, Oct 29): on C's own lead (d7, d8)
-- the check is false, and on the unassigned lead (d9, d10) `null and false`
-- is false too, because C's is_active check is false.
--
-- Cast: agent A and agent B (active), agent C (inactive), admin D. Leads (last
-- two characters of the id):
--   a1 A's booked appointment       a2 A's live call (the sold path)
--   b1 B's booked appointment       c1 C's booked appointment
--   ee a booked appointment nobody holds (assigned_rep_id null)

begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_inbound_agent_checks_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'agent'),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8181-00000000000a'::uuid, 'agent_a'),
    ('aaaaaaaa-aaaa-4aaa-8181-00000000000b'::uuid, 'agent_b'),
    ('aaaaaaaa-aaaa-4aaa-8181-00000000000c'::uuid, 'agent_c'),
    ('dddddddd-dddd-4ddd-8181-000000000001'::uuid, 'admin_d')
  ) as u(id, n);
-- Signup only makes agents and Fulfillment (160), so the admin is set here.
update public.profiles set role = 'admin' where id = 'dddddddd-dddd-4ddd-8181-000000000001';

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source,
                          assigned_rep_id, delivered_at, created_at)
values
  ('cccccccc-cccc-4ccc-8181-0000000000a1', 'Lead a1', 'Lead a1', '+15125551811', 'TX', 'mortgage_protection', 'meta',
   'aaaaaaaa-aaaa-4aaa-8181-00000000000a', now() - interval '2 days', now() - interval '2 days'),
  ('cccccccc-cccc-4ccc-8181-0000000000a2', 'Lead a2', 'Lead a2', '+15125551812', 'TX', 'policy_help', 'google',
   'aaaaaaaa-aaaa-4aaa-8181-00000000000a', now() - interval '1 day', now() - interval '1 day'),
  ('cccccccc-cccc-4ccc-8181-0000000000b1', 'Lead b1', 'Lead b1', '+15125551813', 'TX', 'mortgage_protection', 'meta',
   'aaaaaaaa-aaaa-4aaa-8181-00000000000b', now() - interval '3 days', now() - interval '3 days'),
  ('cccccccc-cccc-4ccc-8181-0000000000c1', 'Lead c1', 'Lead c1', '+15125551814', 'TX', 'mortgage_protection', 'meta',
   'aaaaaaaa-aaaa-4aaa-8181-00000000000c', now() - interval '4 days', now() - interval '4 days'),
  ('cccccccc-cccc-4ccc-8181-0000000000ee', 'Lead ee', 'Lead ee', '+15125551815', 'TX', 'mortgage_protection', 'meta',
   null, null, now() - interval '5 days');

-- C's access goes off after C's lead is in place (173 only lets an active agent
-- take a typed lead).
update public.profiles set is_active = false where id = 'aaaaaaaa-aaaa-4aaa-8181-00000000000c';

-- Something on A's, B's and the unassigned lead for the visibility checks.
insert into public.inbound_events (lead_id, agent_id, kind, label)
values ('cccccccc-cccc-4ccc-8181-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8181-00000000000a', 'came_in', 'Came in'),
       ('cccccccc-cccc-4ccc-8181-0000000000b1', 'aaaaaaaa-aaaa-4aaa-8181-00000000000b', 'came_in', 'Came in'),
       ('cccccccc-cccc-4ccc-8181-0000000000c1', 'aaaaaaaa-aaaa-4aaa-8181-00000000000c', 'came_in', 'Came in'),
       ('cccccccc-cccc-4ccc-8181-0000000000ee', null, 'came_in', 'Came in');

select is(
  (select string_agg(right(l.id::text, 2) || ':' || coalesce(right(l.assigned_rep_id::text, 1), '-') || ':' ||
                     coalesce(p.is_active::text, '-') || ':' || l.inbound_stage, ',' order by l.id)
     from public.leads l left join public.profiles p on p.id = l.assigned_rep_id
    where l.id::text like 'cccccccc-cccc-4ccc-8181-%'),
  'a1:a:true:new,a2:a:true:new,b1:b:true:new,c1:c:false:new,ee:-:-:new',
  'p1 seed: a1/a2 are A''s, b1 is B''s, c1 is inactive C''s, ee has no agent; all start new');

-- ── a. Visibility as A ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(
  (select array_agg(i.lead_id order by i.lead_id) from public.agent_inbounds() i),
  array['cccccccc-cccc-4ccc-8181-0000000000a1', 'cccccccc-cccc-4ccc-8181-0000000000a2']::uuid[],
  'a1 agent_inbounds() as A returns a1 and a2 only (not b1, c1 or the unassigned ee)');
select is(
  (select array_agg(id order by id) from public.leads where lead_type <> 'cancellation'),
  array['cccccccc-cccc-4ccc-8181-0000000000a1', 'cccccccc-cccc-4ccc-8181-0000000000a2']::uuid[],
  'a2 select on leads as A shows only A''s two inbounds');
select is(
  (select array_agg(distinct lead_id) from public.inbound_events),
  array['cccccccc-cccc-4ccc-8181-0000000000a1']::uuid[],
  'a3 select on inbound_events as A returns rows for A''s lead only');
select is(
  (select count(*) from public.inbound_events
    where lead_id in ('cccccccc-cccc-4ccc-8181-0000000000b1', 'cccccccc-cccc-4ccc-8181-0000000000c1',
                      'cccccccc-cccc-4ccc-8181-0000000000ee')),
  0::bigint,
  'a4 A reads 0 inbound_events on b1, c1 and the unassigned ee');
reset role;

-- ── b. A on A's own lead ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000a1', 'follow_up', 'Call back Friday'), 'follow_up',
          'b1 A sets follow_up on a1 and gets stage follow_up back');
reset role;
select is(
  (select outcome || ':' || right(outcome_by::text, 1) || ':' || inbound_stage || ':' || agent_status || ':' || (outcome_at is not null)
     from public.leads where id = 'cccccccc-cccc-4ccc-8181-0000000000a1'),
  'follow_up:a:follow_up:contacted:true',
  'b2 a1 reads outcome follow_up, outcome_by A, stage follow_up, agent_status contacted');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000a1', 'not_interested'), 'lost',
          'b3 A then sets not_interested on a1 and gets stage lost back');
reset role;
select is(
  (select outcome || ':' || right(outcome_by::text, 1) || ':' || inbound_stage || ':' || agent_status
     from public.leads where id = 'cccccccc-cccc-4ccc-8181-0000000000a1'),
  'not_interested:a:lost:bad',
  'b4 a1 reads outcome not_interested, outcome_by A, stage lost, agent_status bad');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select ok(public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000a1', 'Has a policy elsewhere') is not null,
          'b5 A adds a note on a1 and gets the event id back');
reset role;
select is(
  (select string_agg(kind || '/' || coalesce(detail->>'outcome', detail->>'note'), ',' order by kind, detail->>'outcome')
     from public.inbound_events
    where lead_id = 'cccccccc-cccc-4ccc-8181-0000000000a1' and actor_id = 'aaaaaaaa-aaaa-4aaa-8181-00000000000a'),
  'note/Has a policy elsewhere,outcome/follow_up,outcome/not_interested',
  'b6 A''s calls wrote two outcome events and one note event on a1');
select is(
  (select count(*) filter (where agent_id = 'aaaaaaaa-aaaa-4aaa-8181-00000000000a' and actor_role = 'agent'
                             and actor_name = 'Test agent_a') || '/' || count(*)
     from public.inbound_events
    where lead_id = 'cccccccc-cccc-4ccc-8181-0000000000a1' and actor_id = 'aaaaaaaa-aaaa-4aaa-8181-00000000000a'),
  '3/3',
  'b7 each of those events has agent_id A, actor_role agent and A''s name');

-- ── c. Sold on A's live call starts servicing, once ─────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000a2', 'sold'), 'sold',
          'c1 A marks a2 sold and gets stage sold back');
reset role;
select is(
  (select outcome || ':' || right(outcome_by::text, 1) || ':' || inbound_stage || ':' || agent_status
     from public.leads where id = 'cccccccc-cccc-4ccc-8181-0000000000a2'),
  'sold:a:sold:closed',
  'c2 a2 reads outcome sold, outcome_by A, stage sold, agent_status closed');
select is(
  (select string_agg(kind || ':' || status || ':' || (agent_id = 'aaaaaaaa-aaaa-4aaa-8181-00000000000a')
                     || ':' || (requested_by = 'aaaaaaaa-aaaa-4aaa-8181-00000000000a'), ',' order by kind)
     from public.servicing_tasks where lead_id = 'cccccccc-cccc-4ccc-8181-0000000000a2'),
  'chargeback_watch:scheduled:true:true,packet_check:scheduled:true:true,review_call:scheduled:true:true',
  'c3 sold seeded packet_check, review_call and chargeback_watch for A, scheduled');
select ok(
  (select bool_and(case kind
                     when 'packet_check'     then due_at = now() + interval '7 days'
                     when 'review_call'      then due_at = now() + interval '30 days'
                     when 'chargeback_watch' then due_at = now() + interval '12 months'
                   end) and count(*) = 3
     from public.servicing_tasks where lead_id = 'cccccccc-cccc-4ccc-8181-0000000000a2'),
  'c4 the tasks are due in 7 days, 30 days and 12 months');
select is(
  (select string_agg(kind || ':' || (agent_id = 'aaaaaaaa-aaaa-4aaa-8181-00000000000a') || ':' || actor_role, ',' order by kind)
     from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8181-0000000000a2'),
  'became_client:true:agent,outcome:true:agent',
  'c5 sold logged one outcome event and one became_client event, agent_id A, actor_role agent');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000a2', 'sold'), 'sold',
          'c6 pressing sold on a2 a second time still works');
reset role;
select is(
  (select (select count(*) from public.servicing_tasks where lead_id = 'cccccccc-cccc-4ccc-8181-0000000000a2') || '/' ||
          (select count(*) from public.inbound_events where lead_id = 'cccccccc-cccc-4ccc-8181-0000000000a2' and kind = 'became_client')),
  '3/1',
  'c7 still three servicing tasks and one became_client event on a2');

-- ── d. Refusals ─────────────────────────────────────────────────────────────
-- What the refused calls must not touch.
create temp table d_leads_before as
select id, outcome, outcome_at, outcome_by, inbound_stage, agent_status, updated_at
  from public.leads
 where id in ('cccccccc-cccc-4ccc-8181-0000000000b1', 'cccccccc-cccc-4ccc-8181-0000000000c1',
              'cccccccc-cccc-4ccc-8181-0000000000ee');
create temp table d_events_before as
select count(*) as n from public.inbound_events;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000a","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000b1', 'follow_up') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd1 A cannot set an outcome on B''s lead');
select throws_ok($$ select public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000b1', 'not mine') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd2 A cannot add a note to B''s lead');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000ee', 'follow_up') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd3 A cannot set follow_up on the unassigned lead (the 181 fix)');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000ee', 'not_interested') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd4 A cannot set not_interested on the unassigned lead (the 181 fix)');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000ee', 'sold') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd5 A cannot mark the unassigned lead sold');
select throws_ok($$ select public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000ee', 'not mine either') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd6 A cannot add a note to the unassigned lead (the 181 fix)');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8181-00000000000c","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000c1', 'follow_up') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd7 inactive C cannot set an outcome on C''s own lead');
select throws_ok($$ select public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000c1', 'still here') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd8 inactive C cannot add a note to C''s own lead');
select throws_ok($$ select public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000ee', 'follow_up') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd9 inactive C cannot set an outcome on the unassigned lead');
select throws_ok($$ select public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000ee', 'still here') $$,
                 '42501', 'Only the lead''s agent can do this',
                 'd10 inactive C cannot add a note to the unassigned lead');
reset role;

select is(
  (select row(l.outcome, l.outcome_at, l.outcome_by, l.inbound_stage, l.agent_status, l.updated_at)::text
     from public.leads l where l.id = 'cccccccc-cccc-4ccc-8181-0000000000ee'),
  (select row(b.outcome, b.outcome_at, b.outcome_by, b.inbound_stage, b.agent_status, b.updated_at)::text
     from d_leads_before b where b.id = 'cccccccc-cccc-4ccc-8181-0000000000ee'),
  'd11 the unassigned lead''s outcome, outcome_by and inbound_stage are unchanged');
select is(
  (select row(l.outcome, l.outcome_at, l.outcome_by, l.inbound_stage, l.agent_status, l.updated_at)::text
     from public.leads l where l.id = 'cccccccc-cccc-4ccc-8181-0000000000b1'),
  (select row(b.outcome, b.outcome_at, b.outcome_by, b.inbound_stage, b.agent_status, b.updated_at)::text
     from d_leads_before b where b.id = 'cccccccc-cccc-4ccc-8181-0000000000b1'),
  'd12 B''s lead is unchanged');
select is(
  (select row(l.outcome, l.outcome_at, l.outcome_by, l.inbound_stage, l.agent_status, l.updated_at)::text
     from public.leads l where l.id = 'cccccccc-cccc-4ccc-8181-0000000000c1'),
  (select row(b.outcome, b.outcome_at, b.outcome_by, b.inbound_stage, b.agent_status, b.updated_at)::text
     from d_leads_before b where b.id = 'cccccccc-cccc-4ccc-8181-0000000000c1'),
  'd13 C''s lead is unchanged');
select is((select count(*) from public.inbound_events), (select n from d_events_before),
          'd14 no refused call wrote an inbound_events row (count before = count after)');
select is(
  (select count(*) from public.inbound_events
    where lead_id in ('cccccccc-cccc-4ccc-8181-0000000000b1', 'cccccccc-cccc-4ccc-8181-0000000000c1',
                      'cccccccc-cccc-4ccc-8181-0000000000ee')
      and actor_id in ('aaaaaaaa-aaaa-4aaa-8181-00000000000a', 'aaaaaaaa-aaaa-4aaa-8181-00000000000c')),
  0::bigint,
  'd15 no event on b1, c1 or ee names A or C as the actor');

-- ── e. The admin passes on every lead ───────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8181-000000000001","role":"authenticated"}', true),
       set_config('role', 'authenticated', true);
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000a1', 'follow_up'), 'follow_up',
          'e1 admin sets an outcome on A''s lead');
select ok(public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000a1', 'admin note a1') is not null,
          'e2 admin adds a note to A''s lead');
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000b1', 'not_interested'), 'lost',
          'e3 admin sets an outcome on B''s lead');
select ok(public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000b1', 'admin note b1') is not null,
          'e4 admin adds a note to B''s lead');
select is(public.set_inbound_outcome('cccccccc-cccc-4ccc-8181-0000000000ee', 'follow_up'), 'follow_up',
          'e5 admin sets an outcome on the unassigned lead');
select ok(public.add_inbound_note('cccccccc-cccc-4ccc-8181-0000000000ee', 'admin note ee') is not null,
          'e6 admin adds a note to the unassigned lead');
reset role;
select is(
  (select string_agg(right(lead_id::text, 2) || ':' || kind || ':' || coalesce(right(agent_id::text, 1), '-') || ':' || actor_role,
                     ',' order by lead_id, kind)
     from public.inbound_events where actor_id = 'dddddddd-dddd-4ddd-8181-000000000001'),
  'a1:note:a:admin,a1:outcome:a:admin,b1:note:b:admin,b1:outcome:b:admin,ee:note:-:admin,ee:outcome:-:admin',
  'e7 the admin''s six events carry the lead''s agent (none on ee) and actor_role admin');
select is(
  (select string_agg(right(id::text, 2) || ':' || outcome || ':' || right(outcome_by::text, 1) || ':' || inbound_stage, ',' order by id)
     from public.leads
    where id in ('cccccccc-cccc-4ccc-8181-0000000000a1', 'cccccccc-cccc-4ccc-8181-0000000000b1',
                 'cccccccc-cccc-4ccc-8181-0000000000ee')),
  'a1:follow_up:1:follow_up,b1:not_interested:1:lost,ee:follow_up:1:follow_up',
  'e8 the admin''s outcomes landed with outcome_by the admin');

select * from finish();
rollback;
