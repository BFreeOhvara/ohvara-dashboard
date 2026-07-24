-- Migration 072: insurance launch schema (Prompt 326)
--
-- First real-backend migration for the 2026-07-21 pivot: Ohvara's own inbound
-- life-insurance operation. Adds the policy pipeline (My Policies /
-- Submissions), the carrier directory (Carrier Portals), and the agent
-- hierarchy (upline/downline + owner-generated invite links).
--
-- Deliberately additive — nothing from the old SMB/setter model is dropped
-- here (North Star: "repurpose, don't rebuild"). The existing rep_invites
-- table and claim-invite edge function are extended, not replaced.

-- ============================================================
-- ENUMS — final status model, Round 46 / North Star "Pipeline Status Model"
-- ============================================================
-- Five main statuses. Follow-up and Not Interested are pre-submission
-- outcomes with no data source yet (live-call handling isn't in the app —
-- calls happen on the agent's own phone), built now on purpose so they work
-- the moment that integration lands, with no status-model rework then.
create type policy_status as enum (
  'Follow-up',
  'Not Interested',
  'Submitted',
  'In Effect',
  'Undrafted'
);

-- Cancellation is a SEPARATE attribute, not a sixth main status: it tracks
-- the OLD policy being replaced (the required 3-way call), so a record
-- carries both at once (e.g. In Effect + Cancellation Pending).
create type cancellation_status as enum (
  'Cancellation Pending',
  'Cancellation Complete'
);

-- ============================================================
-- HIERARCHY — upline/downline on profiles
-- ============================================================
-- Nullable: team owners (Nate) and admin have no upline. Set on claim by the
-- claim-invite function, from the invite's created_by — whoever's link was
-- accepted becomes that person's direct upline.
alter table profiles add column if not exists upline_id uuid references profiles(id) on delete set null;
create index if not exists profiles_upline_id_idx on profiles(upline_id);

-- Recursive descendants of `root`, excluding root itself. SECURITY DEFINER
-- so RLS policies can call it without recursing back into profiles' own
-- policies (same reason is_admin() exists — migration 009).
create or replace function public.downline_of(root uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select p.id from profiles p where p.upline_id = root
    union all
    select p.id from profiles p join tree t on p.upline_id = t.id
  )
  select id from tree;
$$;

-- Ancestors of `who`, nearest first. Used by the Hierarchy page to render an
-- agent's own chain upward (they see their upline, never siblings).
create or replace function public.upline_of(who uuid)
returns table (id uuid, depth int)
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select p.upline_id as id, 1 as depth from profiles p where p.id = who and p.upline_id is not null
    union all
    select p.upline_id, c.depth + 1
      from profiles p join chain c on p.id = c.id
     where p.upline_id is not null
  )
  select id, depth from chain;
$$;

-- "Can auth.uid() see rows owned by `owner`?" — self, anyone in their own
-- downline, or admin (full company-wide visibility).
create or replace function public.can_view_agent(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner = auth.uid()
      or public.is_admin()
      or exists (select 1 from public.downline_of(auth.uid()) d where d.id = owner);
$$;

-- ============================================================
-- CARRIERS — the Carrier Portals directory (Round 38)
-- ============================================================
-- Intentionally seeded EMPTY. Real carrier names, portal URLs, and phone
-- numbers depend on which carriers Nate/Jordan/Rego are actually appointed
-- with — an open question flagged back to Brayden. Admin enters the real
-- rows from the Carrier Portals page rather than shipping invented data
-- that looks real.
create table carriers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  portal_url          text,
  new_business_phone  text,
  agent_service_phone text,
  notes               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

alter table carriers enable row level security;

-- Every authenticated agent needs the directory; only admin maintains it.
create policy "carriers_select" on carriers
  for select using (auth.uid() is not null);
create policy "carriers_admin_write" on carriers
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- POLICIES — the pipeline itself (My Policies + New Submission form)
-- ============================================================
-- Field list is the real reference form from Round 33, not invented.
-- annual_premium is generated, never hand-entered (Round 33: "auto-computed,
-- not manually entered").
create table policies (
  id                  uuid primary key default gen_random_uuid(),
  agent_id            uuid not null references profiles(id) on delete cascade,

  policy_sold_date    date,
  policy_number       text,
  client_first_name   text not null,
  client_last_name    text not null,
  client_phone        text,

  -- carrier_id when the carrier exists in the directory; carrier_name is the
  -- denormalized label so a submission is never blocked on the directory
  -- being populated (it currently isn't — see carriers above).
  carrier_id          uuid references carriers(id) on delete set null,
  carrier_name        text,

  product_type        text,
  insurance_type      text,
  state               text,

  effective_date      date,
  monthly_premium     numeric(10,2),
  annual_premium      numeric(12,2) generated always as (round(coalesce(monthly_premium, 0) * 12, 2)) stored,

  status              policy_status not null default 'Submitted',
  cancellation_status cancellation_status,

  -- Cancellation Calendar (Submissions tab): when the 3-way call with the
  -- old carrier is booked for.
  cancellation_call_at timestamptz,

  -- Effective-Date-triggered prompt ("Did this policy go into effect?").
  -- Stamped when the agent answers, so the prompt doesn't re-fire forever.
  effectuation_answered_at timestamptz,

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index policies_agent_id_idx  on policies(agent_id);
create index policies_status_idx    on policies(status);
create index policies_effective_idx on policies(effective_date);

alter table policies enable row level security;

-- Read: own book, own downline's book, or everything (admin).
create policy "policies_select" on policies
  for select using (public.can_view_agent(agent_id));

-- Write: an agent only ever writes their own rows. Admin can write anyone's.
create policy "policies_insert" on policies
  for insert with check (agent_id = auth.uid() or public.is_admin());
create policy "policies_update" on policies
  for update using (agent_id = auth.uid() or public.is_admin());
create policy "policies_delete" on policies
  for delete using (agent_id = auth.uid() or public.is_admin());

create or replace function public.touch_policies_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger policies_updated_at
  before update on policies
  for each row execute function public.touch_policies_updated_at();

-- ============================================================
-- INVITES — team owners generate their own links (Round 31)
-- ============================================================
-- Migration 067 built this admin-only. The launch model is self-service:
-- Admin creates only the team owner (Nate); the owner invites Jordan and
-- Rego himself, and whoever accepts becomes that owner's direct recruit.
-- created_by already records who generated the link, so it doubles as the
-- new account's upline — no extra column needed.
drop policy if exists "rep_invites_admin_select" on rep_invites;
drop policy if exists "rep_invites_admin_insert" on rep_invites;
drop policy if exists "rep_invites_admin_delete" on rep_invites;

create policy "rep_invites_select" on rep_invites
  for select using (created_by = auth.uid() or public.is_admin());

-- Closers can only mint 'closer' invites. Role escalation (creating an admin
-- or a legacy rep link) stays admin-only.
create policy "rep_invites_insert" on rep_invites
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or role = 'closer')
  );

create policy "rep_invites_delete" on rep_invites
  for delete using (created_by = auth.uid() or public.is_admin());
