-- 170 — VA call-qualify desk.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only. Needs 161 (leads.lead_type, lead_source,
-- qualifier_answers; commit 17b40ab, not in this branch) applied first.
--
-- The agent id goes in leads.transfer_agent_id only. leads.assigned_rep_id is
-- the rep batch-assignment column (migration 016/019 daily batch, rep RLS), so
-- nothing here writes it.
--
-- Touches RLS: two new insert policies (policies_insert_va,
-- fulfillment_details_insert_va). Brayden approves those.
--
-- A Fulfillment rep (the VA) answers an inbound policy-help call, runs the
-- qualify checklist and either saves the lead, books the client on an
-- agent's calendar, or marks a live transfer. Nothing here calls or texts
-- anyone: a transfer is only a record (the chosen agent and a status).
--
--   * leads.transfer_agent_id / transfer_status / transferred_at: the record.
--   * va_agent_roster(): the active agents a VA can pick (id + name only).
--   * va_save_policy_help_lead(): creates the lead (lead_type 'policy_help',
--     lead_source 'google', the checklist in qualifier_answers).
--   * va_set_lead_outcome(): marks the lead booked / transfer requested.
--   * Two insert policies so a VA's booking lands on the chosen agent's
--     calendar through the existing useBookCall insert.

alter table public.leads
  add column if not exists transfer_agent_id uuid references public.profiles(id) on delete set null,
  add column if not exists transfer_status text
    check (transfer_status is null or transfer_status in ('requested', 'connected', 'dropped')),
  add column if not exists transferred_at timestamptz;

-- ── Roster ──────────────────────────────────────────────────────────────────
create or replace function public.va_agent_roster()
returns table (id uuid, full_name text)
language sql
stable security definer
set search_path to 'public'
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.role = 'agent' and p.is_active
    and (public.is_fulfillment() or public.is_admin())
  order by p.full_name
$$;
grant execute on function public.va_agent_roster() to authenticated;

-- ── Save the lead ───────────────────────────────────────────────────────────
-- p_outcome: 'saved' (just the lead) or 'transfer' (also records p_agent and
-- transfer_status 'requested'). Returns the new lead id.
create or replace function public.va_save_policy_help_lead(
  p_first text, p_last text, p_phone text, p_city text, p_state text,
  p_answers jsonb, p_outcome text default 'saved', p_agent uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can save a call' using errcode = '42501';
  end if;
  if coalesce(trim(p_first), '') = '' or coalesce(trim(p_last), '') = '' then
    raise exception 'First and last name are needed';
  end if;
  if p_outcome not in ('saved', 'transfer') then
    raise exception 'Unknown outcome %', p_outcome;
  end if;
  if p_outcome = 'transfer' and p_agent is null then
    raise exception 'Pick the agent for the transfer';
  end if;
  if p_agent is not null and not exists (
    select 1 from public.profiles where id = p_agent and role = 'agent' and is_active
  ) then
    raise exception 'That agent is not available';
  end if;

  insert into public.leads (
    business_name, contact_name, phone, city, state,
    lead_type, lead_source, qualifier_answers,
    transfer_agent_id, transfer_status, transferred_at
  ) values (
    trim(p_first) || ' ' || trim(p_last), trim(p_first) || ' ' || trim(p_last),
    nullif(trim(p_phone), ''), nullif(trim(p_city), ''), nullif(trim(p_state), ''),
    'policy_help', 'google', coalesce(p_answers, '{}'::jsonb),
    case when p_outcome = 'transfer' then p_agent end,
    case when p_outcome = 'transfer' then p_agent end,
    case when p_outcome = 'transfer' then 'requested' end,
    case when p_outcome = 'transfer' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.va_save_policy_help_lead(text, text, text, text, text, jsonb, text, uuid) to authenticated;

-- ── Mark a saved lead booked on an agent's calendar ─────────────────────────
create or replace function public.va_set_lead_outcome(p_lead uuid, p_agent uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_fulfillment() or public.is_admin()) then
    raise exception 'Only Fulfillment can update a call' using errcode = '42501';
  end if;
  update public.leads
     set transfer_agent_id = p_agent
   where id = p_lead and lead_type = 'policy_help';
end;
$$;
grant execute on function public.va_set_lead_outcome(uuid, uuid) to authenticated;

-- ── Booking for an agent ────────────────────────────────────────────────────
-- policies_insert (149) is agent_id = auth.uid(). A VA may also insert a row
-- for an active agent; the row is the same one useBookCall always writes.
create policy policies_insert_va on public.policies
  for insert to authenticated
  with check (
    public.is_fulfillment()
    and exists (select 1 from public.profiles a where a.id = policies.agent_id and a.role = 'agent' and a.is_active)
  );

create policy fulfillment_details_insert_va on public.policy_fulfillment_details
  for insert to authenticated
  with check (
    public.is_fulfillment()
    and exists (select 1 from public.policies p where p.id = policy_fulfillment_details.policy_id and p.fulfillment_assigned)
  );
