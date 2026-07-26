-- Migration 084: Team chat (Prompt 357)
--
-- Real backend for the Team page's new Messages sub-tab: one shared "Team
-- chat" channel every closer/admin is implicitly in, plus arbitrary 1:1 DMs
-- between any two team members. Deliberately net-new — the existing
-- `messages` table (migration 001/043) is a fixed rep→brayden/nate directed
-- inbox with at most one reply per row, not a general conversation model, so
-- it can't represent a shared channel or an arbitrary DM pair without a
-- rewrite. Nothing in that table is touched here.
--
-- No separate participants table: a DM's two sides live directly on
-- team_conversations as dm_participant_a/b (always stored with a < b so a
-- pair has exactly one row, found or created without a self-join). A channel
-- row has both null and is visible to any closer/admin by role alone.
--
-- DO NOT run supabase db push for this migration — apply via SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_team_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('closer', 'admin')
  )
$$;

create table if not exists team_conversations (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('channel', 'dm')),
  dm_participant_a  uuid references profiles(id) on delete cascade,
  dm_participant_b  uuid references profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  constraint team_conversations_shape check (
    (type = 'dm' and dm_participant_a is not null and dm_participant_b is not null and dm_participant_a < dm_participant_b)
    or (type = 'channel' and dm_participant_a is null and dm_participant_b is null)
  )
);

-- Exactly one channel row ever; exactly one row per unordered DM pair.
create unique index if not exists team_conversations_one_channel_idx
  on team_conversations (type) where type = 'channel';
create unique index if not exists team_conversations_dm_pair_idx
  on team_conversations (dm_participant_a, dm_participant_b) where type = 'dm';

create table if not exists team_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references team_conversations(id) on delete cascade,
  sender_id        uuid not null references profiles(id),
  sender_name      text not null,
  body             text not null,
  created_at       timestamptz not null default now()
);

create index if not exists team_messages_conversation_idx on team_messages (conversation_id, created_at);

alter table team_conversations enable row level security;
alter table team_messages enable row level security;

create policy "team_conversations_select" on team_conversations
  for select using (
    type = 'channel' or auth.uid() in (dm_participant_a, dm_participant_b)
  );

create policy "team_conversations_insert" on team_conversations
  for insert with check (
    public.is_team_member()
    and (type = 'channel' or auth.uid() in (dm_participant_a, dm_participant_b))
  );

create policy "team_messages_select" on team_messages
  for select using (
    exists (
      select 1 from team_conversations c
      where c.id = team_messages.conversation_id
        and (c.type = 'channel' or auth.uid() in (c.dm_participant_a, c.dm_participant_b))
    )
  );

create policy "team_messages_insert" on team_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from team_conversations c
      where c.id = team_messages.conversation_id
        and (c.type = 'channel' or auth.uid() in (c.dm_participant_a, c.dm_participant_b))
    )
  );

-- Seed the single channel row if it doesn't exist yet.
insert into team_conversations (type)
select 'channel'
where not exists (select 1 from team_conversations where type = 'channel');

-- New message → a `notifications` row for every other recipient, same shape
-- as the existing messages_reply_notify trigger (migration 043). Channel:
-- every other closer/admin. DM: the other participant.
create or replace function public.team_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv       team_conversations;
  recipient  uuid;
begin
  select * into conv from team_conversations where id = new.conversation_id;

  if conv.type = 'channel' then
    for recipient in
      select id from profiles where role in ('closer', 'admin') and id != new.sender_id
    loop
      insert into notifications (profile_id, type, message, data)
      values (
        recipient, 'team_message',
        new.sender_name || ' in Team chat: ' || left(new.body, 80),
        jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'kind', 'channel')
      );
    end loop;
  else
    recipient := case when conv.dm_participant_a = new.sender_id then conv.dm_participant_b else conv.dm_participant_a end;
    insert into notifications (profile_id, type, message, data)
    values (
      recipient, 'team_message',
      new.sender_name || ': ' || left(new.body, 80),
      jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'kind', 'dm')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists team_messages_notify_trigger on team_messages;
create trigger team_messages_notify_trigger
  after insert on team_messages
  for each row execute function public.team_messages_notify();

-- Realtime, so the Messages tab updates live without waiting on a poll
-- (matches migration 052's pattern for `calls`).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'team_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
  END IF;
END $$;
