-- 037_problem_first_pricing.sql
-- Prompt 5: problem-first custom stack + pricing overhaul.
-- primary_pain / current_setup are new structured discovery fields (the
-- script's "what's costing you most" + "what do you have today" questions).
-- secondary_pain intentionally folds into the existing free-text pain_points
-- column rather than getting its own column (per the prompt spec).
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS primary_pain   text,
  ADD COLUMN IF NOT EXISTS current_setup  text;

-- Setup fee dropped $497 -> $297 with the pivot to formula pricing.
ALTER TABLE clients
  ALTER COLUMN setup_fee SET DEFAULT 297;
