-- Migration 050: inline pricing-input columns on leads (Prompt 53, Change 3)
--
-- The live call script now has a `data_collect` step (in Branch A's discovery
-- phase) where the rep logs calls-missed-per-week. ScriptWalk PATCHes this
-- onto the lead mid-call alongside `avg_ticket` (existing booking-form column).
--
-- `calls_missed_per_week` already exists (CallModal booking form) — the
-- IF NOT EXISTS makes this a no-op there.
--
-- Apply via the Supabase SQL editor (same manual pattern as 040–049). Idempotent.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS calls_missed_per_week int;
