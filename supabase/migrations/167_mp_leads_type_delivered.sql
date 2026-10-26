-- 163 — Lead type and delivery time on mp_leads (agent portal Leads filter).
--
-- lead_type lets the agent Leads page filter and badge by kind. Existing rows
-- are all Meta mortgage-protection leads, so that is the default.
-- delivered_at is when the lead was handed to its agent; backfilled from
-- assigned_at. Additive only; no grants change (agents still update status only).

alter table public.mp_leads
  add column if not exists lead_type text not null default 'mortgage_protection'
    check (lead_type in ('cancellation', 'mortgage_protection')),
  add column if not exists delivered_at timestamptz;

update public.mp_leads set delivered_at = assigned_at
  where delivered_at is null and assigned_at is not null;

create index if not exists mp_leads_agent_type_idx
  on public.mp_leads (assigned_agent_id, lead_type);
