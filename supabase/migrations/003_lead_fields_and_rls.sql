-- ============================================================
-- Migration 003: Lead fields for stack recommendation + admin RLS
-- ============================================================

-- New columns on leads for stack scoring
alter table leads
  add column if not exists job_title         text,
  add column if not exists monthly_labor_cost numeric(10,2);

-- Allow admins to update any profile (needed for deactivation)
create policy "profiles_admin_update" on profiles
  for update using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
