-- Prompt 673 — billing_exempt: per-profile "never billed" flag.
-- The gate and the weekly cap only ever apply to role = 'agent' AND
-- billing_exempt = false. Test Agent (role agent, but never billed) and any
-- future internal/demo agent get flagged here, no code change. Privileged:
-- an agent can't exempt themselves.

alter table public.profiles
  add column if not exists billing_exempt boolean not null default false;

comment on column public.profiles.billing_exempt is
  'Prompt 673: true = never billed or capped, regardless of billing_status. Admin-only to change.';

update public.profiles set billing_exempt = true where email = 'nate44@ohvara.internal' and role = 'agent';

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
    or new.billing_exempt                   is distinct from old.billing_exempt
    then
      raise exception 'Only an admin can change that part of a profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Cap only applies to non-exempt agents.
create or replace function public.agent_weekly_usage(p_agent uuid default auth.uid())
returns table (
  tier        text,
  tier_name   text,
  weekly_cap  integer,
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
  v_exempt  boolean;
  v_tier    text;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  if p_agent is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select coalesce(timezone, 'America/Chicago'), role, billing_status, billing_exempt, billing_tier
    into v_tz, v_role, v_status, v_exempt, v_tier
  from profiles where id = p_agent;
  if not found then return; end if;

  v_start := date_trunc('week', now() at time zone v_tz) at time zone v_tz;
  v_end   := (date_trunc('week', now() at time zone v_tz) + interval '7 days') at time zone v_tz;

  return query
  select
    t.key,
    t.name,
    case when v_role = 'agent' and not v_exempt and v_status <> 'exempt' then t.weekly_cap else null end,
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
