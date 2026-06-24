-- Migration 054 — Closer self-assign leads RPC
--
-- Closers can UPDATE any lead (leads_rep_update policy), but their SELECT
-- policy only covers leads where assigned_closer_id = auth.uid(). They
-- cannot SELECT from the unassigned pool to know which IDs to update.
--
-- This SECURITY DEFINER function bypasses RLS inside the function body,
-- picks the oldest N unassigned leads (assigned_closer_id IS NULL),
-- assigns them to the caller, and returns the count actually assigned.
-- The cap is enforced server-side at 500 regardless of what p_count says.
--
-- ⚠️ ASSUMPTION (Brayden must confirm): "unassigned" means
--    assigned_closer_id IS NULL; ordering is oldest-first (created_at ASC).
--    If the source pool should be filtered differently (e.g. only leads reps
--    already touched, only a specific niche, etc.) update the WHERE clause here.

CREATE OR REPLACE FUNCTION request_closer_leads(p_closer_id uuid, p_count int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Hard cap at 500
  p_count := LEAST(GREATEST(p_count, 0), 500);

  UPDATE leads
  SET assigned_closer_id = p_closer_id
  WHERE id IN (
    SELECT id
    FROM leads
    WHERE assigned_closer_id IS NULL
    ORDER BY created_at ASC
    LIMIT p_count
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Only authenticated users can call this function (RLS still scopes the final
-- SELECT results when the closer then reads their assigned leads).
GRANT EXECUTE ON FUNCTION request_closer_leads(uuid, int) TO authenticated;
