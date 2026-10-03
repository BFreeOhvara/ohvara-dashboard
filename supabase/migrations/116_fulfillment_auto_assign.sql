-- Prompt 684 — Fulfillment auto-assignment. Nobody "claims" a cancellation
-- any more: the moment an agent books a call, the database puts it on a rep's
-- desk.
--
-- Picking the rep (fulfillment_pick_rep), in order:
--   1. not double-booked — skip any rep who already has an open call within
--      30 minutes of this one (Book a call uses 30-minute slots). Per rep, not
--      per slot: two different reps can both have a 2:00 PM.
--   2. least loaded — fewest open (not yet cancelled) items on their desk.
--   3. longest since their last assignment — so ties rotate instead of
--      always landing on the same person.
-- If EVERY active rep already has a call in that window, the booking still
-- goes to the best of them (least loaded) rather than sitting unassigned
-- where nobody would see it. The desk flags the overlap so it's visible.
-- Least-loaded over round robin: round robin keeps handing work to a rep
-- who's buried in "waiting on carrier" items; load-first self-corrects.
--
-- Assigned is not the same as started. A newly assigned item stays
-- fulfillment_stage = 'Pending' (the agent still sees "Booked"); it becomes
-- 'In Progress' the first time the rep acts on it (calls the client, sets a
-- carrier status, saves notes). fulfillment_started_at records that moment,
-- server-stamped like the claim/complete times from migration 106.
-- fulfillment_claimed_at keeps its column name but now means "assigned at".
--
-- Also here:
--   * rescheduling a not-yet-started call re-checks the rep for the new time
--     (keeps the same rep if they're still free then).
--   * fulfillment_pass_on(policy) — the rep (or admin) hands an item to a
--     different rep. Replaces "Release to queue".
--   * fulfillment_assign_unassigned() — sweeps up anything left unassigned
--     (e.g. booked while no rep was active). The desk calls it on load.
--   * a `fulfillment_assigned` notification to the rep an item lands on.
--   * backfill: existing in-progress items get started_at = claimed_at, and
--     the currently unassigned ones are assigned now (no notifications).

alter table public.policies
  add column if not exists fulfillment_started_at timestamptz;

create index if not exists policies_fulfillment_rep_open_idx
  on public.policies (assigned_fulfillment_id, scheduled_call_at)
  where fulfillment_assigned and fulfillment_stage is distinct from 'Complete';

-- ── picking a rep ───────────────────────────────────────────────────────────

create or replace function public.fulfillment_pick_rep(
  p_at      timestamptz,
  p_policy  uuid default null,   -- the item being placed (ignored in the counts)
  p_exclude uuid default null,   -- a rep who must not get it (pass-on)
  p_prefer  uuid default null    -- keep this rep if they're still free (reschedule)
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with reps as (
    select id from profiles
    where role = 'fulfillment' and is_active
      and id is distinct from p_exclude
  ),
  stats as (
    select r.id,
      count(po.id) as load,
      count(po.id) filter (
        where p_at is not null and po.scheduled_call_at is not null
          and abs(extract(epoch from po.scheduled_call_at - p_at)) < 1800
      ) as conflicts,
      max(po.fulfillment_claimed_at) as last_assigned
    from reps r
    left join policies po
      on po.assigned_fulfillment_id = r.id
     and po.fulfillment_assigned
     and po.fulfillment_stage is distinct from 'Complete'
     and po.id is distinct from p_policy
    group by r.id
  )
  select id from stats
  order by (conflicts > 0),
           (p_prefer is not null and id = p_prefer) desc,
           load,
           last_assigned nulls first,
           id
  limit 1
$$;

revoke all on function public.fulfillment_pick_rep(timestamptz, uuid, uuid, uuid) from public, anon, authenticated;

-- ── assign on booking / reschedule ──────────────────────────────────────────

create or replace function public.fulfillment_autoassign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(new.fulfillment_assigned, false)
     or new.fulfillment_stage is not distinct from 'Complete' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_fulfillment_id is null then
      new.assigned_fulfillment_id := public.fulfillment_pick_rep(new.scheduled_call_at, new.id);
      if new.assigned_fulfillment_id is not null then
        new.fulfillment_claimed_at := now();
      end if;
    end if;
    return new;
  end if;

  -- UPDATE. Nothing open should sit unassigned while a rep exists.
  if new.assigned_fulfillment_id is null then
    new.assigned_fulfillment_id := public.fulfillment_pick_rep(new.scheduled_call_at, new.id);
  -- Rescheduled before the rep started it: re-check who's free at the new time.
  elsif new.scheduled_call_at is distinct from old.scheduled_call_at
        and new.fulfillment_stage = 'Pending' then
    new.assigned_fulfillment_id := coalesce(
      public.fulfillment_pick_rep(new.scheduled_call_at, new.id, null, new.assigned_fulfillment_id),
      new.assigned_fulfillment_id);
  end if;
  return new;
end;
$$;

-- Named to sort before policies_stamp_cancellation_times (BEFORE triggers run
-- alphabetically), so the stamp trigger sees the new assignee and sets
-- fulfillment_claimed_at on UPDATE.
drop trigger if exists policies_fulfillment_autoassign on public.policies;
create trigger policies_fulfillment_autoassign
  before insert or update on public.policies
  for each row execute function public.fulfillment_autoassign();

-- ── server-stamped times (extends migration 106) ────────────────────────────

create or replace function public.stamp_cancellation_times()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.assigned_fulfillment_id is distinct from old.assigned_fulfillment_id then
    if new.assigned_fulfillment_id is null then
      new.fulfillment_claimed_at := null;
      new.cancellation_substatus := null;
    else
      new.fulfillment_claimed_at := now();
    end if;
  end if;

  if new.fulfillment_stage is distinct from old.fulfillment_stage then
    if new.fulfillment_stage = 'Complete' then
      new.fulfillment_completed_at := now();
      new.cancellation_substatus := null;
      new.fulfillment_started_at := coalesce(old.fulfillment_started_at, now());
    elsif new.fulfillment_stage = 'In Progress' then
      new.fulfillment_completed_at := null;
      new.fulfillment_started_at := coalesce(old.fulfillment_started_at, now());
    else
      new.fulfillment_completed_at := null;
      new.fulfillment_started_at := null;
      new.cancellation_substatus := null;
    end if;
  else
    new.fulfillment_started_at := old.fulfillment_started_at;
  end if;

  return new;
end;
$$;

-- ── tell the rep ────────────────────────────────────────────────────────────

create or replace function public.fulfillment_assigned_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('ohvara.skip_assign_notify', true), '') = 'on' then
    return new;
  end if;
  if new.fulfillment_assigned
     and new.assigned_fulfillment_id is not null
     and new.fulfillment_stage is distinct from 'Complete'
     and (tg_op = 'INSERT' or new.assigned_fulfillment_id is distinct from old.assigned_fulfillment_id) then
    insert into notifications (profile_id, type, message, data)
    values (
      new.assigned_fulfillment_id, 'fulfillment_assigned',
      coalesce(nullif(trim(coalesce(new.client_first_name, '') || ' ' || coalesce(new.client_last_name, '')), ''), 'A client')
        || ' is on your desk.',
      jsonb_build_object('policy_id', new.id, 'link', '/fulfillment/desk?open=' || new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists policies_fulfillment_assigned_notify on public.policies;
create trigger policies_fulfillment_assigned_notify
  after insert or update of assigned_fulfillment_id on public.policies
  for each row execute function public.fulfillment_assigned_notify();

-- ── hand an item to another rep ─────────────────────────────────────────────

create or replace function public.fulfillment_pass_on(p_policy uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pol  policies;
  v_next uuid;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then
    raise exception 'Only the rep it''s assigned to (or an admin) can pass it on' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This one is already cancelled' using errcode = '22023';
  end if;

  v_next := public.fulfillment_pick_rep(pol.scheduled_call_at, pol.id, pol.assigned_fulfillment_id);
  if v_next is null then
    raise exception 'No other rep is available to take it' using errcode = 'P0001';
  end if;

  update policies
     set assigned_fulfillment_id = v_next, fulfillment_stage = 'Pending', cancellation_substatus = null
   where id = p_policy;
  return v_next;
end;
$$;

revoke all on function public.fulfillment_pass_on(uuid) from public, anon;
grant execute on function public.fulfillment_pass_on(uuid) to authenticated;

-- ── sweep up anything unassigned ────────────────────────────────────────────

create or replace function public.fulfillment_assign_unassigned()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  if not (public.is_admin() or public.is_fulfillment()) then
    return 0;
  end if;
  for r in
    select id from policies
    where fulfillment_assigned and assigned_fulfillment_id is null
      and fulfillment_stage is distinct from 'Complete'
    order by scheduled_call_at nulls last, created_at
    for update skip locked
  loop
    -- the autoassign trigger does the picking
    update policies set assigned_fulfillment_id = null where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.fulfillment_assign_unassigned() from public, anon;
grant execute on function public.fulfillment_assign_unassigned() to authenticated;

-- ── backfill ────────────────────────────────────────────────────────────────

-- The stamp trigger pins started_at to OLD when the stage doesn't change, so
-- the backfill runs with it switched off for this one statement.
alter table public.policies disable trigger policies_stamp_cancellation_times;
update public.policies
   set fulfillment_started_at = fulfillment_claimed_at
 where fulfillment_assigned and fulfillment_stage = 'In Progress'
   and fulfillment_started_at is null;
alter table public.policies enable trigger policies_stamp_cancellation_times;

do $$
declare r record;
begin
  perform set_config('ohvara.skip_assign_notify', 'on', true);
  for r in
    select id from public.policies
    where fulfillment_assigned and assigned_fulfillment_id is null
      and fulfillment_stage is distinct from 'Complete'
    order by scheduled_call_at nulls last, created_at
  loop
    update public.policies set assigned_fulfillment_id = null where id = r.id;
  end loop;
  perform set_config('ohvara.skip_assign_notify', 'off', true);
end $$;
