-- 039_tiered_stack_structure.sql
-- Prompt 10: replace the flat automations list with a two-tier hierarchy —
-- 1-2 front-runner agents (solve the core problem) + 1-5 sub-agents
-- (complement the front-runners). recommended_automations stays in place on
-- both tables as the combined (front_runners + sub_agents) list for backward
-- compat with any code/data still reading the flat array.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS front_runner_agents jsonb,
  ADD COLUMN IF NOT EXISTS sub_agents           jsonb;

-- clients has no cached "full rec" object (leads.recommended_stack is
-- leads-only) — recommended_automations is its only persisted automations
-- field, so it needs the same split columns for the client portal to render
-- the front-runner/sub-agent hierarchy.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS front_runner_agents jsonb,
  ADD COLUMN IF NOT EXISTS sub_agents           jsonb;
