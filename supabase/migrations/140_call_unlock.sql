-- Prompt 756 — "Call client" opens 5 minutes before the call's time.
-- fulfillment_start_call (migration 117) now refuses a call that is still more
-- than 5 minutes out with `too_early` (detail = the instant it opens, UTC ISO).
-- A call whose time has passed is always fine, and so is one with no time set.
-- Everything else in the function is unchanged. The client's twin of this rule
-- is canStartCall in src/lib/fulfillmentDay.js (CALL_UNLOCK_LEAD_MIN = 5).

create or replace function public.fulfillment_start_call(p_policy uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol policies;
begin
  select * into pol from policies where id = p_policy for update;
  if not found or not pol.fulfillment_assigned then
    raise exception 'Cancellation not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or pol.assigned_fulfillment_id = auth.uid()) then
    raise exception 'Only the rep it''s assigned to (or an admin) can call this client' using errcode = '42501';
  end if;
  if pol.fulfillment_stage = 'Complete' then
    raise exception 'This one is already cancelled' using errcode = '22023';
  end if;
  -- Already live: a repeat tap on "Call client" is a harmless no-op.
  if pol.call_live_since is not null then
    return;
  end if;
  if pol.scheduled_call_at is not null and now() < pol.scheduled_call_at - interval '5 minutes' then
    raise exception 'too_early' using errcode = '22023',
      detail = to_char((pol.scheduled_call_at - interval '5 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  update policies
     set call_live_since        = now(),
         call_attempts          = call_attempts + 1,
         fulfillment_stage      = 'In Progress',
         cancellation_substatus = null
   where id = p_policy;
end;
$$;

revoke all on function public.fulfillment_start_call(uuid) from public, anon;
grant execute on function public.fulfillment_start_call(uuid) to authenticated;
