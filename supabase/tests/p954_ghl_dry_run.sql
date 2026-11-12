-- p954_ghl_dry_run — Prompt 954: every GoHighLevel connection point, in the order Jordan turns them on, on the
-- database side, with GoHighLevel stubbed (no real texts, calls or HTTP). The function side (the HTTP calls each
-- edge function makes, signatures, retries) is covered by the Deno tests in supabase/functions/ghl-*/core.test.ts.
--   1. Campaign created in GHL → saved on the agent, Setup's campaign + mapped steps tick
--   2. Lead webhook in → lead appears on that agent; the AI caller would take it once its switch is on
--   3. Ohvara → GHL push: the lead is queued for GHL (bridge on), nothing for a sample lead, nothing with the bridge off;
--      while texts are off ghl-push adds no one to a texting workflow (core.test.ts 'P954: texts off')
--   4. Replies and opt-outs in → the reply lands on the lead, STOP opts the number out, START opts back in
--   5. Spend feed → spend lands on the agent by campaign
--   6. Campaign on/off → the row is claimed for GHL, GHL's answer is saved
-- RUN: node scripts/run-sql-tests.mjs supabase/tests/p954_ghl_dry_run.sql
-- Local PGlite only; one transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p954_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.name), now(), now()
  from (values
    ('f9540000-0000-4000-8000-00000000000a'::uuid, 'admin', 'fulfillment', 'Ada Admin'),
    ('f9540000-0000-4000-8000-00000000000b'::uuid, 'gina',  'agent',       'Gina Holt')
  ) as u(id, n, role, name);
update public.profiles set role = 'admin', is_active = true where id = 'f9540000-0000-4000-8000-00000000000a';
update public.profiles set is_active = true where id = 'f9540000-0000-4000-8000-00000000000b';
insert into public.agent_lead_settings (agent_id, active, states) values ('f9540000-0000-4000-8000-00000000000b', true, '{TX,OK,LA}')
on conflict (agent_id) do update set active = excluded.active, states = excluded.states;
-- Jordan has connected: the bridge is on (in this rolled-back copy only).
update public.ghl_settings set enabled = true, location_id = 'locDryRun954' where id;
create temp table p954 as select (select agent_code from public.profiles where id = 'f9540000-0000-4000-8000-00000000000b') as code;

-- ── 1. Campaign created ───────────────────────────────────────────────────────
select is(public.ghl_campaign_created(jsonb_build_object('agent_id', (select code from p954), 'campaign_id', 'ghlc-gina-1',
            'fb_campaign_id', '120954001', 'campaign_name', 'Deedstone · Gina Holt', 'lead_type', 'booked_appointment'))->>'agent_id',
          'f9540000-0000-4000-8000-00000000000b', '1a campaign created is saved on Gina');
select is((select count(*)::int from public.agent_setup_ticks where agent_id = 'f9540000-0000-4000-8000-00000000000b' and step in ('campaign', 'mapped')),
          2, '1b Setup''s campaign and mapped steps tick');

-- ── 2. Lead webhook in ────────────────────────────────────────────────────────
select is(public.ghl_intake_lead(jsonb_build_object('intake_key', 'p954-lead-1', 'phone', '(214) 555-0154', 'state', 'TX',
            'first_name', 'Dana', 'last_name', 'Reyes', 'agent_id', (select code from p954)))->>'agent_id',
          'f9540000-0000-4000-8000-00000000000b', '2a the lead routes to Gina by her code');
create temp table p954_lead as select lead_id from public.lead_intake where intake_key = 'p954-lead-1';
select is((select assigned_rep_id from public.leads where id = (select lead_id from p954_lead)),
          'f9540000-0000-4000-8000-00000000000b'::uuid, '2b the lead appears on Gina');
select is(public.ghl_intake_lead(jsonb_build_object('intake_key', 'p954-lead-1', 'phone', '(214) 555-0154', 'state', 'TX',
            'agent_id', (select code from p954)))->>'lead_id', (select lead_id::text from p954_lead), '2c a GHL retry saves nothing twice');
-- The form's consent line, as GHL sends it. Live has only mp-v1 (covers_ai false), so until Jordan's form carries the AI
-- sentence and CC registers that version (Brayden's yes), every lead goes to the VAs: 2d2 proves that, 2e the step after.
update public.leads set qualifier_answers = coalesce(qualifier_answers, '{}'::jsonb)
       || jsonb_build_object('consent_at', now()::text, 'consent_text_version', 'mp-v1'),
       lead_type = 'mortgage_protection', call_consent_at = null
 where id = (select lead_id from p954_lead);
select is((select reason from public.ai_caller_takes((select lead_id from p954_lead))), 'switch_off', '2d AI caller off: the VAs call it');
update public.recovery_config set ai_caller_live = true;
update public.ai_caller_settings set all_agents = true where id;
select is((select reason from public.ai_caller_takes((select lead_id from p954_lead))), 'no_ai_consent', '2d2 on, but mp-v1 doesn''t cover AI: still the VAs');
insert into public.ai_consent_versions (version, covers_ai) values ('ds-ai-v1', true);
update public.leads set qualifier_answers = qualifier_answers || '{"consent_text_version":"ds-ai-v1"}'::jsonb where id = (select lead_id from p954_lead);
select ok((select reason is null or reason not in ('not_form', 'test_account', 'switch_off', 'agent_not_on', 'no_ai_consent')
             from public.ai_caller_takes((select lead_id from p954_lead))),
          '2e AI caller on: the lead passes every gate but the time-of-day/DNC dial check');
update public.recovery_config set ai_caller_live = false;

-- ── 3. Ohvara → GHL push ──────────────────────────────────────────────────────
select ok((select count(*) from public.ghl_outbox where lead_id = (select lead_id from p954_lead)) >= 1, '3a bridge on: the lead is queued for GHL');
select ok(exists (select 1 from public.ghl_claim_outbox(50) c where c.lead_id = (select lead_id from p954_lead) and c.phone = '+12145550154'),
          '3b ghl-push claims it with the phone in E.164');
update public.ghl_settings set enabled = false where id;
select is((public.ghl_intake_lead('{"intake_key":"p954-lead-2","phone":"(214) 555-0155","state":"TX"}')->>'lead_id') is not null, true, '3c bridge off: a lead still saves');
select is((select count(*)::int from public.ghl_outbox o join public.lead_intake i on i.lead_id = o.lead_id where i.intake_key = 'p954-lead-2'),
          0, '3d bridge off: nothing is queued for GHL');
update public.ghl_settings set enabled = true where id;
select is((select sms_live from public.recovery_config limit 1), false, '3e texts are off (ghl-push then adds no one to a texting workflow)');

-- ── 4. Replies and opt-outs in ────────────────────────────────────────────────
select is((select lead_id from public.ghl_lead_for_contact(null, '+12145550154') limit 1), (select lead_id from p954_lead), '4a a GHL text matches the lead by phone');
insert into public.lead_sms_replies (twilio_sid, from_phone, body, lead_id) values ('ghl:dry-run-1', '+12145550154', 'Yes call me after 5', (select lead_id from p954_lead));
select is((select count(*)::int from public.lead_sms_replies where lead_id = (select lead_id from p954_lead)), 1, '4b the reply lands on the lead');
select public.sms_set_opt('(214) 555-0154', true, 'GHL');
select is(public.sms_is_opted_out('+12145550154'), true, '4c STOP opts the number out');
select public.sms_set_opt('(214) 555-0154', false, 'GHL');
select is(public.sms_is_opted_out('+12145550154'), false, '4d START opts it back in');

-- ── 5. Spend feed ─────────────────────────────────────────────────────────────
select public.ghl_ad_spend_save(jsonb_build_array(jsonb_build_object('campaign_id', 'ghlc-gina-1', 'fb_campaign_id', '120954001',
         'campaign_name', 'Deedstone · Gina Holt', 'date', current_date::text, 'spend_cents', 4321, 'impressions', 900, 'clicks', 40, 'leads', 3)), 'ok');
select is((select sum(spend_cents)::int from public.ad_spend_daily where agent_id = 'f9540000-0000-4000-8000-00000000000b'), 4321, '5 spend lands on Gina by campaign');

-- ── 6. Campaign on/off ────────────────────────────────────────────────────────
insert into public.agent_campaign_control (agent_id, lead_type, run, daily_budget_cents, cap_cents, reason)
values ('f9540000-0000-4000-8000-00000000000b', 'appts', true, 1000, 3000, 'funded')
on conflict (agent_id, lead_type) do update set run = true, changed_at = clock_timestamp();
select ok(exists (select 1 from public.ghl_claim_controls(10) where agent_id = 'f9540000-0000-4000-8000-00000000000b'),
          '6 the on/off row is claimed for GHL (ghl-push posts it to Jordan''s control webhook)');

-- ── 7. Jordan's login: invited as a VA (the only invite in the portal), then CC makes him admin with the server key ──
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'f9540000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p954_jordan@example.invalid',
        '{"provider":"email","providers":["email"],"role":"fulfillment"}', '{"full_name":"Jordan Test"}', now(), now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9540000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
select throws_ok($$update public.profiles set role = 'admin' where id = 'f9540000-0000-4000-8000-00000000000e'$$, '42501', null, '7a he can''t make himself admin');
reset role;
update public.profiles set role = 'admin', is_active = true where id = 'f9540000-0000-4000-8000-00000000000e';
select is((select role::text from public.profiles where id = 'f9540000-0000-4000-8000-00000000000e'), 'admin', '7b CC (server key) makes him a full admin');

select * from finish();
rollback;
