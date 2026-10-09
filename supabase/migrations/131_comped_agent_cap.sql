-- Prompt 725 — a comped agent (billing_exempt) gets its tier's weekly cap.
-- billing_exempt keeps its internal meaning (never billed, never locked,
-- ignored by the Stripe webhook, admin-only to change); only the cap changes.
-- The agent side now shows a comped account as Active on its tier, so the
-- limit it sees is the limit it gets. policies_enforce_weekly_cap reads this
-- function, so the cap bites when app_settings.agent_billing_enforced is on,
-- same as for a paying agent. Non-agents are still uncapped.
--
-- Only change from 128_billing_exempt.sql: the weekly_cap column.

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
    case when v_role = 'agent' then t.weekly_cap else null end,
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

comment on column public.profiles.billing_exempt is
  'Prompt 673/725: true = comped: never billed or locked, but shown as active on its tier and capped like it. Admin-only to change.';

-- Comped agents sit on Premium.
update public.profiles set billing_tier = 'premium'
 where billing_exempt and role = 'agent'
   and exists (select 1 from public.agent_billing_tiers where key = 'premium');
