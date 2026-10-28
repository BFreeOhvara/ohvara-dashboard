/**
 * Unit tests for the lead follow-up texts. Everything is faked: no database,
 * no Twilio, no network. Every "nothing sent" case counts calls to the fake
 * `send`, not just the returned status.
 * Run: deno test --node-modules-dir=none supabase/functions/lead-followup-sms/
 *  or: node --test supabase/functions/lead-followup-sms/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { handle, stageFor, MAX_TEXTS_PER_LEAD, type Deps, type Lead, type LogRow, type Sender, type Stage } from './core.ts'
import { DRAFT_JUST_SUBMITTED, DRAFT_NOT_REACHED, DRAFT_REACHED, TEMPLATES } from './templates.ts'
import { inWindow, stateWindow, zonesForState } from '../_shared/smsWindow.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const AGENT = '22222222-2222-4222-8222-222222222222'
const SENDER: Sender = { from_number: '+13125550100', messaging_service_sid: 'MGagent', brand_name: 'Sam Lee Insurance' }
// Noon in Chicago (CDT, UTC-5) on a weekday; the lead is in Illinois.
const NOON = new Date('2026-10-28T12:00:00-05:00')

// A lead status that lands in each stage. opted_out keeps status 'New': the
// opt-out alone puts it there.
const STATUS: Record<Stage, string> = {
  just_submitted: 'New', not_reached: 'No Answer', reached: 'Contacted', opted_out: 'New',
}
const STAGES: Stage[] = ['just_submitted', 'not_reached', 'reached', 'opted_out']
const SENDABLE: Stage[] = ['just_submitted', 'not_reached', 'reached']

function make(stage: Stage, over: Partial<Deps> = {}, lead: Partial<Lead> = {}) {
  const sent: { to: string; body: string; from: Sender }[] = []
  const logs: LogRow[] = []
  const deps: Deps = {
    smsLive: async () => true,
    getLead: async () => ({
      id: ID, lead_type: 'mortgage_protection', status: STATUS[stage], phone: '(312) 555-1234',
      contact_name: 'Maria Lopez', state: 'IL', agent_id: AGENT, agent_name: 'Sam Lee', ...lead,
    }),
    optedOut: async () => stage === 'opted_out',
    sentStages: async () => [],
    getSender: async () => SENDER,
    now: () => NOON,
    bookingLink: null,
    send: async (to, body, from) => { sent.push({ to, body, from }); return { ok: true, sid: 'SMstub' } },
    log: async r => { logs.push(r) },
    ...over,
  }
  return { deps, sent, logs, run: () => handle(deps, { lead_id: ID }) }
}

const body = (r: Awaited<ReturnType<typeof handle>>) => r.body as { status: string; stage?: string | null }

// ── the four stages ─────────────────────────────────────────────────────────
test('stageFor: opt-out wins; New / No Answer / reached statuses; anything else is no stage', () => {
  assert.equal(stageFor('New', true), 'opted_out')
  assert.equal(stageFor('Contacted', true), 'opted_out')
  assert.equal(stageFor('New', false), 'just_submitted')
  assert.equal(stageFor('No Answer', false), 'not_reached')
  for (const s of ['Contacted', 'Follow-Up', 'Booked', 'Appointment Booked']) assert.equal(stageFor(s, false), 'reached')
  for (const s of ['Not Interested', 'Closed', null]) assert.equal(stageFor(s, false), null)
})

for (const stage of STAGES) {
  test(`${stage}: sms_live off → skipped_gate, send called 0 times`, async () => {
    const t = make(stage, { smsLive: async () => false })
    assert.deepEqual(body(await t.run()), { status: 'skipped_gate', stage })
    assert.equal(t.sent.length, 0)
    assert.deepEqual(t.logs.map(l => [l.stage, l.status]), [[stage, 'skipped_gate']])
  })

  test(`${stage}: opted-out number → skipped_opt_out, send called 0 times`, async () => {
    // Status stays whatever this stage's status is ('New' for opted_out).
    const t = make(stage, { optedOut: async () => true })
    assert.deepEqual(body(await t.run()), { status: 'skipped_opt_out', stage: 'opted_out' })
    assert.equal(t.sent.length, 0)
    assert.deepEqual(t.logs.map(l => l.status), ['skipped_opt_out'])
  })

  test(`${stage}: no assigned agent → nothing sent`, async () => {
    const t = make(stage, {}, { agent_id: null, agent_name: null })
    const want = stage === 'opted_out' ? 'skipped_opt_out' : 'skipped_no_agent'
    assert.equal(body(await t.run()).status, want)
    assert.equal(t.sent.length, 0)
  })

  test(`${stage}: agent has no sending number → nothing sent`, async () => {
    const t = make(stage, { getSender: async () => null })
    const want = stage === 'opted_out' ? 'skipped_opt_out' : 'skipped_no_sender'
    assert.equal(body(await t.run()).status, want)
    assert.equal(t.sent.length, 0)
  })
}

test('an agent with an id but no name → skipped_no_agent, send 0', async () => {
  const t = make('just_submitted', {}, { agent_name: '  ' })
  assert.equal(body(await t.run()).status, 'skipped_no_agent')
  assert.equal(t.sent.length, 0)
})

test('a sender row without a number → skipped_no_sender, send 0', async () => {
  const t = make('reached', { getSender: async () => ({ ...SENDER, from_number: '' }) })
  assert.equal(body(await t.run()).status, 'skipped_no_sender')
  assert.equal(t.sent.length, 0)
})

// ── quiet hours (8:00 AM inclusive to 9:00 PM exclusive, client time) ──────
const at = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00-05:00`)   // Chicago, CDT
for (const stage of SENDABLE) {
  for (const [hhmm, label] of [['07:59', '7:59 AM'], ['21:00', '9:00 PM']]) {
    test(`${stage}: ${label} client time → skipped_quiet_hours, send 0`, async () => {
      const t = make(stage, { now: () => at(hhmm) })
      assert.equal(body(await t.run()).status, 'skipped_quiet_hours')
      assert.equal(t.sent.length, 0)
    })
  }
  for (const [hhmm, label] of [['08:00', '8:00 AM'], ['20:59', '8:59 PM']]) {
    test(`${stage}: ${label} client time → sent once`, async () => {
      const t = make(stage, { now: () => at(hhmm) })
      assert.equal(body(await t.run()).status, 'sent')
      assert.equal(t.sent.length, 1)
    })
  }
}

test('quiet hours use the lead\'s zone, not the server\'s: 8:30 AM Chicago is 9:30 AM New York', async () => {
  let t = make('just_submitted', { now: () => at('07:30') }, { state: 'NY' })   // 8:30 AM ET
  assert.equal(body(await t.run()).status, 'sent')
  t = make('just_submitted', { now: () => at('07:30') }, { state: 'CA' })       // 5:30 AM PT
  assert.equal(body(await t.run()).status, 'skipped_quiet_hours')
  assert.equal(t.sent.length, 0)
})

test('unknown zone → skipped (unknown_zone), send 0', async () => {
  for (const state of [null, '', 'ZZ', 'Illinois']) {
    const t = make('just_submitted', {}, { state })
    assert.equal(body(await t.run()).status, 'skipped_quiet_hours')
    assert.equal(t.logs[0].error, 'unknown_zone')
    assert.equal(t.sent.length, 0)
  }
})

test('a state in two zones must be inside the window in both (TX: Chicago and Denver)', async () => {
  let t = make('reached', { now: () => at('08:30') }, { state: 'TX' })   // 7:30 AM in El Paso
  assert.equal(body(await t.run()).status, 'skipped_quiet_hours')
  assert.equal(t.sent.length, 0)
  t = make('reached', { now: () => at('09:00') }, { state: 'tx' })       // 8:00 AM in El Paso
  assert.equal(body(await t.run()).status, 'sent')
  assert.equal(t.sent.length, 1)
})

test('smsWindow helper: boundaries match sms_check', () => {
  const tz = 'America/Chicago'
  assert.equal(inWindow(at('07:59'), tz), false)
  assert.equal(inWindow(at('08:00'), tz), true)
  assert.equal(inWindow(at('20:59'), tz), true)
  assert.equal(inWindow(at('21:00'), tz), false)
  assert.equal(inWindow(at('00:00'), tz), false)
  assert.deepEqual(zonesForState(' il '), ['America/Chicago'])
  assert.equal(zonesForState('XX'), null)
  assert.equal(stateWindow(NOON, undefined), 'unknown_zone')
})

// ── once per stage, 4 per lead ──────────────────────────────────────────────
test('stage already sent → duplicate, send 0, nothing logged', async () => {
  for (const stage of SENDABLE) {
    const t = make(stage, { sentStages: async () => [stage] })
    assert.deepEqual(body(await t.run()), { status: 'duplicate', stage })
    assert.equal(t.sent.length, 0)
    assert.equal(t.logs.length, 0)
  }
})

test(`cap: ${MAX_TEXTS_PER_LEAD} texts already sent to the lead → skipped_cap, send 0`, async () => {
  assert.equal(MAX_TEXTS_PER_LEAD, 4)
  let t = make('reached', { sentStages: async () => ['just_submitted', 'not_reached', 'va_reply', 'va_reply'] })
  assert.equal(body(await t.run()).status, 'skipped_cap')
  assert.equal(t.sent.length, 0)
  t = make('reached', { sentStages: async () => ['just_submitted', 'not_reached', 'va_reply'] })   // 3: one left
  assert.equal(body(await t.run()).status, 'sent')
  assert.equal(t.sent.length, 1)
})

// ── the other skips ─────────────────────────────────────────────────────────
test('not mortgage_protection → skipped_not_mp, send 0, even with sms_live on', async () => {
  for (const lead_type of ['cancellation', 'policy_help', null]) {
    const t = make('just_submitted', {}, { lead_type })
    assert.equal(body(await t.run()).status, 'skipped_not_mp')
    assert.equal(t.sent.length, 0)
  }
})

test('a status with no stage → skipped_no_stage, send 0', async () => {
  const t = make('just_submitted', {}, { status: 'Not Interested' })
  assert.deepEqual(body(await t.run()), { status: 'skipped_no_stage', stage: null })
  assert.equal(t.sent.length, 0)
})

test('no phone or a bad phone → skipped_no_phone, send 0, opt-out not looked up', async () => {
  for (const phone of [null, '555-12']) {
    let looked = 0
    const t = make('just_submitted', { optedOut: async () => { looked++; return false } }, { phone })
    assert.equal(body(await t.run()).status, 'skipped_no_phone')
    assert.equal(t.sent.length, 0)
    assert.equal(looked, 0)
  }
})

test('a template that needs a link and no LEAD_BOOKING_URL → skipped_no_link, send 0', async () => {
  const withLink = { ...TEMPLATES, not_reached: { body: 'Hi [Lead first name], [Agent first name] here. Pick a time: [Booking link]. Reply STOP to opt out.', needsLink: true } }
  let t = make('not_reached', { templates: withLink })
  assert.equal(body(await t.run()).status, 'skipped_no_link')
  assert.equal(t.sent.length, 0)
  t = make('not_reached', { templates: withLink, bookingLink: 'https://example.test/book' })
  assert.equal(body(await t.run()).status, 'sent')
  assert.equal(t.sent[0].body, 'Hi Maria, Sam here. Pick a time: https://example.test/book. Reply STOP to opt out.')
})

test('bad id → 400; missing lead → 404; send 0', async () => {
  let t = make('just_submitted')
  assert.equal((await handle(t.deps, { lead_id: 'nope' })).status, 400)
  t = make('just_submitted', { getLead: async () => null })
  assert.equal((await t.run()).status, 404)
  assert.equal(t.sent.length, 0)
})

test('Twilio error → failed is logged with the error', async () => {
  const t = make('just_submitted', { send: async () => ({ ok: false, error: '400 21610' }) })
  assert.equal(body(await t.run()).status, 'failed')
  assert.equal(t.logs[0].status, 'failed')
  assert.equal(t.logs[0].error, '400 21610')
})

// ── happy path ──────────────────────────────────────────────────────────────
const WANT: Record<string, string> = {
  just_submitted: 'Hi Maria, this is Sam, a licensed agent, texting with Ohvara about the mortgage protection info you asked for. Reply STOP to opt out.',
  not_reached: 'Hi Maria, Sam here, a licensed agent texting with Ohvara. Still want help with mortgage protection? Reply here for the next step. Reply STOP to opt out.',
  reached: 'Hi Maria, Sam here, a licensed agent texting with Ohvara. Good to talk. If you have more questions, reply here. Reply STOP to opt out.',
}
for (const stage of SENDABLE) {
  test(`${stage}: sends once, from the agent's number, naming the agent, not "Ohvara: Hi"`, async () => {
    const t = make(stage)
    assert.deepEqual(body(await t.run()), { status: 'sent', stage })
    assert.equal(t.sent.length, 1)
    const s = t.sent[0]
    assert.equal(s.to, '+13125551234')
    assert.equal(s.from.from_number, '+13125550100')
    assert.equal(s.from.messaging_service_sid, 'MGagent')
    assert.equal(s.body, WANT[stage])
    assert.ok(s.body.includes('Sam'))
    assert.ok(!s.body.startsWith('Ohvara:'))
    assert.ok(!s.body.includes('Ohvara: Hi'))
    assert.ok(s.body.endsWith('Reply STOP to opt out.'))
    assert.ok(s.body.length <= 160, `${stage} is ${s.body.length} chars`)
    assert.deepEqual(t.logs.map(l => [l.stage, l.status, l.from_number, l.twilio_sid]), [[stage, 'sent', '+13125550100', 'SMstub']])
  })
}

test('no lead first name → "Hi, …"', async () => {
  const t = make('just_submitted', {}, { contact_name: null })
  await t.run()
  assert.ok(t.sent[0].body.startsWith('Hi, this is Sam, a licensed agent'))
})

// ── the drafts and the switch ───────────────────────────────────────────────
test('templates are the vault drafts word for word (ohvara/leads/text-stage-map.md)', () => {
  assert.equal(DRAFT_JUST_SUBMITTED, 'Hi [Lead first name], this is [Agent first name], a licensed agent, texting with Ohvara about the mortgage protection info you asked for. Reply STOP to opt out.')
  assert.equal(DRAFT_NOT_REACHED, 'Hi [Lead first name], [Agent first name] here, a licensed agent texting with Ohvara. Still want help with mortgage protection? Reply here for the next step. Reply STOP to opt out.')
  assert.equal(DRAFT_REACHED, 'Hi [Lead first name], [Agent first name] here, a licensed agent texting with Ohvara. Good to talk. If you have more questions, reply here. Reply STOP to opt out.')
  assert.deepEqual(Object.keys(TEMPLATES).sort(), ['just_submitted', 'not_reached', 'reached'])
})

// Node reads the folder; plain `deno test` (no --allow-read) gets the same
// files as text imports, which need no permission.
const AS_TEXT: Record<string, () => Promise<{ default: string }>> = {
  'core.ts': () => import('./core.ts', { with: { type: 'text' } }),
  'index.ts': () => import('./index.ts', { with: { type: 'text' } }),
  'templates.ts': () => import('./templates.ts', { with: { type: 'text' } }),
  'core.test.ts': () => import('./core.test.ts', { with: { type: 'text' } }),
}
test('static: nothing under lead-followup-sms turns sms_live on', async () => {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  let files = Object.keys(AS_TEXT)
  try { files = readdirSync(dir).filter(f => /\.(ts|js|sql)$/.test(f)) } catch { /* no read permission */ }
  assert.deepEqual([...files].sort(), Object.keys(AS_TEXT).sort(), 'a new file here must be added to AS_TEXT')
  const key = 'sms' + '_live'
  const turnsOn = [
    new RegExp(`${key}['"]?\\s*[:=]\\s*true`, 'i'),
    new RegExp(`update\\([^)]*${key}`, 'i'),
    new RegExp(`set\\s+${key}`, 'i'),
  ]
  for (const f of files) {
    let src: string
    try { src = readFileSync(dir + f, 'utf8') } catch { src = (await AS_TEXT[f]()).default }
    assert.ok(src.length > 0)
    for (const re of turnsOn) assert.equal(re.test(src), false, `${f} matches ${re}`)
  }
})
