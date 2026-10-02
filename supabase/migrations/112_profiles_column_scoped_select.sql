-- Lock down profiles read access (follow-up to Prompt 671).
--
-- profiles_select is `auth.uid() IS NOT NULL` and authenticated had SELECT
-- on every column, so any signed-in user (agent or fulfillment) could read
-- every profile's email, phone, username, caller_id_number,
-- caller_id_twilio_sid, stripe_account_id, npn, eo_* ...
--
-- Fix: column-level, not row-level. Teammates legitimately need each other's
-- *directory* fields (an agent sees which Fulfillment rep picked up their
-- client, Fulfillment sees the agent's name + whether their Caller ID is
-- on, other tables' RLS checks `role`), so the row policy stays and the
-- grant shrinks to those columns:
--
--   id, role, full_name, avatar_url, avatar_color, is_active, created_at,
--   upline_id, caller_id_verified_at, caller_id_enabled
--
-- Full rows go through two SECURITY DEFINER RPCs:
--   get_my_profile()       — the caller's own row (useAuth)
--   admin_list_profiles()  — every row, admin only (Users & Access)
--
-- Writes are unchanged: UPDATE/INSERT/DELETE grants, profiles_update_self,
-- profiles_admin_update and the migration 108/109 guard triggers all stay.
-- supabase-js updates send return=minimal, so they never need SELECT on the
-- columns they write. Every edge function reads profiles with the service
-- role and is unaffected. anon loses all access (login resolves usernames via
-- the resolve_login_email definer RPC; signup goes through claim-invite).
--
-- Applied live in two steps so no deploy window could break sign-in:
-- 112a_profile_read_rpcs (the two functions below) -> client deploy 1a681a0
-- -> 112b_profiles_column_scoped_select (the grant changes).

revoke all on public.profiles from anon;

revoke select on public.profiles from authenticated;
grant select (
  id, role, full_name, avatar_url, avatar_color, is_active, created_at,
  upline_id, caller_id_verified_at, caller_id_enabled
) on public.profiles to authenticated;

-- TRUNCATE ignores RLS; nothing in the app needs it.
revoke truncate on public.profiles from authenticated;

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.admin_list_profiles()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where public.is_admin();
$$;

revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.admin_list_profiles() from public, anon;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.admin_list_profiles() to authenticated;
