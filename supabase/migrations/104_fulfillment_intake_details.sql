-- Prompt 419 — full Fulfillment intake (everything needed to actually write
-- the replacement policy and cancel the old one). Isolated into its own
-- table rather than bolted onto `policies`: this is meaningfully more
-- sensitive PII (bank account/routing, driver's license, DOB) than the rest
-- of the app touches, so it needs its own tight RLS surface independent of
-- the broad-to-the-whole-fulfillment-role policies_select from Prompt 418.

create table public.policy_fulfillment_details (
  policy_id                uuid primary key references public.policies(id) on delete cascade,

  full_legal_name          text,
  date_of_birth             date,
  state_of_birth            text,
  state_of_residence        text,
  email                     text,
  height                    text,
  weight                    text,

  address_street            text,
  address_city              text,
  address_state              text,
  address_zip                text,

  drivers_license_number    text,

  beneficiary_name          text,
  beneficiary_relationship  text,

  draft_day                 smallint check (draft_day between 1 and 31),

  bank_name                 text,
  routing_number             text,
  account_number              text,

  -- Brayden confirmed this is the ONLY thing Fulfillment needs to cancel
  -- the old policy: "all you gotta do is call up the carrier and say I
  -- want to cancel this policy" — plain text, no structured carrier FK.
  current_carrier           text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.policy_fulfillment_details enable row level security;

create or replace function public.touch_fulfillment_details_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fulfillment_details_updated_at
  before update on public.policy_fulfillment_details
  for each row execute function public.touch_fulfillment_details_updated_at();

-- SELECT/UPDATE: the submitting agent, the fulfillment member who has
-- actually CLAIMED this policy (assigned_fulfillment_id — null until
-- claimed, so an unclaimed item's details are invisible to the broader
-- fulfillment role even though the queue LISTING itself stays broad per
-- Prompt 418's policies_select widening), or admin. Deliberately NOT
-- gated on is_fulfillment() alone — that would just re-open the same
-- broad visibility this table exists to avoid.
create policy "fulfillment_details_select" on public.policy_fulfillment_details
  for select
  using (
    exists (
      select 1 from public.policies p
      where p.id = policy_fulfillment_details.policy_id
        and (p.agent_id = auth.uid() or p.assigned_fulfillment_id = auth.uid())
    )
    or public.is_admin()
  );

create policy "fulfillment_details_update" on public.policy_fulfillment_details
  for update
  using (
    exists (
      select 1 from public.policies p
      where p.id = policy_fulfillment_details.policy_id
        and (p.agent_id = auth.uid() or p.assigned_fulfillment_id = auth.uid())
    )
    or public.is_admin()
  );

-- INSERT: only the owning agent (nobody's claimed yet at submit time, so
-- assigned_fulfillment_id isn't part of this check) or admin.
create policy "fulfillment_details_insert" on public.policy_fulfillment_details
  for insert
  with check (
    exists (
      select 1 from public.policies p
      where p.id = policy_fulfillment_details.policy_id
        and p.agent_id = auth.uid()
    )
    or public.is_admin()
  );
