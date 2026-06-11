-- ============================================================
-- Migration 018 — Pre-call notes
-- Separate field from leads.notes (call notes): reps jot research
-- about the lead before dialing; call notes capture the outcome.
-- ============================================================

alter table leads add column if not exists pre_call_notes text;
