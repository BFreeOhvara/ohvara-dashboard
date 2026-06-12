-- ============================================================
-- Migration 022 — Reverting out of 'Appointment Booked' cleans up
--
-- When a rep reverts a booked lead (Appointment Booked → anything
-- else), the pending appointments row that the trigger synced for
-- the closer pipeline previously stayed behind as a ghost booking.
-- Now the same trigger deletes the pending row and clears
-- appointment_at on the lead.
--
-- Safe with the queue processors: process_lead_queues only updates
-- leads WHERE status = 'No Answer' / 'Follow-Up', so nothing
-- system-side ever transitions FROM 'Appointment Booked' — this
-- branch only fires on a rep's explicit revert.
-- ============================================================

create or replace function handle_lead_pipeline()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Reverted out of Appointment Booked: remove the synced pending
  -- appointment so the closer pipeline doesn't show a ghost booking,
  -- and clear the stale appointment time.
  if old.status = 'Appointment Booked' and new.status is distinct from old.status then
    delete from appointments where lead_id = new.id and status = 'pending';
    new.appointment_at := null;
  end if;

  -- No Answer: enter the 24h pool but KEEP batch_date — the lead
  -- remains visible in the rep's No Answer tab for the rest of the
  -- day. The queue redistributes it (and re-dates it) after 24h.
  if new.status = 'No Answer' and old.status is distinct from new.status then
    insert into no_answer_queue (lead_id, called_by_rep_id)
    values (new.id, new.assigned_rep_id);
    new.no_answer_at    := now();
    new.follow_up_at    := null;  -- stale follow-up context must not travel to a random rep
    new.follow_up_notes := null;
  end if;

  -- Not Interested: permanent do-not-contact, but KEEP batch_date so
  -- the lead stays visible in the rep's Not Interested tab today.
  -- eod_pipeline_sweep (23:55 UTC) nulls batch_date — that is the
  -- archive step. The row is kept forever for scraper dedup and the
  -- daily batch functions never re-surface 'Not Interested'.

  -- Follow-Up scheduled (modal saves follow_up_at on Done): queue it
  -- for the SAME rep and remove from the current daily 150.
  if new.status = 'Follow-Up'
     and new.follow_up_at is not null
     and old.follow_up_at is distinct from new.follow_up_at then
    delete from follow_up_queue
    where lead_id = new.id and reminded_at is null and completed_at is null;

    insert into follow_up_queue (lead_id, rep_id, follow_up_at, reason)
    values (new.id, new.assigned_rep_id, new.follow_up_at, new.follow_up_notes);

    new.batch_date := null;
  end if;

  -- Appointment Booked with a time: sync an appointments row so the
  -- closer pipeline picks it up. One pending appointment per lead.
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
