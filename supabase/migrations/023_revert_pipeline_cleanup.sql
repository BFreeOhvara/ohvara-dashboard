-- ============================================================
-- Migration 023 — Reverting out of 'No Answer' / 'Follow-Up' cleans up
--
-- Found in the 2026-06-12 e2e rep test: a rep reverting
-- No Answer → New left the pending no_answer_queue row behind, so
-- the now-New lead would still be redistributed to a RANDOM rep
-- after 24h; no_answer_at also stayed stale. Follow-Up reverts had
-- the same gap (pending follow_up_queue row + stale follow_up_at /
-- follow_up_notes — a canceled follow-up still came back). This
-- mirrors 022's revert-from-Booked cleanup for the other two
-- queue-managed statuses.
--
-- Collision guard: process_lead_queues also transitions leads OUT
-- of these statuses (system-side, not a rep revert). The processor
-- now closes the queue row BEFORE updating the lead, so when the
-- trigger fires on a system transition there is no pending row left
-- and the found-guard keeps follow_up_at/notes (amber badge) and
-- queue history intact. eod_pipeline_sweep never changes status,
-- so it never enters these branches.
-- ============================================================

-- ── 1. Trigger: add revert cleanup for No Answer / Follow-Up ──
create or replace function handle_lead_pipeline()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Reverted out of Appointment Booked (022): remove the synced
  -- pending appointment and clear the stale appointment time.
  if old.status = 'Appointment Booked' and new.status is distinct from old.status then
    delete from appointments where lead_id = new.id and status = 'pending';
    new.appointment_at := null;
  end if;

  -- Reverted out of No Answer: a pending pool row means this is a
  -- rep revert (system redistribution closes the row first) — drop
  -- it so the lead isn't redistributed, and clear the stale stamp.
  if old.status = 'No Answer' and new.status is distinct from old.status then
    delete from no_answer_queue
    where lead_id = new.id and distributed_at is null;
    if found then
      new.no_answer_at := null;
    end if;
  end if;

  -- Reverted out of Follow-Up: a pending queue row means a rep
  -- canceled the follow-up — drop it and clear the schedule fields.
  -- On a system return (queue row already marked reminded) the
  -- fields are KEPT so the amber badge still shows the context.
  if old.status = 'Follow-Up' and new.status is distinct from old.status then
    delete from follow_up_queue
    where lead_id = new.id and reminded_at is null and completed_at is null;
    if found then
      new.follow_up_at    := null;
      new.follow_up_notes := null;
    end if;
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

-- ── 2. Processor: close queue rows BEFORE the lead update ─────
create or replace function process_lead_queues()
returns table (redistributed int, followups_returned int)
language plpgsql
security definer
as $$
declare
  q record;
  chosen uuid;
  n_redis int := 0;
  n_fu int := 0;
begin
  -- 5a. No Answer pool: 24h elapsed → random active rep, fresh today
  for q in
    select id, lead_id from no_answer_queue
    where available_at <= now() and distributed_at is null
  loop
    select id into chosen from profiles
    where role = 'rep' and is_active = true
    order by random() limit 1;
    exit when chosen is null;  -- no active reps: leave queue untouched

    -- close the row first: the lead update below fires the pipeline
    -- trigger, whose revert branch must only see rep reverts
    update no_answer_queue
    set distributed_at = now(), distributed_to_rep_id = chosen
    where id = q.id;

    update leads
    set assigned_rep_id = chosen, batch_date = current_date,
        status = 'New', no_answer_at = null
    where id = q.lead_id and status = 'No Answer';

    if found then
      n_redis := n_redis + 1;
    else
      -- lead moved on since (booked, not interested…) — keep the row
      -- closed but clear the rep stamp so it doesn't read as a real
      -- distribution
      update no_answer_queue set distributed_to_rep_id = null where id = q.id;
    end if;
  end loop;

  -- 5b. Follow-ups due: back to the SAME rep, flagged in the UI via
  --     the lead's follow_up_at/follow_up_notes (kept, not cleared —
  --     the trigger's found-guard skips clearing because the row is
  --     already marked reminded here)
  for q in
    select id, lead_id, rep_id from follow_up_queue
    where follow_up_at <= now() and reminded_at is null and completed_at is null
  loop
    update follow_up_queue set reminded_at = now() where id = q.id;

    update leads
    set assigned_rep_id = coalesce(q.rep_id, assigned_rep_id),
        batch_date = current_date, status = 'New'
    where id = q.lead_id and status = 'Follow-Up';
    if found then n_fu := n_fu + 1; end if;
  end loop;

  redistributed := n_redis;
  followups_returned := n_fu;
  return next;
end;
$$;
