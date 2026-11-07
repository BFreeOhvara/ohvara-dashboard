import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dockReducer as r, dockView, dockBadge, initialDock } from './phoneDock.js'

const run = (...acts) => acts.reduce(r, initialDock)

test('X during a live call only minimises: the line stays live and the pill shows', () => {
  const s = run({ type: 'open' }, { type: 'line', line: 'live' }, { type: 'close' })
  assert.equal(s.open, false)
  assert.equal(s.line, 'live')
  assert.equal(dockView(s), 'pill')
})

test('closing never hangs up, however many times it is pressed', () => {
  let s = run({ type: 'ring', id: 'k1' }, { type: 'answer' }, { type: 'line', line: 'live' })
  for (let i = 0; i < 3; i++) s = r(s, { type: 'close' })
  assert.equal(s.line, 'live')
  s = r(s, { type: 'open' })
  assert.equal(dockView(s), 'panel')
  assert.equal(s.line, 'live')
})

test('only Phone ending the call clears the line (hang up reports after, then null on save)', () => {
  let s = run({ type: 'open' }, { type: 'line', line: 'live' }, { type: 'close' }, { type: 'line', line: 'after' })
  assert.equal(dockView(s), 'pill')
  s = r(s, { type: 'line', line: null })
  assert.equal(dockView(s), 'button')
})

test('a ring opens the panel by itself', () => {
  const s = run({ type: 'ring', id: 'k2' })
  assert.equal(s.open, true)
  assert.deepEqual(dockBadge(s), { kind: 'ringing', n: 1, label: 'A call is coming in' })
})

test('closed while ringing: the button badges the ring; a timeout turns it into a missed call', () => {
  let s = run({ type: 'ring', id: 'k3' }, { type: 'close' })
  assert.equal(dockView(s), 'button')
  assert.equal(dockBadge(s).kind, 'ringing')
  s = r(s, { type: 'miss' })
  assert.equal(s.ringId, null)
  assert.deepEqual(dockBadge(s), { kind: 'missed', n: 1, label: '1 missed call' })
  s = r(s, { type: 'open' })
  assert.equal(dockBadge(s), null) // opening the phone marks them seen
  assert.equal(s.missed.length, 1) // still listed under Recent
})

test('Not now closes the panel and counts as missed; a miss with no ring does nothing', () => {
  const s = run({ type: 'ring', id: 'k4' }, { type: 'miss', declined: true })
  assert.equal(s.open, false)
  assert.equal(dockBadge(s).n, 1)
  assert.equal(r(initialDock, { type: 'miss' }), initialDock)
})
