-- ============================================================
-- Migration 064 — Settings page support + per-rep-timezone-aware
-- daily batch reset (Prompt 226)
--
-- Part A findings this migration acts on:
--
-- 1. No Settings page/nav existed before this prompt. profiles.timezone
--    (042) IS already settable — admin-create-user (041/Users.jsx) accepts
--    a timezone at account-creation time — but in practice every single
--    real profile row (9/9, checked directly) is still 'America/Chicago',
--    including Nate (closer, actually based in Florida/Eastern). The
--    creation-time field exists but isn't being used correctly, and there
--    was no way for a user to view/correct it themselves afterward. This
--    migration doesn't change that admin-creation path; the new Settings
--    page (frontend, this same prompt) adds the missing self-service path.
--
-- 2. assign_daily_batches() (016) looped every active rep in one pass with
--    no per-rep filtering and no "last assigned" tracking column at all —
--    confirmed by reading 016 directly. This migration adds
--    last_batch_assigned_local_date and gates each rep's assignment on it.
--
-- 3. Root cause of the previously-flagged 00:05-vs-~06:05 UTC drift: NOT a
--    mystery. src/pages/rep/MyLeads.jsx (lines 41-46) documents that
--    Brayden manually rescheduled the live `daily-batch-assign` cron via
--    the Supabase SQL editor on 2026-06-22 to 06:05 UTC; migration 016's
--    committed text was simply never updated to match. Moot after this
--    migration replaces the schedule outright.
--
-- 4. Cost check, with a real surprise: assign_daily_batches() itself is
--    pure SQL invoked directly by pg_cron (`select assign_daily_batches()`)
--    — not Edge-Function-based, not separately metered. BUT querying
--    cron.job directly turned up a SECOND, unrelated daily cron job,
--    `assign-daily-batch` (singular — not the same job as
--    `daily-batch-assign`), scheduled at 06:00 UTC (5 min before this
--    one), which POSTs to a metered Edge Function
--    (supabase/functions/assign-daily-batch) running an older, cruder
--    round-robin assignment with ZERO timezone awareness and zero
--    self-healing logic. Its own batch_assignments table shows no rows
--    since 2026-06-09 — it's been a live, still-firing, still-metered,
--    still-racing duplicate of the real system for weeks, apparently
--    silently harmless only because the unassigned-lead pool has stayed
--    empty by the time it runs. Since it runs 5 minutes BEFORE the real
--    function and has no timezone logic at all, leaving it live would
--    directly undermine the per-rep-timezone-aware fix below (it could
--    grab from the shared unassigned pool on a fixed UTC schedule before
--    a rep's own local-midnight-gated run gets to it). Unscheduling it
--    here — reversible, well-justified by the investigation, flagged
--    here and in the Memories log rather than done silently. The unused
--    Edge Function file itself is left in place (not deleted).
-- ============================================================

-- 1. Per-rep local-date tracking for the batch-reset gate.
alter table profiles
  add column if not exists last_batch_assigned_local_date date;

-- 2. Notification category preferences (Settings > Notifications).
--    Empty object = every category defaults to enabled; a category is
--    disabled only when explicitly set to `false`.
alter table profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- 3. Working hours (Settings > Calling) — informational only for now,
--    no gating logic tied to these yet (Prompt 226 Part B, Calling section).
alter table profiles
  add column if not exists working_hours_start time;
alter table profiles
  add column if not exists working_hours_end time;

-- 4. Per-rep-timezone-aware assign_daily_batches(). Same 4-step body as
--    016 (count today's batch, roll over unworked New leads, top up from
--    the unassigned pool, re-surface if the pool is dry) — the only
--    change is the outer loop now skips a rep entirely until their own
--    local calendar day (via real IANA AT TIME ZONE conversion, so DST
--    is automatic) has advanced past their last recorded run.
--
--    batch_date itself is left as Postgres current_date (UTC), unchanged
--    from 016 — that's the same "today" the rest of the dashboard already
--    keys off (My Leads, Activity Feed's UTC-day bucketing from Prompt
--    223). Only WHEN each rep's row gets touched is now gated per-rep;
--    WHAT gets written still matches the existing global convention.
--    Assumption worth flagging: this is correct as long as every profile
--    timezone stays behind UTC (true of every US zone in
--    SELECTABLE_TIMEZONES) — a zone ahead of UTC could in principle hit
--    its local midnight before the UTC date has rolled over, which isn't
--    handled here since it doesn't apply to any real data today.
create or replace function assign_daily_batches(batch_size int default 150)
returns table (rep_id uuid, batch_count int)
language plpgsql
security definer
as $$
declare
  rep record;
  needed int;
  rep_local_date date;
begin
  for rep in
    select id, timezone, last_batch_assigned_local_date
    from profiles where role = 'rep' and is_active = true
  loop
    rep_local_date := (now() at time zone coalesce(rep.timezone, 'America/Chicago'))::date;

    -- Already ran for this rep's own local calendar day — skip entirely.
    continue when rep.last_batch_assigned_local_date is not distinct from rep_local_date;

    -- 1. how many leads does this rep already have for today?
    select batch_size - count(*) into needed
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;

    -- 2. roll over the rep's own unworked leads from previous days
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status = 'New'
        order by batch_date desc
        limit needed
      );
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date;
    end if;

    -- 3. top up from the unassigned pool
    if needed > 0 then
      update leads set assigned_rep_id = rep.id, batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id is null and status = 'New'
        order by created_at
        limit needed
      );
      select batch_size - count(*) into needed
      from leads
      where assigned_rep_id = rep.id and batch_date = current_date;
    end if;

    -- 4. pool is dry: re-surface the rep's most recent worked leads
    --    (anything except Booked) so the dashboard is never empty
    if needed > 0 then
      update leads set batch_date = current_date
      where id in (
        select id from leads
        where assigned_rep_id = rep.id
          and batch_date < current_date
          and status <> 'Booked'
        order by batch_date desc, updated_at desc
        limit needed
      );
    end if;

    update profiles set last_batch_assigned_local_date = rep_local_date where id = rep.id;

    rep_id := rep.id;
    select count(*) into batch_count
    from leads
    where assigned_rep_id = rep.id and batch_date = current_date;
    return next;
  end loop;
end;
$$;

-- 5. Run frequently enough to catch every rep's local midnight promptly —
--    the per-rep gate above means a run that finds nobody due is a cheap
--    no-op loop over a handful of rows, not a re-assignment.
do $$
begin
  perform cron.unschedule('daily-batch-assign');
exception when others then
  null; -- job didn't exist yet
end;
$$;

select cron.schedule('daily-batch-assign', '*/15 * * * *', 'select assign_daily_batches()');

-- 6. Unschedule the legacy duplicate found during Part A (see notes above).
--    Reversible — re-add with cron.schedule(...) if this turns out to be
--    wanted for something else after all.
do $$
begin
  perform cron.unschedule('assign-daily-batch');
exception when others then
  null; -- job didn't exist
end;
$$;

-- 7. Gate the one server-side notification producer (message-reply, 043)
--    on the new Settings > Notifications toggle, so "message" behaves the
--    same as the client-side-gated categories below. Every other category
--    (deal_closed, badge, leads_unlocked, follow_up, appointment_booked,
--    appointment_reminder_5min) is inserted from React hooks and gated
--    there instead; call_graded (grade-call Edge Function) is gated in
--    that function's own TypeScript.
create or replace function notify_rep_on_message_reply()
returns trigger language plpgsql security definer as $$
declare
  prefs jsonb;
begin
  if new.reply_body is not null and old.reply_body is null then
    select notification_prefs into prefs from profiles where id = new.sender_id;
    if coalesce((prefs->>'message')::boolean, true) then
      insert into notifications (profile_id, type, message, data)
      values (
        new.sender_id,
        'message',
        'You received a reply to your message',
        jsonb_build_object(
          'message_id', new.id,
          'reply_preview', left(new.reply_body, 120)
        )
      );
    end if;
  end if;
  return new;
end;
$$;
