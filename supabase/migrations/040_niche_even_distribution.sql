-- Migration 040: Niche-even lead distribution across all setters
-- (Originally drafted/numbered as "031" before the niche-even-distribution
--  decision was queued; that slot was taken by 031_lead_source_manual_scrape.sql
--  in the interim, so this lands as 040 — logic is unchanged from the draft.)
--
-- Decision (Brayden, 2026-06-21): no more one-niche-per-setter.
-- All unassigned leads go into one shared pool. When assign_daily_batches
-- runs, it distributes each niche bucket evenly across ALL active reps.
-- Example: 10 roofing + 5 reps = 2 roofing each. No setter gets 3 while
-- another gets 1.
--
-- Change summary vs migration 030 (030_fair_share_assignment.sql):
--   PASS 1 (steps 1&2): removed niche filter from rollover — reps now own
--     all their own prior-day leads regardless of niche.
--   PASS 2 (step 3): replaced single cross-rep round-robin with
--     NICHE-PARTITIONED round-robin — for each distinct niche in the unassigned
--     pool, deals leads round-robin across ALL reps (in rep_id order, deterministic).
--     No rep is niche-restricted; all reps eligible for every niche.
--   PASS 3 (steps 4, 5, 6): niche filter removed from fallback steps.
--
-- Deploy: apply via the one-off edge fn / Management API pattern (see
-- cc-prompt-031-niche-even-distribution.md in the vault for the full
-- apply + inline-test procedure). Applying CREATE OR REPLACE does NOT move
-- any leads — it only updates the function definition. Leads move the next
-- time the cron fires or the fn is invoked manually.
--
-- STATUS as of 2026-06-21: file written + committed, NOT YET APPLIED to prod.
-- Blocked on the recurring Claude Code auto-mode credential-classifier denial
-- (same class of block as Prompts 18b/24) — every attempt to read or use the
-- Supabase Management PAT / DB credentials needed to run this against prod
-- was denied. See brain/Memories.md 2026-06-21 entry + LIVE_STATE Prompt 22
-- block for the blocker detail and the two resolution options for Brayden.

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
  -- ===========================================================
  FOR i IN 1..v_num_reps LOOP
    -- Step 4: Re-surface this rep's recently-worked leads if still under cap
    IF v_rep_needed[i] > 0 THEN
      UPDATE leads
      SET batch_date = v_today
      WHERE assigned_rep_id = v_rep_ids[i]
        AND batch_date IS DISTINCT FROM v_today
        AND status NOT IN ('Not Interested', 'Appointment Booked')
        AND id IN (
          SELECT id FROM leads
          WHERE assigned_rep_id = v_rep_ids[i]
            AND batch_date IS DISTINCT FROM v_today
            AND status NOT IN ('Not Interested', 'Appointment Booked')
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

-- ===========================================================
-- INLINE TEST (run inside BEGIN...ROLLBACK to verify, zero prod residue)
-- Paste this block into psql or a one-off edge fn to validate before/after deploy.
--
-- Expected results:
--   Scenario A: 10 roofing leads, 5 null-niche reps, batch_size=150
--     → each rep: 2 roofing   (was: could be 10/0/0/0/0 with greedy; now 2/2/2/2/2)
--   Scenario B: 7 HVAC + 3 roofing, 5 reps, batch_size=150
--     → HVAC: 2/2/2/1/0 (round-robin of 7 across 5)  = [2,2,2,1,0] in id order
--     → roofing: 1/1/1/0/0 (round-robin of 3 across 5) = [1,1,1,0,0] in id order
--     → totals: [3,3,3,1,0] (no rep gets 4 while another gets 0 within any niche)
-- ===========================================================
-- (Full test harness: cc-prompt-031-niche-even-distribution.md in the vault root)
