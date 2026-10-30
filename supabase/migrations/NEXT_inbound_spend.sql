-- Inbound spend: one platform subscription (Policy Servicing, billed weekly) and
-- a weekly amount per inbound type bought on top of it.
--
-- NOT APPLIED. Money code: written from a worktree; applying it is a separate,
-- checked step through Brayden's door. Additive: new settings columns, two new
-- tables, and one function body replaced. Nothing is removed. agent_billing_tiers,
-- profiles.billing_tier and migration 176 (prepaid ledger, unapplied) stay as
-- they are; the app just stops using the tiers.
--
-- The file name carries no number yet: the runner reserved none for this task.
-- It takes its reserved number before merging.
--
--   app_settings               agent_billing_weekly_cents is the servicing price;
--                              the agent-billing function makes its Stripe Price
--                              from it. An agent on an older price keeps that
--                              price: nothing here or in the function reprices
--                              a live subscription.
--   agent_inbound_spend        one row per agent and inbound type: the weekly
--                              amount and whether it is paused. A change applies
--                              at the next weekly renewal.
--   agent_inbound_spend_log    one row per change. Append-only: no role has
--                              update rights on it.
--   enforce_weekly_submission_cap()  stops counting. The trigger and the tiers
--                              table stay in place, the cap just never refuses.
--
-- RLS: an agent reads only their own rows, admin reads all. No agent write
-- policy and no write grant for anon or authenticated: writes go through the
-- agent-billing function with the service role.

-- ── settings ────────────────────────────────────────────────────────────────

alter table public.app_settings
  alter column agent_billing_weekly_cents set default 29900;

-- Only the old default moves. A price someone already set by hand stays.
update public.app_settings
   set agent_billing_weekly_cents = 29900
 where agent_billing_weekly_cents = 35000;

alter table public.app_settings
  add column if not exists inbound_est_cents_live_call integer not null default 5500
    check (inbound_est_cents_live_call > 0),
  add column if not exists inbound_est_cents_booked_appt integer not null default 9000
    check (inbound_est_cents_booked_appt > 0),
  add column if not exists inbound_min_weekly_cents integer not null default 5000
    check (inbound_min_weekly_cents > 0),
  add column if not exists inbound_spend_presets integer[] not null default '{10000,25000,50000}';

comment on column public.app_settings.agent_billing_weekly_cents is
  'Weekly price of Policy Servicing, in cents. The agent-billing function makes the Stripe Price from this and makes a new one when it changes. Existing subscriptions keep the price they are on.';
comment on column public.app_settings.inbound_est_cents_live_call is
  'Placeholder cost of one Live Call, used only for the estimate shown to agents: editable, not decided.';
comment on column public.app_settings.inbound_est_cents_booked_appt is
  'Placeholder cost of one Booked Appointment, used only for the estimate shown to agents: editable, not decided.';
comment on column public.app_settings.inbound_min_weekly_cents is
  'Smallest weekly amount an agent can set for one inbound type (0 is always allowed and means none).';
comment on column public.app_settings.inbound_spend_presets is
  'Weekly amounts, in cents, offered as quick picks.';

-- ── what each agent spends ──────────────────────────────────────────────────

create table if not exists public.agent_inbound_spend (
  agent_id      uuid not null references public.profiles(id),
  inbound_type  text not null check (inbound_type in ('live_call', 'booked_appointment')),
  weekly_cents  integer not null check (weekly_cents >= 0),
  paused        boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (agent_id, inbound_type)
);

alter table public.agent_inbound_spend enable row level security;

create policy agent_inbound_spend_select_own on public.agent_inbound_spend
  for select to authenticated using (agent_id = auth.uid());
create policy agent_inbound_spend_select_admin on public.agent_inbound_spend
  for select to authenticated using (public.is_admin());

revoke all on public.agent_inbound_spend from public, anon, authenticated;
grant select on public.agent_inbound_spend to authenticated;
grant select, insert, update on public.agent_inbound_spend to service_role;

comment on table public.agent_inbound_spend is
  'Weekly amount per inbound type per agent. Written only by the agent-billing function (service role), which keeps one Stripe subscription item per type in step with it.';

-- ── every change ────────────────────────────────────────────────────────────

create table if not exists public.agent_inbound_spend_log (
  id            bigint generated always as identity primary key,
  agent_id      uuid not null references public.profiles(id),
  inbound_type  text not null check (inbound_type in ('live_call', 'booked_appointment')),
  old_cents     integer not null check (old_cents >= 0),
  new_cents     integer not null check (new_cents >= 0),
  old_paused    boolean not null,
  new_paused    boolean not null,
  created_at    timestamptz not null default now()
);

create index if not exists agent_inbound_spend_log_agent_idx
  on public.agent_inbound_spend_log (agent_id, created_at desc);

alter table public.agent_inbound_spend_log enable row level security;

create policy agent_inbound_spend_log_select_own on public.agent_inbound_spend_log
  for select to authenticated using (agent_id = auth.uid());
create policy agent_inbound_spend_log_select_admin on public.agent_inbound_spend_log
  for select to authenticated using (public.is_admin());

-- Append-only by grant: the service role can read and add rows, nothing more.
revoke all on public.agent_inbound_spend_log from public, anon, authenticated, service_role;
grant select on public.agent_inbound_spend_log to authenticated;
grant select, insert on public.agent_inbound_spend_log to service_role;

comment on table public.agent_inbound_spend_log is
  'Append-only history of agent_inbound_spend. An agent with no row yet counts as 0 cents, not paused, for old_cents and old_paused.';

-- ── the weekly submission cap goes away ─────────────────────────────────────

-- Same name and signature as 119, so policies_enforce_weekly_cap keeps pointing
-- at it. It no longer counts anything or refuses a booking.
create or replace function public.enforce_weekly_submission_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  return new;
end;
$$;
