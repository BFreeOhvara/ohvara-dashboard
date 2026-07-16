-- Migration 068 — Prompt 283: per-rep flashcard mastery + timezone-confirmed
-- tracking.
--
-- 1. Flashcard mastery bug (confirmed, not guessed): FlashcardDeck
--    (TrainingCenter.jsx) tracked "mastered" cards purely in an unscoped
--    localStorage key (ohvara_flashcard_mastered) — no user_id/rep_id
--    scoping, no DB row at all. Every other training field (videos_watched,
--    quiz_passed_at, roleplay, final_exam_passed_at) is DB-backed per rep_id
--    via training_progress; flashcards was the one outlier still 100%
--    localStorage. A brand-new invite-flow account (John Scott, Prompt 283)
--    opened Training Center on a browser previously used to test flashcards
--    and found all 48 cards already "mastered" — the browser's localStorage,
--    not the account, held the mastery state. Adds a training_progress
--    column so mastery is per-rep like everything else.
--
-- 2. Timezone-confirmed tracking: profiles.timezone (042) defaults every row
--    to 'America/Chicago' with NOT NULL — there's no way to tell "rep
--    genuinely is in Central" from "rep has never touched Settings". Adds
--    timezone_confirmed_at, backfilled to created_at for every existing
--    profile (already-known-good), left NULL going forward until a rep
--    explicitly saves Settings > Regional. MyLeads swaps the header clock
--    for a "Select Time Zone and Settings" prompt while this is NULL.

alter table training_progress
  add column if not exists flashcards_mastered jsonb not null default '[]'::jsonb;

alter table profiles
  add column if not exists timezone_confirmed_at timestamptz;

update profiles set timezone_confirmed_at = created_at where timezone_confirmed_at is null;
