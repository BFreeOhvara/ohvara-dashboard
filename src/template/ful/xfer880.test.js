// P880 — the VA's transfer card from the server's check (transfer_checks), and the new sample steps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newCall, callReducer as r, xferFromCheck, xferRefused, XFER_WORDS, XFER_BOOK, XFER_GO, xferOpen, SAMPLE_REACH, REACH_WORDS } from './callLine.js'

const T = Date.parse('2026-11-07T15:00:00Z')
const iso = ms => new Date(T + ms).toISOString()
const row = over => ({ id: 'c1', agent_id: 'a1', status: 'sent', sent_at: iso(0), expires_at: iso(30000), created_at: iso(0), ...over })

test('server status → the card step, every branch', () => {
  const step = (status, over) => xferFromCheck(row({ status, ...over }), 0, T + 1000).step
  assert.equal(step('sent'), 'sent')
  assert.equal(step('seen'), 'seen')
  assert.equal(step('yes'), 'yes')
  assert.equal(step('late_yes'), 'lateyes')
  assert.equal(step('no'), 'no')
  assert.equal(step('failed'), 'fail')
  assert.equal(step('withdrawn'), 'withdrew')
  assert.equal(step('ringing', { ring_started_at: iso(500) }), 'ringing')
  assert.equal(step('connected'), 'done')
  assert.equal(step('bounced'), 'bounced')
  assert.equal(step('booked'), 'booked')
  assert.equal(step('cancelled'), 'cancelled')
  // The 30 s passed: no answer, even before the server's sweep.
  assert.equal(xferFromCheck(row(), 0, T + 30001).step, 'noanswer')
  for (const s of ['lateyes', 'withdrew', 'cancelled', 'booked', 'busy', 'unreachable', 'fail', 'bounced']) assert.ok(XFER_WORDS[s], s)
})

test('the timer starts from the server clock (survives a reload and a wrong phone clock)', () => {
  // This device is 4 s behind the server: the card's `at` is shifted onto this device's clock.
  const x = xferFromCheck(row(), 4000, T - 4000 + 10000)
  assert.equal(x.at, T - 4000)
  const ring = xferFromCheck(row({ status: 'ringing', ring_started_at: iso(12000) }), 0, T + 13000)
  assert.equal(ring.at, T + 12000)
  assert.equal(ring.live, true)
})

test('refusals and the book / go buttons', () => {
  assert.equal(xferRefused('agent_busy').step, 'busy')
  assert.equal(xferRefused('not_reachable').step, 'unreachable')
  assert.equal(xferRefused('no_agent').step, 'fail')
  for (const s of ['no', 'noanswer', 'fail', 'bounced', 'withdrew']) assert.ok(XFER_BOOK.includes(s), s)
  assert.deepEqual(XFER_GO, ['yes', 'lateyes'])
  assert.equal(xferOpen({ step: 'lateyes' }), false)
  assert.ok(REACH_WORDS[SAMPLE_REACH['ag-marcus']].startsWith('Not reachable for live calls'))
})

test('sample: a late Yes can still be transferred; a withdraw stops it; server state replaces the sample', () => {
  const who = { key: 'l1', name: 'Rosa Diaz', role: 'lead' }
  let c = r(newCall(who, 0), { type: 'check', agent: 'ag-dana', now: 0 })
  c = r(c, { type: 'xfer', step: 'noanswer', now: 30000 })
  c = r(c, { type: 'lateYes', now: 31000 })
  assert.equal(c.xfer.step, 'lateyes')
  c = r(c, { type: 'transfer', now: 32000 })
  assert.equal(c.xfer.step, 'ringing')
  c = r(c, { type: 'withdrew', now: 33000 })
  assert.equal(c.xfer.step, 'withdrew')
  c = r(c, { type: 'xferServer', xfer: { step: 'done', at: 1 } })
  assert.equal(c.xfer.step, 'done')
})
