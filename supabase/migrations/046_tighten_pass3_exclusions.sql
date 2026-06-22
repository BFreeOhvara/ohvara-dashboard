-- Migration 046: Tighten PASS 3 ("FINAL GUARANTEE") exclusion list
-- in assign_daily_batches
--
-- Context (Prompt 36, 2026-06-22): My Leads appeared stuck at 53/53
-- instead of resetting to a fresh 150 on day-rollover. Recon found the
-- header bug (fixed separately in MyLeads.jsx, commit 38e73ba) plus a
-- latent gap in this function's PASS 3 fallback: when a rep is short of
-- batch_size after PASS 1 (own-lead rollover) and PASS 2 (pool
-- round-robin), PASS 3 re-surfaces the rep's own leads from any
-- non-(`Not Interested`/`Appointment Booked`) status to fill the gap.
-- That means it can pull `No Answer` or `Follow-Up` leads back into
-- today's batch — leads that already have their OWN dedicated requeue
-- mechanisms with specific timers (No Answer: 4h same-rep requeue via
-- requeue_no_answer_leads, migration 017; 24h cross-rep redistribution
-- via process_lead_queues, migration 019/025; Follow-Up: returns at the
-- rep's chosen time via the same process_lead_queues). Letting PASS 3
-- grab them early bypasses those timers and can make a lead reappear
-- out of cadence.
--
-- Fix: PASS 3's exclusion list grows from
--   status NOT IN ('Not Interested', 'Appointment Booked')
-- to
--   status NOT IN ('Not Interested', 'Appointment Booked', 'No Answer', 'Follow-Up')
-- No other logic changes — PASS 1, PASS 2, and the trim step are
-- byte-identical to migration 040.
--
-- Status: speculative fix per Brayden's option B (2026-06-22) — ships
-- without live DB confirmation of the root cause; the alternative
-- explanation (unassigned pool just being smaller than 150 right now)
-- isn't excluded by this change and may still need the pool topped up.
--
-- Deploy: SQL editor only (same pattern as 040–044). Applying
-- CREATE OR REPLACE does NOT move any leads — it only updates the
-- function definition; leads move the next time the cron fires.

CREATE OR REPLACE FUNCTION assign_daily_batches(batch_size int DEFAULT 150)
RETURNS TABLE(rep_id uuid, batch_count int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_today    date := CURRENT_DATE;

  -- Rep tracking (parallel arrays, 1-indexed, sorted by profiles.id)
  v_rep_ids    uuid[];
  v_rep_needed int[];   -- slots each rep still needs after PASS 1
  v_num_reps   int;

  v_rep      RECORD;
  v_lead_id  uuid;
  v_niche    text;
  v_rep_idx  int;
  v_attempts int;
  v_dealt    bool;
  i          int;
BEGIN

  -- ===========================================================
  -- PASS 1: Steps 1 & 2 — roll over each rep's OWN prior-day
  --         'New' leads onto today's batch.
  --         No niche filter: rep owns all their leads.
  -- ===========================================================
  FOR v_rep IN
    SELECT p.id
    FROM profiles p
    WHERE p.role = 'rep' AND p.is_active = TRUE
    ORDER BY p.id
  LOOP
    UPDATE leads
    SET batch_date = v_today
    WHERE assigned_rep_id = v_rep.id
      AND status = 'New'
      AND batch_date IS NOT NULL
      AND batch_date < v_today;
  END LOOP;

  -- Build arrays: rep ids + how many more leads each rep needs
  SELECT
    array_agg(sub.pid ORDER BY sub.pid),
    array_agg(GREATEST(0, batch_size - sub.today_count) ORDER BY sub.pid)
  INTO v_rep_ids, v_rep_needed
  FROM (
    SELECT
      p.id AS pid,
      COALESCE(
        ( SELECT COUNT(*)::int
          FROM leads l
          WHERE l.assigned_rep_id = p.id
            AND l.batch_date = v_today
            AND l.status <> 'Not Interested'
        ), 0
      ) AS today_count
    FROM profiles p
    WHERE p.role = 'rep' AND p.is_active = TRUE
  ) sub;

  v_num_reps := COALESCE(array_length(v_rep_ids, 1), 0);

  IF v_num_reps = 0 THEN
    RETURN;
  END IF;

  -- ===========================================================
  -- PASS 2: Niche-partitioned even distribution (step 3 rewrite)
  --
  -- For each distinct niche in the unassigned pool:
  --   • Reset the round-robin cursor to rep 0 (by id order).
  --   • Deal each lead (oldest first) to the next rep with capacity,
  --     skipping full reps. If all reps are full, stop this niche.
  --
  -- Invariant: within each niche, any two reps differ by at most 1 lead.
  -- Example: 10 roofing + 5 reps each needing ≥2 = 2 each.
  --
  -- NULL niche is treated as its own bucket (IS NOT DISTINCT FROM NULL).
  -- ===========================================================
  FOR v_niche IN
    SELECT DISTINCT lower(niche) AS n
    FROM leads
    WHERE assigned_rep_id IS NULL
      AND status = 'New'
      AND batch_date IS NULL
    ORDER BY 1 NULLS LAST
  LOOP
    v_rep_idx := 0;  -- reset cursor for each niche bucket

    FOR v_lead_id IN
      SELECT id
      FROM leads
      WHERE assigned_rep_id IS NULL
        AND status = 'New'
        AND batch_date IS NULL
        AND lower(niche) IS NOT DISTINCT FROM v_niche
      ORDER BY created_at
    LOOP
      -- Find next rep with capacity; skip full reps.
      v_dealt    := FALSE;
      v_attempts := 0;

      LOOP
        IF v_attempts >= v_num_reps THEN
          EXIT;  -- every rep is full; no point continuing
        END IF;

        IF v_rep_needed[v_rep_idx + 1] > 0 THEN
          -- Assign lead to this rep
          UPDATE leads
          SET assigned_rep_id = v_rep_ids[v_rep_idx + 1],
              batch_date       = v_today
          WHERE id = v_lead_id;

          v_rep_needed[v_rep_idx + 1] := v_rep_needed[v_rep_idx + 1] - 1;
          v_rep_idx := (v_rep_idx + 1) % v_num_reps;
          v_dealt   := TRUE;
          EXIT;
        ELSE
          -- This rep is full; advance to next
          v_rep_idx  := (v_rep_idx + 1) % v_num_reps;
          v_attempts := v_attempts + 1;
        END IF;
      END LOOP;

      IF NOT v_dealt THEN
        EXIT;  -- all reps full; leave remaining niche leads in pool
      END IF;
    END LOOP;
  END LOOP;

  -- ===========================================================
  -- PASS 3: Per-rep fallbacks and safety trim (steps 4, 5, 6)
  -- Only touches a rep's OWN leads — no cross-rep contention.
  -- Niche filter removed: fallback pulls own leads regardless of niche.
  --
  -- Exclusion list (046): 'No Answer' and 'Follow-Up' added alongside
  -- 'Not Interested' and 'Appointment Booked' — those two statuses
  -- already have their own dedicated requeue timers (017/019/025) and
  -- should not be pulled forward early just to pad out a short batch.
  -- ===========================================================
  FOR i IN 1..v_num_reps LOOP
    -- Step 4: Re-surface this rep's recently-worked leads if still under cap
    IF v_rep_needed[i] > 0 THEN
      UPDATE leads
      SET batch_date = v_today
      WHERE assigned_rep_id = v_rep_ids[i]
        AND batch_date IS DISTINCT FROM v_today
        AND status NOT IN ('Not Interested', 'Appointment Booked', 'No Answer', 'Follow-Up')
        AND id IN (
          SELECT id FROM leads
          WHERE assigned_rep_id = v_rep_ids[i]
            AND batch_date IS DISTINCT FROM v_today
            AND status NOT IN ('Not Interested', 'Appointment Booked', 'No Answer', 'Follow-Up')
          ORDER BY updated_at DESC
          LIMIT v_rep_needed[i]
        );
    END IF;

    -- Step 6: Safety trim — push any excess 'New' leads to tomorrow
    UPDATE leads
    SET batch_date = v_today + 1
    WHERE assigned_rep_id = v_rep_ids[i]
      AND batch_date = v_today
      AND status = 'New'
      AND id NOT IN (
        SELECT id FROM leads
        WHERE assigned_rep_id = v_rep_ids[i]
          AND batch_date = v_today
        ORDER BY created_at
        LIMIT batch_size
      );
  END LOOP;

  -- Return final batch counts per rep
  RETURN QUERY
  SELECT l.assigned_rep_id, COUNT(l.id)::int AS batch_count
  FROM leads l
  WHERE l.batch_date = v_today
    AND l.assigned_rep_id = ANY(v_rep_ids)
  GROUP BY l.assigned_rep_id;

END;
$$;
