-- 148 — Fulfillment hardening, area 1: what a rep can see (Prompt 769-1).
--
-- Before this, every Fulfillment rep could read every call handed to
-- Fulfillment (client names, phones, notes) and every call's thread, not just
-- their own. The portal already filtered to "mine" on screen; now the
-- database does too. A rep clicking normally sees no change.

-- ── Calls: a rep reads only the calls assigned to them ─────────────────────
-- Admin still sees everything through policies_select (can_view_agent).
drop policy if exists fulfillment_select_assigned on public.policies;
create policy fulfillment_select_assigned on public.policies
  for select using (
    fulfillment_assigned = true
    and assigned_fulfillment_id = auth.uid()
    and public.is_fulfillment()
  );

-- ── Call history: the calls you can see, plus what you did yourself ────────
-- A call that was passed on leaves the old rep's view, but their own results
-- on it still count on their Overview.
drop policy if exists policy_events_select on public.policy_events;
create policy policy_events_select on public.policy_events
  for select using (
    exists (select 1 from public.policies p where p.id = policy_events.policy_id)
    or actor_id = auth.uid()
  );

-- ── Call threads: the agent, an admin, or the rep it's assigned to ─────────
-- Was: any Fulfillment rep, on any call.
create or replace function public.can_message_policy(pid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select exists (
    select 1 from public.policies p
    where p.id = pid
      and p.fulfillment_assigned = true
      and (
        p.agent_id = auth.uid()
        or public.is_admin()
        or (p.assigned_fulfillment_id = auth.uid() and public.is_fulfillment())
      )
  )
$$;

-- ── Company-wide commission rows: agents and admin only ────────────────────
-- Nothing in the app calls this any more; it stays for the agent team views
-- but a rep (or anyone else) gets no rows.
create or replace function public.team_performance_policies()
 returns table(id uuid, agent_id uuid, agent_name text, agent_avatar_url text, agent_avatar_color text,
               policy_sold_date date, effective_date date, monthly_premium numeric, annual_premium numeric,
               status policy_status, cancellation_status cancellation_status, cancellation_call_at timestamp with time zone,
               created_at timestamp with time zone, estimated_commission numeric, is_pending_commission boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select
    p.id, p.agent_id, pr.full_name, pr.avatar_url, pr.avatar_color,
    p.policy_sold_date, p.effective_date,
    p.monthly_premium, p.annual_premium,
    p.status, p.cancellation_status, p.cancellation_call_at,
    p.created_at,
    p.estimated_commission,
    (p.estimated_commission is null and p.carrier_name in ('Aflac', 'Baltimore Life', 'Chubb')) as is_pending_commission
  from policies p
  join profiles pr on pr.id = p.agent_id
  where public.is_team_member();
$$;
