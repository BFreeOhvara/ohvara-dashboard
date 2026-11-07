import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clockInCheck, deviceOk, breakState, hoursOf, weekPay, agentCheck, checkStep, ageRule, SOMEONE_ELSE, requiredLeft, SCRIPTS,
  bestNumberCheck, formatPhone, myCallTasks, CALL_TASKS, verifyOk, flagsOf, canDispute, OUTCOMES,
} from './p879.js'

const src = f => readFileSync(`src/template/ful/${f.slice(2)}`, 'utf8') // run from the repo root (npm test)

test('P879 clock in: only within 15 minutes of the shift, else an admin approves', () => {
  assert.equal(clockInCheck(8 * 60 + 2, 8 * 60).ok, true)
  assert.equal(clockInCheck(7 * 60 + 45, 8 * 60).ok, true)
  const late = clockInCheck(8 * 60 + 20, 8 * 60)
  assert.equal(late.ok, false); assert.equal(late.needsApproval, true); assert.equal(late.late, 20)
  assert.equal(clockInCheck(7 * 60 + 40, 8 * 60).ok, false)
})

test('P879 device check: routing stays off until every part passes', () => {
  assert.equal(deviceOk({ mic: true, speaker: true, push: true, network: true }), true)
  assert.equal(deviceOk({ mic: true, speaker: true, push: false, network: true }), false)
})

test('P879 breaks: a timer, paid or unpaid, the admin alerted at 5 minutes over', () => {
  const t0 = 0
  assert.equal(breakState('break', t0, 10 * 60000).leftS, 5 * 60)
  assert.equal(breakState('break', t0, 10 * 60000).paid, true)
  assert.equal(breakState('lunch', t0, 0).paid, false)
  assert.equal(breakState('break', t0, 19 * 60000).alert, false)
  assert.equal(breakState('break', t0, 20 * 60000).alert, true)
})

test('P879 timesheet: hourly pay from clock in/out', () => {
  assert.equal(hoursOf({ in: '8:00 AM', out: '6:00 PM', breakM: 45 }), 9.25)
  assert.equal(hoursOf({ in: '8:00 AM', out: null, breakM: 0 }, 12 * 60), 4)
  const w = weekPay([{ in: '8:00 AM', out: '6:00 PM', breakM: 0 }], 8)
  assert.equal(w.pay, 80)
})

test('P879 Check agent: on only when every rule passes; the reason shows; licence blocks booking too', () => {
  const ok = { states: ['TX'], liveCalls: true, app: true, hours: true, free: true, notChecking: true, notPaused: true }
  assert.deepEqual(agentCheck(ok, 'TX'), { ok: true, why: null, bookOk: true })
  assert.equal(agentCheck({ ...ok, free: false }, 'TX').why, 'On another call')
  assert.equal(agentCheck({ ...ok, notPaused: false }, 'TX').why, 'Paused')
  const out = agentCheck(ok, 'FL')
  assert.equal(out.ok, false); assert.equal(out.bookOk, false); assert.equal(out.why, 'Not licensed in this state')
})

test('P879 Check agent steps: Sent, Seen, then the answer or No answer at 30 s', () => {
  assert.equal(checkStep(1000), 'sent')
  assert.equal(checkStep(5000), 'seen')
  assert.equal(checkStep(30000), 'none')
  assert.equal(checkStep(2000, 'yes'), 'yes')
})

test('P879 outcomes: the full list; age rule; someone else can only set a callback', () => {
  for (const k of ['wrong_number', 'do_not_call', 'not_eligible', 'someone_else', 'voicemail', 'upset_legal']) assert.ok(OUTCOMES.some(o => o[0] === k))
  assert.equal(ageRule('17').close, 'not_eligible')
  assert.equal(ageRule('52').ok, true)
  assert.equal(ageRule('').ok, null)
  assert.deepEqual(SOMEONE_ELSE, { canCallback: true, canBook: false, canConsent: false })
})

test('P879 script: required lines left', () => {
  const lines = SCRIPTS.lead.lines
  assert.equal(requiredLeft(lines, {}), lines.filter(l => l[2]).length)
  assert.equal(requiredLeft(lines, Object.fromEntries(lines.map(l => [l[0], true]))), 0)
})

test('P879 best number: formatted and checked against other leads', () => {
  assert.equal(formatPhone('15125550123'), '(512) 555-0123')
  assert.equal(formatPhone('555'), null)
  assert.deepEqual(bestNumberCheck('512 555 0123'), { ok: true, value: '(512) 555-0123' })
  assert.equal(bestNumberCheck('5125550199').ok, false)
})

test('P879 call tasks from texts: the VA gets theirs, coverage questions go to the agent', () => {
  const mine = myCallTasks()
  assert.ok(mine.length > 0)
  assert.ok(mine.every(t => t.for === 'va' && t.reply))
  assert.ok(CALL_TASKS.some(t => t.for === 'agent' && /Coverage/.test(t.kind)))
})

test('P879 flags, caller check, one dispute per score', () => {
  assert.equal(flagsOf({ id: 'vq-4' }).optedOut, true)
  assert.equal(flagsOf({ id: 'vq-3' }).callIn, true)
  assert.equal(flagsOf({ id: 'vq-9' }).callIn, false)
  assert.equal(verifyOk({ name: 'Gloria Santos', dob: '1961-04-12' }, { name: 'Gloria Santos', dob: '1961-04-12' }), true)
  assert.equal(verifyOk({ name: 'Gloria Santos', dob: '1961-04-13' }, { name: 'Gloria Santos', dob: '1961-04-12' }), false)
  assert.equal(canDispute({ dispute: null }), true)
  assert.equal(canDispute({ dispute: { at: 'x' } }), false)
})

test('P879 VA screens carry the new pieces; pay is hourly, no reply box, no dial pad', () => {
  const q = src('./screens/Queue.jsx')
  for (const c of ['<LeadFlags', '<CheckAgent', '<Script', '<Outcome', '<BestNumberNotes', '<HowWeGotYou', '<Recuse', '<CallTasksStrip']) assert.ok(q.includes(c), c)
  const pay = src('./screens/Pay.jsx')
  assert.match(pay, /an hour/); assert.doesNotMatch(pay, /for each cancellation/)
  assert.match(src('./screens/Overview.jsx'), /<ClockTile \/>/)
  assert.match(src('./screens/Schedule.jsx'), /<SwapsHolidays \/>/)
  assert.match(src('./screens/Clients.jsx'), /<VerifyCaller/)
  const desk = src('./LeadDesk879.jsx')
  assert.doesNotMatch(desk, /<textarea/) // no reply box: the VA calls
  assert.match(desk, /Sample mode/) // voice_live off: Check agent is a labelled sample
})
