-- p_ghl_integration — pgTAP checks for 230_ghl_integration.sql (Prompt 850):
-- settings are admin-only and default OFF, the outbox stays empty while the
-- switch is off, fills from leads / no-shows / opt-outs once it is on, an
-- opt-out that came from GHL is not sent back, claim/finish retry and stop,
-- and a text GHL sent lands on the timeline once.
--
-- Lives next to ghl-push (P850's Touches) rather than supabase/tests/.
-- RUN: node scripts/run-sql-tests.mjs supabase/functions/ghl-push/sql
-- Local PGlite only; one transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       'p_ghl_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', 'Test ' || u.n), now(), now()
  from (values
    ('f2300000-0000-4000-8000-00000000000a'::uuid, 'admin', 'agent'),
    ('f2300000-0000-4000-8000-00000000000b'::uuid, 'agent', 'agent'),
    ('f2300000-0000-4000-8000-00000000000f'::uuid, 'va',    'fulfillment')
  ) as u(id, n, role);
update public.profiles set role = 'admin', is_active = true where id = 'f2300000-0000-4000-8000-00000000000a';
update public.profiles set is_active = true where id in ('f2300000-0000-4000-8000-00000000000b', 'f2300000-0000-4000-8000-00000000000f');

-- ── a. defaults and grants ──────────────────────────────────────────────────
select is((select count(*)::int from public.ghl_settings), 1, 'a1 one settings row');
select is((select enabled from public.ghl_settings), false, 'a2 the switch defaults OFF');
select ok(not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'ghl_settings'
                         and column_name ~* '(key|token|secret)'), 'a3 no column holds a key, token or secret');
select ok(not has_table_privilege('anon', 'public.ghl_settings', 'select'), 'a4 anon cannot read settings');
select ok(not has_table_privilege('authenticated', 'public.ghl_outbox', 'select'), 'a5 the browser cannot read the outbox');
select ok(not has_table_privilege('authenticated', 'public.ghl_contacts', 'select'), 'a6 the browser cannot read GHL contact IDs');
select ok(not has_function_privilege('authenticated', 'public.ghl_claim_outbox(int)', 'execute'), 'a7 claim is service-role only');
select ok(has_function_privilege('service_role', 'public.ghl_claim_outbox(int)', 'execute'), 'a8 the service role can claim');
select ok(not has_function_privilege('authenticated', 'public.ghl_log_text(uuid, uuid, text, text, text, timestamptz, boolean)', 'execute'), 'a9 ghl_log_text is service-role only');
select ok(not has_function_privilege('anon', 'public.ghl_lead_for_contact(text, text)', 'execute'), 'a10 ghl_lead_for_contact is closed to anon');
select ok(not has_column_privilege('authenticated', 'public.ghl_settings', 'last_sync_status', 'update'), 'a11 admins cannot fake the sync status');

-- ── b. RLS: admin sees and edits, agent and VA see nothing ──────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2300000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.ghl_settings), 0, 'b1 an agent sees no settings');
update public.ghl_settings set enabled = true where id;
select set_config('request.jwt.claims', '{"sub":"f2300000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
select is((select count(*)::int from public.ghl_settings), 0, 'b2 a VA sees no settings');
update public.ghl_settings set enabled = true where id;
select set_config('request.jwt.claims', '{"sub":"f2300000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is((select enabled from public.ghl_settings), false, 'b3 the agent and VA updates changed nothing');
select throws_ok($$update public.ghl_settings set location_id = 'bad id!' where id$$, '23514', null, 'b4 a malformed location ID is refused');
update public.ghl_settings set location_id = 'l1C08ntBrFjLS0elLIYU', workflow_new_inbound = 'wf-new-000001' where id;
reset role;
select is((select location_id from public.ghl_settings), 'l1C08ntBrFjLS0elLIYU', 'b5 an admin can set the location');
select is((select updated_by from public.ghl_settings), 'f2300000-0000-4000-8000-00000000000a'::uuid, 'b6 the change is stamped with who made it');

-- ── c. switch OFF: nothing is queued ────────────────────────────────────────
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at, inbound_stage)
values ('f2300000-0000-4000-8000-0000000000d1', 'Dana One', 'Dana One', '+15125559301', 'TX', 'policy_help', 'google', now(), 'new');
update public.leads set inbound_stage = 'booked' where id = 'f2300000-0000-4000-8000-0000000000d1';
select public.sms_set_opt('+15125559301', true, 'STOP');
select is((select count(*)::int from public.ghl_outbox), 0, 'c1 switch off: leads, stage changes and opt-outs queue nothing');
select public.sms_set_opt('+15125559301', false, 'START');

-- ── d. switch ON: the outbox fills ──────────────────────────────────────────
update public.ghl_settings set enabled = true where id;
insert into public.leads (id, business_name, contact_name, phone, email, state, lead_type, lead_source, created_at, inbound_stage)
values ('f2300000-0000-4000-8000-0000000000d2', 'Dana Two', 'Dana Two', '(512) 555-9302', 'dana2@example.invalid', 'TX', 'policy_help', 'google', now(), 'new');
select is((select event from public.ghl_outbox where lead_id = 'f2300000-0000-4000-8000-0000000000d2'), 'new_inbound', 'd1 a new inbound queues new_inbound');
update public.leads set inbound_stage = 'contacting' where id = 'f2300000-0000-4000-8000-0000000000d2';
update public.leads set inbound_stage = 'booked' where id = 'f2300000-0000-4000-8000-0000000000d2';
update public.leads set business_name = 'Dana 2' where id = 'f2300000-0000-4000-8000-0000000000d2';
select is(array(select event || ':' || stage from public.ghl_outbox where lead_id = 'f2300000-0000-4000-8000-0000000000d2' order by id),
          array['new_inbound:new', 'stage:contacting', 'appointment_reminder:booked'], 'd2 stage changes queue once each; other edits queue nothing');
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at)
values ('f2300000-0000-4000-8000-0000000000d3', 'Not Inbound', 'Not Inbound', '+15125559303', 'TX', 'cancellation', 'google', now());
select is((select count(*)::int from public.ghl_outbox where lead_id = 'f2300000-0000-4000-8000-0000000000d3'), 0, 'd3 a cancellation lead (no inbound stage) is not sent');
insert into public.leads (id, business_name, contact_name, phone, state, lead_type, lead_source, created_at, inbound_stage, is_sample)
values ('f2300000-0000-4000-8000-0000000000d4', 'Sample', 'Sample', '+15125559304', 'TX', 'policy_help', 'google', now(), 'new', true);
select is((select count(*)::int from public.ghl_outbox where lead_id = 'f2300000-0000-4000-8000-0000000000d4'), 0, 'd4 sample leads are never sent');
select public.sms_set_opt('+15125559302', true, 'STOP');
select is((select lead_id from public.ghl_outbox where event = 'opt_out'), 'f2300000-0000-4000-8000-0000000000d2'::uuid, 'd5 an Ohvara opt-out is queued for the matching lead');
select public.sms_set_opt('+15125559301', true, 'GHL');
select is((select count(*)::int from public.ghl_outbox where event = 'opt_out'), 1, 'd6 an opt-out that came from GHL is not sent back');

-- ── e. claim / finish ───────────────────────────────────────────────────────
create temp table p_ghl_claim as select * from public.ghl_claim_outbox(2);
select is((select count(*)::int from p_ghl_claim), 2, 'e1 claim honours the limit');
select is((select phone from p_ghl_claim order by id limit 1), '+15125559302', 'e2 the phone is sent in E.164');
select is((select count(*)::int from public.ghl_claim_outbox(10) where id in (select id from p_ghl_claim)), 0, 'e3 claimed rows are leased, not handed out twice');
select public.ghl_finish_outbox((select min(id) from p_ghl_claim), true, 'cI08i1Bls3iTB9bKgFJh');
select is((select contact_id from public.ghl_contacts where lead_id = 'f2300000-0000-4000-8000-0000000000d2'), 'cI08i1Bls3iTB9bKgFJh', 'e4 success remembers the GHL contact');
select ok((select done_at is not null and not failed from public.ghl_outbox where id = (select min(id) from p_ghl_claim)), 'e5 success marks the row done');
select public.ghl_finish_outbox((select max(id) from p_ghl_claim), false, null, 'HTTP 500');
select ok((select done_at is null and next_try_at > now() and last_error = 'HTTP 500' from public.ghl_outbox where id = (select max(id) from p_ghl_claim)), 'e6 a failure retries later');
select public.ghl_finish_outbox((select max(id) from p_ghl_claim), false, null, 'phone invalid', true);
select ok((select failed and done_at is not null from public.ghl_outbox where id = (select max(id) from p_ghl_claim)), 'e7 a final failure stops');

-- ── f. webhook helpers ──────────────────────────────────────────────────────
select is((select lead_id from public.ghl_lead_for_contact('cI08i1Bls3iTB9bKgFJh', null)), 'f2300000-0000-4000-8000-0000000000d2'::uuid, 'f1 a known GHL contact finds its lead');
select is((select lead_id from public.ghl_lead_for_contact('unknownContact', '+15125559302')), 'f2300000-0000-4000-8000-0000000000d2'::uuid, 'f2 an unknown contact falls back to the phone');
select is(public.ghl_log_text('f2300000-0000-4000-8000-0000000000d2', null, 'msgOut01', 'See you at 3', 'sent', now()), 'inserted', 'f3 a sent text is logged');
select is(public.ghl_log_text('f2300000-0000-4000-8000-0000000000d2', null, 'msgOut01', 'See you at 3', 'delivered', now()), 'updated', 'f4 the same message only updates');
select is((select count(*)::int || ':' || max(detail->>'status') from public.inbound_events
            where lead_id = 'f2300000-0000-4000-8000-0000000000d2' and kind = 'text_sent'), '1:delivered', 'f5 one timeline row, latest status');

select * from finish();
rollback;
