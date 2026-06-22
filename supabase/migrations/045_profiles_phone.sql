-- Migration 045 — Add phone to profiles
--
-- Stores the rep's personal phone number so the Twilio bridge call
-- knows which number to ring when a rep initiates a recorded call.
-- Nullable: reps without a phone fall back to the tel: link in CallModal.

alter table profiles
  add column if not exists phone text;
