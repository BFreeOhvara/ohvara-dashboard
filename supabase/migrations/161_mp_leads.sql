-- Migration 161 — Meta mortgage-protection leads.
--
-- Leads from Meta lead ads land in mp_leads (written only by the service role,
-- i.e. an edge function), then get assigned to an agent who has opted in via
-- agent_lead_settings. Each lead has a price, recovery_config.mp_lead_price_cents.
--
--   mp_leads             one row per lead. An agent reads only the leads
--                        assigned to them and may change only status. Admin
--                        reads all. Nobody else reads or writes.
--   agent_lead_settings  one row per agent: opted in (off by default), which
--                        states, daily cap. The agent manages their own row.
--   recovery_config      mp_lead_price_cents (0 until set), admin-editable.
--
-- Admin is public.is_admin(): profiles.role = 'admin' and is_active. The role
-- only ever comes from raw_app_meta_data (handle_new_user, migration 152).
-- Does not touch the dead setter tables (see Gotchas).

-- ── settings ────────────────────────────────────────────────────────────────
alter table public.recovery_config
  add column if not exists mp_lead_price_cents integer not null default 0;
alter table public.recovery_config drop constraint if exists recovery_config_mp_lead_price_check;
alter table public.recovery_config add constraint recovery_config_mp_lead_price_check check (
  mp_lead_price_cents between 0 and 100000
);
-- The recovery_config_admin_update policy (122) limits this to admins.
grant update (mp_lead_price_cents) on public.recovery_config to authenticated;

-- ── leads ───────────────────────────────────────────────────────────────────
create table if not exists public.mp_leads (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  source                 text not null default 'meta_mp' check (length(btrim(source)) between 1 and 40),
  first_name             text check (length(first_name) <= 100),
  last_name              text check (length(last_name) <= 100),
  phone                  text check (length(phone) <= 30),
  email                  text check (length(email) <= 254),
  state                  text check (state ~ '^[A-Z]{2}$'),
  age_band               text check (length(age_band) <= 40),
  mortgage_balance_band  text check (length(mortgage_balance_band) <= 40),
  homeowner              boolean,
  smoker                 boolean,
  best_time              text check (length(best_time) <= 100),
  consent_at             timestamptz not null,
  consent_text_version   text not null check (length(btrim(consent_text_version)) between 1 and 40),
  utm_source             text check (length(utm_source) <= 200),
  utm_medium             text check (length(utm_medium) <= 200),
  utm_campaign           text check (length(utm_campaign) <= 200),
  utm_content            text check (length(utm_content) <= 200),
  utm_term               text check (length(utm_term) <= 200),
  status                 text not null default 'new'
                           check (status in ('new', 'assigned', 'contacted', 'closed', 'bad')),
  assigned_agent_id      uuid references public.profiles(id) on delete set null,
  assigned_at            timestamptz,
  check (assigned_agent_id is null or assigned_at is not null)
);
create index if not exists mp_leads_agent_idx on public.mp_leads (assigned_agent_id, created_at desc)
  where assigned_agent_id is not null;
create index if not exists mp_leads_new_idx on public.mp_leads (created_at) where status = 'new';

alter table public.mp_leads enable row level security;
drop policy if exists mp_leads_select on public.mp_leads;
create policy mp_leads_select on public.mp_leads
  for select to authenticated using (assigned_agent_id = auth.uid() or public.is_admin());
-- The agent changes status only (column grant below), only on their own lead,
-- and can't send it back to the unassigned pool.
drop policy if exists mp_leads_agent_update on public.mp_leads;
create policy mp_leads_agent_update on public.mp_leads
  for update to authenticated
  using (assigned_agent_id = auth.uid())
  with check (assigned_agent_id = auth.uid() and status in ('assigned', 'contacted', 'closed', 'bad'));
-- No insert / delete for anyone but the service role. No anon access at all.
revoke all on public.mp_leads from anon, authenticated;
grant select on public.mp_leads to authenticated;
grant update (status) on public.mp_leads to authenticated;

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
drop policy if exists als_select on public.agent_lead_settings;
create policy als_select on public.agent_lead_settings
  for select to authenticated using (agent_id = auth.uid() or public.is_admin());
drop policy if exists als_insert on public.agent_lead_settings;
create policy als_insert on public.agent_lead_settings
  for insert to authenticated with check (agent_id = auth.uid());
drop policy if exists als_update on public.agent_lead_settings;
create policy als_update on public.agent_lead_settings
  for update to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());
drop policy if exists als_delete on public.agent_lead_settings;
create policy als_delete on public.agent_lead_settings
  for delete to authenticated using (agent_id = auth.uid());
revoke all on public.agent_lead_settings from anon, authenticated;
grant select, insert, delete on public.agent_lead_settings to authenticated;
grant update (active, states, daily_cap, updated_at) on public.agent_lead_settings to authenticated;
