-- Prompt 710 — a cancelled lead can't have skipped the call step.
--
-- "Mark cancelled" was available without "Call client" ever being tapped, so a
-- lead could resolve with call_attempts = 0 and the agent's Progress list read
-- Booked ✓ / Waiting for Fulfillment to call ✗ / Old policy cancelled ✓.
-- Resolving to Complete now counts as (at least) one call and stamps last_call_at.
-- Backfills the existing Complete rows the same way (all had call_attempts = 0).

create or replace function public.stamp_cancellation_times()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.assigned_fulfillment_id is distinct from old.assigned_fulfillment_id then
    if new.assigned_fulfillment_id is null then
      new.fulfillment_claimed_at := null;
      new.cancellation_substatus := null;
    else
      new.fulfillment_claimed_at := now();
    end if;
  end if;

  if new.fulfillment_stage is distinct from old.fulfillment_stage then
    if new.fulfillment_stage = 'Complete' then
      new.fulfillment_completed_at := now();
      new.cancellation_substatus := null;
      new.fulfillment_started_at := coalesce(old.fulfillment_started_at, now());
      new.call_live_since := null;
      new.last_call_outcome := null;
      -- resolving a cancellation means the client was reached: never zero calls
      new.call_attempts := greatest(new.call_attempts, 1);
      new.last_call_at  := coalesce(new.last_call_at, now());
    elsif new.fulfillment_stage = 'In Progress' then
      new.fulfillment_completed_at := null;
      new.fulfillment_started_at := coalesce(old.fulfillment_started_at, now());
    else
      new.fulfillment_completed_at := null;
      new.fulfillment_started_at := null;
      new.cancellation_substatus := null;
    end if;
  else
    new.fulfillment_started_at := old.fulfillment_started_at;
  end if;

  return new;
end;
$$;

update public.policies
   set call_attempts = 1,
       last_call_at  = coalesce(last_call_at, fulfillment_completed_at, updated_at)
 where fulfillment_assigned
   and fulfillment_stage = 'Complete'
   and call_attempts = 0;
