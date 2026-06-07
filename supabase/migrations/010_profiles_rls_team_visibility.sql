-- ============================================================
-- Migration 010: Expand profiles SELECT policy for team visibility
-- ============================================================
-- The original policy only let users see their own profile (or admin see all).
-- Closers couldn't read rep profiles, which broke RepAnalytics and PastDeals
-- (the JOIN from appointments → profiles returned null for the rep name).
--
-- Fix: any authenticated user can SELECT from profiles. Writes (INSERT/UPDATE/DELETE)
-- remain tightly controlled by the existing policies from migration 009.
--
-- NOTE: This was applied directly to the live DB before this migration was
-- written. Running it again is safe — DROP IF EXISTS + CREATE is idempotent.
-- ============================================================

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
