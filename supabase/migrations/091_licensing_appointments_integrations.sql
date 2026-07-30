-- Prompt 392: Settings gets 2 new tabs — Licensing & Appointments, Integrations.
-- Real insurance-agent compliance data (licenses, NPN, E&O, carrier
-- appointment status) that nothing in the app currently tracks, plus a
-- singleton settings row to hold the Zoom Live Room link for Prompt 393
-- (still queued — Brayden hasn't provided the real URL yet, so this just
-- gives the Integrations tab somewhere real to read/write null into).

-- ── profiles: compliance fields ──────────────────────────────────────────────
alter table profiles
  add column if not exists npn text,
  add column if not exists eo_carrier text,
  add column if not exists eo_policy_expires_on date;

-- ── agent_licenses: one-to-many, an agent can hold licenses in multiple states ──
create table if not exists agent_licenses (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  state        text not null,
  license_number text,
  expires_on   date,
  created_at   timestamptz not null default now()
);

create index if not exists agent_licenses_profile_idx on agent_licenses (profile_id);

alter table agent_licenses enable row level security;

create policy "Agents manage own licenses" on agent_licenses for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "Admins manage all licenses" on agent_licenses for all
  using (public.is_admin())
  with check (public.is_admin());

-- ── agent_carrier_appointments: per-agent status against the real carrier directory ──
create type appointment_status as enum ('pending', 'active');

create table if not exists agent_carrier_appointments (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  carrier_id   uuid not null references carriers(id) on delete cascade,
  status       appointment_status not null default 'pending',
  appointed_on date,
  created_at   timestamptz not null default now(),
  unique (profile_id, carrier_id)
);

create index if not exists agent_carrier_appointments_profile_idx on agent_carrier_appointments (profile_id);

alter table agent_carrier_appointments enable row level security;

create policy "Agents manage own appointments" on agent_carrier_appointments for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "Admins manage all appointments" on agent_carrier_appointments for all
  using (public.is_admin())
  with check (public.is_admin());

-- ── app_settings: singleton row for company-wide settings (Zoom link today,
-- other integrations later). id is pinned to 1 — one row, ever.
create table if not exists app_settings (
  id             smallint primary key default 1 check (id = 1),
  zoom_room_url  text,
  updated_at     timestamptz not null default now()
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table app_settings enable row level security;

create policy "Everyone reads app settings" on app_settings for select
  using (auth.uid() is not null);

create policy "Admins update app settings" on app_settings for update
  using (public.is_admin())
  with check (public.is_admin());
