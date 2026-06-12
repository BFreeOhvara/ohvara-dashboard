-- ============================================================
-- Migration 024 — Batch is always exactly 150
--
-- Problem: 019's pool-dry fallback (step 4) excludes Booked,
-- Appointment Booked, Not Interested, No Answer and Follow-Up,
-- so when the unassigned pool is thin a rep can wake up to fewer
-- than 150 leads (apex11 saw 148 on 2026-06-12).
--
-- Fix: add a FINAL guarantee step after the existing four — if the
-- batch is still short, pull from ANY of the rep's own leads
-- regardless of status (except Not Interested, which is permanent
-- do-not-contact) until the batch hits batch_size. As long as the
-- rep has ever been assigned 150 non-Not-Interested leads, the
-- batch is exactly 150 every day.
-- ============================================================

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

    -- 5. FINAL GUARANTEE: still short — pull from ANY of the rep's
    --    own leads except permanent Not Interested, so the batch is
    --    exactly batch_size whenever the rep has that many leads at
    --    all. Queue-managed leads picked up here keep their queue
    --    rows; re-dating them only makes them visible today.
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

    rep_id := rep.id;
    select count(*) into batch_count
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    return next;
  end loop;
end;
$$;
