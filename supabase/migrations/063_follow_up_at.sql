-- Migration 063 — Follow-Up: schedule-based return into rep's active list
--
-- follow_up_at already exists on leads (set by handle_lead_pipeline trigger,
-- stored by CallModal via patch.follow_up_at). This migration:
--   1. Confirms the column exists (IF NOT EXISTS — safe re-run)
--   2. Updates assign_daily_batches() to promote due follow-ups BEFORE
--      filling new-lead slots, so they count against the 150-lead cap.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_at timestamptz;

-- Promote due follow-ups first, then fill remaining slots up to 150.
CREATE OR REPLACE FUNCTION assign_daily_batches(batch_size int DEFAULT 150)
RETURNS TABLE (rep_id uuid, batch_count int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rep record;
  needed int;
BEGIN
  FOR rep IN
    SELECT id FROM profiles WHERE role = 'rep' AND is_active = true
  LOOP
    -- Step 1: promote follow-ups due today or earlier back to active.
    UPDATE leads
    SET batch_date = current_date, status = 'New'
    WHERE assigned_rep_id = rep.id
      AND status = 'Follow-Up'
      AND follow_up_at IS NOT NULL
      AND follow_up_at::date <= current_date;

    -- Close out those follow_up_queue rows so process_lead_queues() skips them.
    UPDATE follow_up_queue fuq
    SET reminded_at = now()
    WHERE fuq.rep_id = rep.id
      AND fuq.reminded_at IS NULL
      AND fuq.completed_at IS NULL
      AND fuq.follow_up_at <= now();

    -- Step 2: count how many active leads this rep already has today
    --         (includes just-promoted follow-ups).
    SELECT batch_size - count(*) INTO needed
    FROM leads
    WHERE assigned_rep_id = rep.id AND batch_date = current_date;

    -- Step 3: pull forward the rep's own older New leads.
    IF needed > 0 THEN
      UPDATE leads SET batch_date = current_date
      WHERE id IN (
        SELECT id FROM leads
        WHERE assigned_rep_id = rep.id
          AND batch_date < current_date
          AND status = 'New'
        ORDER BY batch_date DESC
        LIMIT needed
      );
      SELECT batch_size - count(*) INTO needed
      FROM leads
      WHERE assigned_rep_id = rep.id AND batch_date = current_date;
    END IF;

    -- Step 4: pull from Unassigned pool.
    IF needed > 0 THEN
      UPDATE leads SET assigned_rep_id = rep.id, batch_date = current_date
      WHERE id IN (
        SELECT id FROM leads
        WHERE assigned_rep_id IS NULL AND status = 'New'
        ORDER BY created_at
        LIMIT needed
      );
      SELECT batch_size - count(*) INTO needed
      FROM leads
      WHERE assigned_rep_id = rep.id AND batch_date = current_date;
    END IF;

    -- Step 5: backfill from rep's own non-terminal older leads.
    IF needed > 0 THEN
      UPDATE leads SET batch_date = current_date
      WHERE id IN (
        SELECT id FROM leads
        WHERE assigned_rep_id = rep.id
          AND batch_date < current_date
          AND status NOT IN ('Booked', 'Appointment Booked', 'Not Interested', 'No Answer', 'Follow-Up')
        ORDER BY batch_date DESC, updated_at DESC
        LIMIT needed
      );
    END IF;

    rep_id := rep.id;
    SELECT count(*) INTO batch_count
    FROM leads
    WHERE assigned_rep_id = rep.id AND batch_date = current_date;
    RETURN NEXT;
  END LOOP;
END;
$$;
