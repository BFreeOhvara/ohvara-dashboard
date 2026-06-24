-- Migration 052: AI call grading pipeline
--
-- Adds recording + grading fields to the calls table and enables realtime
-- so CallModal can subscribe to live grade updates.
--
-- DO NOT run supabase db push — apply via SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Recording and transcript fields
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS twilio_recording_sid  text,
  ADD COLUMN IF NOT EXISTS twilio_recording_url  text,
  ADD COLUMN IF NOT EXISTS transcript            text,
  ADD COLUMN IF NOT EXISTS grade                 text,        -- F, D, C, C+, B-, B, B+, A-, A, A+
  ADD COLUMN IF NOT EXISTS feedback_good         text,
  ADD COLUMN IF NOT EXISTS feedback_improve      text,
  ADD COLUMN IF NOT EXISTS graded_at             timestamptz;

-- Index for webhook lookup: twilio_call_sid → calls row
CREATE INDEX IF NOT EXISTS idx_calls_twilio_call_sid ON calls (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;

-- Enable realtime so CallModal can subscribe to grade updates in real time.
-- If the table is already in the publication this is a no-op.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE calls;
  END IF;
END $$;
