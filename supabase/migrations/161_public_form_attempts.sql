-- Migration 161 — hashed-IP attempt log for public (signed-out) forms.
--
-- One row per submit of a public form (e.g. the /mp qualifier). The edge
-- function counts rows for an ip_hash inside its limit window and refuses the
-- submit once the count is over the limit, then inserts the new attempt.
--
-- ip_hash is the hex SHA-256 of FORM_IP_SALT + the caller's IP. The salt lives
-- only in the edge function env var FORM_IP_SALT; a raw IP is never stored, so
-- this table can't be turned back into addresses without the salt. Rotating
-- FORM_IP_SALT changes every hash, so every IP's window resets once (old rows
-- simply stop matching and age out through the prune below).
--
-- Service role only, same shape as 160: RLS on, no policies, no grants.

create table public.public_form_attempts (
  id         bigint generated always as identity primary key,
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index public_form_attempts_ip_hash_created_at_idx
  on public.public_form_attempts (ip_hash, created_at desc);
alter table public.public_form_attempts enable row level security;
revoke all on public.public_form_attempts from anon, authenticated;

-- Deletes only rows older than the retention window. 30 days is a safe ceiling
-- over the longest window any limit counts over (hours to a day today); a row
-- inside a window must never be deleted, or the limit would undercount. If a
-- limit ever counts over more than 30 days, raise this first.
create or replace function public.prune_public_form_attempts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  delete from public_form_attempts
  where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke execute on function public.prune_public_form_attempts() from public, anon, authenticated;
grant execute on function public.prune_public_form_attempts() to service_role;

-- Daily at 09:20 UTC. Re-schedulable: drop any old job first (016 pattern).
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('prune-public-form-attempts');
exception when others then
  null; -- job didn't exist yet
end;
$$;

select cron.schedule(
  'prune-public-form-attempts',
  '20 9 * * *',
  'select public.prune_public_form_attempts()'
);
