-- Team activity tab (Prompt 671).
--
-- Agents should see what the rest of the team is doing (who booked a call,
-- whose client's cancellation went through, when) without seeing those
-- clients. policies RLS (can_view_agent) only lets an agent read their own
-- rows + downline, and widening it would hand every agent every teammate's
-- client names and phone numbers. So instead of touching RLS, this is one
-- SECURITY DEFINER function that returns a fixed, already-stripped shape:
--
--   kind ('booked' | 'cancelled'), at, agent_id, agent first name, avatar.
--
-- No client name, phone, carrier, policy id or Fulfillment rep comes back —
-- there is no column to leak. Avatar url/colour and the name come from
-- profiles, which every signed-in user can already read (profiles_select),
-- so nothing new about the agent is exposed either.
--
-- Callers: agents and admin only (is_team_member). Fulfillment and anon get
-- nothing. Window is clamped to the last 35 days — enough for "this week"
-- and a 7-day feed, not a history export. Only active role='agent' profiles
-- count; test accounts are filtered client-side (src/lib/testAccounts.js),
-- same as every other team-wide rollup.

create or replace function public.team_activity(p_since timestamptz default now() - interval '7 days')
returns table (
  kind text,
  at timestamptz,
  agent_id uuid,
  agent_first_name text,
  avatar_url text,
  avatar_color text
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '35 days') as since
  ),
  events as (
    select 'booked'::text as kind, p.created_at as at, p.agent_id
    from policies p, bounds b
    where p.fulfillment_assigned = true
      and p.created_at >= b.since
    union all
    select 'cancelled'::text, p.fulfillment_completed_at, p.agent_id
    from policies p, bounds b
    where p.fulfillment_assigned = true
      and p.fulfillment_stage = 'Complete'
      and p.fulfillment_completed_at >= b.since
  )
  select e.kind, e.at, e.agent_id,
         split_part(coalesce(nullif(trim(pr.full_name), ''), 'Agent'), ' ', 1),
         pr.avatar_url, pr.avatar_color
  from events e
  join profiles pr on pr.id = e.agent_id
  where public.is_team_member()
    and pr.role = 'agent'
    and pr.is_active
  order by e.at desc
  limit 500;
$$;

revoke all on function public.team_activity(timestamptz) from public, anon;
grant execute on function public.team_activity(timestamptz) to authenticated;
