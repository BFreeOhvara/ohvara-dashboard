-- 200 — VA servicing queue: a VA picks up a client's step, works it, records what
-- happened and passes coverage or advice questions to the agent.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step. It
-- changes RLS, so the merge guard asks him. It applies only after
-- 193_servicing_model.sql and 195_servicing_functions.sql: its first statement stops
-- the whole file if either is missing, or 196, whose kind list and schedule function
-- this builds on. 196 and 202 are live, so this applies after them.
-- agent_activity_feed is copied whole from 202, policy_servicing_status from 193 and
-- fulfillment_schedule_request from 196, their newest versions, with only the lines
-- named below changed. policy_events_kind_check keeps every value from 187 and adds one.
-- No screen reads this yet. No text, call, pay line or rate here, and every live switch
-- stays off.
--
-- Why: Fulfillment Build Order, Lane A item 2. Until now any VA could read every task
-- and skip any status (193). A VA is unlicensed, so nothing here lets one record
-- advice: outcomes are closed lists with no free text, and a coverage or advice
-- question goes to the agent, with no answer field anywhere in the signature.
--
-- FRONTEND CONTRACT (the builders rely on these names):
--   table servicing_tasks, new columns
--     va_claimed_by, va_claim_expires_at   who is working it; 15 minutes, renewable.
--     cancel_reason                        why it was cancelled. Only here.
--     sent_to_agent_at, sent_reason, sent_question, sent_by
--                                          the question passed to the agent.
--                                          sent_to_agent_at set means it is waiting.
--     agent_reply_note, agent_replied_at   the agent's answer.
--     outcome is now one list per kind:
--       lapse_save                                 saved, lapsed, client_cancelled
--       packet_check                               delivered, not_delivered
--       review_call, annual_review, conversion     completed, not_reached
--       chargeback_watch                           on_time, missed
--       beneficiary_change, address_change, payment_change, draft_date_change,
--       claim_help, carrier_call, other            completed, could_not_complete
--   rpc va_servicing_queue()
--     task_id, policy_id, lead_id, kind, status, requested_by, due_at, best_time,
--     outcome, client_name, client_state, carrier, agent_name, mine (boolean),
--     claim_expires_at, client_phone, note, agent_reply_note. The last four are null
--     unless mine. Open tasks not with the agent and not on another VA's live claim.
--     Soonest due first, no date last, then created_at, id. Agent and client requests
--     are in the same list. A lead-only task takes name, phone and state from the lead.
--   rpc va_servicing_claim(p_task) returns the new expiry. In progress from here.
--     42501 role, 22004 null, P0002 not found, 55006 another VA, 22023 not in the queue.
--   rpc va_servicing_release(p_task) returns boolean. false: nothing of yours to free.
--     Admin frees anyone's.
--   rpc va_servicing_schedule(p_task, p_at) returns the new due_at. On your own live
--     claim or a free task, admin too; another VA's live claim is 55006, for admin as
--     well (admin can release it first). Requested becomes scheduled; on scheduled or
--     in_progress only due_at moves. The time must be in the future.
--   rpc va_servicing_outcome(p_task, p_outcome) returns the outcome. Again while open.
--   rpc va_servicing_done(p_task) returns done_at. Only from in_progress and only with
--     an outcome recorded, on every kind and for admin too, who must claim a requested
--     or scheduled task first. Otherwise a lapse_save could end with no outcome and the
--     client would silently leave needs_attention. Clears the claim.
--   rpc va_servicing_cancel(p_task, p_reason). Reason required, trimmed, 500 at most.
--   rpc va_servicing_send_to_agent(p_task, p_reason, p_question) returns
--     sent_to_agent_at. p_reason is a key: coverage, advice, other. p_question required,
--     trimmed, 1000 at most. Drops the claim, keeps the status, clears any older reply.
--   rpc agent_servicing_clear_sent(p_task, p_note) returns agent_replied_at. Only the
--     task's own agent; the same 42501 for anyone else and for a task that isn't there.
--     Note required, 1000 at most. 22023 if it isn't sent. Back in the queue, unclaimed.
--   outcome, done, cancel and send need the caller's live claim, except admin (42501).
--   On done, cancelled and sent tasks they, schedule and claim all refuse with 22023,
--   for everyone. Over-long text is refused, not cut short. Empty is 22023 too.
--   view policy_servicing_status: same columns, order and types. A task sent to the
--     agent reads needs_attention with next_step = its kind; ended still wins. The view
--     is for agents and admin. A VA reads the queue, because a VA's RLS hides tasks
--     from the view, so its stage would be wrong for them.
--   agent_activity_feed: same signature and grants. kind servicing, title = the label.
--     The done event is skipped, because the servicing_done row already shows it.
--   rpc fulfillment_schedule_request, fulfillment_finish_request (196): same names and
--     signatures, admin only now. 42501 'Only an admin can do this' for everyone else;
--     22023 'This request is with the agent' on a task sent to the agent. On in_progress
--     schedule moves only due_at, because a move back to scheduled is refused.
--   rpc agent_my_service_requests (196), unchanged. The agent reads outcome on a
--     VA-worked request, and outcome_note only when an admin finished the request.
--
-- THIS REPLACES THE FULFILLMENT PATH PLANNED IN 196. fulfillment_finish_request let any
-- VA finish a request from any open state, with no claim, in free text the agent reads.
-- That breaks the no-skipping rule and the unlicensed VA rule, so both of 196's functions
-- are admin only here and VAs use only va_servicing_*. No screen calls them yet. Until
-- this file is applied, 196 is live and a VA can still call them through the API.
--
-- A VA'S DIRECT READ IS THEIR OWN LIVE CLAIM ONLY. That is narrower than the scope's
-- "own + unclaimed", on purpose: the row holds the note and servicing_task_notes inherit
-- task reads (195), so a direct read of a free row would expose what the queue hides.
-- Free tasks are reached only through va_servicing_queue, with phone and note empty.
-- Agent and admin reads stay exactly as in 193. Nobody signed in can update the table:
-- the functions are the only way to write.
--
-- IN PROGRESS STICKS. Release and claim expiry leave in_progress as it is, because
-- backward moves are refused (Eagle's rule). So a claim on a step due in 30 days reads
-- 'In progress' to the agent, even after the VA let it go. It stays in the queue.
--
-- ORDER. A new trigger, for every caller including the owner and service role: requested
-- < scheduled < in_progress < done, cancelled from any open state, no move back, done and
-- cancelled final, no outcome change on either. It allows forward jumps, because server
-- jobs use them. The no-skipping rule for VAs lives in the functions.
--
-- THE SIDE RULE, in servicing_task_is_demo_side: demo side when the task, its policy or
-- its lead is_sample; or it has a policy and policies.is_demo; or it has no policy and
-- the task's agent is_demo. A wrong-side task is refused exactly like a missing one,
-- for admin too. 193's servicing_tasks_demo_wall stays as it is, so agent and admin
-- reads don't change. Two things follow, both only for sample rows on a non-demo agent:
-- that agent can't clear a sent one (add_servicing_note's refusal), and a demo VA's
-- direct read can't see one on a policy, though the queue shows it.
--
-- EVENTS. schedule, outcome, done, cancel, send and clear each write one row, kind
-- servicing, detail { label, action, task_id, task_kind, outcome }, label from a fixed
-- list. Claim and release write none. The question, cancel reason, agent's note and task
-- note stay on the task: events are read wider than the task, and the feed passes
-- detail.reason through without removing phone numbers, so no detail key is named reason.
-- A lead-only task has no policy_events row to write (policy_id is not null), so it
-- writes inbound_events kind note, state done, with the same label and the same detail
-- plus note = the label: the lead page's Notes card prints detail.note, and a row
-- without it would be blank. It is the fixed words, never free text.
--
-- THE NOTICE. Send calls notify(agent, 'needs_attention', ...) with the key
-- servicing_sent:<task>:<epoch of sent_to_agent_at>, because notify() drops a repeat key
-- without error, so a key per task would give no second bell on send, clear, send.
-- needs_attention also emails agents who opted in (146, email_via 'notify'). The question
-- isn't in the notice. A lead-only task gets the notice and no stage change: it has no
-- view row. A demo VA on a sample row of a non-demo agent gets no notice (P775). Clear
-- marks that one notice read with needs_action off, found by the same key.
--
-- Who can write servicing_tasks: set_inbound_outcome, agent_submit_service_request,
-- agent_submit_deal, fulfillment_schedule_request, fulfillment_finish_request, the
-- va_servicing_* functions, agent_servicing_clear_sent and the service role. 196's line
-- that Fulfillment keeps its update (status) grant no longer holds. If a row's outcome breaks the new list the constraint stops the whole
-- file; no writer could set one before this, except the service role.

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.policy_servicing_status') is null then
    raise exception '200 needs 193_servicing_model applied first';
  end if;
  if to_regclass('public.servicing_task_notes') is null then
    raise exception '200 needs 195_servicing_functions applied first';
  end if;
  if to_regprocedure('public.fulfillment_schedule_request(uuid, timestamptz)') is null then
    raise exception '200 needs 196_service_request_tracking applied first';
  end if;
end $$;

-- ── 2. servicing_tasks ──────────────────────────────────────────────────────
alter table public.servicing_tasks
  add column va_claimed_by uuid references public.profiles(id) on delete set null,
  add column va_claim_expires_at timestamptz,
  add column cancel_reason text,
  add column sent_to_agent_at timestamptz,
  add column sent_reason text check (sent_reason in ('coverage', 'advice', 'other')),
  add column sent_question text,
  add column sent_by uuid references public.profiles(id) on delete set null,
  add column agent_reply_note text,
  add column agent_replied_at timestamptz;

create index if not exists servicing_tasks_open_due_idx
  on public.servicing_tasks (due_at)
  where status in ('requested', 'scheduled', 'in_progress');

alter table public.servicing_tasks drop constraint if exists servicing_tasks_outcome_check;
alter table public.servicing_tasks add constraint servicing_tasks_outcome_check check (
  outcome is null or case
    when kind = 'lapse_save' then outcome in ('saved', 'lapsed', 'client_cancelled')
    when kind = 'packet_check' then outcome in ('delivered', 'not_delivered')
    when kind in ('review_call', 'annual_review', 'conversion') then outcome in ('completed', 'not_reached')
    when kind = 'chargeback_watch' then outcome in ('on_time', 'missed')
    when kind in ('beneficiary_change', 'address_change', 'payment_change', 'draft_date_change',
                  'claim_help', 'carrier_call', 'other') then outcome in ('completed', 'could_not_complete')
    else false
  end
);

comment on table public.servicing_tasks is
  'Every servicing step and every request on a client. Written only by set_inbound_outcome, agent_submit_service_request, agent_submit_deal, fulfillment_schedule_request, fulfillment_finish_request, the va_servicing_* functions, agent_servicing_clear_sent and the service role. A request doesn''t count against the weekly cap.';
comment on column public.servicing_tasks.outcome is
  'How the step ended, one closed list per kind (migration 200). A lapse_save: saved, lapsed or client_cancelled.';
comment on column public.servicing_tasks.outcome_note is
  'An admin''s words on how a request ended, set only by fulfillment_finish_request. The agent reads outcome on a VA-worked request, and this only when an admin finished the request.';
comment on column public.servicing_tasks.cancel_reason is 'Why it was cancelled. Never copied into an event.';
comment on column public.servicing_tasks.sent_to_agent_at is 'Set while a question waits on the agent.';
comment on column public.servicing_tasks.sent_question is 'The VA''s question for the agent. Never copied into an event or a notice.';
comment on column public.servicing_tasks.agent_reply_note is 'The agent''s answer. Never copied into an event.';

-- ── 3. The status order ─────────────────────────────────────────────────────
-- Separate from servicing_tasks_touch, which still sets done_at. No exception for any
-- caller. It allows forward jumps: owner fixtures and server jobs use them.
create or replace function public.servicing_tasks_status_order()
returns trigger language plpgsql set search_path = public as $$
declare
  v_order constant text[] := array['requested', 'scheduled', 'in_progress', 'done'];
begin
  if old.status in ('done', 'cancelled') then
    if new.status is distinct from old.status then
      raise exception 'A % step is final', old.status using errcode = '22023';
    end if;
    if new.outcome is distinct from old.outcome then
      raise exception 'The outcome of a % step can''t change', old.status using errcode = '22023';
    end if;
  elsif new.status <> 'cancelled'
        and array_position(v_order, new.status) < array_position(v_order, old.status) then
    raise exception 'A step can''t move back from % to %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.servicing_tasks_status_order() from public, anon, authenticated;

drop trigger if exists servicing_tasks_status_order on public.servicing_tasks;
create trigger servicing_tasks_status_order
  before update on public.servicing_tasks
  for each row execute function public.servicing_tasks_status_order();

-- ── 3b. 196's two functions, admin only ──────────────────────────────────────
-- Each is 196's whole, with the role check and its refusal changed to admin, and a
-- 22023 refusal added for a task sent to the agent, so admin can't answer around the
-- agent either. Schedule has one more changed line: the trigger above refuses
-- in_progress back to scheduled, so it moves requested to scheduled and otherwise only
-- changes due_at. The grant to authenticated stays: the function does the refusing.
create or replace function public.fulfillment_schedule_request(p_task uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can do this' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'Pick a request' using errcode = '22023';
  end if;
  if p_at is null or p_at <= now() then
    raise exception 'Pick a time in the future' using errcode = '22023';
  end if;

  select id, policy_id, requested_by, status, sent_to_agent_at into v_task
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
  if v_task.sent_to_agent_at is not null then
    raise exception 'This request is with the agent' using errcode = '22023';
  end if;

  update servicing_tasks
     set status = case when status = 'requested' then 'scheduled' else status end, due_at = p_at
   where id = p_task;
end;
$$;

revoke all on function public.fulfillment_schedule_request(uuid, timestamptz) from public, anon;
grant execute on function public.fulfillment_schedule_request(uuid, timestamptz) to authenticated;

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
  if not public.is_admin() then
    raise exception 'Only an admin can do this' using errcode = '42501';
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

  select id, policy_id, requested_by, status, kind, sent_to_agent_at into v_task
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
  if v_task.sent_to_agent_at is not null then
    raise exception 'This request is with the agent' using errcode = '22023';
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

-- ── 4. The side rule ────────────────────────────────────────────────────────
-- Never policy_is_demo(null): it returns the caller's own side, so it walls nothing.
-- Granted to authenticated because RLS calls it. Null for a task that isn't there.
create or replace function public.servicing_task_is_demo_side(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select t.is_sample
         or coalesce(p.is_sample, false)
         or coalesce(l.is_sample, false)
         or case when t.policy_id is not null then coalesce(p.is_demo, false)
                 else coalesce(a.is_demo, false) end
    from servicing_tasks t
    left join policies p on p.id = t.policy_id
    left join leads l on l.id = t.lead_id
    left join profiles a on a.id = t.agent_id
   where t.id = p_task
$$;
revoke all on function public.servicing_task_is_demo_side(uuid) from public, anon;
grant execute on function public.servicing_task_is_demo_side(uuid) to authenticated;

-- ── 5. Two private helpers ──────────────────────────────────────────────────
-- Nobody signed in can call these. Each caller below checks the role first.
-- The row a write acts on, locked: the wall, the closed and sent refusals, the claim.
create or replace function public.servicing_task_for_write(p_task uuid, p_need_claim boolean default true)
returns public.servicing_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task servicing_tasks;
begin
  select * into v_task from servicing_tasks where id = p_task for update;
  if not found or public.servicing_task_is_demo_side(p_task) is distinct from public.my_is_demo() then
    raise exception 'Step not found' using errcode = 'P0002';
  end if;
  if v_task.status in ('done', 'cancelled') then
    raise exception 'This step is closed' using errcode = '22023';
  end if;
  if v_task.sent_to_agent_at is not null then
    raise exception 'This step is with the agent' using errcode = '22023';
  end if;
  if p_need_claim and not public.is_admin()
     and not coalesce(v_task.va_claimed_by = auth.uid() and v_task.va_claim_expires_at > now(), false) then
    raise exception 'Take this step first (a claim lasts 15 minutes)' using errcode = '42501';
  end if;
  return v_task;
end;
$$;
revoke all on function public.servicing_task_for_write(uuid, boolean) from public, anon, authenticated;

-- One event per action. Only fixed words go in: see EVENTS above.
create or replace function public.servicing_task_log(p_task public.servicing_tasks, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_role   text;
  v_label  text := case p_action
                     when 'scheduled' then 'Servicing task scheduled.'
                     when 'outcome'   then 'Servicing result recorded.'
                     when 'done'      then 'Servicing task done.'
                     when 'cancelled' then 'Servicing task cancelled.'
                     when 'sent'      then 'Servicing task sent to the agent.'
                     when 'cleared'   then 'Agent answered a servicing task.'
                   end;
  v_detail jsonb;
begin
  if v_label is null then
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text into v_name, v_role
    from profiles where id = v_uid;
  v_detail := jsonb_build_object('label', v_label, 'action', p_action, 'task_id', p_task.id,
                                 'task_kind', p_task.kind, 'outcome', p_task.outcome);

  if p_task.policy_id is not null then
    insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
    values (p_task.policy_id, p_task.agent_id, 'servicing', v_uid, v_name, v_role, v_detail);
  else
    insert into inbound_events (lead_id, agent_id, kind, state, label, detail, actor_id, actor_name, actor_role)
    values (p_task.lead_id, p_task.agent_id, 'note', 'done', v_label,
            v_detail || jsonb_build_object('note', v_label), v_uid, v_name, v_role);
  end if;
end;
$$;
revoke all on function public.servicing_task_log(public.servicing_tasks, text) from public, anon, authenticated;

-- ── 6. The queue ────────────────────────────────────────────────────────────
create or replace function public.va_servicing_queue()
returns table (
  task_id          uuid,
  policy_id        uuid,
  lead_id          uuid,
  kind             text,
  status           text,
  requested_by     text,
  due_at           timestamptz,
  best_time        text,
  outcome          text,
  client_name      text,
  client_state     text,
  carrier          text,
  agent_name       text,
  mine             boolean,
  claim_expires_at timestamptz,
  client_phone     text,
  note             text,
  agent_reply_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can see the servicing queue' using errcode = '42501';
  end if;

  return query
  select t.id, t.policy_id, t.lead_id, t.kind, t.status, t.requested_by, t.due_at, t.best_time, t.outcome,
         coalesce(nullif(btrim(concat_ws(' ', p.client_first_name, p.client_last_name)), ''),
                  nullif(btrim(l.contact_name), ''),
                  nullif(btrim(l.business_name), '')),
         coalesce(p.state, l.state),
         coalesce(p.new_carrier_name, p.carrier_name),
         a.full_name,
         m.mine,
         case when m.mine then t.va_claim_expires_at end,
         case when m.mine then coalesce(p.client_phone, l.phone) end,
         case when m.mine then t.note end,
         case when m.mine then t.agent_reply_note end
    from servicing_tasks t
    left join policies p on p.id = t.policy_id
    left join leads l on l.id = t.lead_id
    left join profiles a on a.id = t.agent_id
   cross join lateral (
     select coalesce(t.va_claimed_by = v_uid and t.va_claim_expires_at > now(), false) as mine
   ) m
   where t.status in ('requested', 'scheduled', 'in_progress')
     and t.sent_to_agent_at is null
     and (t.va_claimed_by is null
          or t.va_claimed_by = v_uid
          or t.va_claim_expires_at is null
          or t.va_claim_expires_at <= now())
     and public.servicing_task_is_demo_side(t.id) = public.my_is_demo()
   order by t.due_at asc nulls last, t.created_at, t.id;
end;
$$;
revoke all on function public.va_servicing_queue() from public, anon;
grant execute on function public.va_servicing_queue() to authenticated;

-- ── 7. Claim and release ────────────────────────────────────────────────────
-- 175's va_claim: one update with the claim test in its WHERE, so two VAs can't both
-- win. Claiming your own again renews it. Writes no event.
create or replace function public.va_servicing_claim(p_task uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_until timestamptz;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can take a step' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;

  update servicing_tasks t
     set va_claimed_by = v_uid,
         va_claim_expires_at = now() + interval '15 minutes',
         status = 'in_progress'
   where t.id = p_task
     and t.status in ('requested', 'scheduled', 'in_progress')
     and t.sent_to_agent_at is null
     and public.servicing_task_is_demo_side(t.id) = public.my_is_demo()
     and (t.va_claimed_by is null
          or t.va_claimed_by = v_uid
          or t.va_claim_expires_at is null
          or t.va_claim_expires_at <= now())
  returning t.va_claim_expires_at into v_until;

  if v_until is null then
    if public.servicing_task_is_demo_side(p_task) is distinct from public.my_is_demo() then
      raise exception 'Step not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from servicing_tasks
                where id = p_task and va_claimed_by <> v_uid and va_claim_expires_at > now()) then
      raise exception 'Another VA is on this step' using errcode = '55006';
    end if;
    raise exception 'This step is not in the queue' using errcode = '22023';
  end if;
  return v_until;
end;
$$;
revoke all on function public.va_servicing_claim(uuid) from public, anon;
grant execute on function public.va_servicing_claim(uuid) to authenticated;

-- Gives your own claim back (admin can free anyone's). A wrong-side task answers like a
-- missing one: false. The status stays, because backward moves are refused.
create or replace function public.va_servicing_release(p_task uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can release a step' using errcode = '42501';
  end if;
  update servicing_tasks
     set va_claimed_by = null, va_claim_expires_at = null
   where id = p_task
     and va_claimed_by is not null
     and (va_claimed_by = auth.uid() or public.is_admin())
     and public.servicing_task_is_demo_side(id) = public.my_is_demo();
  return found;
end;
$$;
revoke all on function public.va_servicing_release(uuid) from public, anon;
grant execute on function public.va_servicing_release(uuid) to authenticated;

-- ── 8. Schedule ─────────────────────────────────────────────────────────────
-- Needs no claim, because a claim would already have moved a requested task on.
create or replace function public.va_servicing_schedule(p_task uuid, p_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task servicing_tasks;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can schedule a step' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;
  if p_at is null or p_at <= now() then
    raise exception 'Pick a time in the future' using errcode = '22023';
  end if;

  v_task := public.servicing_task_for_write(p_task, false);
  if v_task.va_claimed_by <> auth.uid() and v_task.va_claim_expires_at > now() then
    raise exception 'Another VA is on this step' using errcode = '55006';
  end if;

  update servicing_tasks
     set due_at = p_at,
         status = case when status = 'requested' then 'scheduled' else status end
   where id = p_task
  returning * into v_task;

  perform public.servicing_task_log(v_task, 'scheduled');
  return v_task.due_at;
end;
$$;
revoke all on function public.va_servicing_schedule(uuid, timestamptz) from public, anon;
grant execute on function public.va_servicing_schedule(uuid, timestamptz) to authenticated;

-- ── 9. Outcome, done, cancel ────────────────────────────────────────────────
create or replace function public.va_servicing_outcome(p_task uuid, p_outcome text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task servicing_tasks;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can record an outcome' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;

  v_task := public.servicing_task_for_write(p_task);
  if p_outcome is null or not (case
       when v_task.kind = 'lapse_save' then p_outcome in ('saved', 'lapsed', 'client_cancelled')
       when v_task.kind = 'packet_check' then p_outcome in ('delivered', 'not_delivered')
       when v_task.kind in ('review_call', 'annual_review', 'conversion') then p_outcome in ('completed', 'not_reached')
       when v_task.kind = 'chargeback_watch' then p_outcome in ('on_time', 'missed')
       else p_outcome in ('completed', 'could_not_complete')
     end) then
    raise exception 'That outcome doesn''t fit this step' using errcode = '22023';
  end if;

  update servicing_tasks set outcome = p_outcome where id = p_task returning * into v_task;

  perform public.servicing_task_log(v_task, 'outcome');
  return v_task.outcome;
end;
$$;
revoke all on function public.va_servicing_outcome(uuid, text) from public, anon;
grant execute on function public.va_servicing_outcome(uuid, text) to authenticated;

-- The no-skipping rule. It holds for admin too.
create or replace function public.va_servicing_done(p_task uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task servicing_tasks;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can finish a step' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;

  v_task := public.servicing_task_for_write(p_task);
  if v_task.status <> 'in_progress' then
    raise exception 'Take this step before finishing it' using errcode = '22023';
  end if;
  if v_task.outcome is null then
    raise exception 'Record the outcome first' using errcode = '22023';
  end if;

  update servicing_tasks
     set status = 'done', va_claimed_by = null, va_claim_expires_at = null
   where id = p_task
  returning * into v_task;

  perform public.servicing_task_log(v_task, 'done');
  return v_task.done_at;
end;
$$;
revoke all on function public.va_servicing_done(uuid) from public, anon;
grant execute on function public.va_servicing_done(uuid) to authenticated;

create or replace function public.va_servicing_cancel(p_task uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\n\r\f\v'), '');
  v_task   servicing_tasks;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can cancel a step' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;
  if v_reason is null then
    raise exception 'Say why it is cancelled' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters' using errcode = '22023';
  end if;

  v_task := public.servicing_task_for_write(p_task);

  update servicing_tasks
     set status = 'cancelled', cancel_reason = v_reason, va_claimed_by = null, va_claim_expires_at = null
   where id = p_task
  returning * into v_task;

  perform public.servicing_task_log(v_task, 'cancelled');
end;
$$;
revoke all on function public.va_servicing_cancel(uuid, text) from public, anon;
grant execute on function public.va_servicing_cancel(uuid, text) to authenticated;

-- ── 10. Send to the agent ───────────────────────────────────────────────────
-- clock_timestamp(), not now(): the key below must differ on a second send inside one
-- transaction, where now() doesn't move.
create or replace function public.va_servicing_send_to_agent(p_task uuid, p_reason text, p_question text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question text := nullif(btrim(coalesce(p_question, ''), E' \t\n\r\f\v'), '');
  v_task     servicing_tasks;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can send a step to the agent' using errcode = '42501';
  end if;
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;
  if p_reason is null or p_reason not in ('coverage', 'advice', 'other') then
    raise exception 'Pick why it goes to the agent' using errcode = '22023';
  end if;
  if v_question is null then
    raise exception 'Write the question first' using errcode = '22023';
  end if;
  if length(v_question) > 1000 then
    raise exception 'Keep the question to 1000 characters' using errcode = '22023';
  end if;

  v_task := public.servicing_task_for_write(p_task);

  update servicing_tasks
     set sent_to_agent_at = clock_timestamp(),
         sent_reason = p_reason,
         sent_question = v_question,
         sent_by = auth.uid(),
         agent_reply_note = null,
         agent_replied_at = null,
         va_claimed_by = null,
         va_claim_expires_at = null
   where id = p_task
  returning * into v_task;

  perform public.servicing_task_log(v_task, 'sent');

  perform public.notify(
    v_task.agent_id, 'needs_attention', 'A client needs your answer',
    case p_reason when 'coverage' then 'A coverage question is waiting on you'
                  when 'advice' then 'An advice question is waiting on you'
                  else 'A question is waiting on you' end,
    '/agent/clients?stage=needs', true,
    'servicing_sent:' || p_task::text || ':' || extract(epoch from v_task.sent_to_agent_at)::text,
    jsonb_build_object('policy_id', v_task.policy_id, 'task_id', p_task));

  return v_task.sent_to_agent_at;
end;
$$;
revoke all on function public.va_servicing_send_to_agent(uuid, text, text) from public, anon;
grant execute on function public.va_servicing_send_to_agent(uuid, text, text) to authenticated;

-- ── 11. The agent answers ───────────────────────────────────────────────────
-- add_servicing_note's refusal: upline, Fulfillment, admin, the wrong side and a task
-- that doesn't exist all get the same answer.
create or replace function public.agent_servicing_clear_sent(p_task uuid, p_note text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\n\r\f\v'), '');
  v_task servicing_tasks;
  v_key  text;
begin
  if p_task is null then
    raise exception 'task is required' using errcode = '22004';
  end if;
  if v_note is null then
    raise exception 'Write the note first' using errcode = '22023';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note to 1000 characters' using errcode = '22023';
  end if;

  select * into v_task from servicing_tasks where id = p_task for update;
  if not found
     or v_task.agent_id is distinct from v_uid
     or not exists (select 1 from profiles where id = v_uid and is_active)
     or public.servicing_task_is_demo_side(p_task) is distinct from public.my_is_demo() then
    raise exception 'Only this client''s agent can answer this' using errcode = '42501';
  end if;
  if v_task.sent_to_agent_at is null then
    raise exception 'This step isn''t waiting on you' using errcode = '22023';
  end if;
  v_key := 'servicing_sent:' || p_task::text || ':' || extract(epoch from v_task.sent_to_agent_at)::text;

  update servicing_tasks
     set agent_reply_note = v_note, agent_replied_at = now(), sent_to_agent_at = null
   where id = p_task
  returning * into v_task;

  update notifications
     set needs_action = false, read = true, read_at = coalesce(read_at, now())
   where profile_id = v_uid and dedupe_key = v_key;

  perform public.servicing_task_log(v_task, 'cleared');
  return v_task.agent_replied_at;
end;
$$;
revoke all on function public.agent_servicing_clear_sent(uuid, text) from public, anon;
grant execute on function public.agent_servicing_clear_sent(uuid, text) to authenticated;

-- ── 12. RLS ─────────────────────────────────────────────────────────────────
-- Functions are the only way to write. A VA's direct read is their own live claim on
-- their own side: see the header. Agent and admin reads are 193's, admin through
-- can_view_agent. servicing_tasks_demo_wall stays as 193 wrote it.
drop policy if exists servicing_tasks_update on public.servicing_tasks;
revoke update on public.servicing_tasks from authenticated;

drop policy if exists servicing_tasks_select on public.servicing_tasks;
create policy servicing_tasks_select on public.servicing_tasks
  for select to authenticated
  using (
    public.can_view_agent(agent_id)
    or (public.is_fulfillment()
        and va_claimed_by = auth.uid()
        and va_claim_expires_at > now()
        and public.servicing_task_is_demo_side(id) = (select public.my_is_demo()))
  );

-- ── 13. The event kind ──────────────────────────────────────────────────────
-- A kind of its own. in_progress and cancelled are read as calls by useRepCallEvents,
-- and the feed words cancelled as 'Old policy confirmed cancelled.'.
alter table public.policy_events drop constraint policy_events_kind_check;
alter table public.policy_events add constraint policy_events_kind_check
  check (kind = any (array['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited', 'reassigned',
                           'submitted', 'service_request', 'servicing']));

-- ── 14. agent_activity_feed ─────────────────────────────────────────────────
-- 202, its newest version and live, with two lines added: the title of a servicing event
-- is its label, and its done event is skipped, because the servicing_done row already
-- shows it. The feed returns kind servicing for these. All else is 202's.
create or replace function public.agent_activity_feed(
  p_from timestamptz,
  p_to timestamptz,
  p_agent uuid default null,
  p_limit int default 1000
)
returns table (id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_agents uuid[] := '{}';
begin
  select pr.role::text into v_role
    from profiles pr
   where pr.id = v_uid and pr.is_active;

  if v_role is null or v_role not in ('admin', 'agent', 'fulfillment') then
    return;
  end if;

  if v_role = 'agent' then
    v_agents := array(select v_uid union select d.id from public.downline_of(v_uid) d);
  end if;

  return query
  with lead_rows as (
    select l.id as lead_id, l.lead_type, l.state, l.created_at, l.delivered_at,
           coalesce(l.assigned_rep_id, l.transfer_agent_id) as lead_agent,
           coalesce(l.transfer_agent_id, l.assigned_rep_id) as transfer_agent,
           l.transfer_status, l.transferred_at,
           l.va_outcome, l.va_attempts, l.va_callback_at, l.va_last_worked_by, l.va_last_worked_at,
           l.booking_id, coalesce(l.client_policy_id, l.booking_id) as policy_id,
           split_part(n.full_name, ' ', 1) as first_name,
           nullif(btrim(substr(n.full_name, length(split_part(n.full_name, ' ', 1)) + 1)), '') as last_name
      from leads l
     cross join lateral (
       select coalesce(nullif(btrim(l.contact_name), ''), btrim(l.business_name)) as full_name
     ) n
     where l.lead_type <> 'cancellation'
  ),
  policy_lead as (
    select distinct on (x.policy_id) x.policy_id, x.lead_id
      from (
        select lr.booking_id as policy_id, lr.lead_id from lead_rows lr where lr.booking_id is not null
        union all
        select lr.policy_id, lr.lead_id from lead_rows lr where lr.policy_id is not null
      ) x
     order by x.policy_id, x.lead_id
  ),
  events as (
    -- policy_events: booked, moved, no_answer, in_progress, edited, reassigned,
    -- cancelled, and a corrected result as outcome.
    select 'policy_event:' || pe.id::text as id,
           case when pe.detail ->> 'correction' = 'true' then 'outcome' when pe.kind = 'submitted' then 'servicing' else pe.kind end as kind,
           pe.at as at,
           pl.lead_id as lead_id,
           p.agent_id as agent_id,
           case when p.fulfillment_assigned then p.assigned_fulfillment_id end as pool_rep,
           case
             when pe.detail ->> 'correction' = 'true' and pe.kind = 'cancelled' then 'Call result corrected to Cancelled.'
             when pe.detail ->> 'correction' = 'true' then 'Call result corrected to No-show.'
             when pe.kind = 'booked' and pe.from_status is not null then 'Call booked again.'
             when pe.kind = 'booked' then 'Call booked.'
             when pe.kind = 'moved' then 'Booked call moved to a new time.'
             when pe.kind = 'no_answer' then 'No-show: the call ended with no answer.'
             when pe.kind = 'in_progress' then 'A call started.'
             when pe.kind = 'edited' then 'Booking details changed.'
             when pe.kind = 'reassigned' then 'Call given to another Fulfillment rep.'
             when pe.kind = 'cancelled' then 'Old policy confirmed cancelled.'
             when pe.kind = 'submitted' then 'Submitted for servicing'
             when pe.kind = 'servicing' then pe.detail ->> 'label'
             else 'Call updated.'
           end as title,
           p.id as policy_id,
           p.client_first_name as first_name,
           p.client_last_name as last_name,
           p.state as state,
           pe.actor_name as actor_name,
           pe.actor_role as actor_role,
           pe.detail -> 'attempt' as attempt,
           pe.detail ->> 'reason' as reason,
           case when pe.kind = 'moved' then pe.detail ->> 'from' end as from_at,
           case pe.kind when 'moved' then pe.detail ->> 'to'
                        when 'booked' then pe.detail ->> 'scheduled_call_at' end as to_at,
           null::text as raw_text,
           case
             when pe.detail ->> 'correction' = 'true' then
               jsonb_build_object('result_from', pe.detail ->> 'from', 'result_to', pe.kind)
             when pe.kind = 'edited' then
               jsonb_build_object('changed_fields', (
                 select jsonb_agg(c ->> 'field')
                   from jsonb_array_elements(
                     case when jsonb_typeof(pe.detail -> 'changes') = 'array' then pe.detail -> 'changes' else '[]'::jsonb end
                   ) c
               ))
             when pe.kind = 'reassigned' then
               jsonb_build_object('from_name', pe.detail ->> 'from_name', 'to_name', pe.detail ->> 'to_name')
             else '{}'::jsonb
           end as extra
      from policy_events pe
      join policies p on p.id = pe.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where pe.at >= p_from and pe.at < p_to
       and pe.kind <> 'service_request'
       and not (pe.kind = 'servicing' and pe.detail ->> 'action' = 'done')

    union all
    -- inbound
    select 'lead_inbound:' || lr.lead_id::text, 'inbound', coalesce(lr.delivered_at, lr.created_at),
           lr.lead_id, lr.lead_agent, null::uuid,
           case lr.lead_type when 'policy_help' then 'A new live call came in.'
                             when 'mortgage_protection' then 'A new appointment request came in.'
                             else 'A new lead came in.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, null, null, null, null, null, null, '{}'::jsonb
      from lead_rows lr
     where coalesce(lr.delivered_at, lr.created_at) >= p_from
       and coalesce(lr.delivered_at, lr.created_at) < p_to

    union all
    -- text_auto
    select 'followup_sms:' || s.id::text, 'text_auto', s.created_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           case when s.stage = 'just_submitted' then 'Welcome text sent automatically.'
                else 'Automatic follow-up text sent.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'system', null, s.stage, null, null, null, '{}'::jsonb
      from lead_followup_sms_log s
      join lead_rows lr on lr.lead_id = s.lead_id
     where s.status = 'sent'
       and s.created_at >= p_from and s.created_at < p_to

    union all
    -- text_auto: the booked-call texts. Confirmed sends only: ok with nothing skipped.
    select 'recovery_sms:' || rs.id::text, 'text_auto', rs.created_at,
           pl.lead_id, p.agent_id, null::uuid,
           case rs.kind when 'text1' then 'Automatic text sent after a missed call.'
                        when 'text2' then 'Automatic reminder text sent about the next call.'
                        when 'am' then 'Automatic text sent after a missed call.'
                        when 'pm' then 'Automatic text sent after a missed call.'
                        when 'apology1' then 'Automatic apology text sent for a missed call.'
                        when 'apology2' then 'Automatic reminder text sent about the next call.'
                        when 'confirm' then 'Automatic confirmation text sent.'
                        else 'Automatic text sent.' end,
           p.id, p.client_first_name, p.client_last_name, p.state,
           null, 'system', null, rs.kind, null, null, null, '{}'::jsonb
      from recovery_sms_log rs
      join policies p on p.id = rs.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where rs.ok and rs.skipped is null
       and rs.created_at >= p_from and rs.created_at < p_to

    union all
    -- text_auto: lead-workflow-sms steps. It marks a row done before it sends, so
    -- only a row holding Twilio's answer is known to have gone out.
    select 'inbound_event:' || ev.id::text, 'text_auto', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.lead_agent), null::uuid,
           case when ev.detail ->> 'step' = 'instant' then 'Welcome text sent automatically.'
                when ev.detail ->> 'step' like 'not_reached%' then 'Automatic follow-up text sent.'
                when ev.detail ->> 'step' = 'confirm' then 'Automatic confirmation text sent.'
                when ev.detail ->> 'step' like 'reminder%' then 'Automatic reminder text sent.'
                when ev.detail ->> 'step' = 'no_show_rebook' then 'Automatic rebook text sent.'
                else 'Automatic text sent.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'system', null, ev.detail ->> 'step', null, null, null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind in ('text_sent', 'reminder')
       and ev.state = 'done'
       and nullif(ev.detail ->> 'twilio_sid', '') is not null
       and ev.at >= p_from and ev.at < p_to

    union all
    -- text_reply: a client's text to a lead
    select 'sms_reply:' || r.id::text, 'text_reply', r.received_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           'The client replied by text.',
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'client', null, null, null, null, r.body, '{}'::jsonb
      from lead_sms_replies r
      join lead_rows lr on lr.lead_id = r.lead_id
     where r.received_at >= p_from and r.received_at < p_to

    union all
    -- text_reply: a message sent to the agent on a client's thread
    select 'policy_message:' || m.id::text, 'text_reply', m.created_at,
           pl.lead_id, p.agent_id, null::uuid,
           'New message on this client''s thread.',
           p.id, p.client_first_name, p.client_last_name, p.state,
           m.sender_name, m.sender_role, null, null, null, null, m.body, '{}'::jsonb
      from policy_messages m
      join policies p on p.id = m.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where m.sender_id <> p.agent_id
       and p.fulfillment_assigned
       and m.created_at >= p_from and m.created_at < p_to

    union all
    -- va_call
    select 'va_call:' || lr.lead_id::text, 'va_call', lr.va_last_worked_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           case lr.va_outcome when 'not_reached' then 'A VA called and did not reach the client.'
                              when 'callback' then 'A VA called and set a callback.'
                              else 'A VA called and the client is not interested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, to_jsonb(lr.va_attempts), lr.va_outcome,
           null, case when lr.va_outcome = 'callback' then to_jsonb(lr.va_callback_at) #>> '{}' end, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.va_outcome in ('not_reached', 'callback', 'not_interested')
       and lr.va_last_worked_at >= p_from and lr.va_last_worked_at < p_to
       and not exists (select 1 from inbound_events x
                        where x.lead_id = lr.lead_id and x.kind = 'va_call' and x.state = 'done')

    union all
    -- va_call: one row per attempt, from log_lead_call_events
    select 'inbound_event:' || ev.id::text, 'va_call', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.lead_agent), null::uuid,
           case ev.detail ->> 'outcome' when 'not_reached' then 'A VA called and did not reach the client.'
                                        when 'callback' then 'A VA called and set a callback.'
                                        when 'not_interested' then 'A VA called and the client is not interested.'
                                        else 'A VA called.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, ev.detail -> 'attempt', ev.detail ->> 'outcome',
           null, ev.detail ->> 'callback_at', null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'va_call'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

    union all
    -- booked: a VA's booking with no policy row to log it
    select 'lead_booked:' || lr.lead_id::text, 'booked', lr.va_last_worked_at,
           lr.lead_id, lr.transfer_agent, null::uuid,
           'A VA booked an appointment.',
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, to_jsonb(lr.va_attempts), null, null, null, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.va_outcome = 'booked'
       and lr.booking_id is null
       and lr.va_last_worked_at >= p_from and lr.va_last_worked_at < p_to

    union all
    -- transferred
    select 'lead_transfer:' || lr.lead_id::text, 'transferred', lr.transferred_at,
           lr.lead_id, lr.transfer_agent, null::uuid,
           case lr.transfer_status when 'connected' then 'A live transfer connected.'
                                   when 'dropped' then 'A live transfer dropped.'
                                   else 'A live transfer was requested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, null, lr.transfer_status, null, null, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.transferred_at >= p_from and lr.transferred_at < p_to
       and not exists (select 1 from inbound_events x
                        where x.lead_id = lr.lead_id and x.kind = 'transferred' and x.state = 'done')

    union all
    -- transferred: one row per change, from log_lead_call_events
    select 'inbound_event:' || ev.id::text, 'transferred', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.transfer_agent), null::uuid,
           case ev.detail ->> 'status' when 'connected' then 'A live transfer connected.'
                                       when 'dropped' then 'A live transfer dropped.'
                                       else 'A live transfer was requested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, null, ev.detail ->> 'status', null, null, null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'transferred'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

    union all
    -- outcome and sold: the agent's Sold / Follow up / Not interested
    select 'inbound_event:' || ev.id::text,
           case when ev.detail ->> 'outcome' = 'sold' then 'sold' else 'outcome' end,
           ev.at, lr.lead_id, lr.lead_agent, null::uuid,
           case ev.detail ->> 'outcome' when 'sold' then 'Marked sold. The lead is now a client.'
                                        when 'follow_up' then 'Outcome marked: follow up.'
                                        when 'not_interested' then 'Outcome marked: not interested.'
                                        else 'Outcome marked.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, null, ev.detail ->> 'outcome', null, null, ev.detail ->> 'note', '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'outcome'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

    union all
    -- servicing: the task was added
    select 'servicing_added:' || t.id::text, 'servicing', t.created_at,
           t.lead_id, t.agent_id, null::uuid,
           case when t.kind = 'lapse_save' then 'Lapse risk flagged.'
                when t.requested_by in ('agent', 'client') then 'Request opened: ' || replace(t.kind, '_', ' ') || '.'
                else 'Servicing task added: ' || replace(t.kind, '_', ' ') || '.' end,
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           rb.full_name, rb.role::text, null, t.kind, null, to_jsonb(t.due_at) #>> '{}', t.note, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
      left join profiles rb on rb.id = t.requested_by_id
     where t.created_at >= p_from and t.created_at < p_to

    union all
    -- servicing: the task was done
    select 'servicing_done:' || t.id::text, 'servicing', t.done_at,
           t.lead_id, t.agent_id, null::uuid,
           case when t.kind = 'lapse_save' then
                  case t.outcome when 'saved' then 'Policy saved from lapse.'
                                 when 'lapsed' then 'Policy lapsed.'
                                 when 'client_cancelled' then 'The client cancelled the policy.'
                                 else 'Lapse work done.' end
                when t.requested_by in ('agent', 'client') then 'Request done: ' || replace(t.kind, '_', ' ') || '.'
                else 'Servicing task done: ' || replace(t.kind, '_', ' ') || '.' end,
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           null, null, null, t.outcome, null, null, null, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
     where t.done_at >= p_from and t.done_at < p_to

    union all
    -- billing_spend_*: one log row is one feed row, and a row that changed nothing is none.
    select 'spend_log:' || sl.id::text,
           case when sl.old_paused is distinct from sl.new_paused then 'billing_spend_pause' else 'billing_spend_change' end,
           sl.created_at, null, sl.agent_id, null::uuid,
           case when sl.old_paused is not distinct from sl.new_paused then 'Weekly lead spend changed.'
                when sl.new_paused then 'Lead spend paused.'
                else 'Lead spend resumed.' end,
           null, null, null, null, null, null, null,
           case when sl.old_paused is not distinct from sl.new_paused then null
                when sl.new_paused then 'paused'
                else 'resumed' end,
           null, null, null,
           jsonb_build_object('inbound_type', sl.inbound_type)
             || case when sl.old_paused is distinct from sl.new_paused and sl.old_cents = sl.new_cents then '{}'::jsonb
                     else jsonb_build_object('amount_cents', sl.new_cents) end
      from agent_inbound_spend_log sl
     where sl.created_at >= p_from and sl.created_at < p_to
       and (sl.old_paused is distinct from sl.new_paused or sl.old_cents is distinct from sl.new_cents)
  )
  select e.id, e.kind, e.at, e.lead_id, e.agent_id, e.title,
         jsonb_strip_nulls(jsonb_build_object(
           'policy_id', e.policy_id,
           'client_first_name', case when e.first_name !~ '[0-9]' then e.first_name end,
           'client_last_name', case when e.last_name !~ '[0-9]' then e.last_name end,
           'state', e.state,
           'actor_name', e.actor_name,
           'actor_role', e.actor_role,
           'attempt', e.attempt,
           'reason', e.reason,
           'from', e.from_at,
           'to', e.to_at,
           'preview', left(regexp_replace(e.raw_text, '\+?\(?[0-9][0-9[:space:]().-]{5,}[0-9]', '[number removed]', 'g'), 140)
         ) || e.extra)
    from events e
   where (v_role = 'admin'
          or (v_role = 'agent' and e.agent_id = any (v_agents))
          or (v_role = 'fulfillment' and e.pool_rep = v_uid))
     and (e.kind not in ('billing_spend_change', 'billing_spend_pause') or v_role = 'admin' or e.agent_id = v_uid)
     and (p_agent is null or e.agent_id = p_agent)
   order by e.at desc, e.id desc
   limit greatest(least(coalesce(p_limit, 1000), 5000), 0);
end;
$$;

revoke execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) to authenticated;

-- ── 15. policy_servicing_status ─────────────────────────────────────────────
-- 193, with sent_open added: a task sent to the agent reads needs_attention, and it can
-- be the next step there. saved_watch now needs a saved date, or a sent-only policy
-- would get that row with a null date. Same columns, order and types, so agent_clients
-- needs no change. Replacing the view keeps its grants and its comment.
create or replace view public.policy_servicing_status with (security_invoker = true) as
with facts as (
  select p.id as policy_id,
         p.agent_id,
         md5(p.agent_id::text
             || '|' || coalesce(nullif(right(regexp_replace(coalesce(p.client_phone, ''), '\D', '', 'g'), 10), ''), p.id::text)
             || '|' || lower(btrim(regexp_replace(coalesce(p.client_first_name, '') || ' ' || coalesce(p.client_last_name, ''), '\s+', ' ', 'g')))
         ) as client_key,
         p.client_first_name,
         p.client_last_name,
         p.client_phone,
         coalesce(p.new_carrier_name, p.carrier_name) as carrier,
         p.is_sample,
         p.scheduled_call_at,
         a.anchor,
         (a.anchor + interval '12 months')::date as watch_end,
         t.open_requests,
         t.lapse_open,
         t.saved_at,
         t.setup_open,
         t.sent_open,
         (p.status in ('Lapsed', 'Not Approved', 'Undrafted') or p.archived_at is not null or t.lapse_lost) as is_ended,
         (p.fulfillment_assigned and p.replaced_old_policy is distinct from false
          and public.policy_agent_status(p.fulfillment_stage::text, p.call_live_since, p.last_call_outcome) <> 'cancelled') as old_open
    from public.policies p
   cross join lateral (select coalesce(p.effective_date, p.policy_sold_date, p.created_at::date) as anchor) a
   cross join lateral (
     select count(*) as task_count,
            count(*) filter (where x.status in ('requested', 'scheduled', 'in_progress')
                               and x.requested_by in ('agent', 'client'))::int as open_requests,
            coalesce(bool_or(x.kind = 'lapse_save' and x.status in ('requested', 'scheduled', 'in_progress')), false) as lapse_open,
            max(x.done_at) filter (where x.kind = 'lapse_save' and x.outcome = 'saved'
                                     and x.done_at >= now() - interval '14 days') as saved_at,
            coalesce(bool_or(x.kind in ('packet_check', 'review_call') and x.requested_by = 'system'
                             and x.status in ('requested', 'scheduled', 'in_progress')), false) as setup_open,
            coalesce(bool_or(x.sent_to_agent_at is not null and x.status in ('requested', 'scheduled', 'in_progress')), false) as sent_open,
            coalesce(bool_or(x.kind = 'lapse_save' and x.status = 'done'
                             and x.outcome in ('lapsed', 'client_cancelled')), false) as lapse_lost
       from public.servicing_tasks x
      where x.policy_id = p.id
   ) t
   where p.fulfillment_assigned or t.task_count > 0
),
staged as (
  select f.*,
         case
           when f.is_ended then 'ended'
           when f.lapse_open or f.saved_at is not null or f.sent_open then 'needs_attention'
           when f.setup_open or f.old_open then 'setting_up'
           when current_date >= f.watch_end then 'ongoing'
           else 'protected'
         end as stage
    from facts f
)
select s.policy_id,
       s.agent_id,
       s.client_key,
       s.client_first_name,
       s.client_last_name,
       s.client_phone,
       s.carrier,
       s.stage,
       case when s.stage = 'protected' then coalesce(n.step, 'chargeback_watch') else n.step end as next_step,
       case when s.stage = 'protected' and coalesce(n.step, 'chargeback_watch') = 'chargeback_watch'
            then coalesce(n.due, (s.watch_end + time '12:00') at time zone 'UTC')
            else n.due end as next_date,
       case when current_date >= s.watch_end then null
            else least(12, greatest(1, (select (extract(year from g.age) * 12 + extract(month from g.age))::int + 1
                                          from (select age(current_date::timestamp, s.anchor::timestamp) as age) g)))
       end as watch_month,
       s.open_requests,
       s.is_sample
  from staged s
  left join lateral (
    select c.step, c.due
      from (
        select x.kind as step, x.due_at as due
          from public.servicing_tasks x
         where x.policy_id = s.policy_id
           and x.status in ('requested', 'scheduled', 'in_progress')
           and case s.stage
                 when 'needs_attention' then x.kind = 'lapse_save' or x.sent_to_agent_at is not null
                 when 'setting_up' then x.requested_by = 'system' and x.kind in ('packet_check', 'review_call')
                 when 'ongoing' then x.requested_by = 'system' and x.kind in ('annual_review', 'conversion')
                 when 'protected' then x.requested_by = 'system'
                 else false
               end
        union all
        select 'old_policy_cancel', s.scheduled_call_at
         where s.stage = 'setting_up' and s.old_open
        union all
        select 'saved_watch', s.saved_at + interval '14 days'
         where s.stage = 'needs_attention' and not s.lapse_open and s.saved_at is not null
      ) c
     order by c.due asc nulls last, c.step
     limit 1
  ) n on true;

comment on view public.policy_servicing_status is
  'Each policy''s stage, next step and date. Read-only and security_invoker. See migration 193 for the rules.';

-- Check after applying:
--   select has_table_privilege('authenticated', 'public.servicing_tasks', 'update');    -- false
--   select has_column_privilege('authenticated', 'public.servicing_tasks', 'status', 'update'); -- false
--   select count(*) from public.servicing_tasks where sent_to_agent_at is not null;     -- 0
--   select reloptions from pg_class where relname = 'policy_servicing_status';          -- {security_invoker=true}
