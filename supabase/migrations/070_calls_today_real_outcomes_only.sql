-- Migration 070 — "Calls Today" counts real outcomes only (Prompt 310a)
--
-- rep_today_metrics (migration 026) counted every row in `calls` for the
-- day via count(*), including 'No Answer' — a dial nobody picked up, not a
-- real conversation. That inflated "Calls Today" and deflated the booking
-- rate against dials that never connected.
--
-- Fix: `calls` now counts only outcomes where the rep actually reached the
-- lead (voicemail-equivalent or a real conversation) — Appointment Booked,
-- Not Interested, Follow-Up. 'No Answer' rows still get inserted (CallModal
-- unchanged) and still count toward rep_completed_days' daily dial quota —
-- that tracking intentionally wants every attempt, answered or not.

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
       and created_at >= current_date::timestamptz
       and outcome <> 'No Answer') t
    cross join
    (select count(*)::int as batch_total
     from leads
     where assigned_rep_id = p_rep_id
       and batch_date = current_date) b
$$;

grant execute on function rep_today_metrics(uuid) to authenticated;
