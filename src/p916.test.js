// P916 — Deedstone on every call: the agent's Call (their phone first, the client sees Deedstone), Connect your phone,
// admin Settings → Deedstone numbers, and the pool warning. Logic is tested directly; screens by their source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stepOf, endWords, targetOf, callBody, codeOk, e164, shown, NOT_ON_YET, CODE_WORDS, callDeedstone } from './lib/deedstoneCall.js'
import { SAMPLE_POOL, poolWarning, isHot, isFull, shownPhone, barOf, BRANDING_STEPS, CALLER_NAME } from './lib/deedstonePool.js'
import { SAMPLE_DEEDSTONE, SAMPLE_CODE, SAMPLE_STEPS } from './template/deedstone.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('call steps say where the call is, in the agent\'s words', () => {
  assert.deepEqual(stepOf('calling_agent', 'Lou Lead'), { title: 'Calling your phone', sub: 'Answer it, then press 1. We’ll dial Lou from Deedstone.' })
  assert.equal(stepOf('calling_client', 'Lou Lead').title, 'Ringing Lou')
  assert.equal(stepOf('live', 'Lou Lead').title, 'On the call with Lou')
  assert.equal(endWords('client_no_answer', 'Lou Lead'), 'Lou didn’t answer.')
  assert.equal(endWords('agent_no_answer'), 'Your phone didn’t answer, so we didn’t dial them.')
  assert.equal(endWords('predial_outside_hours'), 'They can’t be called right now.')
  assert.deepEqual(NOT_ON_YET, ['voice_off', 'not_configured', 'no_number'])
})

test('a Call target: a lead by lead id, a client by policy id', () => {
  const lead = targetOf('lead', { id: 'l1', first_name: 'Lou', last_name: 'Lead', phone: '(214) 555-0301', rawPhone: '+12145550301' })
  assert.deepEqual(lead, { kind: 'lead', id: 'l1', name: 'Lou Lead', phone: '+12145550301' })
  assert.deepEqual(callBody(lead), { lead_id: 'l1' })
  const client = targetOf('client', { id: 'p1', client_first_name: 'Ann', client_last_name: 'Alpha', client_phone: '(512) 555-0101' })
  assert.deepEqual(callBody(client), { policy_id: 'p1' })
  assert.equal(targetOf('lead', null), null)
})

test('phones and codes', () => {
  assert.equal(e164('(214) 555-0100'), '+12145550100')
  assert.equal(e164('1 214 555 0100'), '+12145550100')
  assert.equal(e164('014 555 0100'), null)
  assert.equal(shown('+12145550100'), '(214) 555-0100')
  assert.equal(codeOk('481516'), true)
  assert.equal(codeOk('4815'), false)
  assert.ok(CODE_WORDS.wrong_code && CODE_WORDS.expired && CODE_WORDS.too_many_tries)
})

test('callDeedstone unwraps the refusal (code and when it can go)', async () => {
  const db = { functions: { invoke: async () => ({ error: { message: 'x', context: { json: async () => ({ error: 'Can\'t call now: No consent to call on file.', code: 'no_consent', next_at: null }) } } }) } }
  await assert.rejects(callDeedstone(db, 'agent_call', { lead_id: 'l1' }), e => e.code === 'no_consent' && /No consent/.test(e.message))
  const ok = { functions: { invoke: async (fn, { body }) => ({ data: { fn, body } }) } }
  assert.deepEqual(await callDeedstone(ok, 'agent_call', { lead_id: 'l1' }), { fn: 'fulfillment-call', body: { action: 'agent_call', lead_id: 'l1' } })
})

test('sample: connect a phone with the sample code; Call needs a phone; steps play out', async () => {
  await SAMPLE_DEEDSTONE.disconnect()
  await assert.rejects(SAMPLE_DEEDSTONE.call({ kind: 'lead', id: 'l1', name: 'Lou', phone: '+12145550301' }), e => e.code === 'no_agent_phone')
  await SAMPLE_DEEDSTONE.sendCode('(214) 555-0199')
  assert.equal((await SAMPLE_DEEDSTONE.confirm('000000')).reason, 'wrong_code')
  assert.equal((await SAMPLE_DEEDSTONE.confirm(SAMPLE_CODE)).ok, true)
  const r = await SAMPLE_DEEDSTONE.call({ kind: 'lead', id: 'l1', name: 'Lou', phone: '+12145550301' })
  assert.ok(r.call_id)
  assert.deepEqual(SAMPLE_STEPS.map(s => s[0]), ['calling_agent', 'agent_on', 'calling_client', 'live'])
  await assert.rejects(SAMPLE_DEEDSTONE.sendCode('12'), e => e.code === 'bad_phone')
})

test('the pool: hot at 90% of the limit, full when a new agent would pass it, one warning', () => {
  const [n1, n2, n3] = SAMPLE_POOL.numbers
  assert.equal(isHot(n1, 120), true)
  assert.equal(isHot(n2, 120), false)
  assert.equal(isFull(n2, 120, 30), false)
  assert.equal(isFull({ load: 100 }, 120, 30), true)
  assert.match(poolWarning(SAMPLE_POOL).text, /\(214\) 555-0101 is running hot/)
  assert.match(poolWarning({ ...SAMPLE_POOL, numbers: [] }).text, /No Deedstone numbers yet/)
  assert.match(poolWarning({ ...SAMPLE_POOL, numbers: [n1] }).text, /^Add a number/)
  assert.equal(poolWarning({ ...SAMPLE_POOL, numbers: [n3] }), null)
  assert.equal(shownPhone('+14695550103'), '(469) 555-0103')
  assert.equal(barOf(240, 120), 1)
  assert.equal(CALLER_NAME, 'DEEDSTONE INS')
  assert.ok(BRANDING_STEPS.some(([t]) => /STIR\/SHAKEN/.test(t)) && BRANDING_STEPS.some(([, s]) => /Free Caller Registry/.test(s)))
})

test('every agent Call goes through Deedstone: desktop drawers, phone build, the call-me nudges', () => {
  assert.match(src('./template/CallOrCopy.jsx'), /DeedstoneCallButton/)
  // P929: no Call on a desktop drawer (calls go out from the agent's phone); the number and Copy stay.
  for (const f of ['Clients', 'Leads']) assert.match(src(`./template/screens/${f}.jsx`), /<CallOr(Copy)? phone=\{[^}]+\} target=\{null\}/, f)
  assert.equal(/DeedstoneCallButton/.test(src('./template/screens/Leads.jsx')), false, 'no desktop Call on the lead drawer')
  const bits = src('./template/m/bits.jsx')
  assert.match(bits, /if \(to\) return <DeedstoneCallButton/)
  for (const f of ['MLeads', 'MClients', 'MCalendar', 'MOverview']) assert.match(src(`./template/m/${f}.jsx`), /<CallBtn [^>]*to=\{targetOf\(/, f)
  assert.equal(/href=\{`tel:/.test(src('./template/m/MLeads.jsx')), false, 'no raw tap-to-call on the lead sheet')
  assert.match(src('./template/AgentShell.jsx'), /<DeedstoneCallProvider>/)
  // The agent never sees the Deedstone number or the pool.
  for (const f of ['./template/DeedstoneCall.jsx', './template/DeedstonePhone.jsx']) assert.equal(/from_number|number_id|admin_deedstone/.test(src(f)), false, f)
})

test('Settings: "Your phone for Deedstone calls" on Hours and calls; ?tab=calls opens it', () => {
  const s = src('./template/screens/Settings.jsx')
  assert.match(s, /<DeedstonePhone \/>/)
  assert.match(s, /get\('tab'\)/)
  const p = src('./template/DeedstonePhone.jsx')
  assert.match(p, /Your phone for Deedstone calls/)
  assert.match(p, /Call me with a code/)
  assert.match(p, /autoComplete="one-time-code"/)
})

test('admin Settings → Deedstone numbers: tab, sample tag, limits, add, voice URL, branding steps', () => {
  const s = src('./adminshell/screens/Settings.jsx')
  assert.match(s, /\['numbers', 'Deedstone numbers', PhoneCall\]/)
  assert.match(s, /tab === 'numbers' && <DeedstoneNumbers \/>/)
  const n = src('./adminshell/screens/Numbers916.jsx')
  for (const w of ['Calls a day per number', 'Add number', 'VOICE_URL', 'BRANDING_STEPS', 'SampleTag', 'calls today']) assert.ok(n.includes(w), w)
  assert.match(src('./hooks/deedstoneAdmin.js'), /admin_deedstone_numbers/)
})

test('migration 255: additive, nothing applied by itself, voice_live untouched', () => {
  const m = src('../supabase/migrations/255_deedstone_numbers.sql')
  assert.equal(/\bdrop table\b|\bdrop column\b|truncate|voice_live\s*=/i.test(m), false)
  assert.match(m, /caller_name\s+text not null default 'DEEDSTONE INS'/)
  assert.match(m, /deedstone_daily_limit int not null default 120/)
})
