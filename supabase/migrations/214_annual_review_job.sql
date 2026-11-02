-- 214 — Month 12 job: every policy we look after gets an annual review step when it
-- reaches 12 months, plus a term-conversion step where that applies, one of each, so
-- nobody has to remember.
--
-- NOT APPLIED. Written from a worktree; applying it is Brayden's apply step. It applies
-- only after 193_servicing_model.sql and 195_servicing_functions.sql, and on a project
-- with pg_cron: its first statement stops the whole file if any of them is missing. It
-- only creates to-dos. No text, call, notice, screen, edge function, pay line or rate
-- here, and every live switch stays off.
--
-- Why: Fulfillment Build Order, Lane A item 4. 193's view reads both kinds as the
-- ongoing stage, but nothing creates them.
--
-- CONVERSION STEPS CAN'T FIRE ON ANY POLICY UNTIL SOMETHING WRITES product_type. src only
-- reads that column and agent_submit_deal has no such argument, so today this job writes
-- reviews only.
--
-- ONE OF EACH PER POLICY, EVER, as scoped. A later year-2 job must replace this index,
-- because research/Plan and Lead Pricing.md:74 sells one review per policy per year from
-- the first anniversary.
--
-- WHO GETS A STEP. The job reads policies directly and not the status view, which leaves
-- out a policy with no tasks unless it went to Fulfillment (206:1289), so a sold lead
-- linked to its policy afterward would be missed. A policy needs all of these:
--   a journey     a system packet_check, review_call or chargeback_watch in any status,
--                 on the policy or on a lead whose client_policy_id is the policy. Those
--                 three only, so the job's own steps and agent requests never count. Old
--                 cancellation rows (187) have no such seed.
--   not ended     206:1269 negated. No other status filter: Submit rows start as Submitted.
--   an agent      agent_id is not null.
--   month 12      today is on or past anchor + 12 months, the view's anchor. No upper
--                 bound, so a missed run catches up and the index keeps it to one step.
-- Sample policies aren't skipped. Their steps are flagged is_sample, and the demo side
-- rule in 206 keeps those away from live VAs.
--
-- THE STEP is requested, not scheduled. Calendar.jsx:127-130 reads a scheduled annual_review
-- as a time a VA set, so it would show a booked review at noon UTC when nobody booked it.
-- Requested stays off the calendar, is in va_servicing_queue (206:484), is the view's
-- next_step, isn't counted in open_requests (it is a system step), and va_servicing_schedule
-- moves it to scheduled when a VA books it. requested_by_id is null because no person
-- pressed anything; the feed's left join handles that (209:450). A done or cancelled step
-- is never recreated, because the index covers every status. An agent's own annual_review
-- or conversion request (requested_by agent) isn't covered and stays allowed.
--
-- Who can write servicing_tasks: the writers named in 212's comment (servicing_seed_steps,
-- called by agent_submit_deal and set_inbound_outcome, and the rest), plus servicing_month12_sweep.

-- ── 1. Guard ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.policy_servicing_status') is null then
    raise exception '214 needs 193_servicing_model applied first';
  end if;
  if to_regclass('public.servicing_task_notes') is null then
    raise exception '214 needs 195_servicing_functions applied first';
  end if;
  if to_regclass('cron.job') is null then
    raise exception '214 needs pg_cron: cron.job is missing';
  end if;
end $$;

-- ── 2. Which products get a conversion step ─────────────────────────────────
-- commission_schedule.type uses TL for term (086) and 088 names Term as the old category.
-- Admins already update app_settings under RLS (091), so no new grant or policy.
alter table public.app_settings
  add column if not exists conversion_product_types text[] not null default array['term', 'term life', 'tl'];

comment on column public.app_settings.conversion_product_types is
  'Which policies.product_type values get a conversion step at month 12. Matching is case-insensitive and trimmed.';

-- ── 3. One of each per policy ───────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.servicing_tasks
              where requested_by = 'system' and policy_id is not null and kind in ('annual_review', 'conversion')
              group by policy_id, kind having count(*) > 1) then
    raise exception '214 stopped: a policy already has two system annual_review or conversion rows. Nothing was changed. Sort those rows out first.';
  end if;
end $$;

create unique index if not exists servicing_tasks_month12_uidx
  on public.servicing_tasks (policy_id, kind)
  where requested_by = 'system' and policy_id is not null and kind in ('annual_review', 'conversion');

-- ── 4. The sweep ────────────────────────────────────────────────────────────
-- Noon UTC is the same calendar day in every US time zone (193, 201). The seed lateral is
-- the journey test as well as the lead pick: it is a cross join, so a policy with no seed
-- row falls out there. A Submit policy's seeds have no lead, so its lead_id stays null.
create or replace function public.servicing_month12_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into servicing_tasks (agent_id, policy_id, lead_id, kind, status, requested_by, requested_by_id, is_sample, best_time, due_at)
  select p.agent_id, p.id, seed.lead_id, k.kind, 'requested', 'system', null, p.is_sample, null,
         ((a.anchor + interval '12 months')::date + time '12:00') at time zone 'UTC'
    from policies p
   cross join lateral (select coalesce(p.effective_date, p.policy_sold_date, p.created_at::date) as anchor) a
   cross join lateral (
     select s.lead_id
       from servicing_tasks s
      where s.requested_by = 'system'
        and s.kind in ('packet_check', 'review_call', 'chargeback_watch')
        and (s.policy_id = p.id
             or s.lead_id in (select l.id from leads l where l.client_policy_id = p.id))
      order by (s.lead_id is null), s.created_at, s.id
      limit 1
   ) seed
   cross join lateral (
     select 'annual_review' as kind
     union all
     select 'conversion'
      where lower(btrim(p.product_type)) in (
        select lower(btrim(e.entry))
          from app_settings st
         cross join lateral unnest(st.conversion_product_types) as e(entry)
      )
   ) k
   where p.agent_id is not null
     and p.status not in ('Lapsed', 'Not Approved', 'Undrafted')
     and p.archived_at is null
     and not exists (select 1 from servicing_tasks x
                      where x.policy_id = p.id and x.kind = 'lapse_save' and x.status = 'done'
                        and x.outcome in ('lapsed', 'client_cancelled'))
     and current_date >= (a.anchor + interval '12 months')::date
  on conflict (policy_id, kind)
    where requested_by = 'system' and policy_id is not null and kind in ('annual_review', 'conversion')
    do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Supabase's default grants would otherwise open it, so all three are named.
revoke all on function public.servicing_month12_sweep() from public, anon, authenticated;

-- ── 5. Who writes the table ─────────────────────────────────────────────────
comment on table public.servicing_tasks is
  'Every servicing step and every request on a client. Written only by servicing_seed_steps (called by agent_submit_deal and set_inbound_outcome), agent_submit_service_request, fulfillment_schedule_request, fulfillment_finish_request, the va_servicing_* functions, agent_servicing_clear_sent, servicing_month12_sweep and the service role. A request doesn''t count against the weekly cap.';

-- ── 6. Cron ─────────────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'servicing-month12-sweep';
select cron.schedule('servicing-month12-sweep', '20 7 * * *', 'select public.servicing_month12_sweep()');

-- Check after applying:
--   select schedule, command from cron.job where jobname = 'servicing-month12-sweep';
--   select has_function_privilege('authenticated', 'public.servicing_month12_sweep()', 'execute');  -- false
--   select conversion_product_types from public.app_settings where id = 1;                          -- {term,"term life",tl}
