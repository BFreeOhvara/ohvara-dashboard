-- Prompt 784 — launch dry-run follow-ups.
-- F1: while call recording is off there's no recording to check a cancel
--     against, so Cancelled needs the carrier's confirmation number. Both ways
--     to Cancelled (mark it, or change a No answer to Cancelled) refuse
--     without one. With recording on, nothing changes.
-- F2: a typo in the Carrier box became a carrier everyone sees. Only an admin
--     can add one now (the portal asks them to confirm first).

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
  if not coalesce((select recording_live from recovery_config limit 1), false)
     and coalesce(v_conf, nullif(btrim(pol.cancellation_confirmation), '')) is null then
    raise exception 'Add the carrier''s confirmation number. Calls aren''t recorded yet, so it''s the proof.' using errcode = '22023';
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

drop function if exists public.fulfillment_correct_result(uuid, text);

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

  if p_to = 'cancelled'
     and not coalesce((select recording_live from recovery_config limit 1), false)
     and coalesce(v_conf, nullif(btrim(pol.cancellation_confirmation), '')) is null then
    raise exception 'Add the carrier''s confirmation number. Calls aren''t recorded yet, so it''s the proof.' using errcode = '22023';
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

create or replace function public.carrier_add(p_name text)
 returns carriers
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_row public.carriers;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Carrier name should be 2 to 80 characters'; end if;

  -- Anyone may still resolve a name or alias to the row that exists.
  select * into v_row from public.carriers
   where lower(name) = lower(v_name) or exists (select 1 from unnest(aliases) a where lower(a) = lower(v_name))
   order by (lower(name) = lower(v_name)) desc
   limit 1;
  if found then return v_row; end if;

  if not public.is_admin() then
    raise exception 'That carrier isn''t on the list. Only an admin can add one.' using errcode = '42501';
  end if;

  insert into public.carriers (name, is_active, hours_status)
  values (v_name, true, 'pending')
  on conflict (name) do nothing
  returning * into v_row;
  if v_row.id is null then select * into v_row from public.carriers where name = v_name; end if;
  return v_row;
end $$;
