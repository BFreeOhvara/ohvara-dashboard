-- p1014_ai_never_va — pgTAP checks for supabase/migrations/277_ai_never_va.sql (Prompt 1014): VAs never call new leads.
-- Brayden's five cases (outside hours, do-not-call, no AI consent, switch off, a reply to a no-answer text), the old
-- paths that used to ring a VA (route_enqueue new_lead, a call the AI couldn't start, the no-answer flow's call steps,
-- a callback the AI booked), what VAs keep (an inbound / missed-transfer callback), the VA desk's queue and the doors.
-- RUN: node scripts/run-sql-tests.mjs supabase/tests/p1014_ai_never_va.sql
-- Local PGlite only; one transaction, rolled back. Never against live.

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'p1014_' || u.n || '@example.invalid',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role),
       jsonb_build_object('full_name', u.name), now(), now()
  from (values
    ('a1014000-0000-4000-8000-00000000000a'::uuid, 'admin', 'fulfillment', 'Ada Admin'),
    ('a1014000-0000-4000-8000-00000000000b'::uuid, 'gina',  'agent',       'Gina Holt'),
    ('a1014000-0000-4000-8000-00000000000c'::uuid, 'vic',   'fulfillment', 'Vic Va')
  ) as u(id, n, role, name);
update public.profiles set role = 'admin', is_active = true, is_demo = false where id = 'a1014000-0000-4000-8000-00000000000a';
update public.profiles set is_active = true where id in ('a1014000-0000-4000-8000-00000000000b', 'a1014000-0000-4000-8000-00000000000c');

-- QA: open every minute of every day in UTC. QB: closed right now, opens later today or tomorrow (UTC).
insert into public.state_call_rules (state, tz, call_start, call_end, sun_start, sun_end)
values ('QA', '{UTC}', '00:00', '23:59:59', '00:00', '23:59:59'),
       ('QB', '{UTC}', case when extract(hour from now() at time zone 'UTC') < 12 then time '14:00' else time '03:00' end,
                       case when extract(hour from now() at time zone 'UTC') < 12 then time '15:00' else time '04:00' end, null, null)
on conflict (state) do update set tz = excluded.tz, call_start = excluded.call_start, call_end = excluded.call_end,
  sun_start = excluded.sun_start, sun_end = excluded.sun_end, max_attempts_24h = null;
insert into public.ai_consent_versions (version, covers_ai) values ('ds-ai-v1', true) on conflict (version) do update set covers_ai = true;
update public.recovery_config set ai_caller_live = false;
update public.ai_caller_settings set all_agents = true where id;

-- A Deedstone form lead: consent covering AI calls, in an open state, on Gina.
create temp table p1014_n (k text primary key, id uuid);
create or replace function pg_temp.lead(k text, st text, ver text, agent boolean default true, ph text default null, typ text default 'mortgage_protection')
returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.leads (lead_type, lead_source, business_name, contact_name, phone, state, assigned_rep_id, qualifier_answers, call_consent_at)
  values (typ, 'meta', 'P1014 ' || k, 'P1014 ' || k, coalesce(ph, '+1214555' || lpad((abs(hashtext(k)) % 10000)::text, 4, '0')), st,
          case when agent then 'a1014000-0000-4000-8000-00000000000b'::uuid end,
          case when typ = 'mortgage_protection' then jsonb_build_object('consent_at', now()::text, 'consent_text_version', ver, 'tz', 'UTC') else '{}'::jsonb end,
          case when typ = 'mortgage_protection' then null else now() end)
  returning id into i;
  insert into p1014_n values (k, i);
  return i;
end $$;
create or replace function pg_temp.n(k text) returns uuid language sql as $$ select id from p1014_n where k = $1 $$;
create or replace function pg_temp.vaq(l uuid) returns int language sql as $$
  select count(*)::int from public.call_queue where lead_id = l and status in ('held', 'waiting', 'offered', 'taken') $$;

-- ── 4. Switch off: the lead waits in line, nobody calls ───────────────────────────────────────────────────────────
select pg_temp.lead('off', 'QA', 'ds-ai-v1');
select is((select state from public.ai_lead_waits where lead_id = pg_temp.n('off')), 'wait_switch_off', '4a switch off: the lead waits in line');
select is(pg_temp.vaq(pg_temp.n('off')), 0, '4b switch off: no VA queue item');
select is((select count(*)::int from public.ai_calls where lead_id = pg_temp.n('off')), 0, '4c switch off: no AI call either');
select ok(exists (select 1 from public.inbound_events where lead_id = pg_temp.n('off') and detail ->> 'call_wait' = 'wait_switch_off'
                    and label !~ '\mAI\M'), '4d the reason is on the lead''s timeline, in agent-safe words');
update public.ai_lead_waits set next_at = now() - interval '1 second' where lead_id = pg_temp.n('off');
select public.ai_caller_sweep();
select is((select count(*)::int from public.ai_calls where lead_id = pg_temp.n('off')), 0, '4e the sweep leaves switch-off waiters while it is off');

-- Switched on: the waiting lead is called by the AI.
update public.recovery_config set ai_caller_live = true;
select public.ai_caller_sweep();
select is((select purpose from public.ai_calls where lead_id = pg_temp.n('off')), 'first', '4f switched on: the sweep hands the waiting lead to the AI');
select ok(not exists (select 1 from public.ai_lead_waits where lead_id = pg_temp.n('off')), '4g and it no longer waits');

-- A lead with no agent yet waits silently, then the AI calls when it is assigned (the form and GHL assign after insert).
select pg_temp.lead('later', 'QA', 'ds-ai-v1', false);
select is((select state from public.ai_lead_waits where lead_id = pg_temp.n('later')), 'wait_agent', '4h no agent yet: waits for one');
update public.leads set assigned_rep_id = 'a1014000-0000-4000-8000-00000000000b' where id = pg_temp.n('later');
select is((select count(*)::int from public.ai_calls where lead_id = pg_temp.n('later') and purpose = 'first'), 1, '4i assigned: the AI calls it');

-- ── 2. Do-not-call: nobody, ever (checked before the switch) ──────────────────────────────────────────────────────
insert into public.dnc_numbers (phone, internal, source) values ('+12145559001', true, 'do_not_call') on conflict (phone) do update set internal = true;
select pg_temp.lead('dnc', 'QA', 'ds-ai-v1', true, '+12145559001');
select is((select state from public.ai_lead_waits where lead_id = pg_temp.n('dnc')), 'blocked_dnc', '2a DNC: blocked');
select is((select count(*)::int from public.ai_calls where lead_id = pg_temp.n('dnc')) + pg_temp.vaq(pg_temp.n('dnc')), 0, '2b DNC: no AI call, no VA item');
update public.recovery_config set ai_caller_live = false;
select is((select state from public.ai_caller_takes(pg_temp.n('dnc'))), 'blocked_dnc', '2c DNC wins even while the switch is off');
update public.recovery_config set ai_caller_live = true;

-- ── 3. No AI consent: nobody calls; admins told ───────────────────────────────────────────────────────────────────
select pg_temp.lead('noconsent', 'QA', 'mp-v1');
select is((select state from public.ai_lead_waits where lead_id = pg_temp.n('noconsent')), 'blocked_no_consent', '3a no AI consent: blocked');
select is((select count(*)::int from public.ai_calls where lead_id = pg_temp.n('noconsent')) + pg_temp.vaq(pg_temp.n('noconsent')), 0, '3b no AI consent: no AI call, no VA item');
select ok(not exists (select 1 from public.notifications where profile_id = 'a1014000-0000-4000-8000-00000000000a' and type = 'ai_lead_not_called'),
          '3c no admin notice (P1023: not on the list)');

-- ── 1. Outside calling hours: the AI calls at the next allowed moment ─────────────────────────────────────────────
select pg_temp.lead('night', 'QB', 'ds-ai-v1');
select is((select state from public.ai_lead_waits where lead_id = pg_temp.n('night')), 'wait_hours', '1a outside hours: waits');
select ok((select next_at > now() and next_at < now() + interval '25 hours' from public.ai_lead_waits where lead_id = pg_temp.n('night')),
          '1b it waits for the state''s next open moment');
select is(pg_temp.vaq(pg_temp.n('night')), 0, '1c outside hours: no VA item');

-- ── The old VA paths ──────────────────────────────────────────────────────────────────────────────────────────────
-- route_enqueue('new_lead') (anything still calling it) never reaches a VA.
select pg_temp.lead('old', 'QA', 'ds-ai-v1');
update public.ai_calls set status = 'to_va' where lead_id = pg_temp.n('old');
select public.route_enqueue('new_lead', pg_temp.n('old'));
select is((select count(*)::int from public.call_queue where lead_id = pg_temp.n('old') and kind = 'new_lead' and status <> 'cancelled'), 0,
          '6a route_enqueue new_lead: stored cancelled, never offered to a VA');
-- A call the AI couldn't start waits and tries again; no VA.
select public.ai_caller_not_dialed((select id from public.ai_calls where lead_id = pg_temp.n('off')), 'not_connected');
select is((select state from public.ai_lead_waits where lead_id = pg_temp.n('off')), 'wait_retry', '6b a call that didn''t start: tried again later');
select is(pg_temp.vaq(pg_temp.n('off')), 0, '6c and no VA item');

-- ── 5. A reply to a no-answer text: the AI calls them back ────────────────────────────────────────────────────────
delete from public.ai_lead_waits where lead_id = pg_temp.n('later');
update public.ai_calls set status = 'done', outcome = 'no_answer' where lead_id = pg_temp.n('later');
select public.lead_first_call_outcome(pg_temp.n('later'), 'no_answer', 'ai');
select public.lead_flow_action(pg_temp.n('later'), 'replied');
select is((select count(*)::int from public.ai_calls where lead_id = pg_temp.n('later') and purpose = 'reply'), 1, '5a a reply: the AI calls them back');
select is(pg_temp.vaq(pg_temp.n('later')), 0, '5b a reply: no VA callback task');
-- The call back books a later time: the AI calls then.
select public.ai_caller_result((select id from public.ai_calls where lead_id = pg_temp.n('later') and purpose = 'reply'), 'not_now',
                               jsonb_build_object('callback_at', (now() + interval '1 day')::text));
select ok(exists (select 1 from public.ai_calls where lead_id = pg_temp.n('later') and purpose = 'callback' and status = 'queued' and due_at > now()),
          '5c a time they gave on the call back: the AI calls then');
select ok(exists (select 1 from public.inbound_events where lead_id = pg_temp.n('later') and label like 'Called them back.%'),
          '5d the timeline reads "Called them back"');

-- The no-answer flow's call steps are the AI's.
select pg_temp.lead('flow', 'QA', 'ds-ai-v1');
update public.ai_calls set status = 'done', outcome = 'no_answer' where lead_id = pg_temp.n('flow');
select public.lead_first_call_outcome(pg_temp.n('flow'), 'no_answer', 'ai');
update public.leads set text_flow_started_at = now() - interval '2 days', text_flow_calls = 1 where id = pg_temp.n('flow');
select public.lead_flows_sweep();
select ok(exists (select 1 from public.ai_calls where lead_id = pg_temp.n('flow') and purpose = 'flow'), '6d a no-answer call step: the AI calls');
select is(pg_temp.vaq(pg_temp.n('flow')), 0, '6e no VA task for it');

-- ── What VAs keep: an inbound caller's callback (not a new form lead) still rings a VA ────────────────────────────
select pg_temp.lead('inbound', 'QA', null, false, '+12145559002', 'policy_help');
select public.route_enqueue('callback', pg_temp.n('inbound'), p_due => now(), p_detail => '{"help_call_sid":"CA1014"}'::jsonb, p_offer => false);
select ok(exists (select 1 from public.call_queue where lead_id = pg_temp.n('inbound') and kind = 'callback' and status <> 'cancelled'),
          '7a an inbound caller''s callback stays with the VAs');

-- ── The VA desk's queue: no new form leads ────────────────────────────────────────────────────────────────────────
update public.leads set va_outcome = null where id in (select id from p1014_n);
grant select on p1014_n to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1014000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is((select count(*)::int from public.va_queue() q where q.lead_id in (select id from p1014_n) and q.lead_type = 'mortgage_protection'), 0,
          '8a the VA desk lists no new form leads');
select ok(exists (select 1 from public.va_queue() q where q.lead_id = pg_temp.n('inbound')), '8b an unassigned inbound lead still shows');
reset role;

-- ── Never 'va'; locked doors ──────────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from p1014_n n, lateral public.ai_caller_takes(n.id) t where t.by not in ('ai', 'wait', 'blocked', 'none')), 0,
          '9a ai_caller_takes never answers "va"');
select ok(not has_function_privilege('anon', 'public.ai_route_lead(uuid,text,timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.ai_route_lead(uuid,text,timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.ai_caller_takes(uuid)', 'execute'), '9b the new functions are service-role only');

select * from finish();
rollback;
