-- 034_discovery_fields.sql
-- Structured discovery inputs + cached à la carte recommendation on leads.
-- Additive: free-text Call Notes (leads.notes) are preserved and unchanged.
-- calls_missed_per_week / avg_ticket are the structured counterparts to what
-- the rep captures in the call script's Branch A questions.
-- recommended_stack / custom_monthly_price / stack_generated_at are written
-- by CallModal fire-and-forget when the rep books, so Nate's AppointmentCard
-- can use the full cached recommendation without an API round-trip.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS calls_missed_per_week  numeric,
  ADD COLUMN IF NOT EXISTS avg_ticket              numeric;

-- Full rec object cached at booking time for instant load in closer panel
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS recommended_automations jsonb,
  ADD COLUMN IF NOT EXISTS custom_monthly_price    numeric,
  ADD COLUMN IF NOT EXISTS recommended_stack       jsonb,
  ADD COLUMN IF NOT EXISTS stack_generated_at      timestamptz;
