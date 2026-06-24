-- Migration 050: inline pricing-input columns on leads (Prompt 53, Change 3)
--
-- The live call script now has a `data_collect` step (in Branch A's discovery
-- phase) where the rep logs the two numbers the custom-stack formula needs:
-- calls missed per week and average ticket value. ScriptWalk PATCHes these
-- onto the lead mid-call; recommend-stack reads them (with 5 / $300 fallbacks).
--
-- `calls_missed_per_week` already exists (CallModal booking form) — the
-- IF NOT EXISTS makes this a no-op there. `avg_ticket_value` is new (distinct
-- from the existing `avg_ticket` booking-form column).
--
-- Apply via the Supabase SQL editor (same manual pattern as 040–049). Idempotent.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS calls_missed_per_week int;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS avg_ticket_value int;
