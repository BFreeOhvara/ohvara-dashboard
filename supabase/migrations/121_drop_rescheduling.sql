-- Prompt 695 — "Rescheduling" is gone; it merges into "No answer".
--
-- A booked call either gets answered or it doesn't. Prompt 689 split the
-- "call connected but didn't resolve" outcome into its own Rescheduling status,
-- but it needs exactly the same remediation as a true no-answer (get the lead
-- back on the books and try again), so both now land on No answer.
--
-- policies.last_call_outcome is a TEXT column with a CHECK constraint (not a
-- native enum), so dropping a value is a constraint swap, not a type rebuild.
-- policy_events.kind is the same shape. Existing rows are moved first.
--
-- The optional reason (waiting_carrier | waiting_client) survives: it now hangs
-- off a No answer instead of a Rescheduling.

-- ── data: Rescheduling → No answer ──────────────────────────────────────────
-- The events trigger is paused for the backfill: it would log a phantom
-- "status changed" row for a change the agent never sees as a change.
alter table public.policies disable trigger policies_events_log;

update public.policies
   set last_call_outcome = 'no_answer'
 where last_call_outcome = 'rescheduling';

alter table public.policies enable trigger policies_events_log;

update public.policy_events set kind = 'no_answer' where kind = 'rescheduling';
update public.policy_events set from_status = 'no_answer' where from_status = 'rescheduling';

-- ── constraints ─────────────────────────────────────────────────────────────
alter table public.policies drop constraint if exists policies_last_call_outcome_check;
alter table public.policies
  add constraint policies_last_call_outcome_check
  check (last_call_outcome is null or last_call_outcome = 'no_answer');

alter table public.policy_events drop constraint if exists policy_events_kind_check;
alter table public.policy_events
  add constraint policy_events_kind_check
  check (kind in ('booked', 'in_progress', 'no_answer', 'cancelled', 'moved'));

-- ── derived status (mirrors stageOf() in src/lib/agentBookings.js) ──────────
create or replace function public.policy_agent_status(
  p_stage text, p_live timestamptz, p_outcome text
) returns text
language sql
immutable
as $$
  select case
    when p_stage = 'Complete'    then 'cancelled'
    when p_live is not null      then 'in_progress'
    when p_outcome = 'no_answer' then 'no_answer'
    else 'booked'
  end
$$;

-- ── activity log: no_answer carries the optional reason now ─────────────────
create or replace function public.policy_events_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_name   text;
  v_role   text;
  v_old    text;
  v_new    text;
  v_detail jsonb;
begin
  if not new.fulfillment_assigned then
    return new;
  end if;

  if v_actor is not null then
    select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
      into v_name, v_role
    from profiles where id = v_actor;
  end if;

  v_new := public.policy_agent_status(new.fulfillment_stage::text, new.call_live_since, new.last_call_outcome);

  if tg_op = 'INSERT' or not old.fulfillment_assigned then
    insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
    values (new.id, new.agent_id, 'booked', v_actor, v_name, v_role,
            jsonb_build_object('scheduled_call_at', new.scheduled_call_at));
    return new;
  end if;

  v_old := public.policy_agent_status(old.fulfillment_stage::text, old.call_live_since, old.last_call_outcome);

  if v_new is distinct from v_old then
    v_detail := case v_new
      when 'no_answer'    then jsonb_build_object('reason', new.cancellation_substatus, 'attempt', new.call_attempts)
      when 'in_progress'  then jsonb_build_object('attempt', new.call_attempts)
      when 'cancelled'    then jsonb_build_object('confirmation', new.cancellation_confirmation)
      else '{}'::jsonb
    end;
    insert into policy_events (policy_id, agent_id, kind, from_status, actor_id, actor_name, actor_role, detail)
    values (new.id, new.agent_id, v_new, v_old, v_actor, v_name, v_role, v_detail);
  end if;

  if new.scheduled_call_at is distinct from old.scheduled_call_at and v_new <> 'cancelled' then
    insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
    values (new.id, new.agent_id, 'moved', v_actor, v_name, v_role,
            jsonb_build_object('from', old.scheduled_call_at, 'to', new.scheduled_call_at));
  end if;

  return new;
end;
$$;

-- ── end a live call: every "not resolved" outcome is No answer ──────────────
-- 'rescheduling' is still accepted and mapped, so a browser tab running the
-- previous build keeps working through the deploy.
create or replace function public.fulfillment_end_call(
  p_policy  uuid,
  p_outcome text,
  p_reason  text default null     -- optional: waiting_carrier | waiting_client
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
    raise exception 'Outcome must be no_answer' using errcode = '22023';
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
         last_call_outcome      = 'no_answer',
         last_call_at           = now(),
         cancellation_substatus = p_reason
   where id = p_policy;
end;
$$;

revoke all on function public.fulfillment_end_call(uuid, text, text) from public, anon;
grant execute on function public.fulfillment_end_call(uuid, text, text) to authenticated;

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
  if pol.fulfillment_stage = 'Complete' or pol.last_call_outcome is distinct from 'no_answer' then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  update policies set cancellation_substatus = p_reason where id = p_policy;
end;
$$;

revoke all on function public.fulfillment_set_reschedule_reason(uuid, text) from public, anon;
grant execute on function public.fulfillment_set_reschedule_reason(uuid, text) to authenticated;

-- ── re-book a No answer lead ────────────────────────────────────────────────
-- Sets a new call time and puts the lead back on Booked, exactly like a first
-- booking: stage goes back to Pending (so autoassign re-checks which rep is free
-- at the new time), the last outcome and reason clear. call_attempts and
-- last_call_at are kept — the attempts already made are history, not reset.
create or replace function public.agent_rebook_call(p_policy uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
begin
  if p_at is null or p_at < now() - interval '5 minutes' then
    raise exception 'Pick a time in the future' using errcode = '22023';
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.agent_id = auth.uid()) then
    raise exception 'Only the agent who booked this (or an admin) can re-book it' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' or pol.call_live_since is not null
     or pol.last_call_outcome is distinct from 'no_answer' then
    raise exception 'Only a lead sitting on No answer can be re-booked' using errcode = '22023';
  end if;

  update policies
     set scheduled_call_at      = p_at,
         last_call_outcome      = null,
         cancellation_substatus = null,
         fulfillment_stage      = 'Pending'
   where id = p_policy;
end;
$$;

revoke all on function public.agent_rebook_call(uuid, timestamptz) from public, anon;
grant execute on function public.agent_rebook_call(uuid, timestamptz) to authenticated;
