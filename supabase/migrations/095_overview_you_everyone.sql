-- Prompt 404: Overview gets a You/Everyone toggle (admin/upline only,
-- reusing Prompt 396's team_performance_policies() aggregate), monthly
-- goals become month-scoped instead of one standing profiles column, and
-- two new profile-level preferences gate/steer the toggle.

-- ── agent_monthly_goals: one row per agent per month, created only when
-- they actually set it — Overview shows an empty "set your goal" prompt
-- state until they do, and goals do NOT carry over month to month by
-- design. Supersedes profiles.monthly_ap_goal (migration 075); that column
-- is left in place unused rather than dropped (existing standing values
-- were all-default noise, not deliberate per-month goals, so nothing is
-- migrated forward from it).
create table if not exists agent_monthly_goals (
  profile_id  uuid not null references profiles(id) on delete cascade,
  month       text not null,
  goal        numeric not null,
  updated_at  timestamptz not null default now(),
  primary key (profile_id, month)
);

alter table agent_monthly_goals enable row level security;

-- Same "own row full access, admin full access" pattern as agent_licenses /
-- agent_carrier_appointments (migration 091) — admin's access here is what
-- lets the Overview "Everyone" scope sum every agent's current-month goal.
create policy "Agents manage own monthly goals" on agent_monthly_goals for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "Admins manage all monthly goals" on agent_monthly_goals for all
  using (public.is_admin())
  with check (public.is_admin());

-- ── profiles: two new upline-only preferences ────────────────────────────
-- overview_default_scope: which side of the You/Everyone toggle Overview
-- opens on, for accounts that get the toggle at all.
-- also_writes_business: "I'm also actively writing business" (Profile page)
-- — OFF by default, since a pure agency-manager upline account has nothing
-- meaningful behind "You" yet. Gates the You/Everyone toggle on both
-- Overview and Performance (Prompt 396's existing You/Team toggle).
alter table profiles
  add column if not exists overview_default_scope text not null default 'you'
    check (overview_default_scope in ('you', 'everyone')),
  add column if not exists also_writes_business boolean not null default false;
