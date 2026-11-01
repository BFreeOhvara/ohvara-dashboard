/**
 * Node unit tests for the client texts (Prompt 776): every body is
 * byte-compared to the sample registered with Twilio for the A2P campaign,
 * with the bracketed variables filled in. No Twilio call.
 * Run: node --test supabase/functions/recovery-sms/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, confirmation, sendDue, shortLink, timeText, inboundIntent, OPT_IN_REPLY, type Deps, type Row, type SendResult } from './core.ts'

// The samples exactly as registered (Eagle, 2026-10-17).
const SAMPLE = {
  missed: "Ohvara: Hi [First name], this is the call your agent [Agent name] booked to cancel your old [Carrier] policy. We tried you at [time] and missed you. Pick a new time here: portal.ohvara.com/r/[code]. Reply STOP to opt out.",
  reminder: "Ohvara: Reminder, we're calling you today at [time] about cancelling your old [Carrier] policy. Need a different time? portal.ohvara.com/r/[code]. Reply STOP to opt out.",
  sorry: "Ohvara: Sorry [First name], we missed your [time] call today. We'll call you tomorrow at [time] instead, or pick another time: portal.ohvara.com/r/[code]. Reply STOP to opt out.",
  confirm: "Ohvara: You're set to get texts about your call with Ohvara (ohvara.com) to cancel your old [Carrier] policy. Up to 4 msgs per call. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  optIn: "Ohvara: You're opted in to texts about your call to cancel your old insurance policy. Up to 4 msgs per call. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
}

// Fill [time] occurrences in order.
function fill(sample: string, v: Record<string, string>, times: string[] = []) {
  let out = sample
  for (const [k, val] of Object.entries(v)) out = out.split(`[${k}]`).join(val)
  for (const t of times) out = out.replace('[time]', t)
  return out
}

const TOKEN = '3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const row = (o: Partial<Row>): Row => ({
  policy_id: 'p1', kind: 'text1', sample: 'missed', needs_confirm: false,
  first_name: 'Maria', phone: '+12145550100', agent_name: 'Dana Reyes', carrier: 'State Farm',
  tried_at: '2026-10-20T19:00:00Z', retry_at: '2026-10-21T19:00:00Z', token: TOKEN, tz: 'America/Chicago', ...o,
})
const APP = 'https://portal.ohvara.com'
const vars = { 'First name': 'Maria', 'Agent name': 'Dana Reyes', Carrier: 'State Farm', code: TOKEN }

test('time reads like 2:00 PM CDT in the client zone', () => {
  assert.equal(timeText('2026-10-20T19:00:00Z', 'America/Chicago'), '2:00 PM CDT')
  assert.equal(timeText('2026-10-20T19:00:00Z', 'America/New_York'), '3:00 PM EDT')
})

test('missed matches the registered sample', () => {
  assert.equal(compose(row({}), APP), fill(SAMPLE.missed, vars, ['2:00 PM CDT']))
})

test('reminder matches the registered sample', () => {
  assert.equal(compose(row({ sample: 'reminder', kind: 'text2' }), APP), fill(SAMPLE.reminder, vars, ['2:00 PM CDT']))
})

test('sorry matches the registered sample (missed time, then retry time)', () => {
  const r = row({ sample: 'sorry', kind: 'apology1', tried_at: '2026-10-20T18:30:00Z', retry_at: '2026-10-21T18:30:00Z' })
  assert.equal(compose(r, APP), fill(SAMPLE.sorry, vars, ['1:30 PM CDT', '1:30 PM CDT']))
})

test('confirmation and opt-in reply match the registered samples', () => {
  assert.equal(confirmation('State Farm'), fill(SAMPLE.confirm, vars))
  assert.equal(OPT_IN_REPLY, SAMPLE.optIn)
})

test('link has no scheme and survives a trailing slash', () => {
  assert.equal(shortLink('https://portal.ohvara.com/', 'abc'), 'portal.ohvara.com/r/abc')
})

test('every body starts with the brand and ends with STOP', () => {
  for (const s of ['missed', 'reminder', 'sorry'] as const) {
    const b = compose(row({ sample: s }), APP)
    assert.ok(b.startsWith('Ohvara: '), s)
    assert.ok(b.endsWith('Reply STOP to opt out.'), s)
  }
})

test('an unknown sample throws instead of inventing a text', () => {
  assert.throws(() => compose(row({ sample: 'pm' as never }), APP))
})

// ── the words: every text Twilio took keeps them on its log row (198) ───────
type LogRow = { policy_id: string; kind: string; ok: boolean; twilio_sid: string | null; error: string | null; body: string | null }

// A fake database and Twilio: mark / logConfirm write rows the way the SQL
// functions do (no body), keepWords adds it the way index.ts does.
function fake(queues: Record<string, Row[]>, over: Partial<Deps> = {}, refuse: (body: string) => boolean = () => false) {
  const sent: { to: string; body: string; sid?: string }[] = []
  const log: LogRow[] = []
  const write = (policy_id: string, kind: string, r: SendResult) =>
    log.push({ policy_id, kind, ok: r.ok, twilio_sid: r.sid ?? null, error: r.error ?? null, body: null })
  const deps: Deps = {
    claim: async fn => queues[fn] ?? [],
    mark: async (_fn, r, result) => { write(r.policy_id, r.kind, result) },
    logConfirm: async (r, c) => { write(r.policy_id, 'confirm', c) },
    send: async (to, body) => {
      if (refuse(body)) { sent.push({ to, body }); return { ok: false, error: '400 30003' } }
      const sid = `SM${sent.length + 1}`
      sent.push({ to, body, sid })
      return { ok: true, sid }
    },
    keepWords: async (policyId, kind, sid, body) => {
      for (const l of log) if (l.policy_id === policyId && l.kind === kind && l.twilio_sid === sid) l.body = body
    },
    appUrl: APP,
    ...over,
  }
  return { deps, sent, log }
}

test('no-answer and missed-by-us texts: each log row carries the exact words sent', async () => {
  const f = fake({
    recovery_claim_due: [row({ kind: 'text1', sample: 'missed' }), row({ policy_id: 'p2', kind: 'text2', sample: 'reminder' })],
    missed_claim_due: [row({ policy_id: 'p3', kind: 'apology1', sample: 'sorry' })],
  })
  assert.deepEqual(await sendDue(f.deps), { configured: true, claimed: 3, sent: 3, failed: 0 })
  assert.equal(f.sent.length, 3)
  assert.equal(f.log.length, 3)
  for (const l of f.log) {
    const m = f.sent.find(s => s.sid === l.twilio_sid)
    assert.ok(m)
    assert.equal(l.body, m.body)
  }
  assert.equal(f.log[0].body, compose(row({ kind: 'text1', sample: 'missed' }), APP))
  assert.equal(f.log[1].body, compose(row({ policy_id: 'p2', kind: 'text2', sample: 'reminder' }), APP))
  assert.equal(f.log[2].body, compose(row({ policy_id: 'p3', kind: 'apology1', sample: 'sorry' }), APP))
})

test('the first-text confirmation keeps its words on its own row', async () => {
  const r = row({ needs_confirm: true })
  const f = fake({ recovery_claim_due: [r] })
  assert.deepEqual(await sendDue(f.deps), { configured: true, claimed: 1, sent: 2, failed: 0 })
  assert.deepEqual(f.log.map(l => [l.kind, l.body]), [['confirm', confirmation('State Farm')], ['text1', compose(r, APP)]])
  assert.deepEqual(f.sent.map(s => s.body), f.log.map(l => l.body))
})

test('a refused text keeps no words; a refused confirmation stops its text', async () => {
  let f = fake({ recovery_claim_due: [row({})] }, {}, () => true)
  assert.deepEqual(await sendDue(f.deps), { configured: true, claimed: 1, sent: 0, failed: 1 })
  assert.deepEqual(f.log.map(l => [l.kind, l.ok, l.body]), [['text1', false, null]])
  f = fake({ recovery_claim_due: [row({ needs_confirm: true })] }, {}, () => true)
  assert.deepEqual(await sendDue(f.deps), { configured: true, claimed: 1, sent: 0, failed: 1 })
  assert.equal(f.sent.length, 1)
  assert.deepEqual(f.log.map(l => [l.kind, l.ok, l.body]), [['confirm', false, null]])
})

test('a failed words write never holds up the next text or changes the counts', async () => {
  const f = fake(
    { recovery_claim_due: [row({}), row({ policy_id: 'p2' })] },
    { keepWords: async () => { throw new Error('column not there yet') } },
  )
  assert.deepEqual(await sendDue(f.deps), { configured: true, claimed: 2, sent: 2, failed: 0 })
  assert.equal(f.sent.length, 2)
  assert.deepEqual(f.log.map(l => l.body), [null, null])
})

test('sms_live off: the claims hand back nothing, so nothing is sent or logged', async () => {
  const f = fake({})
  assert.deepEqual(await sendDue(f.deps), { configured: true, claimed: 0, sent: 0, failed: 0 })
  assert.equal(f.sent.length, 0)
  assert.equal(f.log.length, 0)
})

test('inbound keywords', () => {
  assert.equal(inboundIntent('stop'), 'stop')
  assert.equal(inboundIntent(' Stop. '), 'stop')
  assert.equal(inboundIntent('UNSUBSCRIBE'), 'stop')
  assert.equal(inboundIntent('cancel'), 'stop')
  assert.equal(inboundIntent('start'), 'start')
  assert.equal(inboundIntent('Yes'), 'start')
  assert.equal(inboundIntent('UNSTOP'), 'start')
  assert.equal(inboundIntent('help'), 'help')
  assert.equal(inboundIntent('please stop calling me'), null)
  assert.equal(inboundIntent('anything', 'STOP'), 'stop')
  assert.equal(inboundIntent('stop', 'START'), 'start')
})
