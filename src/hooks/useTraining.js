import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { FLASHCARDS } from '../data/flashcards'

// Rep onboarding gate — leads stay locked until all four pass:
//   1. all 8 training videos watched
//   2. all flashcards mastered (Prompt 304 — Brayden's explicit call to make
//      this a real requirement, not just tracked/display-only)
//   3. final exam at 85%+
//   4. AI roleplay graded B+ or better by Claude (9+ on the 12-point scale)
export const TOTAL_VIDEOS        = 8
export const QUIZ_QUESTIONS      = 20
export const QUIZ_PASS_PCT       = 85
export const ROLEPLAY_PASS_SCORE = 9   // B+ on the 0-12 scoring scale
export const ROLEPLAY_PASS_GRADE = 'B+'
export const TOTAL_FLASHCARDS    = FLASHCARDS.length

// 12-point roleplay score → letter grade
export function gradeFromScore(total) {
  if (total >= 12) return 'A+'
  if (total >= 11) return 'A'
  if (total >= 10) return 'A-'
  if (total >= 9)  return 'B+'
  if (total >= 8)  return 'B'
  if (total >= 7)  return 'B-'
  if (total >= 6)  return 'C+'
  if (total >= 5)  return 'C'
  if (total >= 4)  return 'C-'
  return 'D'
}

export function trainingChecks(progress) {
  const videosWatched = Array.isArray(progress?.videos_watched) ? progress.videos_watched.length : 0
  const flashcardsMastered = Array.isArray(progress?.flashcards_mastered) ? progress.flashcards_mastered.length : 0
  return {
    videosWatched,
    videosDone:      videosWatched >= TOTAL_VIDEOS,
    // Prompt 304: Brayden's explicit call (flashcards was tracked but not
    // gating anything as of Prompt 303) — same completion condition
    // TrainingCenter.jsx already used locally for its own optimistic
    // flashcardsMastered flag.
    flashcardsMastered,
    flashcardsDone:  flashcardsMastered >= TOTAL_FLASHCARDS,
    // Prompt 303: was named quizDone and read `quiz_passed_at`, a field
    // only the orphaned 20-question QuizTab (TrainingCenter.jsx, never
    // mounted by any tab) ever wrote. The live final-exam flow
    // (FinalQuizTab, the 'final-exam' tab) writes `final_exam_passed_at`
    // instead — so this check could never become true through any
    // reachable UI, meaning no rep could ever actually clear the gate no
    // matter how much training they finished. Renamed to match what it
    // actually checks and reads the field the real flow writes.
    finalExamDone:   !!progress?.final_exam_passed_at,
    roleplayDone:    !!progress?.roleplay_passed_at,
  }
}

export function isTrainingComplete(progress) {
  // Prompt 304: grandfather reps who already unlocked under an earlier,
  // looser version of this gate (e.g. before flashcards became a real
  // requirement) — `unlocked_at` is a one-way stamp set the first time a
  // rep clears the gate (see useSaveTrainingProgress below), so once it's
  // set a rep stays unlocked even if the requirements tighten later.
  // Confirmed live in prod: one rep unlocked 2026-06-11 under the old
  // 3-check gate has 0/48 flashcards mastered — without this bypass,
  // shipping the new flashcards requirement would have silently re-locked
  // their already-working leads.
  if (progress?.unlocked_at) return true
  const c = trainingChecks(progress)
  return c.videosDone && c.flashcardsDone && c.finalExamDone && c.roleplayDone
}

export function useTrainingProgress() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['training', profile?.id],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_progress')
        .select('*')
        .eq('rep_id', profile.id)
        .maybeSingle()
      if (error) throw error
      return data // null until the rep's first training action
    },
    enabled: !!profile?.id && profile?.role === 'rep',
  })
}

// Merge a patch into the rep's training row (insert on first touch).
// Stamps unlocked_at automatically the moment all three checks pass.
export function useSaveTrainingProgress() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: async (patch) => {
      const { data: existing } = await supabase
        .from('training_progress')
        .select('*')
        .eq('rep_id', profile.id)
        .maybeSingle()

      const merged = { ...(existing || {}), ...patch, rep_id: profile.id, updated_at: new Date().toISOString() }
      if (!merged.unlocked_at && isTrainingComplete(merged)) {
        merged.unlocked_at = new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('training_progress')
        .upsert(merged, { onConflict: 'rep_id' })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training'] })
    },
  })
}
