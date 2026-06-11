-- ============================================================
-- Migration 016 — Self-healing daily batch assignment
--
-- Root cause being fixed: useMyLeads filters leads on
-- batch_date = <UTC today>, but nothing advanced batch_date when
-- the UTC day rolled over, so reps woke up to an empty dashboard.
--
-- assign_daily_batches() is date-relative (CURRENT_DATE, never a
-- hardcoded date) and runs via pg_cron at 00:05 UTC, minutes after
-- the date the dashboard queries changes. Per active rep it:
--   1. counts today's batch
--   2. rolls over the rep's own unworked (New) leads from prior days
--   3. tops up to batch_size from the unassigned pool
--   4. if the pool is dry, re-surfaces the rep's most recent
--      previously-worked leads (except Booked) so the day is never empty
-- ============================================================

create extension if not exists pg_cron;

create or replace function assign_daily_batches(batch_size int default 150)
returns table (rep_id uuid, batch_count int)
language plpgsql
security definer
as $$
declare
  rep record;
  needed int;
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

    -- 4. pool is dry: re-surface the rep's most recent worked leads
    --    (anything except Booked) so the dashboard is never empty
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status <> 'Booked'
        order by batch_date desc, updated_at desc
        limit needed
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

-- Schedule at 00:05 UTC daily — minutes after the UTC date (which the
-- dashboard queries by) rolls over. Re-schedulable: drop any old job first.
do $$
begin
  perform cron.unschedule('daily-batch-assign');
exception when others then
  null; -- job didn't exist yet
end;
$$;

select cron.schedule('daily-batch-assign', '5 0 * * *', 'select assign_daily_batches()');
