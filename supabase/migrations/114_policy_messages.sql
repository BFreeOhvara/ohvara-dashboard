-- Migration 114: Agent <-> Fulfillment messages (Prompt 679)
--
-- Per-submission threads: one conversation per booked client (a `policies`
-- row with fulfillment_assigned = true), shared by the agent who booked it
-- and the Fulfillment team. Net-new table rather than reusing team_messages
-- (migration 084): that one is a channel + 1:1 DM model gated on
-- is_team_member() = agent/admin, so it can't express "this client's thread"
-- and fulfillment reps aren't team members at all. Nothing there is touched.
--
-- Who sees what (enforced here, not in the UI):
--   agent        - threads on policies where agent_id = auth.uid()
--   fulfillment  - every fulfillment_assigned policy (same pool the queue
--                  already shows them via policies RLS)
--   admin        - everything, read + write
-- An agent can never read another agent's thread.
--
-- Unread is tracked per reader in policy_message_reads. Admin's unread count
-- is always 0 (oversight, not a participant); a fulfillment rep only counts
-- threads that are unclaimed or claimed by them.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.can_message_policy(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.policies p
    where p.id = pid
      and p.fulfillment_assigned = true
      and (
        p.agent_id = auth.uid()
        or exists (
          select 1 from public.profiles pr
          where pr.id = auth.uid() and pr.role in ('admin', 'fulfillment')
        )
      )
  )
$$;

create table if not exists policy_messages (
  id           uuid primary key default gen_random_uuid(),
  policy_id    uuid not null references policies(id) on delete cascade,
  sender_id    uuid not null references profiles(id),
  sender_name  text not null default '',
  sender_role  text not null default '',
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at   timestamptz not null default now()
);

create index if not exists policy_messages_policy_idx on policy_messages (policy_id, created_at);

create table if not exists policy_message_reads (
  policy_id     uuid not null references policies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (policy_id, profile_id)
);

alter table policy_messages enable row level security;
alter table policy_message_reads enable row level security;

create policy "policy_messages_select" on policy_messages
  for select using (public.can_message_policy(policy_id));

create policy "policy_messages_insert" on policy_messages
  for insert with check (sender_id = auth.uid() and public.can_message_policy(policy_id));

-- No update/delete policies: messages are append-only.

create policy "policy_message_reads_own" on policy_message_reads
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.can_message_policy(policy_id));

-- Stamp sender name/role from the profile so a client can't spoof either, and
-- trim the body (the check constraint already rejects blank ones).
create or replace function public.policy_messages_stamp()
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

drop trigger if exists policy_messages_stamp_trigger on policy_messages;
create trigger policy_messages_stamp_trigger
  before insert on policy_messages
  for each row execute function public.policy_messages_stamp();

-- New message -> a `notifications` row for the other side. From the agent:
-- the rep who claimed it, or every fulfillment rep while it's unclaimed. From
-- fulfillment/admin: the agent who booked it. Same shape as migration 084's
-- team_messages_notify (type + message + data), so the existing bell renders it.
create or replace function public.policy_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pol        policies;
  recipient  uuid;
  who        text;
  msg        text;
  payload    jsonb;
begin
  select * into pol from policies where id = new.policy_id;
  who := trim(coalesce(pol.client_first_name, '') || ' ' || left(coalesce(pol.client_last_name, ''), 1) || '.');
  msg := new.sender_name || ' on ' || who || ': ' || left(new.body, 80);
  payload := jsonb_build_object('policy_id', new.policy_id, 'message_id', new.id, 'link', '/messages?thread=' || new.policy_id);

  if new.sender_id = pol.agent_id then
    if pol.assigned_fulfillment_id is not null then
      insert into notifications (profile_id, type, message, data)
      values (pol.assigned_fulfillment_id, 'policy_message', msg, payload);
    else
      for recipient in select id from profiles where role = 'fulfillment' and is_active loop
        insert into notifications (profile_id, type, message, data)
        values (recipient, 'policy_message', msg, payload);
      end loop;
    end if;
  else
    insert into notifications (profile_id, type, message, data)
    values (pol.agent_id, 'policy_message', msg, payload);
  end if;

  return new;
end;
$$;

drop trigger if exists policy_messages_notify_trigger on policy_messages;
create trigger policy_messages_notify_trigger
  after insert on policy_messages
  for each row execute function public.policy_messages_notify();

-- One row per thread the caller can see: client, both sides, last message,
-- and how many of the other side's messages the caller hasn't read. SECURITY
-- INVOKER so policy_messages / policies RLS still decides what comes back.
create or replace function public.my_message_threads()
returns table (
  policy_id         uuid,
  client_first_name text,
  client_last_name  text,
  agent_id          uuid,
  agent_name        text,
  fulfillment_id    uuid,
  fulfillment_name  text,
  last_body         text,
  last_sender_id    uuid,
  last_at           timestamptz,
  unread_count      int
)
language sql
stable
security invoker
set search_path = public
as $$
  with me as (select pr.id as uid, pr.role::text as role from profiles pr where pr.id = auth.uid()),
  threads as (
    select m.policy_id as pid, max(m.created_at) as last_at
    from policy_messages m group by m.policy_id
  )
  select p.id, p.client_first_name, p.client_last_name, p.agent_id, ag.full_name,
         p.assigned_fulfillment_id, fu.full_name,
         lm.body, lm.sender_id, t.last_at,
         case
           when me.role = 'admin' then 0
           when me.role = 'fulfillment'
                and p.assigned_fulfillment_id is not null
                and p.assigned_fulfillment_id <> me.uid then 0
           else (
             select count(*)::int from policy_messages x
             where x.policy_id = p.id
               and x.sender_id <> me.uid
               and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
           )
         end
  from threads t
  join policies p on p.id = t.pid
  cross join me
  left join policy_message_reads r on r.policy_id = p.id and r.profile_id = me.uid
  left join profiles ag on ag.id = p.agent_id
  left join profiles fu on fu.id = p.assigned_fulfillment_id
  join lateral (
    select y.body, y.sender_id from policy_messages y
    where y.policy_id = p.id order by y.created_at desc limit 1
  ) lm on true
  order by t.last_at desc;
$$;

grant execute on function public.my_message_threads() to authenticated;

-- Realtime so an open thread updates without waiting on a poll.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'policy_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE policy_messages;
  END IF;
END $$;
