import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newCall, callReducer as r, onLine, lineCount, heldFor } from './callLine.js'

const who = { key: 'k-1', name: 'Gloria Price', number: '(512) 555-0101', role: 'client' }
const carrier = { id: 'cat-globe-life', name: 'Globe Life', role: 'carrier', number: '(800) 851-0042' }
const agent = { id: 'ag-dana', name: 'Dana Walker', role: 'agent', number: '(512) 555-0199' }
const run = (c, ...acts) => acts.reduce(r, c)

test('merge adds a carrier: it rings on its own line, the client waits on hold, then all three are on one call', () => {
  let c = newCall(who, 0)
  c = r(c, { type: 'add', party: carrier, now: 1000 })
  assert.equal(c.held, true, 'the client waits on hold while the carrier rings')
  assert.equal(c.parties.find(p => p.id === carrier.id).state, 'ringing')
  assert.equal(lineCount(c), 2)
  c = run(c, { type: 'answered', id: carrier.id, now: 3000 }, { type: 'merge', now: 5000 })
  assert.equal(c.held, false)
  assert.equal(lineCount(c), 3, 'VA + client + carrier')
  assert.equal(heldFor(c, 9000), 4000, 'the held time counted the wait')
})

test('merge brings in the agent too (four on the line), and drop takes one person off', () => {
  let c = newCall(who, 0)
  c = run(c, { type: 'add', party: carrier }, { type: 'answered', id: carrier.id }, { type: 'merge' },
    { type: 'add', party: agent }, { type: 'answered', id: agent.id }, { type: 'merge' })
  assert.deepEqual(onLine(c).map(p => p.name), ['Gloria Price', 'Globe Life', 'Dana Walker'])
  c = r(c, { type: 'drop', id: carrier.id })
  assert.deepEqual(onLine(c).map(p => p.name), ['Gloria Price', 'Dana Walker'])
  assert.equal(c.end, null, 'the call keeps going')
})

test('dropping someone still ringing takes the hold off; dropping the last person ends the call', () => {
  let c = run(newCall(who, 0), { type: 'add', party: carrier, now: 100 }, { type: 'drop', id: carrier.id, now: 600 })
  assert.equal(c.held, false)
  assert.equal(c.parties.length, 1)
  c = r(c, { type: 'drop', id: who.key, now: 900 })
  assert.equal(c.end, 900)
})

test('the same person cannot be added twice; merge with nobody waiting does nothing', () => {
  const c = run(newCall(who, 0), { type: 'add', party: carrier })
  assert.equal(r(c, { type: 'add', party: carrier }), c)
  const d = newCall(who, 0)
  assert.equal(r(d, { type: 'merge' }), d)
})

test('hold shows a running held time and keeps the total across holds', () => {
  let c = run(newCall(who, 0), { type: 'hold', now: 1000 })
  assert.equal(heldFor(c, 4000), 3000)
  c = run(c, { type: 'hold', now: 5000 }, { type: 'hold', now: 10000 }, { type: 'hold', now: 12000 })
  assert.equal(heldFor(c, 20000), 6000)
})

test('live transfer: Check agent → Sent → Seen → Yes → cold transfer; the VA drops when the agent picks up', () => {
  let c = run(newCall({ ...who, role: 'lead' }, 0), { type: 'check', agent: 'ag-dana' }, { type: 'xfer', step: 'seen' }, { type: 'xfer', step: 'yes' }, { type: 'transfer' })
  assert.equal(c.xfer.step, 'ringing')
  c = r(c, { type: 'picked', now: 50 })
  assert.equal(c.end, 50)
  assert.equal(c.outcome, 'transferred')
})

test('live transfer: no pick-up bounces the call back to the VA, who is still on it', () => {
  const c = run(newCall({ ...who, role: 'lead' }, 0), { type: 'check', agent: 'ag-marcus' }, { type: 'xfer', step: 'yes' }, { type: 'transfer' }, { type: 'bounce' })
  assert.equal(c.xfer.step, 'bounced')
  assert.equal(c.end, null)
  assert.equal(r(c, { type: 'picked' }), c, 'a late pick-up after the bounce does nothing')
})

test('transfer can only start after a Yes', () => {
  const c = run(newCall(who, 0), { type: 'check', agent: 'ag-dana' }, { type: 'xfer', step: 'no' })
  assert.equal(r(c, { type: 'transfer' }), c)
})
