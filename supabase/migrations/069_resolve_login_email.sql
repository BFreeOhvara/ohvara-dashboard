-- Migration 069: resolve_login_email RPC (Prompt 284)
--
-- Login-by-username needs to work pre-auth, for BOTH account shapes:
--   - legacy accounts: bare username → synthetic ${username}@ohvara.internal
--     (no DB lookup needed, useAuth.jsx builds this directly)
--   - invite-flow accounts (Prompt 282/284): bare username → a REAL email on
--     file, which can't be derived, only looked up
-- profiles has no anon-readable policy (by design — RLS is owner/admin only),
-- so the login form can't just query profiles directly. This RPC is a
-- narrow, SECURITY DEFINER exception: given a username, return ONLY that
-- profile's email, nothing else about the account.

create or replace function resolve_login_email(p_username text)
returns text
language sql
security definer
set search_path = public
as $$
  select email from profiles where username = p_username limit 1;
$$;

grant execute on function resolve_login_email(text) to anon, authenticated;
