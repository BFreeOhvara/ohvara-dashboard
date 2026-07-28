-- Prompt 379 Bug B: "Admins manage notifications" (migration 012) is FOR ALL
-- with no profile_id restriction, layered on top of "Reps read own
-- notifications" (migration 043, profile_id = auth.uid()). Postgres OR's RLS
-- policies together, so any admin's SELECT returned every user's rows —
-- Brayden's bell showed all 4 team-channel fan-out notifications from one
-- message instead of just his own.
--
-- migration 012's intent was admin write access for the old client-onboarding
-- notifications flow, not "admin can read everyone's bell." No surviving code
-- path needs admin to read/write another user's notification row directly —
-- the team-chat/deal-closed fan-out inserts (migrations 043/047/084) all run
-- through SECURITY DEFINER trigger functions, which bypass RLS entirely and
-- are unaffected by this change.
--
-- Split the ALL policy into three non-SELECT policies so plain SELECT falls
-- through to "Reps read own notifications" for every role, admin included.
DROP POLICY IF EXISTS "Admins manage notifications" ON notifications;

CREATE POLICY "Admins insert notifications" ON notifications FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "Admins update notifications" ON notifications FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "Admins delete notifications" ON notifications FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
