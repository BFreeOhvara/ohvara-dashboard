-- Lasting rate limit for public edge functions (used by _shared/ipLimit.ts).
--
-- submit-mp-lead kept its per-IP / per-phone counter in the function worker's
-- memory, so it reset on every cold start. This table keeps the hits in the
-- database instead. Keys are SHA-256 hashes made by the edge function, so no
-- raw IP or phone is stored. Rows are never deleted (a cleanup would reset a
-- counter); the count only looks at rows inside the window.
--
-- Service role only: RLS on, no policies, no grants.

create table public.rate_limit_hits (
  id     bigint generated always as identity primary key,
  key    text not null,
  hit_at timestamptz not null default now()
);
create index rate_limit_hits_key_hit_at_idx on public.rate_limit_hits (key, hit_at desc);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Records one hit for p_key and says whether the key is now over p_limit within
-- the last p_window_seconds (the hit just recorded counts).
create or replace function public.check_and_record_hit(p_key text, p_limit int, p_window_seconds int)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_count int;
begin
  insert into rate_limit_hits (key) values (p_key);
  select count(*) into v_count from rate_limit_hits
   where key = p_key and hit_at > now() - make_interval(secs => p_window_seconds);
  return v_count > p_limit;
end;
$$;
revoke all on function public.check_and_record_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_and_record_hit(text, int, int) to service_role;
