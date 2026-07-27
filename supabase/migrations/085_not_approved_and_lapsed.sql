-- Migration 085: Not Approved + Lapsed policy tracking (Prompt 369)
--
-- Two new terminal outcomes for a policy, neither auto-detectable from any
-- existing field — both captured via agent self-report:
--
--   * Not Approved: the carrier reviewed a Submitted application and didn't
--     approve it. Surfaced via a new `pending_underwriting` flag set at
--     submission time ("was this approved immediately, or does it need
--     underwriting?"), which drives an ongoing (non-date-gated) banner
--     asking whether the decision has come back.
--   * Lapsed: an In Effect policy stopped being paid, no cancellation call
--     involved (that's the existing `cancellation_status` 3-way-call flow,
--     a different concept per Prompt 365's audit). Tracked via a recurring
--     monthly check-in banner, anchored to the policy's own effective_date
--     day-of-month.
--
-- `archived_at` is a separate dismissal flag layered on top of `status` (not
-- a new enum value) so the historical status (Undrafted/Lapsed/Not
-- Approved) stays intact for metrics after an agent marks a dead policy
-- "gone" from the new Needs Follow-up tab.

alter type policy_status add value if not exists 'Not Approved';
alter type policy_status add value if not exists 'Lapsed';

alter table policies add column if not exists next_lapse_check_at timestamptz;
alter table policies add column if not exists pending_underwriting boolean not null default false;
alter table policies add column if not exists archived_at timestamptz;

create index if not exists policies_next_lapse_check_idx on policies(next_lapse_check_at) where status = 'In Effect';
create index if not exists policies_archived_at_idx on policies(archived_at);

-- ============================================================
-- Day-of-month helper — next occurrence of day `dom` strictly after `after`,
-- clamped to the shorter month when `dom` overflows (e.g. day 31 in a
-- 30-day month lands on the last day, not spilling into the next month).
-- Used for both the initial backfill and every later "advance/reset the
-- lapse check" mutation, so the clamping logic lives in exactly one place.
-- ============================================================
create or replace function public.next_dom_occurrence(dom int, after date default current_date)
returns date
language plpgsql
immutable
as $$
declare
  month_start date := date_trunc('month', after)::date;
  candidate date;
begin
  loop
    candidate := month_start + (least(dom, extract(day from (month_start + interval '1 month' - interval '1 day'))::int) - 1) * interval '1 day';
    if candidate > after then
      return candidate;
    end if;
    month_start := (month_start + interval '1 month')::date;
  end loop;
end;
$$;

revoke execute on function public.next_dom_occurrence(int, date) from public, anon;
grant execute on function public.next_dom_occurrence(int, date) to authenticated, service_role;

-- Backfill existing In Effect policies to the next FUTURE occurrence of
-- their effective_date's day-of-month — never the past, so this doesn't
-- fire every lapse banner simultaneously the moment this ships.
update policies
set next_lapse_check_at = public.next_dom_occurrence(extract(day from effective_date)::int, current_date)::timestamptz
where status = 'In Effect' and effective_date is not null and next_lapse_check_at is null;

-- ============================================================
-- Lapse check-in mutations — plain SQL (SECURITY INVOKER), so the existing
-- policies_update RLS policy (agent_id = auth.uid() or is_admin()) is what
-- actually authorizes these, same as every other agent-initiated write.
-- ============================================================

-- "Still on the book" answered Yes: push the check forward exactly one
-- calendar month from whichever date was due, same day-of-month as the
-- policy's own effective_date.
create or replace function public.advance_policy_lapse_check(p_id uuid)
returns void
language sql
as $$
  update policies
  set next_lapse_check_at = public.next_dom_occurrence(
        extract(day from effective_date)::int,
        coalesce(next_lapse_check_at, now())::date
      )
  where id = p_id and effective_date is not null;
$$;

-- "Back on the books" from the Needs Follow-up tab for a Lapsed policy:
-- reinstate to In Effect and reset the check-in to the next future
-- occurrence from today (not from whatever stale date it lapsed at).
create or replace function public.reactivate_lapsed_policy(p_id uuid)
returns void
language sql
as $$
  update policies
  set status = 'In Effect',
      next_lapse_check_at = public.next_dom_occurrence(extract(day from effective_date)::int, current_date)
  where id = p_id and effective_date is not null;
$$;

revoke execute on function public.advance_policy_lapse_check(uuid) from public, anon;
revoke execute on function public.reactivate_lapsed_policy(uuid)   from public, anon;
grant execute on function public.advance_policy_lapse_check(uuid) to authenticated, service_role;
grant execute on function public.reactivate_lapsed_policy(uuid)   to authenticated, service_role;
