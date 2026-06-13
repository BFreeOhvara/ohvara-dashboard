-- ============================================================
-- Migration 026 — Single source of truth for rep "today" stats
--
-- Total Dials, Booked, Booking Rate, Batch Total, "Calls Today" and the
-- Completed Days chart were each computed independently in the client
-- (useTodayCallStats, useRepStats('day'), computeKPIs batch total,
-- useCompletedDays) with subtly different math (Math.round vs toFixed,
-- distinct-vs-raw counts, local-vs-UTC day boundaries) so the numbers
-- could diverge across My Leads / My Stats / Goals.
--
-- This adds two SECURITY INVOKER functions that ALL of those surfaces
-- call, so the aggregation lives in exactly one place. INVOKER means RLS
-- still applies: a rep only ever sees their own rows; admins/closers
-- (broader RLS) can read any rep's. Day boundaries are the UTC calendar
-- day everywhere, matching the daily-batch cron.
--
--   rep_today_metrics(rep)        -> calls, booked, booking_rate,
--                                    batch_total, daily_target  (one row)
--   rep_completed_days(rep, days) -> per-day dialed + completed series
-- ============================================================

create or replace function rep_today_metrics(p_rep_id uuid)
returns table (
  calls int,
  booked int,
  booking_rate int,
  batch_total int,
  daily_target int
)
language sql
stable
as $$
  select
    coalesce(t.calls, 0),
    coalesce(t.booked, 0),
    case when coalesce(t.calls, 0) > 0
         then round(coalesce(t.booked, 0)::numeric / t.calls * 100)::int
         else 0 end,
    coalesce(b.batch_total, 0),
    150
  from
    (select count(*)::int as calls,
            count(*) filter (where outcome in ('Booked', 'Appointment Booked'))::int as booked
     from calls
     where rep_id = p_rep_id
       and created_at >= current_date::timestamptz) t
    cross join
    (select count(*)::int as batch_total
     from leads
     where assigned_rep_id = p_rep_id
       and batch_date = current_date) b
$$;

create or replace function rep_completed_days(p_rep_id uuid, p_days int default 21)
returns table (
  day date,
  dialed int,
  completed boolean
)
language sql
stable
as $$
  with series as (
    select generate_series(
      current_date - (p_days - 1),
      current_date,
      interval '1 day'
    )::date as day
  ),
  -- net calls table = one row per lead per rep per UTC day, so distinct
  -- lead_ids per day = leads actually dialed that day
  dialed as (
    select created_at::date as day, count(distinct lead_id)::int as n
    from calls
    where rep_id = p_rep_id
      and created_at >= (current_date - (p_days - 1))::timestamptz
    group by created_at::date
  )
  select s.day,
         coalesce(d.n, 0) as dialed,
         coalesce(d.n, 0) >= 150 as completed
  from series s
  left join dialed d on d.day = s.day
  order by s.day
$$;

grant execute on function rep_today_metrics(uuid) to authenticated;
grant execute on function rep_completed_days(uuid, int) to authenticated;
