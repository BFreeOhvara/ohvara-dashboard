-- Prompt 407: profile picture upload + two-initial colored fallback avatar,
-- consistent everywhere an avatar renders (Team Messages, Hierarchy, Users &
-- Access, Performance leaderboard, Commissions, sidebar/header account chip,
-- Profile page itself). `profiles` had zero avatar columns before this.

alter table profiles
  add column if not exists avatar_url text,
  add column if not exists avatar_color text
    check (avatar_color in ('red', 'blue', 'green', 'yellow'));

-- Backfill every profile created before this migration with ONE random
-- color, assigned once and persisted (not re-randomized per render/session).
-- Brayden's explicit call: duplicate colors across different people are
-- fine — only 4 colors, more than 4 people means someone repeats, not a bug.
update profiles
set avatar_color = (array['red', 'blue', 'green', 'yellow'])[floor(random() * 4 + 1)::int]
where avatar_color is null;

alter table profiles
  alter column avatar_color set not null,
  alter column avatar_color set default 'blue'; -- backstop only; handle_new_user below always assigns a real random value

-- handle_new_user (originally 001_initial_schema.sql, redefined
-- 005_username_auth.sql for username support) now also assigns a random
-- avatar_color at signup — same one-time-random, persisted-forever pattern
-- as the backfill above. CREATE OR REPLACE keeps the existing trigger
-- (on_auth_user_created, 001) pointed at this same function; no trigger
-- redeclaration needed.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  colors text[] := array['red', 'blue', 'green', 'yellow'];
begin
  insert into profiles (id, email, full_name, role, username, avatar_color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'rep'),
    new.raw_user_meta_data->>'username',
    colors[floor(random() * array_length(colors, 1) + 1)::int]
  );
  return new;
end;
$$;

-- ── avatars storage bucket ──────────────────────────────────────────────────
-- Same bucket-creation pattern as bug-screenshots (migration 089), but
-- PUBLIC instead of private: avatars render everywhere in the UI (Messages,
-- Hierarchy, Users & Access, sidebar, leaderboard...) and need to load
-- without a per-request signed URL. Write access stays folder-scoped to the
-- uploading user's own auth.uid(), same convention as bug-screenshots.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Anyone can view avatars" on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users upload own avatar" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update own avatar" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete own avatar" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── team_performance_policies(): add avatar fields ──────────────────────────
-- Performance's Leaderboard podium (Prompt 396/402, migration 093) shows an
-- avatar per top-3 closer. Postgres can't CREATE OR REPLACE a function whose
-- return columns change, so this drops + recreates it (same body otherwise,
-- same grants).
drop function if exists public.team_performance_policies();

create function public.team_performance_policies()
returns table (
  id                    uuid,
  agent_id              uuid,
  agent_name            text,
  agent_avatar_url      text,
  agent_avatar_color    text,
  policy_sold_date      date,
  effective_date        date,
  monthly_premium       numeric(10,2),
  annual_premium        numeric(12,2),
  status                policy_status,
  cancellation_status   cancellation_status,
  cancellation_call_at  timestamptz,
  created_at            timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.agent_id, pr.full_name, pr.avatar_url, pr.avatar_color,
    p.policy_sold_date, p.effective_date,
    p.monthly_premium, p.annual_premium,
    p.status, p.cancellation_status, p.cancellation_call_at,
    p.created_at
  from policies p
  join profiles pr on pr.id = p.agent_id;
$$;

revoke execute on function public.team_performance_policies() from public, anon;
grant execute on function public.team_performance_policies() to authenticated;
