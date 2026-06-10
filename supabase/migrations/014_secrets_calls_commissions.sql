-- ============================================================
-- Migration 014: secrets table, calls update, commissions, pg_cron
-- ============================================================

-- Enable pgcrypto for UUID helpers (already available in Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Secrets table ─────────────────────────────────────────────────────────────
-- Stores encrypted API keys/credentials managed via admin UI.
-- fetch-secrets Edge Function handles AES-256-GCM encryption/decryption.
-- Edge Functions prefer env vars; secrets table is fallback + audit trail.

CREATE TABLE IF NOT EXISTS secrets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name        text        NOT NULL UNIQUE,
  encrypted_value text        NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  audit_log       jsonb       NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "secrets_admin_only" ON secrets
  FOR ALL USING (public.is_admin());

CREATE OR REPLACE TRIGGER secrets_updated_at
  BEFORE UPDATE ON secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Calls table updates ───────────────────────────────────────────────────────
-- Existing: id, lead_id, rep_id, duration_seconds, outcome, created_at
-- Adding: call_notes, recording_url, call_outcome, retell_call_id, updated_at

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS call_notes      text,
  ADD COLUMN IF NOT EXISTS recording_url   text,
  ADD COLUMN IF NOT EXISTS retell_call_id  text,
  ADD COLUMN IF NOT EXISTS call_outcome    text
    CHECK (call_outcome IN ('interested','not_interested','callback','no_answer','voicemail')),
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- Update RLS on calls: reps see own, closers/admin see all
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'calls' AND policyname = 'calls_rep_own'
  ) THEN
    CREATE POLICY "calls_rep_own" ON calls
      FOR ALL USING (
        rep_id = auth.uid() OR
        public.is_admin() OR
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'closer')
      );
  END IF;
END $$;

-- Trigger: on call insert → update lead.updated_at
CREATE OR REPLACE FUNCTION on_call_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE leads SET updated_at = now() WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_update_lead ON calls;
CREATE TRIGGER calls_update_lead
  AFTER INSERT ON calls
  FOR EACH ROW EXECUTE FUNCTION on_call_insert();

-- ─── Commissions table ─────────────────────────────────────────────────────────
-- Commission logic:
--   Setter (rep):   50% of setup fee → $248.50 per close
--   Closer:         50% setup + 50% recurring MRR
--   Admin (Brayden): 0% setup + 50% recurring MRR

CREATE TABLE IF NOT EXISTS commissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_role  text        NOT NULL CHECK (recipient_role IN ('rep','closer','admin')),
  lead_id         uuid        REFERENCES leads(id) ON DELETE SET NULL,
  appointment_id  uuid        REFERENCES appointments(id) ON DELETE SET NULL,
  commission_type text        NOT NULL CHECK (commission_type IN ('setup','recurring')),
  tier            text,
  tier_amount     numeric(10,2),
  amount          numeric(10,2) NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','voided')),
  paid_at         timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commissions_select" ON commissions
  FOR SELECT USING (
    recipient_id = auth.uid() OR
    public.is_admin() OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'closer')
  );

CREATE POLICY "commissions_write_admin" ON commissions
  FOR ALL USING (public.is_admin());

CREATE OR REPLACE TRIGGER commissions_updated_at
  BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── pg_cron: daily batch at 9 AM UTC ─────────────────────────────────────────
-- Requires pg_cron extension (enable in Supabase: Extensions → pg_cron)
-- Then run this once after enabling:
--
-- SELECT cron.schedule(
--   'assign-daily-batch',
--   '0 9 * * *',
--   $$
--     SELECT net.http_post(
--       url        := current_setting('app.supabase_url') || '/functions/v1/assign-daily-batch',
--       headers    := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key')
--       ),
--       body       := '{}'::jsonb
--     )
--   $$
-- );
--
-- Verify: SELECT * FROM cron.job;
