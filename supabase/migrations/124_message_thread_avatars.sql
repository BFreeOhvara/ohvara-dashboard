-- Prompt 704: Messages conversation rows get an avatar circle. The two thread
-- RPCs only returned names, so the list had nothing to draw a photo or colour
-- from. Append each counterpart's avatar_url/avatar_color to both. Return type
-- changes, so drop + recreate; bodies are otherwise identical to 114 / 123.
-- Done in the RPCs (not a client-side profiles read) so it doesn't depend on
-- the broad profiles_select policy staying as open as it is today.

drop function if exists public.my_message_threads();
create function public.my_message_threads()
returns table (
  policy_id                uuid,
  client_first_name        text,
  client_last_name         text,
  agent_id                 uuid,
  agent_name               text,
  fulfillment_id           uuid,
  fulfillment_name         text,
  last_body                text,
  last_sender_id           uuid,
  last_at                  timestamptz,
  unread_count             int,
  agent_avatar_url         text,
  agent_avatar_color       text,
  fulfillment_avatar_url   text,
  fulfillment_avatar_color text
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
         end,
         ag.avatar_url, ag.avatar_color, fu.avatar_url, fu.avatar_color
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

drop function if exists public.my_standing_threads();
create function public.my_standing_threads()
returns table (
  agent_id          uuid,
  agent_name        text,
  peer_id           uuid,
  peer_key          text,
  peer_name         text,
  last_body         text,
  last_sender_id    uuid,
  last_at           timestamptz,
  unread_count      int,
  agent_avatar_url  text,
  agent_avatar_color text,
  peer_avatar_url   text,
  peer_avatar_color text
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
         ), 0),
         ag.avatar_url, ag.avatar_color, pe.avatar_url, pe.avatar_color
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
