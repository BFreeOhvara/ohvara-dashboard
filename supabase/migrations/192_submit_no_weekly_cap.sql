-- 192 — agent_submit_deal(): no weekly cap, to agree with 188.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive: one function replaced and its grants restated. No drop, no
-- table, column, policy or trigger changed, and no row is rewritten.
--
-- Why: 188 made enforce_weekly_submission_cap a no-op ("the weekly submission cap
-- goes away"), but 187's agent_submit_deal does its own cap check and kept
-- refusing at the tier cap. 187 is merged and may already be recorded live, and
-- a recorded file is skipped, so the fix is this new file and 187 is unchanged.
--
-- The body is 187's, copied whole, minus the cap check and its refusal: the
-- advisory lock, the agent_weekly_usage read and the record that held it. The
-- weekly_cap hint is no longer raised here. agent_submit_service_request has no
-- cap check, so it isn't replaced. agent_weekly_usage still counts the rows.
--
-- APPLY ORDER: after 187 and 188.

create or replace function public.agent_submit_deal(
  p_first         text,
  p_last          text,
  p_phone         text,
  p_city          text,
  p_state         text,
  p_timezone      text,
  p_new_carrier   uuid,
  p_policy_number text default null,
  p_replaced      boolean default null,
  p_old_carrier   uuid default null,
  p_at            timestamptz default null,
  p_best_time     text default null,
  p_sms_consent   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent    uuid := auth.uid();
  v_servicing boolean;
  v_name     text;
  v_first    text := nullif(btrim(p_first), '');
  v_last     text := nullif(btrim(p_last), '');
  v_phone    text := nullif(btrim(p_phone), '');
  v_city     text := nullif(btrim(p_city), '');
  v_state    text := nullif(upper(btrim(p_state)), '');
  v_tz       text := nullif(btrim(p_timezone), '');
  v_new_name text;
  v_old_name text;
  v_id       uuid;
begin
  select has_servicing, coalesce(nullif(btrim(full_name), ''), 'Unknown') into v_servicing, v_name
    from profiles where id = v_agent and role = 'agent' and is_active;
  if not found then
    raise exception 'Only an agent can submit a deal' using errcode = '42501';
  end if;
  if not coalesce((select submit_live from app_settings where id = 1), false) then
    raise exception 'Submit is not live yet' using errcode = 'P0001', hint = 'not_live';
  end if;
  if not v_servicing then
    raise exception 'Servicing is not on your plan' using errcode = 'P0001', hint = 'no_servicing';
  end if;

  if v_first is null or v_last is null then
    raise exception 'First and last name are required' using errcode = '22023';
  end if;
  if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) < 10 then
    raise exception 'Add the client''s 10-digit phone number' using errcode = '22023';
  end if;
  if v_city is null or v_state is null or v_state !~ '^[A-Z]{2}$' then
    raise exception 'Add the client''s city and state' using errcode = '22023';
  end if;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  select name into v_new_name from carriers where id = p_new_carrier;
  if v_new_name is null then
    raise exception 'Pick the new carrier from the list' using errcode = '22023';
  end if;
  if p_replaced is null then
    raise exception 'Say whether this replaced an old policy' using errcode = '22023';
  end if;
  if p_best_time is null or p_best_time not in ('morning', 'afternoon', 'evening') then
    raise exception 'Pick the best time to reach them' using errcode = '22023';
  end if;
  if p_replaced then
    select name into v_old_name from carriers where id = p_old_carrier;
    if v_old_name is null then
      raise exception 'Pick the carrier they''re leaving' using errcode = '22023', hint = 'booking_rule';
    end if;
    if p_at is null then
      raise exception 'Pick a time for the call.' using errcode = '22023', hint = 'booking_rule';
    end if;
  end if;

  -- A Yes deal's slot (30 minutes' notice, carrier hours, no double booking) is
  -- checked by policies_booking_rules on this insert: it keys on auth.uid(), not
  -- current_user, so it fires here.
  insert into policies (
    agent_id, status, client_first_name, client_last_name, client_phone, client_city, state, client_timezone,
    carrier_id, carrier_name, new_carrier_id, new_carrier_name, policy_number, replaced_old_policy, best_time,
    pending_underwriting, fulfillment_assigned, fulfillment_stage, scheduled_call_at, sms_consent
  ) values (
    v_agent, 'Submitted', v_first, v_last, v_phone, v_city, v_state, v_tz,
    case when p_replaced then p_old_carrier end, case when p_replaced then v_old_name end,
    p_new_carrier, v_new_name, nullif(btrim(p_policy_number), ''), p_replaced, p_best_time,
    false, true, 'Pending', case when p_replaced then p_at end, coalesce(p_sms_consent, false)
  )
  returning id into v_id;

  -- Having this row keeps Fulfillment's "No intake details" warning from firing.
  insert into policy_fulfillment_details (policy_id, full_legal_name, current_carrier)
  values (v_id, v_first || ' ' || v_last, case when p_replaced then v_old_name end);

  insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
  values (v_id, v_agent, 'submitted', v_agent, v_name, 'agent',
          jsonb_build_object('label', 'Submitted for servicing', 'replaced', p_replaced,
                             'best_time', p_best_time, 'scheduled_call_at', case when p_replaced then p_at end));

  return v_id;
end;
$$;

revoke all on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean) from public, anon;
grant execute on function public.agent_submit_deal(text, text, text, text, text, text, uuid, text, boolean, uuid, timestamptz, text, boolean) to authenticated;
