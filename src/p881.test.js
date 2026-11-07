// P881 — the licence check on the agent side and the VA gates (sample model + the real client in src/lib/nipr.js).
// N-H-07 verified states only · N-H-08 name / other account → review · N-H-09 not found / registry down → retry or
// manual review, setup carries on · N-H-10 no life licence = no leads, account kept · N-H-12 expiry reminders ·
// N-H-36 / Q61 New York · N-C-22 booking and transfer blocked outside the licence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_LICENCE, sampleLookup, applyResult, verifiedStates, licenceReady, licenceCanGoOn, blockedWhy, expiringSoon,
  goodLicence, SAMPLE_REGISTRY,
} from './template/licenceModel.js'
import { toLicenceValue, sendForReview, checkNpn, saveLeadStates } from './lib/nipr.js'
import { agentCheck, licensedIn } from './template/ful/p879.js'
import { missingFields } from './template/submitModel.js'

const ACCOUNT = 'Dana Whitfield'
const checked = npn => applyResult({ ...EMPTY_LICENCE, npn }, sampleLookup(npn, ACCOUNT), 'Nov 7, 2:14 PM')

test('N-H-07: only active life states are verified; NY, no-life, expired and lapsed are not', () => {
  const v = checked('19283746')
  assert.equal(v.status, 'verified')
  const ok = verifiedStates(v)
  for (const s of ['TX', 'FL', 'AZ', 'CA']) assert.ok(ok.includes(s), s)
  for (const s of ['NY', 'OH', 'IL']) assert.ok(!ok.includes(s), s)
  const why = st => blockedWhy(SAMPLE_REGISTRY['19283746'].find(l => l.state === st))
  assert.match(why('NY'), /New York/)
  assert.match(why('OH'), /No life line/)
  assert.match(why('IL'), /Dropped/)
  assert.equal(why('TX'), null)
  assert.ok(!goodLicence({ state: 'TX', active: true, life: true, expires_on: '2026-11-01' }, '2026-11-07'), 'expired')
})

test('setup licence step: done only with a verified state picked and attested', () => {
  const v = checked('19283746')
  assert.equal(licenceReady(v), false, 'nothing picked yet')
  const picked = { ...v, states: ['TX'], attested: {} }
  assert.equal(licenceReady(picked), false, 'no yes yet')
  assert.equal(licenceReady({ ...picked, attested: { TX: 'now' } }), true)
  assert.equal(licenceReady({ ...v, states: ['OH'], attested: { OH: 'now' } }), false, 'a non-life state never counts')
  // A re-check that drops a picked state drops the pick and its yes.
  const after = applyResult({ ...v, states: ['TX', 'FL'], attested: { TX: 'a', FL: 'b' } },
    { status: 'verified', name: 'X', licences: v.licences.filter(l => l.state !== 'FL') }, 'later')
  assert.deepEqual(after.states, ['TX'])
  assert.deepEqual(Object.keys(after.attested), ['TX'])
})

test('N-H-08/09/10: not found, registry down, name mismatch, another account, no life line', () => {
  const nf = checked('11111111'), down = checked('22222222'), mm = checked('33333333'), nl = checked('44444444'), dup = checked('55555555')
  assert.deepEqual([nf.status, down.status, mm.status, nl.status, dup.status], ['not_found', 'registry_down', 'mismatch', 'no_life', 'duplicate'])
  // not found / down: can't carry on until sent for review (retry or upload)
  assert.equal(licenceCanGoOn(nf), false)
  assert.equal(licenceCanGoOn({ ...nf, status: 'review', review: { reason: 'not_found' } }), true)
  // mismatch / other account: an admin review opens by itself; setup carries on, leads wait
  assert.equal(mm.review.reason, 'mismatch')
  assert.equal(dup.review.reason, 'duplicate')
  assert.ok(licenceCanGoOn(mm) && !licenceReady(mm))
  assert.deepEqual(verifiedStates(mm), [], 'nothing verified on a mismatch')
  // no life licence: the account stays (setup carries on), but no leads
  assert.ok(licenceCanGoOn(nl) && !licenceReady(nl) && verifiedStates(nl).length === 0)
  assert.equal(sampleLookup('12', ACCOUNT).status, 'invalid')
})

test('N-H-12: expiring within 30 days is flagged', () => {
  const soon = expiringSoon(checked('19283746'), '2026-11-07')
  assert.deepEqual(soon.map(x => [x.state, x.days]), [['FL', 20]])
})

test('N-C-22: the VA can only check or book an agent licensed in the lead\'s state', () => {
  const dana = { states: ['TX', 'OK'], liveCalls: true, app: true, hours: true, free: true, notChecking: true, notPaused: true }
  assert.equal(licensedIn(dana, 'TX'), true)
  assert.equal(licensedIn(dana, 'FL'), false)
  assert.equal(licensedIn({ states: ['NY'] }, 'NY'), false, 'Q61: never New York')
  assert.deepEqual(agentCheck(dana, 'FL'), { ok: false, why: 'Not licensed in this state', bookOk: false })
  assert.deepEqual(agentCheck(dana, null), { ok: false, why: "Confirm the lead's state first", bookOk: false })
})

test('N-D-06: Submit checks against verified states, not the picked lead states', () => {
  const v = { ...checked('19283746'), states: ['TX'] }
  const f = { name: 'A B', phone: '5125550100', dob: '1950-01-01', carrier: 'Foresters', state: 'CA' }
  assert.ok(!missingFields(f, { licensed: verifiedStates(v) }).includes('licence'), 'CA is verified though not picked for leads')
  assert.ok(missingFields({ ...f, state: 'OH' }, { licensed: verifiedStates(v) }).includes('licence'))
})

// ── the real client ─────────────────────────────────────────────────────────
const VIEW = {
  npn: '1234567', status: 'verified', name: 'JANE DOE', checked_at: '2026-11-07T12:00:00Z', gate_on: true, ready: true,
  states: ['TX'], review: null,
  licences: [
    { state: 'TX', active: true, life: true, verified: true, source: 'nipr', expires_on: '2028-01-01', number: 'T1', lapsed_at: null },
    { state: 'FL', active: false, life: false, verified: true, source: 'nipr', expires_on: '2028-01-01', number: 'F1', lapsed_at: '2026-11-06T12:00:00Z' },
    { state: 'GA', active: false, life: false, verified: false, source: 'self', expires_on: null, number: null, lapsed_at: null },
  ],
}

test('toLicenceValue: server view → form value; self rows hidden, lapse kept, picks trimmed to verified', () => {
  const v = toLicenceValue(VIEW, { states: ['TX', 'FL'], attested: { TX: 'a', FL: 'b' } })
  assert.deepEqual(v.licences.map(l => l.state), ['TX', 'FL'])
  assert.equal(v.licences[1].lapsed_at, '2026-11-06')
  assert.deepEqual(v.states, ['TX'])
  assert.deepEqual(v.attested, { TX: 'a' })
  assert.deepEqual(verifiedStates(v, '2026-11-07'), ['TX'])
  assert.equal(toLicenceValue(null), null)
})

function fakeDb({ fnError = null, rpcError = null, upError = null, upsertError = null } = {}) {
  const calls = []
  return {
    calls,
    functions: { invoke: async (name, opts) => { calls.push(['fn', name, opts.body]); return fnError ? { data: null, error: fnError } : { data: { status: 'verified', message: 'm', registry: 'connected', licence: VIEW }, error: null } } },
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return rpcError ? { data: null, error: rpcError } : { data: 'rev-1', error: null } },
    storage: { from: b => ({ upload: async (path, file, o) => { calls.push(['up', b, path, o.contentType]); return { error: upError } } }) },
    from: t => ({ upsert: async (row, o) => { calls.push(['upsert', t, row, o]); return { error: upsertError } } }),
  }
}

test('checkNpn / sendForReview / saveLeadStates', async () => {
  const db = fakeDb()
  const r = await checkNpn(db, '1234567', { states: ['TX'] })
  assert.deepEqual(db.calls[0], ['fn', 'nipr-check', { action: 'check', npn: '1234567' }])
  assert.equal(r.value.status, 'verified')

  const bad = fakeDb({ fnError: { context: { json: async () => ({ status: 'invalid', message: 'An NPN is 6 to 10 digits.' }) } } })
  await assert.rejects(checkNpn(bad, '12'), /6 to 10 digits/)

  const db2 = fakeDb()
  const out = await sendForReview(db2, 'u1', { reason: 'not_found', states: ['GA'], file: { name: 'My Licence (GA).PDF', type: 'application/pdf' }, now: 5 })
  assert.equal(out.path, 'u1/5-my-licence-ga-.pdf')
  assert.deepEqual(db2.calls[0], ['up', 'licence-docs', 'u1/5-my-licence-ga-.pdf', 'application/pdf'])
  assert.deepEqual(db2.calls[1], ['rpc', 'licence_review_request', { p_reason: 'not_found', p_states: ['GA'], p_document_path: 'u1/5-my-licence-ga-.pdf', p_note: null }])
  await assert.rejects(sendForReview(fakeDb({ upError: new Error('too big') }), 'u1', { reason: 'other', file: { name: 'x.png' } }), /too big/)

  await assert.rejects(saveLeadStates(fakeDb({ upsertError: { hint: 'not_verified_state', message: 'You can only pick states where your life licence is verified (OH).' } }), 'u1', ['OH']), /verified \(OH\)/)
})
