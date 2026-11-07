import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { predial, predialLine, inHours, nextOpen, ruleFor, REASON_WORDS } from '../template/ful/predial.js'
import {
  newCall, callReducer as r, holdOnlyCarrier, ringLeft, RING_SECS, RING_KIND, initialPresence, presenceReducer as p,
  wrapLeft, wrapStuck, WRAP_MS, WRAP_STUCK_MS,
} from '../template/ful/callLine.js'
import { realLineApi, offerRing, skewOf } from '../lib/realLine.js'
import { RING_MS } from '../template/ful/phoneDock.js'

const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')
const run = (s, red, ...acts) => acts.reduce(red, s)
// Thursday Nov 5 2026. 2:00 PM Central = 20:00 UTC.
const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 5, h, m))
const lead = o => ({ state: 'TX', consent: true, writtenConsent: true, ...o })

// ── Q51: no call recording at launch ──────────────────────────────────────
test('the phone never records and never asks for a recording notice', () => {
  const phone = src('../template/ful/Phone.jsx')
  assert.doesNotMatch(phone, /RECORD_NOTICE|recording notice|fs-cs-recpill|type: 'rec'|'Recording'|>Recording</)
  assert.doesNotMatch(src('../template/ful/callLine.js'), /\brec: true|case 'rec':/)
  assert.doesNotMatch(src('../template/ful/ful.css'), /fs-cs-recpill|fs-cs-notice|is-rec/)
  assert.equal('rec' in newCall({ key: 'k', name: 'A' }, 0), false)
})

// ── pre-dial ──────────────────────────────────────────────────────────────
test('pre-dial: consent, opt-out and do-not-call each block, with the reason', () => {
  const t = at(20)
  assert.deepEqual(predial(lead(), t), { ok: true, reason: null, nextAt: null })
  assert.equal(predial(lead({ consent: false }), t).reason, 'no_consent')
  assert.equal(predial(lead({ optedOut: true }), t).reason, 'opted_out')
  assert.equal(predial(lead({ dnc: true }), t).reason, 'dnc')
  assert.equal(predial(lead({ nationalDnc: true, writtenConsent: false }), t).reason, 'national_dnc')
  assert.equal(predial(lead({ nationalDnc: true }), t).ok, true, 'written consent from the form covers the national list')
  assert.equal(predial(lead({ state: 'ZZ' }), t).reason, 'unknown_state')
  assert.equal(predial(lead({ consent: false, dnc: true }), t, { callIn: true }).ok, true, 'they called us')
  assert.equal(predial(lead({ optedOut: true }), t, { callIn: true }).reason, 'opted_out')
  for (const k of ['no_consent', 'opted_out', 'dnc', 'national_dnc', 'outside_hours', 'attempt_cap', 'unknown_state']) assert.ok(REASON_WORDS[k])
})

test('pre-dial: calling hours hold in every zone of the state; held calls release at 8 AM their time', () => {
  // 7:30 AM Central (13:30 UTC): too early in Texas. El Paso is on Mountain time, so Texas opens when it's 8 AM
  // there too: 9:00 AM Central.
  const early = predial(lead(), at(13, 30))
  assert.equal(early.reason, 'outside_hours')
  assert.equal(early.nextAt.toISOString(), at(15).toISOString())
  assert.match(predialLine(early, 'TX', at(13, 30)), /^Outside calling hours · calls at 9:00 AM CST$/)
  assert.equal(inHours(at(14, 10), 'TX'), false, '8:10 AM Central is 7:10 AM in El Paso')
  assert.equal(nextOpen(at(14, 10), 'TX').toISOString(), at(15).toISOString())
  assert.equal(predial(lead({ state: 'IL' }), at(14)).ok, true, 'Illinois opens at 8:00 AM Central')
  // Florida ends at 8 PM (both of its zones); Arizona at 9 PM.
  assert.equal(ruleFor('FL').end, 20 * 60)
  assert.equal(inHours(new Date(Date.UTC(2026, 10, 6, 1, 30)), 'FL'), false, '8:30 PM Eastern')
  assert.equal(inHours(new Date(Date.UTC(2026, 10, 6, 3, 30)), 'AZ'), true, '8:30 PM Arizona')
  // Late at night → next day's 8 AM, with the day named.
  const late = predial(lead(), new Date(Date.UTC(2026, 10, 6, 4)))
  assert.match(predialLine(late, 'TX', new Date(Date.UTC(2026, 10, 6, 4))), /calls at Fri 9:00 AM CST/)
})

test('pre-dial: Florida, Oklahoma and Maryland stop at 3 calls in 24 hours; others have no cap', () => {
  const now = at(20).getTime()
  const three = [now - 23 * 3600e3, now - 5 * 3600e3, now - 3600e3]
  const fl = predial(lead({ state: 'FL', attempts: three }), at(20))
  assert.equal(fl.reason, 'attempt_cap')
  assert.equal(fl.nextAt.getTime(), now + 3600e3, 'the oldest call turns 24 hours old')
  assert.equal(predial(lead({ state: 'FL', attempts: three.slice(1) }), at(20)).ok, true)
  assert.equal(predial(lead({ state: 'TX', attempts: [...three, ...three] }), at(20)).ok, true)
  assert.equal(predial(lead({ state: 'OK', attempts: three }), at(20)).reason, 'attempt_cap')
})

test('the phone checks every To call row and every Call before ringing', () => {
  const phone = src('../template/ful/Phone.jsx')
  assert.match(phone, /block=\{c\.ok \? null : predialLine\(/)
  assert.match(phone, /disabled=\{!!block\}/)
  assert.match(phone, /if \(!c\.ok\) \{ note\(predialLine\(/)
})

// ── routing: the ring ─────────────────────────────────────────────────────
test('a ring lasts 15 seconds (the frame times it out at the same moment) and says what kind of call it is', () => {
  assert.equal(RING_SECS, 15)
  assert.equal(RING_MS, 15000)
  assert.equal(ringLeft(1000, 1000), 15)
  assert.equal(ringLeft(1000, 6500), 10)
  assert.equal(ringLeft(1000, 99000), 0)
  assert.deepEqual(Object.keys(RING_KIND).sort(), ['call_in', 'callback', 'hold_handoff', 'new_lead', 'rescue'])
})

test('presence: two missed rings in a row set Away; answering resets the count', () => {
  let s = run(initialPresence, p, { type: 'ring' })
  assert.equal(s.status, 'ringing')
  s = p(s, { type: 'missed' })
  assert.deepEqual([s.status, s.missedRow], ['available', 1])
  s = run(s, p, { type: 'ring' }, { type: 'answer' })
  assert.deepEqual([s.status, s.missedRow], ['on_call', 0])
  s = run({ ...initialPresence }, p, { type: 'ring' }, { type: 'missed' }, { type: 'ring' }, { type: 'missed' })
  assert.equal(s.status, 'away')
  assert.equal(p(s, { type: 'ring' }).status, 'away', 'Away gets no rings')
  assert.equal(p(s, { type: 'set', status: 'available' }).missedRow, 0)
})

test('wrap-up: outcome required before Available; 60 s, +60 s counted, admins told past 3 minutes', () => {
  let s = run({ ...initialPresence, status: 'on_call' }, p, { type: 'wrap', now: 0 })
  assert.equal(wrapLeft(s, 10000), WRAP_MS - 10000)
  assert.equal(p(s, { type: 'set', status: 'available' }).status, 'wrap', 'can’t skip to Available')
  assert.equal(p(s, { type: 'done', outcome: '  ' }).status, 'wrap', 'no outcome, no Available')
  s = p(s, { type: 'more' })
  assert.equal(s.wrapExtra, 1)
  assert.equal(wrapLeft(s, 70000), 50000)
  assert.equal(wrapStuck(s, WRAP_STUCK_MS - 1), false)
  assert.equal(wrapStuck(s, WRAP_STUCK_MS), true)
  s = p(s, { type: 'done', outcome: 'Reached them' })
  assert.deepEqual([s.status, s.wrapAt, wrapLeft(s, 0)], ['available', null, null])
})

test('presence: the server wins on a real line (clock skew corrected), and a paused task comes back', () => {
  const s = p(initialPresence, { type: 'server', presence: { status: 'wrap', missed_rings: 1, wrap_started_at: '2026-11-05T20:00:00Z', wrap_extra: 2, paused_task: null }, skew: 1000 })
  assert.equal(s.status, 'wrap')
  assert.equal(s.wrapAt, Date.parse('2026-11-05T20:00:00Z') - 1000)
  assert.equal(s.wrapExtra, 2)
  const q = run(initialPresence, p, { type: 'pause', task: { label: 'Luis Ortega · payment change', path: 'x' } })
  assert.equal(q.paused.label, 'Luis Ortega · payment change')
  assert.equal(p(q, { type: 'resume' }).paused, null)
})

// ── the call: Do not call, voicemail, Need help, hand off a carrier hold ──
const who = { key: 'k-1', name: 'Gloria Price', number: '(512) 555-0101', role: 'client' }
const carrier = { id: 'cat-globe-life', name: 'Globe Life', role: 'carrier', number: '(800) 851-0042' }

test('Do not call marks the call; Need help stamps the time', () => {
  const c = run(newCall(who, 0), r, { type: 'dnc' }, { type: 'help', now: 500 })
  assert.equal(c.dnc, true)
  assert.equal(c.help, 500)
  assert.equal(c.end, null, 'the person can still hear goodbye')
})

test('voicemail drops that line; on a one-person call it ends the call as a voicemail', () => {
  const c = r(newCall(who, 0), { type: 'voicemail', id: who.key, now: 900 })
  assert.equal(c.vm, true)
  assert.equal(c.end, 900)
})

test('hand off a hold only when the call is on hold with nobody but a carrier', () => {
  let c = run(newCall(who, 0), r, { type: 'add', party: carrier }, { type: 'answered', id: carrier.id })
  assert.equal(holdOnlyCarrier(c), false, 'the client is still on the call')
  assert.equal(r(c, { type: 'handoff' }), c)
  c = r(c, { type: 'drop', id: who.key })
  assert.equal(holdOnlyCarrier(c), true)
  c = r(c, { type: 'handoff', path: '2, 4, 0', notes: 'Ask for retention', now: 4000 })
  assert.equal(c.outcome, 'handed_off')
  assert.deepEqual(c.handoff, { at: 4000, path: '2, 4, 0', notes: 'Ask for retention' })
  assert.equal(c.end, 4000)
})

// ── the real line, with stubs (voice_live stays off, so the app never takes this path yet) ──
function stubs(over = {}) {
  const log = []
  const rpc = async (n, a) => { log.push(['rpc', n, a]); return over[n] ? over[n](a) : {} }
  const invoke = async (fn, b) => { log.push(['invoke', fn, b]); if (over.invoke) return over.invoke(b); return b.action === 'open_line' ? { line_id: 'L2' } : { ok: true } }
  const connect = async o => { log.push(['connect', o.lineId]); return { hangUp: () => log.push(['hangUp']), destroy: () => {}, mute: m => log.push(['mute', m]) } }
  return { log, api: realLineApi({ rpc, invoke, connect }) }
}

test('real: answering a new-lead ring claims it, joins its line, then rings the lead', async () => {
  const { log, api } = stubs({ route_accept: () => ({ line_id: 'L1', kind: 'new_lead', lead_id: 'lead-1' }) })
  const got = await api.accept({ id: 'q1' })
  assert.deepEqual(got, { lineId: 'L1', kind: 'new_lead', leadId: 'lead-1', policyId: null, callSid: null, detail: {} })
  assert.deepEqual(log, [['rpc', 'route_accept', { p_item: 'q1' }], ['connect', 'L1'], ['invoke', 'fulfillment-call', { line_id: 'L1', action: 'ring_client' }]])
})

test('real: an inbound ring joins the caller (no ring-out) and keeps the CallSid for the live transfer', async () => {
  const { log, api } = stubs({ route_accept: () => ({ line_id: 'L3', kind: 'inbound', help_call_sid: 'CA123' }) })
  const got = await api.accept({ id: 'q2' })
  assert.equal(got.callSid, 'CA123')
  assert.equal(log.some(([k, , b]) => k === 'invoke' && b?.action === 'ring_client'), false)
})

test('real: a ring someone else took says so; Not now is route_pass', async () => {
  const { api, log } = stubs({ route_accept: () => null })
  await assert.rejects(api.accept({ id: 'q3' }), /Someone else took that call/)
  await api.pass('q3')
  assert.deepEqual(log.at(-1), ['rpc', 'route_pass', { p_item: 'q3' }])
})

test('real: calls start only from a lead or a client, never a typed number', async () => {
  const { api, log } = stubs()
  assert.equal(await api.openLine({ leadId: 'lead-9' }), 'L2')
  assert.deepEqual(log[0], ['invoke', 'fulfillment-call', { action: 'open_line', lead_id: 'lead-9' }])
  await assert.rejects(api.openLine({ number: '5125550101' }), /start from a lead or a client/)
  await assert.rejects(api.send(null, 'hold'), /isn’t connected/)
})

test('real: the buttons map to the server (Do not call, Need help, wrap-up, pre-dial, hand off)', async () => {
  const { api, log } = stubs({ predial_check: () => [{ ok: false, reason: 'outside_hours', next_at: '2026-11-06T14:00:00Z' }] })
  await api.doNotCall({ phone: '(512) 555-0101', leadId: 'lead-1' })
  await api.needHelp('L1')
  await api.wrapDone('Reached them')
  await api.wrapMore()
  await api.overtime('L1', 30)
  await api.handoff('L1', { menu_path: '2,4' })
  const pd = await api.predial('(512) 555-0101', 'TX', 'lead-1')
  assert.deepEqual(pd, { ok: false, reason: 'outside_hours', nextAt: new Date('2026-11-06T14:00:00Z') })
  assert.deepEqual(log.map(x => x[1] === 'fulfillment-call' ? x[2].action : x[1]),
    ['mark_do_not_call', 'va_need_help', 'va_wrap_done', 'va_wrap_more', 'va_overtime_request', 'handoff_hold', 'predial_check'])
  assert.deepEqual(log[0][2], { p_phone: '(512) 555-0101', p_lead: 'lead-1', p_policy: null, p_reason: null })
})

test('real: a server offer becomes the ring on this device’s clock', () => {
  const o = offerRing({ id: 'q1', kind: 'callback', name: 'Angela Moore', state: 'TX', phone_last4: '0147', offered_at: '2026-11-05T20:00:10Z', lead_id: 'l1' }, 10000)
  assert.equal(o.at, Date.parse('2026-11-05T20:00:00Z'))
  assert.equal(o.kind, 'callback')
  assert.equal(offerRing({ id: 'q9', kind: 'inbound' }).kind, 'call_in', 'someone calling us shows as Calling in')
  assert.equal(offerRing(null), null)
  assert.equal(typeof skewOf('2026-11-05T20:00:00Z'), 'number')
})
