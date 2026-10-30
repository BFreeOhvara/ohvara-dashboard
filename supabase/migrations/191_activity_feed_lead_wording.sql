-- 191 — agent_activity_feed(): say lead, not inbound, in the feed's one sentence
-- that still used the word.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Read-only: one function replaced and its grants restated. No table,
-- column, policy, trigger or index is added or changed, and no row is rewritten.
--
-- APPLY ORDER: after 185. Same as 185, the function is plpgsql, so a missing
-- table does not stop this file.
--
-- What changes: the else branch of the `inbound` kind's title, which now reads
-- 'A new lead came in.'. The body is otherwise 185's, character for character.
-- The kind string 'inbound', the id prefix 'lead_inbound:' and the table name
-- inbound_events are code values and stay.
--
-- No backfill is needed: the title is computed each time the function is called
-- and is never stored, so older events read the new sentence once this is on.
--
-- See 185 for who sees what, the kinds and what never comes back.

create or replace function public.agent_activity_feed(
  p_from timestamptz,
  p_to timestamptz,
  p_agent uuid default null,
  p_limit int default 1000
)
returns table (id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_agents uuid[] := '{}';
begin
  select pr.role::text into v_role
    from profiles pr
   where pr.id = v_uid and pr.is_active;

  if v_role is null or v_role not in ('admin', 'agent', 'fulfillment') then
    return;
  end if;

  if v_role = 'agent' then
    v_agents := array(select v_uid union select d.id from public.downline_of(v_uid) d);
  end if;

  return query
  with lead_rows as (
    select l.id as lead_id, l.lead_type, l.state, l.created_at, l.delivered_at,
           coalesce(l.assigned_rep_id, l.transfer_agent_id) as lead_agent,
           coalesce(l.transfer_agent_id, l.assigned_rep_id) as transfer_agent,
           l.transfer_status, l.transferred_at,
           l.va_outcome, l.va_attempts, l.va_callback_at, l.va_last_worked_by, l.va_last_worked_at,
           l.booking_id, coalesce(l.client_policy_id, l.booking_id) as policy_id,
           split_part(n.full_name, ' ', 1) as first_name,
           nullif(btrim(substr(n.full_name, length(split_part(n.full_name, ' ', 1)) + 1)), '') as last_name
      from leads l
     cross join lateral (
       select coalesce(nullif(btrim(l.contact_name), ''), btrim(l.business_name)) as full_name
     ) n
     where l.lead_type <> 'cancellation'
  ),
  policy_lead as (
    select distinct on (x.policy_id) x.policy_id, x.lead_id
      from (
        select lr.booking_id as policy_id, lr.lead_id from lead_rows lr where lr.booking_id is not null
        union all
        select lr.policy_id, lr.lead_id from lead_rows lr where lr.policy_id is not null
      ) x
     order by x.policy_id, x.lead_id
  ),
  events as (
    -- policy_events: booked, moved, no_answer, in_progress, edited, reassigned,
    -- cancelled, and a corrected result as outcome.
    select 'policy_event:' || pe.id::text as id,
           case when pe.detail ->> 'correction' = 'true' then 'outcome' else pe.kind end as kind,
           pe.at as at,
           pl.lead_id as lead_id,
           p.agent_id as agent_id,
           case when p.fulfillment_assigned then p.assigned_fulfillment_id end as pool_rep,
           case
             when pe.detail ->> 'correction' = 'true' and pe.kind = 'cancelled' then 'Call result corrected to Cancelled.'
             when pe.detail ->> 'correction' = 'true' then 'Call result corrected to No-show.'
             when pe.kind = 'booked' and pe.from_status is not null then 'Call booked again.'
             when pe.kind = 'booked' then 'Call booked.'
             when pe.kind = 'moved' then 'Booked call moved to a new time.'
             when pe.kind = 'no_answer' then 'No-show: the call ended with no answer.'
             when pe.kind = 'in_progress' then 'A call started.'
             when pe.kind = 'edited' then 'Booking details changed.'
             when pe.kind = 'reassigned' then 'Call given to another Fulfillment rep.'
             when pe.kind = 'cancelled' then 'Old policy confirmed cancelled.'
             else 'Call updated.'
           end as title,
           p.id as policy_id,
           p.client_first_name as first_name,
           p.client_last_name as last_name,
           p.state as state,
           pe.actor_name as actor_name,
           pe.actor_role as actor_role,
           pe.detail -> 'attempt' as attempt,
           pe.detail ->> 'reason' as reason,
           case when pe.kind = 'moved' then pe.detail ->> 'from' end as from_at,
           case pe.kind when 'moved' then pe.detail ->> 'to'
                        when 'booked' then pe.detail ->> 'scheduled_call_at' end as to_at,
           null::text as raw_text,
           case
             when pe.detail ->> 'correction' = 'true' then
               jsonb_build_object('result_from', pe.detail ->> 'from', 'result_to', pe.kind)
             when pe.kind = 'edited' then
               jsonb_build_object('changed_fields', (
                 select jsonb_agg(c ->> 'field')
                   from jsonb_array_elements(
                     case when jsonb_typeof(pe.detail -> 'changes') = 'array' then pe.detail -> 'changes' else '[]'::jsonb end
                   ) c
               ))
             when pe.kind = 'reassigned' then
               jsonb_build_object('from_name', pe.detail ->> 'from_name', 'to_name', pe.detail ->> 'to_name')
             else '{}'::jsonb
           end as extra
      from policy_events pe
      join policies p on p.id = pe.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where pe.at >= p_from and pe.at < p_to

    union all
    -- inbound
    select 'lead_inbound:' || lr.lead_id::text, 'inbound', coalesce(lr.delivered_at, lr.created_at),
           lr.lead_id, lr.lead_agent, null::uuid,
           case lr.lead_type when 'policy_help' then 'A new live call came in.'
                             when 'mortgage_protection' then 'A new appointment request came in.'
                             else 'A new lead came in.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, null, null, null, null, null, null, '{}'::jsonb
      from lead_rows lr
     where coalesce(lr.delivered_at, lr.created_at) >= p_from
       and coalesce(lr.delivered_at, lr.created_at) < p_to

    union all
    -- text_auto
    select 'followup_sms:' || s.id::text, 'text_auto', s.created_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           case when s.stage = 'just_submitted' then 'Welcome text sent automatically.'
                else 'Automatic follow-up text sent.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'system', null, s.stage, null, null, null, '{}'::jsonb
      from lead_followup_sms_log s
      join lead_rows lr on lr.lead_id = s.lead_id
     where s.status = 'sent'
       and s.created_at >= p_from and s.created_at < p_to

    union all
    -- text_reply: a client's text to a lead
    select 'sms_reply:' || r.id::text, 'text_reply', r.received_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           'The client replied by text.',
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'client', null, null, null, null, r.body, '{}'::jsonb
      from lead_sms_replies r
      join lead_rows lr on lr.lead_id = r.lead_id
     where r.received_at >= p_from and r.received_at < p_to

    union all
    -- text_reply: a message sent to the agent on a client's thread
    select 'policy_message:' || m.id::text, 'text_reply', m.created_at,
           pl.lead_id, p.agent_id, null::uuid,
           'New message on this client''s thread.',
           p.id, p.client_first_name, p.client_last_name, p.state,
           m.sender_name, m.sender_role, null, null, null, null, m.body, '{}'::jsonb
      from policy_messages m
      join policies p on p.id = m.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where m.sender_id <> p.agent_id
       and p.fulfillment_assigned
       and m.created_at >= p_from and m.created_at < p_to

    union all
    -- va_call
    select 'va_call:' || lr.lead_id::text, 'va_call', lr.va_last_worked_at,
           lr.lead_id, lr.lead_agent, null::uuid,
           case lr.va_outcome when 'not_reached' then 'A VA called and did not reach the client.'
                              when 'callback' then 'A VA called and set a callback.'
                              else 'A VA called and the client is not interested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, to_jsonb(lr.va_attempts), lr.va_outcome,
           null, case when lr.va_outcome = 'callback' then to_jsonb(lr.va_callback_at) #>> '{}' end, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.va_outcome in ('not_reached', 'callback', 'not_interested')
       and lr.va_last_worked_at >= p_from and lr.va_last_worked_at < p_to

    union all
    -- booked: a VA's booking with no policy row to log it
    select 'lead_booked:' || lr.lead_id::text, 'booked', lr.va_last_worked_at,
           lr.lead_id, lr.transfer_agent, null::uuid,
           'A VA booked an appointment.',
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, to_jsonb(lr.va_attempts), null, null, null, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.va_outcome = 'booked'
       and lr.booking_id is null
       and lr.va_last_worked_at >= p_from and lr.va_last_worked_at < p_to

    union all
    -- transferred
    select 'lead_transfer:' || lr.lead_id::text, 'transferred', lr.transferred_at,
           lr.lead_id, lr.transfer_agent, null::uuid,
           case lr.transfer_status when 'connected' then 'A live transfer connected.'
                                   when 'dropped' then 'A live transfer dropped.'
                                   else 'A live transfer was requested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           va.full_name, va.role::text, null, lr.transfer_status, null, null, null, '{}'::jsonb
      from lead_rows lr
      left join profiles va on va.id = lr.va_last_worked_by
     where lr.transferred_at >= p_from and lr.transferred_at < p_to

    union all
    -- outcome and sold: the agent's Sold / Follow up / Not interested
    select 'inbound_event:' || ev.id::text,
           case when ev.detail ->> 'outcome' = 'sold' then 'sold' else 'outcome' end,
           ev.at, lr.lead_id, lr.lead_agent, null::uuid,
           case ev.detail ->> 'outcome' when 'sold' then 'Marked sold. The lead is now a client.'
                                        when 'follow_up' then 'Outcome marked: follow up.'
                                        when 'not_interested' then 'Outcome marked: not interested.'
                                        else 'Outcome marked.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, null, ev.detail ->> 'outcome', null, null, ev.detail ->> 'note', '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'outcome'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

    union all
    -- servicing: the task was added
    select 'servicing_added:' || t.id::text, 'servicing', t.created_at,
           t.lead_id, t.agent_id, null::uuid,
           'Servicing task added: ' || replace(t.kind, '_', ' ') || '.',
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           rb.full_name, rb.role::text, null, t.kind, null, to_jsonb(t.due_at) #>> '{}', t.note, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
      left join profiles rb on rb.id = t.requested_by
     where t.created_at >= p_from and t.created_at < p_to

    union all
    -- servicing: the task was done
    select 'servicing_done:' || t.id::text, 'servicing', t.done_at,
           t.lead_id, t.agent_id, null::uuid,
           'Servicing task done: ' || replace(t.kind, '_', ' ') || '.',
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           null, null, null, t.kind, null, null, null, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
     where t.done_at >= p_from and t.done_at < p_to
  )
  select e.id, e.kind, e.at, e.lead_id, e.agent_id, e.title,
         jsonb_strip_nulls(jsonb_build_object(
           'policy_id', e.policy_id,
           'client_first_name', case when e.first_name !~ '[0-9]' then e.first_name end,
           'client_last_name', case when e.last_name !~ '[0-9]' then e.last_name end,
           'state', e.state,
           'actor_name', e.actor_name,
           'actor_role', e.actor_role,
           'attempt', e.attempt,
           'reason', e.reason,
           'from', e.from_at,
           'to', e.to_at,
           'preview', left(regexp_replace(e.raw_text, '\+?\(?[0-9][0-9[:space:]().-]{5,}[0-9]', '[number removed]', 'g'), 140)
         ) || e.extra)
    from events e
   where (v_role = 'admin'
          or (v_role = 'agent' and e.agent_id = any (v_agents))
          or (v_role = 'fulfillment' and e.pool_rep = v_uid))
     and (p_agent is null or e.agent_id = p_agent)
   order by e.at desc, e.id desc
   limit greatest(least(coalesce(p_limit, 1000), 5000), 0);
end;
$$;

revoke execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) to authenticated;
