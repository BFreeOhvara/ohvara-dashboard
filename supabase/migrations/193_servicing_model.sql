-- 193 — One servicing model: servicing_tasks holds every step and every request,
-- and two read-only views give each policy a stage and each person one row.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step, and
-- yes at the door merges and applies at once. Its first statement stops the whole
-- file if public.service_requests has a row: that table is dropped here and nothing
-- is moved. Both Submit RPCs refuse with not_live while submit_live is off, so it
-- can't fill up before this runs. Each function replaced below is copied whole from
-- its newest version with only the lines named here changed. No policy column or
-- policy trigger, cron, fulfillment flow or agent_weekly_usage changes.
--
-- SUBMIT_LIVE STAYS OFF until this migration AND the app deploy that reads it are
-- both live. The app sends the new kind names only after that deploy, and the new
-- RPC refuses the old ones.
--
-- Why: the agent portal is about looking after clients. Until now there are two
-- tables for one job, with different names for the same kinds, and a client is a
-- policy row. See brain/ohvara/Agent Portal Servicing Spec.md, section Data.
--
-- FRONTEND CONTRACT (the builders rely on these names):
--   table servicing_tasks
--     requested_by     text: agent, client or system. Who asked. Old rows: system.
--     requested_by_id  uuid -> profiles, who pressed the button. Was requested_by.
--     status           requested, scheduled, in_progress, done, cancelled.
--     best_time        morning, afternoon, evening. Null for most steps.
--     outcome          saved, lapsed, client_cancelled. For a lapse_save. No app
--                      role can write it yet: the update grant is status only.
--     updated_at       set by the trigger, as is done_at when status becomes done.
--   kinds on a request (the RPC's whole list; no other spelling is accepted):
--     beneficiary_change, address_change, payment_change, draft_date_change,
--     lapse_save, claim_help, carrier_call
--   rpc agent_submit_service_request(p_policy, p_kind, p_note, p_best_time)
--     Same signature and refusals. Returns the servicing_tasks id, which is also
--     detail.request_id on its policy_events row.
--   view policy_servicing_status, one row per policy that went to Fulfillment or
--     has a task. policy_id, agent_id, client_key, client_first_name,
--     client_last_name, client_phone, carrier, stage, next_step, next_date,
--     watch_month, open_requests, is_sample.
--   view agent_clients, one row per agent_id + client_key. agent_id, client_key,
--     client_first_name, client_last_name, client_phone, policy_count, policy_ids
--     (newest first), next_date, open_requests, is_sample, stage.
--   stage is a key: ended, needs_attention, setting_up, ongoing, protected.
--   next_step is a key, never words: a servicing_tasks kind, old_policy_cancel or
--     saved_watch. Null means no step. The page holds the words.
--   next_date is a timestamptz. A chargeback watch end worked out from the anchor
--     has no time of day, so it is noon UTC: the same calendar day in every US
--     time zone.
--   watch_month is 1 to 12, null from the day month 12 ends. It is there at any
--     stage; the page decides when it reads "Month 4 of 12".
--   agent_activity_feed: same signature and kinds. A request shows as its
--     servicing_added row and its policy_events row is skipped.
--
-- THE STAGE, first match wins:
--   ended            policies.status in Lapsed, Not Approved, Undrafted; or
--                    archived_at is set; or a done lapse_save whose outcome is
--                    lapsed or client_cancelled. The old policy being cancelled is
--                    good news and never ends anything, so no cancellation or
--                    fulfillment field is read here. Nothing in the cancellation
--                    flow sets archived_at (checked on master: 147 and 187 only
--                    clear it on an agent's insert, and no function or page sets it).
--   needs_attention  an open lapse_save, whoever opened it, or a lapse_save saved
--                    in the last 14 days.
--   setting_up       an open system packet_check or review_call, or the old-policy
--                    step is open.
--   ongoing          12 months from the anchor have passed.
--   protected        everything else.
-- The anchor is coalesce(effective_date, policy_sold_date, created_at::date).
--
-- THE OLD-POLICY STEP is the one place the view reads the cancellation machinery.
-- It applies when fulfillment_assigned and replaced_old_policy is distinct from
-- false, and is open while policy_agent_status() isn't 'cancelled'. A policy that
-- never went to Fulfillment (a sold lead's policy, here only because a task points
-- at it) has no call to wait for, so without fulfillment_assigned it would read
-- setting up for good.
--
-- A REQUEST never sets a stage, except that an open lapse_save reads needs_attention
-- whoever opened it. So in that stage the agent's own lapse_save is the next step;
-- everywhere else next_step takes only requested_by = system. open_requests counts
-- open tasks with requested_by agent or client.
--
-- A CLIENT is md5(agent, phone, name): phone is the last 10 digits, name is lower
-- case, trimmed, inner spaces collapsed. With no phone digits the policy id stands
-- in for the phone, so two strangers with one name never merge.
--
-- RLS: both views are security_invoker, so policies and servicing_tasks RLS apply
-- to whoever reads them. Each view gets select for authenticated and service_role
-- and nothing else: Supabase's default grants would otherwise give anon everything.
-- A lead-only task (Sold on a lead with no policy yet) is never hidden by the demo
-- wall, which is about policies.
--
-- 190's list still names the dropped table. Its loop skips a table that isn't
-- there, and an old migration is never edited.

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
begin
  lock table public.service_requests in access exclusive mode;
  if exists (select 1 from public.service_requests) then
    raise exception '193 stopped: public.service_requests has rows. Nothing was changed. This migration only folds an empty table.';
  end if;
end $$;

-- ── 2. servicing_tasks ──────────────────────────────────────────────────────
alter table public.servicing_tasks rename column requested_by to requested_by_id;

alter table public.servicing_tasks
  add column requested_by text not null default 'system' check (requested_by in ('agent', 'client', 'system')),
  add column best_time text check (best_time in ('morning', 'afternoon', 'evening')),
  add column outcome text check (outcome in ('saved', 'lapsed', 'client_cancelled')),
  add column updated_at timestamptz not null default now();

alter table public.servicing_tasks drop constraint if exists servicing_tasks_status_check;
alter table public.servicing_tasks add constraint servicing_tasks_status_check
  check (status in ('requested', 'scheduled', 'in_progress', 'done', 'cancelled'));

create or replace function public.servicing_tasks_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'done' and old.status is distinct from 'done' and new.done_at is null then
    new.done_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.servicing_tasks_touch() from public, anon, authenticated;

drop trigger if exists servicing_tasks_touch on public.servicing_tasks;
create trigger servicing_tasks_touch
  before update on public.servicing_tasks
  for each row execute function public.servicing_tasks_touch();

create index if not exists servicing_tasks_policy_idx on public.servicing_tasks (policy_id);

comment on table public.servicing_tasks is
  'Every servicing step and every request on a client. Written only by set_inbound_outcome, agent_submit_service_request and the service role. A request doesn''t count against the weekly cap.';
comment on column public.servicing_tasks.requested_by is 'Who asked: agent, client or system.';
comment on column public.servicing_tasks.requested_by_id is 'The person who pressed the button, when there was one.';
comment on column public.servicing_tasks.outcome is 'How a lapse_save ended: saved, lapsed or client_cancelled.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Agents read their own and their downline's, like policies_select. The queue is
-- Fulfillment's and admin's, and they change the status and nothing else. No insert
-- policy and no insert grant: the two RPCs are the way in. Anon gets nothing.
drop policy if exists servicing_tasks_select on public.servicing_tasks;
create policy servicing_tasks_select on public.servicing_tasks
  for select to authenticated
  using (public.can_view_agent(agent_id) or public.is_fulfillment());

drop policy if exists servicing_tasks_update on public.servicing_tasks;
create policy servicing_tasks_update on public.servicing_tasks
  for update to authenticated
  using (public.is_admin() or public.is_fulfillment())
  with check (public.is_admin() or public.is_fulfillment());

-- 187's wall. A task with no policy isn't on either side of it.
drop policy if exists servicing_tasks_demo_wall on public.servicing_tasks;
create policy servicing_tasks_demo_wall on public.servicing_tasks as restrictive for all to authenticated
  using (policy_id is null or public.policy_is_demo(policy_id) = (select public.my_is_demo()))
  with check (policy_id is null or public.policy_is_demo(policy_id) = (select public.my_is_demo()));

revoke all on public.servicing_tasks from public, anon, authenticated;
grant select on public.servicing_tasks to authenticated;
grant update (status) on public.servicing_tasks to authenticated;

-- ── 4. set_inbound_outcome ──────────────────────────────────────────────────
-- 181, with Sold's seeds writing requested_by = system and requested_by_id = the caller.
create or replace function public.set_inbound_outcome(p_lead uuid, p_outcome text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_lead  record;
  v_stage text;
  v_name  text;
  v_role  text;
begin
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if p_outcome is null or p_outcome not in ('sold', 'follow_up', 'not_interested') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Keep the note under 2000 characters' using errcode = '22023';
  end if;

  select id, lead_type, assigned_rep_id, inbound_stage, client_policy_id into v_lead
    from leads where id = p_lead
    for update;
  if not found or not coalesce((
    public.is_admin()
    or (v_lead.assigned_rep_id = v_uid
        and exists (select 1 from profiles where id = v_uid and is_active))
  ), false) then
    if not found and public.is_admin() then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    raise exception 'Only the lead''s agent can do this' using errcode = '42501';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'This is not an inbound lead' using errcode = '22023';
  end if;
  if p_outcome = 'sold' and v_lead.assigned_rep_id is null then
    raise exception 'Give the lead to an agent before marking it sold' using errcode = '22023';
  end if;

  v_stage := case p_outcome when 'sold' then 'sold' when 'follow_up' then 'follow_up' else 'lost' end;

  update leads
     set outcome = p_outcome, outcome_at = now(), outcome_by = v_uid, inbound_stage = v_stage
   where id = p_lead;

  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
    into v_name, v_role
    from profiles where id = v_uid;

  insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_id, actor_name, actor_role)
  values (p_lead, v_lead.assigned_rep_id, 'outcome',
          case p_outcome when 'sold' then 'Sold' when 'follow_up' then 'Follow up' else 'Not interested' end,
          jsonb_build_object('outcome', p_outcome, 'from_stage', v_lead.inbound_stage)
            || case when v_note is not null then jsonb_build_object('note', v_note) else '{}'::jsonb end,
          v_uid, v_name, v_role);

  if p_outcome = 'sold' then
    insert into servicing_tasks (agent_id, lead_id, policy_id, kind, status, due_at, requested_by, requested_by_id)
    values (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'packet_check',     'scheduled', now() + interval '7 days',   'system', v_uid),
           (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'review_call',      'scheduled', now() + interval '30 days',  'system', v_uid),
           (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'chargeback_watch', 'scheduled', now() + interval '12 months', 'system', v_uid)
    on conflict do nothing;

    insert into inbound_events (lead_id, agent_id, kind, label, actor_id, actor_name, actor_role)
    values (p_lead, v_lead.assigned_rep_id, 'became_client', 'Became a client', v_uid, v_name, v_role)
    on conflict do nothing;
  end if;

  return v_stage;
end;
$$;

revoke execute on function public.set_inbound_outcome(uuid, text, text) from public, anon;
grant execute on function public.set_inbound_outcome(uuid, text, text) to authenticated;

-- ── 5. agent_submit_service_request ─────────────────────────────────────────
-- 187, with the kind list and the insert changed. Same signature, same refusals in
-- the same order. The policy_events row stays; detail.request_id is now the task id.
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
                                      'draft_date_change', 'lapse_save', 'claim_help', 'carrier_call') then
    raise exception 'Pick what the client needs' using errcode = '22023';
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

-- ── 6. agent_activity_feed ──────────────────────────────────────────────────
-- 191, with the requester joined on requested_by_id and the service_request event
-- skipped: a request shows as its servicing_added row, and that event would read
-- 'Call updated.'. The kinds, the words and the grants are otherwise 191's.
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
           case when pe.detail ->> 'correction' = 'true' then 'outcome' else pe.kind end as kind,
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
           'Servicing task added: ' || replace(t.kind, '_', ' ') || '.',
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
           'Servicing task done: ' || replace(t.kind, '_', ' ') || '.',
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           null, null, null, t.kind, null, null, null, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
     where t.done_at >= p_from and t.done_at < p_to
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
     and (p_agent is null or e.agent_id = p_agent)
   order by e.at desc, e.id desc
   limit greatest(least(coalesce(p_limit, 1000), 5000), 0);
end;
$$;

revoke execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) to authenticated;

-- ── 7. The old table ────────────────────────────────────────────────────────
drop table public.service_requests;

-- ── 8. policy_servicing_status ──────────────────────────────────────────────
create view public.policy_servicing_status with (security_invoker = true) as
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
           when f.lapse_open or f.saved_at is not null then 'needs_attention'
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
                 when 'needs_attention' then x.kind = 'lapse_save'
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
         where s.stage = 'needs_attention' and not s.lapse_open
      ) c
     order by c.due asc nulls last, c.step
     limit 1
  ) n on true;

comment on view public.policy_servicing_status is
  'Each policy''s stage, next step and date. Read-only and security_invoker. See migration 193 for the rules.';

-- ── 9. agent_clients ────────────────────────────────────────────────────────
-- policies is joined only for "newest": the status view doesn't carry created_at.
create view public.agent_clients with (security_invoker = true) as
select s.agent_id,
       s.client_key,
       (array_agg(s.client_first_name order by p.created_at desc, p.id desc))[1] as client_first_name,
       (array_agg(s.client_last_name order by p.created_at desc, p.id desc))[1] as client_last_name,
       (array_agg(s.client_phone order by p.created_at desc, p.id desc))[1] as client_phone,
       count(*)::int as policy_count,
       array_agg(s.policy_id order by p.created_at desc, p.id desc) as policy_ids,
       min(s.next_date) filter (where s.stage <> 'ended') as next_date,
       sum(s.open_requests)::int as open_requests,
       bool_and(s.is_sample) as is_sample,
       case
         when bool_and(s.stage = 'ended') then 'ended'
         when bool_or(s.stage = 'needs_attention') then 'needs_attention'
         when bool_or(s.stage = 'setting_up') then 'setting_up'
         when bool_or(s.stage = 'ongoing') then 'ongoing'
         else 'protected'
       end as stage
  from public.policy_servicing_status s
  join public.policies p on p.id = s.policy_id
 group by s.agent_id, s.client_key;

comment on view public.agent_clients is
  'One row per person in an agent''s book: agent + phone + name. Read-only and security_invoker. See migration 193.';

-- ── 10. Who can read them ───────────────────────────────────────────────────
revoke all on public.policy_servicing_status from public, anon, authenticated, service_role;
revoke all on public.agent_clients from public, anon, authenticated, service_role;
grant select on public.policy_servicing_status to authenticated, service_role;
grant select on public.agent_clients to authenticated, service_role;

-- Check after applying:
--   select relname, reloptions from pg_class where relname in ('policy_servicing_status', 'agent_clients');
--     -- both {security_invoker=true}
--   select count(*) from public.servicing_tasks where requested_by <> 'system';    -- 0 until submit_live
--   select submit_live from public.app_settings where id = 1;                      -- false
