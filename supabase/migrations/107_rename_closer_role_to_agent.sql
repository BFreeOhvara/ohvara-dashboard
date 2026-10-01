-- Prompt 664: rename user_role 'closer' -> 'agent' (policies/checks that cast
-- the enum literal follow automatically; string-literal function bodies do not).
alter type public.user_role rename value 'closer' to 'agent';

create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('agent', 'admin')
  )
$$;

create or replace function public.team_messages_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  conv       team_conversations;
  recipient  uuid;
begin
  select * into conv from team_conversations where id = new.conversation_id;

  if conv.type = 'channel' then
    for recipient in
      select id from profiles where role in ('agent', 'admin') and id != new.sender_id
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
