/**
 * Unit tests for the inbound text webhook: STOP / START still only update the
 * opt-out list, every other text is saved once for the VA queue, and nothing
 * here ever sends a text. Fake database, signed requests, no network.
 * Run: deno test supabase/functions/twilio-sms-webhook/
 *  or: node --test supabase/functions/twilio-sms-webhook/core.test.ts
 */
import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { twilioSignature } from '../_shared/twilio.ts'
import { handle, replyToSave, EMPTY_TWIML, MAX_BODY, type Deps, type ReplyRow } from './core.ts'

const TOKEN = 'test-auth-token'
const URL_ = 'https://example.supabase.co/functions/v1/twilio-sms-webhook'
const LEAD = '0b7e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d'
const PHONE = '+12145550100'

type Call = { fn: string; args: Record<string, unknown> }

// A fake database: rpc calls are recorded; lead_sms_replies enforces its
// unique twilio_sid the way Postgres does (23505).
function fakeDb(o: { leads?: Record<string, string>; rpcError?: string; insertError?: string } = {}) {
  const calls: Call[] = []
  const rows: ReplyRow[] = []
  const logs: string[] = []
  const deps: Deps = {
    token: TOKEN,
    publicUrl: URL_,
    rpc(fn, args) {
      calls.push({ fn, args })
      if (o.rpcError) return Promise.resolve({ data: null, error: { message: o.rpcError } })
      if (fn === 'lead_sms_match') return Promise.resolve({ data: o.leads?.[args.p_phone as string] ?? null, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    insertReply(row) {
      if (o.insertError) return Promise.resolve({ error: { message: o.insertError } })
      if (rows.some(r => r.twilio_sid === row.twilio_sid)) {
        return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint', code: '23505' } })
      }
      rows.push(row)
      return Promise.resolve({ error: null })
    },
    log: msg => logs.push(msg),
  }
  return { deps, calls, rows, logs }
}

async function signed(params: Record<string, string>, opts: { badSig?: boolean } = {}) {
  const sig = opts.badSig ? 'not-the-signature' : await twilioSignature(TOKEN, URL_, params)
  return new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig },
    body: new URLSearchParams(params).toString(),
  })
}

const inbound = (o: Record<string, string> = {}) => ({
  MessageSid: 'SM00000000000000000000000000000001', From: PHONE, To: '+18175550199', Body: 'Yes call me after 5', ...o,
})

async function assertEmptyTwiml(res: Response) {
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'text/xml')
  assert.equal(await res.text(), EMPTY_TWIML)
}

// Nothing in the webhook may send a text: every test runs with fetch swapped
// for a recorder, and any network call fails it.
function test(name: string, fn: () => Promise<void> | void) {
  nodeTest(name, async () => {
    const realFetch = globalThis.fetch
    const fetched: string[] = []
    globalThis.fetch = ((input: string | URL | Request) => {
      fetched.push(String(input instanceof Request ? input.url : input))
      return Promise.reject(new Error('no network in tests'))
    }) as typeof fetch
    try {
      await fn()
    } finally {
      globalThis.fetch = realFetch
    }
    assert.deepEqual(fetched, [], 'the webhook made a network call')
  })
}

test('STOP calls sms_set_opt with the same arguments as before and saves no reply', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD } })
  await assertEmptyTwiml(await handle(await signed(inbound({ Body: 'STOP' })), db.deps))
  assert.deepEqual(db.calls, [{ fn: 'sms_set_opt', args: { p_phone: PHONE, p_opted_out: true, p_source: 'STOP' } }])
  assert.equal(db.rows.length, 0)
})

test('START calls sms_set_opt with the same arguments as before and saves no reply', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD } })
  await assertEmptyTwiml(await handle(await signed(inbound({ Body: 'start' })), db.deps))
  assert.deepEqual(db.calls, [{ fn: 'sms_set_opt', args: { p_phone: PHONE, p_opted_out: false, p_source: 'START' } }])
  assert.equal(db.rows.length, 0)
})

test("Twilio's OptOutType still wins over the words (unchanged)", async () => {
  const db = fakeDb()
  await assertEmptyTwiml(await handle(await signed(inbound({ Body: 'please stop texting me', OptOutType: 'STOP' })), db.deps))
  assert.deepEqual(db.calls, [{ fn: 'sms_set_opt', args: { p_phone: PHONE, p_opted_out: true, p_source: 'STOP' } }])
  assert.equal(db.rows.length, 0)
})

test('sms_set_opt failing still returns 500 so Twilio retries (unchanged)', async () => {
  const db = fakeDb({ rpcError: 'boom' })
  const res = await handle(await signed(inbound({ Body: 'STOP' })), db.deps)
  assert.equal(res.status, 500)
  assert.equal(db.rows.length, 0)
})

test('a normal reply is saved with the matched lead_id', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD } })
  await assertEmptyTwiml(await handle(await signed(inbound()), db.deps))
  assert.deepEqual(db.calls, [{ fn: 'lead_sms_match', args: { p_phone: PHONE } }])
  assert.deepEqual(db.rows, [{
    twilio_sid: 'SM00000000000000000000000000000001', from_phone: PHONE, body: 'Yes call me after 5', lead_id: LEAD,
  }])
})

test('a number with no lead is saved with lead_id null', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD } })
  await assertEmptyTwiml(await handle(await signed(inbound({ From: '+13125550111' })), db.deps))
  assert.equal(db.rows.length, 1)
  assert.equal(db.rows[0].lead_id, null)
  assert.equal(db.rows[0].from_phone, '+13125550111')
})

test('HELP is saved as a reply (Twilio answers it), with no opt change', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD } })
  await assertEmptyTwiml(await handle(await signed(inbound({ Body: 'HELP' })), db.deps))
  assert.ok(!db.calls.some(c => c.fn === 'sms_set_opt'))
  assert.equal(db.rows.length, 1)
  assert.equal(db.rows[0].body, 'HELP')
})

test('a duplicate MessageSid (Twilio retry) is saved once and still answered with empty TwiML', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD } })
  await assertEmptyTwiml(await handle(await signed(inbound()), db.deps))
  await assertEmptyTwiml(await handle(await signed(inbound()), db.deps))
  assert.equal(db.rows.length, 1)
  assert.deepEqual(db.logs, [])
})

test('a bad signature saves nothing and touches nothing', async () => {
  for (const Body of ['Yes call me after 5', 'STOP', 'START']) {
    const db = fakeDb({ leads: { [PHONE]: LEAD } })
    const res = await handle(await signed(inbound({ Body }), { badSig: true }), db.deps)
    assert.equal(res.status, 403)
    assert.deepEqual(db.calls, [])
    assert.equal(db.rows.length, 0)
  }
})

test('a missing signature saves nothing', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD } })
  const req = new Request(URL_, { method: 'POST', body: new URLSearchParams(inbound()).toString() })
  assert.equal((await handle(req, db.deps)).status, 403)
  assert.equal(db.rows.length, 0)
})

test('a failed save returns 500 so Twilio retries, and logs no phone or body', async () => {
  const db = fakeDb({ leads: { [PHONE]: LEAD }, insertError: 'connection reset' })
  const res = await handle(await signed(inbound()), db.deps)
  assert.equal(res.status, 500)
  assert.equal(db.logs.length, 1)
  assert.ok(!db.logs[0].includes('5550100') && !db.logs[0].includes('call me'))
})

test('a failed lead match returns 500 and saves nothing', async () => {
  const db = fakeDb({ rpcError: 'timeout' })
  const res = await handle(await signed(inbound()), db.deps)
  assert.equal(res.status, 500)
  assert.equal(db.rows.length, 0)
})

test('empty TwiML for every handled text', async () => {
  for (const Body of ['STOP', 'START', 'HELP', 'Yes call me after 5', '', 'unstop', 'Cancel']) {
    const db = fakeDb({ leads: { [PHONE]: LEAD } })
    await assertEmptyTwiml(await handle(await signed(inbound({ Body })), db.deps))
  }
})

test('not POST, or no auth token: refused, nothing saved', async () => {
  const db = fakeDb()
  assert.equal((await handle(new Request(URL_), db.deps)).status, 405)
  assert.equal((await handle(await signed(inbound()), { ...db.deps, token: undefined })).status, 503)
  assert.deepEqual(db.calls, [])
  assert.equal(db.rows.length, 0)
})

test('replyToSave: opt words and texts without a sender or sid are not replies; long bodies are cut', () => {
  assert.equal(replyToSave(inbound(), 'stop'), null)
  assert.equal(replyToSave(inbound(), 'start'), null)
  assert.equal(replyToSave(inbound({ MessageSid: '' }), null), null)
  assert.equal(replyToSave(inbound({ From: '' }), null), null)
  assert.deepEqual(replyToSave(inbound(), 'help'), { twilio_sid: 'SM00000000000000000000000000000001', from_phone: PHONE, body: 'Yes call me after 5' })
  assert.equal(replyToSave(inbound({ Body: 'x'.repeat(MAX_BODY + 50) }), null)!.body.length, MAX_BODY)
})
