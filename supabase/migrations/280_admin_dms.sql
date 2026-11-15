-- P1018 (Brayden, Nov 15 15:49) — Messages: who sees whom, every role.
--
-- Why Jordan was missing: Messages had no admin <-> admin line at all. An admin's lines were only the shared
-- "Ohvara Support" line with each agent and VA (peer_key 'admin'); can_dm_thread had no rule for two admins, so no
-- line was made and none could be written. P1013's hiding rule was not the cause (Jordan's profile is listed).
--
-- The rule now:
--   * Admins: every other admin (always; their own line, stored lower id first like the VA pair), every VA from
--     account creation, every paying agent (their Ohvara Support lines), and EVERY conversation: VA <-> VA lines that
--     have messages (read only) and every client conversation.
--   * VAs: Ohvara Support, every other VA (from account creation), and client conversations (policy_messages), which
--     ANY VA can now read and answer (was: only the VA assigned to that client). No agent lines.
--   * Agents: Ohvara Support and their own client conversations. No VA lines, never another agent.
--   * Test accounts and agents who never paid: in nobody's Messages (P1013's profile_listed), client conversations
--     included. Admins find them only under Agents > "Signed up, not paying".
-- The old agent <-> VA direct lines (P123/P701) are no longer listed or writable; their rows are kept.
-- direct_messages_notify already tells the other side of a pair (sender = agent_id -> peer; otherwise agent_id).

-- 1. Who may write a direct line (and read it, besides admins) ─────────────────────────────────────────────────────
create or replace function public.can_dm_thread(a uuid, p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and (
        -- agents and VAs: their own Ohvara Support line (P1018: agents have no VA lines, VAs no agent lines)
        (me.role::text in ('agent', 'fulfillment') and a = me.id and p is null)
        -- P977: VA <-> VA, stored lower id first
        or (me.role::text = 'fulfillment' and p is not null and a < p and me.id in (a, p)
            and exists (select 1 from public.profiles o where o.id = case when a = me.id then p else a end and o.role::text = 'fulfillment'))
        -- admins answer every agent's and VA's Support line
        or (me.role::text = 'admin' and p is null
            and exists (select 1 from public.profiles o where o.id = a and o.role::text in ('agent', 'fulfillment')))
        -- P1018: admin <-> admin, stored lower id first (never a test account)
        or (me.role::text = 'admin' and p is not null and a < p and me.id in (a, p)
            and exists (select 1 from public.profiles o where o.id = case when a = me.id then p else a end
                          and o.role::text = 'admin' and not coalesce(o.is_test, false)))
      )
      and case
            when coalesce(case when a = me.id then p else a end, null) is null then not me.is_demo
            else me.is_demo = coalesce((select o.is_demo from public.profiles o where o.id = case when a = me.id then p else a end), false)
          end
  )
$$;

-- Admins read every direct line (writing stays can_dm_thread: their own lines and the Support lines).
drop policy if exists direct_messages_admin_read on public.direct_messages;
create policy direct_messages_admin_read on public.direct_messages for select to authenticated using (public.is_admin());

-- 2. The lines each person has (unfiltered; the wrapper below hides test and never-paid people) ───────────────────
create or replace function public.my_standing_threads_p1013()
returns table(agent_id uuid, agent_name text, peer_id uuid, peer_key text, peer_name text, last_body text,
              last_sender_id uuid, last_at timestamptz, unread_count integer, agent_avatar_url text,
              agent_avatar_color text, peer_avatar_url text, peer_avatar_color text, agent_role text)
language sql stable security definer set search_path = public as $$
  with me as (select pr.id as uid, pr.role::text as role, pr.is_demo as demo from profiles pr where pr.id = auth.uid()),
  pairs as (
    -- agents and VAs: their own Ohvara Support line
    select me.uid as a, null::uuid as p from me where me.role in ('agent', 'fulfillment')
    union all
    -- P977: every other active VA (same demo side), lower id first
    select least(me.uid, v.id), greatest(me.uid, v.id)
      from me join profiles v on v.role::text = 'fulfillment' and v.is_active and v.id <> me.uid
                             and coalesce(v.is_demo, false) = coalesce(me.demo, false)
      where me.role = 'fulfillment'
    union all
    -- admins: every agent's and VA's Ohvara Support line
    select o.id, null::uuid
      from me join profiles o on o.role::text in ('agent', 'fulfillment') and o.is_active
      where me.role = 'admin'
    union all
    -- P1018: admins: every other active admin, lower id first
    select least(me.uid, o.id), greatest(me.uid, o.id)
      from me join profiles o on o.role::text = 'admin' and o.is_active and o.id <> me.uid
                             and coalesce(o.is_demo, false) = coalesce(me.demo, false)
      where me.role = 'admin'
    union
    -- P1018: admins also see every VA <-> VA line that has messages (read only)
    select d.agent_id, d.peer_id
      from me join direct_messages d on d.peer_id is not null
      join profiles x on x.id = d.agent_id and x.role::text = 'fulfillment'
      join profiles y on y.id = d.peer_id and y.role::text = 'fulfillment'
      where me.role = 'admin'
  )
  select pa.a, ag.full_name, pa.p, coalesce(pa.p::text, 'admin'), pe.full_name,
         lm.body, lm.sender_id, lm.created_at,
         case when pa.p is not null and me.uid not in (pa.a, pa.p) then 0 else coalesce((
           select count(*)::int from direct_messages x
           where x.agent_id = pa.a and x.peer_key = coalesce(pa.p::text, 'admin')
             and x.sender_id <> me.uid
             and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
         ), 0) end,
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
revoke execute on function public.my_standing_threads_p1013() from public, anon, authenticated;

-- The filtered list (276's wrapper): both people on a line must be listed (on a line an admin only watches, neither
-- side is me). Kept from P1013: an admin still sees a never-paid sign-up's Support line once they wrote (never a test
-- account's).
create or replace function public.my_standing_threads()
returns table(agent_id uuid, agent_name text, peer_id uuid, peer_key text, peer_name text, last_body text,
              last_sender_id uuid, last_at timestamptz, unread_count integer, agent_avatar_url text,
              agent_avatar_color text, peer_avatar_url text, peer_avatar_color text, agent_role text)
language sql stable security definer set search_path = public as $$
  select t.*
    from public.my_standing_threads_p1013() t
   where (t.agent_id = auth.uid()
          or public.profile_listed(t.agent_id)
          or (t.peer_id is null and t.last_at is not null and public.is_admin() and not public.profile_is_test(t.agent_id)))
     and (t.peer_id is null or t.peer_id = auth.uid() or public.profile_listed(t.peer_id))
$$;

-- 3. Client conversations (policy_messages, P679) ──────────────────────────────────────────────────────────────────
-- Any VA can read and answer any booked client's conversation (was: only the assigned VA); the agent and admins as
-- before.
create or replace function public.can_message_policy(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.policies p
    where p.id = pid
      and p.fulfillment_assigned = true
      and (
        p.agent_id = auth.uid()
        or public.is_admin()
        or public.is_fulfillment()
      )
  )
$$;

-- The conversation list. Security definer now (a VA's policies read rule only shows their own assigned clients), so
-- who sees a conversation is spelled out here: the client's agent, every admin, every VA (any booked client), same
-- demo side only. Never a test or never-paid agent's client (except to that agent). Every VA's unread count is real
-- now that any VA can pick a conversation up.
create or replace function public.my_message_threads()
returns table(policy_id uuid, client_first_name text, client_last_name text, agent_id uuid, agent_name text,
              fulfillment_id uuid, fulfillment_name text, last_body text, last_sender_id uuid, last_at timestamptz,
              unread_count integer, agent_avatar_url text, agent_avatar_color text, fulfillment_avatar_url text,
              fulfillment_avatar_color text)
language sql stable security definer set search_path = public as $$
  with me as (select pr.id as uid, pr.role::text as role, coalesce(pr.is_demo, false) as demo from profiles pr where pr.id = auth.uid()),
  threads as (
    select m.policy_id as pid, max(m.created_at) as last_at
    from policy_messages m group by m.policy_id
  )
  select p.id, p.client_first_name, p.client_last_name, p.agent_id, ag.full_name,
         p.assigned_fulfillment_id, fu.full_name,
         lm.body, lm.sender_id, t.last_at,
         case
           when me.role = 'admin' then 0
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
  where coalesce(p.is_demo, false) = me.demo
    and (p.agent_id = me.uid
         or (p.fulfillment_assigned and me.role in ('admin', 'fulfillment') and public.profile_listed(p.agent_id)))
  order by t.last_at desc;
$$;
revoke execute on function public.my_message_threads() from public, anon;
grant execute on function public.my_message_threads() to authenticated;

-- 4. P1018 Connect: what GoHighLevel has sent so far (the Test buttons on steps 4-6) ──────────────────────────────
-- Admin only. Times and counts only, never a lead's details. bridge_on: while ghl_settings.enabled is off, ghl-webhook
-- records nothing but opt-outs, so the page can say why nothing has arrived yet.
create or replace function public.admin_ghl_heard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'bridge_on',    coalesce((select enabled from public.ghl_settings where id = true), false),
    'leads',        (select count(*) from public.lead_intake),
    'lead_at',      (select max(received_at) from public.lead_intake),
    'test_lead_at', (select max(received_at) from public.lead_intake where is_test),
    'campaigns',    (select count(*) from public.ghl_campaign_agents),
    'campaign_at',  (select max(coalesce(last_seen_at, first_seen_at)) from public.ghl_campaign_agents),
    'reply_at',     (select max(received_at) from public.lead_sms_replies where twilio_sid like 'ghl:%'),
    'opt_out_at',   (select max(changed_at) from public.sms_opt_outs where source = 'GHL'));
end;
$$;
revoke execute on function public.admin_ghl_heard() from public, anon;
grant execute on function public.admin_ghl_heard() to authenticated;
