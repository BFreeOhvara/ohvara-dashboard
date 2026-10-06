-- Migration 123: standing Messages threads (Prompt 701)
--
-- Migration 114's threads are per-client (policy_messages) and only exist
-- once a booked client does. This adds the general-purpose lines every agent
-- should have from day one, with no client attached:
--   agent <-> each active Fulfillment rep   (one thread per rep)
--   agent <-> Admin                          (one thread per agent; any admin
--                                             can answer it)
-- Agents never get a thread with other agents.
--
-- Threads are not rows. A thread is the pair (agent_id, peer_id) where
-- peer_id is the Fulfillment rep, or NULL for the Admin line; it "exists" the
-- moment both accounts do, and my_standing_threads() synthesizes the empty
-- ones. Messages only exist once someone writes. Nothing in policy_messages
-- (114) is touched.
--
-- Who may read/write a thread (enforced here, not in the UI):
--   agent        - their own threads (rep must be an active fulfillment user)
--   fulfillment  - threads where peer_id = themselves
--   admin        - Admin-line threads (peer_id is null), every agent's
-- Admin has no read access to agent<->rep threads (unlike per-client ones).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.can_dm_thread(a uuid, p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and (
        -- the agent themself
        (me.role::text = 'agent' and me.id = a and (
          p is null
          or exists (select 1 from public.profiles f where f.id = p and f.role::text = 'fulfillment')
        ))
        -- the fulfillment rep on the other end
        or (me.role::text = 'fulfillment' and p = me.id
            and exists (select 1 from public.profiles ag where ag.id = a and ag.role::text = 'agent'))
        -- any admin, on the Admin line
        or (me.role::text = 'admin' and p is null
            and exists (select 1 from public.profiles ag where ag.id = a and ag.role::text = 'agent'))
      )
  )
$$;

create table if not exists direct_messages (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references profiles(id) on delete cascade,
  peer_id      uuid references profiles(id) on delete cascade,
  peer_key     text generated always as (coalesce(peer_id::text, 'admin')) stored,
  sender_id    uuid not null references profiles(id),
  sender_name  text not null default '',
  sender_role  text not null default '',
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at   timestamptz not null default now()
);

create index if not exists direct_messages_thread_idx on direct_messages (agent_id, peer_key, created_at);

create table if not exists direct_message_reads (
  agent_id      uuid not null references profiles(id) on delete cascade,
  peer_key      text not null,
  profile_id    uuid not null references profiles(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (agent_id, peer_key, profile_id)
);

alter table direct_messages enable row level security;
alter table direct_message_reads enable row level security;

create policy "direct_messages_select" on direct_messages
  for select using (public.can_dm_thread(agent_id, peer_id));

create policy "direct_messages_insert" on direct_messages
  for insert with check (sender_id = auth.uid() and public.can_dm_thread(agent_id, peer_id));

-- No update/delete policies: append-only, same as policy_messages.

create policy "direct_message_reads_own" on direct_message_reads
  for all using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and public.can_dm_thread(agent_id, case when peer_key = 'admin' then null else peer_key::uuid end)
  );

-- Stamp sender name/role from the profile (can't be spoofed) and trim.
create or replace function public.direct_messages_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
    into new.sender_name, new.sender_role
  from profiles where id = new.sender_id;
  new.body := btrim(new.body);
  return new;
end;
$$;

drop trigger if exists direct_messages_stamp_trigger on direct_messages;
create trigger direct_messages_stamp_trigger
  before insert on direct_messages
  for each row execute function public.direct_messages_stamp();

-- Notify the other side. From the agent: the rep, or every active admin on
-- the Admin line. From the rep/admin: the agent. Same notifications shape as
-- 114 so the existing bell renders it and the link opens the thread.
create or replace function public.direct_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  msg       text;
  link      text;
begin
  msg  := new.sender_name || ': ' || left(new.body, 80);
  link := '/messages?dm=' || new.agent_id || '.' || new.peer_key;

  if new.sender_id = new.agent_id then
    if new.peer_id is not null then
      insert into notifications (profile_id, type, message, data)
      values (new.peer_id, 'policy_message', msg,
              jsonb_build_object('message_id', new.id, 'link', link));
    else
      for recipient in select id from profiles where role::text = 'admin' and is_active loop
        insert into notifications (profile_id, type, message, data)
        values (recipient, 'policy_message', msg,
                jsonb_build_object('message_id', new.id, 'link', link));
      end loop;
    end if;
  else
    insert into notifications (profile_id, type, message, data)
    values (new.agent_id, 'policy_message', msg,
            jsonb_build_object('message_id', new.id, 'link', link));
  end if;
  return new;
end;
$$;

drop trigger if exists direct_messages_notify_trigger on direct_messages;
create trigger direct_messages_notify_trigger
  after insert on direct_messages
  for each row execute function public.direct_messages_notify();

-- Every standing thread the caller has, including empty ones. SECURITY
-- DEFINER so it can enumerate the pairs and read last messages without
-- leaning on RLS per row; it only ever returns pairs the caller is a party to
-- (same rule as can_dm_thread).
create or replace function public.my_standing_threads()
returns table (
  agent_id        uuid,
  agent_name      text,
  peer_id         uuid,
  peer_key        text,
  peer_name       text,
  last_body       text,
  last_sender_id  uuid,
  last_at         timestamptz,
  unread_count    int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select pr.id as uid, pr.role::text as role from profiles pr where pr.id = auth.uid()),
  pairs as (
    select me.uid as a, f.id as p
      from me join profiles f on f.role::text = 'fulfillment' and f.is_active
      where me.role = 'agent'
    union all
    select me.uid, null::uuid from me where me.role = 'agent'
    union all
    select ag.id, me.uid
      from me join profiles ag on ag.role::text = 'agent' and ag.is_active
      where me.role = 'fulfillment'
    union all
    select ag.id, null::uuid
      from me join profiles ag on ag.role::text = 'agent' and ag.is_active
      where me.role = 'admin'
  )
  select pa.a, ag.full_name, pa.p, coalesce(pa.p::text, 'admin'), pe.full_name,
         lm.body, lm.sender_id, lm.created_at,
         coalesce((
           select count(*)::int from direct_messages x
           where x.agent_id = pa.a and x.peer_key = coalesce(pa.p::text, 'admin')
             and x.sender_id <> me.uid
             and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
         ), 0)
  from pairs pa
  cross join me
  join profiles ag on ag.id = pa.a
  left join profiles pe on pe.id = pa.p
  left join direct_message_reads r
    on r.agent_id = pa.a and r.peer_key = coalesce(pa.p::text, 'admin') and r.profile_id = me.uid
  left join lateral (
    select y.body, y.sender_id, y.created_at from direct_messages y
    where y.agent_id = pa.a and y.peer_key = coalesce(pa.p::text, 'admin')
    order by y.created_at desc limit 1
  ) lm on true
  order by lm.created_at desc nulls last, coalesce(pe.full_name, 'Admin'), ag.full_name;
$$;

grant execute on function public.my_standing_threads() to authenticated;

-- Realtime so an open thread updates without waiting on a poll.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'direct_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE direct_messages;
  END IF;
END $$;
