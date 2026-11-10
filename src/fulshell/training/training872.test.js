import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LESSONS, HELP, PASS_MARK } from './lessons.js'
import { emptyProgress, lessonStates, scoreCheck, recordAttempt, assignLesson, resetLesson, summary, canOpen, helpLesson, searchLessons } from './model.js'

const allRight = l => l.check.map(c => c.answer)
const pass = (p, id) => { const l = LESSONS.find(x => x.id === id); return recordAttempt(p, id, scoreCheck(l, allRight(l))) }

test('every lesson is complete: steps, do and don\'t, a picture, and a 3 to 5 question check with a valid answer', () => {
  const ids = new Set()
  for (const l of LESSONS) {
    assert.ok(!ids.has(l.id), `duplicate ${l.id}`); ids.add(l.id)
    assert.ok(l.steps.length >= 3 && l.dos.length && l.donts.length && l.portal?.shot, l.id)
    assert.ok(l.check.length >= 3 && l.check.length <= 5, `${l.id} has ${l.check.length} questions`)
    for (const c of l.check) assert.ok(Number.isInteger(c.answer) && c.answer >= 0 && c.answer < c.options.length, `${l.id}: ${c.q}`)
  }
  assert.ok(LESSONS.length >= 17)
})

test('the spec\'s jobs all have a lesson', () => {
  for (const id of ['desk', 'inbound', 'speed', 'booking', 'transfer', 'reminders', 'callbacks', 'checkins', 'packets', 'payments', 'changes', 'saves', 'carrier', 'optout', 'never', 'escalate', 'logging']) {
    assert.ok(LESSONS.some(l => l.id === id), id)
  }
})

test('lessons unlock in order: only the first is open for a new VA', () => {
  const s = lessonStates(emptyProgress)
  assert.equal(s[0].state, 'next')
  assert.ok(s.slice(1).every(x => x.state === 'locked'))
  assert.equal(canOpen(emptyProgress, LESSONS[1].id), false)
})

test('passing a lesson opens the next one; failing keeps the path shut', () => {
  const [a, b, c] = LESSONS
  let p = pass(emptyProgress, a.id)
  let s = lessonStates(p)
  assert.deepEqual(s.slice(0, 3).map(x => x.state), ['passed', 'next', 'locked'])
  const wrong = b.check.map(q => (q.answer + 1) % q.options.length)
  p = recordAttempt(p, b.id, scoreCheck(b, wrong))
  s = lessonStates(p)
  assert.equal(s[1].state, 'next')
  assert.equal(s[2].state, 'locked')
  assert.equal(canOpen(p, c.id), false)
})

test('check scoring: right count, wrong list, and the 80% pass mark', () => {
  const l = LESSONS.find(x => x.check.length === 5)
  const right = allRight(l)
  assert.deepEqual(scoreCheck(l, right), { correct: 5, total: 5, pct: 1, pass: true, wrong: [] })
  const oneOff = [...right]; oneOff[2] = (oneOff[2] + 1) % l.check[2].options.length
  const r1 = scoreCheck(l, oneOff)
  assert.equal(r1.correct, 4); assert.deepEqual(r1.wrong, [2]); assert.equal(r1.pass, true) // 4/5 = 80%
  const twoOff = [...oneOff]; twoOff[0] = (twoOff[0] + 1) % l.check[0].options.length
  assert.equal(scoreCheck(l, twoOff).pass, false) // 3/5
  const three = LESSONS.find(x => x.check.length === 3)
  const miss = allRight(three); miss[1] = (miss[1] + 1) % three.check[1].options.length
  assert.equal(scoreCheck(three, miss).pass, false) // 2/3 < 80%
  assert.equal(scoreCheck(three, []).correct, 0) // unanswered counts as wrong
  assert.equal(PASS_MARK, 0.8)
})

test('a failed re-try never takes away a pass', () => {
  const l = LESSONS[0]
  let p = pass(emptyProgress, l.id)
  p = recordAttempt(p, l.id, scoreCheck(l, []))
  assert.equal(p.results[l.id].pass, true)
  assert.equal(p.results[l.id].tries, 2)
})

test('admin assign makes a passed lesson due again without locking the rest; reset clears it', () => {
  const [a, b] = LESSONS
  let p = pass(pass(emptyProgress, a.id), b.id)
  p = assignLesson(p, a.id)
  let s = lessonStates(p)
  assert.equal(s[0].state, 'next')
  assert.equal(s[0].assigned, true)
  assert.equal(s[1].state, 'passed')
  assert.equal(s[2].state, 'open') // still unlocked: the first lesson was passed before
  p = pass(p, a.id)
  assert.equal(p.assigned.includes(a.id), false)
  p = resetLesson(p, b.id)
  s = lessonStates(p)
  assert.equal(s[1].state, 'next')
  assert.equal(summary(p).passed, 1)
})

test('summary: passed, left, next and complete', () => {
  let p = emptyProgress
  for (const l of LESSONS) p = pass(p, l.id)
  const s = summary(p)
  assert.equal(s.complete, true); assert.equal(s.left, 0); assert.equal(s.next, null); assert.equal(s.avg, 1)
  assert.equal(summary(emptyProgress).next, LESSONS[0].id)
})

test('every "?" task opens a real lesson', () => {
  for (const k of Object.keys(HELP)) assert.ok(helpLesson(k), k)
  assert.equal(helpLesson('booking'), 'booking')
  assert.equal(helpLesson('lapse_save'), 'saves')
  assert.equal(helpLesson('nope'), null)
})

test('"How do I…?" search finds the right lesson first', () => {
  assert.equal(searchLessons('how do I book an appointment')[0].id, 'booking')
  assert.equal(searchLessons('someone says stop')[0].id, 'optout')
  assert.equal(searchLessons('cancel old policy')[0].id, 'carrier') // P931: the cancel call (was 'carrier confirms')
  assert.equal(searchLessons('merge the client')[0].id, 'carrier')
  assert.equal(searchLessons('day off')[0].id, 'desk')
  assert.deepEqual(searchLessons('how do I'), [])
  assert.deepEqual(searchLessons('zebra'), [])
})

test('every lesson picture exists and every numbered click has a spot on it', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const shots = JSON.parse(readFileSync(new URL('./shots.json', import.meta.url), 'utf8'))
  for (const l of LESSONS) {
    const sh = shots[l.portal.shot]
    assert.ok(sh, `${l.id}: no shot ${l.portal.shot}`)
    assert.ok(existsSync(new URL(`../../../public/training/${l.portal.shot}.jpg`, import.meta.url)), `${l.portal.shot}.jpg`)
    for (const c of l.portal.clicks) assert.ok(sh.spots[c.spot], `${l.id}: ${c.spot}`)
  }
})
