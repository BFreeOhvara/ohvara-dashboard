-- p_activity_lapse_events — pgTAP checks for 209_activity_lapse_events.sql: a policy set to
-- Lapsed writes one policy_events row at that moment, and the feed shows it as its own
-- row, in plain words, to the same people as any other policy_events kind.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No robot can
-- run SQL against Ohvara, and none did. Everything runs in one transaction that is rolled
-- back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_activity_lapse_events.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara. A pass
-- there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cases fire the real trigger and read the feed, and the VA's part is the real
-- va_servicing_* calls. Written directly, and named here: the seeded policies, and in f
-- the one insert that has to be refused.
--
-- THE STATUS CHANGE IS FIRED THROUGH A HELPER. Since 147 and 149 nobody signed in has a
-- direct UPDATE on policies, and no function sets Lapsed yet, so section i pins that today
-- nobody signed in can fire this. p_al_status runs the update the way a security-definer
-- RPC would: as the table owner, with the caller's auth.uid(). The day such an RPC ships,
-- swap it in here.
--
-- Cast: agent A, U (A's upline), B (no link), VA V (the call's rep), VA W (not), admin Z.

begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_lapse_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8209-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8209-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8209-00000000000c'::uuid, 'agent_u', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8209-000000000001'::uuid, 'va_v',    'fulfillment'),
    ('bbbbbbbb-bbbb-4bbb-8209-000000000002'::uuid, 'va_w',    'fulfillment'),
    ('cccccccc-cccc-4ccc-8209-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8209-000000000001';
update public.profiles set upline_id = 'aaaaaaaa-aaaa-4aaa-8209-00000000000c' where id = 'aaaaaaaa-aaaa-4aaa-8209-00000000000a';
update public.app_settings set submit_live = true, agent_billing_enforced = false where id = 1;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, anon, service_role;

create function public.p_al_id(p_who text) returns uuid language sql immutable as $f$
  select case p_who
    when 'A' then 'aaaaaaaa-aaaa-4aaa-8209-00000000000a'::uuid
    when 'B' then 'aaaaaaaa-aaaa-4aaa-8209-00000000000b'::uuid
    when 'U' then 'aaaaaaaa-aaaa-4aaa-8209-00000000000c'::uuid
    when 'V' then 'bbbbbbbb-bbbb-4bbb-8209-000000000001'::uuid
    when 'W' then 'bbbbbbbb-bbbb-4bbb-8209-000000000002'::uuid
    when 'Z' then 'cccccccc-cccc-4ccc-8209-000000000001'::uuid
  end
$f$;

-- Sign in as someone.
create function public.p_al_as(p_who text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', public.p_al_id(p_who), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;

-- Back to the table owner, nobody signed in.
create function public.p_al_owner() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end
$f$;

-- A server job: the service role, with no auth.uid().
create function public.p_al_service() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end
$f$;

create function public.p_al_i(p_name text) returns uuid language sql stable as $f$
  select id from ids where name = p_name
$f$;

-- A policy in A's book, In Effect, assigned to V. Everything the feed must not return is
-- filled in, so a leak has something to leak.
create function public.p_al_policy(p_name text, p_status public.policy_status default 'In Effect', p_sample boolean default false,
                                   p_last text default 'Case') returns uuid language sql as $f$
  with made as (
    insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, policy_number, carrier_name, notes, state,
                                 status, effective_date, fulfillment_assigned, fulfillment_stage, replaced_old_policy,
                                 assigned_fulfillment_id, is_sample)
    values (public.p_al_id('A'), 'Lana', p_last, '+15125550399', 'POL209SECRET', 'P Lapse Carrier', 'Free text note 512-555-0399', 'TX',
            p_status, current_date - 40, true, 'Pending', null, public.p_al_id('V'), p_sample)
    returning id
  ), named as (
    insert into ids select p_name, id from made returning id
  )
  select id from named
$f$;

-- How many lapsed events one policy has, read as the table owner.
create function public.p_al_n(p_name text) returns bigint language sql stable as $f$
  select count(*) from public.policy_events e where e.policy_id = public.p_al_i(p_name) and e.kind = 'lapsed'
$f$;

-- The feed as whoever is signed in.
create function public.p_al_feed(p_agent uuid default null)
returns table (id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb)
language sql stable as $f$
  select * from public.agent_activity_feed(now() - interval '1 day', now() + interval '1 day', p_agent, 5000)
$f$;

-- How many feed rows of one kind this person sees on one policy.
create function public.p_al_sees(p_name text, p_kind text default 'lapsed') returns bigint language sql stable as $f$
  select count(*) from public.p_al_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_al_i(p_name) and f.kind = p_kind
$f$;

-- The agent's status change, run as a security-definer RPC would (see the top of the file).
create function public.p_al_status(p_name text, p_status public.policy_status) returns void
language plpgsql security definer as $f$
begin
  update public.policies set status = p_status where id = public.p_al_i(p_name);
end
$f$;

-- ── a. The trigger ──────────────────────────────────────────────────────────
select public.p_al_policy('a_one');
select is(public.p_al_n('a_one'), 0::bigint, 'a1 a policy In Effect has no lapsed row');
select public.p_al_as('A');
select public.p_al_status('a_one', 'Lapsed');
select public.p_al_owner();
select is(public.p_al_n('a_one'), 1::bigint, 'a2 In Effect to Lapsed writes exactly one row');
select is((select concat_ws('|', e.agent_id = public.p_al_id('A'), e.from_status, e.actor_id = public.p_al_id('A'), e.actor_name, e.actor_role, e.is_sample)
             from public.policy_events e where e.policy_id = public.p_al_i('a_one') and e.kind = 'lapsed'),
          't|In Effect|t|Test agent_a|agent|f', 'a3 with the policy''s agent, the old status and the signed-in actor');
select is((select e.detail from public.policy_events e where e.policy_id = public.p_al_i('a_one') and e.kind = 'lapsed'),
          '{"from": "In Effect"}'::jsonb, 'a4 detail holds only from');

select public.p_al_as('A');
select public.p_al_status('a_one', 'Lapsed');
select public.p_al_owner();
select is(public.p_al_n('a_one'), 1::bigint, 'a5 Lapsed to Lapsed writes none');
update public.policies set notes = 'Another note' where id = public.p_al_i('a_one');
select is(public.p_al_n('a_one'), 1::bigint, 'a6 another column on a Lapsed policy writes none');
update public.policies set status = 'Lapsed', notes = 'One more note' where id = public.p_al_i('a_one');
select is(public.p_al_n('a_one'), 1::bigint, 'a7 Lapsed resent with another column writes none');

select public.p_al_policy('a_other');
update public.policies set status = 'Undrafted' where id = public.p_al_i('a_other');
update public.policies set status = 'Not Approved' where id = public.p_al_i('a_other');
update public.policies set status = 'Submitted' where id = public.p_al_i('a_other');
update public.policies set status = 'In Effect' where id = public.p_al_i('a_other');
select is(public.p_al_n('a_other'), 0::bigint, 'a8 other status changes write none');
update public.policies set status = 'Lapsed' where id = public.p_al_i('a_other');
select is((select e.from_status from public.policy_events e where e.policy_id = public.p_al_i('a_other') and e.kind = 'lapsed'), 'In Effect', 'a9 then a real lapse still writes');

-- A lapse from any status counts, and only Lapsed does.
select public.p_al_policy('a_undrafted', 'Undrafted');
update public.policies set status = 'Lapsed' where id = public.p_al_i('a_undrafted');
select is((select e.detail ->> 'from' from public.policy_events e where e.policy_id = public.p_al_i('a_undrafted') and e.kind = 'lapsed'), 'Undrafted', 'a10 detail.from is the old status, whatever it was');

-- Reinstated, then lapsed again, is a second lapse.
select public.reactivate_lapsed_policy(public.p_al_i('a_one'));
select is((select status::text from public.policies where id = public.p_al_i('a_one')), 'In Effect', 'a11 reactivate_lapsed_policy puts it back');
select is(public.p_al_n('a_one'), 1::bigint, 'a12 and that writes none');
select public.p_al_as('A');
select public.p_al_status('a_one', 'Lapsed');
select public.p_al_owner();
select is(public.p_al_n('a_one'), 2::bigint, 'a13 lapsing again writes a second row');

-- No backfill, and an insert isn't a lapse.
select public.p_al_policy('a_inserted', 'Lapsed');
select is(public.p_al_n('a_inserted'), 0::bigint, 'a14 a policy inserted already Lapsed writes none');

-- One update of many rows is one row each.
select public.p_al_policy('a_many1'), public.p_al_policy('a_many2');
update public.policies set status = 'Lapsed' where id in (public.p_al_i('a_many1'), public.p_al_i('a_many2'));
select is(public.p_al_n('a_many1') + public.p_al_n('a_many2'), 2::bigint, 'a15 two policies in one update write one row each');

-- ── b. Who the actor reads as ───────────────────────────────────────────────
select public.p_al_policy('b_system'), public.p_al_policy('b_admin'), public.p_al_policy('b_ghost');
select public.p_al_service();
select is(auth.uid(), null, 'b1 a server job has no auth.uid()');
update public.policies set status = 'Lapsed' where id = public.p_al_i('b_system');
select public.p_al_owner();
select is((select concat_ws('|', e.actor_id, e.actor_name, e.actor_role) from public.policy_events e where e.policy_id = public.p_al_i('b_system') and e.kind = 'lapsed'),
          'Ohvara|system', 'b2 nobody signed in reads Ohvara, role system, with no actor id');
select public.p_al_as('Z');
select public.p_al_status('b_admin', 'Lapsed');
select public.p_al_owner();
select is((select concat_ws('|', e.actor_id = public.p_al_id('Z'), e.actor_name, e.actor_role) from public.policy_events e where e.policy_id = public.p_al_i('b_admin') and e.kind = 'lapsed'),
          't|Test admin_z|admin', 'b3 an admin reads as the admin, and the row stays the agent''s');
-- actor_id is a foreign key to profiles: a uid with no profile must not refuse the status change.
select set_config('request.jwt.claims', '{"sub": "dddddddd-dddd-4ddd-8209-000000000099", "role": "authenticated"}', true);
update public.policies set status = 'Lapsed' where id = public.p_al_i('b_ghost');
select public.p_al_owner();
select is((select status::text from public.policies where id = public.p_al_i('b_ghost')), 'Lapsed', 'b4 a uid with no profile still lapses the policy');
select is((select concat_ws('|', e.actor_id, e.actor_name, e.actor_role) from public.policy_events e where e.policy_id = public.p_al_i('b_ghost') and e.kind = 'lapsed'),
          'Ohvara|system', 'b5 and reads Ohvara, role system');

-- ── c. is_sample ────────────────────────────────────────────────────────────
select public.p_al_policy('c_sample', 'In Effect', true);
update public.policies set status = 'Lapsed' where id = public.p_al_i('c_sample');
select is((select e.is_sample from public.policy_events e where e.policy_id = public.p_al_i('c_sample') and e.kind = 'lapsed'), true, 'c1 a sample policy''s row carries is_sample');
select is((select e.is_sample from public.policy_events e where e.policy_id = public.p_al_i('a_other') and e.kind = 'lapsed'), false, 'c2 and a real policy''s doesn''t');

-- ── d. The feed row ─────────────────────────────────────────────────────────
select public.p_al_policy('d_row');
select public.p_al_as('A');
select public.p_al_status('d_row', 'Lapsed');
select is((select string_agg(concat_ws('|', f.kind, f.title), ',') from public.p_al_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('d_row') and f.kind = 'lapsed'),
          'lapsed|Policy lapsed. Payments stopped.', 'd1 the feed row has kind lapsed and the exact title');
select is((select count(*) from public.p_al_feed() f where f.id = 'policy_event:' || (select e.id::text from public.policy_events e where e.policy_id = public.p_al_i('d_row') and e.kind = 'lapsed')),
          1::bigint, 'd2 it comes from the policy_events branch');
select is((select count(*) from public.p_al_feed() f where f.title = 'Call updated.'), 0::bigint, 'd3 and nothing falls into Call updated');
select is((select f.agent_id from public.p_al_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('d_row') and f.kind = 'lapsed'), public.p_al_id('A'), 'd4 it is the agent''s');
select is((select array_agg(k order by k) from public.p_al_feed() f, jsonb_object_keys(f.meta) k where (f.meta ->> 'policy_id')::uuid = public.p_al_i('d_row') and f.kind = 'lapsed'),
          array['actor_name', 'actor_role', 'client_first_name', 'client_last_name', 'policy_id', 'state'], 'd5 meta is the usual keys only');
select public.p_al_owner();

-- ── e. Who sees it ──────────────────────────────────────────────────────────
-- e_who has an in_progress row too: a lapsed row has to read the same as another kind.
select public.p_al_policy('e_who');
update public.policies set call_live_since = now(), call_attempts = 1 where id = public.p_al_i('e_who');
update public.policies set status = 'Lapsed' where id = public.p_al_i('e_who');
select public.p_al_as('A');
select is(public.p_al_sees('e_who'), 1::bigint, 'e1 own agent sees it');
select public.p_al_as('Z');
select is(public.p_al_sees('e_who'), 1::bigint, 'e2 admin sees it');
select is((select count(*) from public.p_al_feed(public.p_al_id('A')) f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('e_who') and f.kind = 'lapsed'), 1::bigint, 'e3 admin passing the agent sees it');
select is((select count(*) from public.p_al_feed(public.p_al_id('B')) f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('e_who') and f.kind = 'lapsed'), 0::bigint, 'e4 admin passing another agent doesn''t');
select public.p_al_as('B');
select is(public.p_al_sees('e_who'), 0::bigint, 'e5 an unrelated agent does not');
select is(public.p_al_sees('e_who', 'in_progress'), 0::bigint, 'e6 same as an in_progress row');
select is((select count(*) from public.policy_events e where e.policy_id = public.p_al_i('e_who')), 0::bigint, 'e7 nor reading the table directly');
select public.p_al_as('U');
select is(public.p_al_sees('e_who'), 1::bigint, 'e8 the upline sees it');
select is(public.p_al_sees('e_who', 'in_progress'), 1::bigint, 'e9 same as an in_progress row');
select public.p_al_as('V');
select is(public.p_al_sees('e_who'), 1::bigint, 'e10 the Fulfillment rep on the call sees it');
select is(public.p_al_sees('e_who', 'in_progress'), 1::bigint, 'e11 same as an in_progress row');
select public.p_al_as('W');
select is(public.p_al_sees('e_who'), 0::bigint, 'e12 another Fulfillment rep does not');
select is(public.p_al_sees('e_who', 'in_progress'), 0::bigint, 'e13 same as an in_progress row');
select public.p_al_owner();

-- ── f. What never comes back, and who can't write ───────────────────────────
-- Every policy here holds the phone number, policy number, carrier and a note. A name with
-- digits in it is dropped by the feed, as for every other row.
select public.p_al_policy('f_digits', 'In Effect', false, 'Call 5125550399');
update public.policies set status = 'Lapsed' where id = public.p_al_i('f_digits');
select public.p_al_as('Z');
select ok((select count(*) from public.p_al_feed() f where f.kind = 'lapsed') >= 10, 'f1 the rows holding those values do reach the feed');
select is((select count(*) from public.p_al_feed() f where f.kind = 'lapsed' and f.id || f.title || f.meta::text ~* '5125550399|555-0399|POL209|Lapse Carrier|Free text|note'), 0::bigint,
          'f2 no title or meta holds a phone number, policy number, carrier or note');
select public.p_al_as('A');
select is((select count(*) from public.p_al_feed() f where f.kind = 'lapsed' and f.id || f.title || f.meta::text ~* '5125550399|555-0399|POL209|Lapse Carrier|Free text|note'), 0::bigint,
          'f3 the agent: none of them either');
select public.p_al_owner();
select is((select count(*) from public.policy_events e where e.kind = 'lapsed' and e.detail::text || coalesce(e.from_status, '') ~* '5125550399|555-0399|POL209|Lapse Carrier|Free text'), 0::bigint,
          'f4 nor does the event row itself');
select is((select count(*) from public.policy_events e, jsonb_object_keys(e.detail) k where e.kind = 'lapsed' and k <> 'from'), 0::bigint, 'f5 every lapsed row''s detail holds only from');

select public.p_al_as('A');
select throws_ok(format('insert into public.policy_events (policy_id, agent_id, kind) values (%L, %L, %L)', public.p_al_i('d_row'), public.p_al_id('A'), 'lapsed'),
                 '42501', null, 'f6 an agent can''t write a lapsed row by hand');
select public.p_al_owner();

-- ── g. The check, the trigger and the grants ────────────────────────────────
select is((select count(*) from unnest(array['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited', 'reassigned', 'submitted', 'service_request', 'servicing', 'lapsed']) k
            where position(quote_literal(k) in (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'policy_events_kind_check')) > 0),
          11::bigint, 'g1 policy_events_kind_check keeps all ten of 206''s values and adds lapsed');
select throws_ok(format('insert into public.policy_events (policy_id, agent_id, kind) values (%L, %L, %L)', public.p_al_i('d_row'), public.p_al_id('A'), 'not_a_kind'),
                 '23514', null, 'g2 and still refuses any other kind');
select ok(pg_get_triggerdef((select t.oid from pg_trigger t where t.tgrelid = 'public.policies'::regclass and t.tgname = 'policies_log_lapsed'))
            like '%AFTER UPDATE OF status ON public.policies FOR EACH ROW WHEN%', 'g3 after update of status, for each row, with a condition');
select ok((select p.prosecdef from pg_proc p where p.oid = 'public.log_policy_lapsed()'::regprocedure), 'g4 the trigger function is security definer');
select is((select p.proconfig from pg_proc p where p.oid = 'public.log_policy_lapsed()'::regprocedure), array['search_path=public'], 'g5 with its search_path pinned');
select ok(not has_function_privilege('anon', 'public.log_policy_lapsed()', 'execute'), 'g6 anon can''t execute it');
select ok(not has_function_privilege('authenticated', 'public.log_policy_lapsed()', 'execute'), 'g7 authenticated can''t execute it');
select is((select count(*) from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.log_policy_lapsed()'::regprocedure and a.grantee = 0), 0::bigint, 'g8 public can''t execute it');
select ok(not has_function_privilege('anon', 'public.agent_activity_feed(timestamptz, timestamptz, uuid, int)', 'execute'), 'g9 the feed stays shut to anon');
select ok(has_function_privilege('authenticated', 'public.agent_activity_feed(timestamptz, timestamptz, uuid, int)', 'execute'), 'g10 and open to authenticated');

-- ── h. EXPECTED CASE: two rows on purpose, not a bug ────────────────────────
-- A lapse_save done with outcome lapsed reads 'Policy lapsed.'. 206 does not change
-- policies.status, so the agent setting the status to Lapsed afterwards is a second act,
-- by a second person, and reads 'Policy lapsed. Payments stopped.'. Two rows, both meant.
select public.p_al_policy('h_two'), public.p_al_policy('h_saved');
select public.p_al_as('A');
insert into ids select 't_h_two', public.agent_submit_service_request(public.p_al_i('h_two'), 'lapse_save', null, null);
insert into ids select 't_h_saved', public.agent_submit_service_request(public.p_al_i('h_saved'), 'lapse_save', null, null);
select public.p_al_as('V');
select public.va_servicing_claim(public.p_al_i('t_h_two'));
select public.va_servicing_outcome(public.p_al_i('t_h_two'), 'lapsed');
select public.va_servicing_done(public.p_al_i('t_h_two'));
select public.va_servicing_claim(public.p_al_i('t_h_saved'));
select public.va_servicing_outcome(public.p_al_i('t_h_saved'), 'saved');
select public.va_servicing_done(public.p_al_i('t_h_saved'));
select public.p_al_owner();
select is((select status::text from public.policies where id = public.p_al_i('h_two')), 'In Effect', 'h1 the VA''s outcome leaves policies.status alone');
select is(public.p_al_n('h_two'), 0::bigint, 'h2 so it writes no lapsed event');
select public.p_al_as('A');
select is((select string_agg(concat_ws('|', f.kind, f.title), ',') from public.p_al_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('h_two') and f.title like 'Policy lapsed%'),
          'servicing|Policy lapsed.', 'h3 only the VA''s row so far');
select public.p_al_status('h_two', 'Lapsed');
select is((select string_agg(concat_ws('|', f.kind, f.title), ',' order by f.title) from public.p_al_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('h_two') and f.title like 'Policy lapsed%'),
          'servicing|Policy lapsed.,lapsed|Policy lapsed. Payments stopped.', 'h4 then the agent''s status change gives two rows: Policy lapsed. and Policy lapsed. Payments stopped.');
select is((select count(*) from public.p_al_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('h_two') and f.title = 'Lapse risk flagged.' and f.kind = 'servicing'), 1::bigint,
          'h5 the lapse_save stays kind servicing, with its words');
select is((select string_agg(concat_ws('|', f.kind, f.title), ',') from public.p_al_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_al_i('h_saved') and f.title in ('Policy saved from lapse.', 'Policy lapsed.', 'Policy lapsed. Payments stopped.')),
          'servicing|Policy saved from lapse.', 'h6 a saved one reads saved, with no lapse row');
select public.p_al_owner();

-- ── i. Pending by name: nobody signed in can set Lapsed today ────────────────
-- 147 and 149 dropped every direct UPDATE on policies, PolicyModal is imported by nothing,
-- and no function or edge function sets Lapsed. Until an RPC exists, only the service role
-- reaches this trigger. When this section fails, that path has shipped: move it to a.
select public.p_al_policy('i_nobody');
select public.p_al_as('A');
update public.policies set status = 'Lapsed' where id = public.p_al_i('i_nobody');
select public.p_al_as('V');
update public.policies set status = 'Lapsed' where id = public.p_al_i('i_nobody');
select public.p_al_as('Z');
update public.policies set status = 'Lapsed' where id = public.p_al_i('i_nobody');
select public.p_al_owner();
select is((select status::text from public.policies where id = public.p_al_i('i_nobody')), 'In Effect', 'i1 pending by name: a direct update by agent, VA or admin changes nothing');
select is(public.p_al_n('i_nobody'), 0::bigint, 'i2 and writes no row');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname !~ '^p_al_' and p.prokind = 'f'
            and pg_get_functiondef(p.oid) ~* 'set[[:space:]]+status[[:space:]]*=[[:space:]]*''Lapsed'''), 0::bigint, 'i3 and no function sets Lapsed');

select * from finish();
rollback;
