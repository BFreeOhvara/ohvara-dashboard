-- ============================================================
-- Migration 017 — Rep status redesign + No Answer re-queue
--
-- 1. Adds 'Appointment Booked' and 'Follow-Up' to lead_status
--    (the rep modal now offers exactly: Appointment Booked,
--    No Answer, Not Interested, Follow-Up)
-- 2. leads.no_answer_at — stamped by trigger whenever a lead
--    transitions to 'No Answer'
-- 3. leads.follow_up_at / follow_up_notes — saved from the modal
--    when a rep schedules a follow-up
-- 4. requeue_no_answer_leads() + pg_cron every 15 minutes:
--    leads marked No Answer 4+ hours ago flip back to 'New' with
--    batch_date = current_date, so they reappear in the rep's
--    list instead of being wasted
-- ============================================================

alter type lead_status add value if not exists 'Appointment Booked';
alter type lead_status add value if not exists 'Follow-Up';

alter table leads add column if not exists no_answer_at     timestamptz;
alter table leads add column if not exists follow_up_at     timestamptz;
alter table leads add column if not exists follow_up_notes  text;

-- Stamp no_answer_at on transition into 'No Answer'
create or replace function set_no_answer_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'No Answer' and old.status is distinct from new.status then
    new.no_answer_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists leads_no_answer_ts on leads;
create trigger leads_no_answer_ts
  before update of status on leads
  for each row execute function set_no_answer_at();

-- Re-queue: No Answer leads older than 4 hours come back as New, today
create or replace function requeue_no_answer_leads()
returns int
language plpgsql
security definer
as $$
declare n int;
begin
  update leads
  set status = 'New', batch_date = current_date, no_answer_at = null
  where status = 'No Answer'
    and no_answer_at is not null
    and no_answer_at <= now() - interval '4 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$
begin
  perform cron.unschedule('requeue-no-answer');
exception when others then
  null; -- job didn't exist yet
end;
$$;

select cron.schedule('requeue-no-answer', '*/15 * * * *', 'select requeue_no_answer_leads()');
