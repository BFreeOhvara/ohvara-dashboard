-- 154 — Admin hardening, area 1/4: no TRUNCATE for API roles (Prompt 770-3).
--
-- Supabase's default grants gave anon and authenticated TRUNCATE on almost
-- every public table, payouts included. TRUNCATE skips row-level security.
-- The REST API can't send one today, but nothing signed in should hold the
-- right, so it goes, now and for tables made later.

revoke truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;
