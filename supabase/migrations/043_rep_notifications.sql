-- Migration 043: Per-rep notification bell
--
-- Extends the existing notifications table (from 012) to support rep-facing
-- notifications: message replies, badge unlocks, and follow-up reminders.
--
-- Changes:
--   1. Add profile_id to scope notifications to a specific rep
--   2. Add badge_id for idempotent badge notification upserts
--   3. Add RLS policies so reps read/write only their own rows
--   4. Add DB trigger: reply added to a message → notification for the sender
--
-- DO NOT run supabase db push for this migration — apply via SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. New columns
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS badge_id TEXT;

-- 2. Unique constraint for badge dedup (one notification per badge per rep).
--    NULL profile_id or NULL badge_id rows are excluded from uniqueness — so
--    legacy admin notifications and non-badge rep notifications are unaffected.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_profile_badge_unique;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_profile_badge_unique
    UNIQUE (profile_id, badge_id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_profile
  ON notifications (profile_id, created_at DESC);

-- 4. RLS: reps can read, update (mark read), and insert their own notifications
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='Reps read own notifications') THEN
    CREATE POLICY "Reps read own notifications" ON notifications FOR SELECT
      USING (profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='Reps update own notifications') THEN
    CREATE POLICY "Reps update own notifications" ON notifications FOR UPDATE
      USING (profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='Reps insert own notifications') THEN
    CREATE POLICY "Reps insert own notifications" ON notifications FOR INSERT
      WITH CHECK (profile_id = auth.uid());
  END IF;
END $$;

-- 5. DB trigger: insert notification for rep when Brayden/Nate replies
--    SECURITY DEFINER so it works regardless of which role performs the UPDATE.
CREATE OR REPLACE FUNCTION notify_rep_on_message_reply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only fire when reply_body is newly set (wasn't present before)
  IF NEW.reply_body IS NOT NULL AND OLD.reply_body IS NULL THEN
    INSERT INTO notifications (profile_id, type, message, data)
    VALUES (
      NEW.sender_id,
      'message',
      'You received a reply to your message',
      jsonb_build_object(
        'message_id', NEW.id,
        'reply_preview', left(NEW.reply_body, 120)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'messages_reply_notify'
  ) THEN
    CREATE TRIGGER messages_reply_notify
      AFTER UPDATE ON messages
      FOR EACH ROW EXECUTE FUNCTION notify_rep_on_message_reply();
  END IF;
END $$;
