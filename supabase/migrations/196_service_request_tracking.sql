-- 196 — Track a service request: 'other' as a kind, Fulfillment schedules and
-- finishes a request, the agent reads their own.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step. It
-- applies only after 193_servicing_model.sql: its first statement stops the whole
-- file if 193's view isn't there. agent_submit_service_request below is copied whole
-- from 193, its newest version, with only the lines named here changed. It works
-- whether 195_servicing_functions lands before or after it: servicing_task_notes,
-- agent_servicing_items, agent_submit_deal and the table comment are 195's and aren't
-- read or changed here. submit_live and every live switch stay as they are, and no
-- policy column, policy_events row beyond the RPC's own, text or notification is added.
--
-- Why: an agent can ask for help on any client's policy, including "other", without
-- using a weekly submission, then watch it go requested, scheduled with a date, done
-- with a real outcome. Until now Fulfillment could only change the status, so no app
-- role could set a date or say how it ended, and outcome only means how a lapse_save
-- ended. See brain/ohvara/Agent Portal Servicing Spec.md, section 3.
--
-- FRONTEND CONTRACT (the builders rely on these names):
--   table servicing_tasks
--     kind             the 12 from 180 plus other.
--     outcome_note     text, null until a request is finished. What the agent reads
--                      as the outcome, on every kind. Up to 1000 characters.
--     outcome          unchanged: saved, lapsed, client_cancelled. Only a lapse_save
--                      has one, and the stage reads it.
--   rpc agent_submit_service_request(p_policy, p_kind, p_note, p_best_time)
--     Same signature and refusals in the same order, and returns the task id. New:
--     kinds are beneficiary_change, address_change, payment_change,
--     draft_date_change, lapse_save, claim_help, carrier_call, other. other with a
--     blank note raises 22023 'Say what the client needs'. It never touches
--     agent_weekly_usage.
--   rpc fulfillment_schedule_request(p_task, p_at) returns nothing
--     Sets status scheduled and due_at = p_at. Works on a requested, scheduled
--     (reschedule) or in_progress request. Writes no event.
--   rpc fulfillment_finish_request(p_task, p_outcome_note, p_outcome default null)
--     returns nothing. Sets status done, outcome_note, outcome; the trigger stamps
--     done_at. Works on a requested, scheduled or in_progress request. Writes no event.
--     p_outcome is required on a lapse_save and refused on every other kind.
--   refusals of both, first match wins:
--     42501 'Only Fulfillment can do this'          not an active admin or rep
--     22023 'Pick a request'                        p_task is null
--     22023 'Pick a time in the future'             schedule: p_at null or not ahead
--     22023 'Say what happened'                     finish: note empty after trimming
--     22023 'Keep the outcome to 1000 characters'   finish: refused, not cut short
--     22023 'Unknown outcome <key>'                 finish: p_outcome not on the list
--     P0002 'Request not found'                     no such id, or across the demo wall
--     22023 'This is not a service request'         requested_by system
--     22023 'This request is closed'                done or cancelled
--     22023 'Only a lapse save has an outcome key'  finish: p_outcome on another kind
--     22023 'Say how the lapse save ended'          finish: lapse_save with no p_outcome
--   rpc agent_my_service_requests(p_policy default null)
--     The caller's own requests (requested_by agent or client), never a downline's and
--     never a system step, on one policy or all. Rows: id, policy_id, kind, status,
--     note, best_time, due_at, done_at, outcome, outcome_note, created_at, updated_at.
--     Newest first. Refuses nothing: someone else's policy gives no rows. policy_id is
--     null on a lead-only request.
--
-- Who can write servicing_tasks: the writers named on the table, these two functions
-- and the service role. Fulfillment's update (status) grant stays as it was.

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.policy_servicing_status') is null then
    raise exception '196 needs 193_servicing_model applied first';
  end if;
end $$;

-- ── 2. The kind list ────────────────────────────────────────────────────────
-- 180's inline check, the only version. No if exists: a wrong name stops the file
-- instead of leaving two checks.
alter table public.servicing_tasks drop constraint servicing_tasks_kind_check;
alter table public.servicing_tasks add constraint servicing_tasks_kind_check
  check (kind in (
    'packet_check', 'review_call', 'chargeback_watch', 'beneficiary_change',
    'address_change', 'payment_change', 'draft_date_change', 'lapse_save',
    'conversion', 'annual_review', 'claim_help', 'carrier_call', 'other'
  ));

-- ── 3. outcome_note ─────────────────────────────────────────────────────────
-- outcome keeps its check and its meaning, because the status view reads it.
alter table public.servicing_tasks add column outcome_note text;
comment on column public.servicing_tasks.outcome_note is 'What came of a request, in the team''s words. The agent reads it. Set by fulfillment_finish_request.';

-- ── 4. agent_submit_service_request ─────────────────────────────────────────
-- 193, with other on the kind list and refused with no note. The trim names every
-- whitespace character, because plain btrim strips only spaces. Same signature, same
-- refusals in the same order.
create or replace function public.agent_submit_service_request(
  p_policy    uuid,
  p_kind      text,
  p_note      text,
  p_best_time text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent     uuid := auth.uid();
  v_servicing boolean;
  v_name      text;
  v_id        uuid;
begin
  select has_servicing, coalesce(nullif(btrim(full_name), ''), 'Unknown') into v_servicing, v_name
    from profiles where id = v_agent and role = 'agent' and is_active;
  if not found then
    raise exception 'Only an agent can send a request' using errcode = '42501';
  end if;
  if not coalesce((select submit_live from app_settings where id = 1), false) then
    raise exception 'Submit is not live yet' using errcode = 'P0001', hint = 'not_live';
  end if;
  if not v_servicing then
    raise exception 'Servicing is not on your plan' using errcode = 'P0001', hint = 'no_servicing';
  end if;
  if not exists (select 1 from policies where id = p_policy and agent_id = v_agent) then
    raise exception 'Not your client' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('beneficiary_change', 'address_change', 'payment_change',
                                      'draft_date_change', 'lapse_save', 'claim_help', 'carrier_call', 'other') then
    raise exception 'Pick what the client needs' using errcode = '22023';
  end if;
  if p_kind = 'other' and nullif(btrim(coalesce(p_note, ''), E' \t\n\r\f\v'), '') is null then
    raise exception 'Say what the client needs' using errcode = '22023';
  end if;
  if p_best_time is not null and p_best_time not in ('morning', 'afternoon', 'evening') then
    raise exception 'Pick the best time to reach them' using errcode = '22023';
  end if;

  insert into servicing_tasks (agent_id, policy_id, kind, status, note, best_time, requested_by, requested_by_id)
  values (v_agent, p_policy, p_kind, 'requested', nullif(left(btrim(p_note), 1000), ''), p_best_time, 'agent', v_agent)
  returning id into v_id;

  -- The note isn't copied: events are read wider than the request itself.
  insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
  values (p_policy, v_agent, 'service_request', v_agent, v_name, 'agent',
          jsonb_build_object('label', 'Service request', 'request_id', v_id, 'request_kind', p_kind, 'best_time', p_best_time));

  return v_id;
end;
$$;

revoke all on function public.agent_submit_service_request(uuid, text, text, text) from public, anon;
grant execute on function public.agent_submit_service_request(uuid, text, text, text) to authenticated;

-- ── 5. Schedule a request ───────────────────────────────────────────────────
-- Both functions below open the same way. The role comes first, so a wrong caller
-- learns nothing about what exists. Definer skips RLS, including the restrictive
-- demo wall, so the wall is checked here, and a row across it reads as no row. Only
-- an open request moves: reopening a done one would leave done_at and outcome stale,
-- the view's saved_at doesn't check status, the trigger won't restamp done_at on a
-- second finish, and a second finish would overwrite the outcome.
create or replace function public.fulfillment_schedule_request(p_task uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  if not (public.is_admin() or public.is_fulfillment()) then
    raise exception 'Only Fulfillment can do this' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'Pick a request' using errcode = '22023';
  end if;
  if p_at is null or p_at <= now() then
    raise exception 'Pick a time in the future' using errcode = '22023';
  end if;

  select id, policy_id, requested_by, status into v_task
    from servicing_tasks where id = p_task
    for update;
  if not found
     or (v_task.policy_id is not null
         and public.policy_is_demo(v_task.policy_id) is distinct from public.my_is_demo()) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_task.requested_by not in ('agent', 'client') then
    raise exception 'This is not a service request' using errcode = '22023';
  end if;
  if v_task.status not in ('requested', 'scheduled', 'in_progress') then
    raise exception 'This request is closed' using errcode = '22023';
  end if;

  update servicing_tasks
     set status = 'scheduled', due_at = p_at
   where id = p_task;
end;
$$;

revoke all on function public.fulfillment_schedule_request(uuid, timestamptz) from public, anon;
grant execute on function public.fulfillment_schedule_request(uuid, timestamptz) to authenticated;

-- ── 6. Finish a request ─────────────────────────────────────────────────────
-- The note is required on every kind, because done (outcome) must show something.
-- The key is what the stage reads, so a lapse_save needs one and nothing else takes
-- one. done_at is the trigger's to stamp.
create or replace function public.fulfillment_finish_request(p_task uuid, p_outcome_note text, p_outcome text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_outcome_note, ''), E' \t\n\r\f\v'), '');
  v_task record;
begin
  if not (public.is_admin() or public.is_fulfillment()) then
    raise exception 'Only Fulfillment can do this' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'Pick a request' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'Say what happened' using errcode = '22023';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the outcome to 1000 characters' using errcode = '22023';
  end if;
  if p_outcome is not null and p_outcome not in ('saved', 'lapsed', 'client_cancelled') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;

  select id, policy_id, requested_by, status, kind into v_task
    from servicing_tasks where id = p_task
    for update;
  if not found
     or (v_task.policy_id is not null
         and public.policy_is_demo(v_task.policy_id) is distinct from public.my_is_demo()) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_task.requested_by not in ('agent', 'client') then
    raise exception 'This is not a service request' using errcode = '22023';
  end if;
  if v_task.status not in ('requested', 'scheduled', 'in_progress') then
    raise exception 'This request is closed' using errcode = '22023';
  end if;
  if v_task.kind <> 'lapse_save' and p_outcome is not null then
    raise exception 'Only a lapse save has an outcome key' using errcode = '22023';
  end if;
  if v_task.kind = 'lapse_save' and p_outcome is null then
    raise exception 'Say how the lapse save ended' using errcode = '22023';
  end if;

  update servicing_tasks
     set status = 'done', outcome_note = v_note, outcome = p_outcome
   where id = p_task;
end;
$$;

revoke all on function public.fulfillment_finish_request(uuid, text, text) from public, anon;
grant execute on function public.fulfillment_finish_request(uuid, text, text) to authenticated;

-- ── 7. The agent's own requests ─────────────────────────────────────────────
-- Security invoker, so servicing_tasks' RLS and demo wall apply. RLS would show an
-- upline their downline's too, so the agent_id line is what keeps this to the caller.
create or replace function public.agent_my_service_requests(p_policy uuid default null)
returns table (
  id           uuid,
  policy_id    uuid,
  kind         text,
  status       text,
  note         text,
  best_time    text,
  due_at       timestamptz,
  done_at      timestamptz,
  outcome      text,
  outcome_note text,
  created_at   timestamptz,
  updated_at   timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.policy_id, t.kind, t.status, t.note, t.best_time, t.due_at, t.done_at,
         t.outcome, t.outcome_note, t.created_at, t.updated_at
    from servicing_tasks t
   where t.agent_id = auth.uid()
     and t.requested_by in ('agent', 'client')
     and (p_policy is null or t.policy_id = p_policy)
   order by t.created_at desc, t.id desc;
$$;

revoke all on function public.agent_my_service_requests(uuid) from public, anon;
grant execute on function public.agent_my_service_requests(uuid) to authenticated;
