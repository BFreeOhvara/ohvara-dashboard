-- Test data for the inbounds search + Activity proof (task c9ef3987). NOT a migration: do not number it
-- or put it in supabase/migrations. Run once, by hand, with the service role (typed leads and
-- inbound_events can only be written by it: 173 leads_typed_insert_service_only, 180 select-only grants).
--
-- Adds exactly one inbound for the test agent (username testagent11): a booked-appointment lead named
-- 'TEST Inbound (crew)', a fictional 555 number, no email, and ONE completed 'came_in' event.
-- No text, call or automation is started: it writes two rows and nothing else (no assign_lead, no
-- lead-workflow-sms call; sms_live / voice_live stay as they are). Safe to re-run: it skips if the
-- lead already exists.
--
-- Remove later:  delete from public.leads where contact_name = 'TEST Inbound (crew)' and phone = '+15555550142';
-- (inbound_events rows go with it: on delete cascade.)

with agent as (
  select id from public.profiles where username = 'testagent11' and role = 'agent'
), new_lead as (
  insert into public.leads
    (business_name, contact_name, phone, state, lead_type, lead_source, assigned_rep_id, delivered_at, qualifier_answers)
  select 'TEST Inbound (crew)', 'TEST Inbound (crew)', '+15555550142', 'FL',
         'mortgage_protection', 'referral', agent.id, now(),
         '{"test": true, "homeowner": true}'::jsonb
    from agent
   where not exists (select 1 from public.leads
                      where contact_name = 'TEST Inbound (crew)' and phone = '+15555550142')
  returning id, assigned_rep_id
)
insert into public.inbound_events (lead_id, agent_id, kind, state, at, label, actor_name, actor_role)
select id, assigned_rep_id, 'came_in', 'done', now(), 'Test inbound added for QA', 'Crew', 'system'
  from new_lead;

-- Check after running (expect one lead, one done event):
--   select l.id as lead_id, e.id as event_id, e.kind, e.state, e.at
--     from public.leads l join public.inbound_events e on e.lead_id = l.id
--    where l.contact_name = 'TEST Inbound (crew)';
