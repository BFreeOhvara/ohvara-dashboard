-- ============================================================
-- Ohvara Outreach Dashboard — Initial Schema
-- ============================================================

-- ENUMS
create type user_role as enum ('rep', 'closer', 'admin');

create type lead_status as enum (
  'New',
  'Contacted',
  'Voicemail',
  'No Answer',
  'Interested',
  'Booked',
  'Not Interested'
);

create type lead_source as enum ('google_maps', 'indeed');

create type sequence_channel as enum ('sms', 'email');

create type sequence_status as enum ('pending', 'sent', 'replied', 'cancelled');

create type appointment_status as enum ('pending', 'completed', 'no_show', 'rescheduled');

create type appointment_outcome as enum ('closed', 'lost', 'no_show');

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null default 'rep',
  full_name   text not null,
  email       text not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table profiles enable row level security;

-- Admins see everyone; users see themselves
create policy "profiles_select" on profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "profiles_update_self" on profiles
  for update using (auth.uid() = id);

create policy "profiles_insert_admin" on profiles
  for insert with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Auto-create profile on signup (used only for admin bootstrap)
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'rep')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- LEADS
-- ============================================================
create table leads (
  id                  uuid primary key default gen_random_uuid(),
  source              lead_source not null default 'google_maps',
  business_name       text not null,
  contact_name        text,
  phone               text,
  email               text,
  city                text,
  state               text,
  niche               text,
  status              lead_status not null default 'New',
  assigned_rep_id     uuid references profiles(id) on delete set null,
  assigned_closer_id  uuid references profiles(id) on delete set null,
  notes               text,
  pain_points         text,
  batch_date          date,
  re_engagement_active boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table leads enable row level security;

-- Reps see only their assigned leads
create policy "leads_rep_select" on leads
  for select using (
    assigned_rep_id = auth.uid()
    or assigned_closer_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "leads_rep_update" on leads
  for update using (
    assigned_rep_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and (p.role = 'admin' or p.role = 'closer')
    )
  );

-- Admins can insert leads (scraper uses service role)
create policy "leads_admin_insert" on leads
  for insert with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================
-- CALLS
-- ============================================================
create table calls (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references leads(id) on delete cascade,
  rep_id           uuid not null references profiles(id) on delete cascade,
  twilio_call_sid  text,
  duration_seconds int default 0,
  outcome          lead_status,
  notes            text,
  created_at       timestamptz not null default now()
);

alter table calls enable row level security;

create policy "calls_rep_select" on calls
  for select using (
    rep_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and (p.role = 'admin' or p.role = 'closer')
    )
  );

create policy "calls_rep_insert" on calls
  for insert with check (rep_id = auth.uid());

-- ============================================================
-- APPOINTMENTS
-- ============================================================
create table appointments (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references leads(id) on delete cascade,
  closer_id        uuid references profiles(id) on delete set null,
  rep_id           uuid references profiles(id) on delete set null,
  scheduled_at     timestamptz,
  status           appointment_status not null default 'pending',
  outcome          appointment_outcome,
  deal_value       numeric(10,2),
  loss_reason      text,
  closer_notes     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table appointments enable row level security;

create policy "appointments_closer_select" on appointments
  for select using (
    closer_id = auth.uid()
    or rep_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "appointments_closer_update" on appointments
  for update using (
    closer_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================
-- RE-ENGAGEMENT LOG
-- ============================================================
create table re_engagement_log (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references leads(id) on delete cascade,
  sequence_step       int not null check (sequence_step in (1, 2, 3)),
  channel             sequence_channel not null,
  scheduled_at        timestamptz not null,
  sent_at             timestamptz,
  status              sequence_status not null default 'pending',
  twilio_message_sid  text,
  created_at          timestamptz not null default now()
);

alter table re_engagement_log enable row level security;

create policy "re_engagement_admin_all" on re_engagement_log
  for all using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================
-- BATCH ASSIGNMENTS (audit log)
-- ============================================================
create table batch_assignments (
  id          uuid primary key default gen_random_uuid(),
  rep_id      uuid not null references profiles(id) on delete cascade,
  batch_date  date not null,
  lead_count  int not null default 0,
  assigned_at timestamptz not null default now()
);

alter table batch_assignments enable row level security;

create policy "batch_rep_select" on batch_assignments
  for select using (
    rep_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================
-- CLOSER ROTATION (one row per closer)
-- ============================================================
create table closer_rotation (
  id               uuid primary key default gen_random_uuid(),
  closer_id        uuid not null unique references profiles(id) on delete cascade,
  last_assigned_at timestamptz
);

alter table closer_rotation enable row level security;

create policy "closer_rotation_admin_all" on closer_rotation
  for all using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_updated_at
  before update on leads
  for each row execute procedure set_updated_at();

create trigger profiles_updated_at
  before update on profiles
  for each row execute procedure set_updated_at();

create trigger appointments_updated_at
  before update on appointments
  for each row execute procedure set_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================
create index leads_assigned_rep_id_idx on leads(assigned_rep_id);
create index leads_assigned_closer_id_idx on leads(assigned_closer_id);
create index leads_status_idx on leads(status);
create index leads_batch_date_idx on leads(batch_date);
create index calls_lead_id_idx on calls(lead_id);
create index calls_rep_id_idx on calls(rep_id);
create index appointments_closer_id_idx on appointments(closer_id);
create index re_engagement_lead_id_idx on re_engagement_log(lead_id);
create index re_engagement_status_idx on re_engagement_log(status);
