-- 173 — Lead storage + assignment for typed leads (Roadmap Goal 2). No charge.
--
-- NOT APPLIED until the door approves. Written from a worktree; applying it is
-- a separate, checked step. Additive only: one table, columns, indexes,
-- policies, functions and triggers, each created only if it isn't there yet.
-- Nothing is dropped, renamed, truncated or deleted.
--
-- Lead model (Lead Model Decision, Goal 1): one table, public.leads, typed by
-- leads.lead_type (166_lead_types_delivery). A /protect lead is lead_type
-- 'mortgage_protection', lead_source 'meta', written by submit-mp-lead with
-- the service role. There is no separate mp_leads table.
--
-- APPLY ORDER: 166, then this file. The check below stops the whole file if
-- 166 is missing.
--
-- This file holds everything Goal 2 needs from master's unapplied 161 and 162,
-- minus the money:
--   * 161_agent_lead_settings.sql: agent_lead_settings, leads.agent_status and
--     the repeat-phone index are repeated here with the same names, so 161 is
--     not needed. Applied after this file, 161 stops at its first
--     create policy (already exists) and changes nothing.
--   * 162_assign_lead.sql is Goal 3's version of assign_lead, which charges. This file's assign_lead has the same name and
--     signature and no charge; it refuses to run if a charging assign_lead is
--     already in place, so it can never turn a paid assignment into a free one.
--
--   agent_lead_settings   one row per agent: opted in (off by default), which
--                         states, daily cap (null = no cap). The agent reads,
--                         inserts and updates only their own row.
--   leads.agent_status    the agent's own status on a typed lead: assigned,
--                         contacted, closed, bad. leads.status stays the
--                         cancellation pipeline enum (it feeds the rep queues).
--   leads (phone, created_at)   the 30-day repeat-phone check submit-mp-lead
--                         runs before every insert.
--   assign_lead(lead_id)  service role only. Hands a typed lead to one opted-in
--                         agent for its state who is under their daily cap.
--   typed-lead guards     no anon/authenticated insert of a typed lead; an
--                         agent updates only agent_status, only on their own
--                         typed lead; a typed lead goes to agents only.
--
-- Reading: an agent reads only their own typed leads through 166's restrictive
-- leads_typed_assigned_only (assigned agent, Fulfillment or admin).

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_type')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'delivered_at')
     or not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_typed_assigned_only') then
    raise exception '173 needs 166_lead_types_delivery applied first';
  end if;
  if exists (select 1 from pg_proc
              where oid = to_regprocedure('public.assign_lead(uuid)') and prosrc ~ 'charge_lead') then
    raise exception '173 would replace the charging assign_lead (162); stop and ask';
  end if;
end $$;

-- ── agent settings ──────────────────────────────────────────────────────────
create table if not exists public.agent_lead_settings (
  agent_id    uuid primary key references public.profiles(id) on delete cascade,
  active      boolean not null default false,
  states      text[] not null default '{}'
                check (array_to_string(states, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  daily_cap   integer check (daily_cap between 0 and 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.agent_lead_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'agent_lead_settings' and policyname = 'als_select') then
    create policy als_select on public.agent_lead_settings
      for select to authenticated using (agent_id = auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'agent_lead_settings' and policyname = 'als_insert') then
    create policy als_insert on public.agent_lead_settings
      for insert to authenticated with check (agent_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'agent_lead_settings' and policyname = 'als_update') then
    create policy als_update on public.agent_lead_settings
      for update to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());
  end if;
end $$;

-- No delete policy or grant: turning delivery off is active = false.
revoke all on public.agent_lead_settings from public, anon, authenticated;
grant select, insert on public.agent_lead_settings to authenticated;
grant update (active, states, daily_cap, updated_at) on public.agent_lead_settings to authenticated;

-- ── agent status on a delivered lead ────────────────────────────────────────
alter table public.leads
  add column if not exists agent_status text
    check (agent_status in ('assigned', 'contacted', 'closed', 'bad'));

-- ── indexes ─────────────────────────────────────────────────────────────────
-- The 30-day repeat-phone check (same definition as 161's).
create index if not exists leads_phone_created_idx
  on public.leads (phone, created_at desc) where phone is not null;
-- Each agent's typed leads by delivery time: the daily cap and fairness counts.
create index if not exists leads_assigned_delivered_idx
  on public.leads (assigned_rep_id, delivered_at desc) where delivered_at is not null;

-- ── who may write a typed lead ──────────────────────────────────────────────
-- Restrictive, so they narrow the existing permissive policies (001). Note
-- 001's leads_rep_update also lets any 'closer' update any lead, and 107
-- renamed 'closer' to 'agent', so without this every agent could edit every
-- lead. The service role (submit-mp-lead, agent-api) bypasses RLS.
do $$
begin
  -- Typed leads are written by the service role only.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'leads' and policyname = 'leads_typed_insert_service_only') then
    create policy leads_typed_insert_service_only on public.leads
      as restrictive
      for insert to anon, authenticated
      with check (lead_type = 'cancellation');
  end if;
  -- A typed lead is updated only by its agent (or admin).
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'leads' and policyname = 'leads_typed_update_assigned_only') then
    create policy leads_typed_update_assigned_only on public.leads
      as restrictive
      for update to anon, authenticated
      using (lead_type = 'cancellation' or assigned_rep_id = auth.uid() or public.is_admin())
      with check (lead_type = 'cancellation' or assigned_rep_id = auth.uid() or public.is_admin());
  end if;
end $$;

-- RLS can't limit columns per row, so a trigger does: from the API, an agent
-- changes agent_status on a typed lead and nothing else (updated_at is set by
-- leads_updated_at). Server-side SECURITY DEFINER functions run as their owner
-- and pass; so does admin. Named to fire before the other BEFORE UPDATE
-- triggers on leads (name order), so it sees only the caller's own change.
create or replace function public.leads_agent_status_only()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if (to_jsonb(new) - 'agent_status' - 'updated_at') is distinct from (to_jsonb(old) - 'agent_status' - 'updated_at') then
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

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.leads'::regclass and tgname = 'leads_agent_status_only') then
    create trigger leads_agent_status_only
      before update on public.leads
      for each row
      when (old.lead_type <> 'cancellation' or new.lead_type <> 'cancellation')
      execute function public.leads_agent_status_only();
  end if;
end $$;

-- ── typed leads go to agents only ───────────────────────────────────────────
-- The cancellation rep batch (assign_daily_batches, 071) and request_rep_leads
-- (147) take any unassigned 'New' lead, which includes a typed lead nobody
-- qualified for. This keeps a consumer's lead out of a rep's batch: the
-- assignment stays as it was when the new assignee isn't an active agent
-- (no error, so the batch sweep keeps running). Same function and trigger as
-- 162's.
create or replace function public.leads_typed_agents_only()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if new.assigned_rep_id is not null and not exists (
    select 1 from profiles where id = new.assigned_rep_id and role = 'agent' and is_active
  ) then
    new.assigned_rep_id := old.assigned_rep_id;
    new.batch_date := old.batch_date;
  end if;
  return new;
end;
$$;

revoke execute on function public.leads_typed_agents_only() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.leads'::regclass and tgname = 'leads_typed_agents_only') then
    create trigger leads_typed_agents_only
      before update of assigned_rep_id on public.leads
      for each row
      when (new.lead_type <> 'cancellation' and new.assigned_rep_id is distinct from old.assigned_rep_id)
      execute function public.leads_typed_agents_only();
  end if;
end $$;

-- ── assignment ──────────────────────────────────────────────────────────────
-- Picks one agent who is opted in (active), is an active 'agent' profile, has
-- the lead's state in their states and is under their daily cap (null = no
-- cap; the day is midnight to midnight America/Chicago). Fair: fewest typed
-- leads delivered today, then the oldest last delivery (never delivered
-- first), then agent_id. Sets assigned_rep_id, delivered_at and agent_status
-- 'assigned' and returns the agent. Nobody qualifies, or no state: returns null
-- and the lead stays new with no agent.
--
-- Two calls at once: the lead row is locked first, so a second call for the
-- same lead waits, then sees it assigned and returns that agent (a lead is
-- never assigned twice). Then a transaction lock serializes the pick, so two
-- different leads can't both take an agent's last slot under the cap. Not
-- skip locked: with one opted-in agent, two leads at once would leave the
-- second unassigned.
create or replace function public.assign_lead(p_lead_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_lead      record;
  v_state     text;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Chicago')) at time zone 'America/Chicago';
  v_agent     uuid;
begin
  if p_lead_id is null then
    raise exception 'lead_id is required' using errcode = '22004';
  end if;

  select id, state, lead_type, assigned_rep_id into v_lead
    from leads where id = p_lead_id
    for update;
  if not found then
    raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
  end if;
  if v_lead.lead_type = 'cancellation' then
    raise exception 'Lead % is a cancellation lead', p_lead_id using errcode = '22023';
  end if;
  if v_lead.assigned_rep_id is not null then
    return v_lead.assigned_rep_id;
  end if;

  v_state := upper(btrim(v_lead.state));
  if v_state is null or v_state = '' then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assign_lead', 0));

  select s.agent_id into v_agent
    from agent_lead_settings s
    join profiles p on p.id = s.agent_id and p.role = 'agent' and p.is_active
    cross join lateral (
      select count(*) filter (where l.delivered_at >= v_day_start) as today,
             max(l.delivered_at) as last_at
        from leads l
       where l.assigned_rep_id = s.agent_id
         and l.lead_type <> 'cancellation'
         and l.delivered_at is not null
    ) c
   where s.active
     and v_state = any (s.states)
     and (s.daily_cap is null or c.today < s.daily_cap)
   order by c.today, c.last_at asc nulls first, s.agent_id
   limit 1;

  if v_agent is null then
    return null;
  end if;

  -- per-lead charge is added by the prepaid-balance goal (Goal 3)
  update leads
     set assigned_rep_id = v_agent, delivered_at = now(), agent_status = 'assigned'
   where id = p_lead_id and assigned_rep_id is null;

  return v_agent;
end;
$$;

revoke execute on function public.assign_lead(uuid) from public, anon, authenticated;
grant  execute on function public.assign_lead(uuid) to service_role;

-- Check after applying (expect only service_role true):
--   select r, has_function_privilege(r, 'public.assign_lead(uuid)', 'execute')
--     from unnest(array['anon', 'authenticated', 'service_role']) r;
--   select policyname, permissive, roles, cmd from pg_policies
--    where tablename in ('leads', 'agent_lead_settings') order by 1;
