-- ============================================================
-- Migration 044 — Keep batch_date intraday for all statuses
--
-- Spec (Prompt 28): leads stay visible in the rep's My Leads
-- all day regardless of status — reps can correct a mistake
-- at any point. The EOD sweep (23:55 UTC) already handles
-- the nightly cleanup correctly:
--   - Follow-Up  → batch_date nulled after queue entry confirmed
--   - Not Interested → batch_date nulled
--
-- This migration removes the intraday batch_date := null from
-- the pipeline trigger for Follow-Up and Not Interested.
-- No changes to No Answer (020 already kept batch_date for it).
-- No changes to the EOD sweep, queues, or daily-batch cron.
-- ============================================================

create or replace function handle_lead_pipeline()
returns trigger
language plpgsql
security definer
as $$
begin
  -- No Answer: enter the 24h pool, KEEP batch_date all day so the
  -- lead stays visible in the rep's No Answer tab. The queue
  -- redistributes it (and re-dates it) after 24h.
  if new.status = 'No Answer' and old.status is distinct from new.status then
    insert into no_answer_queue (lead_id, called_by_rep_id)
    values (new.id, new.assigned_rep_id);
    new.no_answer_at    := now();
    new.follow_up_at    := null;
    new.follow_up_notes := null;
  end if;

  -- Not Interested: permanent do-not-contact. KEEP batch_date today
  -- so the lead stays visible; the EOD sweep nulls it at 23:55 UTC.

  -- Follow-Up: queue for the SAME rep at their chosen time.
  -- KEEP batch_date today so the lead stays visible all day;
  -- the EOD sweep nulls batch_date at 23:55 UTC.
  if new.status = 'Follow-Up'
     and new.follow_up_at is not null
     and old.follow_up_at is distinct from new.follow_up_at then
    delete from follow_up_queue
    where lead_id = new.id and reminded_at is null and completed_at is null;

    insert into follow_up_queue (lead_id, rep_id, follow_up_at, reason)
    values (new.id, new.assigned_rep_id, new.follow_up_at, new.follow_up_notes);
  end if;

  -- Appointment Booked with a time: sync an appointments row for the closer.
  if new.status = 'Appointment Booked'
     and new.appointment_at is not null
     and (old.appointment_at is distinct from new.appointment_at
          or old.status is distinct from new.status) then
    if exists (select 1 from appointments where lead_id = new.id and status = 'pending') then
      update appointments
      set scheduled_at = new.appointment_at,
          rep_id       = coalesce(new.assigned_rep_id, rep_id),
          updated_at   = now()
      where lead_id = new.id and status = 'pending';
    else
      insert into appointments (lead_id, rep_id, scheduled_at)
      values (new.id, new.assigned_rep_id, new.appointment_at);
    end if;
  end if;

  return new;
end;
$$;
