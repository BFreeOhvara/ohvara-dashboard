// P892 — AI speed to lead. The routing (in hours Yes/No, out of hours, Appointments only, no AI consent → VA, opt-out,
// no answer twice, hand-off with no VA free), the edge function's core with fakes, the words agents see, and the
// migration agreeing with the rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AI_RULES, whoCalls, aiRoute, runCall, aiStep, startState, agentLine, staffLine, aiStats, aiConsentOk, agentOn,
  SAMPLE_AI_CALLS, SAMPLE_CENTS_PER_MIN, OUTCOMES, PROVIDERS, agentPrompt, AI_QUESTIONS,
} from './lib/aiCaller.js'
import { freshLeadRoute, DEFAULT_LIVE_HOURS, DAYS } from './lib/leadSplit.js'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider } from '../supabase/functions/ai-caller/providers.ts'

const WED_9AM_CT = Date.parse('2026-11-04T15:00:00Z')
const WED_530PM_CT = Date.parse('2026-11-04T23:30:00Z')
const transferAgent = { mode: 'both', hours: DEFAULT_LIVE_HOURS, tz: 'America/Chicago', reachable: true }
const FORM = { source: 'form', consent_version: 'mp-v2', agent_id: 'ag-1' }
const ON = { live: true, agents: ['ag-1'] }
const COVERS = { 'mp-v1': false, 'mp-v2': true }
const OK = { ok: true }

test('who calls: only fresh form leads, switch on, agent on, AI consent, pre-dial ok', () => {
  assert.deepEqual(whoCalls({ settings: ON, lead: FORM, consentVersions: COVERS, predial: OK }), { by: 'ai', reason: null })
  assert.equal(whoCalls({ settings: { ...ON, live: false }, lead: FORM, consentVersions: COVERS, predial: OK }).reason, 'switch_off')
  for (const source of ['call_in', 'live_call', 'client']) assert.equal(whoCalls({ settings: ON, lead: { ...FORM, source }, consentVersions: COVERS }).reason, 'not_form', source)
  assert.equal(whoCalls({ settings: ON, lead: { ...FORM, agent_id: 'ag-2' }, consentVersions: COVERS, predial: OK }).reason, 'agent_not_on')
  assert.equal(whoCalls({ settings: { live: true, agents: 'all' }, lead: { ...FORM, agent_id: 'ag-2' }, consentVersions: COVERS, predial: OK }).by, 'ai')
  assert.equal(whoCalls({ settings: ON, lead: FORM, consentVersions: COVERS, predial: { ok: false, reason: 'outside_hours' } }).reason, 'outside_hours')
  assert.equal(agentOn(ON, null), false)
})

test('no AI consent → a VA calls (today\'s mp-v1 wording does not cover AI calls)', () => {
  const r = whoCalls({ settings: ON, lead: { ...FORM, consent_version: 'mp-v1' }, consentVersions: COVERS, predial: OK })
  assert.deepEqual(r, { by: 'va', reason: 'no_ai_consent' })
  assert.equal(aiConsentOk({ consent_version: null }, COVERS), false)
  assert.equal(aiConsentOk({ consent_version: 'unknown' }, COVERS), false)
})

test('transfer or book: the same rule as the VA desk (P889 freshLeadRoute)', () => {
  const times = [WED_9AM_CT, WED_530PM_CT, Date.parse('2026-11-07T16:00:00Z'), Date.parse('2026-11-03T13:59:00Z'), Date.parse('2026-11-03T14:00:00Z')]
  const hourSets = [DEFAULT_LIVE_HOURS, Object.fromEntries(DAYS.map(d => [d, { on: true, start: '7:00 AM', end: '9:00 PM' }]))]
  for (const t of times) for (const hours of hourSets) for (const tz of ['America/Chicago', 'America/New_York', 'America/Phoenix']) for (const mode of ['both', 'appts']) {
    assert.equal(aiRoute({ mode, hours, tz }, t).route, freshLeadRoute({ mode, hours, tz }, t).route, `${mode} ${tz} ${new Date(t).toISOString()}`)
  }
  assert.equal(aiRoute({ ...transferAgent, reachable: false }, WED_9AM_CT).route, 'book')
})

const QUAL = [{ type: 'answered' }, { type: 'qualified' }]
test('in hours, agent says Yes → cold transfer', () => {
  const r = runCall([...QUAL, { type: 'check_answer', answer: 'yes' }, { type: 'transfer_ok' }], { agent: transferAgent, nowMs: WED_9AM_CT })
  assert.equal(r.s.outcome, 'transferred')
  assert.deepEqual(r.acts, ['check_agent', 'transfer_agent', 'log'])
})

test('in hours, agent says No (or no answer in 30 s, or the push fails) → book', () => {
  for (const answer of ['no', 'none', 'fail']) {
    const r = runCall([...QUAL, { type: 'check_answer', answer }, { type: 'booked', at: '2026-11-05T23:30:00Z' }], { agent: transferAgent, nowMs: WED_9AM_CT })
    assert.equal(r.s.outcome, 'booked', answer)
    assert.deepEqual(r.acts, ['check_agent', 'book', 'end', 'log'], answer)
  }
  // Yes, but the agent doesn't pick up in about 20 s: back to the AI, who books.
  const b = runCall([...QUAL, { type: 'check_answer', answer: 'yes' }, { type: 'transfer_bounced' }, { type: 'booked', at: 'x' }], { agent: transferAgent, nowMs: WED_9AM_CT })
  assert.equal(b.s.outcome, 'booked')
})

test('out of hours → book; Appointments only → book (no Check agent)', () => {
  const out = runCall([...QUAL, { type: 'booked', at: 'x' }], { agent: transferAgent, nowMs: WED_530PM_CT })
  assert.deepEqual([out.s.outcome, out.s.routed, out.acts.includes('check_agent')], ['booked', 'out_of_hours', false])
  const appts = runCall([...QUAL, { type: 'booked', at: 'x' }], { agent: { ...transferAgent, mode: 'appts' }, nowMs: WED_9AM_CT })
  assert.deepEqual([appts.s.outcome, appts.s.routed, appts.acts.includes('check_agent')], ['booked', 'appts_only', false])
})

test('"stop calling" is honoured at once, at any point', () => {
  for (const before of [[], [{ type: 'answered' }], QUAL, [...QUAL, { type: 'check_answer', answer: 'no' }]]) {
    const r = runCall([...before, { type: 'stop' }], { agent: transferAgent, nowMs: WED_9AM_CT })
    assert.equal(r.s.outcome, 'opt_out')
    assert.ok(r.acts.includes('dnc'))
  }
})

test('no answer twice: retry in 2 minutes, then the no-answer texts and VA call tasks', () => {
  const one = runCall([{ type: 'no_answer' }], {}, 1)
  assert.deepEqual([one.s.outcome, one.s.retryInSecs, one.acts], ['no_answer', 120, ['retry', 'log']])
  const voicemail = runCall([{ type: 'voicemail' }], {}, 1)
  assert.deepEqual(voicemail.acts, ['retry', 'log'])
  const two = runCall([{ type: 'no_answer' }], {}, 2)
  assert.deepEqual([two.s.outcome, two.acts], ['no_answer', ['va_no_answer', 'log']])
})

test('hand-off: warm to a VA; nobody free in 60 s → callback task', () => {
  for (const reason of ['asked_person', 'coverage_or_price', 'confused_upset']) {
    const r = runCall([{ type: 'answered' }, { type: 'signal', reason }, { type: 'va_taken' }])
    assert.deepEqual([r.s.outcome, r.s.reason, r.acts], ['handed_to_va', reason, ['handoff', 'log']])
  }
  const failed = runCall([...QUAL, { type: 'error' }], { agent: transferAgent, nowMs: WED_9AM_CT })
  assert.equal(failed.s.reason, 'ai_failed')
  const none = runCall([{ type: 'answered' }, { type: 'signal', reason: 'asked_person' }, { type: 'va_wait', secs: 30 }, { type: 'va_wait', secs: 60 }])
  assert.deepEqual([none.s.outcome, none.s.callbackTask, none.acts], ['handed_to_va', true, ['handoff', 'callback_task', 'end', 'log']])
  // An unknown signal changes nothing.
  assert.deepEqual(aiStep(startState(), { type: 'signal', reason: 'weather' }).act, [])
})

test('agents see the speed, never "AI"; staff see who called', () => {
  for (const outcome of OUTCOMES) {
    const line = agentLine({ secs: 9, outcome })
    assert.match(line, /^Called in 9 seconds\. /)
    assert.doesNotMatch(line, /\bAI\b|virtual|assistant|robot|bot\b/i, line)
  }
  assert.equal(agentLine({ secs: 1, outcome: 'booked' }), 'Called in 1 second. Reached them. Booked')
  assert.equal(staffLine({ secs: 9, outcome: 'handed_to_va', attempt: 1 }), 'AI called in 9 s · Handed to a VA')
  // The agent sample timeline uses agentLine for its AI-called leads.
  const lc = readFileSync('src/template/leadLifecycle.js', 'utf8')
  assert.match(lc, /agentLine\(/)
})

test('admin numbers: reached %, booked, transferred, handed, average seconds, minutes, cost', () => {
  const s = aiStats(SAMPLE_AI_CALLS, SAMPLE_CENTS_PER_MIN)
  // P903 added three transfer-branch calls (no push answer, phone not answered, No then asked for a person).
  assert.equal(s.calls, 12)
  assert.equal(s.leads, 11)
  assert.equal(s.reached, 10) // Daniel never answered
  assert.equal(s.reachedPct, 91)
  assert.deepEqual([s.booked, s.transferred, s.handed, s.noAnswer, s.optOut], [4, 1, 3, 2, 1])
  assert.equal(s.avgSecs, 8)
  assert.ok(s.minutes > 27 && s.minutes < 28)
  assert.equal(s.costCents, (4 + 5 + 4 + 2 + 1 + 2 + 3 + 4 + 5 + 3) * 13)
  for (const o of OUTCOMES) assert.ok(SAMPLE_AI_CALLS.some(c => c.outcome === o), `sample for ${o}`)
  assert.equal(aiStats([]).reachedPct, 0)
})

test('the prompt asks only the VA questions and keeps off coverage, price and carriers', () => {
  const p = agentPrompt()
  for (const q of AI_QUESTIONS) assert.ok(p.includes(q))
  assert.match(p, /Never discuss coverage, prices, carriers/)
  assert.match(p, /virtual assistant/)
  assert.equal(PROVIDERS.filter(x => x.recommended).length, 1)
})

// ── The edge function's core, with fakes ─────────────────────────────────────────────────────────────────────────
function fakes({ live = true, ready = true, takes = { by: 'ai', reason: null }, agent = { id: 'ag-1', first: 'Dana', phone: '+15125550100', ...transferAgent }, slots = ['2026-11-05T23:30:00Z'], nowMs = WED_9AM_CT } = {}) {
  const log = []
  const calls = { c1: { id: '11111111-1111-4111-8111-111111111111', lead_id: 'l1', agent_id: 'ag-1', attempt: 1, status: 'queued', provider_call_id: null, check_id: null, routed: null, summary: null, booked_for: null } }
  const call = () => calls.c1
  let check = null
  const store = {
    live: async () => ({ on: live, maxSecs: 300 }),
    call: async id => (id === call().id ? { ...call() } : null),
    callByProvider: async pid => (pid === call().provider_call_id ? { ...call() } : null),
    lead: async () => ({ id: 'l1', first: 'Pat', phone: '+15125550123', state: 'TX', tz: 'America/Chicago', need: 'Mortgage protection', age: '55 to 64' }),
    agent: async () => agent,
    takes: async () => takes,
    toVa: async (_id, reason) => { log.push(['toVa', reason]); call().status = 'to_va' },
    status: async (_id, st, patch = {}) => { log.push(['status', st]); Object.assign(call(), { status: st, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) }); return call() },
    result: async (_id, outcome, patch = {}) => { log.push(['result', outcome, !!patch.callback_task]); call().status = 'done' },
    handoff: async (_id, reason) => { log.push(['handoff', reason]); call().status = 'handing_off'; return 'q1' },
    slots: async () => slots,
    book: async (_id, at) => { log.push(['book', at]); call().booked_for = at; return { ok: true } },
    insertCheck: async () => { check = { id: 'chk1', status: 'sent', answer: null, expires_at: new Date(nowMs + 30000).toISOString() }; return check },
    check: async () => check,
    sendCheck: async () => { log.push(['push']); return true },
    markCheck: async (_id, patch) => { log.push(['check', patch.status]); if (check) Object.assign(check, patch) },
    clearCheck: async (_c, _a, why) => { log.push(['clear', why]) },
    lineConference: async () => 'line-abc',
  }
  const provider = { ...noProvider(), key: 'retell', ready, start: async () => ({ providerCallId: 'rc1' }), transfer: async (_id, to) => { log.push(['transfer', to]) }, say: async () => { log.push(['say']) }, parse: b => b, toolReply: (_t, r) => r }
  const env = { now: () => nowMs, from: '+18005550110', bridgeNumber: '+18005550111', words: { opening: 'Hi {first}', hold: 'hold', toPerson: 'person', noPerson: 'none free' } }
  return { store, provider, env, log, call, setCheck: patch => Object.assign(check, patch) }
}
const ev = (f, type, extra = {}) => core.onEvent(f.store, f.provider, f.env, { providerCallId: 'rc1', callId: f.call().id, type, ...extra })
const tool = (f, name, args = {}) => ev(f, 'tool', { name, args, toolCallId: null })

test('core: not connected, switch off, or rules changed → the lead goes to a VA', async () => {
  for (const [opts, why] of [[{ ready: false }, 'not_connected'], [{ live: false }, 'switch_off'], [{ takes: { by: 'va', reason: 'no_ai_consent' } }, 'no_ai_consent']]) {
    const f = fakes(opts)
    await core.start(f.store, f.provider, f.env, f.call().id)
    assert.deepEqual(f.log[0], ['toVa', why])
  }
})

test('core: in hours Yes → push, wait, cold transfer to the agent\'s phone', async () => {
  const f = fakes()
  assert.equal((await core.start(f.store, f.provider, f.env, f.call().id)).ok, true)
  await ev(f, 'answered')
  assert.equal((await tool(f, 'qualified', { summary: 'TX, 58, protect the mortgage' })).next, 'check_status')
  assert.equal((await tool(f, 'check_status')).next, 'check_status') // still waiting
  f.setCheck({ status: 'yes', answer: 'yes' })
  assert.equal((await tool(f, 'check_status')).transfer_to, '+15125550100')
  await ev(f, 'ended', { reason: 'transferred', durationSecs: 140 })
  assert.deepEqual(f.log.filter(x => ['push', 'transfer', 'result'].includes(x[0])), [['push'], ['transfer', '+15125550100'], ['result', 'transferred', false]])
})

test('core: in hours No / timer runs out → times to book → booked', async () => {
  const f = fakes()
  await core.start(f.store, f.provider, f.env, f.call().id); await ev(f, 'answered'); await tool(f, 'qualified')
  f.setCheck({ status: 'no', answer: 'no' })
  assert.deepEqual((await tool(f, 'check_status')).slots, ['2026-11-05T23:30:00Z'])
  assert.equal((await tool(f, 'book', { at: '2026-11-05T23:30:00Z' })).ok, true)
  await ev(f, 'ended', { reason: 'hangup', durationSecs: 200 })
  assert.deepEqual(f.log.at(-1), ['result', 'booked', false])
  const g = fakes()
  await core.start(g.store, g.provider, g.env, g.call().id); await ev(g, 'answered'); await tool(g, 'qualified')
  g.setCheck({ expires_at: new Date(WED_9AM_CT - 1).toISOString() })
  assert.ok((await tool(g, 'check_status')).slots)
})

test('core: out of hours and Appointments only go straight to times; no times → a VA', async () => {
  const f = fakes({ nowMs: WED_530PM_CT })
  await core.start(f.store, f.provider, f.env, f.call().id); await ev(f, 'answered')
  assert.ok((await tool(f, 'qualified')).slots)
  assert.ok(!f.log.some(x => x[0] === 'push'))
  const a = fakes({ agent: { id: 'ag-1', first: 'Marcus', phone: '+1', ...transferAgent, mode: 'appts' } })
  await core.start(a.store, a.provider, a.env, a.call().id); await ev(a, 'answered')
  assert.ok((await tool(a, 'qualified')).slots)
  const n = fakes({ slots: [], nowMs: WED_530PM_CT })
  await core.start(n.store, n.provider, n.env, n.call().id); await ev(n, 'answered')
  assert.equal((await tool(n, 'qualified')).hold, true)
  assert.deepEqual(n.log.at(-1), ['handoff', 'ai_failed'])
})

test('core: no answer → result no_answer (the SQL schedules try 2); stop → opt-out; hand-off timeout → callback', async () => {
  const f = fakes()
  await core.start(f.store, f.provider, f.env, f.call().id)
  await ev(f, 'ended', { reason: 'no_answer', durationSecs: 0 })
  assert.deepEqual(f.log.at(-1), ['result', 'no_answer', false])
  const s = fakes()
  await core.start(s.store, s.provider, s.env, s.call().id); await ev(s, 'answered')
  assert.equal((await tool(s, 'stop')).end, true)
  assert.deepEqual(s.log.at(-1), ['result', 'opt_out', false])
  const h = fakes()
  await core.start(h.store, h.provider, h.env, h.call().id); await ev(h, 'answered')
  assert.equal((await tool(h, 'handoff', { reason: 'coverage_or_price', summary: 'Asked what it costs' })).say, 'person')
  await core.handoffTimeout(h.store, h.provider, h.env, h.call().id)
  assert.deepEqual(h.log.slice(-2), [['say'], ['result', 'handed_to_va', true]])
  assert.match(await core.twiml(h.store, '11111111-1111-4111-8111-111111111111'), /<Conference[^>]*>line-abc<\/Conference>/)
  assert.match(await core.twiml(h.store, 'not-a-line'), /<Hangup\/>/)
})

// ── The migration ────────────────────────────────────────────────────────────────────────────────────────────────
test('the migration: off by default, not applied, the same timers and words', () => {
  const sql = readFileSync('supabase/migrations/p892_ai_caller.sql', 'utf8')
  assert.match(sql, /NOT NUMBERED, NOT APPLIED/)
  assert.match(sql, /ai_caller_live boolean not null default false/)
  assert.match(sql, /insert into public\.ai_consent_versions \(version, covers_ai\) values \('mp-v1', false\)/)
  assert.match(sql, /interval '2 minutes'/) // retry
  assert.match(sql, /q\.created_at < now\(\) - interval '60 seconds'/) // hand-off wait
  assert.match(sql, /c\.created_at < now\(\) - interval '20 seconds'/) // never started → VA
  assert.match(sql, /'ai_handoff'\)\)/)
  assert.match(sql, /update public\.call_queue set priority = 0 where id = q/)
  assert.match(sql, /predial_eval\(l\.phone/)
  assert.match(sql, /lead_type is distinct from 'mortgage_protection'/)
  assert.match(sql, /perform public\.route_enqueue\('new_lead', new\.id\)/) // the VA path stays
  assert.match(sql, /perform public\.mark_do_not_call\(null, c\.lead_id/)
  for (const s of ['route_cancel_phone(e, p_lead', 'sms_set_opt(e, true', "va_outcome = 'callback'"]) assert.ok(sql.includes(s), s)
  assert.match(sql, /create policy ai_calls_staff_read .* using \(public\.is_admin\(\) or public\.is_fulfillment\(\)\)/)
  assert.equal(AI_RULES.retryAfterSecs, 120)
  assert.equal(AI_RULES.handoffWaitSecs, 60)
  // The agent-facing timeline label in SQL matches agentLine's words.
  for (const w of ['Reached them. Booked', 'Reached them. Live transfer to you', 'Reached them. Our team is on it', 'Asked not to be called']) assert.ok(sql.includes(w), w)
})
