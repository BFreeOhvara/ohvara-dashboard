// P872 — VA training rules, pure (node --test): lessons unlock in order, a check scores and passes at PASS_MARK, the
// "How do I…?" search, and the admin's assign / reset. Progress shape (sample in the browser now; P852 stores it):
//   { results: { [lessonId]: { correct, total, pass, at, version, tries } | { tried, pass, at, version, tries } }, assigned: [lessonId] }
// An assigned lesson must be taken (again) even if it was passed; it does not lock anything after it.
import { LESSONS, HELP, PASS_MARK, TRAINING_VERSION } from './lessons.js'

export const emptyProgress = { results: {}, assigned: [] }
export const lessonById = id => LESSONS.find(l => l.id === id) || null
export const lessonNo = id => LESSONS.findIndex(l => l.id === id) + 1

export function scoreCheck(lesson, answers) {
  const total = lesson.check.length
  const wrong = lesson.check.map((c, i) => (answers[i] === c.answer ? -1 : i)).filter(i => i >= 0)
  const correct = total - wrong.length
  const pct = total ? correct / total : 0
  return { correct, total, pct, pass: pct >= PASS_MARK - 1e-9, wrong }
}

// P948: the old first lesson ('desk') also taught days off; that part is its own lesson now ('timeoff'). A VA who passed
// the old one keeps it passed, so finishing training stays finished (the P936 gate) after the split.
export const CARRY = { timeoff: 'desk' }
export function carried(p = emptyProgress) {
  let out = p
  for (const [id, from] of Object.entries(CARRY)) {
    const r = p.results?.[from]
    if (!p.results?.[id] && r?.pass && r.version && r.version < '2026-11-11') out = { ...out, results: { ...out.results, [id]: { tried: true, pass: true, at: r.at, version: r.version, tries: 0, carried: true } } }
  }
  return out
}

const passed = (p, id) => !!p.results[id]?.pass && !p.assigned.includes(id)

// Every lesson's state, in order: 'passed' | 'next' (the one to do now) | 'open' (unlocked, e.g. assigned) | 'locked'.
export function lessonStates(p = emptyProgress, lessons = LESSONS) {
  p = carried(p)
  let gateOpen = true
  let nextSet = false
  return lessons.map(l => {
    const r = p.results[l.id]
    const done = passed(p, l.id)
    const assigned = p.assigned.includes(l.id)
    let state
    if (done) state = 'passed'
    else if (gateOpen || assigned) state = nextSet ? 'open' : 'next'
    else state = 'locked'
    if (state === 'next') nextSet = true
    // The path stays open only while every lesson so far is passed (an assigned re-take of a passed lesson does not close it).
    if (!done && !(assigned && r?.pass)) gateOpen = false
    return { id: l.id, state, assigned, stale: !!r?.pass && !!r.total && r.version !== TRAINING_VERSION, score: r?.total ? { correct: r.correct, total: r.total } : null, tried: !!r?.tried, tries: r?.tries || 0 }
  })
}

export const canOpen = (p, id) => lessonStates(p).find(s => s.id === id)?.state !== 'locked'

export function summary(p = emptyProgress, lessons = LESSONS) {
  p = carried(p)
  const states = lessonStates(p, lessons)
  const done = states.filter(s => s.state === 'passed')
  const scored = Object.values(p.results).filter(r => r.total)
  const avg = scored.length ? scored.reduce((a, r) => a + r.correct / r.total, 0) / scored.length : null
  const next = states.find(s => s.state === 'next') || null
  return { passed: done.length, total: lessons.length, left: lessons.length - done.length, pct: done.length / lessons.length, avg, next: next ? next.id : null, complete: done.length === lessons.length }
}

// Reducers: a check attempt, the admin's assign and reset.
export function recordAttempt(p, id, result, at = new Date().toISOString()) {
  const prev = p.results[id]
  const keepPass = prev?.pass && !result.pass && !p.assigned.includes(id) // a failed re-try never takes a pass away
  const r = keepPass ? { ...prev, tries: (prev.tries || 0) + 1 } : { correct: result.correct, total: result.total, pass: result.pass, at, version: TRAINING_VERSION, tries: (prev?.tries || 0) + 1 }
  return { results: { ...p.results, [id]: r }, assigned: result.pass ? p.assigned.filter(x => x !== id) : p.assigned }
}
// P877: a lesson ends in a quiz (lesson.quiz) or a Try it (lesson.tryIt). Try it is done when the VA presses
// tryIt.button on sample data; it counts as the lesson's pass (no score), and clears an admin's assign like a pass does.
export const endsInQuiz = l => !!l?.quiz || !l?.tryIt
export function recordTry(p, id, at = new Date().toISOString()) {
  const prev = p.results[id]
  return { results: { ...p.results, [id]: { tried: true, pass: true, at, version: TRAINING_VERSION, tries: (prev?.tries || 0) + 1 } }, assigned: p.assigned.filter(x => x !== id) }
}
const squash = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
// The pressed button's text, as the browser reads it (icons add nothing), against the lesson's Try it button.
export const matchesTry = (lesson, text) => !!lesson?.tryIt && squash(text) === squash(lesson.tryIt.button)
export const assignLesson = (p, id) => (p.assigned.includes(id) ? p : { ...p, assigned: [...p.assigned, id] })
export function resetLesson(p, id) {
  const rest = { ...p.results }
  delete rest[id]
  return { results: rest, assigned: p.assigned.filter(x => x !== id) }
}

// The "?" on a task: which lesson it opens (a HELP task key, or a lesson id).
export const helpLesson = task => (HELP[task] && lessonById(HELP[task]) ? HELP[task] : lessonById(task) ? task : null)

// "How do I…?": every word must appear somewhere in the lesson; title and job rank above steps, steps above the rest.
const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ')
function fields(l) {
  return [
    [l.title, 6], [l.job, 4], ...l.steps.map(s => [s, 2]),
    ...(l.script?.lines || []).map(x => [x.text, 1]), ...l.dos.map(s => [s, 1]), ...l.donts.map(s => [s, 1]),
    ...(l.portal?.clicks || []).map(c => [c.text, 1]),
  ]
}
const STOP = new Set(['how', 'do', 'i', 'a', 'an', 'the', 'to', 'what', 'is', 'my', 'when', 'who', 'of', 'for', 'and', 'it', 'if', 'should', 'can'])
export function searchLessons(q, lessons = LESSONS) {
  const words = norm(q).split(' ').filter(w => w && !STOP.has(w))
  if (!words.length) return []
  return lessons.map(l => {
    const fs = fields(l)
    const hay = norm(fs.map(f => f[0]).join(' '))
    if (!words.every(w => hay.includes(w))) return null
    let best = null
    let score = 0
    for (const [text, weight] of fs) {
      const t = norm(text)
      const n = words.filter(w => t.includes(w)).length
      if (!n) continue
      score += n * weight
      if (!best || n * weight > best.w) best = { text, w: n * weight }
    }
    return { id: l.id, title: l.title, hit: best?.text || l.job, score }
  }).filter(Boolean).sort((a, b) => b.score - a.score)
}
