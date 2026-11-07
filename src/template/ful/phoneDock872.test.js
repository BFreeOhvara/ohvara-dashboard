import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dockReducer as r, railState, dockBadge, initialDock } from './phoneDock.js'

const run = (...acts) => acts.reduce(r, initialDock)

test('P876: sliding the screen away mid-call keeps the call and lights the rail icon (live + its start time)', () => {
  const s = run({ type: 'open' }, { type: 'line', line: 'live', since: 1000 }, { type: 'close' })
  assert.equal(s.open, false)
  assert.equal(s.line, 'live')
  assert.equal(railState(s), 'live')
  assert.equal(s.since, 1000, 'the rail timer counts from the call start')
})

test('closing never hangs up, however many times it is pressed; the rail icon brings it back', () => {
  let s = run({ type: 'ring', id: 'k1' }, { type: 'answer' }, { type: 'line', line: 'live', since: 5 })
  for (let i = 0; i < 3; i++) s = r(s, { type: 'close' })
  assert.equal(s.line, 'live')
  s = r(s, { type: 'toggle' })
  assert.equal(s.open, true)
  assert.equal(s.line, 'live')
  assert.equal(s.since, 5, 'the start time does not reset when the screen comes back')
})

test('only Phone ending the call clears the line (hang up reports after, then null on save)', () => {
  let s = run({ type: 'open' }, { type: 'line', line: 'live', since: 1 }, { type: 'close' }, { type: 'line', line: 'after' })
  assert.equal(railState(s), 'after')
  assert.equal(s.since, null)
  s = r(s, { type: 'line', line: null })
  assert.equal(railState(s), null)
})

test('a ring slides the screen in by itself and makes the rail icon ring', () => {
  const s = run({ type: 'ring', id: 'k2' })
  assert.equal(s.open, true)
  assert.equal(railState(s), 'ringing')
  assert.deepEqual(dockBadge(s), { kind: 'ringing', n: 1, label: 'A call is coming in' })
})

test('slid away while ringing: the rail icon still rings; a timeout turns it into a missed call', () => {
  let s = run({ type: 'ring', id: 'k3' }, { type: 'close' })
  assert.equal(railState(s), 'ringing')
  s = r(s, { type: 'miss' })
  assert.equal(s.ringId, null)
  assert.deepEqual(dockBadge(s), { kind: 'missed', n: 1, label: '1 missed call' })
  s = r(s, { type: 'open' })
  assert.equal(dockBadge(s), null) // opening the phone marks them seen
  assert.equal(s.missed.length, 1) // still listed under Recent
})

test('Not now slides it away and counts as missed; a miss with no ring does nothing', () => {
  const s = run({ type: 'ring', id: 'k4' }, { type: 'miss', declined: true })
  assert.equal(s.open, false)
  assert.equal(dockBadge(s).n, 1)
  assert.equal(r(initialDock, { type: 'miss' }), initialDock)
})
