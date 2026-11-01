-- NEXT — contact_log: one read-only list of every text and call that went to an
-- agent's own client or lead, with when, the words or the result, and who sent it.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked step. It
-- applies only after 193_servicing_model.sql: its first statement stops the whole
-- file if 193's view or any table or function read below isn't there. A plpgsql body
-- isn't checked at create, so without that the file could apply cleanly and fail on
-- first call. Additive: one new function. No table, policy, index or grant changes on
-- anything that exists. It sends nothing and every live switch stays as it is.
--
-- NEXT IS A PLACEHOLDER. No number was reserved for this task when it was written.
-- Rename the file and replace NEXT here and in the guard once the runner reserves one.
--
-- Why: the Servicing Spec says "there is no single contact log today." Agents should
-- never have to guess what was said to their people, and the Client and lead pages
-- both read from this. It is a function, not a view: lead_followup_sms_log,
-- recovery_sms_log and lead_sms_replies are revoked from authenticated with no agent
-- policy, so a security_invoker view returns nothing and a definer view can't check
-- the caller.
--
-- FRONTEND CONTRACT (the pages rely on these names):
--   rpc contact_log(p_client_key text default null, p_lead uuid default null,
--                   p_before timestamptz default null, p_limit int default 200)
--     p_client_key   one client: exactly policy_servicing_status.client_key.
--     p_lead         one lead. Both together raise 22023. Neither: everything the
--                    caller can see, clients and leads.
--     p_before       only rows with occurred_at < p_before, for paging.
--     p_limit        0 to 1000. Null means 200.
--   Newest first: occurred_at desc, id desc. Execute is for authenticated only.
--   Returns:
--     id            'source:row id'. The row id is a uuid, except
--                   fulfillment_voice_legs, whose key is its Twilio call_sid.
--     subject       client or lead.
--     client_key    the client's key on a client row. Null on every lead row, and on
--                   a client row whose policy isn't in policy_servicing_status.
--     lead_id       set on lead rows, null on client rows.
--     policy_id     set on client rows, null on lead rows.
--     agent_id      the policy's agent, or coalesce(assigned_rep_id, transfer_agent_id).
--     occurred_at   timestamptz in UTC. The page converts.
--     channel       text or call.
--     direction     out or in.
--     body          the words exactly as stored. Null when none were kept, see GAPS.
--     call_result   a key, on call rows. The page holds the words.
--     sender_type   va, system, agent, lead or client.
--     sender_name   the person's name when one is known.
--     source        the table the row came from; 'leads.va_outcome' for the VA columns.
--     kind          the source's own key. Stage, step, recovery kind or policy event
--                   kind; transfer_status on a leads.va_outcome row. Null elsewhere.
--     attempts      the attempt count on policy_events and leads.va_outcome rows.
--   Sender from a role: fulfillment or admin = va; agent or closer = agent; no person
--   = system. The brief's map has no old rep role: a calls row by a rep reads agent,
--   because a person placed it and sender_name says who.
--
-- ACCESS RULE (the same check as 193's agent_activity_feed):
--   The caller's role comes from profiles where id = auth.uid() and is_active.
--   can_view_agent has no is_active check, so it isn't used.
--   Null role, or anything other than admin or agent: no rows and no error. That
--   includes fulfillment, closer, rep, an inactive agent and a null auth.uid().
--   Agent: self plus public.downline_of(self). Admin: all.
--   Client rows: policies where p.agent_id is one of those, or admin, and always
--   p.is_demo = my_is_demo(). Definer rights skip the demo wall, so that line must be
--   there. Lead rows: leads where lead_type <> 'cancellation' and coalesce(
--   assigned_rep_id, transfer_agent_id) is one of those, or admin. Lead rows have no
--   demo wall (193's rule).
--   DELIBERATE: leads RLS (166) is stricter, assigned agent only, so an upline seeing
--   a downline's lead words is a deliberate choice here, because the feed already
--   shows those rows.
--   A lead or client the caller can't see returns zero rows, never an error, so
--   nothing can be probed.
--   A lead's rows stay subject = lead with client_key null even when client_policy_id
--   is set, so a Sold lead never shows under its client's key.
--
-- USED, one union branch each. Only things that happened.
--   Texts:
--   1. lead_followup_sms_log  lead, out, status = 'sent', created_at. No words.
--   2. lead_sms_replies       lead, in, lead_id not null, received_at, body as stored.
--   3. inbound_events         lead, out, kind in text_sent or reminder, state = 'done',
--                             detail has step, at. Body stays null even with
--                             detail.summary or label set: "Asks for a good time to
--                             talk." reads like words but isn't what was sent.
--   4. recovery_sms_log       client, out, ok is true and skipped is null, created_at.
--                             No words.
--   5. reminder_log           lead through appointments.lead_id, out, status = 'sent',
--                             channel = 'sms', twilio_message_sid not null, send_time,
--                             body = message_body. process-reminders has a stub mode:
--                             with no Twilio account it marks rows sent with no sid and
--                             nothing goes out, so the sid is required too.
--   Calls:
--   6. calls                  lead, out, created_at, coalesce(call_outcome, outcome),
--                             sender from rep_id's role. Outcome only: notes,
--                             call_notes, recording_url, twilio_recording_url,
--                             transcript and the grade-call fields are never selected.
--   7. help_calls             lead, in, lead_id not null, created_at,
--                             coalesce(outcome, status).
--   8. policy_events          client, out, kind in no_answer, in_progress or cancelled,
--                             not a correction, at, attempts = detail.attempt, sender
--                             from actor_role. booked and moved stay out. A finished
--                             call has two rows, its start and its result; attempts
--                             pairs them. Results come from here, because
--                             cancellation_call_at and scheduled_call_at are planned
--                             times, not calls.
--   9. fulfillment_voice_legs client, out, party = 'client' only (a carrier leg is not
--                             a call to the client), started_at, answered or
--                             coalesce(end_reason, status), sender va (fulfillment-call
--                             only lets fulfillment or admin ring). It can sit next to
--                             the policy_events rows for the same call and isn't merged:
--                             the leg is the client being rung, the event is the rep's
--                             logged state. The source column lets the page group them.
--   10. leads VA columns      lead, out, va_outcome and va_last_worked_at not null,
--                             va_last_worked_at, kind = transfer_status, attempts =
--                             va_attempts, sender from va_last_worked_by. Source name
--                             'leads.va_outcome'.
--
-- LEFT OUT:
--   appointments.sms_24h_sent, sms_1h_sent, sms_10min_sent: send-appointment-reminders
--     really texts leads, but keeps only true/false flags with no time or words, so
--     nothing truthful can be listed.
--   start-agent-caller-id-call: a real two-leg call from a rep to the client, but the
--     function writes no row anywhere. Checked: its only writes are to Twilio. It shows
--     only through the in_progress policy_events row that fulfillment_start_call writes
--     when useCallActions' onCall fires. A view with no onCall, or a repeat tap while a
--     call is already live, adds no row.
--   closer_followups: client name only, no client or lead id, and a personal reminder.
--     Not in the one-row-per-source check.
--   fulfillment_missed_calls: the rep's strike record, a call that did not happen. Its
--     apology texts are in recovery_sms_log.
--   policies.recovery_*_sent_at and missed_apology*_sent_at: the same texts as
--     recovery_sms_log.
--   policies.last_call_outcome, call_attempts, last_call_at: current state of the calls
--     in policy_events.
--   policies.cancellation_call_at and scheduled_call_at: planned times, not calls.
--   inbound_events kinds va_call, transferred, missed, text_received: nothing writes
--     them today (grep: the SQL writers write outcome, note and became_client;
--     lead-workflow-sms writes text_sent, reminder and follow_up). VA calls come from
--     the leads columns, replies from lead_sms_replies. inbound_events.follow_up is a
--     "texts stopped" marker with a detail.step, so the kind filter keeps it out.
--   agent_sms_senders, sms_opt_outs, sms_consent_scripts: settings, not contact.
--   notifications and pushes (notification_emails, notification_pushes too): go to staff.
--   messages, team_messages, direct_messages: staff chat.
--   policy_messages: the agent-team thread, out by scope.
--   Also found while checking:
--   leads.transfer_status and transferred_at: the same VA call as the leads.va_outcome
--     row, which carries transfer_status as its kind.
--   follow_up_queue and appointments.scheduled_at: planned times, not contact.
--   fulfillment_recordings: a recording of a call the legs already list, and only an
--     admin can read them (145).
--   send-agent-invite and agent-caller-id: they reach the agent, not a client or lead.
--
-- GAPS:
--   No stored words: lead_followup_sms_log, inbound_events, recovery_sms_log. Their rows
--   return a null body.
--   The leads VA columns keep only the latest call; earlier attempts survive only as a
--   count.
--   A reply is matched to a lead by phone only, so a client's reply to a recovery text
--   has no client row, and a reply with no match reaches no agent.
--   An agent's own tel: and sms: taps are not recorded anywhere.
--   calls has no writer left today (no insert found in src or functions); it is
--   included because the rows exist.
--   Leads made before 166 default to lead_type 'cancellation', so old calls and
--   reminder_log rows on those leads stay hidden by the access rule.
--   lead-workflow-sms marks a step done just before it sends, then skipped if Twilio
--   refuses. A crash between the two leaves a done row for a text that never went.

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.policy_servicing_status') is null or to_regclass('public.agent_clients') is null then
    raise exception 'NEXT needs 193_servicing_model applied first';
  end if;
  if to_regclass('public.lead_followup_sms_log') is null then
    raise exception 'NEXT needs 177_lead_followup_sms_log applied first';
  end if;
  if to_regclass('public.recovery_sms_log') is null then
    raise exception 'NEXT needs 122_no_answer_recovery applied first';
  end if;
  if to_regclass('public.lead_sms_replies') is null then
    raise exception 'NEXT needs 183_lead_sms_replies applied first';
  end if;
  if to_regclass('public.inbound_events') is null then
    raise exception 'NEXT needs 180_agent_inbounds applied first';
  end if;
  if to_regclass('public.reminder_log') is null then
    raise exception 'NEXT needs 004_reminder_log applied first';
  end if;
  if to_regclass('public.appointments') is null or to_regclass('public.calls') is null then
    raise exception 'NEXT needs 001_initial_schema applied first';
  end if;
  if to_regclass('public.help_calls') is null then
    raise exception 'NEXT needs 179_help_calls applied first';
  end if;
  if to_regclass('public.policy_events') is null then
    raise exception 'NEXT needs 118_policy_events applied first';
  end if;
  if to_regclass('public.fulfillment_voice_legs') is null then
    raise exception 'NEXT needs 137_portal_phone applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'va_outcome') then
    raise exception 'NEXT needs 175_va_desk applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_type') then
    raise exception 'NEXT needs 166_lead_types_delivery applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'policies' and column_name = 'is_demo')
     or to_regprocedure('public.my_is_demo()') is null then
    raise exception 'NEXT needs 156_phone_app applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'recovery_sms_log' and column_name = 'skipped') then
    raise exception 'NEXT needs 157_text_consent applied first';
  end if;
  if to_regprocedure('public.downline_of(uuid)') is null then
    raise exception 'NEXT needs 072_insurance_launch applied first';
  end if;
end $$;

-- ── 2. contact_log ──────────────────────────────────────────────────────────
create or replace function public.contact_log(
  p_client_key text default null,
  p_lead uuid default null,
  p_before timestamptz default null,
  p_limit int default 200
)
returns table (
  id text, subject text, client_key text, lead_id uuid, policy_id uuid, agent_id uuid,
  occurred_at timestamptz, channel text, direction text, body text, call_result text,
  sender_type text, sender_name text, source text, kind text, attempts int
)
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
  if p_client_key is not null and p_lead is not null then
    raise exception 'Pass a client key or a lead, not both' using errcode = '22023';
  end if;

  select pr.role::text into v_role
    from profiles pr
   where pr.id = v_uid and pr.is_active;

  if v_role is null or v_role not in ('admin', 'agent') then
    return;
  end if;

  if v_role = 'agent' then
    v_agents := array(select v_uid union select d.id from public.downline_of(v_uid) d);
  end if;

  return query
  with my_clients as (
    select p.id as policy_id, p.agent_id, s.client_key
      from policies p
      left join policy_servicing_status s on s.policy_id = p.id
     where (v_role = 'admin' or p.agent_id = any (v_agents))
       and p.is_demo = (select public.my_is_demo())
       and p_lead is null
       and (p_client_key is null or s.client_key = p_client_key)
  ),
  my_leads as (
    select l.id as lead_id, coalesce(l.assigned_rep_id, l.transfer_agent_id) as agent_id,
           l.va_outcome, l.va_attempts, l.va_last_worked_by, l.va_last_worked_at, l.transfer_status
      from leads l
     where l.lead_type <> 'cancellation'
       and (v_role = 'admin' or coalesce(l.assigned_rep_id, l.transfer_agent_id) = any (v_agents))
       and p_client_key is null
       and (p_lead is null or l.id = p_lead)
  ),
  entries as (
    -- 1. lead_followup_sms_log
    select 'lead_followup_sms_log' as source, f.id::text as row_id, 'lead' as subject,
           null::text as client_key, ml.lead_id, null::uuid as policy_id, ml.agent_id,
           f.created_at as occurred_at, 'text' as channel, 'out' as direction,
           null::text as body, null::text as call_result,
           'system' as sender, null::text as sender_name, f.stage as kind, null::int as attempts
      from lead_followup_sms_log f
      join my_leads ml on ml.lead_id = f.lead_id
     where f.status = 'sent'

    union all
    -- 2. lead_sms_replies
    select 'lead_sms_replies', r.id::text, 'lead',
           null, ml.lead_id, null, ml.agent_id,
           r.received_at, 'text', 'in',
           r.body, null,
           'lead', null, null, null
      from lead_sms_replies r
      join my_leads ml on ml.lead_id = r.lead_id

    union all
    -- 3. inbound_events
    select 'inbound_events', ev.id::text, 'lead',
           null, ml.lead_id, null, ml.agent_id,
           ev.at, 'text', 'out',
           null, null,
           'system', null, ev.detail ->> 'step', null
      from inbound_events ev
      join my_leads ml on ml.lead_id = ev.lead_id
     where ev.kind in ('text_sent', 'reminder')
       and ev.state = 'done'
       and ev.detail ? 'step'

    union all
    -- 4. recovery_sms_log
    select 'recovery_sms_log', rs.id::text, 'client',
           mc.client_key, null, mc.policy_id, mc.agent_id,
           rs.created_at, 'text', 'out',
           null, null,
           'system', null, rs.kind, null
      from recovery_sms_log rs
      join my_clients mc on mc.policy_id = rs.policy_id
     where rs.ok is true
       and rs.skipped is null

    union all
    -- 5. reminder_log. The sid is what tells a real send from process-reminders' stub.
    select 'reminder_log', rl.id::text, 'lead',
           null, ml.lead_id, null, ml.agent_id,
           rl.send_time, 'text', 'out',
           rl.message_body, null,
           'system', null, null, null
      from reminder_log rl
      join appointments a on a.id = rl.appointment_id
      join my_leads ml on ml.lead_id = a.lead_id
     where rl.status = 'sent'
       and rl.channel = 'sms'
       and rl.twilio_message_sid is not null
       and rl.send_time is not null

    union all
    -- 6. calls. The outcome and the caller, nothing else from this table.
    select 'calls', c.id::text, 'lead',
           null, ml.lead_id, null, ml.agent_id,
           c.created_at, 'call', 'out',
           null, coalesce(c.call_outcome, c.outcome::text),
           caller.role::text, caller.full_name, null, null
      from calls c
      join my_leads ml on ml.lead_id = c.lead_id
      left join profiles caller on caller.id = c.rep_id

    union all
    -- 7. help_calls
    select 'help_calls', h.id::text, 'lead',
           null, ml.lead_id, null, ml.agent_id,
           h.created_at, 'call', 'in',
           null, coalesce(h.outcome, h.status),
           'lead', null, null, null
      from help_calls h
      join my_leads ml on ml.lead_id = h.lead_id

    union all
    -- 8. policy_events
    select 'policy_events', pe.id::text, 'client',
           mc.client_key, null, mc.policy_id, mc.agent_id,
           pe.at, 'call', 'out',
           null, pe.kind,
           pe.actor_role, pe.actor_name, pe.kind, (pe.detail ->> 'attempt')::int
      from policy_events pe
      join my_clients mc on mc.policy_id = pe.policy_id
     where pe.kind in ('no_answer', 'in_progress', 'cancelled')
       and pe.detail ->> 'correction' is distinct from 'true'

    union all
    -- 9. fulfillment_voice_legs
    select 'fulfillment_voice_legs', vl.call_sid, 'client',
           mc.client_key, null, mc.policy_id, mc.agent_id,
           vl.started_at, 'call', 'out',
           null, case when vl.answered_at is not null then 'answered' else coalesce(vl.end_reason, vl.status) end,
           'va', null, null, null
      from fulfillment_voice_legs vl
      join my_clients mc on mc.policy_id = vl.policy_id
     where vl.party = 'client'

    union all
    -- 10. leads VA columns
    select 'leads.va_outcome', ml.lead_id::text, 'lead',
           null, ml.lead_id, null, ml.agent_id,
           ml.va_last_worked_at, 'call', 'out',
           null, ml.va_outcome,
           va.role::text, va.full_name, ml.transfer_status, ml.va_attempts
      from my_leads ml
      left join profiles va on va.id = ml.va_last_worked_by
     where ml.va_outcome is not null
       and ml.va_last_worked_at is not null
  )
  select e.source || ':' || e.row_id,
         e.subject, e.client_key, e.lead_id, e.policy_id, e.agent_id,
         e.occurred_at, e.channel, e.direction, e.body, e.call_result,
         case when e.sender in ('fulfillment', 'admin', 'va') then 'va'
              when e.sender in ('agent', 'closer', 'rep') then 'agent'
              when e.sender in ('lead', 'client') then e.sender
              else 'system' end,
         e.sender_name, e.source, e.kind, e.attempts
    from entries e
   where p_before is null or e.occurred_at < p_before
   order by e.occurred_at desc, 1 desc
   limit greatest(least(coalesce(p_limit, 200), 1000), 0);
end;
$$;

revoke execute on function public.contact_log(text, uuid, timestamptz, int) from public, anon, service_role;
grant execute on function public.contact_log(text, uuid, timestamptz, int) to authenticated;

comment on function public.contact_log(text, uuid, timestamptz, int) is
  'Every text and call that went to the caller''s own client or lead. Read-only. See the migration header for the sources, what is left out and the gaps.';

-- Check after applying:
--   select prosecdef, provolatile, proconfig from pg_proc where oid = 'public.contact_log(text, uuid, timestamptz, int)'::regprocedure;
--     -- true, s, {search_path=public}
--   select r, has_function_privilege(r, 'public.contact_log(text, uuid, timestamptz, int)', 'execute')
--     from unnest(array['anon', 'authenticated', 'service_role']) r;
--     -- anon false, authenticated true, service_role false
--   select r, has_table_privilege('authenticated', r, 'select')
--     from unnest(array['public.lead_followup_sms_log', 'public.recovery_sms_log', 'public.lead_sms_replies']) r;
--     -- all false
