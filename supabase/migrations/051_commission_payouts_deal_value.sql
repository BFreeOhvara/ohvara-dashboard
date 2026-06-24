-- Migration 051: add deal_value_cents to commission_payouts (Prompt 58)
--
-- Stores the full deal value alongside the commission amount so the rep
-- can see "Closed $X,XXX · Your cut: $XXX" without reverse-computing from
-- amount_cents. Backfills existing rows by computing amount_cents * 10
-- (reversing the 10% commission rate).
--
-- Apply via the Supabase SQL editor (same manual pattern as 040–050). Idempotent.

ALTER TABLE commission_payouts ADD COLUMN IF NOT EXISTS deal_value_cents int;
UPDATE commission_payouts SET deal_value_cents = amount_cents * 10 WHERE deal_value_cents IS NULL;
