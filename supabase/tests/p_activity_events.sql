-- p_activity_events — pgTAP checks for 202_activity_events.sql: every section 8 event
-- shows in agent_activity_feed when it happens, once, in plain words, and an agent's
-- spend changes stay private from their upline.
--
-- RUN: at apply time, by Brayden's apply step, against the applied migration. No
-- robot can run SQL against Ohvara, and none did. Everything runs in one
-- transaction that is rolled back.
-- Before that, on this computer only: `npm run test:sql --
-- supabase/tests/p_activity_events.sql` replays every migration into an in-memory
-- PGlite and runs this file there. It has no database URL and can't reach Ohvara.
-- A pass there is not a pass on the real stack: it is a stand-in for Supabase.
--
-- Cases fire the real action and read the feed. Written directly, and named here: a
-- lapse_save's outcome in e (200 isn't live, so no app role can write it), the source
-- rows in f and g (the logs the edge functions write), and in i and b the leads from
-- before this migration, seeded with the trigger off. now() doesn't move inside a
-- transaction, so a case that needs a time to move backdates the column first.
--
-- Cast: agent A, U (A's upline), B (no link), VA V (Fulfillment), admin Z.

begin;
create extension if not exists pgtap with schema extensions;
select plan(143);

-- ── seed (as the table owner) ───────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_events_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('aaaaaaaa-aaaa-4aaa-8202-00000000000a'::uuid, 'agent_a', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8202-00000000000b'::uuid, 'agent_b', 'agent'),
    ('aaaaaaaa-aaaa-4aaa-8202-00000000000c'::uuid, 'agent_u', 'agent'),
    ('bbbbbbbb-bbbb-4bbb-8202-000000000001'::uuid, 'va_v',    'fulfillment'),
    ('cccccccc-cccc-4ccc-8202-000000000001'::uuid, 'admin_z', 'agent')
  ) as u(id, n, role);
update public.profiles set role = 'admin' where id = 'cccccccc-cccc-4ccc-8202-000000000001';
update public.profiles set upline_id = 'aaaaaaaa-aaaa-4aaa-8202-00000000000c' where id = 'aaaaaaaa-aaaa-4aaa-8202-00000000000a';
update public.app_settings set submit_live = true, agent_billing_enforced = false where id = 1;

insert into public.carriers (id, name, is_active, hours, hours_tz, hours_status, hours_checked_at)
select 'dddddddd-dddd-4ddd-8202-000000000001', 'P Events Life', true, h.hours, 'America/Chicago', 'verified', now()
  from (select jsonb_object_agg(d, jsonb_build_object('open', '00:00', 'close', '23:59')) as hours
          from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d) h;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, anon, service_role;
create temp table spend_ids (name text primary key, id bigint);
grant all on spend_ids to authenticated, anon, service_role;

create function public.p_ae_id(p_who text) returns uuid language sql immutable as $f$
  select case p_who
    when 'A' then 'aaaaaaaa-aaaa-4aaa-8202-00000000000a'::uuid
    when 'B' then 'aaaaaaaa-aaaa-4aaa-8202-00000000000b'::uuid
    when 'U' then 'aaaaaaaa-aaaa-4aaa-8202-00000000000c'::uuid
    when 'V' then 'bbbbbbbb-bbbb-4bbb-8202-000000000001'::uuid
    when 'Z' then 'cccccccc-cccc-4ccc-8202-000000000001'::uuid
  end
$f$;

-- Sign in as someone.
create function public.p_ae_as(p_who text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', public.p_ae_id(p_who), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$f$;

-- Back to the table owner, nobody signed in.
create function public.p_ae_owner() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end
$f$;

-- help-voice: the service role, with no auth.uid().
create function public.p_ae_service() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end
$f$;

create function public.p_ae_i(p_name text) returns uuid language sql stable as $f$
  select id from ids where name = p_name
$f$;

-- The feed as whoever is signed in, wide enough for every case.
create function public.p_ae_feed(p_agent uuid default null)
returns table (id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb)
language sql stable as $f$
  select * from public.agent_activity_feed(now() - interval '60 days', now() + interval '1 day', p_agent, 5000)
$f$;

-- How many rows one lead has, of one kind.
create function public.p_ae_n(p_name text, p_kind text) returns bigint language sql stable as $f$
  select count(*) from public.p_ae_feed() f where f.lead_id = public.p_ae_i(p_name) and f.kind = p_kind
$f$;

-- A lead with a name and phone. The name is the case's name, so it's readable in a failure.
create function public.p_ae_lead(p_name text, p_first text, p_last text, p_phone text, p_agent uuid default null,
                                 p_type text default 'policy_help') returns uuid language sql as $f$
  with made as (
    insert into public.leads (business_name, contact_name, phone, state, lead_type, lead_source, assigned_rep_id)
    values (p_first || ' ' || p_last, p_first || ' ' || p_last, p_phone, 'TX', p_type, 'google', p_agent)
    returning id
  ), named as (
    insert into ids select p_name, id from made returning id
  )
  select id from named
$f$;

-- A policy in A's book that seeds nothing and logs no booking.
create function public.p_ae_policy(p_name text, p_phone text default null) returns uuid language sql as $f$
  with made as (
    insert into public.policies (agent_id, client_first_name, client_last_name, client_phone, status, effective_date,
                                 fulfillment_assigned, fulfillment_stage, replaced_old_policy)
    values (public.p_ae_id('A'), 'Case', p_name, p_phone, 'In Effect', current_date - 40, true, 'Pending', false)
    returning id
  ), named as (
    insert into ids select p_name, id from made returning id
  )
  select id from named
$f$;

-- One spend log row, as agent-billing writes it.
create function public.p_ae_spend(p_name text, p_agent uuid, p_old integer, p_new integer, p_was boolean, p_is boolean)
returns bigint language sql as $f$
  with made as (
    insert into public.agent_inbound_spend_log (agent_id, inbound_type, old_cents, new_cents, old_paused, new_paused)
    values (p_agent, 'live_call', p_old, p_new, p_was, p_is)
    returning id
  ), named as (
    insert into spend_ids select p_name, id from made returning id
  )
  select id from named
$f$;

-- One spend row as kind|title|reason|amount.
create function public.p_ae_spend_row(p_name text) returns text language sql stable as $f$
  select string_agg(f.kind || '|' || f.title || '|' || coalesce(f.meta ->> 'reason', '-') || '|' || coalesce(f.meta ->> 'amount_cents', '-'), ' + ')
    from public.p_ae_feed() f
   where f.id = 'spend_log:' || (select s.id::text from spend_ids s where s.name = p_name)
$f$;

-- Leads from before the migration: columns only, no event row.
alter table public.leads disable trigger leads_log_call_events;
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at,
                          va_outcome, va_attempts, va_last_worked_by, va_last_worked_at,
                          transfer_agent_id, transfer_status, transferred_at)
values
  ('eeeeeeee-eeee-4eee-8202-000000000001', 'Colin Column', 'Colin Column', '+15125550301', 'TX', 'policy_help', 'google', now() - interval '6 days',
   'not_reached', 1, public.p_ae_id('V'), now() - interval '2 days', null, null, null),
  ('eeeeeeee-eeee-4eee-8202-000000000002', 'Olive Olden', 'Olive Olden', '+15125550302', 'TX', 'policy_help', 'google', now() - interval '6 days',
   'transferred', 1, public.p_ae_id('V'), now() - interval '5 days', public.p_ae_id('A'), 'requested', now() - interval '5 days'),
  ('eeeeeeee-eeee-4eee-8202-000000000003', 'Theo Twoways', 'Theo Twoways', '+15125550303', 'TX', 'policy_help', 'google', now() - interval '6 days',
   'transferred', 1, public.p_ae_id('V'), now() - interval '5 days', public.p_ae_id('A'), 'requested', now() - interval '5 days'),
  ('eeeeeeee-eeee-4eee-8202-000000000004', 'Vera Vacolumn', 'Vera Vacolumn', '+15125550304', 'TX', 'policy_help', 'google', now() - interval '6 days',
   'not_reached', 1, public.p_ae_id('V'), now() - interval '5 days', public.p_ae_id('A'), null, null);
alter table public.leads enable trigger leads_log_call_events;
insert into ids values ('b_column', 'eeeeeeee-eeee-4eee-8202-000000000001'), ('i_old', 'eeeeeeee-eeee-4eee-8202-000000000002'),
                       ('i_both', 'eeeeeeee-eeee-4eee-8202-000000000003'), ('i_cross', 'eeeeeeee-eeee-4eee-8202-000000000004');

-- ── a. A submit ─────────────────────────────────────────────────────────────
select public.p_ae_as('A');
insert into ids select 'deal', public.agent_submit_deal(
  p_first => 'Dana', p_last => 'Deal', p_phone => '5125550201', p_city => 'Austin', p_state => 'TX',
  p_timezone => 'America/Chicago', p_new_carrier => 'dddddddd-dddd-4ddd-8202-000000000001',
  p_policy_number => 'NEW-1', p_replaced => false, p_best_time => 'morning', p_sms_consent => true);
select is((select count(*) from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('deal')
             and f.title = 'Submitted for servicing' and f.kind = 'servicing' and f.id like 'policy_event:%'), 1::bigint,
          'a1 a submit is one row titled Submitted for servicing, kind servicing');
select is((select count(*) from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('deal') and f.title = 'Call updated.'), 0::bigint,
          'a2 and no Call updated row');
select is((select string_agg(f.title, ',' order by f.title) from public.p_ae_feed() f
            where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('deal') and f.title like 'Servicing task added%'),
          'Servicing task added: chargeback watch.,Servicing task added: packet check.,Servicing task added: review call.',
          'a3 the 3 seeded steps still read as system steps');
select is((select count(*) from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('deal')), 4::bigint, 'a4 and nothing else');
select public.p_ae_owner();

-- ── b. VA attempts ──────────────────────────────────────────────────────────
select public.p_ae_lead('b_two', 'Bea', 'Twotries', '+15125550202');
select public.p_ae_as('V');
select public.va_claim(public.p_ae_i('b_two'));
select public.va_set_lead_outcome(public.p_ae_i('b_two'), null, 'not_reached');
select public.va_claim(public.p_ae_i('b_two'));
select public.va_set_lead_outcome(public.p_ae_i('b_two'), null, 'callback', now() + interval '1 day');
select public.p_ae_as('Z');
select is(public.p_ae_n('b_two', 'va_call'), 2::bigint, 'b1 two attempts give two rows');
select is((select string_agg((f.meta ->> 'attempt') || '|' || (f.meta ->> 'reason') || '|' || (f.meta ->> 'actor_name') || '|' || (f.meta ->> 'actor_role') || '|' || f.title,
                             ' + ' order by (f.meta ->> 'attempt')::int)
             from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_two') and f.kind = 'va_call'),
          '1|not_reached|Test va_v|fulfillment|A VA called and did not reach the client. + 2|callback|Test va_v|fulfillment|A VA called and set a callback.',
          'b2 attempts 1 and 2, with reason, actor and title');
select is((select f.meta ->> 'to' from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_two') and f.meta ->> 'attempt' = '2'),
          (select to_jsonb(l.va_callback_at) #>> '{}' from public.leads l where l.id = public.p_ae_i('b_two')), 'b3 the callback row carries to, as ISO');
select is((select count(*) from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_two') and f.meta ->> 'attempt' = '1' and f.meta ? 'to'), 0::bigint, 'b4 the not reached row has no to');
select is((select count(*) from public.p_ae_feed() f where f.id = 'va_call:' || public.p_ae_i('b_two')), 0::bigint, 'b5 the event rows hide the column row');
select public.p_ae_owner();

select is((select count(*) from public.inbound_events e where e.lead_id = public.p_ae_i('b_two') and e.kind = 'va_call'
             and e.state = 'done' and e.at = now() and e.actor_id = public.p_ae_id('V') and e.label is not null), 2::bigint,
          'b6 the rows are done, at va_last_worked_at, with the VA as actor and a label');

select public.p_ae_as('Z');
select is((select concat_ws('|', f.kind, f.meta ->> 'attempt', f.meta ->> 'reason', f.meta ->> 'actor_name')
             from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_column') and f.kind = 'va_call'),
          'va_call|1|not_reached|Test va_v', 'b7 a lead from before the migration still gives its one column row');
select is((select f.id from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_column') and f.kind = 'va_call'),
          'va_call:' || public.p_ae_i('b_column'), 'b8 and it is the column row');
select public.p_ae_owner();

select public.p_ae_lead('b_booked', 'Bob', 'Booked', '+15125550203');
select public.p_ae_as('V');
select public.va_claim(public.p_ae_i('b_booked'));
select public.va_set_lead_outcome(public.p_ae_i('b_booked'), null, 'not_reached');
select public.va_claim(public.p_ae_i('b_booked'));
select public.va_set_lead_outcome(public.p_ae_i('b_booked'), public.p_ae_id('A'), 'booked');
select public.p_ae_as('Z');
select is(public.p_ae_n('b_booked', 'va_call'), 1::bigint, 'b9 not reached then booked gives one va_call row');
select is((select f.meta ->> 'reason' from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_booked') and f.kind = 'va_call'), 'not_reached', 'b10 and it is the not reached one');
select is((select count(*) from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_booked') and f.title like '%not interested%'), 0::bigint, 'b11 and no not interested row');
select is((select count(*) from public.p_ae_feed() f where f.id = 'lead_booked:' || public.p_ae_i('b_booked') and f.kind = 'booked'), 1::bigint, 'b12 the booking stays on lead_booked');
select public.p_ae_owner();
select is((select count(*) from public.inbound_events e where e.lead_id = public.p_ae_i('b_booked') and e.kind = 'booked'), 0::bigint, 'b13 the trigger writes no booked event');

-- A save that moves va_last_worked_at with no attempt. Backdated so the move shows.
update public.leads set va_last_worked_at = now() - interval '1 hour' where id = public.p_ae_i('b_two');
create temp table b_before as select count(*) as n, (select va_attempts from public.leads where id = public.p_ae_i('b_two')) as attempts
  from public.inbound_events e where e.lead_id = public.p_ae_i('b_two');
grant all on b_before to authenticated, anon, service_role;
select public.p_ae_as('V');
select is(public.va_save_policy_help_lead('Bea', 'Twotries', '5125550202', null, 'TX', null, 'saved', null), public.p_ae_i('b_two'), 'b14 a save finds the same caller');
select public.p_ae_owner();
select is((select va_last_worked_at from public.leads where id = public.p_ae_i('b_two')), now(), 'b15 va_last_worked_at moved');
select is((select va_attempts from public.leads where id = public.p_ae_i('b_two')), (select attempts from b_before), 'b16 va_attempts did not');
select is((select count(*) from public.inbound_events e where e.lead_id = public.p_ae_i('b_two')), (select n from b_before), 'b17 and no event was added');

-- Attempts on a lead an agent holds reach that agent.
select public.p_ae_lead('b_mine', 'Mia', 'Mine', '+15125550204', public.p_ae_id('A'));
select public.p_ae_as('Z');
select public.va_set_lead_outcome(public.p_ae_i('b_mine'), null, 'not_interested');
select public.p_ae_as('A');
select is((select concat_ws('|', f.agent_id, f.meta ->> 'reason', f.title) from public.p_ae_feed() f where f.lead_id = public.p_ae_i('b_mine') and f.kind = 'va_call'),
          public.p_ae_id('A') || '|not_interested|A VA called and the client is not interested.', 'b18 the attempt is the lead''s agent''s');
select public.p_ae_as('B');
select is(public.p_ae_n('b_mine', 'va_call'), 0::bigint, 'b19 and not another agent''s');
select public.p_ae_as('V');
select is(public.p_ae_n('b_mine', 'va_call'), 0::bigint, 'b20 and Fulfillment gets no va_call row');
select public.p_ae_owner();

-- ── c. Transfers ────────────────────────────────────────────────────────────
-- A new caller: the lead is inserted already marked requested.
select public.p_ae_as('V');
insert into ids select 'c_new', public.va_save_policy_help_lead('Nia', 'Newcaller', '5125550205', 'Austin', 'TX', '{}'::jsonb, 'transfer', public.p_ae_id('A'));
select public.p_ae_as('A');
select is((select count(*) from public.p_ae_feed() f where f.lead_id = public.p_ae_i('c_new') and f.kind = 'transferred' and f.id like 'inbound_event:%'), 1::bigint,
          'c1 a new caller gives one requested event row');
select is((select concat_ws('|', f.agent_id, f.meta ->> 'reason', f.meta ->> 'actor_name', f.meta ->> 'actor_role', f.title)
             from public.p_ae_feed() f where f.lead_id = public.p_ae_i('c_new') and f.kind = 'transferred'),
          public.p_ae_id('A') || '|requested|Test va_v|fulfillment|A live transfer was requested.', 'c2 for the agent, with the VA as actor');
select is(public.p_ae_n('c_new', 'va_call'), 0::bigint, 'c3 and no va_call row');
select is((select count(*) from public.p_ae_feed() f where f.id = 'lead_transfer:' || public.p_ae_i('c_new')), 0::bigint, 'c4 and the column row is hidden');
select public.p_ae_owner();
select is((select e.at from public.inbound_events e where e.lead_id = public.p_ae_i('c_new') and e.kind = 'transferred'),
          (select l.transferred_at from public.leads l where l.id = public.p_ae_i('c_new')), 'c5 at is transferred_at');

-- An existing caller: the same call updates the lead.
select public.p_ae_lead('c_old', 'Otto', 'Oldcaller', '+15125550206');
select public.p_ae_as('V');
select is(public.va_save_policy_help_lead('Otto', 'Oldcaller', '5125550206', 'Austin', 'TX', null, 'transfer', public.p_ae_id('A')), public.p_ae_i('c_old'),
          'c6 an existing caller keeps their lead');
select public.p_ae_as('A');
select is((select count(*) from public.p_ae_feed() f where f.lead_id = public.p_ae_i('c_old') and f.kind = 'transferred' and f.id like 'inbound_event:%'), 1::bigint,
          'c7 and gives one requested event row');
select is((select concat_ws('|', f.meta ->> 'reason', f.meta ->> 'actor_name') from public.p_ae_feed() f where f.lead_id = public.p_ae_i('c_old') and f.kind = 'transferred'),
          'requested|Test va_v', 'c8 with the VA as actor');
select is(public.p_ae_n('c_old', 'va_call'), 0::bigint, 'c9 and no va_call row');

-- help-voice: the service role, no auth.uid(), and only transfer_status changes.
select public.p_ae_service();
select is(auth.uid(), null, 'c10 help-voice has no auth.uid()');
update public.leads set transfer_status = 'connected' where id = public.p_ae_i('c_new');
select public.p_ae_as('A');
select is(public.p_ae_n('c_new', 'transferred'), 2::bigint, 'c11 connected gives both rows');
select is((select string_agg(concat_ws('|', f.meta ->> 'reason', f.meta ->> 'actor_name', f.title), ' + ' order by f.meta ->> 'reason' desc)
             from public.p_ae_feed() f where f.lead_id = public.p_ae_i('c_new') and f.kind = 'transferred'),
          'requested|Test va_v|A live transfer was requested. + connected|Ohvara|A live transfer connected.', 'c12 the connected row reads as Ohvara');
select public.p_ae_owner();
select is((select concat_ws('|', e.actor_id, e.actor_name, e.actor_role) from public.inbound_events e
            where e.lead_id = public.p_ae_i('c_new') and e.detail ->> 'status' = 'connected'), 'Ohvara|system', 'c13 with no actor id and role system');

select public.p_ae_service();
update public.leads set transfer_status = 'connected' where id = public.p_ae_i('c_new');
select public.p_ae_as('A');
select is(public.p_ae_n('c_new', 'transferred'), 2::bigint, 'c14 a repeated webhook adds nothing');

select public.p_ae_service();
update public.leads set transfer_status = 'dropped' where id = public.p_ae_i('c_old');
select public.p_ae_as('A');
select is((select concat_ws('|', f.meta ->> 'actor_name', f.title) from public.p_ae_feed() f
            where f.lead_id = public.p_ae_i('c_old') and f.kind = 'transferred' and f.meta ->> 'reason' = 'dropped'),
          'Ohvara|A live transfer dropped.', 'c15 dropped reads dropped');
select public.p_ae_owner();
select is((select e.label from public.inbound_events e where e.lead_id = public.p_ae_i('c_old') and e.detail ->> 'status' = 'dropped'),
          'A live transfer dropped.', 'c16 and the timeline label says so, not Transferred to you');
select public.p_ae_service();
update public.leads set transfer_status = 'dropped' where id = public.p_ae_i('c_old');
select public.p_ae_as('A');
select is(public.p_ae_n('c_old', 'transferred'), 2::bigint, 'c17 a repeated dropped adds nothing');
select public.p_ae_owner();

-- A repeat request: the status stays requested with a new time. Backdating is itself a move, so count after it.
select public.p_ae_as('V');
insert into ids select 'c_again', public.va_save_policy_help_lead('Ada', 'Again', '5125550207', 'Austin', 'TX', null, 'transfer', public.p_ae_id('A'));
select public.p_ae_owner();
update public.leads set transferred_at = now() - interval '1 hour' where id = public.p_ae_i('c_again');
create temp table c_before as select count(*) as n from public.inbound_events e where e.lead_id = public.p_ae_i('c_again') and e.kind = 'transferred';
grant all on c_before to authenticated, anon, service_role;
select public.p_ae_as('V');
select public.va_save_policy_help_lead('Ada', 'Again', '5125550207', 'Austin', 'TX', null, 'transfer', public.p_ae_id('A'));
select public.p_ae_owner();
select is((select transfer_status from public.leads where id = public.p_ae_i('c_again')), 'requested', 'c18 a repeat request stays requested');
select is((select count(*) from public.inbound_events e where e.lead_id = public.p_ae_i('c_again') and e.kind = 'transferred'),
          (select n + 1 from c_before), 'c19 and adds a row');

-- A transferred attempt: one action, one row.
select public.p_ae_lead('c_set', 'Sue', 'Setoutcome', '+15125550208');
select public.p_ae_as('V');
select public.va_claim(public.p_ae_i('c_set'));
select public.va_set_lead_outcome(public.p_ae_i('c_set'), public.p_ae_id('A'), 'transferred');
select public.p_ae_as('A');
select is(public.p_ae_n('c_set', 'transferred'), 1::bigint, 'c20 a transferred attempt gives one transferred row');
select is(public.p_ae_n('c_set', 'va_call'), 0::bigint, 'c21 and no va_call row');
select is((select concat_ws('|', f.meta ->> 'reason', f.meta ->> 'actor_name') from public.p_ae_feed() f where f.lead_id = public.p_ae_i('c_set') and f.kind = 'transferred'),
          'requested|Test va_v', 'c22 reading requested, with the VA as actor');
select public.p_ae_owner();
select is((select va_attempts from public.leads where id = public.p_ae_i('c_set')), 1, 'c23 though the attempt did count');

-- A dropped lead's agent comes from the transfer; a lead with no agent still writes its row.
select public.p_ae_lead('c_noagent', 'Nell', 'Noagent', '+15125550209');
update public.leads set transfer_status = 'dropped' where id = public.p_ae_i('c_noagent');
select is((select count(*) from public.inbound_events e where e.lead_id = public.p_ae_i('c_noagent') and e.kind = 'transferred' and e.agent_id is null), 1::bigint,
          'c24 a status with no agent anywhere still writes, with no agent');

-- ── d. Requests ─────────────────────────────────────────────────────────────
select public.p_ae_policy('d_pol');
select public.p_ae_as('A');
insert into ids select 'd_req', public.agent_submit_service_request(public.p_ae_i('d_pol'), 'address_change', 'New address', 'morning');
select is((select concat_ws('|', f.kind, f.title) from public.p_ae_feed() f where f.id = 'servicing_added:' || public.p_ae_i('d_req')),
          'servicing|Request opened: address change.', 'd1 an agent''s request reads opened');
select public.p_ae_owner();
update public.servicing_tasks set status = 'done' where id = public.p_ae_i('d_req');
select public.p_ae_as('A');
select is((select concat_ws('|', f.kind, f.title) from public.p_ae_feed() f where f.id = 'servicing_done:' || public.p_ae_i('d_req')),
          'servicing|Request done: address change.', 'd2 and done');
select is((select count(*) from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('d_pol')), 2::bigint, 'd3 and only those two: the service_request event stays skipped');
select public.p_ae_owner();
update public.servicing_tasks set status = 'done' where policy_id = public.p_ae_i('deal') and kind = 'packet_check';
select public.p_ae_as('A');
select is((select string_agg(f.title, ',') from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('deal') and f.id like 'servicing_done:%'),
          'Servicing task done: packet check.', 'd4 a system step still reads as a step');
select public.p_ae_owner();
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by) values (public.p_ae_id('A'), public.p_ae_i('d_pol'), 'claim_help', 'requested', 'client');
select public.p_ae_as('A');
select is((select count(*) from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('d_pol') and f.title = 'Request opened: claim help.'), 1::bigint,
          'd5 a client''s request reads as a request too');
select public.p_ae_owner();

-- ── e. Lapse ────────────────────────────────────────────────────────────────
-- Opened by the agent through the RPC, so lapse wording has to beat request wording.
-- Outcome is set directly: 200 isn't live and no app role can write it yet.
select public.p_ae_policy('e_saved'), public.p_ae_policy('e_lapsed'), public.p_ae_policy('e_cancelled'), public.p_ae_policy('e_none');
select public.p_ae_as('A');
insert into ids
select 't_' || n, public.agent_submit_service_request(public.p_ae_i(n), 'lapse_save', null, null)
  from unnest(array['e_saved', 'e_lapsed', 'e_cancelled', 'e_none']) n;
select is((select count(*) from public.p_ae_feed() f where f.id in (select 'servicing_added:' || i.id from ids i where i.name like 't_e_%') and f.title = 'Lapse risk flagged.' and f.kind = 'servicing'),
          4::bigint, 'e1 an open lapse_save reads Lapse risk flagged, though an agent opened it');
select public.p_ae_owner();
update public.servicing_tasks set status = 'done', outcome = 'saved' where id = public.p_ae_i('t_e_saved');
update public.servicing_tasks set status = 'done', outcome = 'lapsed' where id = public.p_ae_i('t_e_lapsed');
update public.servicing_tasks set status = 'done', outcome = 'client_cancelled' where id = public.p_ae_i('t_e_cancelled');
update public.servicing_tasks set status = 'done' where id = public.p_ae_i('t_e_none');
select public.p_ae_as('A');
select is((select concat_ws('|', f.title, f.meta ->> 'reason') from public.p_ae_feed() f where f.id = 'servicing_done:' || public.p_ae_i('t_e_saved')),
          'Policy saved from lapse.|saved', 'e2 done and saved, with the outcome in reason');
select is((select concat_ws('|', f.title, f.meta ->> 'reason') from public.p_ae_feed() f where f.id = 'servicing_done:' || public.p_ae_i('t_e_lapsed')),
          'Policy lapsed.|lapsed', 'e3 done and lapsed');
select is((select concat_ws('|', f.title, f.meta ->> 'reason') from public.p_ae_feed() f where f.id = 'servicing_done:' || public.p_ae_i('t_e_cancelled')),
          'The client cancelled the policy.|client_cancelled', 'e4 done and client cancelled');
select is((select concat_ws('|', f.title, f.meta ->> 'reason') from public.p_ae_feed() f where f.id = 'servicing_done:' || public.p_ae_i('t_e_none')),
          'Lapse work done.', 'e5 done with no outcome reads the fallback, with no reason');
select is((select count(*) from public.p_ae_feed() f where f.title like 'Request%lapse%'), 0::bigint, 'e6 no lapse_save ever reads as a request');
select public.p_ae_owner();
insert into public.servicing_tasks (agent_id, policy_id, kind, status, requested_by) values (public.p_ae_id('A'), public.p_ae_i('e_none'), 'lapse_save', 'scheduled', 'system');
select public.p_ae_as('A');
select is((select count(*) from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('e_none') and f.title = 'Lapse risk flagged.'), 2::bigint,
          'e7 a system-opened one reads the same');
select public.p_ae_owner();

-- ── f. Texts ────────────────────────────────────────────────────────────────
-- Source rows as recovery-sms and lead-workflow-sms write them.
select public.p_ae_policy('f_pol', '+15125550299');
select public.p_ae_lead('f_lead', 'Fay', 'Texted', '+15125550299', public.p_ae_id('A'), 'mortgage_protection');
insert into public.recovery_sms_log (id, policy_id, kind, to_phone, ok, twilio_sid, error, skipped)
values ('ffffffff-ffff-4fff-8202-000000000001', public.p_ae_i('f_pol'), 'text1', '+15125550299', true, 'SMp202recoverysent', null, null),
       ('ffffffff-ffff-4fff-8202-000000000002', public.p_ae_i('f_pol'), 'text2', '+15125550299', false, null, 'Twilio said no to +15125550299', null),
       ('ffffffff-ffff-4fff-8202-000000000003', public.p_ae_i('f_pol'), 'am', '+15125550299', false, null, null, 'sms_off'),
       ('ffffffff-ffff-4fff-8202-000000000004', public.p_ae_i('f_pol'), 'confirm', '+15125550299', true, 'SMp202recoveryconfirm', null, null);
insert into public.inbound_events (id, lead_id, agent_id, kind, state, label, detail, actor_name, actor_role)
values
  ('ffffffff-ffff-4fff-8202-000000000011', public.p_ae_i('f_lead'), public.p_ae_id('A'), 'text_sent', 'done', 'Welcome text',
   '{"step": "instant", "seq": 1, "twilio_sid": "SMp202workflowsent", "summary": "Thanks them."}', 'Ohvara', 'system'),
  ('ffffffff-ffff-4fff-8202-000000000012', public.p_ae_i('f_lead'), public.p_ae_id('A'), 'reminder', 'done', 'Reminder text',
   '{"step": "reminder_day_before", "seq": 1, "twilio_sid": "SMp202workflowreminder"}', 'Ohvara', 'system'),
  ('ffffffff-ffff-4fff-8202-000000000013', public.p_ae_i('f_lead'), public.p_ae_id('A'), 'text_sent', 'scheduled', 'Follow-up text, day 1',
   '{"step": "not_reached_d1", "seq": 1}', 'Ohvara', 'system'),
  ('ffffffff-ffff-4fff-8202-000000000014', public.p_ae_i('f_lead'), public.p_ae_id('A'), 'text_sent', 'skipped', 'Follow-up text, day 3',
   '{"step": "not_reached_d3", "seq": 1, "reason": "send_failed", "error": "Twilio said no to +15125550299"}', 'Ohvara', 'system'),
  ('ffffffff-ffff-4fff-8202-000000000015', public.p_ae_i('f_lead'), public.p_ae_id('A'), 'text_sent', 'done', 'Follow-up text, day 7',
   '{"step": "not_reached_d7", "seq": 1}', 'Ohvara', 'system'),
  ('ffffffff-ffff-4fff-8202-000000000016', public.p_ae_i('f_lead'), public.p_ae_id('A'), 'text_sent', 'done', 'Monthly check-in text',
   '{"step": "not_reached_monthly", "seq": 1, "twilio_sid": null}', 'Ohvara', 'system'),
  ('ffffffff-ffff-4fff-8202-000000000017', public.p_ae_i('f_lead'), public.p_ae_id('A'), 'text_sent', 'done', 'Rebook text',
   '{"step": "no_show_rebook", "seq": 1, "twilio_sid": ""}', 'Ohvara', 'system');
select public.p_ae_as('A');
select is((select count(*) from public.p_ae_feed() f where f.id = 'recovery_sms:ffffffff-ffff-4fff-8202-000000000001' and f.kind = 'text_auto'
             and f.title = 'Automatic text sent after a missed call.' and f.agent_id = public.p_ae_id('A') and (f.meta ->> 'policy_id')::uuid = public.p_ae_i('f_pol')), 1::bigint,
          'f1 a confirmed recovery text shows once, for the policy''s agent');
select is((select f.title from public.p_ae_feed() f where f.id = 'recovery_sms:ffffffff-ffff-4fff-8202-000000000004'), 'Automatic confirmation text sent.', 'f2 each recovery kind has its own sentence');
select is((select concat_ws('|', f.kind, f.title, f.meta ->> 'reason') from public.p_ae_feed() f where f.id = 'inbound_event:ffffffff-ffff-4fff-8202-000000000011'),
          'text_auto|Welcome text sent automatically.|instant', 'f3 a confirmed text_sent row shows once');
select is((select concat_ws('|', f.kind, f.title, f.meta ->> 'reason') from public.p_ae_feed() f where f.id = 'inbound_event:ffffffff-ffff-4fff-8202-000000000012'),
          'text_auto|Automatic reminder text sent.|reminder_day_before', 'f4 a confirmed reminder row shows once');
select is((select count(*) from public.p_ae_feed() f where f.id = 'recovery_sms:ffffffff-ffff-4fff-8202-000000000002'), 0::bigint, 'f5 a failed recovery text does not show');
select is((select count(*) from public.p_ae_feed() f where f.id = 'recovery_sms:ffffffff-ffff-4fff-8202-000000000003'), 0::bigint, 'f6 a skipped recovery text does not show');
select is((select count(*) from public.p_ae_feed() f where f.id = 'inbound_event:ffffffff-ffff-4fff-8202-000000000013'), 0::bigint, 'f7 a scheduled step does not show');
select is((select count(*) from public.p_ae_feed() f where f.id = 'inbound_event:ffffffff-ffff-4fff-8202-000000000014'), 0::bigint, 'f8 a skipped step does not show');
select is((select count(*) from public.p_ae_feed() f where f.id = 'inbound_event:ffffffff-ffff-4fff-8202-000000000015'), 0::bigint, 'f9 a done row with no sid does not show');
select is((select count(*) from public.p_ae_feed() f where f.id = 'inbound_event:ffffffff-ffff-4fff-8202-000000000016'), 0::bigint, 'f10 nor one whose sid is null');
select is((select count(*) from public.p_ae_feed() f where f.id = 'inbound_event:ffffffff-ffff-4fff-8202-000000000017'), 0::bigint, 'f11 nor one whose sid is empty');
select is((select count(*) from public.p_ae_feed() f where f.kind = 'text_auto' and (f.lead_id = public.p_ae_i('f_lead') or (f.meta ->> 'policy_id')::uuid = public.p_ae_i('f_pol'))), 4::bigint,
          'f12 so these sources give exactly four text rows');
select public.p_ae_as('V');
select is((select count(*) from public.p_ae_feed() f where f.kind = 'text_auto'), 0::bigint, 'f13 and Fulfillment gets none of them');
select public.p_ae_owner();

-- ── g. Spend ────────────────────────────────────────────────────────────────
-- Source rows as agent-billing's logSpendChange writes them.
select public.p_ae_spend('change', public.p_ae_id('A'), 10000, 25000, false, false);
select public.p_ae_spend('pause', public.p_ae_id('A'), 25000, 25000, false, true);
select public.p_ae_spend('resume', public.p_ae_id('A'), 25000, 25000, true, false);
select public.p_ae_spend('both', public.p_ae_id('A'), 25000, 50000, false, true);
select public.p_ae_spend('resume_both', public.p_ae_id('A'), 50000, 10000, true, false);
select public.p_ae_spend('nothing', public.p_ae_id('A'), 50000, 50000, false, false);
select public.p_ae_spend('uplines_own', public.p_ae_id('U'), 0, 10000, false, false);

select public.p_ae_as('A');
select is(public.p_ae_spend_row('change'), 'billing_spend_change|Weekly lead spend changed.|-|25000', 'g1 a change is one row, with its amount');
select is(public.p_ae_spend_row('pause'), 'billing_spend_pause|Lead spend paused.|paused|-', 'g2 a pause is one row, with no amount');
select is(public.p_ae_spend_row('resume'), 'billing_spend_pause|Lead spend resumed.|resumed|-', 'g3 a resume is one row and reads resumed');
select is(public.p_ae_spend_row('both'), 'billing_spend_pause|Lead spend paused.|paused|50000', 'g4 amount and pause together are one pause row, with the amount');
select is(public.p_ae_spend_row('resume_both'), 'billing_spend_pause|Lead spend resumed.|resumed|10000', 'g5 amount and resume together read resumed');
select is(public.p_ae_spend_row('nothing'), null, 'g6 a row that changed nothing gives none');
select is((select count(*) from public.p_ae_feed() f where f.id like 'spend_log:%' and f.kind in ('billing_spend_change', 'billing_spend_pause') and f.lead_id is null), 5::bigint, 'g7 the agent sees their five, with no lead');
select is((select count(*) from public.p_ae_feed(public.p_ae_id('A')) f where f.id like 'spend_log:%'), 5::bigint, 'g8 and passing their own id too');
select is((select f.meta ->> 'inbound_type' from public.p_ae_feed() f where f.id = 'spend_log:' || (select s.id::text from spend_ids s where s.name = 'change')), 'live_call', 'g9 with the type in meta');
select is((select jsonb_typeof(f.meta -> 'amount_cents') from public.p_ae_feed() f where f.id = 'spend_log:' || (select s.id::text from spend_ids s where s.name = 'change')), 'number', 'g10 amount_cents is a number, which is what Activity.jsx reads');
select is((select count(*) from public.p_ae_feed() f where f.id = 'spend_log:' || (select s.id::text from spend_ids s where s.name = 'uplines_own')), 0::bigint, 'g11 and not their upline''s');
select is((select count(*) from public.p_ae_feed() f where f.id like 'spend_log:%' and f.title ~* '\m(meta|google|ads?)\M'), 0::bigint, 'g12 no spend row names an ad platform');
select public.p_ae_as('Z');
select is((select count(*) from public.p_ae_feed(public.p_ae_id('A')) f where f.id like 'spend_log:%'), 5::bigint, 'g13 admin sees them');
select public.p_ae_as('U');
select is((select count(*) from public.p_ae_feed() f where f.kind in ('billing_spend_change', 'billing_spend_pause') and f.agent_id = public.p_ae_id('A')), 0::bigint, 'g14 the upline gets none of A''s');
select is((select count(*) from public.p_ae_feed(public.p_ae_id('A')) f where f.kind in ('billing_spend_change', 'billing_spend_pause')), 0::bigint, 'g15 even passing p_agent');
select ok((select count(*) from public.p_ae_feed(public.p_ae_id('A')) f) > 0, 'g16 though the upline does still see A''s other rows');
select is((select count(*) from public.p_ae_feed() f where f.id = 'spend_log:' || (select s.id::text from spend_ids s where s.name = 'uplines_own')), 1::bigint, 'g17 and their own spend');
select public.p_ae_as('B');
select is((select count(*) from public.p_ae_feed() f where f.id like 'spend_log:%'), 0::bigint, 'g18 another agent gets none');
select public.p_ae_as('V');
select is((select count(*) from public.p_ae_feed() f where f.id like 'spend_log:%'), 0::bigint, 'g19 Fulfillment gets none');
select is((select count(*) from public.p_ae_feed(public.p_ae_id('A')) f where f.id like 'spend_log:%'), 0::bigint, 'g20 even passing p_agent');
select public.p_ae_owner();

-- ── h. Every section 8 type ─────────────────────────────────────────────────
-- What the cases above haven't fired yet: the text reply (the webhook's row), the call
-- attempt, result and cancellation on a policy (policy_events_log on a real update),
-- and the agent's outcome.
insert into public.lead_sms_replies (from_phone, body, twilio_sid, lead_id)
values ('+15125550299', 'Call me at 512-555-0299 please', 'SMp202reply', public.p_ae_i('f_lead'));
select public.p_ae_policy('h_call');
update public.policies set call_live_since = now(), call_attempts = 1 where id = public.p_ae_i('h_call');
update public.policies set call_live_since = null, last_call_outcome = 'no_answer' where id = public.p_ae_i('h_call');
update public.policies set fulfillment_stage = 'Complete' where id = public.p_ae_i('h_call');
select public.p_ae_as('A');
select public.set_inbound_outcome(public.p_ae_i('b_mine'), 'follow_up');
select public.p_ae_as('Z');
create temp table section8 as select * from public.p_ae_feed();
select ok(exists (select 1 from section8 s where s.kind = t.kind and s.title like t.pattern), 'h ' || t.name)
  from (values
    ('submitted',              'servicing',            'Submitted for servicing'),
    ('step done',              'servicing',            'Servicing task done: %'),
    ('text sent',              'text_auto',            'Automatic %'),
    ('text reply',             'text_reply',           'The client replied by text.'),
    ('call attempt, VA',       'va_call',              'A VA called%'),
    ('call attempt, policy',   'in_progress',          'A call started.'),
    ('call result, policy',    'no_answer',            'No-show%'),
    ('cancellation confirmed', 'cancelled',            'Old policy confirmed cancelled.'),
    ('lapse risk',             'servicing',            'Lapse risk flagged.'),
    ('lapse saved',            'servicing',            'Policy saved from lapse.'),
    ('request opened',         'servicing',            'Request opened: %'),
    ('request done',           'servicing',            'Request done: %'),
    ('lead booked',            'booked',               'A VA booked an appointment.'),
    ('lead transferred',       'transferred',          'A live transfer connected.'),
    ('lead outcome',           'outcome',              'Outcome marked: follow up.'),
    ('billing change, amount', 'billing_spend_change', 'Weekly lead spend changed.'),
    ('billing change, pause',  'billing_spend_pause',  'Lead spend paused.')
  ) as t(name, kind, pattern);
select is((select count(*) from section8 s where s.kind = 'billing_subscription'), 0::bigint,
          'h pending by name: billing_subscription, no charge-history source exists through 197');
select is((select count(*) from section8 s where s.title ilike '%plan%'), 0::bigint,
          'h pending by name: a plan change needs 201');
select public.p_ae_owner();

-- ── i. The duplicate check has no date window ───────────────────────────────
select public.p_ae_as('Z');
select is((select f.id from public.agent_activity_feed(now() - interval '6 days', now() - interval '4 days', null, 5000) f
            where f.lead_id = public.p_ae_i('i_old') and f.kind = 'transferred'),
          'lead_transfer:' || public.p_ae_i('i_old'), 'i1 an old lead with only columns shows its column row on the old day');
select public.p_ae_service();
update public.leads set transfer_status = 'connected' where id = public.p_ae_i('i_old');
select public.p_ae_as('Z');
select is((select count(*) from public.agent_activity_feed(now() - interval '6 days', now() - interval '4 days', null, 5000) f
            where f.lead_id = public.p_ae_i('i_old') and f.kind = 'transferred'), 0::bigint,
          'i2 once it connects a later day, nothing shows on the old day');
select is((select string_agg(concat_ws('|', f.meta ->> 'reason', f.meta ->> 'actor_name'), ',') from public.agent_activity_feed(now() - interval '1 hour', now() + interval '1 hour', null, 5000) f
            where f.lead_id = public.p_ae_i('i_old') and f.kind = 'transferred' and f.id like 'inbound_event:%'),
          'connected|Ohvara', 'i3 and the later day shows the event row');
select is((select count(*) from public.agent_activity_feed(now() - interval '60 days', now() + interval '1 hour', null, 5000) f
            where f.lead_id = public.p_ae_i('i_old') and f.kind = 'transferred'), 1::bigint, 'i4 and that is the only one, across every day');

select public.va_set_lead_outcome(public.p_ae_i('i_both'), null, 'not_reached');
select is((select count(*) from public.p_ae_feed() f where f.id = 'lead_transfer:' || public.p_ae_i('i_both')), 1::bigint,
          'i5 a new VA attempt keeps the old lead''s transfer column row');
select is((select string_agg(f.id, ',') from public.p_ae_feed() f where f.lead_id = public.p_ae_i('i_both') and f.kind = 'va_call'),
          (select 'inbound_event:' || e.id from public.inbound_events e where e.lead_id = public.p_ae_i('i_both') and e.kind = 'va_call'),
          'i6 and shows the va_call event row');

select public.p_ae_service();
update public.leads set transfer_status = 'dropped' where id = public.p_ae_i('i_cross');
select public.p_ae_as('Z');
select is((select count(*) from public.p_ae_feed() f where f.id = 'va_call:' || public.p_ae_i('i_cross')), 1::bigint,
          'i7 a transferred event doesn''t hide the va_call column row');
select is(public.p_ae_n('i_cross', 'transferred'), 1::bigint, 'i8 and shows its own row');
select public.p_ae_owner();

-- ── j. What never comes back ────────────────────────────────────────────────
-- Seeded in the source rows, including places the feed has to skip over. 5125550299 is
-- the client's number; f's rows and h's reply hold it and Twilio ids already.
update public.profiles set stripe_customer_id = 'cus_p202secret', stripe_subscription_id = 'sub_p202secret' where id = public.p_ae_id('A');
select public.p_ae_lead('j_lead', 'Joy', 'Private', '+15125550299', public.p_ae_id('A'));
insert into public.inbound_events (lead_id, agent_id, kind, state, label, detail)
values (public.p_ae_i('j_lead'), public.p_ae_id('A'), 'va_call', 'done', 'x',
        '{"outcome": "not_reached", "attempt": 9, "twilio_sid": "SMp202stray", "stripe_customer": "cus_p202secret", "phone": "+15125550299", "error": "to +15125550299"}'),
       (public.p_ae_i('j_lead'), public.p_ae_id('A'), 'transferred', 'done', 'x',
        '{"status": "connected", "twilio_sid": "SMp202stray", "stripe_customer": "cus_p202secret", "phone": "+15125550299"}'),
       (public.p_ae_i('j_lead'), public.p_ae_id('A'), 'text_sent', 'done', 'x',
        '{"step": "not_reached_d0", "seq": 1, "twilio_sid": "SMp202stray", "stripe_customer": "cus_p202secret", "phone": "+15125550299", "error": "to +15125550299"}');
insert into public.lead_followup_sms_log (lead_id, stage, status, to_phone, from_number, twilio_sid)
values (public.p_ae_i('j_lead'), 'just_submitted', 'sent', '+15125550299', '+15125550298', 'SMp202followup');
insert into public.policy_events (policy_id, agent_id, kind, detail)
values (public.p_ae_i('f_pol'), public.p_ae_id('A'), 'submitted',
        '{"label": "x +15125550299", "stripe_subscription": "sub_p202secret", "twilio_sid": "SMp202stray"}');
select public.p_ae_as('Z');
create temp table sources as
  select (select count(*) from public.p_ae_feed() f where f.lead_id = public.p_ae_i('j_lead')) as lead_rows,
         (select count(*) from public.p_ae_feed() f where (f.meta ->> 'policy_id')::uuid = public.p_ae_i('f_pol')) as policy_rows;
select ok((select lead_rows >= 4 and policy_rows >= 3 from sources), 'j1 the rows holding those values do reach the feed');
select is((select count(*) from public.p_ae_feed() f where f.id || f.title || f.meta::text ~* '5125550299|555-0299|5125550298'), 0::bigint, 'j2 admin: no feed output holds a seeded phone number');
select is((select count(*) from public.p_ae_feed() f where f.id || f.title || f.meta::text ~* 'SMp202'), 0::bigint, 'j3 admin: no feed output holds a Twilio id');
select is((select count(*) from public.p_ae_feed() f where f.id || f.title || f.meta::text ~* 'cus_p202|sub_p202'), 0::bigint, 'j4 admin: no feed output holds a Stripe id');
select public.p_ae_as('A');
select is((select count(*) from public.p_ae_feed() f where f.id || f.title || f.meta::text ~* '5125550299|555-0299|5125550298|SMp202|cus_p202|sub_p202'), 0::bigint,
          'j5 the agent: none of them either');
select is((select f.meta ->> 'preview' from public.p_ae_feed() f where f.lead_id = public.p_ae_i('f_lead') and f.kind = 'text_reply'), 'Call me at [number removed] please', 'j6 a reply''s number is scrubbed');
select is((select count(*) from public.p_ae_feed() f where f.kind = 'text_auto' and (f.meta ? 'twilio_sid' or f.meta ? 'error' or f.meta ? 'to_phone')), 0::bigint, 'j7 no text row returns a sid, error or phone key');
select is((select count(*) from public.p_ae_feed() f where f.title = 'x' or f.title like '%x +1%'), 0::bigint, 'j8 no title comes from a label');
select public.p_ae_owner();

-- The trigger's own rows.
select is((select count(*) from public.inbound_events e
            where e.kind in ('va_call', 'transferred') and e.lead_id <> public.p_ae_i('j_lead') and e.detail ? 'step'), 0::bigint, 'j9 trigger rows have no detail.step');
select is((select count(*) from public.inbound_events e, jsonb_object_keys(e.detail) k
            where e.kind in ('va_call', 'transferred') and e.lead_id <> public.p_ae_i('j_lead')
              and k not in ('outcome', 'attempt', 'callback_at', 'status', 'summary')), 0::bigint, 'j10 detail holds only the named keys');
select is((select count(*) from public.inbound_events e where e.kind in ('booked', 'rebooked', 'no_show', 'text_received')), 0::bigint, 'j11 no row of a kind that drives the workflow''s stop logic');
select is((select count(*) from public.inbound_events e where e.kind in ('va_call', 'transferred') and e.label is null), 0::bigint, 'j12 every trigger row has a label');

insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, is_sample, transfer_agent_id, transfer_status, transferred_at)
values ('eeeeeeee-eeee-4eee-8202-000000000005', 'Sam Sample', 'Sam Sample', '+15125550305', 'TX', 'policy_help', 'google', true, public.p_ae_id('A'), 'requested', now());
insert into ids values ('j_sample', 'eeeeeeee-eeee-4eee-8202-000000000005');
select public.p_ae_as('Z');
select public.va_set_lead_outcome(public.p_ae_i('j_sample'), null, 'not_reached');
select public.p_ae_owner();
select is((select count(*) from public.inbound_events e where e.lead_id = public.p_ae_i('j_sample') and e.kind in ('va_call', 'transferred') and e.is_sample), 2::bigint,
          'j13 a sample lead''s rows carry is_sample, on insert and on update');
select is((select count(*) from public.inbound_events e where e.lead_id = public.p_ae_i('b_two') and e.is_sample), 0::bigint, 'j14 and a real lead''s don''t');

-- A cancellation lead writes nothing.
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, transfer_status, transferred_at)
values ('eeeeeeee-eeee-4eee-8202-000000000006', 'Cal Cancel', 'Cal Cancel', '+15125550306', 'TX', 'cancellation', 'google', 'requested', now());
update public.leads set va_attempts = va_attempts + 1, va_outcome = 'not_reached', transfer_status = 'dropped' where id = 'eeeeeeee-eeee-4eee-8202-000000000006';
select is((select count(*) from public.inbound_events e where e.lead_id = 'eeeeeeee-eeee-4eee-8202-000000000006'), 0::bigint, 'j15 a cancellation lead writes no event');

select ok((select p.prosecdef from pg_proc p where p.oid = 'public.log_lead_call_events()'::regprocedure), 'j16 the trigger function is security definer');
select is((select p.proconfig from pg_proc p where p.oid = 'public.log_lead_call_events()'::regprocedure), array['search_path=public'], 'j17 with its search_path pinned');
select ok(not has_function_privilege('anon', 'public.log_lead_call_events()', 'execute'), 'j18 anon can''t execute it');
select ok(not has_function_privilege('authenticated', 'public.log_lead_call_events()', 'execute'), 'j19 authenticated can''t execute it');
select is((select count(*) from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.log_lead_call_events()'::regprocedure and a.grantee = 0), 0::bigint, 'j20 public can''t execute it');
select is((select p.proname::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.leads'::regclass and t.tgname = 'leads_log_call_events'),
          'log_lead_call_events', 'j21 the trigger on leads runs it');
select ok(pg_get_triggerdef((select t.oid from pg_trigger t where t.tgrelid = 'public.leads'::regclass and t.tgname = 'leads_log_call_events'))
            like '%AFTER INSERT OR UPDATE OF va_attempts, transfer_status, transferred_at ON public.leads%', 'j22 after insert or update of the three columns');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'log\_lead%'), array['log_lead_call_events'], 'j23 its name stays off the pinned va_ list');

select * from finish();
rollback;
