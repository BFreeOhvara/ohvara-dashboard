-- Migration 056 — Update request_closer_leads: current-count-aware 500 cap + scope fix
--
-- Changes from 054:
-- 1. CAP is now against the closer's CURRENT total lead count, not just the request amount.
--    e.g. if they hold 300 leads, they can request at most 200 more. If at 500, returns 0.
-- 2. WHERE clause adds `AND assigned_rep_id IS NULL` so only truly unassigned leads
--    (neither rep nor closer has claimed them) are eligible — matches the admin
--    "Unassigned" pool.
--
-- DO NOT run supabase db push — apply via Supabase SQL editor.

CREATE OR REPLACE FUNCTION request_closer_leads(p_closer_id uuid, p_count int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count int;
  v_allowed       int;
  v_assigned      int;
BEGIN
  -- How many leads does this closer already hold?
  SELECT COUNT(*) INTO v_current_count
  FROM leads
  WHERE assigned_closer_id = p_closer_id;

  -- Remaining capacity (hard cap at 500 total).
  v_allowed := GREATEST(0, 500 - v_current_count);
  p_count   := LEAST(GREATEST(p_count, 0), v_allowed);

  IF p_count = 0 THEN
    RETURN 0;
  END IF;

  UPDATE leads
  SET assigned_closer_id = p_closer_id
  WHERE id IN (
    SELECT id
    FROM leads
    WHERE assigned_closer_id IS NULL
      AND assigned_rep_id IS NULL
    ORDER BY created_at ASC
    LIMIT p_count
  );

  GET DIAGNOSTICS v_assigned = ROW_COUNT;
  RETURN v_assigned;
END;
$$;

GRANT EXECUTE ON FUNCTION request_closer_leads(uuid, int) TO authenticated;
