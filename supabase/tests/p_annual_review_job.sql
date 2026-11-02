-- p_annual_review_job — pgTAP checks for 214_annual_review_job.sql: the month 12 job
-- that creates annual review and conversion steps.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_annual_review_job.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cast: agent A, VA R, admin Z. Every date is worked out from today, so a case can't
-- go stale. Policies are seeded as the owner with no JWT claims set: the booking
-- trigger resets created_at on an agent's own insert.

begin;
create extension if not exists pgtap with schema extensions;
select plan(81);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_month12_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8214-00000000000a'::uuid, 'agent_a', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8214-000000000001'::uuid, 'rep_r',   'fulfillment'),
    ('cccccccc-cccc-4ccc-8214-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8214-000000000001';

create function public.p_m12_as(p_who uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;
create function public.p_m12_owner() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end
$f$;

-- The anchor that reaches month 12 today.
create function public.p_m12_today_anchor() returns date language sql stable as $f$
  select (current_date - interval '12 months')::date
$f$;

-- anchor + 12 months at noon UTC, the due_at the brief names.
create function public.p_m12_due(p_anchor date) returns timestamptz language sql stable as $f$
  select ((p_anchor + interval '12 months')::date + time '12:00') at time zone 'UTC'
$f$;

-- A policy. The last name is the case's name. Not at Fulfillment and no old policy
-- unless the case says so, so only the job's own rules decide.
create function public.p_m12_policy(
  p_name text,
  p_effective date default null,
  p_status public.policy_status default 'In Effect',
  p_product text default null,
  p_sold date default null,
  p_created timestamptz default now(),
  p_assigned boolean default false,
  p_replaced boolean default false
) returns uuid language sql as $f$
  insert into public.policies (agent_id, client_first_name, client_last_name, status, effective_date, policy_sold_date, created_at,
                               product_type, fulfillment_assigned, fulfillment_stage, replaced_old_policy)
  values ('aaaaaaaa-aaaa-4aaa-8214-00000000000a', 'Case', p_name, p_status, p_effective, p_sold, p_created, p_product,
          p_assigned, case when p_assigned then 'Pending'::public.fulfillment_stage_status end, p_replaced)
  returning id
$f$;

-- A task on the case. The default is the system chargeback_watch every journey has.
create function public.p_m12_task(
  p_name text,
  p_kind text default 'chargeback_watch',
  p_by text default 'system',
  p_status text default 'scheduled',
  p_outcome text default null
) returns uuid language sql as $f$
  insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by, outcome)
  select p.agent_id, p.id, p_kind, p_status, p_by, p_outcome
    from public.policies p where p.client_last_name = p_name
  returning id
$f$;

-- A policy past month 12 with its system seed.
create function public.p_m12_journey(
  p_name text,
  p_status public.policy_status default 'In Effect',
  p_product text default null
) returns uuid language sql as $f$
  select public.p_m12_policy(p_name, (current_date - interval '13 months')::date, p_status, p_product);
  select public.p_m12_task(p_name)
$f$;

-- How many system steps of a kind a case has.
create function public.p_m12_count(p_name text, p_kind text default 'annual_review') returns bigint language sql stable as $f$
  select count(*) from public.servicing_tasks t
    join public.policies p on p.id = t.policy_id
   where p.client_last_name = p_name and t.kind = p_kind and t.requested_by = 'system'
$f$;

-- Every step the job could have written.
create function public.p_m12_total() returns bigint language sql stable as $f$
  select count(*) from public.servicing_tasks where requested_by = 'system' and kind in ('annual_review', 'conversion')
$f$;

create function public.p_m12_step(p_name text, p_kind text default 'annual_review') returns public.servicing_tasks language sql stable as $f$
  select t.* from public.servicing_tasks t
    join public.policies p on p.id = t.policy_id
   where p.client_last_name = p_name and t.kind = p_kind and t.requested_by = 'system'
$f$;

create temp table runs (name text primary key, n integer);

-- ── Who reaches month 12 ────────────────────────────────────────────────────
select public.p_m12_policy('Exact12', public.p_m12_today_anchor());
select public.p_m12_task('Exact12');
select public.p_m12_policy('Submitted', public.p_m12_today_anchor(), 'Submitted');
select public.p_m12_task('Submitted');
select public.p_m12_policy('LessOneDay', (public.p_m12_today_anchor() + 1)::date);
select public.p_m12_task('LessOneDay');
select public.p_m12_policy('Three', (current_date - interval '3 months')::date);
select public.p_m12_task('Three');

-- The anchor: effective date, then sold date, then created_at.
select public.p_m12_policy('AnchorSold', null, 'In Effect', null, (current_date - interval '14 months')::date);
select public.p_m12_task('AnchorSold');
select public.p_m12_policy('AnchorMade', null, 'In Effect', null, null, now() - interval '15 months');
select public.p_m12_task('AnchorMade');
select public.p_m12_policy('EffectiveWins', (current_date - interval '3 months')::date, 'In Effect', null, (current_date - interval '14 months')::date);
select public.p_m12_task('EffectiveWins');
select public.p_m12_policy('SoldWins', null, 'In Effect', null, (current_date - interval '3 months')::date, now() - interval '15 months');
select public.p_m12_task('SoldWins');

-- ── Sold: seeds with no policy, linked afterward ────────────────────────────
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, assigned_rep_id)
values ('dddddddd-dddd-4ddd-8214-000000000001', 'Lead Linked', 'Lead Linked', '+15125550401', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8214-00000000000a'),
       ('dddddddd-dddd-4ddd-8214-000000000002', 'Lead Alone', 'Lead Alone', '+15125550402', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8214-00000000000a'),
       ('dddddddd-dddd-4ddd-8214-000000000003', 'Lead Mixed', 'Lead Mixed', '+15125550403', 'TX', 'policy_help', 'aaaaaaaa-aaaa-4aaa-8214-00000000000a');

select public.p_m12_as('aaaaaaaa-aaaa-4aaa-8214-00000000000a');
select is(public.set_inbound_outcome('dddddddd-dddd-4ddd-8214-000000000001', 'sold'), 'sold', 'sold1 A marks the unlinked lead sold');
select is(public.set_inbound_outcome('dddddddd-dddd-4ddd-8214-000000000002', 'sold'), 'sold', 'sold2 A marks the lead that stays unlinked sold');
select public.p_m12_owner();
select is((select count(*) from public.servicing_tasks where lead_id = 'dddddddd-dddd-4ddd-8214-000000000001' and policy_id is null), 3::bigint,
          'sold3 its three seeds have a null policy_id');

select public.p_m12_policy('SoldLinked', (current_date - interval '13 months')::date);
update public.leads set client_policy_id = (select id from public.policies where client_last_name = 'SoldLinked')
 where id = 'dddddddd-dddd-4ddd-8214-000000000001';
select is((select count(*) from public.servicing_tasks t join public.policies p on p.id = t.policy_id where p.client_last_name = 'SoldLinked'), 0::bigint,
          'sold4 the linked policy has no tasks of its own');
select is((select count(*) from public.policy_servicing_status where client_last_name = 'SoldLinked'), 0::bigint,
          'sold5 so the view leaves it out before the run');

-- Both kinds of seed on one policy: the one with a lead wins, even when it is newer.
select public.p_m12_policy('SeedPick', (current_date - interval '13 months')::date);
insert into public.servicing_tasks (agent_id, policy_id, lead_id, kind, status, requested_by, created_at)
select p.agent_id, p.id, null, 'chargeback_watch', 'scheduled', 'system', now() - interval '2 days'
  from public.policies p where p.client_last_name = 'SeedPick';
insert into public.servicing_tasks (agent_id, policy_id, lead_id, kind, status, requested_by, created_at)
select p.agent_id, p.id, 'dddddddd-dddd-4ddd-8214-000000000003', 'review_call', 'done', 'system', now() - interval '1 day'
  from public.policies p where p.client_last_name = 'SeedPick';

-- ── Not a journey ───────────────────────────────────────────────────────────
select public.p_m12_policy('OnlyAgent', (current_date - interval '13 months')::date);
select public.p_m12_task('OnlyAgent', 'chargeback_watch', 'agent');
select public.p_m12_task('OnlyAgent', 'carrier_call', 'agent', 'requested');
select public.p_m12_policy('OnlyOwnReview', (current_date - interval '13 months')::date, 'In Effect', 'Term');
select public.p_m12_task('OnlyOwnReview', 'annual_review');
select public.p_m12_policy('OnlyOwnConversion', (current_date - interval '13 months')::date);
select public.p_m12_task('OnlyOwnConversion', 'conversion');
select public.p_m12_policy('OnlySystemOther', (current_date - interval '13 months')::date);
select public.p_m12_task('OnlySystemOther', 'lapse_save');
-- Old cancellation rows: at Fulfillment, replaced_old_policy null, no system step.
select public.p_m12_policy('OldCancel', (current_date - interval '13 months')::date, 'In Effect', null, null, now(), true, null);
select public.p_m12_policy('OldCancelRequest', (current_date - interval '13 months')::date, 'In Effect', null, null, now(), true, null);
select public.p_m12_task('OldCancelRequest', 'carrier_call', 'agent', 'requested');

-- ── Which product gets a conversion ─────────────────────────────────────────
select public.p_m12_journey('ProductTERM', 'In Effect', 'TERM');
select public.p_m12_journey('Producttl', 'In Effect', 'tl');
select public.p_m12_journey('ProductPadded', 'In Effect', '  Term Life ');
select public.p_m12_journey('ProductWhole', 'In Effect', 'Whole Life');
select public.p_m12_journey('ProductNull');
select public.p_m12_journey('ProductIUL', 'In Effect', 'IUL');

-- ── Ended ───────────────────────────────────────────────────────────────────
select public.p_m12_journey('EndLapsed', 'Lapsed');
select public.p_m12_journey('EndNotApproved', 'Not Approved');
select public.p_m12_journey('EndUndrafted', 'Undrafted');
select public.p_m12_journey('EndArchived');
update public.policies set archived_at = now() where client_last_name = 'EndArchived';
select public.p_m12_journey('EndOutcomeLapsed');
select public.p_m12_task('EndOutcomeLapsed', 'lapse_save', 'system', 'done', 'lapsed');
select public.p_m12_journey('EndClientCancelled');
select public.p_m12_task('EndClientCancelled', 'lapse_save', 'system', 'done', 'client_cancelled');
-- A saved client hasn't ended, so the lapse test can't be reading any done lapse_save.
select public.p_m12_journey('LapseSaved');
select public.p_m12_task('LapseSaved', 'lapse_save', 'system', 'done', 'saved');

-- ── The rest ────────────────────────────────────────────────────────────────
select public.p_m12_journey('Sample');
update public.policies set is_sample = true where client_last_name = 'Sample';
select public.p_m12_journey('StepDone');
select public.p_m12_journey('StepCancelled');
select public.p_m12_journey('Dupe');
select public.p_m12_journey('AgentAskedFirst');
select public.p_m12_task('AgentAskedFirst', 'annual_review', 'agent', 'requested');
select public.p_m12_policy('ViewCase', public.p_m12_today_anchor());
select public.p_m12_task('ViewCase');

-- ── First run ───────────────────────────────────────────────────────────────
select is(public.p_m12_total(), 2::bigint, 'run0 only the two fixture rows exist before the first run');
insert into runs select 'first', public.servicing_month12_sweep();
select is((select n::bigint from runs where name = 'first'), public.p_m12_total() - 2, 'run1 the job returns the rows it inserted');

-- Month 12 reached, exactly.
select is(public.p_m12_count('Exact12'), 1::bigint, 'm1 exactly 12 months, In Effect: one annual_review');
select is(public.p_m12_count('Exact12', 'conversion'), 0::bigint, 'm2 and no conversion with no product_type');
select is(((public.p_m12_step('Exact12')).status), 'requested', 'm3 its status is requested, never scheduled');
select is(((public.p_m12_step('Exact12')).requested_by), 'system', 'm4 requested_by is system');
select is(((public.p_m12_step('Exact12')).requested_by_id), null, 'm5 requested_by_id is null');
select is(((public.p_m12_step('Exact12')).due_at), public.p_m12_due(public.p_m12_today_anchor()), 'm6 due_at is anchor + 12 months at noon UTC');
select is(to_char((public.p_m12_step('Exact12')).due_at at time zone 'UTC', 'HH24:MI'), '12:00', 'm7 and it reads 12:00 in UTC');
select is(((public.p_m12_step('Exact12')).agent_id), 'aaaaaaaa-aaaa-4aaa-8214-00000000000a'::uuid, 'm8 agent_id is the policy''s agent');
select is(((public.p_m12_step('Exact12')).lead_id), null, 'm9 lead_id is null on a policy with no lead');
select is(((public.p_m12_step('Exact12')).best_time), null, 'm10 best_time is null');
select is(public.p_m12_count('Submitted'), 1::bigint, 'm11 a Submitted policy at month 12 gets a step');
select is(public.p_m12_count('LessOneDay'), 0::bigint, 'm12 12 months less one day: no step');
select is(public.p_m12_count('Three'), 0::bigint, 'm13 3 months: no step');

-- Anchor.
select is(((public.p_m12_step('AnchorSold')).due_at), public.p_m12_due((current_date - interval '14 months')::date),
          'a1 with no effective date the sold date anchors');
select is(((public.p_m12_step('AnchorMade')).due_at), public.p_m12_due((now() - interval '15 months')::date),
          'a2 with neither, created_at anchors');
select is(public.p_m12_count('EffectiveWins'), 0::bigint, 'a3 an effective date at 3 months beats an old sold date');
select is(public.p_m12_count('SoldWins'), 0::bigint, 'a4 a sold date at 3 months beats an old created_at');

-- Sold.
select is(public.p_m12_count('SoldLinked'), 1::bigint, 's1 a Sold lead linked afterward: its policy gets one review');
select is(((public.p_m12_step('SoldLinked')).lead_id), 'dddddddd-dddd-4ddd-8214-000000000001'::uuid, 's2 that step''s lead_id is the lead');
select is((select stage || ':' || next_step from public.policy_servicing_status where client_last_name = 'SoldLinked'), 'ongoing:annual_review',
          's3 after the run the view shows that policy');
select is((select count(*) from public.servicing_tasks where lead_id = 'dddddddd-dddd-4ddd-8214-000000000002' and kind in ('annual_review', 'conversion')),
          0::bigint, 's4 a Sold lead with no policy linked adds no step');
select is(((public.p_m12_step('SeedPick')).lead_id), 'dddddddd-dddd-4ddd-8214-000000000003'::uuid,
          's5 a seed with a lead is picked over an older seed with none');

-- Not a journey.
select is(public.p_m12_count('OnlyAgent'), 0::bigint, 'j1 only agent requests, even of a seed kind: not a journey');
select is(public.p_m12_count('OnlyOwnReview', 'conversion'), 0::bigint, 'j2 only the job''s own annual_review as a system row: not a journey, no conversion');
select is(public.p_m12_count('OnlyOwnConversion'), 0::bigint, 'j3 only the job''s own conversion as a system row: not a journey, no review');
select is(public.p_m12_count('OnlySystemOther'), 0::bigint, 'j4 a system row of another kind: not a journey');
select is(public.p_m12_count('OldCancel'), 0::bigint, 'j5 an old cancellation row at 13 months: no step');
select is(public.p_m12_count('OldCancelRequest'), 0::bigint, 'j6 nor with an open agent request on it');

-- Products.
select is(public.p_m12_count('ProductTERM', 'conversion'), 1::bigint, 'c1 TERM gets one conversion');
select is(public.p_m12_count('Producttl', 'conversion'), 1::bigint, 'c2 tl gets one conversion');
select is(public.p_m12_count('ProductPadded', 'conversion'), 1::bigint, 'c3 a padded, mixed-case Term Life matches');
select is(public.p_m12_count('ProductWhole', 'conversion'), 0::bigint, 'c4 Whole Life gets none');
select is(public.p_m12_count('ProductNull', 'conversion'), 0::bigint, 'c5 a null product_type gets none');
select is(public.p_m12_count('ProductTERM'), 1::bigint, 'c6 a term policy still gets its one review');
select is(public.p_m12_count('ProductWhole'), 1::bigint, 'c7 Whole Life still gets its review');
select is(((public.p_m12_step('ProductTERM', 'conversion')).status) || ':' || ((public.p_m12_step('ProductTERM', 'conversion')).requested_by),
          'requested:system', 'c8 the conversion is requested and from the system');
select is(((public.p_m12_step('ProductTERM', 'conversion')).due_at), ((public.p_m12_step('ProductTERM')).due_at), 'c9 with the review''s due_at');
select is(public.p_m12_count('ProductIUL', 'conversion'), 0::bigint, 'c10 IUL gets none before the setting names it');

-- Ended.
select is(public.p_m12_count('EndLapsed'), 0::bigint, 'e1 status Lapsed: no step');
select is(public.p_m12_count('EndNotApproved'), 0::bigint, 'e2 status Not Approved: no step');
select is(public.p_m12_count('EndUndrafted'), 0::bigint, 'e3 status Undrafted: no step');
select is(public.p_m12_count('EndArchived'), 0::bigint, 'e4 archived_at set: no step');
select is(public.p_m12_count('EndOutcomeLapsed'), 0::bigint, 'e5 a done lapse_save with outcome lapsed: no step');
select is(public.p_m12_count('EndClientCancelled'), 0::bigint, 'e6 one with outcome client_cancelled: no step');
select is(public.p_m12_count('LapseSaved'), 1::bigint, 'e7 control: one with outcome saved has not ended, so it gets a step');

-- Sample.
select is(((public.p_m12_step('Sample')).is_sample), true, 'x1 a sample policy''s step has is_sample true');
select is(((public.p_m12_step('Exact12')).is_sample), false, 'x2 a normal policy''s step has is_sample false');

-- An agent's own request isn't the job's step.
select is(public.p_m12_count('AgentAskedFirst'), 1::bigint, 'x3 an agent''s own annual_review does not stop the job''s step');

-- The view.
select is((select stage from public.policy_servicing_status where client_last_name = 'ViewCase'), 'ongoing', 'v1 chargeback seed only: stage ongoing');
select is((select next_step from public.policy_servicing_status where client_last_name = 'ViewCase'), 'annual_review', 'v2 next_step annual_review');
select is((select next_date from public.policy_servicing_status where client_last_name = 'ViewCase'), ((public.p_m12_step('ViewCase')).due_at), 'v3 next_date is its due_at');
select is((select open_requests from public.policy_servicing_status where client_last_name = 'ViewCase'), 0, 'v4 open_requests 0');

-- The feed takes a step with nobody behind it.
select public.p_m12_as('aaaaaaaa-aaaa-4aaa-8214-00000000000a');
select is((select title from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', 'aaaaaaaa-aaaa-4aaa-8214-00000000000a', 5000)
            where id = 'servicing_added:' || (select (public.p_m12_step('Exact12')).id::text)),
          'Servicing task added: annual review.', 'v5 the feed shows the step with no requester');
select public.p_m12_owner();

-- ── Second run ──────────────────────────────────────────────────────────────
create temp table total_before as select public.p_m12_total() as n;
select is(public.servicing_month12_sweep(), 0, 'r1 a second run returns 0');
select is(public.p_m12_total(), (select n from total_before), 'r2 and the row count is unchanged');
select is(public.p_m12_count('ProductTERM', 'conversion'), 1::bigint, 'r3 a second run adds no conversion');

-- ── A new product in the setting ────────────────────────────────────────────
select is((select conversion_product_types from public.app_settings where id = 1), array['term', 'term life', 'tl'], 'i0 the setting starts with the three term names');
select public.p_m12_as('cccccccc-cccc-4ccc-8214-000000000001');
update public.app_settings set conversion_product_types = conversion_product_types || array[' IUL '] where id = 1;
select public.p_m12_owner();
select is(public.servicing_month12_sweep(), 1, 'i1 after an admin adds IUL, the next run inserts one row');
select is(public.p_m12_count('ProductIUL', 'conversion'), 1::bigint, 'i2 the IUL policy gets its conversion');
select is(public.p_m12_count('ProductIUL'), 1::bigint, 'i3 and no second review');

-- ── Done and cancelled stay that way ────────────────────────────────────────
update public.servicing_tasks set status = 'done' where id = (select (public.p_m12_step('StepDone')).id);
update public.servicing_tasks set status = 'cancelled' where id = (select (public.p_m12_step('StepCancelled')).id);
select is(public.servicing_month12_sweep(), 0, 'd1 a done or cancelled step is not recreated');
select is(((public.p_m12_step('StepDone')).status), 'done', 'd2 the done step stays done');
select is(((public.p_m12_step('StepCancelled')).status), 'cancelled', 'd3 the cancelled step stays cancelled');

-- ── The index ───────────────────────────────────────────────────────────────
select throws_ok($$ select public.p_m12_task('Dupe', 'annual_review') $$, '23505', null, 'u1 a direct second system annual_review is refused');
select lives_ok($$ select public.p_m12_task('Dupe', 'annual_review', 'agent', 'requested') $$, 'u2 an agent-requested annual_review on that policy inserts fine');

-- ── The VA queue ────────────────────────────────────────────────────────────
-- The ids are read as the owner: a VA's RLS hides the tasks and the policies.
create temp table ids as
  select p.client_last_name as name, t.id as task_id
    from public.servicing_tasks t join public.policies p on p.id = t.policy_id
   where p.client_last_name in ('ViewCase', 'Sample') and t.kind = 'annual_review' and t.requested_by = 'system';
grant all on ids to authenticated;
select is((select count(*) from ids), 2::bigint, 'q0 both steps are there to look for');
select public.p_m12_as('bbbbbbbb-bbbb-4bbb-8214-000000000001');
select is((select q.kind || ':' || q.status from public.va_servicing_queue() q
            where q.task_id = (select task_id from ids where name = 'ViewCase')), 'annual_review:requested', 'q1 a fulfillment user''s queue has the new step');
select is((select count(*) from public.va_servicing_queue() q where q.task_id = (select task_id from ids where name = 'Sample')),
          0::bigint, 'q2 and not a sample step: the demo side rule keeps it from a live VA');
select public.p_m12_owner();

-- ── Who can run it ──────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.servicing_month12_sweep()', 'execute'), 'p1 anon can''t run the job');
select ok(not has_function_privilege('authenticated', 'public.servicing_month12_sweep()', 'execute'), 'p2 authenticated can''t run the job');
select public.p_m12_as('aaaaaaaa-aaaa-4aaa-8214-00000000000a');
select throws_ok($$ select public.servicing_month12_sweep() $$, '42501', null, 'p3 calling it as an authenticated user raises 42501');
select public.p_m12_owner();

-- ── Cron ────────────────────────────────────────────────────────────────────
select is((select count(*) from cron.job where jobname = 'servicing-month12-sweep'), 1::bigint, 'k1 one cron job has the name');
select is((select schedule from cron.job where jobname = 'servicing-month12-sweep'), '20 7 * * *', 'k2 on the schedule');
select ok((select command like '%public.servicing_month12_sweep()%' from cron.job where jobname = 'servicing-month12-sweep'), 'k3 its command names the function');

select * from finish();
rollback;
