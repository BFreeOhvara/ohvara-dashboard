-- Migration 062 — No Answer 24h hold: return to Unassigned pool
--
-- no_answer_at was added by the handle_lead_pipeline trigger in migration 019.
-- This migration:
--   1. Confirms the column exists (IF NOT EXISTS — safe re-run)
--   2. Removes No Answer redistribution from process_lead_queues()
--      — the redistribute-no-answers edge function owns that logic now.
--      Leads return to pool (assigned_rep_id = NULL), not to a random rep.
--   3. Schedules the redistribute-no-answers edge function every 5 minutes.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS no_answer_at timestamptz;

-- Remove No Answer redistribution block; keep only follow-up returns.
CREATE OR REPLACE FUNCTION process_lead_queues()
RETURNS TABLE (redistributed int, followups_returned int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  q record;
  n_fu int := 0;
BEGIN
  -- Follow-ups due: back to the SAME rep at the scheduled time.
  FOR q IN
    SELECT id, lead_id, rep_id FROM follow_up_queue
    WHERE follow_up_at <= now() AND reminded_at IS NULL AND completed_at IS NULL
  LOOP
    UPDATE leads
    SET assigned_rep_id = COALESCE(q.rep_id, assigned_rep_id),
        batch_date = current_date,
        status = 'New'
    WHERE id = q.lead_id AND status = 'Follow-Up';
    IF FOUND THEN n_fu := n_fu + 1; END IF;
    UPDATE follow_up_queue SET reminded_at = now() WHERE id = q.id;
  END LOOP;

  -- No Answer redistribution is handled by redistribute-no-answers edge function.
  redistributed := 0;
  followups_returned := n_fu;
  RETURN NEXT;
END;
$$;

-- Register redistribute-no-answers edge function cron (every 5 minutes).
DO $$
BEGIN
  PERFORM cron.unschedule('redistribute-no-answers');
EXCEPTION WHEN others THEN NULL;
END;
$$;
SELECT cron.schedule(
  'redistribute-no-answers',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/redistribute-no-answers',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  )$$
);
