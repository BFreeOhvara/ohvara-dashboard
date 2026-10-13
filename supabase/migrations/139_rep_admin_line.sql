-- Migration 139: Fulfillment reps get an Admin line (Prompt 754)
--
-- Migration 123's standing threads gave every agent an Admin line
-- (agent_id = the agent, peer_id = NULL) but gave reps agent lines only. A rep
-- now owns an Admin line the same way: (agent_id = the rep's id, peer_id =
-- NULL). The column keeps its name; on an Admin line `agent_id` means "the
-- owner of the line", agent or rep.
--
-- Who may read/write a thread after this:
--   agent        - their own threads (rep must be an active fulfillment user)
--   fulfillment  - threads where peer_id = themselves (agent <-> rep), and
--                  their own Admin line (agent_id = themselves, peer_id null)
--   admin        - every Admin line, whether the owner is an agent or a rep
-- Reps still can't read other reps' or agents' Admin lines, and admin still
-- can't read agent <-> rep threads.
--
-- direct_messages_notify (123) needs no change: a rep writing their Admin line
-- is sender = agent_id with peer null, so every active admin is notified; an
-- admin reply notifies agent_id, i.e. the rep.
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
        -- the fulfillment rep on the other end of an agent line
        or (me.role::text = 'fulfillment' and p = me.id
            and exists (select 1 from public.profiles ag where ag.id = a and ag.role::text = 'agent'))
        -- the fulfillment rep's own Admin line
        or (me.role::text = 'fulfillment' and a = me.id and p is null)
        -- any admin, on any agent's or rep's Admin line
        or (me.role::text = 'admin' and p is null
            and exists (select 1 from public.profiles o where o.id = a and o.role::text in ('agent', 'fulfillment')))
      )
  )
$$;

-- Same as 124 plus the rep's own Admin line, admin's view of reps' Admin
-- lines, and `agent_role` (the line owner's role) so admin's inbox can label
-- a rep's line Fulfillment.
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
  peer_avatar_color text,
  agent_role        text
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
    select me.uid, null::uuid from me where me.role in ('agent', 'fulfillment')
    union all
    select ag.id, me.uid
      from me join profiles ag on ag.role::text = 'agent' and ag.is_active
      where me.role = 'fulfillment'
    union all
    select o.id, null::uuid
      from me join profiles o on o.role::text in ('agent', 'fulfillment') and o.is_active
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
         ag.avatar_url, ag.avatar_color, pe.avatar_url, pe.avatar_color,
         ag.role::text
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
