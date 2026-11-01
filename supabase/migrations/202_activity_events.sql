-- 202 — Every section 8 event in the Activity feed (Agent Side Build Order, Lane A
-- item 7). There is still no events table: this makes sure a row exists at the moment
-- of the event, in the table that already fits, and that the feed reads it right.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step at the
-- door. Additive: one trigger and its function on public.leads, one index, and
-- agent_activity_feed replaced. Nothing is removed. No backfill: a lead that has no
-- event row yet keeps showing its one column row until its next event.
--
-- APPLY ORDER: after 193 and 195; builds only on what is live through 197. The check
-- below stops the whole file if a table or column it reads is missing.
--
-- 200 (VA servicing, on its own branch) also replaces agent_activity_feed, with two
-- lines of its own. Whichever applies second must carry the other's lines.
--
-- ── log_lead_call_events: the trigger on leads ──────────────────────────────
-- AFTER INSERT OR UPDATE OF va_attempts, transfer_status, transferred_at. The insert
-- matters: va_save_policy_help_lead inserts a new caller already marked transfer
-- requested, and the row for that would otherwise be lost. Cancellation leads are
-- skipped. Each row copies is_sample from the lead. It writes to inbound_events (180):
--   va_call       a VA attempt: va_attempts went up and va_outcome is not_reached,
--                 callback or not_interested. Never on va_last_worked_at alone.
--   transferred   transfer_status or transferred_at changed, or a lead was inserted
--                 with a status. A repeat request keeps 'requested' with a new time, so
--                 it counts; a repeated webhook with the same status and no new time
--                 doesn't. A status set back to null writes nothing: there is nothing
--                 to say, and no code does it today.
-- One action, one row: va_set_lead_outcome adds an attempt for booked and transferred
-- too. Transferred writes only its transferred row. Booked writes nothing here and stays
-- on lead_booked and policy_events.
-- detail holds only outcome, attempt, callback_at, status and summary. Never a step
-- key, which 184's unique index and lead-workflow-sms read, and never the kinds booked,
-- rebooked, no_show or text_received, which drive the workflow's stop logic.
-- Connected and dropped come from help-voice as the service role, with no auth.uid(),
-- so they read actor_name Ohvara, actor_role system, as lead-workflow-sms does.
-- Every row has a label, because it also shows on the agent's lead timeline, whose
-- fallback for a transferred row reads 'Transferred to you' (wrong for a dropped one).
--
-- ── agent_activity_feed: same signature, return columns, grants, gate and limit ──
--   servicing   adds policy_events 'submitted', title 'Submitted for servicing' (the
--               title never reads detail.label). A lapse_save reads 'Lapse risk flagged.',
--               then by outcome 'Policy saved from lapse.', 'Policy lapsed.', 'The client
--               cancelled the policy.' or 'Lapse work done.' for no outcome. No app role can
--               write outcome yet (193), so that last one is what live reads today. An
--               agent's or client's other kinds read 'Request opened: ...' and 'Request
--               done: ...'. System steps keep their words. The done row's reason is now
--               the outcome.
--   va_call     adds the trigger's rows, id inbound_event:<id>. The column row stays only
--               for a lead with no va_call event row.
--   transferred adds the trigger's rows, same id. The column row stays only for a lead
--               with no transferred event row.
--               Neither check has a date window: help-voice leaves transferred_at alone,
--               so a windowed one could show the old row and the new row on different
--               days. And each is per kind: a va_call event doesn't hide the transfer
--               column row, or the other way round. lead_booked is unchanged.
--   text_auto   adds recovery_sms_log where ok and skipped is null, id recovery_sms:<id>,
--               and inbound_events text_sent and reminder rows that are done and hold a
--               Twilio id. lead-workflow-sms marks a row done before it sends, so a done
--               row with no id may not have gone out. 185 left these rows out on purpose;
--               section 8 says every text, so they are in now.
--   billing_spend_change   agent_inbound_spend_log, id spend_log:<id>, amount unchanged
--               pause state. meta: inbound_type, amount_cents.
--   billing_spend_pause    same source when the pause state changed: 'Lead spend paused.' or
--               'Lead spend resumed.', reason paused or resumed. meta: inbound_type, and
--               amount_cents only when the amount changed too. One log row is one feed row.
-- Still pending, no rows:
--   billing_subscription   no charge-history source exists through 197.
--   a plan change          needs 201.
--
-- ── What never comes back ───────────────────────────────────────────────────
-- 185's rules hold. title is a fixed sentence and meta is built key by key: no phone
-- number, Stripe id, Twilio id or full message. recovery_sms_log is read for id, policy,
-- kind and created_at only. The Twilio id in detail is tested in one where line and is
-- never returned; detail.error is never read.
--
-- ── Who sees spend ──────────────────────────────────────────────────────────
-- This function is security definer and an agent's scope takes in their downline, while
-- the log's RLS is own + admin only (188). So one more line after the gate: a spend row
-- reaches its own agent and admin. An upline agent gets zero, even passing p_agent, and
-- Fulfillment gets zero through pool_rep null, as on every branch but policy_events.

do $$
begin
  if to_regclass('public.agent_inbound_spend_log') is null then
    raise exception '202 needs 188_inbound_spend applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inbound_events' and column_name = 'is_sample')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'is_sample') then
    raise exception '202 needs 186_is_sample_flag applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'recovery_sms_log' and column_name = 'skipped') then
    raise exception '202 needs 157_text_consent applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'servicing_tasks' and column_name = 'outcome') then
    raise exception '202 needs 193_servicing_model applied first';
  end if;
end $$;

-- ── 1. log_lead_call_events ─────────────────────────────────────────────────
create or replace function public.log_lead_call_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_role    text;
  v_changed boolean;
begin
  if new.lead_type = 'cancellation' then
    return new;
  end if;

  select coalesce(nullif(btrim(pr.full_name), ''), 'Unknown'), pr.role::text
    into v_name, v_role
    from profiles pr
   where pr.id = new.va_last_worked_by;

  if tg_op = 'INSERT' then
    v_changed := new.transfer_status is not null;
  else
    v_changed := new.transfer_status is not null
                 and (new.transfer_status is distinct from old.transfer_status
                      or new.transferred_at is distinct from old.transferred_at);

    if new.va_attempts > old.va_attempts and new.va_outcome in ('not_reached', 'callback', 'not_interested') then
      insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_id, actor_name, actor_role, is_sample)
      values (new.id, coalesce(new.assigned_rep_id, new.transfer_agent_id), 'va_call', 'done',
              coalesce(new.va_last_worked_at, now()),
              case new.va_outcome when 'not_reached' then 'A VA called and did not reach the client.'
                                  when 'callback' then 'A VA called and set a callback.'
                                  when 'not_interested' then 'A VA called and the client is not interested.' end,
              jsonb_strip_nulls(jsonb_build_object(
                'outcome', new.va_outcome,
                'attempt', new.va_attempts,
                'callback_at', case when new.va_outcome = 'callback' then to_jsonb(new.va_callback_at) #>> '{}' end,
                'summary', 'Try ' || new.va_attempts || '.')),
              new.va_last_worked_by, v_name, v_role, new.is_sample);
    end if;
  end if;

  if v_changed then
    if new.transfer_status = 'requested' then
      insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_id, actor_name, actor_role, is_sample)
      values (new.id, coalesce(new.transfer_agent_id, new.assigned_rep_id), 'transferred', 'done',
              coalesce(new.transferred_at, now()),
              'A live transfer was requested.',
              jsonb_build_object('status', new.transfer_status),
              new.va_last_worked_by, v_name, v_role, new.is_sample);
    else
      insert into inbound_events (lead_id, agent_id, kind, state, at, label, detail, actor_name, actor_role, is_sample)
      values (new.id, coalesce(new.transfer_agent_id, new.assigned_rep_id), 'transferred', 'done', now(),
              case new.transfer_status when 'connected' then 'A live transfer connected.'
                                       when 'dropped' then 'A live transfer dropped.' end,
              jsonb_build_object('status', new.transfer_status),
              'Ohvara', 'system', new.is_sample);
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.log_lead_call_events() from public, anon, authenticated;

drop trigger if exists leads_log_call_events on public.leads;
create trigger leads_log_call_events
  after insert or update of va_attempts, transfer_status, transferred_at on public.leads
  for each row execute function public.log_lead_call_events();

-- ── 2. The new read ─────────────────────────────────────────────────────────
-- The same reason 185 indexed its other time-range sources.
create index if not exists recovery_sms_log_created_idx on public.recovery_sms_log (created_at desc);

-- ── 3. agent_activity_feed ──────────────────────────────────────────────────
-- 193, copied whole, with only the lines named at the top of this file changed.
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
