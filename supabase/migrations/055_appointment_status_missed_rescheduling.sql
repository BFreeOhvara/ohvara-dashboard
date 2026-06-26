-- Migration 055: Two new manual closer pipeline statuses
--
-- "Missed"            — Nate called for the scheduled appointment, client didn't answer.
--                       Manual only. No auto-flip logic.
-- "Needs Rescheduling"— Nate manually flags an appointment that needs a new time
--                       (came out of a Missed/Cancellation flow, client asked to push, etc.)
--
-- These are status-level (appointment_status enum), not outcome-level.
-- "Missed" is deliberately named to avoid confusion with rep-side "No Answer" (Call 1).
--
-- DO NOT run supabase db push — apply via Supabase SQL editor.

ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'missed';
ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'needs_rescheduling';
