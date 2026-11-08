/**
 * P880 — the live-transfer push format on the wire (APNs + FCM). No network.
 * Run: node --test supabase/functions/notify-push/transfer.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apnsBody, apnsHeaders, fcmMessage, message } from './core.ts'
import { checkPush, clearPush, sendAll, summaryLine } from './transfer.ts'

const C = { id: 'c0ffee00-0000-4000-8000-000000000001', summary: { name: 'Rosa Diaz', age: 64, state: 'TX', need: 'Final expense', your_client: true } }

test('the check push: iOS time-sensitive, Yes/No category, collapse id, 30 s expiry', () => {
  const m = checkPush(C, 'https://x/transfer-voice?event=seen')
  assert.equal(m.title, 'Your client · Live call: Rosa Diaz')
  const h = apnsHeaders('com.ohvara.portal', m, 1_000_000)
  assert.equal(h['apns-priority'], '10')
  assert.equal(h['apns-collapse-id'], C.id)
  assert.equal(h['apns-expiration'], String(1000 + 30))
  const b: any = apnsBody(m)
  assert.equal(b.aps['interruption-level'], 'time-sensitive')
  assert.equal(b.aps.category, 'OHVARA_TRANSFER')
  assert.equal(b.check_id, C.id)
  assert.equal(b.type, 'transfer_check')
})

test('the check push: Android data-only, high priority, 30 s ttl, collapse key (the app draws Yes/No)', () => {
  const f: any = fcmMessage('tok', checkPush(C, 'u'))
  assert.equal(f.notification, undefined)
  assert.equal(f.android.priority, 'HIGH')
  assert.equal(f.android.ttl, '30s')
  assert.equal(f.android.collapse_key, C.id)
  assert.equal(f.data.title, 'Your client · Live call: Rosa Diaz')
  assert.equal(f.data.check_id, C.id)
  assert.equal(f.data.seen_url, 'u')
})

test('the clear push replaces the same notification; ordinary alerts are unchanged', () => {
  const m = clearPush(C, 'gone')
  assert.equal(m.collapseId, C.id)
  assert.match(m.title, /No longer available/)
  assert.equal((apnsBody(m) as any).aps['interruption-level'], undefined)
  const plain: any = fcmMessage('tok', message({ id: '1', profile_id: 'p', type: 'message', title: 'Hi', body: 'x', link: '/m', devices: [], badge: 2 }))
  assert.equal(plain.notification.title, 'Hi')
  assert.equal(plain.android.notification.notification_count, 2)
  assert.equal(plain.android.ttl, undefined)
  const pa: any = apnsBody(message({ id: '1', profile_id: 'p', type: 'message', title: 'Hi', body: 'x', link: '/m', devices: [], badge: 2 }))
  assert.deepEqual(Object.keys(pa.aps).sort(), ['alert', 'badge', 'sound'])
  assert.equal(summaryLine({ state: 'TX' }), 'TX')
})

test('P903: the AI caller\'s check reads "Live caller ready: {first}, {age band}, {state}. Take the call?"', () => {
  const ai = { id: C.id, ai_call_id: 'a1', summary: { name: 'Pat', age: '55 to 64', state: 'TX', need: 'Mortgage protection', your_client: false } }
  const m = checkPush(ai, 'u')
  assert.equal(`${m.title}, ${m.body}`, 'Live caller ready: Pat, 55 to 64, TX. Take the call?')
  assert.equal(m.category, 'OHVARA_TRANSFER') // same Yes / No buttons and 30 s life
  assert.equal(m.ttlSec, 30)
  assert.doesNotMatch(`${m.title} ${m.body}`, /\bAI\b|virtual|Mortgage/)
  assert.equal(checkPush({ ...ai, summary: { name: 'Pat' } }, 'u').body, 'Take the call?')
  // A VA's check and the Setup test keep their P880 words.
  assert.equal(checkPush({ ...ai, is_test: true }, 'u').title, 'Test live call: Pat')
  assert.match(checkPush(C, 'u').body, /Can you take it now\?/)
  assert.equal(clearPush(ai, 'booking').title, 'Pat: Missed. We’re booking them on your calendar')
})

test('sendAll: every phone, skips the answering one, keeps going past a failure', async () => {
  const seen: string[] = []
  const out = await sendAll({ ios: async t => { seen.push(t); return t === 'a' ? { ok: false, dead: true, error: 'Unregistered' } : { ok: true } } },
    [{ token: 'a', platform: 'ios' }, { token: 'b', platform: 'ios' }, { token: 'c', platform: 'ios' }, { token: 'd', platform: 'android' }], clearPush(C, 'gone'), ['c'])
  assert.deepEqual(seen, ['a', 'b'])
  assert.equal(out.reached, 1)
  assert.deepEqual(out.dead, ['a'])
  assert.match(out.errors.join(), /android: not set up/)
})
