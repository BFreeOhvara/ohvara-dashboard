-- ============================================================
-- Migration 028 — Per-rep niche scoping for lead assignment
--
-- Context: the locked 7-setter lineup assigns ONE niche per setter, but
-- nothing in the system scoped assignment by niche — profiles had no niche
-- column and assign_daily_batches pulled from the unassigned pool with no
-- niche filter, so every rep got a mixed bag of all niches.
--
-- LIVE PATH CONFIRMED (2026-06-16, pg_cron): the live assignment is the SQL
-- function assign_daily_batches(), scheduled as cron job 'daily-batch-assign'
-- ('5 0 * * *', 00:05 UTC) — last run succeeded. The similarly-named edge-fn
-- cron 'assign-daily-batch' (06:00, HTTP) is the failing ZOMBIE (separate
-- cleanup item) and is NOT touched here.
--
-- This migration:
--   1. adds profiles.niche (nullable text).
--   2. redefines assign_daily_batches so EVERY lead-selection step only
--      considers leads whose niche matches the rep's niche, case-insensitive.
--      The filter is a no-op when a rep's niche IS NULL, so unscoped accounts
--      (e.g. the apex11 test rep) keep their current all-niche behavior.
--
-- Steps 1-6 are otherwise identical to migration 025. With niche scoping the
-- "exactly batch_size" guarantee becomes "up to batch_size of the rep's own
-- niche" — a rep is never padded with off-niche leads. Setting each real
-- setter's profiles.niche happens at onboarding.
--
-- Note: lead niche values currently have case/synonym drift (e.g. "Towing"
-- vs "tow truck"); matching is case-insensitive but exact otherwise, so
-- onboarding should set profiles.niche to the canonical niche string used on
-- the leads. Synonym normalization is a separate data-cleanup item.
-- ============================================================

alter table profiles add column if not exists niche text;

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
    select id, niche from profiles where role = 'rep' and is_active = true
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
          and (rep.niche is null or lower(niche) = lower(rep.niche))
        order by batch_date desc
        limit needed
      );
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date;
    end if;

    -- 3. top up from the unassigned pool (niche-matched only)
    if needed > 0 then
      update leads set assigned_rep_id = rep.id, batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id is null and status = 'New'
          and (rep.niche is null or lower(niche) = lower(rep.niche))
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
          and (rep.niche is null or lower(niche) = lower(rep.niche))
        order by batch_date desc, updated_at desc
        limit needed
      );
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date;
    end if;

    -- 5. FINAL GUARANTEE (024): still short — pull from ANY of the rep's
    --    own leads except permanent Not Interested (niche-matched only).
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date is distinct from current_date
          and status <> 'Not Interested'
          and (rep.niche is null or lower(niche) = lower(rep.niche))
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
