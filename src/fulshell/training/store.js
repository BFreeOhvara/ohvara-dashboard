import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { LESSONS } from './lessons.js'
import { fp } from '../../template/ful/paths.js'
import { emptyProgress, lessonStates, summary, scoreCheck, recordAttempt, recordTry, matchesTry, endsInQuiz, assignLesson, resetLesson } from './model.js'

// P872 — training progress and lesson edits, sample only (this browser). One store, so the rail badge, the Overview
// nudge, the Training page and admin Settings → Training all agree. P852 swaps this for the database: progress per
// VA, the admin's assign/reset and lesson edits (versioned). Keyed by the VA's name for now (sample VAs share names
// across the VA and admin previews, so an admin sees what "Maya" did). A name we have no sample for starts fresh.

const KEY = 'ful-training:v1'
const allRight = id => { const l = LESSONS.find(x => x.id === id); return scoreCheck(l, l.check.map(c => c.answer)) }
const AT = '2026-11-02T15:00:00Z'
const passFirst = (n, extra = p => p) => extra(LESSONS.slice(0, n).reduce((p, l) => (endsInQuiz(l) ? recordAttempt(p, l.id, allRight(l.id), AT) : recordTry(p, l.id, AT)), emptyProgress))
// P936: a VA takes calls only once training is complete, so every sample VA on a rota (the VA side's Maya, Leo, Sasha
// and Devon; admin's Maya, Andre, Keisha, Omar and Lily) has finished it. Rosa Diaz (invited, not on the team yet)
// hasn't started: she gets no calls until she finishes.
const ALL = () => passFirst(LESSONS.length)
const SEED = {
  'Maya Brooks': ALL(), 'Leo Grant': ALL(), 'Sasha Ortiz': ALL(), 'Devon Hale': ALL(),
  'Andre Lewis': ALL(), 'Keisha Grant': ALL(), 'Omar Haddad': ALL(), 'Lily Chen': ALL(),
  'Rosa Diaz': emptyProgress,
}
export const TRAINEES = Object.keys(SEED)
// Sample VAs watched the video of every lesson they finished (P877), so the admin view and the lesson list agree.
export const SEED_WATCHED = Object.fromEntries(TRAINEES.map(n => [n, Object.keys(SEED[n].results).filter(id => SEED[n].results[id].pass)]))

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && raw.people && raw.edits) return raw
  } catch { /* no storage or bad JSON: start from the sample */ }
  return { people: {}, edits: {} }
}
let state = load()

// P877 Try it: the lesson page sets `trying` ({ name, id }) and sends the VA to the page. The next press of that
// lesson's button anywhere in the portal (capture phase, so it is read before the click changes the screen) marks
// the lesson done. Sample only: P852 replaces this with the real event (the booking, the result, the request).
function onPress(e) {
  const tr = state.trying
  if (!tr) return
  const b = e.target?.closest?.('button')
  const l = LESSONS.find(x => x.id === tr.id)
  if (!b || !matchesTry(l, b.textContent)) return
  set({ ...state, trying: null, justTried: tr.id, people: { ...state.people, [tr.name]: recordTry(progressOf(tr.name), tr.id) } })
}
if (typeof document !== 'undefined') document.addEventListener('click', onPress, true)

// The Try it bar: a small bar at the bottom of every VA page while a Try it is on ("press Take it"), then "Done" for a
// few seconds. Plain DOM on purpose: the store runs outside any one screen, and the VA frame is not this lane's file.
let doneTimer = null
// fp() gives router paths; the preview's router sits under /template, so a plain pushState needs that prefix.
const go = url => {
  const base = window.location.pathname.startsWith('/template/') ? '/template' : ''
  window.history.pushState({}, '', base + url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
function paintBar() {
  if (typeof document === 'undefined') return
  let bar = document.getElementById('tr-tryit')
  const id = state.trying?.id || state.justTried
  const l = id && LESSONS.find(x => x.id === id)
  if (!l || !window.location.pathname.includes('/fulfillment')) { bar?.remove(); return }
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'tr-tryit'
    bar.className = 'tr-tryit'
    bar.setAttribute('role', 'status')
    bar.setAttribute('aria-live', 'polite')
    document.body.append(bar)
  }
  const lessonUrl = fp('training', l.id)
  bar.classList.toggle('is-done', !state.trying)
  bar.replaceChildren()
  const txt = document.createElement('span')
  const b = document.createElement('b')
  const act = (label, run, primary) => { const x = document.createElement('button'); x.type = 'button'; x.className = primary ? 'tp-primary fx-accent' : 'tp-btn ov-ghost'; x.textContent = label; x.addEventListener('click', run); return x }
  if (state.trying) {
    b.textContent = 'Try it: '
    txt.append(b, `press ${l.tryIt.button}. ${l.title}`)
    const back = act('Back to the lesson', () => go(lessonUrl))
    back.classList.add('tr-tryit-back')
    bar.append(txt, back, act('Stop', () => set({ ...state, trying: null })))
  } else {
    b.textContent = 'Done. '
    txt.append(b, `${l.title} is complete.`)
    bar.append(txt, act('Back to training', () => { set({ ...state, justTried: null }); go(fp('training')) }, true))
    clearTimeout(doneTimer)
    doneTimer = setTimeout(() => { if (state.justTried === l.id) set({ ...state, justTried: null }) }, 8000)
  }
}
if (typeof window !== 'undefined') { window.addEventListener('popstate', paintBar); setTimeout(paintBar, 0) }
const subs = new Set()
function set(next) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* private window: it lasts this visit */ }
  subs.forEach(f => f())
  paintBar()
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
  const trying = s.trying?.name === name ? s.trying.id : null
  const startTry = useCallback(id => set({ ...state, trying: { name, id }, justTried: null }), [name])
  const stopTry = useCallback(() => set({ ...state, trying: null }), [])
  return { progress, states, sum, submit, trying, justTried: s.justTried || null, startTry, stopTry }
}

// P936 — the training gate (lib/trainingGate): has this VA finished training? Read outside React by the pickers;
// useTrainedOf re-renders when anyone's progress changes.
export const isTrained = name => summary(progressOf(name)).complete
export function useTrainedOf() {
  const s = useSyncExternalStore(subscribe, snap)
  return useCallback(name => summary(s.people[name] || SEED[name] || emptyProgress).complete, [s.people])
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
