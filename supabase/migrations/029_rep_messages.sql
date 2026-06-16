-- ============================================================
-- Migration 029 — Rep messaging (v1)
--
-- Reps message Brayden (dashboard/operational questions) or Nate (sales
-- questions) from the rep portal. Simple async, single table, inline reply
-- (no threading, no realtime). The category the rep picks maps to a fixed
-- recipient: 'brayden' (Dashboard Question) or 'nate' (Sales Question).
--
-- sender_name is denormalized on purpose: the profiles RLS lets a closer read
-- only their OWN profile, so Nate's inbox can't join to the rep's profile for
-- a name — we capture it at send time instead.
-- ============================================================

create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references profiles(id) on delete cascade,
  sender_name text not null,
  recipient   text not null check (recipient in ('brayden', 'nate')),
  body        text not null,
  read        boolean not null default false,   -- recipient has opened it
  reply_body  text,
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists messages_recipient_idx on messages(recipient, created_at desc);
create index if not exists messages_sender_idx    on messages(sender_id, created_at desc);

alter table messages enable row level security;

-- Sender (the rep): create own messages, read own (incl. the reply on the row)
create policy "messages_insert_own" on messages for insert
  with check (sender_id = auth.uid());
create policy "messages_select_own" on messages for select
  using (sender_id = auth.uid());

-- Recipient inbox visibility: admin sees the 'brayden' inbox, closers see the
-- 'nate' inbox (v1: any closer; tighten to a specific closer later if needed).
create policy "messages_select_admin_inbox" on messages for select
  using (recipient = 'brayden' and exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "messages_select_closer_inbox" on messages for select
  using (recipient = 'nate' and exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'closer'));

-- Recipient can reply + mark read (update their own inbox rows only)
create policy "messages_update_admin_inbox" on messages for update
  using (recipient = 'brayden' and exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "messages_update_closer_inbox" on messages for update
  using (recipient = 'nate' and exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'closer'));
