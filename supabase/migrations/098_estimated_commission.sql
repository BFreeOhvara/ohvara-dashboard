-- Migration 098 (Prompt 412): real commission Balance — a computed
-- estimated_commission per policy, from commission_schedule's tier-70 rate,
-- for the 9 carriers that have real comp data (F&G, Corebridge, Ethos,
-- Mutual of Omaha, Foresters, Transamerica, National Life Group, Fidelity
-- Life, American Amicable). Brayden's decision: flat commission balance,
-- no reserve/holdback modeling anywhere — drops that concept entirely (see
-- Prompt 411's "Balance & Reserve" -> "Balance" rename).
--
-- Match is exact (carrier_name + product_name + tier 70), not fuzzy —
-- product_name has been sourced straight from commission_schedule's own
-- product list since Prompt 378/401, so a real policy's product string is
-- already one of commission_schedule's own values whenever it's set at all.
--
-- Aflac, Baltimore Life, Chubb (migration 086) have zero real rate data —
-- any policy against those carriers naturally finds no matching row here,
-- same null the Compensation Grid already renders as "—" for. That null is
-- NEVER rendered as $0 client-side — Balance.jsx shows "Pending — carrier
-- comp data not yet available" instead, since a bare $0 would misleadingly
-- imply those policies earn nothing.

alter table policies add column if not exists estimated_commission numeric(12,2);

-- AFTER trigger (not BEFORE) because annual_premium is itself a generated
-- column (migration 072) — Postgres only finalizes generated-column values
-- after BEFORE triggers run, so a BEFORE trigger on this same row can't read
-- NEW.annual_premium reliably. The trigger only watches carrier_name/
-- product_name/monthly_premium, and its own UPDATE only touches
-- estimated_commission — so it can't recursively re-fire itself.
create or replace function public.compute_policy_estimated_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rate numeric;
begin
  select pct into rate
  from commission_schedule
  where carrier = new.carrier_name
    and product = new.product_name
    and tier = 70;

  update policies
  set estimated_commission = case when rate is null then null else round(new.annual_premium * rate / 100, 2) end
  where id = new.id;

  return null;
end;
$$;

drop trigger if exists policies_compute_estimated_commission on policies;
create trigger policies_compute_estimated_commission
  after insert or update of carrier_name, product_name, monthly_premium on policies
  for each row execute function public.compute_policy_estimated_commission();

-- Backfill every existing policy in one statement rather than re-saving
-- each row through the trigger.
update policies p
set estimated_commission = round(p.annual_premium * cs.pct / 100, 2)
from commission_schedule cs
where cs.carrier = p.carrier_name
  and cs.product = p.product_name
  and cs.tier = 70
  and cs.pct is not null;

-- team_performance_policies() (migration 093, Prompt 396; extended with
-- agent_avatar_url/agent_avatar_color by migration 096, Prompt 407 — carried
-- forward here unchanged, the drop+recreate below is NOT dropping those) is
-- the existing company-wide non-PII aggregate — Balance's "Everyone" scope
-- reuses it rather than standing up a second company-wide path. Adds
-- estimated_commission (a derived number, not PII) plus
-- is_pending_commission (true when this policy's own carrier has no comp
-- data yet at all) WITHOUT exposing carrier_name/product_name themselves —
-- same PII boundary migration 093 already drew (no client name, phone,
-- policy number, carrier, product, or notes to any authenticated user).
drop function if exists public.team_performance_policies();

create function public.team_performance_policies()
returns table (
  id                    uuid,
  agent_id              uuid,
  agent_name            text,
  agent_avatar_url      text,
  agent_avatar_color    text,
  policy_sold_date      date,
  effective_date        date,
  monthly_premium       numeric(10,2),
  annual_premium        numeric(12,2),
  status                policy_status,
  cancellation_status   cancellation_status,
  cancellation_call_at  timestamptz,
  created_at            timestamptz,
  estimated_commission  numeric(12,2),
  is_pending_commission boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.agent_id, pr.full_name, pr.avatar_url, pr.avatar_color,
    p.policy_sold_date, p.effective_date,
    p.monthly_premium, p.annual_premium,
    p.status, p.cancellation_status, p.cancellation_call_at,
    p.created_at,
    p.estimated_commission,
    (p.estimated_commission is null and p.carrier_name in ('Aflac', 'Baltimore Life', 'Chubb')) as is_pending_commission
  from policies p
  join profiles pr on pr.id = p.agent_id;
$$;

revoke execute on function public.team_performance_policies() from public, anon;
grant execute on function public.team_performance_policies() to authenticated;
