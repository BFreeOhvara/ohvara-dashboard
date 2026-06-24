-- Migration 049: Stripe Connect commission payouts (Prompt 55)
--
-- Adds the rep-side Stripe Connect account fields to `profiles` and a new
-- `commission_payouts` table that tracks the payout workflow for each closed
-- deal: pending (auto-created on close) → approved/paid (admin presses
-- "Approve & Pay", which fires a Stripe Transfer) → failed.
--
-- This is the PAYOUT/transfer layer. It is intentionally separate from the
-- existing `commissions` ledger (migration 014), which records earned amounts.
--
-- Apply via the Supabase SQL editor (same manual pattern as 040–048).
-- All idempotent (IF NOT EXISTS) so re-running is safe.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_account_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_onboarding_complete boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS commission_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_profile_id uuid NOT NULL REFERENCES profiles(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  amount_cents int NOT NULL,
  stripe_transfer_id text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | paid | failed
  created_at timestamptz DEFAULT now(),
  paid_at timestamptz,
  notes text
);

ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reps view own payouts" ON commission_payouts;
CREATE POLICY "reps view own payouts" ON commission_payouts FOR SELECT USING (rep_profile_id = auth.uid());

DROP POLICY IF EXISTS "admin full access" ON commission_payouts;
CREATE POLICY "admin full access" ON commission_payouts FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
