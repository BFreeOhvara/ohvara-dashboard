-- Migration 012: clients, onboarding, notifications tables
-- Supports: provision-client Edge Function, admin notification bell, client portal onboarding flow

-- ─── Clients ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name    TEXT        NOT NULL,
  owner_name       TEXT,
  owner_email      TEXT,
  business_phone   TEXT,
  niche            TEXT,
  location         TEXT,
  tier             TEXT        NOT NULL CHECK (tier IN ('basic','pro','premium','elite')),
  status           TEXT        NOT NULL DEFAULT 'onboarding'
                               CHECK (status IN ('onboarding','active','paused','churned')),
  monthly_value    NUMERIC,
  setup_fee        NUMERIC     DEFAULT 497,
  retell_agent_id  TEXT,
  twilio_number    TEXT,
  portal_url       TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'clients_updated_at'
  ) THEN
    CREATE TRIGGER clients_updated_at
      BEFORE UPDATE ON clients
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─── Onboarding ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tier         TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending_info'
                           CHECK (status IN ('pending_info','in_progress','completed')),
  questions    JSONB,
  answers      JSONB,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── Notifications ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  data       JSONB,
  read       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Appointments: add closed_tier, closed_at columns ─────────────────────────

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS closed_tier TEXT,
  ADD COLUMN IF NOT EXISTS closed_at   TIMESTAMPTZ;

-- ─── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE clients       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Clients: admins full access, closers read-only
CREATE POLICY IF NOT EXISTS "Admins manage clients"
  ON clients FOR ALL
  USING (get_my_role() = 'admin');

CREATE POLICY IF NOT EXISTS "Closers view clients"
  ON clients FOR SELECT
  USING (get_my_role() IN ('admin', 'closer'));

-- Onboarding: admins full access
CREATE POLICY IF NOT EXISTS "Admins manage onboarding"
  ON onboarding FOR ALL
  USING (get_my_role() = 'admin');

-- Notifications: admins full access
CREATE POLICY IF NOT EXISTS "Admins manage notifications"
  ON notifications FOR ALL
  USING (get_my_role() = 'admin');

-- ─── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_clients_status    ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_tier      ON clients (tier);
CREATE INDEX IF NOT EXISTS idx_onboarding_client ON onboarding (client_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (read, created_at DESC);
