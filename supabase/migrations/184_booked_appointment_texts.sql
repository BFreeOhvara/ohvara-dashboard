-- 184 — Booked Appointments text workflows, sending off (Agent Portal Rework,
-- build step 5; Brayden approved Oct 29).
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: one new column on recovery_config and one new partial
-- unique index on inbound_events. Nothing is removed, renamed or emptied, and
-- no grant changes.
--
-- APPLY ORDER: after 180_agent_inbounds and 181_fix_inbound_agent_checks. The
-- check below stops the whole file if either is missing.
--
-- The texts (edge function lead-workflow-sms) go to mortgage_protection leads:
-- a welcome text, then day 0 / 1 / 3 / 7 and monthly while the lead isn't
-- reached; a confirmation and two reminders once booked; a rebook text after a
-- no-show (twice at most). Every step, planned or done, is one row in
-- inbound_events (180) with detail.step and detail.seq, so the agent sees it
-- on the inbound's timeline. Nothing is sent while recovery_config.sms_live is
-- off; each step is then marked skipped (detail.reason 'sms_off').
--
--   recovery_config.sms_from_number   the ONE Ohvara number every one of these
--                                     texts is sent from (E.164). Starts null:
--                                     with no number nothing is sent (skipped,
--                                     reason 'no_sender'). Set by the service
--                                     role or SQL only; it is not added to
--                                     122's authenticated update grant, so the
--                                     admin settings page can't change it.
--   inbound_events_step_uidx          a step (per seq) is planned or sent once
--                                     per lead. Skipped rows are left out, so a
--                                     skipped step never blocks anything else.

do $$
begin
  if to_regclass('public.inbound_events') is null then
    raise exception 'NNN needs 180_agent_inbounds applied first';
  end if;
  if position('coalesce((' in pg_get_functiondef('public.add_inbound_note(uuid, text)'::regprocedure)) = 0 then
    raise exception 'NNN needs 181_fix_inbound_agent_checks applied first';
  end if;
end $$;

-- ── the central sending number ──────────────────────────────────────────────
alter table public.recovery_config
  add column if not exists sms_from_number text
    check (sms_from_number is null or sms_from_number ~ '^\+[1-9][0-9]{7,14}$');

-- ── one row per step ────────────────────────────────────────────────────────
create unique index if not exists inbound_events_step_uidx
  on public.inbound_events (lead_id, (detail->>'step'), (coalesce(detail->>'seq', '1')))
  where detail ? 'step' and state in ('scheduled', 'done');

-- Check after applying (expect: sms_from_number null; authenticated can't
-- update it; the index exists):
--   select sms_from_number from public.recovery_config;
--   select has_column_privilege('authenticated', 'public.recovery_config', 'sms_from_number', 'update');  -- false
--   select indexdef from pg_indexes where indexname = 'inbound_events_step_uidx';
