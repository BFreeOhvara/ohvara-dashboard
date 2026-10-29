-- 180 — One inbound record for both products, and Sold → servicing
-- (Agent Portal Rework, build step 1; Brayden approved Oct 29).
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: new columns, one generated column, three tables,
-- indexes, policies, triggers and functions, plus create or replace on three
-- old cold-lead jobs (body copied verbatim, a lead_type filter added). No
-- table, column or type is dropped, renamed or emptied, and no enum value is
-- added.
--
-- APPLY ORDER: 166, 173, 174, 175, then this file. The check below stops the
-- whole file if any of them is missing.
--
-- Why: "Ohvara is a policy servicing company." Inbounds are an add-on with two
-- products, both stored as typed rows in public.leads (Lead Model Decision):
--   Live Calls          lead_type 'policy_help'. The VA qualifies, then
--                       live-transfers to an on-duty agent, else books the
--                       first open slot within the hour.
--   Booked Appointments lead_type 'mortgage_protection'. Form, VA call,
--                       booked, reminders, a no-show is rebooked twice, then
--                       day 0/1/3/7, then monthly.
-- After any appointment or transfer the agent marks Sold / Follow up / Not
-- interested. Sold makes the lead a client and starts servicing: packet check
-- (+7 days), review call (+30 days), chargeback watch (+12 months).
--
-- ── Decisions (the one place they're written down) ─────────────────────────
-- (a) leads.status stays the cancellation pipeline enum (001/015/017/019/021:
--     New, Contacted, No Answer, Follow-Up, Not Interested, Booked). This file
--     doesn't touch it and adds no enum value. status feeds the rep queues
--     and crons, so reusing it for inbounds would let those jobs act on them.
--     The inbound pipeline lives in ONE column, leads.inbound_stage:
--       new, contacting, booked, met, sold, follow_up, lost
--     It is null on cancellation leads (check constraint) and set to 'new' on
--     every typed lead by the sync trigger when nothing sets it.
--     inbound_stage is the single source of truth. 173's agent_status (the
--     hidden Leads page reads it) is derived from it by a BEFORE trigger, so
--     the two can't disagree:
--       new                                → assigned (null while no agent
--                                            holds the lead, as 173's
--                                            assign_lead tests expect)
--       contacting, booked, met, follow_up → contacted
--       sold                               → closed
--       lost                               → bad
--     A write that sets agent_status to anything else is refused (42501),
--     whoever makes it. That includes the hidden Leads page's status buttons
--     (useMpLeads.js), which write agent_status directly. The new agent pages
--     use set_inbound_outcome instead.
--     Agents never write inbound_stage. 173's leads_agent_status_only already
--     refuses any API change except agent_status (so inbound_stage, outcome
--     and the rest are refused). It's re-created here with one change: it
--     also ignores inbound_product. In a BEFORE trigger, a stored generated
--     column reads null in NEW, so without that every agent update on a
--     typed lead would be refused. Only set_inbound_outcome, the service role
--     and server (security definer) functions write inbound_stage.
-- (b) leads.inbound_product is a stored generated column from lead_type:
--     policy_help → live_call, mortgage_protection → booked_appointment,
--     anything else (cancellation, policy_review) → null. There's no second
--     product field to drift.
-- (c) There's no live-call result column. agent_inbounds() (security invoker,
--     so leads RLS applies) returns the caller's typed leads with a derived
--     live_call_result, for Live Calls only (null for Booked Appointments).
--     First match wins:
--       transferred  transfer_status in ('requested', 'connected')
--       booked       va_outcome = 'booked'
--       missed       transfer_status = 'dropped' or va_outcome = 'not_reached'
--       null         anything else
-- (d) The old cold-lead jobs skip inbounds. Each is re-created from its LAST
--     definition, verbatim, with only `lead_type = 'cancellation'` added to
--     every WHERE that selects, counts or updates leads, so no job can requeue,
--     unassign or hand an inbound to another rep:
--       process_lead_queues()      last body 062_no_answer_at.sql
--                                  (cron 'process-lead-queues')
--       assign_daily_batches(int)  last body 071_weekend_leads_pause.sql
--                                  (cron 'daily-batch-assign'; earlier in 016,
--                                  019, 024, 025, 028, 030, 040, 046, 063, 064)
--       request_rep_leads(uuid, int)  last body 071 (147 changes only its
--                                  grants, not its body)
--     Skipped: requeue_no_answer_leads() (017, cron 'requeue-no-answer'). It
--     no longer exists. 019 unscheduled the cron (019:197) and ran
--     `drop function if exists requeue_no_answer_leads();` (019:202).
--     Re-creating it would bring back a retired job, and with no cron and no
--     function nothing can call it. (Its last WHERE was `status = 'No Answer'
--     and no_answer_at is not null and no_answer_at <= now() - interval
--     '4 hours'`.)
--     create or replace keeps each function's owner and grants (147's revokes
--     and request_rep_leads' authenticated grant stay as they are).
--
-- ── What this adds ──────────────────────────────────────────────────────────
--   leads.inbound_stage / inbound_product   (a), (b)
--   leads.outcome          sold, follow_up, not_interested; outcome_at,
--                          outcome_by (profiles)
--   leads.client_policy_id → policies, the policy the agent sold (175's
--                          booking_id stays the appointment row)
--   inbound_events         what happened AND what happens next on an inbound
--                          (state done / scheduled / skipped; at = when). Read
--                          by whoever can read the lead; written only by the
--                          functions here and the service role.
--   servicing_tasks        the work on a client: Sold's three seeds plus
--                          requests (beneficiary, address, payment, ...). One
--                          seed of each kind per lead (unique index).
--   membership_tiers       draft tier names only; every price, ad % and count
--                          is null (prices are Brayden's).
--   app_settings.agent_portal_v2   off by default; turns on the new pages.
--   agent_inbounds()                 (c)
--   set_inbound_outcome(lead, outcome, note)   the agent's Sold / Follow up /
--                          Not interested
--   add_inbound_note(lead, note)
--
-- help_calls (179) is deliberately not referenced here (the brief kept this
-- file independent of it). A later migration links help_calls to leads and
-- inbound_events.
--
-- Adding the stored generated column rewrites public.leads once (a short full
-- lock while it runs).

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_type')
     or not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_typed_assigned_only') then
    raise exception '180 needs 166_lead_types_delivery applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'agent_status')
     or to_regprocedure('public.leads_agent_status_only()') is null
     or to_regprocedure('public.leads_typed_agents_only()') is null then
    raise exception '180 needs 173_lead_storage_assignment applied first';
  end if;
  if to_regclass('public.agent_duty') is null then
    raise exception '180 needs 174_agent_duty applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'transfer_status')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'va_outcome')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'booking_id') then
    raise exception '180 needs 175_va_desk applied first';
  end if;
end $$;

-- ── leads: the inbound record ───────────────────────────────────────────────
alter table public.leads
  add column if not exists inbound_stage text
    check (inbound_stage in ('new', 'contacting', 'booked', 'met', 'sold', 'follow_up', 'lost')),
  add column if not exists outcome text
    check (outcome in ('sold', 'follow_up', 'not_interested')),
  add column if not exists outcome_at timestamptz,
  add column if not exists outcome_by uuid references public.profiles(id) on delete set null,
  add column if not exists client_policy_id uuid references public.policies(id) on delete set null,
  add column if not exists inbound_product text
    generated always as (
      case lead_type
        when 'policy_help' then 'live_call'
        when 'mortgage_protection' then 'booked_appointment'
      end
    ) stored;

-- Cancellation leads carry no inbound stage or outcome.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.leads'::regclass and conname = 'leads_inbound_typed_only') then
    alter table public.leads
      add constraint leads_inbound_typed_only
      check (lead_type <> 'cancellation' or (inbound_stage is null and outcome is null));
  end if;
end $$;

create index if not exists leads_inbound_agent_idx
  on public.leads (assigned_rep_id, inbound_product, inbound_stage);

-- 173's guard, re-created with one change: inbound_product is ignored too (a
-- stored generated column reads null in NEW inside a BEFORE trigger).
create or replace function public.leads_agent_status_only()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if (to_jsonb(new) - 'agent_status' - 'updated_at' - 'inbound_product') is distinct from (to_jsonb(old) - 'agent_status' - 'updated_at' - 'inbound_product') then
      raise exception 'Only the lead status can be changed' using errcode = '42501';
    end if;
    if new.agent_status is null then
      raise exception 'Pick a status' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.leads_agent_status_only() from public, anon, authenticated;

-- inbound_stage → agent_status (decision a). Named to fire after
-- leads_agent_status_only and leads_typed_agents_only (BEFORE triggers run in
-- name order), so it sees the caller's change and the final assigned_rep_id.
create or replace function public.leads_typed_inbound_sync()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
declare
  v_status text;
begin
  if new.lead_type = 'cancellation' then
    return new;
  end if;

  new.inbound_stage := coalesce(new.inbound_stage, 'new');
  v_status := case new.inbound_stage
    when 'new'  then case when new.assigned_rep_id is not null then 'assigned' end
    when 'sold' then 'closed'
    when 'lost' then 'bad'
    else 'contacted'
  end;

  if new.agent_status is distinct from v_status
     and (tg_op = 'INSERT' and new.agent_status is not null
          or tg_op = 'UPDATE' and new.agent_status is distinct from old.agent_status) then
    raise exception 'This lead''s status follows its inbound stage; set the outcome instead'
      using errcode = '42501';
  end if;

  new.agent_status := v_status;
  return new;
end;
$$;

revoke execute on function public.leads_typed_inbound_sync() from public, anon, authenticated;

drop trigger if exists leads_typed_inbound_sync on public.leads;
create trigger leads_typed_inbound_sync
  before insert or update on public.leads
  for each row
  when (new.lead_type <> 'cancellation')
  execute function public.leads_typed_inbound_sync();

-- Typed leads already in the table get a stage from their agent_status (the
-- reverse of the map above; no agent_status → new). Cancellation leads are
-- left alone.
update public.leads
   set inbound_stage = case agent_status
                         when 'contacted' then 'contacting'
                         when 'closed'    then 'sold'
                         when 'bad'       then 'lost'
                         else 'new'
                       end
 where lead_type <> 'cancellation'
   and inbound_stage is null;

-- ── inbound_events: what happened and what happens next ─────────────────────
create table if not exists public.inbound_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  agent_id    uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in (
                'came_in', 'text_sent', 'text_received', 'va_call', 'booked', 'reminder',
                'transferred', 'missed', 'no_show', 'rebooked', 'follow_up', 'outcome',
                'note', 'became_client'
              )),
  state       text not null default 'done' check (state in ('done', 'scheduled', 'skipped')),
  at          timestamptz not null default now(),
  label       text,
  detail      jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text,
  actor_role  text,
  created_at  timestamptz not null default now()
);

create index if not exists inbound_events_lead_at_idx on public.inbound_events (lead_id, at);
-- A lead becomes a client once.
create unique index if not exists inbound_events_became_client_uidx
  on public.inbound_events (lead_id) where kind = 'became_client';

alter table public.inbound_events enable row level security;

-- Whoever can read the lead reads its events. The subquery runs under leads
-- RLS, so 166's restrictive leads_typed_assigned_only keeps it to the
-- assigned agent, Fulfillment and admin.
drop policy if exists inbound_events_select on public.inbound_events;
create policy inbound_events_select on public.inbound_events
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = inbound_events.lead_id));

revoke all on public.inbound_events from public, anon, authenticated;
grant select on public.inbound_events to authenticated;

drop trigger if exists a0_block_inactive_writer on public.inbound_events;
create trigger a0_block_inactive_writer
  before insert or update or delete on public.inbound_events
  for each row execute function public.block_inactive_writer();

-- ── servicing_tasks: the work on a client ───────────────────────────────────
create table if not exists public.servicing_tasks (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.profiles(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete cascade,
  policy_id     uuid references public.policies(id) on delete cascade,
  kind          text not null check (kind in (
                  'packet_check', 'review_call', 'chargeback_watch', 'beneficiary_change',
                  'address_change', 'payment_change', 'draft_date_change', 'lapse_save',
                  'conversion', 'annual_review', 'claim_help', 'carrier_call'
                )),
  status        text not null default 'requested'
                  check (status in ('requested', 'scheduled', 'done', 'cancelled')),
  due_at        timestamptz,
  done_at       timestamptz,
  requested_by  uuid references public.profiles(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  constraint servicing_tasks_target check (lead_id is not null or policy_id is not null)
);

-- Sold seeds each of these once per lead.
create unique index if not exists servicing_tasks_sold_seed_uidx
  on public.servicing_tasks (lead_id, kind)
  where kind in ('packet_check', 'review_call', 'chargeback_watch');
create index if not exists servicing_tasks_agent_due_idx
  on public.servicing_tasks (agent_id, status, due_at);

alter table public.servicing_tasks enable row level security;

drop policy if exists servicing_tasks_select on public.servicing_tasks;
create policy servicing_tasks_select on public.servicing_tasks
  for select to authenticated
  using (agent_id = auth.uid() or public.is_fulfillment() or public.is_admin());

revoke all on public.servicing_tasks from public, anon, authenticated;
grant select on public.servicing_tasks to authenticated;

drop trigger if exists a0_block_inactive_writer on public.servicing_tasks;
create trigger a0_block_inactive_writer
  before insert or update or delete on public.servicing_tasks
  for each row execute function public.block_inactive_writer();

-- ── membership_tiers ────────────────────────────────────────────────────────
create table if not exists public.membership_tiers (
  key                   text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name                  text not null,
  product_keys          text[] not null default '{}'
                          check (product_keys <@ array['cancellations', 'servicing', 'booked_appointments', 'live_calls']::text[]),
  price_cents           integer check (price_cents >= 0),
  ad_pct                numeric(5, 2) check (ad_pct between 0 and 100),
  monthly_appointments  integer check (monthly_appointments >= 0),
  description           text,
  sort_order            integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.membership_tiers enable row level security;

drop policy if exists membership_tiers_select on public.membership_tiers;
create policy membership_tiers_select on public.membership_tiers
  for select to authenticated
  using (is_active or public.is_admin());

drop policy if exists membership_tiers_admin_insert on public.membership_tiers;
create policy membership_tiers_admin_insert on public.membership_tiers
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists membership_tiers_admin_update on public.membership_tiers;
create policy membership_tiers_admin_update on public.membership_tiers
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No delete: a tier is retired with is_active = false.
revoke all on public.membership_tiers from public, anon, authenticated;
grant select, insert, update on public.membership_tiers to authenticated;

drop trigger if exists membership_tiers_updated_at on public.membership_tiers;
create trigger membership_tiers_updated_at
  before update on public.membership_tiers
  for each row execute function public.set_updated_at();

-- DRAFTS: Brayden's four working names. Every price, ad % and appointment
-- count stays null on purpose. The prices are his to set.
insert into public.membership_tiers (key, name, product_keys, sort_order) values
  ('cancellations',          'Cancellations',            array['cancellations'],                    10),
  ('servicing',              'Servicing',                array['servicing'],                        20),
  ('servicing_appointments', 'Servicing + Appointments', array['servicing', 'booked_appointments'], 30),
  ('servicing_live_calls',   'Servicing + Live Calls',   array['servicing', 'live_calls'],          40)
on conflict (key) do nothing;

-- ── app_settings: the new agent portal switch ───────────────────────────────
alter table public.app_settings
  add column if not exists agent_portal_v2 boolean not null default false;

-- ── agent_inbounds(): the agent's inbound list ──────────────────────────────
-- security invoker: runs under leads RLS, so an agent only ever sees their own
-- typed leads. live_call_result per decision (c).
create or replace function public.agent_inbounds()
returns table (
  lead_id uuid, lead_type text, inbound_product text, inbound_stage text,
  outcome text, outcome_at timestamptz, live_call_result text,
  contact_name text, phone text, city text, state text, lead_source text,
  qualifier_answers jsonb, transfer_status text, transferred_at timestamptz,
  va_outcome text, booking_id uuid, client_policy_id uuid,
  delivered_at timestamptz, created_at timestamptz
)
language sql
stable security invoker
set search_path = public
as $$
  select l.id, l.lead_type, l.inbound_product, l.inbound_stage,
         l.outcome, l.outcome_at,
         case
           when l.inbound_product is distinct from 'live_call' then null
           when l.transfer_status in ('requested', 'connected') then 'transferred'
           when l.va_outcome = 'booked' then 'booked'
           when l.transfer_status = 'dropped' or l.va_outcome = 'not_reached' then 'missed'
         end,
         coalesce(l.contact_name, l.business_name), l.phone, l.city, l.state, l.lead_source,
         l.qualifier_answers, l.transfer_status, l.transferred_at,
         l.va_outcome, l.booking_id, l.client_policy_id,
         l.delivered_at, l.created_at
    from public.leads l
   where l.assigned_rep_id = auth.uid()
     and l.lead_type <> 'cancellation'
   order by coalesce(l.delivered_at, l.created_at) desc;
$$;

revoke execute on function public.agent_inbounds() from public, anon;
grant execute on function public.agent_inbounds() to authenticated;

-- ── set_inbound_outcome(): Sold / Follow up / Not interested ────────────────
-- The lead's assigned agent (active) or admin. Writes the outcome and the
-- stage (sold → sold, follow_up → follow_up, not_interested → lost) and logs
-- an 'outcome' event. Sold also seeds the three servicing tasks (once each)
-- and logs 'became_client' once. Returns the new inbound_stage.
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
  if not found or not (
    public.is_admin()
    or (v_lead.assigned_rep_id = v_uid
        and exists (select 1 from profiles where id = v_uid and is_active))
  ) then
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
    insert into servicing_tasks (agent_id, lead_id, policy_id, kind, status, due_at, requested_by)
    values (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'packet_check',     'scheduled', now() + interval '7 days',   v_uid),
           (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'review_call',      'scheduled', now() + interval '30 days',  v_uid),
           (v_lead.assigned_rep_id, p_lead, v_lead.client_policy_id, 'chargeback_watch', 'scheduled', now() + interval '12 months', v_uid)
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

-- ── add_inbound_note() ──────────────────────────────────────────────────────
-- Same caller rule as set_inbound_outcome. Returns the new event's id.
create or replace function public.add_inbound_note(p_lead uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_lead record;
  v_name text;
  v_role text;
  v_id   uuid;
begin
  if p_lead is null then
    raise exception 'lead is required' using errcode = '22004';
  end if;
  if v_note is null then
    raise exception 'Write the note first' using errcode = '22023';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Keep the note under 2000 characters' using errcode = '22023';
  end if;

  select id, lead_type, assigned_rep_id into v_lead from leads where id = p_lead;
  if not found or not (
    public.is_admin()
    or (v_lead.assigned_rep_id = v_uid
        and exists (select 1 from profiles where id = v_uid and is_active))
  ) then
    if not found and public.is_admin() then
      raise exception 'Lead not found' using errcode = 'P0002';
    end if;
    raise exception 'Only the lead''s agent can do this' using errcode = '42501';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'This is not an inbound lead' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
    into v_name, v_role
    from profiles where id = v_uid;

  insert into inbound_events (lead_id, agent_id, kind, label, detail, actor_id, actor_name, actor_role)
  values (p_lead, v_lead.assigned_rep_id, 'note', 'Note', jsonb_build_object('note', v_note),
          v_uid, v_name, v_role)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_inbound_note(uuid, text) from public, anon;
grant execute on function public.add_inbound_note(uuid, text) to authenticated;

-- ── old cold-lead jobs: cancellation leads only (decision d) ────────────────
-- process_lead_queues: 062's body; the follow-up return now needs
-- lead_type = 'cancellation'.
CREATE OR REPLACE FUNCTION process_lead_queues()
RETURNS TABLE (redistributed int, followups_returned int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  q record;
  n_fu int := 0;
BEGIN
  -- Follow-ups due: back to the SAME rep at the scheduled time.
  FOR q IN
    SELECT id, lead_id, rep_id FROM follow_up_queue
    WHERE follow_up_at <= now() AND reminded_at IS NULL AND completed_at IS NULL
  LOOP
    UPDATE leads
    SET assigned_rep_id = COALESCE(q.rep_id, assigned_rep_id),
        batch_date = current_date,
        status = 'New'
    WHERE id = q.lead_id AND status = 'Follow-Up' and lead_type = 'cancellation';
    IF FOUND THEN n_fu := n_fu + 1; END IF;
    UPDATE follow_up_queue SET reminded_at = now() WHERE id = q.id;
  END LOOP;

  -- No Answer redistribution is handled by redistribute-no-answers edge function.
  redistributed := 0;
  followups_returned := n_fu;
  RETURN NEXT;
END;
$$;

-- assign_daily_batches: 071's body; every count, select and update of leads
-- now needs lead_type = 'cancellation'.
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
    where assigned_rep_id = rep.id and batch_date = current_date and lead_type = 'cancellation';

    -- 2. roll over the rep's own unworked leads from previous days
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status = 'New'
          and lead_type = 'cancellation'
        order by batch_date desc
        limit needed
      ) and lead_type = 'cancellation';
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date and lead_type = 'cancellation';
    end if;

    -- 3. top up from the unassigned pool
    if needed > 0 then
      update leads set assigned_rep_id = rep.id, batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id is null and status = 'New'
          and lead_type = 'cancellation'
        order by created_at
        limit needed
      ) and lead_type = 'cancellation';
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date and lead_type = 'cancellation';
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
          and lead_type = 'cancellation'
        order by batch_date desc, updated_at desc
        limit needed
      ) and lead_type = 'cancellation';
    end if;

    update profiles set last_batch_assigned_local_date = rep_local_date where id = rep.id;

    rep_id := rep.id;
    select count(*) into batch_count
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date and lead_type = 'cancellation';
    return next;
  end loop;
end;
$$;

-- request_rep_leads: 071's body; the count, the pick and the update now need
-- lead_type = 'cancellation'.
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
  where assigned_rep_id = p_rep_id and batch_date = current_date and lead_type = 'cancellation';

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
      and lead_type = 'cancellation'
    order by created_at asc
    limit p_count
  ) and lead_type = 'cancellation';

  get diagnostics v_assigned = row_count;
  return v_assigned;
end;
$$;

-- Check after applying:
--   select r, has_function_privilege(r, 'public.set_inbound_outcome(uuid, text, text)', 'execute')
--     from unnest(array['anon', 'authenticated']) r;          -- anon false, authenticated true
--   select tablename, rowsecurity from pg_tables
--    where tablename in ('inbound_events', 'servicing_tasks', 'membership_tiers');   -- all true
--   select key, price_cents, ad_pct, monthly_appointments from public.membership_tiers;  -- all null
