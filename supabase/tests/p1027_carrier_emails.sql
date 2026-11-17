-- p1027_carrier_emails — pgTAP checks for 284_p1027_carrier_emails.sql: name-style addresses, the agent's carrier list,
-- Gmail's confirmation code, the Test check, the finer reading (payment notices → save call + "Client's payment
-- failed", log-in notices → a carrier_call step, not-a-notice set aside quietly, unclear → admin Needs a look),
-- carrier narrowing, and the 60-day clean-up.
--
-- RUN: `npm run test:sql` (local PGlite). One transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p1027_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.fname), now(), now()
  from (values
    ('a1027000-0000-4000-8000-00000000000a'::uuid, 'agent', 'agent',       'Dana Walker'),
    ('a1027000-0000-4000-8000-00000000000b'::uuid, 'agent2', 'agent',      'Bo Bee'),
    ('a1027000-0000-4000-8000-00000000000f'::uuid, 'va',    'fulfillment', 'Vic Ames'),
    ('a1027000-0000-4000-8000-0000000000ad'::uuid, 'admin', 'admin',       'Ada Admin')
  ) as u(id, n, role, fname);
update public.profiles set is_active = true, timezone = 'UTC',
       full_name = case id when 'a1027000-0000-4000-8000-00000000000a' then 'Dana Walker' when 'a1027000-0000-4000-8000-00000000000b' then 'Bo Bee'
                           when 'a1027000-0000-4000-8000-00000000000f' then 'Vic Ames' else 'Ada Admin' end
 where id::text like 'a1027000-%';
update public.profiles set is_active = false where role::text in ('admin', 'fulfillment') and id::text not like 'a1027000-%';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into public.carriers (name, portal_url, is_active)
select 'Ethos Test Co', 'https://agents.ethostest.example/login', true
 where not exists (select 1 from public.carriers where name = 'Ethos Test Co');

insert into public.policies (id, agent_id, client_first_name, client_last_name, carrier_name, policy_number, status, effective_date, state)
values
  ('b1027000-0000-4000-8000-000000000001', 'a1027000-0000-4000-8000-00000000000a', 'Maria', 'Lopez',  'Ethos Test Co', 'ETH-4471-22', 'In Effect', (current_date - interval '3 months')::date, 'TX'),
  ('b1027000-0000-4000-8000-000000000002', 'a1027000-0000-4000-8000-00000000000a', 'Sam',   'Reyes',  'Ethos Test Co', 'ETH-5000-01', 'In Effect', (current_date - interval '2 years')::date, 'TX'),
  ('b1027000-0000-4000-8000-000000000003', 'a1027000-0000-4000-8000-00000000000a', 'Ann',   'Reyes',  'Americo',       'AM-77-1',     'In Effect', (current_date - interval '2 years')::date, 'TX'),
  ('b1027000-0000-4000-8000-000000000004', 'a1027000-0000-4000-8000-00000000000a', 'Joe',   'Park',   'Lone Carrier',  'LC-1000-9',   'In Effect', (current_date - interval '1 year')::date, 'TX');
update public.policies set servicing_va_id = 'a1027000-0000-4000-8000-00000000000f' where id::text like 'b1027000-%';

-- ── Addresses ──
select pg_temp.as_user('a1027000-0000-4000-8000-00000000000a');
create temp table t_me as select public.my_carrier_emails() as j;
grant all on t_me to authenticated;
select matches((select j->>'address' from t_me), '^dana-[a-z0-9]{4}@notices\.ohvara\.com$', 'agent gets dana-xxxx@notices.ohvara.com');
select is(public.my_carrier_emails()->>'address', (select j->>'address' from t_me), 'the same address every time');
select ok((select j->'suggested' @> '[{"name": "Ethos Test Co", "domain": "ethostest.example"}]' from t_me), 'their book''s carriers are suggested with the portal''s email domain');
select is(public.my_payment_intake_address(), (select j->>'address' from t_me), 'the old P885 reader gives the same address');

select is(jsonb_array_length(public.set_my_notice_carriers('[{"name": "Ethos Test Co", "domain": "Notices@EthosTest.example"}, {"name": "Americo"}, {"name": "ethos test co", "domain": "x.example"}]')), 2,
          'carrier list saved, duplicates dropped');
select is(public.my_carrier_emails()->'carriers'->0->>'domain', 'ethostest.example', 'an address typed as the domain is cut to the domain, lower case');
select throws_ok($$ select public.set_my_notice_carriers('[{"name": "X", "domain": "not a domain"}]') $$, '22023', null, 'a bad domain is refused');
select throws_ok($$ select public.set_my_notice_carriers('[{"name": ""}]') $$, '22023', null, 'a carrier needs a name');

select pg_temp.as_user('a1027000-0000-4000-8000-00000000000f');
select throws_ok($$ select public.my_carrier_emails() $$, '42501', null, 'a VA has no forwarding address');
select pg_temp.as_user('a1027000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.payment_intake_addresses), 0, 'agent B can''t see Dana''s address row');
select throws_ok($$ select public.payment_intake_receive('x', 'm', 'f', 's', 'b', '{}') $$, '42501', null, 'agents can''t call the reader');

select pg_temp.as_owner();
create temp table t_tok as select local_part as lp, token as tk from public.payment_intake_addresses where agent_id = 'a1027000-0000-4000-8000-00000000000a';

-- ── Test + Gmail code ──
select pg_temp.as_user('a1027000-0000-4000-8000-00000000000a');
select ok(public.start_my_carrier_email_test() is not null, 'Test started');
select is((public.my_carrier_emails()->>'test_ok')::boolean, false, 'not passed before an email arrives');
select pg_temp.as_owner();
select is(public.payment_intake_gmail_code((select lp from t_tok), '812345678', 'https://mail-settings.google.com/mail/vf-abc', 'dana@gmail.com')->>'status', 'gmail_code', 'Gmail code kept');
select is(public.payment_intake_gmail_code((select lp from t_tok), '1', 'https://evil.example/x', null)->>'status', 'gmail_code', 'a bad code/link is stored as empty, not refused');
select is((select gmail_code is null and gmail_link is null from public.payment_intake_addresses where local_part = (select lp from t_tok)), true, '...and nothing bad is kept');
select public.payment_intake_gmail_code((select lp from t_tok), '812345678', 'https://mail-settings.google.com/mail/vf-abc', 'dana@gmail.com');
select pg_temp.as_user('a1027000-0000-4000-8000-00000000000a');
select is(public.my_carrier_emails()->'gmail'->>'code', '812345678', 'the agent sees the Gmail code');
select is((public.my_carrier_emails()->>'test_ok')::boolean, true, 'the Gmail email counts as the test arriving');

-- ── Reading ──
select pg_temp.as_owner();
select is(public.payment_intake_receive((select lp from t_tok), 't-1', 'dana@gmail.com', 'test', 'testing', '{"category": "ignore", "kind": "other"}')->>'status',
          'not_a_notice', 'a test / newsletter is set aside');
select is((select count(*)::int from public.notifications where profile_id = 'a1027000-0000-4000-8000-0000000000ad'), 0, '...without bothering the admin');
select is((select body_excerpt from public.payment_intake_emails where message_id = 't-1'), null, '...and its text isn''t kept');

select is(public.payment_intake_receive((select lp from t_tok), 'e-1', 'Ethos <notifications@ethostest.example>', 'Premium payment unsuccessful', 'Policy Owner: Maria Lopez ...',
          jsonb_build_object('category', 'pending_lapse', 'kind', 'missed', 'policy_number', 'ETH-4471-22', 'due_date', current_date - 3, 'sender_domain', 'ethostest.example'))->>'status',
          'matched', 'an Ethos pending-lapse notice matches by policy number (name-style address)');
select results_eq($$ select t.kind, t.status, e.source from public.payment_missed_events e join public.servicing_tasks t on t.id = e.lapse_task_id
                      where e.policy_id = 'b1027000-0000-4000-8000-000000000001' $$,
                  $$ values ('lapse_save'::text, 'requested'::text, 'email'::text) $$, 'a lapse-save step (the save call) is open');
select is((select count(*)::int from public.notifications where profile_id = 'a1027000-0000-4000-8000-00000000000a' and type = 'client_payment_failed' and detail = 'Our team is on it.'), 1,
          'the agent gets "Client''s payment failed" with "Our team is on it."');
select is((select count(*)::int from public.notifications where profile_id = 'a1027000-0000-4000-8000-00000000000f' and type = 'va_save_call'), 1, 'the VA gets the save call');
select is((select parsed->>'carrier' from public.payment_intake_emails where message_id = 'e-1'), 'Ethos Test Co', 'carrier known from the sender domain');
select is(public.payment_intake_receive((select tk from t_tok), 'e-1b', 'Ethos', 'Grace period', '',
          jsonb_build_object('category', 'grace', 'policy_number', 'ETH-4471-22', 'due_date', current_date - 3))->>'status',
          'matched', 'the old token still works; the same miss again...');
select is((select count(*)::int from public.payment_missed_events where policy_id = 'b1027000-0000-4000-8000-000000000001'), 1, '...joins the open miss (one save call)');

select is(public.payment_intake_receive((select lp from t_tok), 'e-2', 'x@ethostest.example', 'Returned payment', '',
          '{"category": "returned", "client_name": "Reyes", "sender_domain": "ethostest.example"}')->>'status',
          'matched', 'two Reyes clients: the carrier picks the Ethos one');
select is((select policy_id::text from public.payment_intake_emails where message_id = 'e-2'), 'b1027000-0000-4000-8000-000000000002', '...Sam Reyes');
select is(public.payment_intake_receive((select lp from t_tok), 'e-3', 'x@other.example', 'Returned payment', '',
          '{"category": "returned", "client_name": "Reyes"}')->>'why', 'several_policies', 'no carrier: two Reyes → Needs a look');

select is(public.payment_intake_receive((select lp from t_tok), 'l-1', 'svc@lonecarrier.example', 'You have a new message', 'Log in to view it',
          '{"category": "login", "carrier_hint": "Lone Carrier"}')->>'status', 'matched', 'a log-in notice from a carrier with one client of Dana''s matches it');
select results_eq($$ select kind, status, requested_by from public.servicing_tasks where policy_id = 'b1027000-0000-4000-8000-000000000004' $$,
                  $$ values ('carrier_call'::text, 'requested'::text, 'system'::text) $$, '...and opens a "look at the notice" step, not a save call');
select is((select count(*)::int from public.payment_missed_events where policy_id = 'b1027000-0000-4000-8000-000000000004'), 0, '...no payment-failed alarm for it');
select is(public.payment_intake_receive((select lp from t_tok), 'l-2', 'svc@ethostest.example', 'New document', 'Log in to view',
          '{"category": "login", "sender_domain": "ethostest.example"}')->>'why', 'several_policies', 'a log-in notice from a carrier with two clients → Needs a look');

select is(public.payment_intake_receive((select lp from t_tok), 'o-1', 'x@ethostest.example', 'Policy update', 'something', '{"category": "other"}')->>'why',
          'unclear', 'an unclear notice → Needs a look');
select pg_temp.as_user('a1027000-0000-4000-8000-0000000000ad');
select is((select count(*)::int from jsonb_array_elements(public.admin_payment_emails_to_match()) x where x->>'agent_id' = 'a1027000-0000-4000-8000-00000000000a'), 3,
          'the admin Needs a look list has the 3 unclear ones');
select ok((select bool_and(jsonb_array_length(x->'policies') = 4) from jsonb_array_elements(public.admin_payment_emails_to_match()) x where x->>'agent_id' = 'a1027000-0000-4000-8000-00000000000a'),
          '...each with the agent''s policies to pick from');

select pg_temp.as_user('a1027000-0000-4000-8000-00000000000a');
select ok((select bool_and(r->>'status' <> 'not_a_notice') and count(*) >= 5 from jsonb_array_elements(public.my_carrier_emails()->'recent') r), 'the agent''s recent list skips set-aside email');

-- ── Retention ──
select pg_temp.as_owner();
update public.payment_intake_emails set received_at = now() - interval '61 days' where message_id in ('e-1', 't-1');
update public.payment_intake_addresses set gmail_code_at = now() - interval '8 days' where local_part = (select lp from t_tok);
select is((public.payment_intake_purge()->>'deleted')::int, 1, 'clean-up: set-aside email older than 60 days is deleted');
select is((select body_excerpt is null and not parsed ? 'client_name' from public.payment_intake_emails where message_id = 'e-1'), true, '...and old notice text is cleared');
select is((select gmail_code from public.payment_intake_addresses where local_part = (select lp from t_tok)), null, '...and the Gmail code after 7 days');

select * from finish();
rollback;
