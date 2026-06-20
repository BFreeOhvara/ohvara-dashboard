-- 038_demo_client_provisioning.sql
-- Prompt 7/8: auto-provision a real, logged-in-able demo client account the
-- moment a rep books an appointment, so Nate can walk the prospect through
-- their actual (sample-data) dashboard live on the close call. Converts to a
-- real account on close, gets deleted on lost.

-- clients.status already exists (012) with onboarding/active/paused/churned —
-- add 'demo' (pre-close, sample data) and 'lost' (deal fell through, account
-- about to be deleted — transient, but worth a real value during the delete).
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE clients ADD CONSTRAINT clients_status_check
  CHECK (status IN ('demo','onboarding','active','paused','churned','lost'));

-- Traceability back to the lead that spawned the demo, and a snapshot of the
-- AI-generated automations (leads.recommended_automations is the live/latest
-- copy; this is what the demo account itself shows — stays stable even if
-- the lead's cached rec is later regenerated).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recommended_automations jsonb;

CREATE INDEX IF NOT EXISTS idx_clients_lead_id ON clients (lead_id);

-- Links a pending appointment to its demo client + the temp login Nate shows
-- the prospect. Both cleared on close (converted, no longer "demo") or lost
-- (deleted).
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS demo_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS demo_credentials jsonb;
