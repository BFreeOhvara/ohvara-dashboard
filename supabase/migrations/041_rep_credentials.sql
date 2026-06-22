-- Migration 041: rep_credentials table — admin-only login lookup
--
-- Decision (Brayden, 2026-06-21, Prompt 23; re-confirmed explicitly in-session
-- via AskUserQuestion after the auto-mode classifier flagged the plaintext
-- tradeoff and asked for direct confirmation rather than inheriting it from
-- a vault note alone): Brayden wants to see every rep's login credentials
-- from the admin dashboard — hidden by default, reveal on click, admin-only.
-- Use case: setter forgets their login, Brayden looks it up instantly
-- instead of resetting it. Plaintext storage + admin-only RLS chosen over
-- encryption-at-rest or a reset-password flow — explicitly accepted.
--
-- Supabase Auth hashes passwords irreversibly, so the plain-text password
-- has to be captured at account-creation time (admin-create-user edge fn)
-- and stored separately. RLS restricts read/write to admin role only;
-- the edge fn writes via the service-role client, which bypasses RLS.

CREATE TABLE IF NOT EXISTS rep_credentials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  username    text NOT NULL,
  password    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id)
);

ALTER TABLE rep_credentials ENABLE ROW LEVEL SECURITY;

-- Admins can read any row (the "View Login" lookup).
CREATE POLICY "Admins can view rep credentials"
  ON rep_credentials
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Admins can insert via the anon/admin client too (defense in depth);
-- the edge fn normally writes via service role, which bypasses RLS
-- entirely, so this policy only matters for an admin-initiated client-side
-- write path if one is ever added.
CREATE POLICY "Admins can insert rep credentials"
  ON rep_credentials
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- No UPDATE/DELETE policy — rows are immutable after creation (a password
-- reset would create a new account or need its own explicit flow later).
-- No policy at all for rep/closer/client roles — RLS defaults to deny.
