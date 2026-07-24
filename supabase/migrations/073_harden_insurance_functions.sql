-- Migration 073: harden the functions introduced by 072 (Prompt 326)
--
-- Closes security-advisor findings that 072 itself created, caught by running
-- get_advisors immediately after applying it.
--
-- NOTE: the two REVOKE statements at the bottom of this file were a NO-OP —
-- see 074, which is the migration that actually removed the grants. Kept as
-- applied rather than rewritten, because the DB has it in its migration
-- history and the failure is worth being able to read back. Only the
-- search_path fix below did real work here.

-- Pin search_path, matching the three helpers in 072 that already set it.
-- CREATE OR REPLACE keeps the OID, so the existing policies_updated_at
-- trigger stays bound to this function.
create or replace function public.touch_policies_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Intent: stop anon from enumerating the agent hierarchy via /rest/v1/rpc.
-- Did not work — Postgres grants EXECUTE to PUBLIC by default on every new
-- function, and revoking from a specific role leaves that inherited PUBLIC
-- grant intact. See 074.
revoke execute on function public.downline_of(uuid) from anon, authenticated;
revoke execute on function public.upline_of(uuid)   from anon, authenticated;
revoke execute on function public.can_view_agent(uuid) from anon;
