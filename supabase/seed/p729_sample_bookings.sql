-- Prompt 729 — 12 more sample Booked clients for the Test Agent, so My Pipeline's
-- Booked list is long enough to scroll inside its box. Fake data, safe to delete.
-- Idempotent: keyed on the client name, so running it twice adds nothing.
--
-- Remove them:
--   delete from policies where agent_id = '3f2b2df7-40b1-4921-80e2-09981c819642'
--     and client_first_name = 'Test Client' and notes like 'P729 SAMPLE DATA%';
--   (policy_fulfillment_details rows go with them via the foreign key; if not,
--    delete from policy_fulfillment_details where full_legal_name like 'Test Client Sample Data %' first.)
--
-- Run as the service role / SQL editor (not as `authenticated`) so the
-- weekly-cap trigger is skipped. created_at is set before this week's Monday
-- so the 16-a-week meter does not move. fulfillment_autoassign picks the rep.

with src (n, local_day, local_time, tz, city, st, carrier) as (values
  (14, date '2026-10-12', time '09:00', 'America/New_York', 'Atlanta',      'GA', 'Mercury Insurance'),
  (15, date '2026-10-12', time '10:30', 'America/Chicago',  'Dallas',       'TX', 'State Farm'),
  (16, date '2026-10-12', time '13:30', 'America/New_York', 'Charlotte',    'NC', 'GEICO'),
  (17, date '2026-10-13', time '09:30', 'America/New_York', 'Columbus',     'OH', 'Allstate'),
  (18, date '2026-10-13', time '11:00', 'America/Chicago',  'Chicago',      'IL', 'Mercury Insurance'),
  (19, date '2026-10-13', time '14:00', 'America/New_York', 'Tampa',        'FL', 'State Farm'),
  (20, date '2026-10-14', time '10:00', 'America/New_York', 'Philadelphia', 'PA', 'GEICO'),
  (21, date '2026-10-14', time '12:30', 'America/Chicago',  'Nashville',    'TN', 'Allstate'),
  (22, date '2026-10-15', time '09:00', 'America/New_York', 'Boston',       'MA', 'Mercury Insurance'),
  (23, date '2026-10-15', time '11:30', 'America/Chicago',  'Houston',      'TX', 'State Farm'),
  (24, date '2026-10-15', time '15:00', 'America/New_York', 'Raleigh',      'NC', 'GEICO'),
  (25, date '2026-10-16', time '10:00', 'America/New_York', 'Orlando',      'FL', 'Allstate')
), ins as (
  insert into public.policies (
    agent_id, client_first_name, client_last_name, client_phone, status,
    notes, created_at, fulfillment_assigned, fulfillment_stage, scheduled_call_at,
    call_attempts, client_city, state, client_timezone
  )
  select
    '3f2b2df7-40b1-4921-80e2-09981c819642', 'Test Client', 'Sample Data ' || s.n, '555-010' || s.n, 'Submitted',
    'P729 SAMPLE DATA - fake client so the Booked list scrolls, safe to delete',
    timestamptz '2026-10-02 12:00:00+00' + (s.n - 14) * interval '37 minutes',
    true, 'Pending', (s.local_day + s.local_time) at time zone s.tz,
    0, s.city, s.st, s.tz
  from src s
  where not exists (
    select 1 from public.policies p
    where p.agent_id = '3f2b2df7-40b1-4921-80e2-09981c819642'
      and p.client_first_name = 'Test Client' and p.client_last_name = 'Sample Data ' || s.n
  )
  returning id, client_last_name
)
insert into public.policy_fulfillment_details (policy_id, full_legal_name, current_carrier)
select i.id, 'Test Client ' || i.client_last_name, s.carrier
from ins i
join src s on 'Sample Data ' || s.n = i.client_last_name;
