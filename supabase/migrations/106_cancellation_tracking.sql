-- Prompt 663 — Cancellations role rebuild. Additive only: four nullable
-- columns on policies + a BEFORE UPDATE trigger that stamps claim/complete
-- times server-side. No existing column, row, or policy is changed.
--
--   fulfillment_claimed_at     set when a rep claims (assigned_fulfillment_id
--                              null -> someone), cleared if released back
--   fulfillment_completed_at   set when fulfillment_stage becomes Complete
--   cancellation_substatus     finer in-progress state while claimed:
--                              calling | waiting_carrier | waiting_client
--   cancellation_confirmation  carrier's cancellation / reference number
--   cancellation_notes         the rep's working notes on the call(s)
--
-- Existing fulfillment RLS (migration 103: fulfillment_update_assigned)
-- already lets the fulfillment role update these rows; nothing new needed.

alter table public.policies
  add column if not exists fulfillment_claimed_at    timestamptz,
  add column if not exists fulfillment_completed_at  timestamptz,
  add column if not exists cancellation_substatus    text,
  add column if not exists cancellation_confirmation text,
  add column if not exists cancellation_notes        text;

do $$ begin
  alter table public.policies
    add constraint policies_cancellation_substatus_check
    check (cancellation_substatus is null
           or cancellation_substatus in ('calling', 'waiting_carrier', 'waiting_client'));
exception when duplicate_object then null; end $$;

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
    else
      new.fulfillment_completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists policies_stamp_cancellation_times on public.policies;
create trigger policies_stamp_cancellation_times
  before update on public.policies
  for each row execute function public.stamp_cancellation_times();
