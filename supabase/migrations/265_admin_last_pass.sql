-- P945 (Brayden, Nov 10: "after this set I could consider the admin portal done"). NOT APPLIED until Brayden says yes.
--   1. VA days off: the allowance is 3 a month (admin setting; still booked by the VA, approved at once, never pending).
--   2. Owner payouts: a go-live switch, off. Owners connect their own bank through Stripe Connect Express (the
--      existing payout-account flow); nothing pays an owner until Brayden turns this on.
--   3. Missed booked calls escalate by themselves (src/lib/callEscalation.js is the same rule):
--        booked time + 5 min, not started  → the VA who has it is pinged
--        booked time + 10 min, not started → the next free VA (the agent's Deedstone number pod first) gets it and
--                                            the first VA is told; nobody free → the AI front desk rebooks the client
--      booked_call_escalation_sweep() runs every minute (pg_cron). Calls already live, finished or rebooking are left.

-- ── 1. Days off: 3 a month ──────────────────────────────────────────────────────────────────────────────────────
alter table public.app_settings alter column va_days_off_per_month set default 3;
update public.app_settings set va_days_off_per_month = 3 where id = 1 and va_days_off_per_month = 2;
create or replace function public.day_off_allowance() returns int language sql stable security definer set search_path = public as $$
  select coalesce((select va_days_off_per_month from app_settings where id = 1), 3)
$$;

-- ── 2. Owner payouts switch ─────────────────────────────────────────────────────────────────────────────────────
alter table public.recovery_config add column if not exists owner_payouts_live boolean not null default false;
comment on column public.recovery_config.owner_payouts_live is
  'P945: owners (admins) get their 50% of the profit in the Monday pay run, to the bank they connected through Stripe. Off until Brayden turns it on (Settings › Go live).';

-- ── 3. Missed booked calls ──────────────────────────────────────────────────────────────────────────────────────
alter table public.policies add column if not exists call_nudged_at    timestamptz;
alter table public.policies add column if not exists call_handed_at    timestamptz;
alter table public.policies add column if not exists call_rebook_at    timestamptz;
comment on column public.policies.call_nudged_at is 'P945: the VA was pinged 5 minutes after the booked time with no call started.';
comment on column public.policies.call_handed_at is 'P945: given to the next free VA 10 minutes after the booked time (once).';
comment on column public.policies.call_rebook_at is 'P945: nobody was free; the AI front desk rebooks the client.';

-- The next free VA for a call at p_at: on shift then, not live on a call, not the VA who has it, no other open call
-- within 30 minutes; the agent's Deedstone number pod first. (P936's training gate has no column yet, so it isn't
-- checked here; the sample and the VA side check it.)
create or replace function public.next_free_va(p_policy uuid, p_at timestamptz)
returns uuid language sql stable security definer set search_path = public as $$
  with pol as (select * from policies where id = p_policy),
  pod as (
    select nv.va_id, nv.sort
      from deedstone_agent_lines al
      join deedstone_number_vas nv on nv.number_id = al.number_id
     where al.agent_id = (select agent_id from pol)
  )
  select p.id
    from profiles p
    left join pod on pod.va_id = p.id
   where p.role = 'fulfillment' and p.is_active
     and p.is_demo = (select is_demo from pol)
     and p.id is distinct from (select assigned_fulfillment_id from pol)
     and public.va_on_shift_at(p.id, p_at)
     and not exists (select 1 from policies l where l.assigned_fulfillment_id = p.id and l.call_live_since is not null)
     and not exists (
       select 1 from policies o
        where o.assigned_fulfillment_id = p.id and o.fulfillment_assigned
          and o.fulfillment_stage is distinct from 'Complete' and o.id <> p_policy
          and o.scheduled_call_at is not null
          and abs(extract(epoch from o.scheduled_call_at - p_at)) < 1800)
   order by (pod.va_id is null), pod.sort nulls last, p.full_name
   limit 1
$$;
revoke all on function public.next_free_va(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.booked_call_escalation_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare
  pol      record;
  v_to     uuid;
  v_client text;
  v_when   text;
  v_to_name text;
  v_from_name text;
  n        int := 0;
begin
  for pol in
    select * from policies
     where fulfillment_assigned
       and fulfillment_stage is distinct from 'Complete'
       and call_live_since is null
       and call_rebook_at is null
       and scheduled_call_at is not null
       and scheduled_call_at between now() - interval '3 hours' and now() - interval '5 minutes'
     for update skip locked
  loop
    v_client := coalesce(nullif(trim(coalesce(pol.client_first_name, '') || ' ' || coalesce(pol.client_last_name, '')), ''), 'A client');
    v_when := to_char(pol.scheduled_call_at at time zone 'America/Chicago', 'FMHH12:MI AM');

    -- + 5 minutes: ping the VA (once).
    if pol.call_nudged_at is null then
      update policies set call_nudged_at = now() where id = pol.id;
      if pol.assigned_fulfillment_id is not null then
        perform public.notify(pol.assigned_fulfillment_id, 'fulfillment_call_not_started',
                  'Your ' || v_when || ' call hasn''t started', v_client || ' is waiting. Start it now or it moves on at 10 minutes.',
                  '/fulfillment', true, 'call-nudge:' || pol.id, jsonb_build_object('policy_id', pol.id));
      end if;
      n := n + 1;
    end if;

    -- + 10 minutes: the next free VA, once; nobody free → the AI front desk rebooks.
    if pol.scheduled_call_at <= now() - interval '10 minutes' and pol.call_handed_at is null then
      v_to := public.next_free_va(pol.id, now());
      if v_to is not null then
        select coalesce(nullif(btrim(full_name), ''), 'Fulfillment') into v_to_name from profiles where id = v_to;
        select nullif(btrim(full_name), '') into v_from_name from profiles where id = pol.assigned_fulfillment_id;
        update policies set assigned_fulfillment_id = v_to, fulfillment_claimed_at = now(), call_handed_at = now() where id = pol.id;
        insert into policy_events (policy_id, agent_id, kind, actor_id, actor_name, actor_role, detail)
        values (pol.id, pol.agent_id, 'reassigned', null, 'Ohvara', 'system',
                jsonb_build_object('from', pol.assigned_fulfillment_id, 'from_name', v_from_name, 'to', v_to, 'to_name', v_to_name,
                                   'scheduled_call_at', pol.scheduled_call_at, 'why', 'not started 10 minutes after its time'));
        perform public.notify(v_to, 'fulfillment_call_handed', v_client || '''s ' || v_when || ' call is yours now',
                  'Nobody started it. Call them now.', '/fulfillment', true, 'call-hand:' || pol.id, jsonb_build_object('policy_id', pol.id));
        if pol.assigned_fulfillment_id is not null then
          perform public.notify(pol.assigned_fulfillment_id, 'fulfillment_unassigned', v_client || ' moved to ' || v_to_name,
                    'It wasn''t started 10 minutes after its time.', '/fulfillment', false, 'call-moved:' || pol.id, jsonb_build_object('policy_id', pol.id, 'to', v_to));
        end if;
      else
        -- The AI front desk (P932) texts or calls the client to rebook; it reads call_rebook_at (still gated by
        -- ai_caller_live / sms_live, so nothing goes out while those are off).
        update policies set call_rebook_at = now(), call_handed_at = now() where id = pol.id;
        perform public.notify(a.id, 'fulfillment_call_rebook', v_client || '''s ' || v_when || ' call: nobody free',
                  'The AI front desk is asking them to rebook.', '/admin/fulfillment?tab=calendar', false, 'call-rebook:' || pol.id || ':' || a.id,
                  jsonb_build_object('policy_id', pol.id))
          from profiles a where a.role = 'admin' and a.is_active and a.is_demo = pol.is_demo;
      end if;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.booked_call_escalation_sweep() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'booked-call-escalation';
    perform cron.schedule('booked-call-escalation', '* * * * *', 'select public.booked_call_escalation_sweep()');
  end if;
end $$;
