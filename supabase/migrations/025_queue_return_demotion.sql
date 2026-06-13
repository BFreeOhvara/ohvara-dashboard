-- ============================================================
-- Migration 025 — Queue returns count TOWARD 150, not on top
--
-- Problem (Batch Total 155): assign_daily_batches (024, 00:05 cron)
-- tops each rep to EXACTLY 150 for the day. But process_lead_queues
-- (019, hourly) re-dates returning leads to batch_date = current_date
-- ADDITIVELY:
--   5a. No Answer pool 24h elapsed → random active rep, batch_date today
--   5b. Follow-Up due           → same rep,          batch_date today
-- useMyLeads counts every lead with batch_date = today, so each return
-- pushes the rep's visible Batch Total above 150 (150 + N returns).
--
-- Fix: when a return lands in a rep whose today-batch is ALREADY at or
-- over the target, demote one of that rep's still-'New' fresh-batch
-- leads (NOT the lead just returned) into TOMORROW's batch
-- (batch_date = current_date + 1, the same carry convention as
-- eod_pipeline_sweep). The demoted lead leaves today's count and is
-- counted toward tomorrow's 150 by assign_daily_batches (00:05).
-- Net effect: a return DISPLACES a fresh lead instead of stacking on
-- top — the visible total stays <= 150.
--
-- Edge case (accepted): if the target rep has no unworked 'New' fresh
-- leads to demote, the total can still exceed 150. That is real work
-- the rep must do, so we let it stand rather than drop a real lead.
--
-- Two functions change: process_lead_queues (mid-day demotion on each
-- queue return) and assign_daily_batches (a morning TRIM so a carried-
-- over batch can't exceed batch_size either). The trigger and queue
-- tables are untouched. Together they guarantee the visible batch total
-- is <= batch_size for any rep, any day, by any path.
-- ============================================================

create or replace function process_lead_queues()
returns table (redistributed int, followups_returned int)
language plpgsql
security definer
as $$
declare
  q record;
  chosen uuid;
  target_rep uuid;
  n_redis int := 0;
  n_fu int := 0;
  batch_target constant int := 150;
  today_count int;
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

    update leads
    set assigned_rep_id = chosen, batch_date = current_date,
        status = 'New', no_answer_at = null
    where id = q.lead_id and status = 'No Answer';

    if found then
      update no_answer_queue
      set distributed_at = now(), distributed_to_rep_id = chosen
      where id = q.id;
      n_redis := n_redis + 1;

      -- keep the chosen rep's visible total <= 150: if this return put
      -- them over target, bump one of their fresh 'New' leads to tomorrow
      target_rep := chosen;
      select count(*) into today_count
      from leads
      where assigned_rep_id = target_rep and batch_date = current_date;
      if today_count > batch_target then
        update leads set batch_date = current_date + 1
        where id = (
          select id from leads
          where assigned_rep_id = target_rep
            and batch_date = current_date
            and status = 'New'
            and id <> q.lead_id
          order by created_at desc
          limit 1
        );
      end if;
    else
      -- lead moved on since (booked, not interested…) — close the row out
      update no_answer_queue set distributed_at = now() where id = q.id;
    end if;
  end loop;

  -- 5b. Follow-ups due: back to the SAME rep, flagged in the UI via
  --     the lead's follow_up_at/follow_up_notes (kept, not cleared)
  for q in
    select id, lead_id, rep_id from follow_up_queue
    where follow_up_at <= now() and reminded_at is null and completed_at is null
  loop
    update leads
    set assigned_rep_id = coalesce(q.rep_id, assigned_rep_id),
        batch_date = current_date, status = 'New'
    where id = q.lead_id and status = 'Follow-Up'
    returning assigned_rep_id into target_rep;
    if found then
      n_fu := n_fu + 1;

      -- same displacement rule for the returning rep
      if target_rep is not null then
        select count(*) into today_count
        from leads
        where assigned_rep_id = target_rep and batch_date = current_date;
        if today_count > batch_target then
          update leads set batch_date = current_date + 1
          where id = (
            select id from leads
            where assigned_rep_id = target_rep
              and batch_date = current_date
              and status = 'New'
              and id <> q.lead_id
            order by created_at desc
            limit 1
          );
        end if;
      end if;
    end if;
    update follow_up_queue set reminded_at = now() where id = q.id;
  end loop;

  redistributed := n_redis;
  followups_returned := n_fu;
  return next;
end;
$$;

-- ── assign_daily_batches: add a final TRIM so the morning batch is
--    never OVER batch_size either ───────────────────────────────────
-- 024 only ever tops a rep UP to batch_size; it never reduces. So a rep
-- who carries more than batch_size unworked 'New' leads into a new day
-- (eod_pipeline_sweep carries ALL still-New leads with no cap, and any
-- batch inflated before this migration) would stay over 150. This adds a
-- closing TRIM step: after the top-up, if the rep has more than
-- batch_size leads dated today, push the excess (most-recently-added
-- 'New' leads) to tomorrow. Combined with the process_lead_queues
-- demotion above, the visible batch total is <= batch_size for any rep,
-- any day, by any path. Steps 1-5 are identical to migration 024.
create or replace function assign_daily_batches(batch_size int default 150)
returns table (rep_id uuid, batch_count int)
language plpgsql
security definer
as $$
declare
  rep record;
  needed int;
  excess int;
begin
  for rep in
    select id from profiles where role = 'rep' and is_active = true
  loop
    -- 1. how many leads does this rep already have for today?
    select batch_size - count(*) into needed
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;

    -- 2. roll over the rep's own unworked leads from previous days
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status = 'New'
        order by batch_date desc
        limit needed
      );
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date;
    end if;

    -- 3. top up from the unassigned pool
    if needed > 0 then
      update leads set assigned_rep_id = rep.id, batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id is null and status = 'New'
        order by created_at
        limit needed
      );
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date;
    end if;

    -- 4. pool is dry: re-surface the rep's recent worked leads,
    --    skipping queue-managed and permanent statuses (019)
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status not in ('Booked', 'Appointment Booked', 'Not Interested', 'No Answer', 'Follow-Up')
        order by batch_date desc, updated_at desc
        limit needed
      );
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date;
    end if;

    -- 5. FINAL GUARANTEE (024): still short — pull from ANY of the rep's
    --    own leads except permanent Not Interested.
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date is distinct from current_date
          and status <> 'Not Interested'
        order by batch_date desc nulls last, updated_at desc
        limit needed
      );
    end if;

    -- 6. TRIM (025): if the rep is now OVER batch_size for today, push the
    --    excess fresh 'New' leads to tomorrow so the batch is exactly
    --    batch_size. Only 'New' leads move — worked/queued leads stay put.
    select count(*) - batch_size into excess
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    if excess > 0 then
      update leads set batch_date = current_date + 1
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date = current_date
          and status = 'New'
        order by created_at desc
        limit excess
      );
    end if;

    rep_id := rep.id;
    select count(*) into batch_count
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    return next;
  end loop;
end;
$$;
