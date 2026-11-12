-- Migration 270: a direct message between every two VAs (Prompt 977)
--
-- Reuses the standing-threads tables from migration 123 (direct_messages,
-- direct_message_reads). Nothing new is created. A VA-to-VA thread is the
-- pair (agent_id = the lower VA id, peer_id = the higher VA id), so each pair
-- has exactly one thread whichever side writes first. Like every standing
-- thread it is not a row: my_standing_threads() lists it the moment both
-- accounts exist (a new VA shows up for every current VA, and they get one
-- with everyone), empty until someone writes. No group chat.
--
-- Who can read/write a VA pair: only the two VAs (admins don't read VA-to-VA
-- threads, same as agent<->VA). Demo VAs only pair with demo VAs.
-- The notify trigger already handles it: the sender is agent_id -> notify
-- peer_id; otherwise notify agent_id.
-- Only two functions change: can_dm_thread (one new clause) and
-- my_standing_threads (one new pair source). Everything else is as live.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.can_dm_thread(a uuid, p uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and (
        (me.role::text = 'agent' and me.id = a and (
          p is null
          or exists (select 1 from public.profiles f where f.id = p and f.role::text = 'fulfillment')
        ))
        or (me.role::text = 'fulfillment' and p = me.id
            and exists (select 1 from public.profiles ag where ag.id = a and ag.role::text = 'agent'))
        or (me.role::text = 'fulfillment' and a = me.id and p is null)
        -- P977: VA <-> VA, stored lower id first
        or (me.role::text = 'fulfillment' and p is not null and a < p and me.id in (a, p)
            and exists (select 1 from public.profiles o where o.id = case when a = me.id then p else a end and o.role::text = 'fulfillment'))
        or (me.role::text = 'admin' and p is null
            and exists (select 1 from public.profiles o where o.id = a and o.role::text in ('agent', 'fulfillment')))
      )
      and case
            when coalesce(case when a = me.id then p else a end, null) is null then not me.is_demo
            else me.is_demo = coalesce((select o.is_demo from public.profiles o where o.id = case when a = me.id then p else a end), false)
          end
  )
$function$;

create or replace function public.my_standing_threads()
 returns table(agent_id uuid, agent_name text, peer_id uuid, peer_key text, peer_name text, last_body text, last_sender_id uuid, last_at timestamp with time zone, unread_count integer, agent_avatar_url text, agent_avatar_color text, peer_avatar_url text, peer_avatar_color text, agent_role text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (select pr.id as uid, pr.role::text as role, pr.is_demo as demo from profiles pr where pr.id = auth.uid()),
  pairs as (
    select me.uid as a, f.id as p
      from me join profiles f on f.role::text = 'fulfillment' and f.is_active
      where me.role = 'agent'
        and (not public.is_locked_self_signup()
             or exists (select 1 from direct_messages d where d.agent_id = me.uid and d.peer_key = f.id::text))
    union all
    select me.uid, null::uuid from me where me.role in ('agent', 'fulfillment')
    union all
    select ag.id, me.uid
      from me join profiles ag on ag.role::text = 'agent' and ag.is_active
      where me.role = 'fulfillment'
    union all
    -- P977: every other active VA (same demo side), lower id first
    select least(me.uid, v.id), greatest(me.uid, v.id)
      from me join profiles v on v.role::text = 'fulfillment' and v.is_active and v.id <> me.uid
                             and coalesce(v.is_demo, false) = coalesce(me.demo, false)
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
$function$;
