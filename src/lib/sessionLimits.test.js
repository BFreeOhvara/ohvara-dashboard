// P970 — auto sign-out rules, run on a fake clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_LIMITS as L, LIMIT_KEYS, limitsApply, limitBroken, limitNote, ensureStamps, markLogin, noteActivity,
  clearStamps, readActive, readLogin, mustWait, holdSignOut, resetHolds, typingInField, safeReturnPath,
} from './sessionLimits.js'

const H = 3600 * 1000
const D = 24 * H
const T0 = Date.UTC(2026, 10, 11, 9, 0, 0)

function fakeStore() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }
}

test('config: 8 h idle, 7 days, agents only', () => {
  assert.equal(L.idleMs, 8 * H)
  assert.equal(L.maxAgeMs, 7 * D)
  assert.deepEqual(L.roles, ['agent'])
})

test('agent idle 8 h -> signed out; just under -> fine', () => {
  const base = { role: 'agent', loginAt: T0, lastActive: T0 }
  assert.equal(limitBroken({ ...base, now: T0 + 8 * H }), 'idle')
  assert.equal(limitBroken({ ...base, now: T0 + 8 * H - 1 }), null)
})

test('agent active but 7 days since login -> signed out (weekly)', () => {
  const now = T0 + 7 * D
  assert.equal(limitBroken({ role: 'agent', now, loginAt: T0, lastActive: now - 1000 }), 'weekly')
  assert.equal(limitBroken({ role: 'agent', now: now - 1, loginAt: T0, lastActive: now - 1000 }), null)
})

test('admin never, VA (fulfillment) never, at any age', () => {
  const now = T0 + 90 * D
  for (const role of ['admin', 'fulfillment']) {
    assert.equal(limitBroken({ role, now, loginAt: T0, lastActive: T0 }), null)
    assert.equal(limitsApply({ role, native: false }), false)
  }
})

test('the phone app never signs anyone out', () => {
  const now = T0 + 90 * D
  assert.equal(limitBroken({ role: 'agent', native: true, now, loginAt: T0, lastActive: T0 }), null)
  assert.equal(limitsApply({ role: 'agent', native: true }), false)
  assert.equal(limitsApply({ role: 'agent', native: false }), true)
})

test('a session with no stamps starts its clocks instead of being signed out', () => {
  const st = fakeStore()
  const { lastActive, loginAt } = ensureStamps(st, 'u1', T0)
  assert.equal(lastActive, T0)
  assert.equal(loginAt, T0)
  assert.equal(limitBroken({ role: 'agent', now: T0 + 1000, lastActive, loginAt }), null)
  // another person's login record is replaced, not reused
  markLogin(st, 'u1', T0 - 6 * D)
  assert.equal(readLogin(st, 'u2'), null)
  assert.equal(ensureStamps(st, 'u2', T0).loginAt, T0)
})

test('activity is throttled to one write per 30 s and keeps an active agent in', () => {
  const st = fakeStore()
  markLogin(st, 'u1', T0)
  assert.equal(noteActivity(st, T0 + 10 * 1000), false)
  assert.equal(readActive(st), T0)
  assert.equal(noteActivity(st, T0 + 30 * 1000), true)
  assert.equal(readActive(st), T0 + 30 * 1000)
  // works all day, every few minutes: never idle-out
  let now = T0
  for (let i = 0; i < 40; i++) { now += 15 * 60 * 1000; noteActivity(st, now) }
  assert.equal(limitBroken({ role: 'agent', now, lastActive: readActive(st), loginAt: readLogin(st, 'u1') }), null)
})

test('return after a night away is idle, and signing out clears both stamps', () => {
  const st = fakeStore()
  markLogin(st, 'u1', T0)
  const morning = T0 + 20 * H
  const reason = limitBroken({ role: 'agent', now: morning, lastActive: readActive(st), loginAt: readLogin(st, 'u1') })
  assert.equal(reason, 'idle')
  clearStamps(st)
  assert.equal(readActive(st), null)
  assert.equal(readLogin(st, 'u1'), null)
})

test('the login page note comes from the config', () => {
  assert.equal(limitNote('idle'), 'You were signed out after 8 hours away. Log in again.')
  assert.match(limitNote('weekly'), /weekly sign-in/)
  assert.equal(limitNote(null), '')
})

test('never sign out mid-call, mid-typing or in an unsaved form: wait', () => {
  resetHolds()
  const now = T0 + 7 * D
  // 7-day rule while they are working
  assert.equal(mustWait({ reason: 'weekly', now, lastActive: now - 10 * 1000, doc: null }), true)
  // 7-day rule, quiet for 5 minutes: go
  assert.equal(mustWait({ reason: 'weekly', now, lastActive: now - 5 * 60 * 1000, doc: null }), false)
  // a field with text in it holds the 7-day rule
  const typing = { activeElement: { tagName: 'TEXTAREA', value: 'half a note' } }
  assert.equal(mustWait({ reason: 'weekly', now, lastActive: now - 10 * 60 * 1000, doc: typing }), true)
  // but not the 8 h idle rule
  assert.equal(mustWait({ reason: 'idle', now, lastActive: now - 9 * H, doc: typing }), false)
  // a live call (or an unsaved form that registers a hold) holds both until released
  const release = holdSignOut('call')
  assert.equal(mustWait({ reason: 'idle', now, lastActive: now - 9 * H, doc: null }), true)
  assert.equal(mustWait({ reason: 'weekly', now, lastActive: now - 9 * H, doc: null }), true)
  release()
  assert.equal(mustWait({ reason: 'idle', now, lastActive: now - 9 * H, doc: null }), false)
})

test('typingInField ignores empty fields and buttons', () => {
  assert.equal(typingInField({ activeElement: { tagName: 'INPUT', type: 'text', value: '' } }), false)
  assert.equal(typingInField({ activeElement: { tagName: 'INPUT', type: 'text', value: 'x' } }), true)
  assert.equal(typingInField({ activeElement: { tagName: 'INPUT', type: 'checkbox', value: 'on' } }), false)
  assert.equal(typingInField({ activeElement: { tagName: 'DIV', isContentEditable: true, textContent: ' hi ' } }), true)
  assert.equal(typingInField(null), false)
})

test('return-to-page: same-site paths come back, nothing else does', () => {
  assert.equal(safeReturnPath('/agent/clients?tab=live#top'), '/agent/clients?tab=live#top')
  assert.equal(safeReturnPath('//evil.com'), null)
  assert.equal(safeReturnPath('https://evil.com'), null)
  assert.equal(safeReturnPath('/login'), null)
  assert.equal(safeReturnPath('/join?t=abc'), null)
  assert.equal(safeReturnPath(null), null)
  assert.equal(LIMIT_KEYS.back, 'ohvara-return-to')
})
