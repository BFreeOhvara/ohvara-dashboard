-- Migration 048: Business research enrichment columns on leads
--
-- Prompt 46. Stored on `leads` rather than `appointments` — the data
-- describes the BUSINESS (rating, review count, website presence), not the
-- appointment transaction, and `leads` already carries `place_id` (added in
-- migration 019 for Maps-scraper dedup). Reusing that column lets the
-- enrichment edge function skip a redundant Text Search lookup whenever a
-- lead already has a place_id (Maps-sourced leads), and only resolve one via
-- search for leads from other sources (e.g. Indeed).
--
-- `appointments` already joins `leads` everywhere it's displayed (see
-- useMyAppointments / useAllAppointments), so these columns reach
-- AppointmentCard via the existing nested select — no appointments schema
-- change needed.
--
-- DO NOT run supabase db push for this migration — apply via SQL editor,
-- same as 040-047.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_rating numeric(2,1);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_review_count int;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_website boolean;
