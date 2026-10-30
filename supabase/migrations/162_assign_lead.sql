-- 162 — assign_lead: superseded, now a replay-safe no-op.
--
-- The earlier body of this file stopped a clean replay: its first statement
-- raised '162 needs 161, 166, 169 and 171 applied first', but 169 and 171 are
-- not in this repo (176_prepaid_lead_ledger replaced them) and 166 numbers
-- after 162, so `supabase db reset` failed here on a clean database. Its
-- trigger also used leads.lead_type, which 166 adds later.
--
-- Everything this file used to define is owned by a later migration:
--   public.assign_lead(uuid)            173_lead_storage_assignment (no charge)
--   public.leads_typed_agents_only()    173_lead_storage_assignment
--   trigger leads_typed_agents_only     173_lead_storage_assignment
--   agent_lead_ledger, charge_lead      176_prepaid_lead_ledger
--
-- Same approach as 091: nothing is created, changed, dropped or deleted, so
-- this file is safe on a clean database and on one where the old 162 (or 173)
-- already ran. A database that already has the old 162 objects keeps them.

select 1;
