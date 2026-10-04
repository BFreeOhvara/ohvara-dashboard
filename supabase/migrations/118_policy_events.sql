-- Prompt 690 — agent Activity tab: a chronological log of what actually happened.
--
-- Until now `policies` only held CURRENT state (Prompt 689's derived status:
-- Booked / In progress / No answer / Rescheduling / Cancelled). A call that went
-- No answer → In progress → Rescheduling left nothing behind but the last
-- outcome and an attempt count. This adds an append-only event log, written by
-- a trigger so every path that changes a booking (rep desk RPCs, Mark cancelled,
-- pass-on, admin edits, the agent moving the time) is captured the same way and
-- nothing in the app has to remember to log.
--
-- What gets logged (one row each):
--   booked        the booking is created (or a row becomes fulfillment_assigned)
--   in_progress   a call went live
--   no_answer     a call ended, nobody picked up
--   rescheduling  a call ended, spoke to them, needs another call (detail.reason)
--   cancelled     the old policy is confirmed cancelled
--   booked again  (kind 'booked', from_status set) — a status went back to Booked
--   moved         the booked call time changed (detail.from / detail.to)
-- The status is derived exactly like stageOf() in src/lib/agentBookings.js, so
-- an event fires on a change of what the agent SEES, not on every column write.
--
-- Messages are NOT copied here — they already live in policy_messages; the
-- Activity page reads those directly and links into the thread.
--
-- Visibility: whoever can read the policy can read its events (the subquery
-- runs under policies RLS: agent → own + downline, admin → all, fulfillment →
-- assigned pool). No insert/update/delete policies: only the trigger writes.

create table if not exists public.policy_events (
  id           uuid primary key default gen_random_uuid(),
  policy_id    uuid not null references public.policies(id) on delete cascade,
  agent_id     uuid references public.profiles(id) on delete set null,
  kind         text not null check (kind in ('booked', 'in_progress', 'no_answer', 'rescheduling', 'cancelled', 'moved')),
  from_status  text,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text,
  actor_role   text,
  detail       jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);

create index if not exists policy_events_agent_at_idx on public.policy_events (agent_id, at desc);
create index if not exists policy_events_policy_idx on public.policy_events (policy_id, at);

alter table public.policy_events enable row level security;

drop policy if exists "policy_events_select" on public.policy_events;
create policy "policy_events_select" on public.policy_events
  for select using (exists (select 1 from public.policies p where p.id = policy_events.policy_id));

revoke insert, update, delete on public.policy_events from anon, authenticated;
grant select on public.policy_events to authenticated;

-- Same order of precedence as stageOf().
create or replace function public.policy_agent_status(
  p_stage text, p_live timestamptz, p_outcome text
) returns text
language sql
immutable
as $$
  select case
    when p_stage = 'Complete'       then 'cancelled'
    when p_live is not null         then 'in_progress'
    when p_outcome = 'no_answer'    then 'no_answer'
    when p_outcome = 'rescheduling' then 'rescheduling'
    else 'booked'
  end
$$;

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
      when 'rescheduling' then jsonb_build_object('reason', new.cancellation_substatus, 'attempt', new.call_attempts)
      when 'no_answer'    then jsonb_build_object('attempt', new.call_attempts)
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

-- AFTER, so it sees the row once the BEFORE triggers (stamp_cancellation_times,
-- autoassign) have finished with it.
drop trigger if exists policies_events_log on public.policies;
create trigger policies_events_log
  after insert or update on public.policies
  for each row execute function public.policy_events_log();

-- ── backfill ────────────────────────────────────────────────────────────────
-- Only what the existing timestamps can actually prove: the booking itself,
-- the most recent call outcome, a live call, and the cancellation. Intermediate
-- attempts before this migration were never recorded and are not invented.
-- Backfilled rows carry detail.backfilled = true and no actor.

insert into public.policy_events (policy_id, agent_id, kind, detail, at)
select id, agent_id, 'booked', jsonb_build_object('scheduled_call_at', scheduled_call_at, 'backfilled', true), created_at
from public.policies
where fulfillment_assigned
  and not exists (select 1 from public.policy_events e where e.policy_id = policies.id);

insert into public.policy_events (policy_id, agent_id, kind, detail, at)
select id, agent_id, last_call_outcome,
       jsonb_build_object('attempt', call_attempts, 'backfilled', true)
         || case when last_call_outcome = 'rescheduling' then jsonb_build_object('reason', cancellation_substatus) else '{}'::jsonb end,
       last_call_at
from public.policies
where fulfillment_assigned
  and last_call_outcome in ('no_answer', 'rescheduling')
  and last_call_at is not null
  and fulfillment_stage <> 'Complete';

insert into public.policy_events (policy_id, agent_id, kind, detail, at)
select id, agent_id, 'in_progress', jsonb_build_object('attempt', call_attempts, 'backfilled', true), call_live_since
from public.policies
where fulfillment_assigned and call_live_since is not null and fulfillment_stage <> 'Complete';

insert into public.policy_events (policy_id, agent_id, kind, detail, at)
select id, agent_id, 'cancelled', jsonb_build_object('confirmation', cancellation_confirmation, 'backfilled', true), fulfillment_completed_at
from public.policies
where fulfillment_assigned and fulfillment_stage = 'Complete' and fulfillment_completed_at is not null;
