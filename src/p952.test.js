// P952 — reactivation through the AI caller's core (supabase/functions/ai-caller/core.ts), with fakes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider } from '../supabase/functions/ai-caller/providers.ts'
import { REACT_OPENER as EDGE_OPENER } from '../supabase/functions/ai-caller/reactivation.js'
import { REACT_OPENER } from './lib/reactivation.js'

function fakes({ live = false, takes = { by: 'ai', reason: null }, ds = { phone: '+15125550199', providerId: null, pool: 'reactivation' }, voicemailLeft = false } = {}) {
  const log = []
  let vars = null, from = null
  const call = { id: '11111111-1111-4111-8111-111111111111', lead_id: 'l1', agent_id: 'ag-1', attempt: 2, status: 'queued' }
  const store = {
    live: async () => ({ on: live, maxSecs: 300 }),
    call: async () => ({ ...call }),
    lead: async () => ({ id: 'l1', first: 'Ann', phone: '+15125556001', state: 'TX', tz: null, need: null, age: null, reactivation: { voicemailLeft } }),
    agent: async () => ({ id: 'ag-1', first: 'Nate', phone: '+15125550100' }),
    takes: async () => takes,
    toVa: async (_id, reason) => { log.push(['toVa', reason]) },
    status: async (_id, st) => { log.push(['status', st]) },
    result: async (_id, o) => { log.push(['result', o]) },
    deedstoneFrom: async () => ds,
  }
  const provider = { ...noProvider(), key: 'retell', ready: true, start: async a => { vars = a.vars; from = a.from; return { providerCallId: 'rc1' } } }
  const env = { now: () => Date.now(), from: '+18005550110', words: { opening: 'Hi {first}' } }
  return { store, provider, env, log, call, got: () => ({ vars, from }) }
}

test('the opener is the same in the portal and the edge function', () => {
  assert.equal(EDGE_OPENER, REACT_OPENER)
})

test('a reactivation call: own switch (not the fresh-lead one), reactivation opener, reactivation number', async () => {
  const f = fakes({ live: false })
  const r = await core.start(f.store, f.provider, f.env, f.call.id)
  assert.equal(r.ok, true)
  assert.match(f.got().vars.opening, /^Hey Ann, this is Max with Deedstone Insurance\. A while back you’d asked about mortgage protection/)
  assert.equal(f.got().vars.reactivation, 'yes')
  assert.equal(f.got().vars.leave_voicemail, 'yes')
  assert.equal(f.got().from, '+15125550199')
})

test('no reactivation number: the call never falls back to a fresh-lead number', async () => {
  const f = fakes({ ds: { phone: '', providerId: null, pool: 'reactivation' } })
  const r = await core.start(f.store, f.provider, f.env, f.call.id)
  assert.equal(r.ok, false)
  assert.deepEqual(f.log[0], ['toVa', 'not_connected']) // the database puts it back in line (never a VA)
  assert.equal(f.got().from, null)
})

test('the rules say no (flag off, outside hours, do-not-call): nothing dials', async () => {
  for (const reason of ['switch_off', 'outside_hours', 'dnc', 'list_paused']) {
    const f = fakes({ takes: { by: 'va', reason } })
    await core.start(f.store, f.provider, f.env, f.call.id)
    assert.deepEqual(f.log[0], ['toVa', reason])
    assert.equal(f.got().vars, null)
  }
})

test('a voicemail was already left: this call is told not to leave another', async () => {
  const f = fakes({ voicemailLeft: true })
  await core.start(f.store, f.provider, f.env, f.call.id)
  assert.equal(f.got().vars.leave_voicemail, 'no')
})
