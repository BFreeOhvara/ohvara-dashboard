// P957 — reactivation, final model: the AI caller's side (supabase/functions/ai-caller) and the portal's words.
// Booked → "Can I text you the confirmation?" → only a yes records consent. A live transfer reports how long the agent
// was connected (under 30 s is free). Money and reveal are in migration 269 (supabase/tests/p957_reactivation.sql).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as core from '../supabase/functions/ai-caller/core.ts'
import { noProvider, retell, retellTransferSecs } from '../supabase/functions/ai-caller/providers.ts'
import { TEXT_ASK as EDGE_ASK } from '../supabase/functions/ai-caller/reactivation.js'
import { retellTools, REPLY_RULES } from '../supabase/functions/ai-caller/retellSpec.js'
import {
  TEXT_ASK, REACT_PRICE_LINE, reactPriceLine, listFit, deliveryLine, billingLine, limitsLine, statusOf, CARD_WORDS, REACT_DEFAULTS, REACT_ATTEST_VERSION,
} from './lib/reactivation.js'
import { PRODUCTS } from './lib/products.js'

const NOW = Date.parse('2026-11-10T21:00:00Z')

function fakes({ reactivation = true, status = 'talking' } = {}) {
  const log = []
  const call = { id: '33333333-3333-4333-8333-333333333333', lead_id: 'l1', agent_id: 'ag-1', attempt: 1, status, provider_call_id: 'rc1', booked_for: null, check_id: null }
  const store = {
    live: async () => ({ on: true, maxSecs: 300 }),
    call: async () => ({ ...call }),
    callByProvider: async () => ({ ...call }),
    lead: async () => ({ id: 'l1', first: 'Ann', phone: '+15125556001', state: 'TX', tz: 'America/Chicago', reactivation: reactivation ? { voicemailLeft: false } : null }),
    agent: async () => ({ id: 'ag-1', first: 'Nate', phone: '+15125550100', mode: 'appts', hours: {}, tz: 'America/Chicago', reachable: false }),
    status: async (_id, st) => { call.status = st; return call },
    result: async (_id, o) => { log.push(['result', o]); call.status = 'done' },
    book: async (_id, at) => { call.booked_for = at; log.push(['book', at]); return { ok: true } },
    slots: async () => [],
    textOk: async (_id, yes) => { log.push(['textOk', yes]) },
    transferSecs: async (_id, secs) => { log.push(['transferSecs', secs]) },
    markCheck: async () => {},
  }
  const provider = { ...noProvider(), key: 'retell', ready: true }
  const env = { now: () => NOW, from: '+15125559999', words: { opening: 'Hi {first}' } }
  const ev = (type, extra = {}) => core.onEvent(store, provider, env, { providerCallId: 'rc1', callId: call.id, type, ...extra })
  const tool = (name, args = {}) => ev('tool', { toolCallId: null, name, args })
  return { log, call, ev, tool }
}

test('the text question is the same in the portal and the edge function', () => {
  assert.equal(EDGE_ASK, TEXT_ASK)
  assert.equal(TEXT_ASK, 'Can I text you the confirmation?')
})

test('a reactivation booking asks before any text; a fresh lead does not', async () => {
  const f = fakes()
  const r = await f.tool('book', { at: '2026-11-11T16:00:00Z' })
  assert.equal(r.ok, true)
  assert.equal(r.ask_text, TEXT_ASK)
  assert.equal(r.next, 'text_ok')
  assert.equal(r.end_after, undefined)
  const fresh = await fakes({ reactivation: false }).tool('book', { at: '2026-11-11T16:00:00Z' })
  assert.equal(fresh.ask_text, undefined)
  assert.equal(fresh.end_after, true)
})

test('yes records consent, no records a no; neither ends the call before the goodbye', async () => {
  const y = fakes()
  assert.deepEqual(await y.tool('text_ok', { answer: 'yes' }), { ok: true, texts: true, end_after: true })
  assert.deepEqual(y.log, [['textOk', true]])
  const n = fakes()
  assert.equal((await n.tool('text_ok', { answer: 'no' })).texts, false)
  assert.deepEqual(n.log, [['textOk', false]])
  const fresh = fakes({ reactivation: false })
  await fresh.tool('text_ok', { answer: 'yes' })
  assert.deepEqual(fresh.log, [], 'only reactivation calls record text consent')
})

test('a live transfer reports how long the agent was connected', async () => {
  const f = fakes({ status: 'transferring' })
  await f.ev('ended', { reason: 'transferred', durationSecs: 90, transferSecs: 12 })
  assert.deepEqual(f.log, [['result', 'transferred'], ['transferSecs', 12]])
  const late = fakes({ status: 'done' })
  await late.ev('transfer_ended', { transferSecs: 45 })
  assert.deepEqual(late.log, [['transferSecs', 45]])
})

test('Retell: transfer end − AI end = connected seconds; missing fields = unknown', () => {
  assert.equal(retellTransferSecs({ end_timestamp: 1000_000, transfer_end_timestamp: 1045_400 }), 45)
  assert.equal(retellTransferSecs({ end_timestamp: 1000_000 }), null)
  assert.equal(retellTransferSecs({ end_timestamp: 2000, transfer_end_timestamp: 1000 }), null)
  const p = retell('k', 'a', async () => ({ ok: true, json: async () => ({}) }))
  const call = { call_id: 'rc1', metadata: { call_id: 'c1' }, end_timestamp: 1000_000, transfer_end_timestamp: 1031_000, duration_ms: 60000, disconnection_reason: 'call_transfer' }
  assert.deepEqual(p.parse({ event: 'transfer_ended', call }), { type: 'transfer_ended', providerCallId: 'rc1', callId: 'c1', transferSecs: 31 })
  assert.equal(p.parse({ event: 'call_ended', call }).transferSecs, 31)
  assert.equal(p.parse({ event: 'transfer_ended', call: { call_id: 'rc1' } }), null)
})

test('the Retell script has the text_ok tool and the ask_text rule', () => {
  const names = retellTools('https://x.test/hook').map(t => t.name)
  assert.ok(names.includes('text_ok'))
  const prompt = JSON.stringify(REPLY_RULES)
  assert.match(prompt, /ask_text/)
  assert.match(prompt, /Never send or promise a text if they say no/)
})

test('portal words: one price line, free upload, limits, card refusals', () => {
  assert.equal(REACT_PRICE_LINE, 'Free to upload. $20 per appointment or live call we deliver.')
  assert.equal(reactPriceLine(2000), REACT_PRICE_LINE)
  assert.equal(reactPriceLine(2500), 'Free to upload. $25 per appointment or live call we deliver.')
  assert.equal(REACT_DEFAULTS.deliveredCents, 2000)
  assert.equal(REACT_ATTEST_VERSION, 'p957-v1')
  assert.equal(PRODUCTS.reactivation.price, '$20 per appointment or live call')
  assert.match(PRODUCTS.reactivation.sub, /free to upload/)
  assert.deepEqual(listFit(480, { room: 300 }), { n: 480, fits: 300, over: 180, empty: false })
  assert.deepEqual(listFit(120, null), { n: 120, fits: 120, over: 0, empty: false })
  assert.equal(listFit(50, { room: 0 }).empty, true)
  assert.equal(deliveryLine({ kind: 'booked', amount_cents: 2000 }), 'Your own leads · appointment booked · $20')
  assert.equal(billingLine({ kind: 'transferred', amount_cents: 2000, refunded_cents: 2000 }), 'Your own leads · live call · $20 · paid back')
  assert.equal(billingLine({ callable: 480, amount_cents: 96000 }), 'Your own leads · 480 leads · $960')
  assert.match(limitsLine({ is_new: true, max_callable: 300, daily_calls: 100, until_paid: 3 }), /up to 300 people and 100 calls a day until 3 appointments are paid/)
  assert.equal(limitsLine({ is_new: false }), '')
  assert.deepEqual(statusOf({ status: 'paused', pause_kind: 'card' }), ['rose', 'Paused: card declined'])
  assert.deepEqual(statusOf({ status: 'draft' }), ['mute', 'Not started'])
  for (const k of ['prepaid', 'shared_card', 'declined', 'card_owed', 'over_limit']) assert.ok(CARD_WORDS[k])
})
