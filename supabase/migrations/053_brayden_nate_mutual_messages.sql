-- Migration 053 — Brayden ↔ Nate mutual messaging
--
-- Previously, admin saw only messages where recipient='brayden', and closer
-- saw only messages where recipient='nate'. Neither could see their own
-- sent messages to the other.
--
-- This migration extends the SELECT policies so:
--   • Admin (Brayden) also sees rows where sender_id = auth.uid() AND recipient = 'nate'
--     → Brayden's own sent messages to Nate appear in his Messages inbox.
--   • Closer (Nate) also sees rows where sender_id = auth.uid() AND recipient = 'brayden'
--     → Nate's own sent messages to Brayden appear in his Messages inbox.
--
-- No INSERT policy changes needed — messages_insert_own (sender_id = auth.uid())
-- already allows both to send to each other's recipient bucket.
-- No UPDATE policy changes needed — admin can already UPDATE recipient='brayden'
-- rows (to reply to Nate's messages in admin's inbox), and closer can UPDATE
-- recipient='nate' rows (to reply to Brayden's messages in closer's inbox).

-- Admin inbox: all messages to Brayden OR Brayden's own sent to Nate
DROP POLICY IF EXISTS "messages_select_admin_inbox" ON messages;
CREATE POLICY "messages_select_admin_inbox" ON messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    AND (
      recipient = 'brayden'
      OR (recipient = 'nate' AND sender_id = auth.uid())
    )
  );

-- Closer inbox: all messages to Nate OR Nate's own sent to Brayden
DROP POLICY IF EXISTS "messages_select_closer_inbox" ON messages;
CREATE POLICY "messages_select_closer_inbox" ON messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'closer')
    AND (
      recipient = 'nate'
      OR (recipient = 'brayden' AND sender_id = auth.uid())
    )
  );
