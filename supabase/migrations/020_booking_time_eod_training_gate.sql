-- ============================================================
-- Migration 020 — Appointment time, No Answer visibility,
--                 EOD auto-pipeline, rep training gate
--
-- 1. leads.appointment_at — reps capture the scheduled time when
--    booking; the pipeline trigger syncs an appointments row so
--    the closer pipeline sees it.
-- 2. No Answer keeps batch_date: the lead stays visible in the
--    rep's No Answer filter tab while it waits in the 24h pool.
--    (019 nulled batch_date, which made pooled leads vanish from
--    the rep's list immediately — the No Answer tab was always
--    empty.)
-- 3. eod_pipeline_sweep() at 23:55 UTC — carries every still-New
--    lead into tomorrow's batch and sweeps any statused lead that
--    missed its pipeline (trigger is the primary path; this is
--    the nightly safety net). No rep action required.
-- 4. training_progress — onboarding gate state per rep: videos
--    watched, flashcard quiz score, AI roleplay grade. My Leads
--    stays locked until all three pass.
-- ============================================================

-- ── 1. Appointment time on leads ─────────────────────────────
alter table leads add column if not exists appointment_at timestamptz;

-- ── 2 + 1. Pipeline trigger v3 ───────────────────────────────
create or replace function handle_lead_pipeline()
returns trigger
language plpgsql
security definer
as $$
begin
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

  -- Not Interested: permanent do-not-contact. Out of the batch now,
  -- row kept forever for scraper deduplication, never batched again.
  if new.status = 'Not Interested' and old.status is distinct from new.status then
    new.batch_date := null;
  end if;

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

-- ── 3. End-of-day auto-pipeline (23:55 UTC) ──────────────────
-- The status trigger routes leads in real time; this sweep is the
-- nightly guarantee that nothing strands. New → tomorrow's batch,
-- No Answer → 24h pool, Follow-Up → its queue (default: tomorrow),
-- Not Interested → out of batch.
create or replace function eod_pipeline_sweep()
returns table (carried_over int, no_answer_queued int, follow_ups_queued int, not_interested_cleared int)
language plpgsql
security definer
as $$
declare
  n_carry int := 0;
  n_naq   int := 0;
  n_fuq   int := 0;
  n_ni    int := 0;
begin
  -- New leads the rep didn't reach today: carry into tomorrow's batch.
  -- assign_daily_batches (00:05 UTC) then tops each rep up to 150.
  update leads
  set batch_date = current_date + 1
  where status = 'New'
    and batch_date = current_date
    and assigned_rep_id is not null;
  get diagnostics n_carry = row_count;

  -- No Answer leads missing a pending pool row (e.g. status set by a
  -- path that skipped the trigger): queue them now.
  insert into no_answer_queue (lead_id, called_by_rep_id)
  select l.id, l.assigned_rep_id
  from leads l
  where l.status = 'No Answer'
    and not exists (
      select 1 from no_answer_queue q
      where q.lead_id = l.id and q.distributed_at is null
    );
  get diagnostics n_naq = row_count;

  -- Follow-Up leads with no pending queue row: schedule them — at the
  -- rep's chosen time, or tomorrow if no time was set.
  insert into follow_up_queue (lead_id, rep_id, follow_up_at, reason)
  select l.id, l.assigned_rep_id,
         coalesce(l.follow_up_at, now() + interval '1 day'),
         l.follow_up_notes
  from leads l
  where l.status = 'Follow-Up'
    and not exists (
      select 1 from follow_up_queue q
      where q.lead_id = l.id and q.reminded_at is null and q.completed_at is null
    );
  get diagnostics n_fuq = row_count;

  update leads set batch_date = null
  where status = 'Follow-Up'
    and batch_date is not null
    and exists (
      select 1 from follow_up_queue q
      where q.lead_id = leads.id and q.reminded_at is null and q.completed_at is null
    );

  -- Not Interested must never sit in a batch.
  update leads set batch_date = null
  where status = 'Not Interested' and batch_date is not null;
  get diagnostics n_ni = row_count;

  carried_over           := n_carry;
  no_answer_queued       := n_naq;
  follow_ups_queued      := n_fuq;
  not_interested_cleared := n_ni;
  return next;
end;
$$;

do $$
begin
  perform cron.unschedule('eod-pipeline-sweep');
exception when others then
  null;
end;
$$;
select cron.schedule('eod-pipeline-sweep', '55 23 * * *', 'select eod_pipeline_sweep()');

-- ── 4. Rep onboarding gate — training progress ───────────────
create table if not exists training_progress (
  rep_id              uuid primary key references profiles(id) on delete cascade,
  videos_watched      jsonb not null default '[]'::jsonb,  -- array of video ids
  quiz_score          int,                                  -- best score, # correct
  quiz_total          int,                                  -- questions in that attempt
  quiz_passed_at      timestamptz,                          -- >= 85% correct
  roleplay_score      int,                                  -- Claude score, 0-12
  roleplay_grade      text,                                 -- letter grade (B+ or better passes)
  roleplay_passed_at  timestamptz,
  unlocked_at         timestamptz,                          -- all three passed
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table training_progress enable row level security;

-- Reps read and write only their own row; admins and closers can
-- monitor everyone. Role check goes through profiles (never the
-- protected table itself).
create policy tp_rep_own on training_progress
  for all
  using (rep_id = auth.uid())
  with check (rep_id = auth.uid());

create policy tp_staff_select on training_progress
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('admin', 'closer')
    )
  );
