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
-- leads (NOT the lead just returned) by dating it back one day. The
-- demoted lead leaves today's count and re-enters tomorrow through
-- assign_daily_batches step 2 (the normal previous-day 'New' rollover).
-- Net effect: a return DISPLACES a fresh lead instead of stacking on
-- top — the visible total stays <= 150.
--
-- Edge case (accepted): if the target rep has no unworked 'New' fresh
-- leads to demote, the total can still exceed 150. That is real work
-- the rep must do, so we let it stand rather than drop a real lead.
--
-- Only process_lead_queues changes; the trigger, queue tables, and
-- assign_daily_batches (024) are untouched.
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
        update leads set batch_date = current_date - 1
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
          update leads set batch_date = current_date - 1
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
