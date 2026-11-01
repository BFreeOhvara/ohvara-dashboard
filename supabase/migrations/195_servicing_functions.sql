-- 195 — The agent's servicing functions: list my items, Submit seeds a deal's steps,
-- add a note, read one client.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step. It
-- applies only after 193_servicing_model.sql: its first statement stops the whole
-- file if 193's view isn't there, or if the current agent_submit_deal has no weekly
-- cap check. agent_submit_deal below is copied whole from 187, its only version, with
-- only the lines named here changed. submit_live and every live switch stay as they
-- are, no policy column is added, and agent_activity_feed isn't touched.
--
-- Unmerged 192_submit_no_weekly_cap.sql (branch atlas/26c9f402) removes the cap this
-- file keeps and recreates the 13-argument signature this file drops. They cannot
-- both apply. Hold 192: retire it, or redo it on top of this file if Brayden ever
-- drops the cap.
--
-- Why: no function listed an agent's items, added a note or read one client, and
-- agent_submit_deal wrote no servicing_tasks, so a new deal had no steps. See
-- brain/ohvara/Agent Portal Servicing Spec.md, section 2: Submit creates them.
--
-- FRONTEND CONTRACT (the builders rely on these names):
--   rpc agent_servicing_items(p_status default null)
--     The caller's own tasks, never a downline's. p_status is requested, scheduled,
--     in_progress, done or cancelled, or null for all; anything else raises 22023.
--     Rows: task_id, policy_id, lead_id, kind, status, requested_by, due_at, done_at,
--     best_time, note, outcome, client_name. Soonest due first, no date last.
--     client_name is null when the caller can no longer read the lead.
--   rpc agent_submit_deal(...the same 13 arguments..., p_effective_date default null)
--     Same refusals in the same order, with the weekly cap. Returns the policy id.
--     Saves p_effective_date to policies.effective_date and seeds three steps with
--     requested_by system and status scheduled, from coalesce(p_effective_date, today):
--       packet_check      anchor + 3 days
--       review_call       anchor + 10 days, best_time = p_best_time
--       chargeback_watch  anchor + 12 months, one row; the view works out watch_month
--     Each due_at is that date at noon UTC, 193's rule. The old-policy cancellation
--     stays in today's machinery, not a task.
--   table servicing_task_notes
--     id, task_id, author_id, body (1 to 1000 characters), created_at. Read through
--     the task's own rules. No client write: add_servicing_note is the way in.
--   rpc add_servicing_note(p_task, p_note)
--     Returns the note's id. Only the task's own agent. 22004 on no task, 22023 on an
--     empty or over-long note (refused, not cut short), 42501 otherwise. Changes
--     nothing on the task and writes no event.
--   rpc agent_client_detail(p_client_key)
--     jsonb: { client: <agent_clients row>, policies: [ <policy_servicing_status row>
--     + tasks: [ <servicing_tasks row> + notes: [ <note> ] ] ] }. Policies newest
--     first, tasks soonest due first, notes oldest first. Null if the key isn't the
--     caller's own. A lead-only task isn't here: the views are policy-based.
--
-- Who can write servicing_tasks: set_inbound_outcome, agent_submit_service_request,
-- agent_submit_deal and the service role.
-- Who can write servicing_task_notes: add_servicing_note and the service role.

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
declare
  v_deal regprocedure := to_regprocedure('public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean)');
begin
  if to_regclass('public.policy_servicing_status') is null then
    raise exception '195 needs 193_servicing_model applied first';
  end if;
  if v_deal is null or position('weekly_cap' in pg_get_functiondef(v_deal)) = 0 then
    raise exception '195 stopped: the current agent_submit_deal has no weekly cap check. This file keeps the cap, so it can''t follow 192_submit_no_weekly_cap. Nothing was changed.';
  end if;
end $$;

-- ── 2. List my servicing items ──────────────────────────────────────────────
-- Security invoker, so servicing_tasks' demo wall applies. The joins are left joins:
-- a lead-only task stays in, and a lead RLS now hides lists with no name.
create or replace function public.agent_servicing_items(p_status text default null)
returns table (
  task_id      uuid,
  policy_id    uuid,
  lead_id      uuid,
  kind         text,
  status       text,
  requested_by text,
  due_at       timestamptz,
  done_at      timestamptz,
  best_time    text,
  note         text,
  outcome      text,
  client_name  text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_status is not null and p_status not in ('requested', 'scheduled', 'in_progress', 'done', 'cancelled') then
    raise exception 'Unknown status %', p_status using errcode = '22023';
  end if;

  return query
  select t.id, t.policy_id, t.lead_id, t.kind, t.status, t.requested_by, t.due_at, t.done_at,
         t.best_time, t.note, t.outcome,
         coalesce(nullif(btrim(concat_ws(' ', p.client_first_name, p.client_last_name)), ''),
                  nullif(btrim(l.contact_name), ''),
                  nullif(btrim(l.business_name), ''))
    from servicing_tasks t
    left join policies p on p.id = t.policy_id
    left join leads l on l.id = t.lead_id
   where t.agent_id = auth.uid()
     and (p_status is null or t.status = p_status)
   order by t.due_at asc nulls last, t.created_at, t.id;
end;
$$;

revoke all on function public.agent_servicing_items(text) from public, anon;
grant execute on function public.agent_servicing_items(text) to authenticated;

-- ── 3. Submit a deal ────────────────────────────────────────────────────────
-- 187, with a trailing p_effective_date, the anchor, the effective_date column and
-- the three seeds. The anchor matches the view's
-- coalesce(effective_date, policy_sold_date, created_at::date), because this RPC never
-- sets policy_sold_date. Dropped first so there is no overload.
drop function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean);

create or replace function public.agent_submit_deal(
  p_first          text,
  p_last           text,
  p_phone          text,
  p_city           text,
  p_state          text,
  p_timezone       text,
  p_new_carrier    uuid,
  p_policy_number  text default null,
  p_replaced       boolean default null,
  p_old_carrier    uuid default null,
  p_at             timestamptz default null,
  p_best_time      text default null,
  p_sms_consent    boolean default false,
  p_effective_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent    uuid := auth.uid();
  v_servicing boolean;
  v_name     text;
  u          record;
  v_first    text := nullif(btrim(p_first), '');
  v_last     text := nullif(btrim(p_last), '');
  v_phone    text := nullif(btrim(p_phone), '');
  v_city     text := nullif(btrim(p_city), '');
  v_state    text := nullif(upper(btrim(p_state)), '');
  v_tz       text := nullif(btrim(p_timezone), '');
  v_new_name text;
  v_old_name text;
  v_id       uuid;
  v_anchor   date := coalesce(p_effective_date, current_date);
begin
  select has_servicing, coalesce(nullif(btrim(full_name), ''), 'Unknown') into v_servicing, v_name
    from profiles where id = v_agent and role = 'agent' and is_active;
  if not found then
    raise exception 'Only an agent can submit a deal' using errcode = '42501';
  end if;
  if not coalesce((select submit_live from app_settings where id = 1), false) then
    raise exception 'Submit is not live yet' using errcode = 'P0001', hint = 'not_live';
  end if;
  if not v_servicing then
    raise exception 'Servicing is not on your plan' using errcode = 'P0001', hint = 'no_servicing';
  end if;

  -- The same lock and the same rules as enforce_weekly_submission_cap (147),
  -- which steps aside here because current_user is the owner.
  perform pg_advisory_xact_lock(hashtextextended('weekly_cap:' || v_agent::text, 0));
  select * into u from public.agent_weekly_usage(v_agent);
  if found and u.enforced and u.weekly_cap is not null and u.used >= u.weekly_cap then
    raise exception 'Weekly submission cap reached: % of % used this week on the % plan.',
      u.used, u.weekly_cap, u.tier_name
      using errcode = 'P0001', hint = 'weekly_cap';
  end if;

  if v_first is null or v_last is null then
    raise exception 'First and last name are required' using errcode = '22023';
  end if;
  if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) < 10 then
    raise exception 'Add the client''s 10-digit phone number' using errcode = '22023';
  end if;
  if v_city is null or v_state is null or v_state !~ '^[A-Z]{2}$' then
    raise exception 'Add the client''s city and state' using errcode = '22023';
  end if;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  select name into v_new_name from carriers where id = p_new_carrier;
  if v_new_name is null then
    raise exception 'Pick the new carrier from the list' using errcode = '22023';
  end if;
  if p_replaced is null then
    raise exception 'Say whether this replaced an old policy' using errcode = '22023';
  end if;
  if p_best_time is null or p_best_time not in ('morning', 'afternoon', 'evening') then
    raise exception 'Pick the best time to reach them' using errcode = '22023';
  end if;
  if p_replaced then
    select name into v_old_name from carriers where id = p_old_carrier;
    if v_old_name is null then
      raise exception 'Pick the carrier they''re leaving' using errcode = '22023', hint = 'booking_rule';
    end if;
    if p_at is null then
      raise exception 'Pick a time for the call.' using errcode = '22023', hint = 'booking_rule';
    end if;
  end if;

  -- A Yes deal's slot (30 minutes' notice, carrier hours, no double booking) is
  -- checked by policies_booking_rules on this insert: it keys on auth.uid(), not
  -- current_user, so it fires here.
  insert into policies (
    agent_id, status, client_first_name, client_last_name, client_phone, client_city, state, client_timezone,
    carrier_id, carrier_name, new_carrier_id, new_carrier_name, policy_number, replaced_old_policy, best_time,
    pending_underwriting, fulfillment_assigned, fulfillment_stage, scheduled_call_at, sms_consent, effective_date
  ) values (
    v_agent, 'Submitted', v_first, v_last, v_phone, v_city, v_state, v_tz,
    case when p_replaced then p_old_carrier end, case when p_replaced then v_old_name end,
    p_new_carrier, v_new_name, nullif(btrim(p_policy_number), ''), p_replaced, p_best_time,
    false, true, 'Pending', case when p_replaced then p_at end, coalesce(p_sms_consent, false), p_effective_date
  )
  returning id into v_id;

  -- Having this row keeps Fulfillment's "No intake details" warning from firing.
  insert into policy_fulfillment_details (policy_id, full_legal_name, current_carrier)
  values (v_id, v_first || ' ' || v_last, case when p_replaced then v_old_name end);

  insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
  values (v_id, v_agent, 'submitted', v_agent, v_name, 'agent',
          jsonb_build_object('label', 'Submitted for servicing', 'replaced', p_replaced,
                             'best_time', p_best_time, 'scheduled_call_at', case when p_replaced then p_at end));

  -- Noon UTC is the same calendar day in every US time zone (193), and the watch's
  -- due_at equals the view's watch end.
  insert into servicing_tasks (agent_id, policy_id, kind, status, due_at, best_time, requested_by, requested_by_id)
  values (v_agent, v_id, 'packet_check',     'scheduled', ((v_anchor + 3) + time '12:00') at time zone 'UTC',                         null,        'system', v_agent),
         (v_agent, v_id, 'review_call',      'scheduled', ((v_anchor + 10) + time '12:00') at time zone 'UTC',                        p_best_time, 'system', v_agent),
         (v_agent, v_id, 'chargeback_watch', 'scheduled', ((v_anchor + interval '12 months')::date + time '12:00') at time zone 'UTC', null,        'system', v_agent);

  return v_id;
end;
$$;

revoke all on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date) from public, anon;
grant execute on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean, date) to authenticated;

comment on table public.servicing_tasks is
  'Every servicing step and every request on a client. Written only by set_inbound_outcome, agent_submit_service_request, agent_submit_deal and the service role. A request doesn''t count against the weekly cap.';

-- ── 4. servicing_task_notes ─────────────────────────────────────────────────
create table public.servicing_task_notes (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.servicing_tasks(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index servicing_task_notes_task_idx on public.servicing_task_notes (task_id, created_at);

comment on table public.servicing_task_notes is
  'Notes on a servicing task. Whoever can read the task reads its notes. Written only by add_servicing_note and the service role.';

alter table public.servicing_task_notes enable row level security;

-- Whoever can read the task reads its notes. The subquery runs under servicing_tasks
-- RLS, so its read rules and demo wall apply here too.
create policy servicing_task_notes_select on public.servicing_task_notes
  for select to authenticated
  using (exists (select 1 from public.servicing_tasks t where t.id = servicing_task_notes.task_id));

revoke all on public.servicing_task_notes from public, anon, authenticated;
grant select on public.servicing_task_notes to authenticated;

create trigger a0_block_inactive_writer
  before insert or update or delete on public.servicing_task_notes
  for each row execute function public.block_inactive_writer();

-- 190's rule: everything an agent can write through an RPC gets it.
create trigger a0_block_locked_self_signup
  before insert or update or delete on public.servicing_task_notes
  for each row execute function public.block_locked_self_signup_writer();

-- ── 5. Add a note ───────────────────────────────────────────────────────────
-- Modelled on add_inbound_note, for the task's own agent only: upline, Fulfillment,
-- admin and a task that doesn't exist all get the same answer. Definer skips RLS, so
-- the demo wall is checked here. It writes no policy_events row: events are read
-- wider than the task, and the feed would show it as 'Call updated.'. Not gated on
-- submit_live: Sold's tasks exist before it.
create or replace function public.add_servicing_note(p_task uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\n\r\f\v'), '');
  v_task record;
  v_id   uuid;
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

  select id, agent_id, policy_id into v_task from servicing_tasks where id = p_task;
  if not found
     or v_task.agent_id is distinct from v_uid
     or not exists (select 1 from profiles where id = v_uid and is_active)
     or (v_task.policy_id is not null
         and public.policy_is_demo(v_task.policy_id) is distinct from public.my_is_demo()) then
    raise exception 'Only this client''s agent can add a note' using errcode = '42501';
  end if;

  insert into servicing_task_notes (task_id, author_id, body)
  values (p_task, v_uid, v_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_servicing_note(uuid, text) from public, anon;
grant execute on function public.add_servicing_note(uuid, text) to authenticated;

-- ── 6. Read one client ──────────────────────────────────────────────────────
-- Security invoker, so RLS and the demo wall apply to every read here. No row in
-- agent_clients gives SQL null, not an empty object.
create or replace function public.agent_client_detail(p_client_key text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
           'client', to_jsonb(c),
           'policies', coalesce((
             select jsonb_agg(
                      to_jsonb(s) || jsonb_build_object('tasks', coalesce((
                        select jsonb_agg(
                                 to_jsonb(t) || jsonb_build_object('notes', coalesce((
                                   select jsonb_agg(to_jsonb(n) order by n.created_at, n.id)
                                     from servicing_task_notes n
                                    where n.task_id = t.id
                                 ), '[]'::jsonb))
                                 order by t.due_at asc nulls last, t.created_at, t.id)
                          from servicing_tasks t
                         where t.policy_id = s.policy_id
                      ), '[]'::jsonb))
                      order by o.ord)
               from unnest(c.policy_ids) with ordinality as o(policy_id, ord)
               join policy_servicing_status s on s.policy_id = o.policy_id
           ), '[]'::jsonb))
    from agent_clients c
   where c.agent_id = auth.uid()
     and c.client_key = p_client_key
$$;

revoke all on function public.agent_client_detail(text) from public, anon;
grant execute on function public.agent_client_detail(text) to authenticated;

-- Check after applying:
--   select count(*) from pg_proc where proname = 'agent_submit_deal';    -- 1
--   select count(*) from public.servicing_task_notes;                    -- 0
--   select submit_live from public.app_settings where id = 1;            -- false
