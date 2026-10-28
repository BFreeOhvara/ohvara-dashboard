-- 162 — assign_lead: hand a new typed lead to an opted-in agent and charge it.
-- Money + RLS-adjacent: goes to Brayden's door. Written only; never applied
-- from a worktree.
--
-- Replaces the earlier 162 (branch atlas/b2b96152), which made its own ledger
-- (agent_balance_ledger) and assigned leads in the old Meta-only table. There
-- is one ledger for lead charges: agent_lead_ledger (169), charged through
-- charge_lead on leads (171). This file keeps the old assign function, pointed
-- at leads and that ledger, and adds nothing else to the money side.
--
-- APPLY ORDER: after 161, 166_lead_types_delivery (leads.lead_type,
-- delivered_at), 169_prepaid_lead_balance (agent_lead_ledger,
-- price_per_lead_cents) and 171_charge_lead_on_leads (charge_lead on leads).
-- The check below stops the whole file if any of them is missing.
--
--   assign_lead(lead_id)   service role only. Picks the next opted-in agent for
--                          the lead's state (round-robin, daily cap, balance at
--                          least the price for its lead_type), sets
--                          assigned_rep_id, delivered_at and agent_status, then
--                          charge_lead. Returns the agent, or null when nobody
--                          qualifies or no price is set for the type (the lead
--                          stays unassigned; never delivered free by mistake).
--   leads_typed_agents_only   trigger: a typed lead (anything but
--                          'cancellation') can only be assigned to an active
--                          agent. The cancellation rep batch
--                          (assign_daily_batches, 071) and request_rep_leads
--                          (147) take any unassigned 'New' lead; this keeps a
--                          Meta or Google lead out of a rep's batch.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_type')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'agent_status')
     or to_regclass('public.agent_lead_ledger') is null
     or to_regprocedure('public.charge_lead(uuid)') is null then
    raise exception '162 needs 161, 166, 169 and 171 applied first';
  end if;
end $$;

-- ── assignment ──────────────────────────────────────────────────────────────
-- Safe to call again: an assigned lead returns its agent, and charge_lead
-- charges a lead once (unique index in 169). Round-robin: among qualifying
-- agents, the one whose last lead charge is oldest (never charged first), ties
-- by agent_id; the global assign lock keeps that order consistent. The daily
-- cap counts lead charges since midnight Central.
create or replace function public.assign_lead(p_lead_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_lead      record;
  v_state     text;
  v_price     integer;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Chicago')) at time zone 'America/Chicago';
  v_agent     uuid;
  v_balance   bigint;
  v_result    text;
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

  select (c.price_per_lead_cents -> v_lead.lead_type)::numeric::integer into v_price
    from recovery_config c where c.id;
  if v_price is null or v_price <= 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assign_lead', 0));

  for v_agent in
    select s.agent_id
      from agent_lead_settings s
      join profiles p on p.id = s.agent_id and p.role = 'agent' and p.is_active
      left join lateral (
        select count(*) filter (where l.created_at >= v_day_start) as today,
               max(l.created_at) as last_at
          from agent_lead_ledger l
         where l.agent_id = s.agent_id and l.kind = 'lead_charge'
      ) c on true
     where s.active
       and exists (select 1 from unnest(s.states) st where upper(btrim(st)) = v_state)
       and (s.daily_cap is null or c.today < s.daily_cap)
     order by c.last_at asc nulls first, s.agent_id
  loop
    perform agent_lead_ledger_lock(v_agent);
    select coalesce(sum(amount_cents), 0) into v_balance
      from agent_lead_ledger where agent_id = v_agent;
    if v_balance >= v_price then
      update leads
         set assigned_rep_id = v_agent, delivered_at = now(), agent_status = 'assigned'
       where id = p_lead_id;
      select r.result into v_result from charge_lead(p_lead_id) r;
      if v_result is distinct from 'charged' then
        -- Unreachable under the locks above; raising undoes the assignment so
        -- nobody gets a lead without paying for it.
        raise exception 'charge_lead for % returned %', p_lead_id, v_result using errcode = '40001';
      end if;
      return v_agent;
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.assign_lead(uuid) from public, anon, authenticated;
grant  execute on function public.assign_lead(uuid) to service_role;

-- ── typed leads go to agents only ───────────────────────────────────────────
-- Leaves the assignment as it was when the new assignee isn't an active agent,
-- rather than raising, so a rep batch that sweeps the pool keeps running.
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

create trigger leads_typed_agents_only
  before update of assigned_rep_id on public.leads
  for each row
  when (new.lead_type <> 'cancellation' and new.assigned_rep_id is distinct from old.assigned_rep_id)
  execute function public.leads_typed_agents_only();

-- Check after applying (expect only service_role true):
--   select r, has_function_privilege(r, 'public.assign_lead(uuid)', 'execute')
--     from unnest(array['anon', 'authenticated', 'service_role']) r;
