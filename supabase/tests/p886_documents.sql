-- p886_documents — pgTAP checks for p886_documents.sql: where a carrier takes documents, prefill (no bank numbers),
-- e-sign with several signers (links, view, consent, sign, decline, expiry, new link, the stamped file), uploads (client
-- link, VA, agent), sending (carrier preference, sandbox, claim, failed + reason + retry, delivered + receipt + confirm
-- task, never received, attempt cap, agent-portal upload), the replacement-timing gate (trigger, marks, override, the
-- cancellation send), RLS, grants and the append-only trail.
--
-- RUN: `npm run test:sql -- supabase/tests/p886_documents.sql` (PGlite, in memory). Never against live.
--
-- Cast: admin Z, agents A and B, VA V. Carriers: OLD (Globe Life-ish, fax), NEW (fax then email). Policies: P1 Ann Lee
-- (A, replaces OLD with NEW, V assigned), P2 Tom Fry (A, no replacement), P3 (B).

begin;
create extension if not exists pgtap with schema extensions;
select plan(103);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p886_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('a8860000-0000-4000-8000-000000000001'::uuid, 'admin', 'agent', 'Zed Admin'),
    ('a8860000-0000-4000-8000-00000000000a'::uuid, 'agent_a', 'agent', 'Ada Agent'),
    ('a8860000-0000-4000-8000-00000000000b'::uuid, 'agent_b', 'agent', 'Bo Bee'),
    ('a8860000-0000-4000-8000-0000000000f1'::uuid, 'va', 'fulfillment', 'Val Va')
  ) as u(id, n, role, full_name);
update public.profiles set role = 'admin' where id = 'a8860000-0000-4000-8000-000000000001';
update public.profiles set role = 'agent', is_active = true where id in ('a8860000-0000-4000-8000-00000000000a', 'a8860000-0000-4000-8000-00000000000b');
update public.profiles set role = 'fulfillment', is_active = true where id = 'a8860000-0000-4000-8000-0000000000f1';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into public.carriers (id, name) values
  ('c8860000-0000-4000-8000-000000000001', 'P886 Old Life'),
  ('c8860000-0000-4000-8000-000000000002', 'P886 New Life');

insert into public.policies (id, agent_id, client_first_name, client_last_name, client_phone, carrier_name, policy_number, status, state)
values
  ('b8860000-0000-4000-8000-000000000001', 'a8860000-0000-4000-8000-00000000000a', 'Ann', 'Lee', '(512) 555-0164', 'P886 Old Life', 'NL-1001', 'Submitted', 'TX'),
  ('b8860000-0000-4000-8000-000000000002', 'a8860000-0000-4000-8000-00000000000a', 'Tom', 'Fry', '(512) 555-0100', 'P886 New Life', 'NL-2002', 'In Effect', 'TX'),
  ('b8860000-0000-4000-8000-000000000003', 'a8860000-0000-4000-8000-00000000000b', 'Bea', 'Cole', '(512) 555-0111', 'P886 New Life', 'NL-3003', 'In Effect', 'TX');
update public.policies
   set replaced_old_policy = true, carrier_id = 'c8860000-0000-4000-8000-000000000001',
       new_carrier_id = 'c8860000-0000-4000-8000-000000000002', new_carrier_name = 'P886 New Life',
       fulfillment_assigned = true, fulfillment_stage = 'Pending',
       assigned_fulfillment_id = 'a8860000-0000-4000-8000-0000000000f1'
 where id = 'b8860000-0000-4000-8000-000000000001';
update public.policies set carrier_id = 'c8860000-0000-4000-8000-000000000002', fulfillment_stage = 'Pending'
 where id in ('b8860000-0000-4000-8000-000000000002', 'b8860000-0000-4000-8000-000000000003');
insert into public.policy_fulfillment_details (policy_id, full_legal_name, current_carrier, routing_number, account_number, date_of_birth)
values ('b8860000-0000-4000-8000-000000000001', 'Ann Marie Lee', 'P886 Old Life', '111000025', '987654321', '1951-03-04');

-- ── a. Grants: the signing page's functions are server-only; proof columns hidden ─
select ok(not has_function_privilege('anon', 'public.doc_token_view(text)', 'execute'), 'a1 anon can''t run doc_token_view');
select ok(not has_function_privilege('authenticated', 'public.doc_token_sign(text,text,boolean,text,text)', 'execute'), 'a2 the app can''t sign for someone');
select ok(not has_function_privilege('authenticated', 'public.doc_sends_claim(integer)', 'execute'), 'a3 the app can''t claim sends');
select ok(not has_function_privilege('authenticated', 'public.doc_signed_file(uuid,text,text)', 'execute'), 'a4 the app can''t mark a form signed');
select ok(not has_column_privilege('authenticated', 'public.doc_signers', 'token_hash', 'select'), 'a5 no token hash to the app');
select ok(not has_column_privilege('authenticated', 'public.doc_signers', 'link_token', 'select'), 'a6 no raw link to the app');
select ok(not has_column_privilege('authenticated', 'public.doc_signers', 'sign_ip', 'select'), 'a7 no signer IP to the app');
select ok(has_column_privilege('authenticated', 'public.doc_signers', 'signed_at', 'select'), 'a8 the app sees when they signed');

-- ── b. Where a carrier takes documents ──────────────────────────────────────
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.carrier_docs_update('c8860000-0000-4000-8000-000000000002', '5125550199') $$, '42501', null, 'b1 an agent can''t edit the carrier list');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.carrier_docs_update('c8860000-0000-4000-8000-000000000002', '555-01') $$, '22023', 'That fax number needs 10 digits', 'b2 a short fax number is refused');
select throws_ok($$ select public.carrier_docs_update('c8860000-0000-4000-8000-000000000002', null, null, 'http://x.example') $$, '22023', null, 'b3 upload address must be https');
select lives_ok($$ select public.carrier_docs_update('c8860000-0000-4000-8000-000000000002', '+1 (512) 555-0199', ' Forms@NewLife.Example ', null, array['fax', 'email', 'fax']) $$, 'b4 the VA saves fax, email and order');
select pg_temp.as_owner();
select is((select docs_fax || '|' || docs_email || '|' || array_to_string(docs_channels, ',') from public.carriers where id = 'c8860000-0000-4000-8000-000000000002'),
          '5125550199|forms@newlife.example|fax,email', 'b5 normalised, order kept, no repeats');
select is((select docs_checked_by from public.carriers where id = 'c8860000-0000-4000-8000-000000000002'), 'a8860000-0000-4000-8000-0000000000f1'::uuid, 'b6 who checked it is kept');
update public.carriers set docs_fax = '5125550188', docs_channels = array['fax'] where id = 'c8860000-0000-4000-8000-000000000001';
select is(public.doc_pick_channel('c8860000-0000-4000-8000-000000000002'), 'fax', 'b7 the carrier''s first channel with an address');
update public.carriers set docs_fax = null where id = 'c8860000-0000-4000-8000-000000000002';
select is(public.doc_pick_channel('c8860000-0000-4000-8000-000000000002'), 'email', 'b8 skips a channel with no address');
update public.carriers set docs_fax = '5125550199' where id = 'c8860000-0000-4000-8000-000000000002';

-- ── c. Prefill ──────────────────────────────────────────────────────────────
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select is(public.doc_prefill('b8860000-0000-4000-8000-000000000001')->>'owner_name', 'Ann Marie Lee', 'c1 legal name from intake');
select is(public.doc_prefill('b8860000-0000-4000-8000-000000000001')->>'old_carrier', 'P886 Old Life', 'c2 the old carrier');
select ok(not (public.doc_prefill('b8860000-0000-4000-8000-000000000001') ?| array['account_number', 'routing_number', 'bank_name', 'drivers_license_number']),
          'c3 no bank or licence numbers on a generated form');
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.doc_prefill('b8860000-0000-4000-8000-000000000001') $$, '42501', null, 'c4 agents don''t prepare forms');

-- ── d. Send for signature ───────────────────────────────────────────────────
select pg_temp.as_owner();
insert into public.doc_templates (id, carrier_id, doc_type, name, form_number, storage_path, signer_roles)
values ('d8860000-0000-4000-8000-000000000001', 'c8860000-0000-4000-8000-000000000002', 'beneficiary_change',
        'Change of beneficiary', 'NL-BEN-1', 'templates/d8860000/ben.pdf', array['owner', 'irrevocable_beneficiary']);

select pg_temp.as_user('a8860000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.doc_start_signing('b8860000-0000-4000-8000-000000000002', 'beneficiary_change', 'Ben', '[{"role":"owner","name":"Tom Fry"}]', 'd8860000-0000-4000-8000-000000000001') $$,
                 '42501', null, 'd1 agents don''t send forms');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.doc_start_signing('b8860000-0000-4000-8000-000000000002', 'beneficiary_change', 'Ben', '[{"role":"owner","name":"Tom Fry"}]', 'd8860000-0000-4000-8000-000000000001') $$,
                 '22023', 'This form needs: owner, irrevocable_beneficiary', 'd2 every role the form needs');
select throws_ok($$ select public.doc_start_signing('b8860000-0000-4000-8000-000000000002', 'beneficiary_change', 'Ben', '[{"role":"owner","name":"Tom Fry"},{"role":"owner","name":"Tom F"}]', 'd8860000-0000-4000-8000-000000000001') $$,
                 '22023', 'Each signer role once', 'd3 a role once');
select throws_ok($$ select public.doc_start_signing('b8860000-0000-4000-8000-000000000002', 'other', 'Form', '[{"role":"owner","name":"Tom Fry"}]', null, 'b8860000-0000-4000-8000-000000000001/x.pdf') $$,
                 '22023', 'The form must be stored on this policy', 'd4 an uploaded form must be on this policy');

create temp table t_links as
select public.doc_start_signing('b8860000-0000-4000-8000-000000000002', 'beneficiary_change', 'Change of beneficiary',
         '[{"role":"owner","name":"Tom Fry","phone":"(512) 555-0100"},{"role":"irrevocable_beneficiary","name":"Jo Fry","email":"JO@x.example"}]',
         'd8860000-0000-4000-8000-000000000001') as r;
grant select on t_links to authenticated;
select is(jsonb_array_length((select r->'links' from t_links)), 2, 'd5 one link per signer');
select pg_temp.as_owner();
create temp table t_doc as select (r->>'document_id')::uuid as id, r->'links'->0->>'token' as t1, r->'links'->1->>'token' as t2 from t_links;
grant select on t_doc to authenticated;
select is((select status || '|' || carrier_id::text || '|' || (prefill->>'policy_number') from public.policy_documents where id = (select id from t_doc)),
          'out_for_signature|c8860000-0000-4000-8000-000000000002|NL-2002', 'd6 out for signature, to the policy''s carrier, prefilled');
select is((select count(*)::int from public.doc_signers where document_id = (select id from t_doc) and token_hash = public.doc_hash((select t1 from t_doc))), 1, 'd7 only the hash of the token is the key');
select is((select email from public.doc_signers where document_id = (select id from t_doc) and role = 'irrevocable_beneficiary'), 'jo@x.example', 'd8 email cleaned');
select is((select count(*)::int from public.doc_signers where document_id = (select id from t_doc) and link_token is not null and link_pushed_at is null), 2,
          'd9 both links wait for the engine to text them');

-- ── e. Who sees it ──────────────────────────────────────────────────────────
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000a');
select is((select count(*)::int from public.policy_documents where id = (select id from t_doc)), 1, 'e1 the agent sees their client''s form');
select is((select count(*)::int from public.doc_signers where document_id = (select id from t_doc)), 2, 'e2 and who signs it');
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.policy_documents where id = (select id from t_doc)), 0, 'e3 another agent doesn''t');
select throws_ok($$ select public.policy_documents_for('b8860000-0000-4000-8000-000000000002') $$, '42501', null, 'e4 nor through the read');

-- ── f/g. The signing page ───────────────────────────────────────────────────
select pg_temp.as_owner();
select is(public.doc_token_view('nope')->>'state', 'not_found', 'f1 a made-up link');
select is(public.doc_token_view((select t1 from t_doc))->>'state', 'sign', 'f2 the owner''s link opens the form');
select ok((select viewed_at is not null from public.doc_signers where token_hash = public.doc_hash((select t1 from t_doc))), 'f3 opened is recorded');
select is(public.doc_token_view((select t1 from t_doc))->'prefill'->>'policy_number', 'NL-2002', 'f4 the page shows the prefilled form');
select throws_ok($$ select public.doc_token_sign((select t1 from t_doc), 'Tom Fry', false, '1.2.3.4', 'ua') $$, '22023', 'Tick the box to agree to sign electronically', 'g1 consent is required');
select throws_ok($$ select public.doc_token_sign((select t1 from t_doc), ' ', true, '1.2.3.4', 'ua') $$, '22023', 'Type your full name', 'g2 a typed name is required');
select is(public.doc_token_sign((select t1 from t_doc), 'Tom Fry', true, '1.2.3.4', 'Mozilla')->>'all_signed', 'false', 'g3 one of two signed');
select throws_ok($$ select public.doc_signed_file((select id from t_doc), (select 'b8860000-0000-4000-8000-000000000002/' || id || '/signed.pdf' from t_doc), repeat('a', 64)) $$,
                 '22023', 'Not everyone has signed', 'g4 no signed file until everyone signs');
select throws_ok($$ select public.doc_token_sign((select t1 from t_doc), 'Tom Fry', true, '1.2.3.4', 'ua') $$, '22023', 'You already signed this', 'g5 once each');
select is(public.doc_token_sign((select t2 from t_doc), 'Jo Fry', true, '5.6.7.8', 'Safari')->>'all_signed', 'true', 'g6 the last signer completes it');
select is((select sign_ip || '|' || consent_version from public.doc_signers where token_hash = public.doc_hash((select t2 from t_doc))), '5.6.7.8|esign-v1', 'g7 IP and consent version kept');
select lives_ok($$ select public.doc_signed_file((select id from t_doc), (select 'b8860000-0000-4000-8000-000000000002/' || id || '/signed.pdf' from t_doc), repeat('a', 64)) $$, 'g8 the stamped PDF is stored');
select is((select status from public.policy_documents where id = (select id from t_doc)), 'signed', 'g9 signed');
select is((select count(*)::int from public.notifications where profile_id = 'a8860000-0000-4000-8000-0000000000f1' and type = 'document_signed'), 1, 'g10 the VA is told');

-- ── h. Decline, expiry, a new link ──────────────────────────────────────────
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
create temp table t_d2 as select public.doc_start_signing('b8860000-0000-4000-8000-000000000002', 'amendment', 'Amendment', '[{"role":"owner","name":"Tom Fry"}]', null,
                                                           'b8860000-0000-4000-8000-000000000002/form.pdf') as r;
create temp table t_d3 as select public.doc_start_signing('b8860000-0000-4000-8000-000000000002', 'address_change', 'Address change', '[{"role":"owner","name":"Tom Fry"}]', null,
                                                           'b8860000-0000-4000-8000-000000000002/addr.pdf') as r;
select pg_temp.as_owner();
select lives_ok($$ select public.doc_token_decline((select r->'links'->0->>'token' from t_d2), 'Wrong address on it') $$, 'h1 a signer can decline');
select is((select status from public.policy_documents where id = (select (r->>'document_id')::uuid from t_d2)), 'declined', 'h2 declined');
select is((select count(*)::int from public.notifications where profile_id = 'a8860000-0000-4000-8000-0000000000f1' and type = 'document_declined'), 1, 'h3 the VA is told why');
update public.doc_signers set link_expires_at = now() - interval '1 minute' where document_id = (select (r->>'document_id')::uuid from t_d3);
select is(public.doc_token_view((select r->'links'->0->>'token' from t_d3))->>'state', 'expired', 'h4 an old link says it ran out');
select is((select status from public.policy_documents where id = (select (r->>'document_id')::uuid from t_d3)), 'expired', 'h5 the form shows expired');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
create temp table t_new as select public.doc_new_link((select id from public.doc_signers where document_id = (select (r->>'document_id')::uuid from t_d3))) as r;
select pg_temp.as_owner();
select is(public.doc_token_view((select r->'links'->0->>'token' from t_d3))->>'state', 'not_found', 'h6 the old link stops working');
select is(public.doc_token_view((select r->>'token' from t_new))->>'state', 'sign', 'h7 the new one opens');

-- ── i. Uploads ──────────────────────────────────────────────────────────────
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
create temp table t_up as select public.doc_request_upload('b8860000-0000-4000-8000-000000000001', 'poa', 'Power of attorney', 'Sam Lee') as r;
select pg_temp.as_owner();
select is(public.doc_token_view((select r->>'token' from t_up))->>'mode', 'upload', 'i1 the link asks for a file');
select lives_ok($$ select public.doc_token_upload((select r->>'token' from t_up), 'b8860000-0000-4000-8000-000000000001/poa.jpg', repeat('b', 64), '9.9.9.9', 'ua') $$, 'i2 the client sends it');
select is((select status || '|' || doc_type from public.policy_documents where id = (select (r->>'document_id')::uuid from t_up)), 'on_file|poa', 'i3 on the policy with its type');
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000a');
create temp table t_letter as select public.doc_register_upload('b8860000-0000-4000-8000-000000000001', 'carrier_letter', 'Lapse notice',
            'b8860000-0000-4000-8000-000000000001/letter.pdf', null, current_date - 2) as id;
select is((select source from public.policy_documents where id = (select id from t_letter)), 'agent_upload', 'i4 an agent files a letter on their client');
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000b');
select throws_ok($$ select public.doc_register_upload('b8860000-0000-4000-8000-000000000001', 'other', 'x', 'b8860000-0000-4000-8000-000000000001/x.pdf') $$, '42501', null, 'i5 not on someone else''s client');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.doc_register_upload('b8860000-0000-4000-8000-000000000001', 'other', 'x', 'b8860000-0000-4000-8000-000000000002/x.pdf') $$, '22023', 'The file must be stored on this policy', 'i6 the file must sit under its policy');

-- ── j. Sending ──────────────────────────────────────────────────────────────
select throws_ok($$ select public.doc_send_request((select (r->>'document_id')::uuid from t_d2)) $$, '22023', null, 'j1 a declined form can''t be sent');
create temp table t_s1 as select public.doc_send_request((select id from t_doc)) as r;
select is((select r->>'channel' || '|' || (r->>'destination') || '|' || (r->>'sandbox') from t_s1), 'fax|5125550199|true', 'j2 the carrier''s fax, sandbox');
select throws_ok($$ select public.doc_send_request((select id from t_doc)) $$, '22023', 'This one is already on its way', 'j3 no double send');
select pg_temp.as_owner();
select is((select count(*)::int from public.doc_sends_claim(10)), 1, 'j4 doc-send picks it up');
select is((select status from public.doc_sends where id = (select (r->>'send_id')::uuid from t_s1)), 'sending', 'j5 sending');
select throws_ok($$ select public.doc_send_result((select (r->>'send_id')::uuid from t_s1), 'failed', '') $$, '22023', 'Say why it failed', 'j6 a failure has a reason');
select lives_ok($$ select public.doc_send_result((select (r->>'send_id')::uuid from t_s1), 'failed', 'Busy signal after 3 tries') $$, 'j7 the fax failed');
select is((select count(*)::int from public.notifications where profile_id = 'a8860000-0000-4000-8000-0000000000f1' and type = 'document_send_failed'), 1, 'j8 the VA is told');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
create temp table t_s2 as select public.doc_send_request((select id from t_doc), 'email', null, (select (r->>'send_id')::uuid from t_s1)) as r;
select is((select r->>'channel' || '|' || (r->>'attempt') from t_s2), 'email|2', 'j9 retried by email, attempt 2');
select pg_temp.as_owner();
select is((select count(*)::int from public.doc_sends_claim(10)), 1, 'j10 claimed');
select lives_ok($$ select public.doc_send_result((select (r->>'send_id')::uuid from t_s2), 'delivered', null, '{"pages": 2}', 'sbx-1', 2) $$, 'j11 delivered');
select is((select kind || '|' || status || '|' || (doc_send_id = (select (r->>'send_id')::uuid from t_s2))::text from public.servicing_tasks
            where id = (select confirm_task_id from public.doc_sends where id = (select (r->>'send_id')::uuid from t_s2))),
          'carrier_call|requested|true', 'j12 a confirm-received task');
select ok((select due_at > now() + interval '1 day' from public.servicing_tasks where doc_send_id = (select (r->>'send_id')::uuid from t_s2)), 'j13 due in business days');
select is((select receipt->>'to' from public.doc_sends where id = (select (r->>'send_id')::uuid from t_s2)), 'forms@newlife.example', 'j14 the receipt says where it went');
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000a');
select throws_ok($$ select public.doc_send_result((select (r->>'send_id')::uuid from t_s2), 'delivered') $$, '42501', null, 'j15 an agent can''t mark an email');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select lives_ok($$ select public.doc_send_confirm((select (r->>'send_id')::uuid from t_s2), false, 'Carrier: nothing on file') $$, 'j16 never received');
select pg_temp.as_owner();
select is((select status || '|' || outcome from public.servicing_tasks where doc_send_id = (select (r->>'send_id')::uuid from t_s2)), 'done|could_not_complete', 'j17 the confirm task closes as not done');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
create temp table t_s3 as select public.doc_send_request((select id from t_doc), 'fax', '512-555-0177', (select (r->>'send_id')::uuid from t_s2)) as r;
select is((select r->>'destination' || '|' || (r->>'attempt') from t_s3), '5125550177|3', 'j18 resent to the number the carrier gave');
select pg_temp.as_owner();
select lives_ok($$ select public.doc_sends_claim(10) $$, 'j19 claimed');
select lives_ok($$ select public.doc_send_result((select (r->>'send_id')::uuid from t_s3), 'failed', 'No fax tone') $$, 'j20 failed again');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.doc_send_request((select id from t_doc), 'email', null, (select (r->>'send_id')::uuid from t_s3)) $$, '22023', null, 'j21 capped at max_attempts');

-- agent portal (E-87): the agent uploads in their producer portal and confirms.
select pg_temp.as_owner();
update public.carriers set docs_channels = array['agent_portal'] where id = 'c8860000-0000-4000-8000-000000000002';
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
create temp table t_s4 as select public.doc_send_request((select (r->>'document_id')::uuid from t_up)) as r;
select is((select r->>'channel' || '|' || (r->>'status') from t_s4), 'agent_portal|sending', 'j22 goes to the agent''s portal');
select pg_temp.as_owner();
select is((select count(*)::int from public.notifications where profile_id = 'a8860000-0000-4000-8000-00000000000a' and type = 'carrier_upload_needed'), 1, 'j23 the agent is asked');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.doc_send_result((select (r->>'send_id')::uuid from t_s4), 'delivered') $$, '42501', null, 'j24 the VA can''t say the agent uploaded it');
select pg_temp.as_user('a8860000-0000-4000-8000-00000000000a');
select lives_ok($$ select public.doc_send_result((select (r->>'send_id')::uuid from t_s4), 'delivered', null, '{"by": "agent"}') $$, 'j25 the agent confirms it');

-- ── k. Replacement gate ─────────────────────────────────────────────────────
select pg_temp.as_owner();
select is(public.replacement_gate_state('b8860000-0000-4000-8000-000000000001')->>'open', 'false', 'k1 closed until issued + first payment');
select throws_ok($$ update public.policies set fulfillment_stage = 'Complete' where id = 'b8860000-0000-4000-8000-000000000001' $$, '22023', null, 'k2 the cancel can''t be marked done');
select throws_ok($$ update public.policies set call_live_since = now() where id = 'b8860000-0000-4000-8000-000000000001' $$, '22023', null, 'k3 the cancel call can''t start');
select lives_ok($$ update public.policies set fulfillment_stage = 'Complete' where id = 'b8860000-0000-4000-8000-000000000002' $$, 'k4 no replacement, no gate');
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
create temp table t_cx as select public.doc_register_upload('b8860000-0000-4000-8000-000000000001', 'cancellation_request', 'Cancel request',
                                                            'b8860000-0000-4000-8000-000000000001/cx.pdf') as id;
select throws_ok($$ select public.doc_send_request((select id from t_cx)) $$, '22023', null, 'k5 the cancellation can''t go to the old carrier yet');
select throws_ok($$ select public.replacement_mark('b8860000-0000-4000-8000-000000000001', 'issued', current_date + 1) $$, '22023', 'Pick a date that has already happened', 'k6 no future dates');
select lives_ok($$ select public.replacement_mark('b8860000-0000-4000-8000-000000000001', 'issued', current_date - 10, 'Carrier portal') $$, 'k7 issued');
select throws_ok($$ select public.replacement_mark('b8860000-0000-4000-8000-000000000001', 'first_payment', current_date - 20) $$, '22023', null, 'k8 payment can''t clear before issue');
select is(public.replacement_mark('b8860000-0000-4000-8000-000000000001', 'first_payment', current_date - 2, 'Bank draft cleared')->>'open', 'true', 'k9 open');
select is((select count(*)::int from public.notifications where profile_id = 'a8860000-0000-4000-8000-0000000000f1' and type = 'replacement_ready'), 1, 'k10 the VA is told to cancel now');
select is((select r->>'channel' from (select public.doc_send_request((select id from t_cx)) as r) x), 'fax', 'k11 now the cancellation goes to the old carrier''s fax');
select pg_temp.as_owner();
select lives_ok($$ update public.policies set fulfillment_stage = 'Complete' where id = 'b8860000-0000-4000-8000-000000000001' $$, 'k12 and can be marked done');
-- Override (admin only, with a reason) on P3 made into a replacement.
update public.policies set replaced_old_policy = true where id = 'b8860000-0000-4000-8000-000000000003';
select pg_temp.as_user('a8860000-0000-4000-8000-0000000000f1');
select throws_ok($$ select public.replacement_override('b8860000-0000-4000-8000-000000000003', 'Client insists, signed a waiver') $$, '42501', null, 'k13 VAs can''t override');
select pg_temp.as_user('a8860000-0000-4000-8000-000000000001');
select throws_ok($$ select public.replacement_override('b8860000-0000-4000-8000-000000000003', 'ok') $$, '22023', 'Say why in a sentence', 'k14 a real reason');
select is(public.replacement_override('b8860000-0000-4000-8000-000000000003', 'Client insists, signed a waiver')->>'open', 'true', 'k15 admin override opens it');

-- ── l. Trail and dates ──────────────────────────────────────────────────────
select pg_temp.as_owner();
select ok((select count(*) from public.doc_audit where policy_id = 'b8860000-0000-4000-8000-000000000003' and kind = 'replacement_override') = 1, 'l1 the override is in the trail');
select throws_ok($$ update public.doc_audit set kind = 'x' $$, '42501', null, 'l2 the trail can''t be changed');
select is(public.doc_business_deadline('2026-11-06 15:00-06'::timestamptz, 3), '2026-11-11 17:00-06'::timestamptz, 'l3 3 business days from a Friday = Wednesday 5 PM Central');

select * from finish();
rollback;
