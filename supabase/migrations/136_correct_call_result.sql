-- Prompt 750 — Fix a wrong call result: Cancelled ↔ No answer.
--
-- Before this, No answer → Cancelled already worked (Mark cancelled stays on a
-- No answer call), but Cancelled was final: the Complete stage locked the call,
-- fulfillment_complete_notify (103) had told the agent "completed by
-- Fulfillment" and policy_events (118) had logged 'cancelled'.
--
-- fulfillment_correct_result(p_policy, p_to) is the one path for both ways.
--   Who      an admin any time; the assigned rep only the same day the result
--            was recorded (fulfillment_completed_at for Cancelled, last_call_at
--            for No answer) in the rep's profile zone.
--   Refused  a live call, a row with no result yet (Booked / never called),
--            and a "change" to the result it already has.
--   → no_answer   the row goes back exactly as fulfillment_end_call leaves a
--                 No answer: stage 'In Progress' (stamp_cancellation_times
--                 clears fulfillment_completed_at), call_live_since null,
--                 last_call_outcome 'no_answer', last_call_at kept. status goes
--                 back to 'Submitted': every booking is inserted 'Submitted'
--                 (useAgentBookings) and Mark cancelled's 'In Effect' is the
--                 only status write on the way to Cancelled. The agent gets a
--                 fulfillment_correction notice and the unread "completed"
--                 notice for the policy is marked read. Then the normal
--                 No answer follow-up runs (recovery_after_no_answer, a no-op
--                 while texting is off).
--   → cancelled   the same update Mark cancelled makes (stage 'Complete',
--                 status 'In Effect'); the existing triggers stamp it and send
--                 the usual "completed" notice. An unread correction notice for
--                 the policy is marked read.
-- policy_events_log writes the status-change row as usual; this function then
-- flags it detail.correction = true, detail.from = the old status, so the
-- Activity and My calls views show "Result changed to …" instead of a new call.

create or replace function public.fulfillment_correct_result(p_policy uuid, p_to text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pol    policies;
  v_from text;
  v_at   timestamptz;
  v_tz   text;
  who    text;
begin
  if p_to is null or p_to not in ('no_answer', 'cancelled') then
    raise exception 'Result must be no_answer or cancelled' using errcode = '22023';
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then
    raise exception 'Only the rep it''s assigned to (or an admin) can change this result' using errcode = '42501';
  end if;
  if pol.call_live_since is not null then
    raise exception 'A call is live on this one. End it first.' using errcode = '22023';
  end if;

  v_from := public.policy_agent_status(pol.fulfillment_stage::text, pol.call_live_since, pol.last_call_outcome);
  if v_from not in ('no_answer', 'cancelled') then
    raise exception 'There''s no call result to change yet' using errcode = '22023';
  end if;
  if v_from = p_to then
    raise exception 'That''s already the result' using errcode = '22023';
  end if;

  if not public.is_admin() then
    v_at := case when v_from = 'cancelled' then coalesce(pol.fulfillment_completed_at, pol.last_call_at) else pol.last_call_at end;
    v_tz := coalesce((select timezone from profiles where id = auth.uid()), 'America/Chicago');
    if v_at is null or (v_at at time zone v_tz)::date <> (now() at time zone v_tz)::date then
      raise exception 'Only an admin can change a result from an earlier day.' using errcode = '42501';
    end if;
  end if;

  if p_to = 'no_answer' then
    update policies
       set fulfillment_stage      = 'In Progress',
           call_live_since        = null,
           last_call_outcome      = 'no_answer',
           last_call_at           = coalesce(pol.last_call_at, now()),
           status                 = case when pol.status = 'In Effect' then 'Submitted'::policy_status else pol.status end
     where id = p_policy;

    update notifications set read = true
     where profile_id = pol.agent_id and type = 'fulfillment_complete'
       and not read and data->>'policy_id' = pol.id::text;

    who := coalesce(nullif(btrim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, '')), ''), 'This client');
    insert into notifications (profile_id, type, message, data)
    values (pol.agent_id, 'fulfillment_correction',
            'Correction: ' || who || ' isn''t cancelled yet. Fulfillment will call again.',
            jsonb_build_object('policy_id', pol.id, 'link', '/agent/clients?stage=noAnswer&open=' || pol.id));
  else
    update policies
       set fulfillment_stage = 'Complete',
           status            = 'In Effect'
     where id = p_policy;

    update notifications set read = true
     where profile_id = pol.agent_id and type = 'fulfillment_correction'
       and not read and data->>'policy_id' = pol.id::text;
  end if;

  update policy_events
     set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('correction', true, 'from', v_from)
   where policy_id = p_policy and kind = p_to and at = now();

  if p_to = 'no_answer' then
    perform public.recovery_after_no_answer(p_policy);
  end if;
end;
$function$;

revoke all on function public.fulfillment_correct_result(uuid, text) from public, anon;
grant execute on function public.fulfillment_correct_result(uuid, text) to authenticated;
