-- Migration 042: timezone support (Prompt 33)
--
-- Decision (Brayden, 2026-06-21): all appointment times stored in UTC,
-- displayed in each user's local timezone. Client timezone is inferred
-- from the lead's city/state (no UI needed — setter confirms city
-- naturally in the script).
--
-- appointment_at / scheduled_at were already timestamptz (UTC-correct
-- storage, confirmed by reading migration 020) — this migration only adds
-- the per-user display preference. Client-side timezone inference (lead
-- state → IANA zone) lives in src/lib/timezones.js, not the database.
--
-- Apply via the Supabase SQL editor (same pattern as 040/041 — db push
-- would try to re-run already-applied-out-of-band migrations).

alter table profiles add column if not exists timezone text not null default 'America/Chicago';
