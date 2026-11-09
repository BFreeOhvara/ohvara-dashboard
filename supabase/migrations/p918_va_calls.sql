-- Prompt 918 — VA calls only at their time; no confirmation number on cancel calls.
-- NOT APPLIED. Unnumbered on purpose: Brayden says yes, then it gets the next number and is applied.
-- 1. app_settings.va_call_open_minutes: how many minutes before a booked call its Start call turns on (admin
--    Settings → Pay rules). The portal reads a missing column as 5.
-- 2. Cancelling the old policy no longer asks for the carrier's confirmation number (Brayden, Nov 9: "remove the
--    get the confirmation number step and its required field"). Both functions are 159's, minus that check; a
--    number sent anyway is still saved. Notes stay optional.

alter table public.app_settings add column if not exists va_call_open_minutes int not null default 5
  check (va_call_open_minutes between 0 and 60);

create or replace function public.fulfillment_mark_cancelled(
  p_policy uuid,
  p_notes text default null,
  p_set_notes boolean default false,
  p_proof boolean default false,
  p_confirmation text default null,
  p_effective date default null,
  p_drafts_stopped boolean default false
) returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  pol    policies;
  v_conf text := case when p_proof then nullif(btrim(p_confirmation), '') end;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if pol.assigned_fulfillment_id is distinct from auth.uid() or not public.is_fulfillment() then
    raise exception 'Only the rep it''s assigned to can mark this cancelled' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This one is already cancelled' using errcode = '22023';
  end if;

  update policies
     set fulfillment_stage           = 'Complete',
         status                      = 'In Effect',
         cancellation_notes          = case when p_set_notes then nullif(btrim(p_notes), '') else cancellation_notes end,
         cancellation_confirmation   = case when p_proof then coalesce(v_conf, cancellation_confirmation) else cancellation_confirmation end,
         cancellation_effective_date = case when p_proof then coalesce(p_effective, cancellation_effective_date) else cancellation_effective_date end,
         drafts_stopped              = case when p_proof then coalesce(p_drafts_stopped, false) else drafts_stopped end
   where id = p_policy;
end;
$$;

create or replace function public.fulfillment_correct_result(p_policy uuid, p_to text, p_confirmation text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  pol    policies;
  v_from text;
  v_at   timestamptz;
  v_tz   text;
  who    text;
  v_conf text := nullif(btrim(p_confirmation), '');
begin
  if p_to is null or p_to not in ('no_answer', 'cancelled') then
    raise exception 'Result must be no_answer or cancelled' using errcode = '22023';
  end if;

  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if pol.assigned_fulfillment_id is distinct from auth.uid() then
    raise exception 'Only the rep it''s assigned to can change this result' using errcode = '42501';
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
       set fulfillment_stage         = 'Complete',
           status                    = 'In Effect',
           cancellation_confirmation = coalesce(v_conf, cancellation_confirmation)
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
$$;

revoke all on function public.fulfillment_correct_result(uuid, text, text) from public, anon;
grant execute on function public.fulfillment_correct_result(uuid, text, text) to authenticated;
