/**
 * P885 — payment-intake: what kind of email it is, the policy number / insured / due date / amount, the forwarded
 * sender, the token from the address, Postmark and plain JSON, and the handler's secret checks.
 * No network, no database. Run: node --test supabase/functions/payment-intake/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindOf, isoDate, parseNotice, tokenFrom, readInbound, handle, carrierHint, stripHtml, type Store, type Parsed } from './core.ts'

const LAPSE_PENDING = `---------- Forwarded message ---------
From: Harborline Life Service <service@harborline.example>
Subject: Lapse Pending Notice

Dear Agent,
The premium payment for the policy below was returned by the bank (insufficient funds).
Insured Name: Harold Brooks
Policy Number: HL-100-200
Premium Due Date: 11/03/2026
Amount Due: $86.40
The policy enters its grace period.`

test('kind: missed, lapsed, paid, other', () => {
  assert.equal(kindOf('Lapse Pending Notice', ''), 'missed')
  assert.equal(kindOf('Fwd: NSF', 'returned item'), 'missed')
  assert.equal(kindOf('Payment unsuccessful', ''), 'missed')
  assert.equal(kindOf('Important', 'We were unable to process your draft'), 'missed')
  assert.equal(kindOf('Policy status', 'Your policy has lapsed for non-payment'), 'lapsed')
  assert.equal(kindOf('Notice', 'This policy was terminated for nonpayment of premium'), 'lapsed')
  assert.equal(kindOf('Thank you for your payment', ''), 'paid')
  assert.equal(kindOf('Payment received', 'premium payment was received'), 'paid')
  assert.equal(kindOf('Your annual statement', 'Here is your statement'), 'other')
})

test('dates in carrier formats', () => {
  assert.equal(isoDate('11/03/2026'), '2026-11-03')
  assert.equal(isoDate('2026-11-3'), '2026-11-03')
  assert.equal(isoDate('Nov 3, 2026'), '2026-11-03')
  assert.equal(isoDate('November 3rd 2026'), '2026-11-03')
  assert.equal(isoDate('3 November 2026'), '2026-11-03')
  assert.equal(isoDate('11/3/26'), '2026-11-03')
  assert.equal(isoDate('02/30/2026'), null)
  assert.equal(isoDate('13/01/2026'), null)
})

test('a forwarded lapse-pending email', () => {
  const p = parseNotice('Fwd: Lapse Pending Notice', LAPSE_PENDING, 'Dana <dana@agent.example>')
  assert.deepEqual(p, { kind: 'missed', policy_number: 'HL-100-200', client_name: 'Harold Brooks', due_date: '2026-11-03', amount: '86.40', carrier_hint: 'Harborline Life Service' })
})

test('other wordings', () => {
  const p = parseNotice('Returned EFT - Contract # PA0077123', 'Policyholder: ORTEGA, LUISA\nDraft date: Oct 28, 2026\nAmount $1,112.00', 'billing@pinecrest.example')
  assert.equal(p.policy_number, 'PA0077123')
  assert.equal(p.client_name, 'ORTEGA, LUISA')
  assert.equal(p.due_date, '2026-10-28')
  assert.equal(p.amount, '1112.00')
  assert.equal(p.carrier_hint, 'pinecrest.example')
  const none = parseNotice('Hello', 'nothing useful here')
  assert.deepEqual([none.kind, none.policy_number, none.client_name, none.due_date], ['other', null, null, null])
})

test('html-only email', () => {
  const t = stripHtml('<p>Policy No: <b>HL-600</b></p><p>Payment&nbsp;declined</p><style>.x{}</style>')
  const p = parseNotice('', t)
  assert.equal(p.policy_number, 'HL-600')
  assert.equal(p.kind, 'missed')
})

test('carrier hint from the forwarded block, else the sender domain', () => {
  assert.equal(carrierHint('a@b.com', '> From: "Globe Life" <noreply@globe.example>'), 'Globe Life')
  assert.equal(carrierHint('notices@carrier.example', ''), 'carrier.example')
})

test('token from the address', () => {
  assert.equal(tokenFrom('Pay+K7m2Q9xd4a@in.ohvara.com'), 'k7m2q9xd4a')
  assert.equal(tokenFrom('', '"Dana" <pay+k7m2q9xd4a@in.ohvara.com>'), 'k7m2q9xd4a')
  assert.equal(tokenFrom('k7m2q9xd4a'), 'k7m2q9xd4a')
  assert.equal(tokenFrom('someone@in.ohvara.com', null), null)
})

test('Postmark and plain JSON', () => {
  const pm = readInbound({ From: 'Dana <d@x>', To: 'pay+k7m2q9xd4a@in.ohvara.com', MailboxHash: 'k7m2q9xd4a', Subject: 'Fwd: NSF', TextBody: 'body', MessageID: 'pm-1' })
  assert.deepEqual(pm, { token: 'k7m2q9xd4a', messageId: 'pm-1', from: 'Dana <d@x>', subject: 'Fwd: NSF', text: 'body' })
  const plain = readInbound({ from: 'd@x', to: 'pay+abcdefghij@in.ohvara.com', subject: 's', html: '<p>hi</p>', message_id: 'm-1' })
  assert.equal(plain.token, 'abcdefghij')
  assert.equal(plain.text.trim(), 'hi')
})

function store() {
  const calls: unknown[][] = []
  const s: Store = { async receive(...a) { calls.push(a); return { status: 'matched', intake_id: 'i1' } } }
  return { s, calls }
}
const post = (body: unknown, headers: Record<string, string> = {}, q = '') =>
  new Request(`https://fn.example/payment-intake${q}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const EMAIL = { From: 'Dana <d@x>', To: 'pay+k7m2q9xd4a@in.ohvara.com', Subject: 'Fwd: Lapse Pending Notice', TextBody: LAPSE_PENDING, MessageID: 'pm-1' }

test('handler: secret checks', async () => {
  const { s, calls } = store()
  assert.equal((await handle(post(EMAIL), s, undefined)).status, 503)
  assert.equal((await handle(post(EMAIL), s, 'sekret')).status, 401)
  assert.equal((await handle(post(EMAIL, { 'x-ohvara-intake': 'wrong!' }), s, 'sekret')).status, 401)
  assert.equal((await handle(new Request('https://fn.example/x'), s, 'sekret')).status, 405)
  assert.equal(calls.length, 0)
  assert.equal((await handle(post(EMAIL, { 'x-ohvara-intake': 'sekret' }), s, 'sekret')).status, 200)
  assert.equal((await handle(post(EMAIL, { authorization: 'Basic ' + btoa('postmark:sekret') }), s, 'sekret')).status, 200)
  assert.equal((await handle(post(EMAIL, {}, '?key=sekret'), s, 'sekret')).status, 200)
  assert.equal(calls.length, 3)
})

test('handler: passes the parsed email to the database', async () => {
  const { s, calls } = store()
  const r = await handle(post(EMAIL, { 'x-ohvara-intake': 'k' }), s, 'k')
  assert.deepEqual(await r.json(), { status: 'matched', intake_id: 'i1', kind: 'missed' })
  const [token, mid, , subject, , parsed] = calls[0] as [string, string, string, string, string, Parsed]
  assert.equal(token, 'k7m2q9xd4a')
  assert.equal(mid, 'pm-1')
  assert.equal(subject, 'Fwd: Lapse Pending Notice')
  assert.equal(parsed.policy_number, 'HL-100-200')
  assert.equal(parsed.due_date, '2026-11-03')
})

test('handler: no token = 200 unknown address (no retry storm); no message id = 400; junk = 400', async () => {
  const { s, calls } = store()
  const h = { 'x-ohvara-intake': 'k' }
  const r = await handle(post({ ...EMAIL, To: 'x@y', MailboxHash: '' }, h), s, 'k')
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { status: 'unknown_address' })
  assert.equal((await handle(post({ ...EMAIL, MessageID: '' }, h), s, 'k')).status, 400)
  assert.equal((await handle(new Request('https://fn.example/x', { method: 'POST', headers: h, body: 'not json' }), s, 'k')).status, 400)
  assert.equal(calls.length, 0)
})
