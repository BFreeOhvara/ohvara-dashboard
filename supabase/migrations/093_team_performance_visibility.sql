-- Prompt 396: Performance's Team toggle and Leaderboard were computed
-- client-side straight off `usePolicies(null)`, which is scoped by
-- policies_select -> can_view_agent (self + downline, or everything for
-- admin — migration 072). Admin's "everything" made both features look
-- correct only from Brayden's own account; a real closer has no downline,
-- so their Team toggle and Leaderboard silently saw just their own single
-- row. Confirmed against can_view_agent's own definition, not guessed.
--
-- Fix is NOT loosening policies_select — that would let any agent read
-- every other agent's client_first_name/client_last_name/client_phone/
-- policy_number, recreating Prompt 379's leak company-wide instead of
-- admin-only. Instead: a SECURITY DEFINER function that returns only the
-- non-PII fields Production's Team scope and the Leaderboard actually
-- aggregate (usePolicies.js's productionSnapshot/productionFlow/
-- persistencyWindows + Performance.jsx's standings reducer) — no client
-- name, phone, policy number, carrier, product, or notes.
create or replace function public.team_performance_policies()
returns table (
  id                    uuid,
  agent_id              uuid,
  agent_name            text,
  policy_sold_date      date,
  effective_date        date,
  monthly_premium       numeric(10,2),
  annual_premium        numeric(12,2),
  status                policy_status,
  cancellation_status   cancellation_status,
  cancellation_call_at  timestamptz,
  created_at            timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.agent_id, pr.full_name,
    p.policy_sold_date, p.effective_date,
    p.monthly_premium, p.annual_premium,
    p.status, p.cancellation_status, p.cancellation_call_at,
    p.created_at
  from policies p
  join profiles pr on pr.id = p.agent_id;
$$;

-- Same grant pattern as every other SECURITY DEFINER helper in this schema
-- (can_view_agent, downline_of — migration 074): authenticated only, no
-- anon/public access. Test-account exclusion (testagent11/nate44) stays
-- client-side via excludeTestAccounts(), same as before this migration.
revoke execute on function public.team_performance_policies() from public, anon;
grant execute on function public.team_performance_policies() to authenticated;
