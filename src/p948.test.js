// P948 — VA training in the order of the real job, "what to steer clear of" last, and "Show me how" walkthroughs in
// the practice copy of the portal. node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LESSONS, HELP } from './fulshell/training/lessons.js'
import { lessonStates, summary, recordTry, recordAttempt, endsInQuiz, emptyProgress, carried } from './fulshell/training/model.js'
import { TOURS, hasTour } from './fulshell/training/tours.js'
import { FUL } from './template/ful/paths.js'
import { callGate } from './lib/callOpen.js'
import { practiceOn, readPractice, writePractice, endPractice, onPracticeCopy, PRACTICE_KEY } from './lib/practice.js'

const ids = LESSONS.map(l => l.id)
const at = id => ids.indexOf(id)

test('lessons follow a VA\'s day: start of shift first, the next call and its brief, then the call types', () => {
  assert.equal(ids[0], 'desk')
  assert.equal(LESSONS[0].title, 'Start of your shift')
  assert.equal(ids[1], 'speed') // the next call, the brief, Start call
  // each call type, most common first: hand-off (welcome), cancel the old policy, save, change request, callback
  for (const [a, b] of [['welcome', 'carrier'], ['carrier', 'saves'], ['saves', 'changes'], ['changes', 'callbacks']]) assert.ok(at(a) < at(b), `${a} before ${b}`)
  assert.ok(at('callbacks') < at('inbound'), 'calls that come in after the booked call types')
  assert.ok(at('inbound') < at('escalate') && at('fromai') < at('escalate'), 'coverage questions go to the agent after calls coming in')
  assert.ok(at('escalate') < at('logging'), 'after the call comes after the calls')
  assert.ok(at('logging') < at('timeoff'), 'time off and pay after the call')
})

test('what to steer clear of is last; the never-say list is the final lesson', () => {
  assert.equal(ids.at(-1), 'never')
  assert.equal(LESSONS.at(-1).title, 'What to steer clear of')
  assert.equal(ids.at(-2), 'optout')
  assert.ok(at('timeoff') < at('optout'))
})

test('the first lesson no longer teaches days off; Time off and pay does, and the "?" on day off opens it', () => {
  const desk = LESSONS[0]
  assert.ok(!desk.steps.some(s => /day off/i.test(s)))
  assert.equal(desk.tryIt.button, 'Clock in')
  const t = LESSONS.find(l => l.id === 'timeoff')
  assert.ok(t.steps.some(s => /Request a day off/.test(s)) && t.steps.some(s => /Monday/.test(s)))
  assert.equal(HELP.dayoff, 'timeoff')
  assert.equal(new Set(ids).size, ids.length)
})

test('every lesson with a task in the portal has a Show me how; every tour points at a real lesson and page', () => {
  for (const l of LESSONS.filter(x => !endsInQuiz(x))) assert.ok(hasTour(l.id), `${l.id} has Show me how`)
  for (const id of ['inbound', 'escalate', 'carrier']) assert.ok(hasTour(id), `${id} (a check lesson) still shows it in the portal`)
  for (const [id, t] of Object.entries(TOURS)) {
    assert.ok(ids.includes(id), `${id} is a lesson`)
    assert.ok(FUL[t.start], `${id} starts on a real page`)
    assert.ok(t.steps.length >= 2 && t.done)
    for (const s of t.steps) {
      assert.ok(s.sel && s.say && ['click', 'look'].includes(s.act), `${id} step "${s.say}"`)
    }
    assert.equal(t.steps.at(-1).act === 'click' || t.steps.at(-1).act === 'look', true)
  }
  // The spec's list: request time off, start a booked call, read the brief, log the outcome, open a client, the phone, pay.
  const said = Object.values(TOURS).flatMap(t => t.steps.map(s => s.say)).join(' ')
  for (const w of ['Request a day off', 'Start call', 'brief', 'No answer', 'Open Clients', 'phone', 'Pay']) assert.ok(said.includes(w), w)
})

test('the training gate: a VA who passed the old first lesson keeps training finished after the split', () => {
  const allRight = l => ({ correct: l.check.length, total: l.check.length, pass: true })
  // Every lesson but the new one, passed before P948 (old version stamps).
  let p = emptyProgress
  for (const l of LESSONS.filter(x => x.id !== 'timeoff')) {
    p = endsInQuiz(l) ? recordAttempt(p, l.id, allRight(l), '2026-11-02T15:00:00Z') : recordTry(p, l.id, '2026-11-02T15:00:00Z')
  }
  p = { ...p, results: Object.fromEntries(Object.entries(p.results).map(([k, r]) => [k, { ...r, version: '2026-11-10.3' }])) }
  assert.equal(summary(p).complete, true)
  assert.equal(carried(p).results.timeoff.carried, true)
  // A brand-new VA gets no carry: Time off and pay is a lesson like any other.
  const fresh = recordTry(emptyProgress, 'desk')
  assert.equal(carried(fresh).results.timeoff, undefined)
  assert.equal(lessonStates(fresh)[1].state, 'next')
  assert.equal(summary(emptyProgress).complete, false)
})

test('the practice copy: only on its own pages, and there every call can start (nothing dials)', () => {
  const mem = new Map()
  globalThis.sessionStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) }
  globalThis.window = { location: { pathname: '/template/fulfillment/calendar' } }
  const later = { iso: '2026-11-11T20:00:00Z', nowMs: Date.parse('2026-11-11T15:00:00Z') }
  assert.equal(practiceOn(), false)
  assert.equal(callGate(later).open, false)
  writePractice({ lesson: 'welcome', name: 'Rosa Diaz', back: '/fulfillment/training', phase: 'show' })
  assert.equal(readPractice().lesson, 'welcome')
  assert.equal(practiceOn(), true)
  assert.equal(callGate(later).open, true)
  assert.equal(callGate({ ...later, done: true }).open, false)
  // The real VA pages never count as practice, even with a practice stored in the tab.
  globalThis.window.location.pathname = '/fulfillment/calendar'
  assert.equal(onPracticeCopy(), false)
  assert.equal(practiceOn(), false)
  assert.equal(callGate(later).open, false)
  endPractice()
  assert.equal(mem.has(PRACTICE_KEY), false)
  delete globalThis.window
  delete globalThis.sessionStorage
})
