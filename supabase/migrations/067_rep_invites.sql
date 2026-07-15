-- Migration 067: rep_invites — invite-token self-registration (Prompt 282)
--
-- Admin picks a role and gets a shareable /join/<token> link; the invited
-- person registers themselves (real name/email/phone, own password) via the
-- claim-invite edge function. New-flow accounts NEVER get written into
-- rep_credentials (Brayden's decision 2026-07-15: that table stays for
-- legacy/client flows only).

create table rep_invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  role        user_role not null,
  created_by  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  used_by     uuid references profiles(id) on delete set null
);

alter table rep_invites enable row level security;

-- Admin-only from the client (generate / list pending / revoke). The
-- claim-invite edge function validates and consumes tokens via service role,
-- which bypasses RLS — no anon policy needed, so tokens are never readable
-- from the browser without an admin session.
create policy "rep_invites_admin_select" on rep_invites
  for select using (public.is_admin());

create policy "rep_invites_admin_insert" on rep_invites
  for insert with check (created_by = auth.uid() and public.is_admin());

create policy "rep_invites_admin_delete" on rep_invites
  for delete using (public.is_admin());
