-- ============================================================
-- Migration 033: client-role fulfillment plumbing
-- ============================================================
-- Depends on 032 ('client' enum value) being committed first.
-- Three additive changes, all safe to run on the live (0-row) clients table:
--   1. Link a clients row to a login (profiles.id = auth.users.id).
--   2. Persist the AI recommendation + Nate's override price (today the
--      recommend-stack output is computed for the closer UI but never stored;
--      clients only has a fixed tier + monthly_value).
--   3. Client self-RLS so a logged-in client reads ONLY their own rows.

-- ── 1. Login link ────────────────────────────────────────────────────────────
alter table clients
  add column if not exists profile_id uuid references profiles(id) on delete set null;
create index if not exists idx_clients_profile_id on clients (profile_id);

-- ── 2. Persisted recommendation + override ─────────────────────────────────────
alter table clients
  add column if not exists recommended_tier  text
    check (recommended_tier is null or recommended_tier in ('basic','pro','premium','elite')),
  add column if not exists recommended_price numeric,
  add column if not exists override_price    numeric;

-- ── 3. Client self-RLS ─────────────────────────────────────────────────────────
-- A client reads only the rows tied to their own login. These policies do NOT
-- query `profiles`, so they can't trigger the RLS recursion that bit the admin
-- policies (migration 009). CREATE POLICY IF NOT EXISTS is unsupported on
-- PG <= 16, so each is guarded with a DO block.
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='clients' and policyname='Clients view own row'
  ) then
    create policy "Clients view own row" on clients for select
      using (profile_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where tablename='onboarding' and policyname='Clients view own onboarding'
  ) then
    create policy "Clients view own onboarding" on onboarding for select
      using (exists (
        select 1 from clients c
        where c.id = onboarding.client_id and c.profile_id = auth.uid()
      ));
  end if;

  if not exists (
    select 1 from pg_policies where tablename='onboarding' and policyname='Clients answer own onboarding'
  ) then
    create policy "Clients answer own onboarding" on onboarding for update
      using (exists (
        select 1 from clients c
        where c.id = onboarding.client_id and c.profile_id = auth.uid()
      ));
  end if;
end $$;
