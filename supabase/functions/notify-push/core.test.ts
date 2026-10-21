/**
 * Node unit tests for the phone alert sender (Prompt 775). Apple and Google
 * are mocked (real keys are generated here only to check the signatures):
 * no real alert is sent.
 * Run: node --test supabase/functions/notify-push/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, sendDue, message, apnsSender, fcmSender, signJwt, checkKeys, type Store, type Due, type Senders } from './core.ts'

const SECRET = 's3cret'
const due = (o: Partial<Due> = {}): Due => ({
  id: crypto.randomUUID(), profile_id: 'p1', type: 'policy_cancelled', title: 'Maria’s old policy is cancelled',
  body: 'Confirmation CX-1001', link: '/agent/clients', badge: 3,
  devices: [{ token: 'ios-token', platform: 'ios' }, { token: 'and-token', platform: 'android' }], ...o,
})

function memStore(rows: Due[]) {
  const finished: { id: string; ok: boolean; error: string | null; dead: string[] }[] = []
  let claimed = false
  const store: Store = {
    async cronOk(s) { return s === SECRET },
    async claim() { if (claimed) return []; claimed = true; return rows },
    async finish(id, ok, error, dead) { finished.push({ id, ok, error, dead }) },
  }
  return { store, finished }
}
const req = (secret?: string, method = 'POST') =>
  new Request('https://x/functions/v1/notify-push', { method, headers: secret ? { 'x-ohvara-cron': secret } : {} })

test('refuses people (no / wrong cron secret) and leaves the queue alone without keys', async () => {
  const { store, finished } = memStore([due()])
  const ok: Senders = { ios: async () => ({ ok: true }) }
  assert.equal((await handle(req(), store, ok)).status, 403)
  assert.equal((await handle(req('nope'), store, ok)).status, 403)
  assert.equal((await handle(req(SECRET, 'GET'), store, ok)).status, 405)
  const none = await handle(req(SECRET), store, {})
  assert.deepEqual(await none.json(), { configured: false, sent: 0 })
  assert.equal(finished.length, 0)
})

test('sends to every phone; one phone working is a success', async () => {
  const sent: string[] = []
  const { store, finished } = memStore([due()])
  const res = await handle(req(SECRET), store, {
    ios: async t => { sent.push(`ios:${t}`); return { ok: true } },
    android: async t => { sent.push(`and:${t}`); return { ok: false, error: 'QUOTA_EXCEEDED' } },
  })
  const body = await res.json()
  assert.equal(body.sent, 1)
  assert.deepEqual(sent, ['ios:ios-token', 'and:and-token'])
  assert.equal(finished[0].ok, true)
  assert.equal(finished[0].error, null)
})

test('dead tokens are reported for deletion; all phones dead = no_device', async () => {
  const { store, finished } = memStore([due()])
  await sendDue(store, { ios: async () => ({ ok: false, dead: true, error: 'Unregistered' }), android: async () => ({ ok: false, dead: true, error: 'UNREGISTERED' }) })
  assert.deepEqual(finished[0], { id: finished[0].id, ok: false, error: 'no_device', dead: ['ios-token', 'and-token'] })
  const two = memStore([due({ devices: [] })])
  await sendDue(two.store, { ios: async () => ({ ok: true }) })
  assert.equal(two.finished[0].error, 'no_device')
})

test('a platform without keys is a retryable failure, not a crash', async () => {
  const { store, finished } = memStore([due({ devices: [{ token: 'ios-token', platform: 'ios' }] })])
  await sendDue(store, { android: async () => ({ ok: true }) })
  assert.equal(finished[0].ok, false)
  assert.match(finished[0].error!, /ios: not set up/)
  assert.deepEqual(finished[0].dead, [])
})

test('message: safe in-app link, trimmed body, badge never negative', () => {
  assert.equal(message(due({ link: 'https://evil.example' })).link, '/')
  assert.equal(message(due({ link: null })).link, '/')
  assert.equal(message(due({ body: 'x'.repeat(400) })).body.length, 300)
  assert.equal(message(due({ badge: -2 })).badge, 0)
})

async function ecPem() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
  return { kp, pem: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` }
}
async function rsaPem() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
  return { kp, pem: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----` }
}
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0))
const part = (jwt: string, i: number) => JSON.parse(new TextDecoder().decode(unb64(jwt.split('.')[i])))

test('APNs: ES256 provider token, right host/topic/payload, 410 = dead, token reused', async () => {
  const { kp, pem } = await ecPem()
  const calls: { url: string; init: any }[] = []
  let status = 200
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return new Response(status === 200 ? '' : JSON.stringify({ reason: 'Unregistered' }), { status })
  }) as typeof fetch
  const send = apnsSender({ keyP8: pem, keyId: 'KEY123', teamId: 'TEAM99', bundleId: 'com.ohvara.portal', production: true }, f, () => 1_760_000_000_000)
  const m = message(due())
  assert.deepEqual(await send('abc', m), { ok: true })
  assert.equal(calls[0].url, 'https://api.push.apple.com/3/device/abc')
  assert.equal(calls[0].init.headers['apns-topic'], 'com.ohvara.portal')
  assert.equal(calls[0].init.headers['apns-push-type'], 'alert')
  const jwt = calls[0].init.headers.authorization.replace('bearer ', '')
  assert.deepEqual(part(jwt, 0), { alg: 'ES256', typ: 'JWT', kid: 'KEY123' })
  assert.deepEqual(part(jwt, 1), { iss: 'TEAM99', iat: 1_760_000_000 })
  const [h, c, sig] = jwt.split('.')
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, unb64(sig), new TextEncoder().encode(`${h}.${c}`)))
  const payload = JSON.parse(calls[0].init.body)
  assert.deepEqual(payload.aps.alert, { title: m.title, body: m.body })
  assert.equal(payload.aps.badge, 3)
  assert.equal(payload.link, '/agent/clients')
  status = 410
  assert.deepEqual(await send('old', m), { ok: false, dead: true, error: 'Unregistered' })
  assert.equal(calls[1].init.headers.authorization, calls[0].init.headers.authorization)
  const sandbox = apnsSender({ keyP8: pem, keyId: 'K', teamId: 'T', bundleId: 'b', production: false }, f)
  await sandbox('x', m)
  assert.match(calls[2].url, /^https:\/\/api\.sandbox\.push\.apple\.com\//)
})

test('FCM: RS256 service-account token once, v1 send with link data, UNREGISTERED = dead', async () => {
  const { kp, pem } = await rsaPem()
  const calls: { url: string; init: any }[] = []
  let sendStatus = 200
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'ya29.tok', expires_in: 3600 }), { status: 200 })
    if (sendStatus === 200) return new Response('{}', { status: 200 })
    return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 })
  }) as typeof fetch
  const send = fcmSender({ project_id: 'ohvara-app', client_email: 'push@ohvara-app.iam.gserviceaccount.com', private_key: pem }, f, () => 1_760_000_000_000)
  const m = message(due())
  assert.deepEqual(await send('fcm-1', m), { ok: true })
  assert.deepEqual(await send('fcm-2', m), { ok: true })
  assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1)
  const assertion = new URLSearchParams(calls[0].init.body).get('assertion')!
  assert.deepEqual(part(assertion, 1), {
    iss: 'push@ohvara-app.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: 1_760_000_000, exp: 1_760_003_600,
  })
  const [h, c, sig] = assertion.split('.')
  assert.ok(await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, kp.publicKey, unb64(sig), new TextEncoder().encode(`${h}.${c}`)))
  assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/ohvara-app/messages:send')
  assert.equal(calls[1].init.headers.authorization, 'Bearer ya29.tok')
  const body = JSON.parse(calls[1].init.body).message
  assert.equal(body.token, 'fcm-1')
  assert.deepEqual(body.data, { link: '/agent/clients', type: 'policy_cancelled' })
  assert.equal(body.android.notification.notification_count, 3)
  sendStatus = 404
  assert.deepEqual(await send('gone', m), { ok: false, dead: true, error: 'UNREGISTERED' })
})

test('signJwt rejects a key that is not PKCS8', async () => {
  await assert.rejects(signJwt('ES256', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', {}, {}))
})

test('dry run: made-up token only, never claims the queue; token refused = keys ok', async () => {
  const { store, finished } = memStore([due()])
  const tokens: string[] = []
  const check = new Request('https://x/functions/v1/notify-push', { method: 'POST', headers: { 'x-ohvara-cron': SECRET }, body: JSON.stringify({ check: true }) })
  const res = await handle(check, store, {
    ios: async t => { tokens.push(t); return { ok: false, dead: true, error: 'BadDeviceToken' } },
    android: async t => { tokens.push(t); return { ok: false, error: 'INVALID_ARGUMENT' } },
  })
  assert.deepEqual((await res.json()).check, { ios: { keys: 'ok', answer: 'BadDeviceToken' }, android: { keys: 'ok', answer: 'INVALID_ARGUMENT' } })
  assert.deepEqual(tokens, ['0'.repeat(64), 'ohvara-dry-run-not-a-device'])
  assert.equal(finished.length, 0)
  const noCron = new Request('https://x/functions/v1/notify-push', { method: 'POST', body: JSON.stringify({ check: true }) })
  assert.equal((await handle(noCron, store, {})).status, 403)
})

test('dry run: bad keys and missing keys are named', async () => {
  const out = await checkKeys({
    ios: async () => ({ ok: false, error: 'InvalidProviderToken' }),
    android: async () => { throw new Error('google token 400') },
  })
  assert.deepEqual(out, { ios: { keys: 'refused', answer: 'InvalidProviderToken' }, android: { keys: 'refused', answer: 'google token 400' } })
  assert.deepEqual(await checkKeys({}), { ios: { keys: 'not set up' }, android: { keys: 'not set up' } })
})
