import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { LESSONS } from './lessons.js'
import { emptyProgress, lessonStates, summary, scoreCheck, recordAttempt, assignLesson, resetLesson } from './model.js'

// P872 — training progress and lesson edits, sample only (this browser). One store, so the rail badge, the Overview
// nudge, the Training page and admin Settings → Training all agree. P852 swaps this for the database: progress per
// VA, the admin's assign/reset and lesson edits (versioned). Keyed by the VA's name for now (sample VAs share names
// across the VA and admin previews, so an admin sees what "Maya" did). A name we have no sample for starts fresh.

const KEY = 'ful-training:v1'
const allRight = id => { const l = LESSONS.find(x => x.id === id); return scoreCheck(l, l.check.map(c => c.answer)) }
const passFirst = (n, extra = p => p) => extra(LESSONS.slice(0, n).reduce((p, l) => recordAttempt(p, l.id, allRight(l.id), '2026-11-02T15:00:00Z'), emptyProgress))
const SEED = {
  'Maya Brooks': passFirst(4),
  'Andre Lewis': passFirst(LESSONS.length),
  'Keisha Grant': passFirst(9, p => assignLesson(recordAttempt(p, LESSONS[9].id, { correct: 2, total: LESSONS[9].check.length, pass: false }, '2026-11-05T19:10:00Z'), 'optout')),
  'Rosa Diaz': emptyProgress,
}
export const TRAINEES = Object.keys(SEED)

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && raw.people && raw.edits) return raw
  } catch { /* no storage or bad JSON: start from the sample */ }
  return { people: {}, edits: {} }
}
let state = load()
const subs = new Set()
function set(next) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* private window: it lasts this visit */ }
  subs.forEach(f => f())
}
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
const snap = () => state
const progressOf = name => state.people[name] || SEED[name] || emptyProgress
const putProgress = (name, p) => set({ ...state, people: { ...state.people, [name]: p } })

// Lessons with the admin's edits on top (title, job, why, steps). Edits are sample until P852.
export function mergeEdits(edits) {
  return LESSONS.map(l => (edits[l.id] ? { ...l, ...edits[l.id], edited: true } : l))
}
export function useLessons() {
  const s = useSyncExternalStore(subscribe, snap)
  return useMemo(() => mergeEdits(s.edits), [s.edits])
}

export function useTraining(name) {
  const s = useSyncExternalStore(subscribe, snap)
  const progress = s.people[name] || SEED[name] || emptyProgress
  const states = useMemo(() => lessonStates(progress), [progress])
  const sum = useMemo(() => summary(progress), [progress])
  const submit = useCallback((id, answers) => {
    const l = LESSONS.find(x => x.id === id)
    const result = scoreCheck(l, answers)
    putProgress(name, recordAttempt(progressOf(name), id, result))
    return result
  }, [name])
  return { progress, states, sum, submit }
}

export function useTrainingAdmin() {
  const s = useSyncExternalStore(subscribe, snap)
  const people = useMemo(() => TRAINEES.map(name => {
    const p = s.people[name] || SEED[name]
    return { name, progress: p, states: lessonStates(p), sum: summary(p) }
  }), [s.people])
  return {
    people,
    edits: s.edits,
    assign: (name, id) => putProgress(name, assignLesson(progressOf(name), id)),
    reset: (name, id) => putProgress(name, resetLesson(progressOf(name), id)),
    resetAll: name => putProgress(name, emptyProgress),
    saveEdit: (id, patch) => set({ ...state, edits: { ...state.edits, [id]: { ...(state.edits[id] || {}), ...patch } } }),
    dropEdit: id => { const rest = { ...state.edits }; delete rest[id]; set({ ...state, edits: rest }) },
  }
}
