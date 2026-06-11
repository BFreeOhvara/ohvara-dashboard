-- ============================================================
-- Migration 019 — Lead pipeline queues
--
-- Replaces the 4-hour No Answer requeue (017) with three routed
-- pipelines:
--   No Answer      → no_answer_queue, redistributed to a RANDOM
--                    active rep after 24h (hourly cron)
--   Follow-Up      → follow_up_queue, returns to the SAME rep at
--                    the rep-chosen datetime (same hourly cron)
--   Not Interested → permanent do-not-contact; row kept forever
--                    for scraper deduplication, never batched again
--
-- Status mapping note: the lead_status enum keeps its existing
-- Title Case values — new='New', called='Contacted',
-- no_answer='No Answer', follow_up='Follow-Up',
-- not_interested='Not Interested', booked='Booked'/'Appointment
-- Booked'. All required statuses already exist (015/017); no enum
-- changes needed.
-- ============================================================

-- ── 1. place_id on leads — Maps scraper dedup identifier ─────
alter table leads add column if not exists place_id text;
create index if not exists leads_place_id_idx on leads(place_id) where place_id is not null;

-- ── 2. no_answer_queue ───────────────────────────────────────
create table if not exists no_answer_queue (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references leads(id) on delete cascade,
  called_by_rep_id      uuid references profiles(id) on delete set null,
  called_at             timestamptz not null default now(),
  available_at          timestamptz not null default now() + interval '24 hours',
  distributed_at        timestamptz,
  distributed_to_rep_id uuid references profiles(id) on delete set null
);

create index if not exists no_answer_queue_available_idx
  on no_answer_queue(available_at) where distributed_at is null;

-- RLS: reps cannot see this table at all; admins and closers see everything.
-- Writes happen only inside SECURITY DEFINER trigger/cron functions.
alter table no_answer_queue enable row level security;
create policy naq_admin_closer_select on no_answer_queue
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('admin', 'closer')
    )
  );

-- ── 3. follow_up_queue ───────────────────────────────────────
create table if not exists follow_up_queue (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  rep_id       uuid references profiles(id) on delete set null,
  follow_up_at timestamptz not null,
  reason       text,
  reminded_at  timestamptz,
  completed_at timestamptz
);

create index if not exists follow_up_queue_due_idx
  on follow_up_queue(follow_up_at) where reminded_at is null and completed_at is null;
create index if not exists follow_up_queue_rep_idx on follow_up_queue(rep_id);

alter table follow_up_queue enable row level security;
create policy fuq_admin_closer_select on follow_up_queue
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('admin', 'closer')
    )
  );

-- ── 4. Pipeline trigger — replaces 017's set_no_answer_at ────
-- SECURITY DEFINER so the queue inserts bypass RLS (reps have no
-- queue policies; the trigger runs with owner rights).
create or replace function handle_lead_pipeline()
returns trigger
language plpgsql
security definer
as $$
begin
  -- No Answer: leave the rep's batch NOW, enter the 24h pool.
  -- (Replaces the old 4-hour same-rep requeue entirely.)
  if new.status = 'No Answer' and old.status is distinct from new.status then
    insert into no_answer_queue (lead_id, called_by_rep_id)
    values (new.id, new.assigned_rep_id);
    new.batch_date      := null;
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
    -- replace any still-pending queue rows for this lead
    delete from follow_up_queue
    where lead_id = new.id and reminded_at is null and completed_at is null;

    insert into follow_up_queue (lead_id, rep_id, follow_up_at, reason)
    values (new.id, new.assigned_rep_id, new.follow_up_at, new.follow_up_notes);

    new.batch_date := null;
  end if;

  return new;
end;
$$;

drop trigger if exists leads_no_answer_ts on leads;
drop trigger if exists leads_rep_outcome on leads;
create trigger leads_rep_outcome
  before update on leads
  for each row execute function handle_lead_pipeline();

drop function if exists set_no_answer_at();

-- ── 5. Hourly queue processor ────────────────────────────────
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

    update leads
    set assigned_rep_id = chosen, batch_date = current_date,
        status = 'New', no_answer_at = null
    where id = q.lead_id and status = 'No Answer';

    if found then
      update no_answer_queue
      set distributed_at = now(), distributed_to_rep_id = chosen
      where id = q.id;
      n_redis := n_redis + 1;
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
    where id = q.lead_id and status = 'Follow-Up';
    if found then n_fu := n_fu + 1; end if;
    update follow_up_queue set reminded_at = now() where id = q.id;
  end loop;

  redistributed := n_redis;
  followups_returned := n_fu;
  return next;
end;
$$;

do $$
begin
  perform cron.unschedule('process-lead-queues');
exception when others then
  null;
end;
$$;
select cron.schedule('process-lead-queues', '0 * * * *', 'select process_lead_queues()');

-- ── 6. Remove the old 4-hour requeue (replaced by section 5) ─
do $$
begin
  perform cron.unschedule('requeue-no-answer');
exception when others then
  null;
end;
$$;
drop function if exists requeue_no_answer_leads();

-- ── 7. Daily batch: queue-managed statuses never resurface ───
-- Same as 016 but step 4 (pool-dry fallback) now also excludes
-- 'Not Interested' (permanent), 'No Answer' and 'Follow-Up'
-- (queue-managed), and 'Appointment Booked'.
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
    select batch_size - count(*) into needed
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;

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
    end if;

    rep_id := rep.id;
    select count(*) into batch_count
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    return next;
  end loop;
end;
$$;
