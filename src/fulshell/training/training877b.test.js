// P877 Phase 2 — each lesson ends in a check (only where a mistake costs money or breaks a rule) or a Try it on
// sample data, and Try it counts as finishing the lesson.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LESSONS } from './lessons.js'
import { emptyProgress, lessonStates, summary, recordTry, recordAttempt, assignLesson, scoreCheck, matchesTry, endsInQuiz } from './model.js'
import { FUL } from '../../template/ful/paths.js'

const QUIZ = ['never', 'optout', 'inbound', 'booking', 'transfer', 'carrier', 'escalate']

test('checks only on the lessons where a mistake costs money or breaks a rule', () => {
  assert.deepEqual(LESSONS.filter(endsInQuiz).map(l => l.id).sort(), [...QUIZ].sort())
})

test('every other lesson has a Try it: a real page, what to do, and the button that finishes it', () => {
  for (const l of LESSONS.filter(x => !endsInQuiz(x))) {
    assert.ok(l.tryIt, `${l.id} has a Try it`)
    assert.ok(FUL[l.tryIt.path[0]], `${l.id} Try it page ${l.tryIt.path[0]} exists`)
    assert.ok(l.tryIt.do.includes(l.tryIt.button), `${l.id} says which button to press`)
  }
})

test('Try it finishes the lesson and opens the next; no score, never shown as out of date', () => {
  const p = recordTry(emptyProgress, 'desk')
  const s = lessonStates(p)
  assert.equal(s[0].state, 'passed')
  assert.equal(s[0].score, null)
  assert.equal(s[0].stale, false)
  assert.equal(s[0].tried, true)
  assert.equal(s[1].state, 'next')
  assert.equal(summary(p).passed, 1)
  assert.equal(summary(p).avg, null) // only checks are averaged
})

test('an assigned Try it lesson is due again, and doing it clears the assign', () => {
  let p = recordTry(emptyProgress, 'desk')
  p = assignLesson(p, 'desk')
  assert.equal(lessonStates(p)[0].state, 'next')
  p = recordTry(p, 'desk')
  assert.deepEqual(p.assigned, [])
  assert.equal(p.results.desk.tries, 2)
})

test('a check lesson still needs a pass', () => {
  const never = LESSONS.find(l => l.id === 'never')
  let p = recordTry(emptyProgress, 'desk')
  p = recordAttempt(p, 'never', scoreCheck(never, never.check.map(() => -1)))
  assert.equal(lessonStates(p)[1].state, 'next')
  assert.equal(lessonStates(p)[2].state, 'locked')
})

test('the pressed button must be the lesson\'s own, ignoring spacing and case', () => {
  const speed = LESSONS.find(l => l.id === 'speed')
  // P907: speed is Working in bookings; its Try it is Start call on the next booked call (P946: the Overview's button).
  assert.equal(matchesTry(speed, '  Start call '), true)
  assert.equal(matchesTry(speed, 'START CALL'), true)
  assert.equal(matchesTry(speed, 'Put back'), false)
  assert.equal(matchesTry(LESSONS.find(l => l.id === 'never'), 'Start'), false)
})
