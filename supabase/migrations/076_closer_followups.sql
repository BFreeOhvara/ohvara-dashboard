-- Migration 076 — Follow-ups for My Calls → Schedule (Prompt 329, item 8)
--
-- The Schedule tab merges two sources: Cancellation Calls (already real,
-- policies.cancellation_call_at) and Follow-ups — a closer manually logging
-- "call this client at this time" onto their own calendar. No existing table
-- covers that, so this is new, simple CRUD, same RLS shape as `policies`
-- (own rows + admin sees everything; no downline visibility needed here,
-- unlike policies, since a follow-up is a personal reminder, not book data).
create table closer_followups (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references profiles(id) on delete cascade,
  client_name  text not null,
  scheduled_at timestamptz not null,
  notes        text,
  created_at   timestamptz not null default now()
);

create index closer_followups_agent_id_idx on closer_followups(agent_id);

alter table closer_followups enable row level security;

create policy "closer_followups_select" on closer_followups
  for select using (agent_id = auth.uid() or public.is_admin());
create policy "closer_followups_insert" on closer_followups
  for insert with check (agent_id = auth.uid() or public.is_admin());
create policy "closer_followups_update" on closer_followups
  for update using (agent_id = auth.uid() or public.is_admin());
create policy "closer_followups_delete" on closer_followups
  for delete using (agent_id = auth.uid() or public.is_admin());
