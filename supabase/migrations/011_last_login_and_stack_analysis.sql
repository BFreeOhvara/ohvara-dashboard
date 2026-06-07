-- ============================================================
-- Migration 011: last_login_at tracking + stack analysis notes
-- ============================================================
-- Adds last_login_at to profiles so the admin Users table can
-- show "Last Login" per account without querying auth.users.
-- Updated on every real SIGNED_IN event from useAuth.jsx (client-side).
--
-- NOTE: Column was already added via Management API — this is the
-- idempotent migration file for version control consistency.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.profiles.last_login_at IS
  'Recorded by useAuth.jsx on SIGNED_IN event. Not updated on session restore.';
