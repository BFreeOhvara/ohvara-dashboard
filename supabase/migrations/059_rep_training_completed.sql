-- Add training_completed flag to profiles.
-- Set to true when a rep completes all flashcards in TrainingCenter.
-- Used to gate leads and fire the leads_unlocked notification on first batch.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS training_completed boolean NOT NULL DEFAULT false;
