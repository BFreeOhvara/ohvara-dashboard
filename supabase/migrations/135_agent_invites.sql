-- Migration 135: agent-sent invites (Prompt 731)
--
-- An agent can invite another agent from the account menu ("Invite an
-- agent"). The send-agent-invite edge function mints the rep_invites row with
-- the service role and sends the /join/<token> link by text or email, so the
-- agent never sees or copies it. These columns record where it went; admin-made
-- invite links (the Users page) leave them null and behave exactly as before.
--
-- claim-invite reads `channel`: when it is set the new account gets NO upline
-- (no team, no tie to whoever sent it), and an email invite only claims with
-- the same address.

alter table public.rep_invites
  add column if not exists invited_email text,
  add column if not exists invited_phone text,
  add column if not exists channel text check (channel in ('email', 'sms'));

-- Rate-limit and supersede lookups in send-agent-invite.
create index if not exists rep_invites_created_by_created_at_idx
  on public.rep_invites (created_by, created_at desc);

-- Close the copy-the-link loophole. Migration 072 let the creator read their
-- own rows (tokens included) and delete them; with agents now creating invites
-- through the edge function, an agent must never be able to read a token back.
-- Admin-only from the browser; the edge functions use the service role, which
-- bypasses RLS.
drop policy if exists "rep_invites_select" on public.rep_invites;
drop policy if exists "rep_invites_insert" on public.rep_invites;
drop policy if exists "rep_invites_delete" on public.rep_invites;

create policy "rep_invites_select" on public.rep_invites
  for select using (public.is_admin());

create policy "rep_invites_insert" on public.rep_invites
  for insert with check (created_by = auth.uid() and public.is_admin());

create policy "rep_invites_delete" on public.rep_invites
  for delete using (public.is_admin());
