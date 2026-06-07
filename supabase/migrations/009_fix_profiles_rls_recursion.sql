-- ============================================================
-- Migration 009 — Fix infinite recursion in profiles RLS
--
-- Root cause: every policy that checked "is the caller an admin?"
-- did so with EXISTS (SELECT 1 FROM profiles WHERE ...), which
-- re-triggers RLS on profiles → infinite recursion (42P17).
--
-- Fix: a SECURITY DEFINER function that reads profiles as the
-- function owner (postgres / superuser), bypassing RLS entirely.
-- Policies call is_admin() instead of querying profiles directly.
-- Supersedes the policy added in migration 008.
-- ============================================================

-- Helper: runs as postgres (superuser) so RLS does not fire on the
-- inner profiles read, breaking the recursion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$;

-- Drop every existing policy on profiles (001, 003, 008)
DROP POLICY IF EXISTS "profiles_select"            ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin"      ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_update"      ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- SELECT: own row always readable; admins see all rows
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

-- UPDATE: users edit their own row
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- UPDATE: admins edit any row (deactivation toggle)
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE USING (public.is_admin());

-- INSERT: admin-only direct inserts (trigger is SECURITY DEFINER,
-- bypasses RLS, so account creation is unaffected)
CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT WITH CHECK (public.is_admin());
