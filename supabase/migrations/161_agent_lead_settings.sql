-- 161 — Agent lead settings, agent status and the repeat-phone index on leads.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: one new table, one column, one index.
--
-- Replaces the earlier 161 (branch atlas/3b0822cf), which made a separate
-- Meta-only lead table. Leads now live in public.leads with a lead_type
-- (166_lead_types_delivery: 'mortgage_protection' for Meta, 'policy_help' for
-- Google calls), so that table is never created. What this file keeps from the
-- old 161, pointed at leads:
--
--   agent_lead_settings   one row per agent: opted in (off by default), which
--                         states, daily cap. The agent manages their own row.
--   leads.agent_status    where the agent's own lead sits: assigned, contacted,
--                         closed, bad. Null for cancellation leads. Separate
--                         from leads.status (the cancellation pipeline enum,
--                         whose changes feed the rep queues through
--                         handle_lead_pipeline, 019/044).
--   leads (phone, created_at) index   the 30-day repeat-phone check that
--                         submit-mp-lead runs before every insert.
--
-- Consent (time + wording version) and UTM tags for a Meta lead go in
-- leads.qualifier_answers (166), next to the qualifier answers; the source is
-- leads.lead_source = 'meta' (166). The lead price is
-- recovery_config.price_per_lead_cents (169), not a column here.
--
-- Agents read and change their own leads through the existing leads policies
-- (leads_rep_select 036, leads_rep_update 001: assigned_rep_id = auth.uid())
-- and 166's restrictive policy for typed leads.

-- ── agent settings ──────────────────────────────────────────────────────────
create table if not exists public.agent_lead_settings (
  agent_id    uuid primary key references public.profiles(id) on delete cascade,
  active      boolean not null default false,
  states      text[] not null default '{}'
                check (array_to_string(states, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  daily_cap   integer check (daily_cap between 0 and 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.agent_lead_settings enable row level security;
create policy als_select on public.agent_lead_settings
  for select to authenticated using (agent_id = auth.uid() or public.is_admin());
create policy als_insert on public.agent_lead_settings
  for insert to authenticated with check (agent_id = auth.uid());
create policy als_update on public.agent_lead_settings
  for update to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());
revoke all on public.agent_lead_settings from anon, authenticated;
grant select, insert on public.agent_lead_settings to authenticated;
grant update (active, states, daily_cap, updated_at) on public.agent_lead_settings to authenticated;

-- ── agent status on a delivered lead ────────────────────────────────────────
alter table public.leads
  add column if not exists agent_status text
    check (agent_status in ('assigned', 'contacted', 'closed', 'bad'));

-- ── repeat-phone check ──────────────────────────────────────────────────────
create index if not exists leads_phone_created_idx
  on public.leads (phone, created_at desc) where phone is not null;
