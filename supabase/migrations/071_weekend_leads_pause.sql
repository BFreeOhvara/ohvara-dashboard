-- Migration 071 — Weekend lead-pause (opt-out default) + rep "Request Leads"
-- escape valve (Prompt 324)
--
-- Ask: don't auto-assign/reset leads to reps on weekends by default — give
-- reps the day off — but let a rep opt back in via Settings, and always give
-- reps a manual way to pull from the unassigned pool if they want to work
-- the weekend anyway.
--
-- 1. New per-rep opt-in flag, default OFF (matches "off by default").
alter table profiles
  add column if not exists weekend_leads_enabled boolean not null default false;

-- 2. assign_daily_batches() (016 -> 064 -> here): same 4-step body, only
--    change is a new weekend-skip check right after the existing "already
--    ran today" gate. Deliberately does NOT write
--    last_batch_assigned_local_date on a weekend skip — Monday's real run
--    still sees Friday's recorded date as distinct from Monday's and fires
--    normally, no separate "unpause" bookkeeping needed.
create or replace function assign_daily_batches(batch_size int default 150)
returns table (rep_id uuid, batch_count int)
language plpgsql
security definer
as $$
declare
  rep record;
  needed int;
  rep_local_date date;
  rep_local_dow int;
begin
  for rep in
    select id, timezone, last_batch_assigned_local_date, weekend_leads_enabled
    from profiles where role = 'rep' and is_active = true
  loop
    rep_local_date := (now() at time zone coalesce(rep.timezone, 'America/Chicago'))::date;

    -- Already ran for this rep's own local calendar day — skip entirely.
    continue when rep.last_batch_assigned_local_date is not distinct from rep_local_date;

    -- Weekend pause: skip assignment on the rep's own local Sat/Sun unless
    -- they've opted in. isodow: 1=Mon ... 6=Sat, 7=Sun.
    rep_local_dow := extract(isodow from rep_local_date);
    continue when rep_local_dow in (6, 7) and not coalesce(rep.weekend_leads_enabled, false);

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

    update profiles set last_batch_assigned_local_date = rep_local_date where id = rep.id;

    rep_id := rep.id;
    select count(*) into batch_count
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    return next;
  end loop;
end;
$$;

-- 3. Rep-facing "Request Leads" escape valve — adapts request_closer_leads
--    (054/056) rather than building a second mechanism. Differences from the
--    closer version: scoped to assigned_rep_id, capped against the rep's
--    CURRENT batch_date = current_date count (not an all-time total) against
--    the same 150 default batch_size assign_daily_batches uses, and writes
--    batch_date = current_date on the leads it grabs so useMyLeads' "latest
--    batch" lookup (src/hooks/useLeads.js) picks them up as today's batch
--    immediately, regardless of what the rep's stale weekend-skip batch_date
--    was.
create or replace function request_rep_leads(p_rep_id uuid, p_count int default 150)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_count int;
  v_allowed        int;
  v_assigned       int;
begin
  select count(*) into v_current_count
  from leads
  where assigned_rep_id = p_rep_id and batch_date = current_date;

  v_allowed := greatest(0, 150 - v_current_count);
  p_count   := least(greatest(p_count, 0), v_allowed);

  if p_count = 0 then
    return 0;
  end if;

  update leads
  set assigned_rep_id = p_rep_id, batch_date = current_date
  where id in (
    select id
    from leads
    where assigned_rep_id is null
      and assigned_closer_id is null
      and status = 'New'
    order by created_at asc
    limit p_count
  );

  get diagnostics v_assigned = row_count;
  return v_assigned;
end;
$$;

grant execute on function request_rep_leads(uuid, int) to authenticated;
