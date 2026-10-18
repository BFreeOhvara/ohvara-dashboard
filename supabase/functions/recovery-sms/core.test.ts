/**
 * Node unit tests for the client texts (Prompt 776): every body is
 * byte-compared to the sample registered with Twilio for the A2P campaign,
 * with the bracketed variables filled in. No Twilio call.
 * Run: node --test supabase/functions/recovery-sms/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, confirmation, shortLink, timeText, inboundIntent, OPT_IN_REPLY, type Row } from './core.ts'

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
