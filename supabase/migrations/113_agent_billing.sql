-- Prompt 673 — agent billing scaffolding ($350/week flat retainer, agents pay
-- Ohvara). Schema only: the Stripe side (Checkout, Customer Portal, webhook)
-- is blocked on a STRIPE_SECRET_KEY and isn't built yet.
--
-- Direction of money: agent -> Ohvara. Nothing here touches the dead pre-pivot
-- payout columns (stripe_account_id / stripe_onboarding_complete were Stripe
-- *Connect* accounts for paying reps). An agent's billing identity is a Stripe
-- *Customer* + *Subscription*, kept in separate columns below.
--
-- billing_status mirrors the Stripe subscription, written only by the (future)
-- webhook with the service role, or by an admin by hand:
--   none      never subscribed
--   active    paid through billing_current_period_end
--   past_due  a renewal charge failed; access continues until billing_grace_until
--   lapsed    grace ran out, or Stripe gave up retrying (subscription unpaid)
--   canceled  the agent cancelled; access runs to the end of the paid week,
--             then the webhook moves it to lapsed
--   exempt    never billed (admins, Fulfillment, comped agents, test accounts)
--
-- Enforcement is OFF until app_settings.agent_billing_enforced is flipped on in
-- the go-live step (after the Stripe side ships and is tested), so this
-- migration changes nothing anyone sees today beyond a Billing tab that says
-- billing isn't connected yet.
--
-- Read access: none of these columns are in the directory column grant from
-- migration 112, so teammates can't see each other's billing. The agent reads
-- their own row via get_my_profile(); admin reads everyone via
-- admin_list_profiles(). Both are `select *`, so they pick up the new columns.

alter table public.profiles
  add column if not exists billing_status text not null default 'none'
    check (billing_status in ('none', 'active', 'past_due', 'lapsed', 'canceled', 'exempt')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_current_period_end timestamptz,
  add column if not exists billing_grace_until timestamptz,
  add column if not exists billing_updated_at timestamptz;

create unique index if not exists profiles_stripe_customer_id_key
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists profiles_stripe_subscription_id_key
  on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;

-- Only agents pay.
update public.profiles set billing_status = 'exempt' where role <> 'agent';

alter table public.app_settings
  add column if not exists agent_billing_enforced boolean not null default false,
  add column if not exists agent_billing_weekly_cents integer not null default 35000
    check (agent_billing_weekly_cents > 0);

comment on column public.app_settings.agent_billing_enforced is
  'Prompt 673: when true, agents whose billing_status does not grant access are locked out of every page but Settings. Leave false until the Stripe webhook is live.';
comment on column public.app_settings.agent_billing_weekly_cents is
  'Prompt 673: display price for the agent retainer. The amount actually charged is the Stripe Price; keep the two in step.';

-- Billing columns are privileged: an agent must not be able to mark themselves
-- paid. Same guard as 109, plus the six new columns.
create or replace function public.profiles_guard_privileged()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.role                             is distinct from old.role
    or new.is_active                        is distinct from old.is_active
    or new.upline_id                        is distinct from old.upline_id
    or new.stripe_account_id                is distinct from old.stripe_account_id
    or new.stripe_onboarding_complete       is distinct from old.stripe_onboarding_complete
    or new.training_completed               is distinct from old.training_completed
    or new.last_batch_assigned_local_date   is distinct from old.last_batch_assigned_local_date
    or new.leaderboard_rank1_notified_month is distinct from old.leaderboard_rank1_notified_month
    or new.goal_50_notified_month           is distinct from old.goal_50_notified_month
    or new.goal_100_notified_month          is distinct from old.goal_100_notified_month
    or new.created_at                       is distinct from old.created_at
    or new.billing_status                   is distinct from old.billing_status
    or new.stripe_customer_id               is distinct from old.stripe_customer_id
    or new.stripe_subscription_id           is distinct from old.stripe_subscription_id
    or new.billing_current_period_end       is distinct from old.billing_current_period_end
    or new.billing_grace_until              is distinct from old.billing_grace_until
    or new.billing_updated_at               is distinct from old.billing_updated_at
    then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
