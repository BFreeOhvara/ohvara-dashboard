/**
 * P1027 — payment-intake: finer categories, name-style addresses, Gmail's forwarding code, the AI reader filling
 * gaps, and the Resend webhook (Svix signature, fetch by id). No network, no database.
 * Run: node --test supabase/functions/payment-intake/core.p1027.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOf, parseNotice, tokenFrom, readInbound, handle, gmailConfirm, mergeAi, needsAi, svixSign, type Store, type Parsed } from './core.ts'

// A stand-in for an Ethos notice until Brayden's real sample (client details removed) replaces it.
const ETHOS = `Hi Dana,

We were unable to process the premium payment for your client's policy.

Policy Owner: Maria Lopez
Policy Number: ETH-4471-22
Payment Due Date: November 3, 2026
Amount: $42.18

The policy is now in its grace period. If payment is not received by December 3, 2026, coverage will lapse.
Log in to the Ethos agent portal to see details.`

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://fn.example/payment-intake', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('categories', () => {
  assert.equal(categoryOf('Pending lapse notice', ''), 'pending_lapse')
  assert.equal(categoryOf("Your client's policy will lapse", 'unless the premium is paid'), 'pending_lapse')
  assert.equal(categoryOf('Policy in grace period', 'The policy entered its grace period.'), 'grace')
  assert.equal(categoryOf('Returned payment', 'The bank returned the draft for policy 123456'), 'returned')
  assert.equal(categoryOf('Premium not received', 'for policy 123456'), 'failed')
  assert.equal(categoryOf('Policy lapsed', 'This policy has lapsed.'), 'lapsed')
  assert.equal(categoryOf('You have a new message', 'A new document is available for one of your policies. Log in to view it.'), 'login')
  assert.equal(categoryOf('Webinar: grow your book', 'Join us Thursday! Unsubscribe'), 'ignore')
  assert.equal(categoryOf('test', 'testing my forwarding'), 'ignore')
  assert.equal(categoryOf('Policy update', 'An update about your policy owner address.'), 'other')
})

test('Ethos stand-in, auto-forwarded (the carrier stays the outer From)', () => {
  const p = parseNotice('Action needed: premium payment unsuccessful', ETHOS, 'Ethos <notifications@ethoslife.com>')
  assert.equal(p.category, 'pending_lapse')
  assert.equal(p.kind, 'missed')
  assert.equal(p.policy_number, 'ETH-4471-22')
  assert.equal(p.client_name, 'Maria Lopez')
  assert.equal(p.due_date, '2026-11-03')
  assert.equal(p.amount, '42.18')
  assert.equal(p.sender_domain, 'ethoslife.com')
})

test('addresses: name style, old style, Resend to-array', () => {
  assert.equal(tokenFrom('dana-7k2f@notices.ohvara.com'), 'dana-7k2f')
  assert.equal(tokenFrom('"Ohvara" <Dana-7K2F@notices.ohvara.com>'), 'dana-7k2f')
  assert.equal(tokenFrom('dana-7k2f'), 'dana-7k2f')
  assert.equal(tokenFrom('dana@notices.ohvara.com'), null)
  assert.equal(tokenFrom('dana-7k2f@evil.example'), null)
  assert.equal(tokenFrom('pay+k7m2q9xd4a@in.ohvara.com'), 'k7m2q9xd4a')
  const r = readInbound({ from: 'x@ethoslife.com', to: ['dana-7k2f@notices.ohvara.com'], subject: 's', text: 't', message_id: '<m@x>' })
  assert.equal(r.token, 'dana-7k2f')
})

test("Gmail's forwarding confirmation", () => {
  const g = gmailConfirm('Gmail Team <forwarding-noreply@google.com>', '(#812345678) Gmail Forwarding Confirmation - Receive Mail from dana@gmail.com',
    'dana@gmail.com has requested to automatically forward mail to your email address dana-7k2f@notices.ohvara.com.\nConfirmation code: 812345678\nTo allow, click:\nhttps://mail-settings.google.com/mail/vf-%5BABC%5D-xyz\n')
  assert.deepEqual(g, { code: '812345678', link: 'https://mail-settings.google.com/mail/vf-%5BABC%5D-xyz', forAddr: 'dana@gmail.com' })
  assert.equal(gmailConfirm('x@ethoslife.com', 'Premium not received', ''), null)
})

test('AI fills only what the rules missed', () => {
  const p = parseNotice('You have a new message', 'A new document is available for your policy. Log in to view it.', 'svc@carrier.example')
  assert.equal(p.category, 'login')
  assert.equal(needsAi(p), true)
  const m = mergeAi(p, { category: 'grace', client_name: 'Ann Lee', policy_number: 'ab-123456', due_date: '2026-11-03', amount: '$12.00' })
  assert.deepEqual([m.category, m.kind, m.client_name, m.policy_number, m.due_date, m.amount, m.read_by], ['grace', 'missed', 'Ann Lee', 'AB-123456', '2026-11-03', '12.00', 'ai'])
  const keep = mergeAi(parseNotice('Premium not received', ETHOS, ''), { category: 'paid', client_name: 'Someone Else' })
  assert.deepEqual([keep.category, keep.client_name], ['pending_lapse', 'Maria Lopez'])
  assert.equal(needsAi(parseNotice('Webinar', 'unsubscribe')), false)
  assert.equal(mergeAi(p, null), p)
})

test('handler: a Gmail code goes to gmailCode, not receive', async () => {
  const calls: unknown[][] = []
  const s: Store = { async receive() { throw new Error('no') }, async gmailCode(...a) { calls.push(a); return { status: 'gmail_code' } } }
  const r = await handle(post({ from: 'forwarding-noreply@google.com', to: 'dana-7k2f@notices.ohvara.com', subject: '(#812345678) Gmail Forwarding Confirmation - Receive Mail from dana@gmail.com', text: 'https://mail-settings.google.com/mail/vf-x', message_id: 'g1' }, { 'x-ohvara-intake': 'k' }), s, 'k')
  assert.deepEqual(await r.json(), { status: 'gmail_code', kind: 'gmail' })
  assert.deepEqual(calls[0], ['dana-7k2f', '812345678', 'https://mail-settings.google.com/mail/vf-x', 'dana@gmail.com'])
})

test('handler: Resend webhook, signed, fetched by id, AI used when unclear', async () => {
  const secret = 'whsec_' + btoa('0123456789abcdef0123456789abcdef')
  const now = 1_800_000_000_000
  const ev = JSON.stringify({ type: 'email.received', data: { email_id: 'em-1', to: ['dana-7k2f@notices.ohvara.com'], from: 'x@ethoslife.com', subject: 'Policy update' } })
  const ts = String(now / 1000)
  const sig = await svixSign(secret, 'msg_1', ts, ev)
  const calls: unknown[][] = []
  const s: Store = { async receive(...a) { calls.push(a); return { status: 'matched' } } }
  const fetched: string[] = []
  const opts = {
    resendSecret: secret, now: () => now,
    fetchResend: async (id: string) => { fetched.push(id); return { id, from: 'Ethos <x@ethoslife.com>', to: ['dana-7k2f@notices.ohvara.com'], subject: 'Policy update', text: 'An update about your policy. Insured: Maria Lopez', message_id: '<abc@ethos>' } },
    ai: async () => ({ category: 'grace' as const }),
  }
  const req = (sg: string) => new Request('https://fn.example/payment-intake', { method: 'POST', headers: { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sg }, body: ev })
  assert.equal((await handle(req('v1,AAAA'), s, undefined, opts)).status, 401)
  assert.equal((await handle(req('v1,' + sig), s, undefined, { ...opts, now: () => now + 600_000 })).status, 401)
  assert.equal(fetched.length, 0)
  const r = await handle(req('v1,' + sig), s, undefined, opts)
  assert.equal(r.status, 200)
  assert.deepEqual(fetched, ['em-1'])
  const [token, mid, , , , parsed] = calls[0] as [string, string, string, string, string, Parsed]
  assert.deepEqual([token, mid, parsed.category, parsed.read_by, parsed.sender_domain], ['dana-7k2f', '<abc@ethos>', 'grace', 'ai', 'ethoslife.com'])
  assert.equal((await handle(req('v1,' + sig), s, undefined, { resendSecret: secret })).status, 503)
  const other = JSON.stringify({ type: 'email.sent', data: {} })
  const sig2 = await svixSign(secret, 'msg_2', ts, other)
  const r2 = await handle(new Request('https://fn.example/x', { method: 'POST', headers: { 'svix-id': 'msg_2', 'svix-timestamp': ts, 'svix-signature': 'v1,' + sig2 }, body: other }), s, undefined, opts)
  assert.deepEqual(await r2.json(), { status: 'ignored_event' })
})
