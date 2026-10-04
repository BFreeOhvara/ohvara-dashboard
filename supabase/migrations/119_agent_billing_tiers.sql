-- Prompt 692 — agent billing tiers by weekly submission cap.
--
-- Extends 113 (Prompt 673's flat $350/week). An agent is on a tier; a tier is a
-- weekly price plus a weekly cap on submissions (bookings made on Book a call).
-- Standard $350 / 7 a week, Premium $500 / 14 a week. A tier is one ROW here, so
-- a third tier later (or retuning 7/14) is an insert/update, not a rebuild.
--
-- Why a cap rather than only a price gap: it's what an agent is really paying
-- for (volume worked), it's easy to meter, and it takes the point out of sharing
-- a login, since a second person on the account still can't submit past the cap.
--
-- Where things live:
--   agent_billing_tiers   price, cap, Stripe lookup key / price id per tier. The
--                         app reads it; admin edits it. weekly_cap NULL = no cap.
--   profiles.billing_tier which tier the agent is on. Written by the
--                         agent-billing function from the Stripe price on their
--                         subscription (privileged, like billing_status).
--   agent_weekly_usage()  the one place that counts "used this week", so the UI
--                         and the enforcement trigger can't disagree.
--   policies_enforce_weekly_cap  refuses a booking past the cap.
--
-- Week: Monday 00:00 to next Monday 00:00 in the agent's own profiles.timezone
-- (the same Mon-Sun boundary the agent side and Fulfillment pay already use).
--
-- Enforcement: the cap only bites when app_settings.agent_billing_enforced is on,
-- the same single go-live switch as the access lock. Until then the usage count
-- is shown but nothing is refused. Exempt (comped / test) agents and non-agents
-- are never capped.

-- ── tiers ───────────────────────────────────────────────────────────────────

create table if not exists public.agent_billing_tiers (
  key               text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name              text not null,
  weekly_cents      integer not null check (weekly_cents > 0),
  weekly_cap        integer check (weekly_cap is null or weekly_cap > 0),   -- null = uncapped
  stripe_lookup_key text unique,
  stripe_price_id   text,
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  updated_at        timestamptz not null default now()
);

alter table public.agent_billing_tiers enable row level security;

create policy agent_billing_tiers_select on public.agent_billing_tiers
  for select to authenticated using (true);
create policy agent_billing_tiers_admin_write on public.agent_billing_tiers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.agent_billing_tiers (key, name, weekly_cents, weekly_cap, stripe_lookup_key, sort_order)
values
  ('standard', 'Standard',
     coalesce((select agent_billing_weekly_cents from public.app_settings where id = 1), 35000),
     7,  'ohvara_agent_weekly',         1),
  ('premium',  'Premium', 50000, 14, 'ohvara_agent_premium_weekly', 2)
on conflict (key) do nothing;

comment on table public.agent_billing_tiers is
  'Prompt 692: agent billing tiers. Price + weekly submission cap per row; a new tier is a new row. The Stripe Price is created by the agent-billing function from weekly_cents and recorded in stripe_price_id.';
comment on column public.app_settings.agent_billing_weekly_cents is
  'Prompt 673, superseded by agent_billing_tiers (Prompt 692). Kept only so older code reading it still works; the standard tier row is the source of truth.';

-- ── profile tier ────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists billing_tier text not null default 'standard'
    references public.agent_billing_tiers(key) on update cascade;

-- Tier is privileged: an agent must not be able to move themselves to Premium.
-- Same guard as 109/113, plus billing_tier.
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
    or new.billing_tier                     is distinct from old.billing_tier
    then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ── usage this week ─────────────────────────────────────────────────────────

-- Counts the agent's bookings created this Mon-Sun week. A booking is a policies
-- row with fulfillment_assigned (anything else is pre-pivot data).
-- An agent can ask about themselves; admin about anyone.
create or replace function public.agent_weekly_usage(p_agent uuid default auth.uid())
returns table (
  tier        text,
  tier_name   text,
  weekly_cap  integer,      -- null = no cap applies
  used        integer,
  week_start  timestamptz,
  week_end    timestamptz,
  enforced    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz      text;
  v_role    text;
  v_status  text;
  v_tier    text;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  if p_agent is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select coalesce(timezone, 'America/Chicago'), role, billing_status, billing_tier
    into v_tz, v_role, v_status, v_tier
  from profiles where id = p_agent;
  if not found then return; end if;

  v_start := date_trunc('week', now() at time zone v_tz) at time zone v_tz;
  v_end   := (date_trunc('week', now() at time zone v_tz) + interval '7 days') at time zone v_tz;

  return query
  select
    t.key,
    t.name,
    case when v_role = 'agent' and v_status <> 'exempt' then t.weekly_cap else null end,
    (select count(*)::int from policies po
       where po.agent_id = p_agent and po.fulfillment_assigned
         and po.created_at >= v_start and po.created_at < v_end),
    v_start,
    v_end,
    coalesce((select s.agent_billing_enforced from app_settings s where s.id = 1), false)
  from agent_billing_tiers t
  where t.key = v_tier;
end;
$$;

revoke all on function public.agent_weekly_usage(uuid) from public, anon;
grant execute on function public.agent_weekly_usage(uuid) to authenticated;

-- ── enforcement ─────────────────────────────────────────────────────────────

-- Runs before the Fulfillment auto-assign trigger (BEFORE triggers go
-- alphabetically: ..._enforce_... < ..._fulfillment_...), so a refused booking
-- never gets as far as picking a rep. Admin inserts and service-role inserts
-- aren't capped.
-- Deliberately NOT security definer: inside a definer function current_user is
-- the owner, so the "is this a client insert?" check below would never match.
create or replace function public.enforce_weekly_submission_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  u record;
begin
  if not coalesce(new.fulfillment_assigned, false) then return new; end if;
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;

  -- Two bookings landing at once must not both see "6 of 7".
  perform pg_advisory_xact_lock(hashtextextended('weekly_cap:' || new.agent_id::text, 0));

  select * into u from public.agent_weekly_usage(new.agent_id);
  if not found or not u.enforced or u.weekly_cap is null then return new; end if;

  if u.used >= u.weekly_cap then
    raise exception 'Weekly submission cap reached: % of % used this week on the % plan.',
      u.used, u.weekly_cap, u.tier_name
      using errcode = 'P0001', hint = 'weekly_cap';
  end if;
  return new;
end;
$$;

drop trigger if exists policies_enforce_weekly_cap on public.policies;
create trigger policies_enforce_weekly_cap
  before insert on public.policies
  for each row execute function public.enforce_weekly_submission_cap();
