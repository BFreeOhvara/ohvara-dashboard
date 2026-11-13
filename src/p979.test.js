// P979 — Practice: "Show me how" is now a mandatory guided, spoken walkthrough. node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LESSONS } from './fulshell/training/lessons.js'
import { lessonStates, summary, recordTry, recordAttempt, recordPractice, resetLesson, endsInQuiz, emptyProgress, practiceDone, PRACTICE_FROM } from './fulshell/training/model.js'
import { TOURS, hasTour, voiceLines, lineHash, FINISH, PHONE_AWAY, clipKey } from './fulshell/training/tours.js'
import { FUL } from './template/ful/paths.js'

const VOICE = JSON.parse(readFileSync(new URL('./fulshell/training/practiceVoice.json', import.meta.url), 'utf8'))
const allRight = l => ({ correct: l.check.length, total: l.check.length, pass: true })
const byId = id => LESSONS.find(l => l.id === id)

test('every tour: 3 or 4 click steps, a caption with the thing to click in bold, a short spoken line, a real start page', () => {
  assert.equal(Object.keys(TOURS).length, 14)
  for (const [id, t] of Object.entries(TOURS)) {
    assert.ok(FUL[t.start], `${id} start`)
    assert.ok(t.steps.length >= 3 && t.steps.length <= 4, `${id} has ${t.steps.length} steps`)
    for (const s of t.steps) {
      assert.ok(!s.act || ['click', 'type'].includes(s.act), `${id}: no look-only or self-playing steps`)
      assert.match(s.say, /\*\*.+\*\*/, `${id}: "${s.say}" names what to click`)
      assert.ok(s.voice && s.voice.length <= 140, `${id}: "${s.voice}" is short`)
      if (s.act === 'type') assert.ok(s.field, `${id}: a typing step names its box`)
    }
  }
})

test('every line Mark says has its clip, made from that exact line', () => {
  const lines = voiceLines()
  assert.equal(lines.length, Object.values(TOURS).reduce((n, t) => n + t.steps.length, 0) + 2)
  assert.ok(lines.some(l => l.key === FINISH.key) && lines.some(l => l.key === PHONE_AWAY.key))
  for (const l of lines) {
    const c = VOICE.clips[l.key]
    assert.ok(c, `clip for ${l.key}`)
    assert.equal(c.hash, lineHash(l.text), `${l.key} was re-worded after its clip was made: re-run the clip generator`)
    assert.ok(c.src.endsWith('.mp4') && c.dur > 0.5 && c.dur < 12, `${l.key} length ${c.dur}`)
  }
  assert.equal(clipKey('desk', 0), 'desk-1')
  assert.match(VOICE.base, /^https:\/\/.+\/training\/v979\/practice\/$/)
})

test('lines only say what is needed: no prices, numbers, promises or approval claims', () => {
  for (const l of voiceLines()) {
    assert.doesNotMatch(l.text, /\$|percent|guarantee|always|never|approv|pending|text with the new time/i, `${l.key}: ${l.text}`)
  }
})

test('a lesson with Practice counts only once its Practice is finished', () => {
  // A Try it lesson: Practice is the way it gets done.
  assert.equal(lessonStates(recordTry(emptyProgress, 'desk'))[0].state, 'next', 'a Try it press alone no longer passes it')
  const p1 = recordPractice(emptyProgress, 'desk')
  assert.equal(lessonStates(p1)[0].state, 'passed')
  assert.equal(lessonStates(p1)[1].state, 'next')
  // A check lesson with Practice: the check alone is not enough; Practice alone is not enough either.
  const carrier = byId('carrier')
  assert.ok(endsInQuiz(carrier) && hasTour('carrier'))
  let p = emptyProgress
  for (const l of LESSONS.slice(0, LESSONS.indexOf(carrier))) p = recordPractice(p, l.id)
  const checkOnly = recordAttempt(p, 'carrier', allRight(carrier))
  assert.equal(lessonStates(checkOnly).find(s => s.id === 'carrier').state, 'next')
  const practiceOnly = recordPractice(p, 'carrier')
  assert.equal(lessonStates(practiceOnly).find(s => s.id === 'carrier').state, 'next')
  assert.equal(lessonStates(practiceOnly).find(s => s.id === 'carrier').practised, true)
  const both = recordAttempt(practiceOnly, 'carrier', allRight(carrier))
  assert.equal(lessonStates(both).find(s => s.id === 'carrier').state, 'passed')
  // Lessons without a tour (opt-outs, what to steer clear of) still pass on their check alone.
  assert.ok(!hasTour('optout') && !hasTour('never'))
  // A reset lesson is practised again.
  assert.equal(practiceDone(resetLesson(both, 'carrier'), 'carrier'), false)
})

test('VAs who passed before Practice keep their lessons (carry-over), so finished training stays finished', () => {
  let p = emptyProgress
  for (const l of LESSONS) p = endsInQuiz(l) ? recordAttempt(p, l.id, allRight(l), '2026-11-12T15:00:00Z') : recordTry(p, l.id, '2026-11-12T15:00:00Z')
  const old = { ...p, results: Object.fromEntries(Object.entries(p.results).map(([k, r]) => [k, { ...r, version: '2026-11-12.1' }])) }
  assert.ok('2026-11-12.1' < PRACTICE_FROM)
  assert.equal(summary(old).complete, true)
  assert.equal(summary(p).complete, false, 'the same passes made after the change need Practice')
  let q = emptyProgress
  for (const l of LESSONS) q = endsInQuiz(l) ? recordAttempt(hasTour(l.id) ? recordPractice(q, l.id) : q, l.id, allRight(l)) : recordPractice(q, l.id)
  assert.equal(summary(q).complete, true)
})

test('Training page: it is called Practice, it is not optional, and it starts when the video ends', () => {
  const src = readFileSync(new URL('./fulshell/training/Training.jsx', import.meta.url), 'utf8')
  const run = readFileSync(new URL('./fulshell/training/practiceRun.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /Show me how|do it myself|'show'|'turn'/)
  assert.match(src, /Start practice/)
  assert.match(src, /onEnded=\{ended\}/)
  assert.doesNotMatch(run, /\.click\(\)/, 'nothing clicks itself')
  assert.match(run, /prefers-reduced-motion/)
  assert.match(run, /Hear it again/)
})
