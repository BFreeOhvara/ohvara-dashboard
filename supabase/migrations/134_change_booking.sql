-- Prompt 730 — Change a booking: the agent fixes a client's details or call
-- time in place.
--
-- agent_change_booking(...) edits an existing booking with ONE update. It never
-- inserts a policies row and never touches created_at or agent_id, so:
--   * policies_enforce_weekly_cap (BEFORE INSERT only, migration 119) never
--     fires, and
--   * agent_weekly_usage (119 → 128 → 131) counts policies rows by agent_id +
--     created_at, so the same rows are counted before and after.
-- A change can neither use up nor free a weekly booking.
--
-- Who can change what (mirrors the guards the app already had):
--   Booked, stage Pending, no calls yet   details, and optionally the time
--   Booked after a call / rep started     details only ("Fulfillment has
--                                         already called this one…", the same
--                                         wording as the old in-drawer move)
--   No answer / Needs attention           details + a new time, required: it is
--                                         a re-book (agent_rebook_call, 121/122)
--   Confirm number, live, Cancelled       refused
--
-- A time change fires policies_fulfillment_autoassign (BEFORE UPDATE, 116),
-- which re-picks the rep for the new time while the stage is Pending. A
-- details-only change leaves scheduled_call_at alone, so the rep stays.
--
-- Activity: one 'edited' policy_events row per save when a detail changed
-- (name, phone, city, state, carrier). A time change is still logged as
-- 'moved' by policy_events_log (121) off this function's UPDATE.

-- ── activity kind ───────────────────────────────────────────────────────────
alter table public.policy_events drop constraint if exists policy_events_kind_check;
alter table public.policy_events
  add constraint policy_events_kind_check
  check (kind in ('booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited'));

-- ── the change ──────────────────────────────────────────────────────────────
create or replace function public.agent_change_booking(
  p_policy   uuid,
  p_first    text,
  p_last     text,
  p_phone    text,
  p_city     text,
  p_state    text,
  p_timezone text,
  p_carrier  uuid,
  p_at       timestamptz default null
)
returns public.policies
language plpgsql
security definer
set search_path = public
as $$
declare
  pol      policies;
  v_first  text := nullif(btrim(p_first), '');
  v_last   text := nullif(btrim(p_last), '');
  v_phone  text := nullif(btrim(p_phone), '');
  v_city   text := nullif(btrim(p_city), '');
  v_state  text := nullif(upper(btrim(p_state)), '');
  v_tz     text := nullif(btrim(p_timezone), '');
  v_carrier text;
  v_rebook boolean;
  v_changes jsonb := '[]'::jsonb;
  v_old_name text;
  v_new_name text;
  v_actor  uuid := auth.uid();
  v_aname  text;
  v_arole  text;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.agent_id = v_actor) then
    raise exception 'Not your booking' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' or pol.call_live_since is not null then
    raise exception 'This one can''t be changed' using errcode = '22023';
  end if;
  if pol.recovery_step = 'number_check' then
    raise exception 'Confirm their number first' using errcode = '22023';
  end if;

  -- details
  if v_first is null or v_last is null then
    raise exception 'First and last name are required' using errcode = '22023';
  end if;
  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'State must be a 2-letter code' using errcode = '22023';
  end if;
  if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  select name into v_carrier from carriers where id = p_carrier;
  if v_carrier is null then
    raise exception 'Pick the carrier from the list' using errcode = '22023';
  end if;

  -- time
  v_rebook := coalesce(pol.last_call_outcome = 'no_answer', false);
  if p_at is not null and p_at < now() - interval '5 minutes' then
    raise exception 'Pick a time in the future' using errcode = '22023';
  end if;
  if v_rebook and p_at is null then
    raise exception 'Pick a new time to re-book this one' using errcode = '22023';
  end if;
  if not v_rebook and p_at is not null
     and (coalesce(pol.call_attempts, 0) > 0 or pol.fulfillment_stage is distinct from 'Pending') then
    raise exception 'Fulfillment has already called this one — message them to move it.' using errcode = '22023';
  end if;

  -- what changed, for the activity row
  v_old_name := btrim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, ''));
  v_new_name := v_first || ' ' || v_last;
  if v_old_name is distinct from v_new_name then
    v_changes := v_changes || jsonb_build_object('field', 'name', 'from', nullif(v_old_name, ''), 'to', v_new_name);
  end if;
  if regexp_replace(coalesce(pol.client_phone, ''), '\D', '', 'g') <> regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') then
    v_changes := v_changes || jsonb_build_object('field', 'phone', 'from', pol.client_phone, 'to', v_phone);
  end if;
  if pol.client_city is distinct from v_city then
    v_changes := v_changes || jsonb_build_object('field', 'city', 'from', pol.client_city, 'to', v_city);
  end if;
  if pol.state is distinct from v_state then
    v_changes := v_changes || jsonb_build_object('field', 'state', 'from', pol.state, 'to', v_state);
  end if;
  if pol.carrier_id is distinct from p_carrier then
    v_changes := v_changes || jsonb_build_object('field', 'carrier', 'from', pol.carrier_name, 'to', v_carrier);
  end if;

  -- One UPDATE. A re-book also does what agent_rebook_call does: clear the
  -- outcome, back to Pending (the rep is re-picked), end the recovery flow.
  update policies
     set client_first_name = v_first,
         client_last_name  = v_last,
         client_phone      = v_phone,
         client_city       = v_city,
         state             = v_state,
         client_timezone   = coalesce(v_tz, client_timezone),
         carrier_id        = p_carrier,
         carrier_name      = v_carrier,
         scheduled_call_at = coalesce(p_at, scheduled_call_at),
         last_call_outcome      = case when v_rebook then null else last_call_outcome end,
         cancellation_substatus = case when v_rebook then null else cancellation_substatus end,
         fulfillment_stage      = case when v_rebook then 'Pending' else fulfillment_stage end,
         recovery_phase = case when v_rebook then null else recovery_phase end,
         recovery_step  = case when v_rebook then null else recovery_step end,
         recovery_retry_at  = case when v_rebook then null else recovery_retry_at end,
         recovery_next_kind = case when v_rebook then null else recovery_next_kind end,
         recovery_next_at   = case when v_rebook then null else recovery_next_at end,
         recovery_followup_day  = case when v_rebook then null else recovery_followup_day end,
         recovery_text1_sent_at = case when v_rebook then null else recovery_text1_sent_at end,
         recovery_text2_sent_at = case when v_rebook then null else recovery_text2_sent_at end,
         recovery_am_sent_at = case when v_rebook then null else recovery_am_sent_at end,
         recovery_pm_sent_at = case when v_rebook then null else recovery_pm_sent_at end,
         recovery_number_confirmed_at = case when v_rebook then null else recovery_number_confirmed_at end,
         recovery_handoff_at = case when v_rebook then null else recovery_handoff_at end
   where id = p_policy
  returning * into pol;

  -- The name Fulfillment reads and its "Cancel with <carrier>". The legal name
  -- is only replaced when the agent changed the name, so a fuller legal name
  -- Fulfillment typed in survives a carrier or phone fix.
  insert into policy_fulfillment_details (policy_id, full_legal_name, current_carrier)
  values (p_policy, v_new_name, v_carrier)
  on conflict (policy_id) do update
    set full_legal_name = case when v_old_name is distinct from v_new_name
                               then excluded.full_legal_name
                               else coalesce(policy_fulfillment_details.full_legal_name, excluded.full_legal_name) end,
        current_carrier = excluded.current_carrier;

  if jsonb_array_length(v_changes) > 0 then
    if v_actor is not null then
      select coalesce(nullif(btrim(full_name), ''), 'Unknown'), role::text
        into v_aname, v_arole
      from profiles where id = v_actor;
    end if;
    insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
    values (pol.id, pol.agent_id, 'edited', v_actor, v_aname, v_arole,
            jsonb_build_object('changes', v_changes));
  end if;

  return pol;
end;
$$;

revoke all on function public.agent_change_booking(uuid, text, text, text, text, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.agent_change_booking(uuid, text, text, text, text, text, text, uuid, timestamptz) to authenticated;
