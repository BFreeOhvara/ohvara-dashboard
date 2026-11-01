-- 209 — A lapse shows on Activity when it happens, as its own plain row. Today a policy
-- set to Lapsed (policies.status, 085) with no lapse_save task leaves no trace, so the
-- agent never finds out from that page. The lapse_save rows already read right (202, 206).
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step at the door.
-- Additive: one kind added to a check, one trigger and its function on public.policies,
-- and agent_activity_feed replaced. Nothing is removed. No backfill: a policy already
-- Lapsed gets no row, because the moment it lapsed isn't recorded anywhere.
--
-- APPLY ORDER: 206_va_servicing first, then this file. The check below stops the whole
-- file if 206, or anything else it reads, is missing. 207 and 208 touch none of this, so
-- their order doesn't matter here.
--
-- TESTS. The real run is at the apply step, against the applied migration:
-- supabase/tests/p_activity_lapse_events.sql, as p_activity_events.sql does. No robot can
-- run SQL against Ohvara, and none did. On this computer only, `npm run test:sql --
-- <that file>` replays every migration into an in-memory PGlite, which is a stand-in.
--
-- OTHER FEED MIGRATIONS. Whichever feed migration applies second must carry the other's
-- lines (202's rule). Billing work (goal fe2f2055) is going to replace agent_activity_feed
-- too: if it applies after this file it must carry the one title line below; if it
-- applies first, this file must be redone on top of it before applying.
-- Checked Nov 1 at 5:33 PM and again at 5:46 PM, same result, with git fetch --all and git
-- grep across every local and remote branch:
--   agent_activity_feed is replaced only by 185, 191, 193, 202 and 206. Every branch that
--   has 206 has the same file as master, so 206 is the newest version and it is copied here.
--   policy_events_kind_check is changed only by 121, 134, 142, 187 and 206. 206 is newest.
--   Numbers past 206 on open branches: 207_lead_outcomes, 208_text_words and
--   208_transfer_missed. None names the feed, policy_events or Lapsed.
--   No billing branch holds a feed migration yet.
--   209 is the number the runner reserved for this branch. The ledger itself can't be read
--   from a worktree, so a number reserved with no file pushed yet is not visible here.
--
-- ── policy_events_kind_check ────────────────────────────────────────────────
-- Every value from 206, plus lapsed.
--
-- ── log_policy_lapsed: the trigger on policies ──────────────────────────────
-- AFTER UPDATE OF status, for each row, only when the new status is Lapsed and the old one
-- was something else. So Lapsed to Lapsed and every other status change write nothing, and
-- reinstating a policy that later lapses again writes a second row, which is a second
-- lapse. A policy inserted already Lapsed writes nothing.
-- It writes one policy_events row: kind lapsed, from_status and detail.from the old status,
-- is_sample from the policy. The actor is the signed-in person from profiles. Nobody signed
-- in, or a uid with no profile, reads actor_name Ohvara, actor_role system, as
-- log_lead_call_events does for a webhook: actor_id is a foreign key to profiles, so a uid
-- with no profile would otherwise refuse the status change itself.
-- detail holds only from. No phone number, policy number, carrier name or free text.
--
-- ── agent_activity_feed: same signature, return columns, grants, gate and limit ──
-- 206's copied whole, with one line added, the title. Feed kind lapsed comes through the
-- branch's own else pe.kind, title 'Policy lapsed. Payments stopped.', and meta is the
-- usual keys. The servicing lapse_save rows stay kind servicing, with their words unchanged.
-- Who sees it is the same as for every other policy_events kind: the policy's agent, their
-- upline, admin, and the Fulfillment rep the call is assigned to.
--
-- TWO ROWS ON PURPOSE. A lapse_save done with outcome lapsed reads 'Policy lapsed.', and
-- 206 does not change policies.status. The agent setting the status to Lapsed afterwards
-- reads 'Policy lapsed. Payments stopped.'. They are two separate acts by two people, so
-- that is two rows, not a duplicate. Neither hides the other.
--
-- NOTHING SIGNED IN CAN SET LAPSED YET. 147 and 149 dropped every direct UPDATE on policies,
-- for agents, VAs and admin alike. PolicyModal, the one screen that wrote Lapsed, is
-- imported by nothing, and no function or edge function writes it. So until an RPC for it
-- exists, only the service role reaches this trigger, and the row will not show in normal
-- use. This file is still right to apply: any path added later is caught with no change
-- here, because the trigger sits on the column.
--
-- The UI reads feed kind lapsed (src/lib/activityKinds.js).

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.va_servicing_queue()') is null then
    raise exception '209 needs 206_va_servicing applied first';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'policy_status' and e.enumlabel = 'Lapsed') then
    raise exception '209 needs 085_not_approved_and_lapsed applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'policies' and column_name = 'is_sample')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'policy_events' and column_name = 'is_sample') then
    raise exception '209 needs 186_is_sample_flag applied first';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.policy_events'::regclass and c.conname = 'policy_events_kind_check') then
    raise exception '209 needs policy_events_kind_check from 206_va_servicing';
  end if;
end $$;

-- ── 2. The event kind ───────────────────────────────────────────────────────
alter table public.policy_events drop constraint policy_events_kind_check;
alter table public.policy_events add constraint policy_events_kind_check
  check (kind = any (array['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited', 'reassigned',
                           'submitted', 'service_request', 'servicing', 'lapsed']));

-- ── 3. log_policy_lapsed ────────────────────────────────────────────────────
create or replace function public.log_policy_lapsed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_name  text;
  v_role  text;
begin
  select pr.id, coalesce(nullif(btrim(pr.full_name), ''), 'Unknown'), pr.role::text
    into v_actor, v_name, v_role
    from profiles pr
   where pr.id = auth.uid();

  if v_actor is null then
    v_name := 'Ohvara';
    v_role := 'system';
  end if;

  insert into policy_events (policy_id, agent_id, kind, from_status, actor_id, actor_name, actor_role, detail, is_sample)
  values (new.id, new.agent_id, 'lapsed', old.status::text, v_actor, v_name, v_role,
          jsonb_build_object('from', old.status::text), new.is_sample);

  return new;
end;
$$;

revoke execute on function public.log_policy_lapsed() from public, anon, authenticated;

drop trigger if exists policies_log_lapsed on public.policies;
create trigger policies_log_lapsed
  after update of status on public.policies
  for each row
  when (new.status = 'Lapsed' and old.status is distinct from new.status)
  execute function public.log_policy_lapsed();

-- ── 4. agent_activity_feed ──────────────────────────────────────────────────
-- 206, its newest version, with one line added: the title of a lapsed event. All else is 206's.
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
           case when pe.detail ->> 'correction' = 'true' then 'outcome' when pe.kind = 'submitted' then 'servicing' else pe.kind end as kind,
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
             when pe.kind = 'submitted' then 'Submitted for servicing'
             when pe.kind = 'servicing' then pe.detail ->> 'label'
             when pe.kind = 'lapsed' then 'Policy lapsed. Payments stopped.'
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
       and pe.kind <> 'service_request'
       and not (pe.kind = 'servicing' and pe.detail ->> 'action' = 'done')

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
    -- text_auto: the booked-call texts. Confirmed sends only: ok with nothing skipped.
    select 'recovery_sms:' || rs.id::text, 'text_auto', rs.created_at,
           pl.lead_id, p.agent_id, null::uuid,
           case rs.kind when 'text1' then 'Automatic text sent after a missed call.'
                        when 'text2' then 'Automatic reminder text sent about the next call.'
                        when 'am' then 'Automatic text sent after a missed call.'
                        when 'pm' then 'Automatic text sent after a missed call.'
                        when 'apology1' then 'Automatic apology text sent for a missed call.'
                        when 'apology2' then 'Automatic reminder text sent about the next call.'
                        when 'confirm' then 'Automatic confirmation text sent.'
                        else 'Automatic text sent.' end,
           p.id, p.client_first_name, p.client_last_name, p.state,
           null, 'system', null, rs.kind, null, null, null, '{}'::jsonb
      from recovery_sms_log rs
      join policies p on p.id = rs.policy_id
      left join policy_lead pl on pl.policy_id = p.id
     where rs.ok and rs.skipped is null
       and rs.created_at >= p_from and rs.created_at < p_to

    union all
    -- text_auto: lead-workflow-sms steps. It marks a row done before it sends, so
    -- only a row holding Twilio's answer is known to have gone out.
    select 'inbound_event:' || ev.id::text, 'text_auto', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.lead_agent), null::uuid,
           case when ev.detail ->> 'step' = 'instant' then 'Welcome text sent automatically.'
                when ev.detail ->> 'step' like 'not_reached%' then 'Automatic follow-up text sent.'
                when ev.detail ->> 'step' = 'confirm' then 'Automatic confirmation text sent.'
                when ev.detail ->> 'step' like 'reminder%' then 'Automatic reminder text sent.'
                when ev.detail ->> 'step' = 'no_show_rebook' then 'Automatic rebook text sent.'
                else 'Automatic text sent.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           null, 'system', null, ev.detail ->> 'step', null, null, null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind in ('text_sent', 'reminder')
       and ev.state = 'done'
       and nullif(ev.detail ->> 'twilio_sid', '') is not null
       and ev.at >= p_from and ev.at < p_to

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
       and not exists (select 1 from inbound_events x
                        where x.lead_id = lr.lead_id and x.kind = 'va_call' and x.state = 'done')

    union all
    -- va_call: one row per attempt, from log_lead_call_events
    select 'inbound_event:' || ev.id::text, 'va_call', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.lead_agent), null::uuid,
           case ev.detail ->> 'outcome' when 'not_reached' then 'A VA called and did not reach the client.'
                                        when 'callback' then 'A VA called and set a callback.'
                                        when 'not_interested' then 'A VA called and the client is not interested.'
                                        else 'A VA called.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, ev.detail -> 'attempt', ev.detail ->> 'outcome',
           null, ev.detail ->> 'callback_at', null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'va_call'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

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
       and not exists (select 1 from inbound_events x
                        where x.lead_id = lr.lead_id and x.kind = 'transferred' and x.state = 'done')

    union all
    -- transferred: one row per change, from log_lead_call_events
    select 'inbound_event:' || ev.id::text, 'transferred', ev.at,
           lr.lead_id, coalesce(ev.agent_id, lr.transfer_agent), null::uuid,
           case ev.detail ->> 'status' when 'connected' then 'A live transfer connected.'
                                       when 'dropped' then 'A live transfer dropped.'
                                       else 'A live transfer was requested.' end,
           lr.policy_id, lr.first_name, lr.last_name, lr.state,
           ev.actor_name, ev.actor_role, null, ev.detail ->> 'status', null, null, null, '{}'::jsonb
      from inbound_events ev
      join lead_rows lr on lr.lead_id = ev.lead_id
     where ev.kind = 'transferred'
       and ev.state = 'done'
       and ev.at >= p_from and ev.at < p_to

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
           case when t.kind = 'lapse_save' then 'Lapse risk flagged.'
                when t.requested_by in ('agent', 'client') then 'Request opened: ' || replace(t.kind, '_', ' ') || '.'
                else 'Servicing task added: ' || replace(t.kind, '_', ' ') || '.' end,
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           rb.full_name, rb.role::text, null, t.kind, null, to_jsonb(t.due_at) #>> '{}', t.note, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
      left join profiles rb on rb.id = t.requested_by_id
     where t.created_at >= p_from and t.created_at < p_to

    union all
    -- servicing: the task was done
    select 'servicing_done:' || t.id::text, 'servicing', t.done_at,
           t.lead_id, t.agent_id, null::uuid,
           case when t.kind = 'lapse_save' then
                  case t.outcome when 'saved' then 'Policy saved from lapse.'
                                 when 'lapsed' then 'Policy lapsed.'
                                 when 'client_cancelled' then 'The client cancelled the policy.'
                                 else 'Lapse work done.' end
                when t.requested_by in ('agent', 'client') then 'Request done: ' || replace(t.kind, '_', ' ') || '.'
                else 'Servicing task done: ' || replace(t.kind, '_', ' ') || '.' end,
           coalesce(t.policy_id, lr.policy_id),
           coalesce(lr.first_name, p.client_first_name), coalesce(lr.last_name, p.client_last_name), coalesce(lr.state, p.state),
           null, null, null, t.outcome, null, null, null, '{}'::jsonb
      from servicing_tasks t
      left join lead_rows lr on lr.lead_id = t.lead_id
      left join policies p on p.id = t.policy_id
     where t.done_at >= p_from and t.done_at < p_to

    union all
    -- billing_spend_*: one log row is one feed row, and a row that changed nothing is none.
    select 'spend_log:' || sl.id::text,
           case when sl.old_paused is distinct from sl.new_paused then 'billing_spend_pause' else 'billing_spend_change' end,
           sl.created_at, null, sl.agent_id, null::uuid,
           case when sl.old_paused is not distinct from sl.new_paused then 'Weekly lead spend changed.'
                when sl.new_paused then 'Lead spend paused.'
                else 'Lead spend resumed.' end,
           null, null, null, null, null, null, null,
           case when sl.old_paused is not distinct from sl.new_paused then null
                when sl.new_paused then 'paused'
                else 'resumed' end,
           null, null, null,
           jsonb_build_object('inbound_type', sl.inbound_type)
             || case when sl.old_paused is distinct from sl.new_paused and sl.old_cents = sl.new_cents then '{}'::jsonb
                     else jsonb_build_object('amount_cents', sl.new_cents) end
      from agent_inbound_spend_log sl
     where sl.created_at >= p_from and sl.created_at < p_to
       and (sl.old_paused is distinct from sl.new_paused or sl.old_cents is distinct from sl.new_cents)
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
     and (e.kind not in ('billing_spend_change', 'billing_spend_pause') or v_role = 'admin' or e.agent_id = v_uid)
     and (p_agent is null or e.agent_id = p_agent)
   order by e.at desc, e.id desc
   limit greatest(least(coalesce(p_limit, 1000), 5000), 0);
end;
$$;

revoke execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function public.agent_activity_feed(timestamptz, timestamptz, uuid, int) to authenticated;
