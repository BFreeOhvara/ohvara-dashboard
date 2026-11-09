-- P914 — No pilot: every agent pays from day one. Unnumbered and NOT applied (P904 already switched billing on):
-- Brayden says yes before it runs. Runs after 237 (billing engine), 249 (final pricing) and 250 (paid day ahead).
--
--   1. Any agent still on plan 'pilot' moves to 'paid' from today (logged in agent_billing_events, before and after).
--      The optional VA cost line is switched off for everyone and any pending pilot → paid notice is cleared.
--   2. The table can no longer hold a pilot or a VA cost line (check constraints).
--   3. The three admin pilot functions stay (old clients still call them by name) but refuse with one plain line.
--
-- Everything that branches on plan = 'pilot' (billing_status_of, the nightly fee rate, membership due, the weekly VA
-- cost charge, my_billing) is left as is: with no pilot rows those branches never run.

begin;

-- 1. Move every pilot agent to paid, logged.
do $$
declare r record;
begin
  for r in select * from public.agent_billing_plans where plan = 'pilot' or va_cost_on or to_paid is not null loop
    perform public.billing_log(r.agent_id, 'no_pilot',
      jsonb_build_object('plan', r.plan, 'va_cost_on', r.va_cost_on, 'to_paid', r.to_paid),
      jsonb_build_object('plan', 'paid', 'va_cost_on', false, 'to_paid', null),
      'P914: no pilot, every agent pays from day one');
  end loop;
  update public.agent_billing_plans
     set plan = 'paid',
         paid_start = coalesce(paid_start, public.billing_today()),
         va_cost_on = false,
         to_paid = null,
         updated_at = now()
   where plan = 'pilot' or va_cost_on or to_paid is not null;
end $$;

-- 2. No pilot and no VA cost line from here on.
alter table public.agent_billing_plans drop constraint if exists agent_billing_plans_no_pilot;
alter table public.agent_billing_plans add constraint agent_billing_plans_no_pilot check (plan = 'paid');
alter table public.agent_billing_plans drop constraint if exists agent_billing_plans_no_va_cost;
alter table public.agent_billing_plans add constraint agent_billing_plans_no_va_cost check (not va_cost_on);

-- 3. The admin pilot switch, the VA cost line and pilot → paid refuse.
create or replace function public.admin_billing_pilot_set(p_agent uuid, p_on boolean, p_start date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  raise exception 'No pilot: every agent pays from day one (P914)';
end; $$;

create or replace function public.admin_billing_va_cost_set(p_agent uuid, p_on boolean, p_rate_cents int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  raise exception 'No pilot: every agent pays from day one, so there is no VA cost line (P914)';
end; $$;

create or replace function public.admin_billing_to_paid(p_agent uuid, p_start date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  raise exception 'No pilot: every agent is already on a paid plan (P914)';
end; $$;

commit;
