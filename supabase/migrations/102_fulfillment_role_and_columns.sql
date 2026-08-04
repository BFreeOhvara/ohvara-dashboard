-- Prompt 418: Fulfillment Team routing. New 'fulfillment' profile role +
-- additive nullable columns on policies for the optional handoff workflow.
-- Split into its own migration (separate from 103's RLS/notification work)
-- because a newly added enum value cannot be referenced in the same
-- transaction it was added in.

alter type public.user_role add value if not exists 'fulfillment';

create type public.fulfillment_stage_status as enum ('Pending', 'In Progress', 'Complete');

alter table public.policies
  add column if not exists fulfillment_assigned boolean not null default false,
  add column if not exists fulfillment_stage public.fulfillment_stage_status,
  add column if not exists assigned_fulfillment_id uuid references public.profiles(id),
  add column if not exists scheduled_call_at timestamptz;
