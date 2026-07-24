-- Migration 074: actually revoke the grants 073 tried to remove (Prompt 326)
--
-- 073's REVOKEs were a no-op. Postgres grants EXECUTE to PUBLIC by default on
-- every newly created function, and revoking from `anon`/`authenticated`
-- individually leaves that inherited PUBLIC grant in place —
-- has_function_privilege('anon', ...) still returned true afterwards. The
-- grant has to come off PUBLIC first, then be handed back only to the roles
-- that genuinely need it.
--
-- Why it mattered: downline_of/upline_of were reachable at /rest/v1/rpc by an
-- unauthenticated caller. Given any profile UUID they return the set of
-- profile IDs above/below it — i.e. anyone could walk the agent hierarchy.
-- Neither is called from the app (useHierarchy reads profiles directly and
-- builds the tree client-side), and the one internal caller — can_view_agent
-- — is SECURITY DEFINER, so it runs as the function owner and does not need
-- the caller to hold EXECUTE.

revoke execute on function public.downline_of(uuid)     from public, anon, authenticated;
revoke execute on function public.upline_of(uuid)       from public, anon, authenticated;
revoke execute on function public.can_view_agent(uuid)  from public, anon, authenticated;

-- can_view_agent is called by the policies_select RLS predicate, which is
-- evaluated as the querying role — `authenticated` must keep it or every
-- agent loses access to their own book.
grant execute on function public.can_view_agent(uuid) to authenticated;

-- service_role bypasses RLS and nothing server-side calls these today, but
-- granting explicitly means a future edge function isn't silently blocked by
-- a permission removed here.
grant execute on function public.downline_of(uuid)    to service_role;
grant execute on function public.upline_of(uuid)      to service_role;
grant execute on function public.can_view_agent(uuid) to service_role;

-- Verified after applying (has_function_privilege against pg_proc):
--   can_view_agent  anon=false authenticated=true  service_role=true
--   downline_of     anon=false authenticated=false service_role=true
--   upline_of       anon=false authenticated=false service_role=true
