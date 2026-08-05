-- Prompt 423 — beneficiaries: support more than one per policy, and make
-- relationship a constrained dropdown value rather than free text. Table
-- has 0 rows live (checked before writing this migration) — a straight
-- column swap, no backfill needed.
alter table public.policy_fulfillment_details
  add column beneficiaries jsonb not null default '[]'::jsonb
    check (jsonb_typeof(beneficiaries) = 'array');

alter table public.policy_fulfillment_details
  drop column beneficiary_name,
  drop column beneficiary_relationship;
