// P903 — the AI's live transfer, beat by beat: Check agent push, no dead air while the agent decides, the connecting
// line, the whisper the agent hears alone, the cold hand-off, and the bounce back to the AI (not a VA), which books.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_RULES, TRANSFER_WORDS, WAIT_QUESTIONS, transferBeats, SAMPLE_AI_CALLS, beatsOf, agentPrompt, DRAFT_WORDS, agentLine,
} from './lib/aiCaller.js'
import { AI_CALL_WORDS } from '../supabase/functions/ai-caller/rules.js' // P940: what the AI caller says
import { DEFAULT_LIVE_HOURS } from './lib/leadSplit.js'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider, vapiDestination } from '../supabase/functions/ai-caller/providers.ts'
import { checkPush, clearPush } from '../supabase/functions/notify-push/transfer.ts'
import { whisperWords } from '../supabase/functions/help-transfer/core.ts'

const WED_9AM_CT = Date.parse('2026-11-04T15:00:00Z')
const SLOT = '2026-11-05T23:30:00Z'
const SUMMARY = { name: 'Pat', age: '55 to 64', state: 'TX', need: 'Mortgage protection', your_client: false }

function fakes({ talks = true } = {}) {
  const log = []
  const call = { id: '11111111-1111-4111-8111-111111111111', lead_id: 'l1', agent_id: 'ag-1', attempt: 1, status: 'queued', provider_call_id: null, check_id: null, routed: null, summary: null, booked_for: null }
  let check = null
  const store = {
    live: async () => ({ on: true, maxSecs: 300 }),
    call: async id => (id === call.id ? { ...call } : null),
    callByProvider: async pid => (pid === call.provider_call_id ? { ...call } : null),
    lead: async () => ({ id: 'l1', first: 'Pat', phone: '+15125550123', state: 'TX', tz: 'America/Chicago', need: 'Mortgage protection', age: '55 to 64' }),
    agent: async () => ({ id: 'ag-1', first: 'Dana', phone: '+15125550100', mode: 'both', hours: DEFAULT_LIVE_HOURS, tz: 'America/Chicago', reachable: true }),
    takes: async () => ({ by: 'ai', reason: null }),
    toVa: async (_id, reason) => { log.push(['toVa', reason]); call.status = 'to_va' },
    status: async (_id, st, patch = {}) => { log.push(['status', st]); Object.assign(call, { status: st, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) }); return call },
    result: async (_id, outcome, patch = {}) => { log.push(['result', outcome, !!patch.callback_task]); call.status = 'done' },
    slots: async () => [SLOT],
    book: async (_id, at) => { log.push(['book', at]); call.booked_for = at; return { ok: true } },
    insertCheck: async row => { log.push(['insertCheck', row.summary]); check = { id: 'chk1', status: 'sent', answer: null, expires_at: new Date(WED_9AM_CT + 30000).toISOString(), summary: row.summary }; return check },
    check: async () => (check ? { ...check } : null),
    sendCheck: async () => { log.push(['push']); return true },
    markCheck: async (_id, patch) => { log.push(['check', patch.status]); Object.assign(check, patch) },
    clearCheck: async (_c, agentId, why) => { log.push(['clear', why, agentId]) },
  }
  const provider = {
    ...noProvider(), key: talks ? 'vapi' : 'ghl', ready: true, talksWhileWaiting: talks,
    start: async () => ({ providerCallId: 'pc1' }),
    transfer: async (_id, to, _url, o) => { log.push(['transfer', to, o]) },
    say: async () => {}, parse: b => b, toolReply: (_t, r) => r,
  }
  const env = { now: () => WED_9AM_CT, from: '+18005550110', words: { opening: 'Hi {first}' } }
  const ev = (type, extra = {}) => core.onEvent(store, provider, env, { providerCallId: 'pc1', callId: call.id, type, ...extra })
  const tool = (name, args = {}) => ev('tool', { name, args, toolCallId: null })
  const setCheck = p => Object.assign(check, p)
  const toCheck = async () => { await core.start(store, provider, env, call.id); await ev('answered'); return tool('qualified', { summary: 'TX, 58' }) }
  return { log, call, tool, ev, setCheck, toCheck, kinds: k => log.filter(x => k.includes(x[0])) }
}

test('beats 1-3: qualify → "let me see who is free" → the agent push, and light questions while waiting (no dead air)', async () => {
  const f = fakes()
  const r = await f.toCheck()
  assert.equal(r.say, AI_CALL_WORDS.check)
  assert.equal(r.say, AI_CALL_WORDS.check) // P940
  assert.equal(r.next, 'check_status')
  assert.equal(r.keep_talking, true)
  assert.deepEqual(r.ask, WAIT_QUESTIONS)
  assert.equal(r.hold, undefined)
  for (const q of WAIT_QUESTIONS) assert.doesNotMatch(q, /cover|price|cost|premium|carrier|qualif/i, q)
  assert.match(r.rule, /Never talk about coverage, prices or carriers/)
  assert.deepEqual(f.log.find(x => x[0] === 'insertCheck')[1], { name: 'Pat', age: '55 to 64', state: 'TX', need: 'Mortgage protection', your_client: false })
  // Still waiting: keep the caller company, poll again.
  const w = await f.tool('check_status')
  assert.deepEqual([w.next, w.keep_talking, w.ask], ['check_status', true, undefined])
})

test('a provider that can\'t talk while it waits plays a short hold line instead', async () => {
  const f = fakes({ talks: false })
  const r = await f.toCheck()
  assert.equal(r.say, `${AI_CALL_WORDS.check} ${TRANSFER_WORDS.holdOnly}`)
  assert.equal(r.hold, true)
  assert.equal(r.keep_talking, undefined)
})

test('beat 4, Yes → "connecting you with Dana", whisper to the agent alone, cold transfer, AI leaves; delivered', async () => {
  const f = fakes()
  await f.toCheck()
  f.setCheck({ status: 'yes', answer: 'yes' })
  const r = await f.tool('check_status')
  assert.equal(r.say, AI_CALL_WORDS.connecting) // P940
  assert.deepEqual([r.transfer_to, r.cold, r.ring_secs, r.if_not_answered], ['+15125550100', true, AI_RULES.ringSecs, 'transfer_failed'])
  assert.equal(r.whisper, 'Deedstone live caller: Pat, 55 to 64, TX, mortgage protection.')
  const [, to, o] = f.log.find(x => x[0] === 'transfer')
  assert.equal(to, '+15125550100')
  assert.deepEqual(o, { say: r.say, whisper: r.whisper, ringSecs: 20, bounceSay: AI_CALL_WORDS.bounce })
  await f.ev('ended', { reason: 'transferred', durationSecs: 140 })
  assert.deepEqual(f.kinds(['check', 'result']), [['check', 'ringing'], ['check', 'connected'], ['result', 'transferred', false]])
  assert.ok(!f.log.some(x => x[0] === 'clear'))
})

test('beat 5, the agent taps No → back to the AI: "specialists are with clients", times, booked', async () => {
  const f = fakes()
  await f.toCheck()
  f.setCheck({ status: 'no', answer: 'no' })
  const r = await f.tool('check_status')
  assert.equal(r.say, AI_CALL_WORDS.bounce) // P940
  assert.deepEqual([r.slots, r.next], [[SLOT], 'book'])
  assert.ok(!f.log.some(x => x[0] === 'transfer' || x[0] === 'clear')) // the agent's own No already cleared their phones
  assert.equal((await f.tool('book', { at: SLOT })).ok, true)
  await f.ev('ended', { reason: 'hangup', durationSecs: 220 })
  assert.deepEqual(f.log.at(-1), ['result', 'booked', false])
})

test('beat 5, no answer to the push in 30 s → check marked no answer, the push replaced, bounce line, booked', async () => {
  const f = fakes()
  await f.toCheck()
  f.setCheck({ expires_at: new Date(WED_9AM_CT - 1).toISOString() })
  const r = await f.tool('check_status')
  assert.equal(r.say, AI_CALL_WORDS.bounce)
  assert.deepEqual(r.slots, [SLOT])
  assert.deepEqual(f.kinds(['check', 'clear']), [['check', 'no_answer'], ['clear', 'booking', 'ag-1']])
  await f.tool('book', { at: SLOT }); await f.ev('ended', { reason: 'hangup' })
  assert.deepEqual(f.log.at(-1), ['result', 'booked', false])
})

test('beat 5, Yes but the agent\'s phone isn\'t answered in about 20 s → bounces back to the AI (not a VA) → booked', async () => {
  const f = fakes()
  await f.toCheck()
  f.setCheck({ status: 'yes', answer: 'yes' })
  await f.tool('check_status')
  const r = await f.tool('transfer_failed')
  assert.equal(r.say, AI_CALL_WORDS.bounce)
  assert.deepEqual(r.slots, [SLOT])
  assert.equal(f.call.status, 'booking')
  assert.deepEqual(f.kinds(['check', 'clear']), [['check', 'ringing'], ['check', 'bounced'], ['clear', 'booking', 'ag-1']])
  assert.ok(!f.log.some(x => x[0] === 'handoff' || x[0] === 'toVa'))
  await f.tool('book', { at: SLOT }); await f.ev('ended', { reason: 'hangup' })
  assert.deepEqual(f.log.at(-1), ['result', 'booked', false])
  // A late or repeated transfer_failed / check_status can't send it round again.
  assert.equal((await f.tool('transfer_failed')).end, true)
})

test('P902: after a bounce the caller asks for a person → "Your agent will go over that", times to book, never a VA', async () => {
  const f = fakes()
  await f.toCheck()
  f.setCheck({ status: 'yes', answer: 'yes' })
  await f.tool('check_status')
  await f.tool('transfer_failed')
  const r = await f.tool('ask_agent', { reason: 'asked_person', summary: 'Wants a person' })
  assert.match(r.say, /^Your agent will go over that with you\./)
  assert.deepEqual([r.slots, r.next], [[SLOT], 'book'])
  assert.ok(!f.log.some(x => x[0] === 'handoff' || x[0] === 'toVa'))
  await f.tool('book', { at: SLOT }); await f.ev('ended', { reason: 'hangup', durationSecs: 90 })
  assert.deepEqual(f.log.at(-1), ['result', 'booked', false])
})

test('stray tool calls outside their beat are refused, not acted on', async () => {
  const f = fakes()
  const g = fakes()
  await g.toCheck()
  assert.equal((await g.tool('transfer_failed')).code, 'not_transferring') // still checking
  f.call.status = 'talking'
  assert.equal((await f.tool('check_status')).code, 'not_checking')
})

test('the push: "Live caller ready: {first}, {age band}, {state}. Take the call?" with Yes / No', () => {
  const m = checkPush({ id: 'chk1', ai_call_id: 'a1', summary: SUMMARY }, 'u')
  assert.equal(`${m.title}, ${m.body}`, 'Live caller ready: Pat, 55 to 64, TX. Take the call?')
  assert.deepEqual([m.category, m.ttlSec, m.timeSensitive], ['OHVARA_TRANSFER', 30, true])
  assert.equal(clearPush({ id: 'chk1', summary: SUMMARY }, 'booking').title, 'Pat: Missed. We’re booking them on your calendar')
})

test('the whisper (P880 whisperWords, AI variant): one line, the caller can\'t hear it, no "press 1"', () => {
  assert.equal(whisperWords(SUMMARY, false, 'ai'), 'Deedstone live caller: Pat, 55 to 64, TX, mortgage protection.')
  assert.match(whisperWords(SUMMARY, false), /Press 1/) // the VA's transfer keeps press 1
})

test('Vapi: warm-transfer-say-message = whisper to the agent only, 20 s ring, back to the assistant on no answer', () => {
  const d = vapiDestination('+15125550100', { say: 'connecting', whisper: 'Deedstone live caller: Pat.', ringSecs: 20, bounceSay: 'bounce' })
  assert.deepEqual(d, { type: 'number', number: '+15125550100', message: 'connecting',
    transferPlan: { mode: 'warm-transfer-say-message', message: 'Deedstone live caller: Pat.', timeout: 20, fallbackPlan: { message: 'bounce', endCallEnabled: false } } })
  assert.equal(vapiDestination('+1').transferPlan.mode, 'blind-transfer')
})

test('sample calls show every branch beat by beat; agents still never see "AI"', () => {
  const branches = SAMPLE_AI_CALLS.filter(c => c.transfer).map(c => `${c.transfer.check}/${c.transfer.phone || '-'}`)
  assert.deepEqual(branches.sort(), ['no/-', 'no/-', 'none/-', 'yes/answered', 'yes/no_answer'])
  assert.ok(SAMPLE_AI_CALLS.every(c => !c.transfer?.then)) // P902: no hand-off branch
  const yes = beatsOf(SAMPLE_AI_CALLS.find(c => c.id === 'ai-1'))
  assert.match(yes.at(-1), /whisper played · caller connected · AI left the call/)
  assert.deepEqual(transferBeats({ agent: 'Dana', check: 'yes', answerSecs: 9, phone: 'no_answer', then: 'booked', bookedFor: 'Thu 2:30 PM CT' }), [
    'Qualified', 'Checked Dana: “Live caller ready” push sent · kept the caller talking', 'Dana tapped Yes in 9 s',
    'Dana’s phone not answered in 20 s · caller back with the AI', 'Booked Thu 2:30 PM CT'])
  assert.match(transferBeats({ agent: 'Priya', check: 'none', then: 'booked' })[2], /No answer to the push in 30 s/)
  for (const c of SAMPLE_AI_CALLS) assert.doesNotMatch(agentLine({ secs: c.secs, outcome: c.outcome }), /\bAI\b/)
})

test('the provider prompt carries the beats: keep talking, the connecting line, transfer_failed, the bounce line', () => {
  const p = agentPrompt()
  for (const q of WAIT_QUESTIONS) assert.ok(p.includes(q), q)
  assert.ok(p.includes(DRAFT_WORDS.connecting) && p.includes(DRAFT_WORDS.bounce))
  assert.match(p, /call transfer_failed/)
  assert.equal(DRAFT_WORDS.hold, TRANSFER_WORDS.check)
})
