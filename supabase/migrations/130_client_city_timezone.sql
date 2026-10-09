-- Prompt 724 — Book a call asks for the client's city and state, and call
-- times are the client's local time.
--
-- The state goes in the existing nullable policies.state (2-letter code).
-- client_timezone is an IANA name ("America/Chicago") the app resolves from
-- city + state; nothing shows it. Existing rows stay null: the app falls back
-- to the viewer's own zone for those.
--
-- The 30-minute notice and one-booking-per-slot rules are UI-only on purpose
-- (no trigger): Brayden may relax them, and Fulfillment, the edge functions
-- and the auto-assign trigger all write policies too.

alter table public.policies
  add column if not exists client_city text,
  add column if not exists client_timezone text;
