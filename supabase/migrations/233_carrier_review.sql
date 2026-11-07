-- Prompt 868 — carriers typed in that aren't on the built-in list (backend only, no screen).
--
-- The portal ships every US life carrier as versioned data (src/lib/carriers/list.json): names, aliases, and the
-- policyholder line's hours read on each carrier's own site. There is no Carriers tab (Brayden, Nov 6). When an agent,
-- VA or admin types a carrier that isn't listed, the name is still saved on the policy as typed, and it is logged
-- here so the list can be extended. No UI reads this table; it is counted in ship notes.
--
-- Table
--   carrier_review   one row per distinct typed name (normalized: lower case, punctuation folded): the name as
--                    first typed, how many times, who typed it first/last and when. Admins read; nobody writes
--                    directly (the function does).
-- Function
--   log_unknown_carrier(p_name)   any signed-in team member; bumps the count. Ignores blanks. Returns nothing.
--
-- WRITTEN, NOT APPLIED (P868). Apply with the P848 backend wiring.

create table if not exists public.carrier_review (
  id             uuid primary key default gen_random_uuid(),
  name_key       text not null unique,
  name           text not null,
  times          integer not null default 1,
  first_by       uuid references public.profiles(id) on delete set null,
  last_by        uuid references public.profiles(id) on delete set null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  catalog_version text
);

alter table public.carrier_review enable row level security;

drop policy if exists carrier_review_admin_read on public.carrier_review;
create policy carrier_review_admin_read on public.carrier_review
  for select to authenticated using (public.is_admin());

revoke all on public.carrier_review from anon, authenticated;
grant select on public.carrier_review to authenticated;

create or replace function public.log_unknown_carrier(p_name text, p_catalog_version text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_key  text;
begin
  -- Agents, VAs (fulfillment) and admins all type carriers (is_team_member() leaves VAs out).
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and role in ('agent', 'fulfillment', 'admin')) then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_name is null then
    return;
  end if;
  v_name := left(v_name, 120);
  v_key := btrim(regexp_replace(replace(lower(v_name), '&', ' '), '[^a-z0-9]+', ' ', 'g'));
  if v_key = '' then
    return;
  end if;
  insert into carrier_review (name_key, name, first_by, last_by, catalog_version)
  values (v_key, v_name, auth.uid(), auth.uid(), p_catalog_version)
  on conflict (name_key) do update
    set times = carrier_review.times + 1,
        last_by = excluded.last_by,
        last_seen_at = now(),
        catalog_version = coalesce(excluded.catalog_version, carrier_review.catalog_version);
end;
$$;

revoke all on function public.log_unknown_carrier(text, text) from public, anon;
grant execute on function public.log_unknown_carrier(text, text) to authenticated;
