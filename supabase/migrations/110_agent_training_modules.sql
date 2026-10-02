-- Agent Training tab (Prompt 670).
--
-- Reuses training_progress (migration 020) instead of a new table. It held
-- the pre-pivot setter onboarding gate and has been empty since the pivot
-- cleanup; one row per user, keyed by rep_id = auth.uid(), already
-- self-writable through tp_rep_own.
--
-- 1. modules_completed — ids of the agent training modules a user has marked
--    done (src/data/agentTraining.js). unlocked_at (existing) is stamped when
--    the last one is done. The old setter columns (videos_watched, quiz_*,
--    roleplay_*, flashcards_mastered, video_positions) are left alone, unused.
--
-- 2. tp_staff_select let role 'admin' OR 'agent' read every row. 'agent' was
--    the old closer/staff role before migration 107's rename; agents are now
--    the people being trained, so they'd see each other's progress. Admin only.

alter table training_progress
  add column if not exists modules_completed jsonb not null default '[]'::jsonb;

drop policy if exists tp_staff_select on training_progress;
create policy tp_admin_select on training_progress
  for select using (public.is_admin());
