-- Prompt 689 — final pipeline status model:
--   Booked → In progress (a call is live RIGHT NOW) → Cancelled | No answer | Rescheduling
-- "Not started" is gone: every booking is auto-assigned (migration 116), so there
-- is no "untouched" bucket distinct from Booked.
--
-- fulfillment_stage keeps its three values and everything that reads them
-- (RLS, the Complete notification, team performance, the activity feed):
--   Pending      never attempted      → agent sees Booked
--   In Progress  at least one attempt → agent sees one of the four below
--   Complete     cancelled
-- What the rep and agent actually see is derived from three new columns:
--   call_live_since    non-null ONLY while a call is happening right now
--   last_call_outcome  how the most recent finished call went:
--                      'no_answer' (nobody picked up) or 'rescheduling' (spoke to
--                      them, couldn't cancel this time, needs another call)
--   call_attempts      how many calls have been placed — so an attempt is never
--                      forgotten, even after the item loops back toward another call
--   last_call_at       when the most recent call ended (staleness of a retry)
-- No answer and Rescheduling stay their own status until the next call starts
-- (then it's live again, then resolves again) — folding them back into Booked
-- would lose the fact an attempt was already made.
--
-- cancellation_substatus (calling / waiting_carrier / waiting_client) used to be
-- an idle "in progress" sub-state. It is now only the optional reason on a
-- Rescheduling outcome (waiting_carrier | waiting_client); 'calling' is retired.
--
-- Liveness is rep-declared: there is no Twilio status callback today (the account
-- is on trial, never live-tested) and the plain tel: fallback can't report
-- anything, so "Call client" starts the live flag and the rep ends the call with
-- the outcome. Both go through RPCs so the times are server-stamped.

alter table public.policies
  add column if not exists call_live_since   timestamptz,
  add column if not exists last_call_outcome text,
  add column if not exists call_attempts     integer not null default 0,
  add column if not exists last_call_at      timestamptz;

do $$ begin
  alter table public.policies
    add constraint policies_last_call_outcome_check
    check (last_call_outcome is null or last_call_outcome in ('no_answer', 'rescheduling'));
exception when duplicate_object then null; end $$;

-- ── stamp: finishing a cancellation ends any live call ──────────────────────

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
      new.call_live_since := null;       -- resolved: nothing is live any more
      new.last_call_outcome := null;
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

-- ── start / end a call ──────────────────────────────────────────────────────

create or replace function public.fulfillment_start_call(p_policy uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then
    raise exception 'Only the rep it''s assigned to (or an admin) can call this client' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This one is already cancelled' using errcode = '22023';
  end if;
  -- Already live: a repeat tap on "Call client" is a harmless no-op.
  if pol.call_live_since is not null then
    return;
  end if;

  update policies
     set call_live_since        = now(),
         call_attempts          = call_attempts + 1,
         fulfillment_stage      = 'In Progress',
         cancellation_substatus = null
   where id = p_policy;
end;
$$;

revoke all on function public.fulfillment_start_call(uuid) from public, anon;
grant execute on function public.fulfillment_start_call(uuid) to authenticated;

-- Ends the live call as no_answer or rescheduling. (Cancelled is the existing
-- "Mark cancelled" update — the stamp trigger above clears the live flag.)
create or replace function public.fulfillment_end_call(
  p_policy  uuid,
  p_outcome text,
  p_reason  text default null     -- rescheduling only: waiting_carrier | waiting_client
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
begin
  if p_outcome not in ('no_answer', 'rescheduling') then
    raise exception 'Outcome must be no_answer or rescheduling' using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in ('waiting_carrier', 'waiting_client') then
    raise exception 'Unknown reason' using errcode = '22023';
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then
    raise exception 'Only the rep it''s assigned to (or an admin) can end this call' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This one is already cancelled' using errcode = '22023';
  end if;
  if pol.call_live_since is null then
    raise exception 'No call is live on this one' using errcode = '22023';
  end if;

  update policies
     set call_live_since        = null,
         last_call_outcome      = p_outcome,
         last_call_at           = now(),
         cancellation_substatus = case when p_outcome = 'rescheduling' then p_reason else null end
   where id = p_policy;
end;
$$;

revoke all on function public.fulfillment_end_call(uuid, text, text) from public, anon;
grant execute on function public.fulfillment_end_call(uuid, text, text) to authenticated;

-- Changing the rep-only reason on a call that has already ended as Rescheduling.
create or replace function public.fulfillment_set_reschedule_reason(p_policy uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
begin
  if p_reason is not null and p_reason not in ('waiting_carrier', 'waiting_client') then
    raise exception 'Unknown reason' using errcode = '22023';
  end if;
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then
    raise exception 'Only the rep it''s assigned to (or an admin) can change this' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' or pol.last_call_outcome is distinct from 'rescheduling' then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  update policies set cancellation_substatus = p_reason where id = p_policy;
end;
$$;

revoke all on function public.fulfillment_set_reschedule_reason(uuid, text) from public, anon;
grant execute on function public.fulfillment_set_reschedule_reason(uuid, text) to authenticated;

-- ── pass-on ends the old rep's call; the attempt history stays ──────────────

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
     set assigned_fulfillment_id = v_next, fulfillment_stage = 'Pending', cancellation_substatus = null,
         call_live_since = null,
         -- a call the old rep had live and never ended was an attempt nobody resolved
         last_call_outcome = case when pol.call_live_since is not null then 'no_answer' else pol.last_call_outcome end,
         last_call_at      = case when pol.call_live_since is not null then now() else pol.last_call_at end
   where id = p_policy;
  return v_next;
end;
$$;

revoke all on function public.fulfillment_pass_on(uuid) from public, anon;
grant execute on function public.fulfillment_pass_on(uuid) to authenticated;

-- ── backfill ────────────────────────────────────────────────────────────────

-- Items already "In Progress" under the old sticky meaning were attempted but
-- never resolved: they become Rescheduling (waiting on carrier/client keeps its
-- reason). Nothing is made live — there is no live call to point at.
update public.policies
   set last_call_outcome      = 'rescheduling',
       call_attempts          = greatest(call_attempts, 1),
       last_call_at           = coalesce(last_call_at, fulfillment_started_at, updated_at),
       cancellation_substatus = case when cancellation_substatus in ('waiting_carrier', 'waiting_client')
                                     then cancellation_substatus else null end
 where fulfillment_assigned
   and fulfillment_stage = 'In Progress'
   and last_call_outcome is null;
