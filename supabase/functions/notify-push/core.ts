// Prompt 775 — sends queued phone alerts (notification_pushes, migration 156).
// pg_cron calls it every minute while something is due, with the
// x-ohvara-cron Vault secret; a request from a person is refused. The
// database decides who gets what, the Phone alerts switch and quiet hours
// (9 PM–8 AM their time, money problems always); this only claims due rows,
// sends them to each of the person's phones and records the result.
//
//   Android: Firebase Cloud Messaging HTTP v1 (service account → OAuth token).
//   iPhone:  APNs with a token-based .p8 key (ES256 JWT), HTTP/2.
//
// A platform without its keys is skipped (rows stay queued, then expire after
// 12 hours), so nothing breaks before Brayden adds the APNs key and Firebase.
// Tokens the store says are gone are deleted.

export type Device = { token: string; platform: 'ios' | 'android' }
export type Due = { id: string; profile_id: string; type: string; title: string; body: string | null; link: string | null; devices: Device[]; badge: number }
export type Msg = { title: string; body: string; link: string; badge: number; type: string }
export type Result = { ok: boolean; dead?: boolean; error?: string }
export type Sender = (token: string, m: Msg) => Promise<Result>
export type Senders = { ios?: Sender | null; android?: Sender | null }

export interface Store {
  cronOk(secret: string): Promise<boolean>
  claim(limit: number): Promise<Due[]>
  finish(id: string, ok: boolean, error: string | null, dead: string[]): Promise<void>
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ohvara-cron',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export function message(d: Due): Msg {
  return {
    title: d.title,
    body: (d.body || '').slice(0, 300),
    link: d.link && d.link.startsWith('/') ? d.link : '/',
    badge: Math.max(0, d.badge | 0),
    type: d.type,
  }
}

export async function sendDue(store: Store, senders: Senders, limit = 50) {
  const due = await store.claim(limit)
  let sent = 0, failed = 0
  for (const d of due) {
    if (!d.devices?.length) { await store.finish(d.id, false, 'no_device', []); failed++; continue }
    const m = message(d)
    const dead: string[] = []
    const errors: string[] = []
    let any = false
    for (const dev of d.devices) {
      const send = senders[dev.platform]
      if (!send) { errors.push(`${dev.platform}: not set up`); continue }
      try {
        const r = await send(dev.token, m)
        if (r.ok) any = true
        else {
          if (r.dead) dead.push(dev.token)
          errors.push(`${dev.platform}: ${r.error || 'failed'}`)
        }
      } catch (e) {
        errors.push(`${dev.platform}: ${(e as Error).message}`)
      }
    }
    // Every phone gone: nothing left to retry.
    const allDead = dead.length === d.devices.length
    await store.finish(d.id, any, any ? null : allDead ? 'no_device' : errors.join('; ').slice(0, 500), dead)
    if (any) sent++; else failed++
  }
  return { claimed: due.length, sent, failed }
}

// Prompt 789 — dry run ({"check": true} from the cron caller): one alert per
// set-up platform to a made-up device token, so Apple/Google refuse the token
// and nothing reaches anyone, but their answer shows whether our keys passed.
const FAKE_TOKEN = { ios: '0'.repeat(64), android: 'ohvara-dry-run-not-a-device' }
const KEYS_OK = {
  ios: ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'],
  android: ['INVALID_ARGUMENT', 'UNREGISTERED'],
}

export async function checkKeys(senders: Senders) {
  const out: Record<string, { keys: 'ok' | 'refused' | 'not set up'; answer?: string }> = {}
  for (const p of ['ios', 'android'] as const) {
    const send = senders[p]
    if (!send) { out[p] = { keys: 'not set up' }; continue }
    try {
      const r = await send(FAKE_TOKEN[p], { title: 'Ohvara check', body: '', link: '/', badge: 0, type: 'check' })
      const answer = r.ok ? 'accepted a made-up token' : r.error || 'failed'
      out[p] = { keys: !r.ok && KEYS_OK[p].includes(answer) ? 'ok' : 'refused', answer }
    } catch (e) {
      out[p] = { keys: 'refused', answer: (e as Error).message }
    }
  }
  return out
}

export async function handle(req: Request, store: Store, senders: Senders) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = req.headers.get('x-ohvara-cron')
  if (!secret || !(await store.cronOk(secret))) return json({ error: 'Not allowed' }, 403)
  const body = await req.json().catch(() => ({}))
  if (body?.check === true) return json({ check: await checkKeys(senders) })
  // No keys at all yet: leave the queue alone rather than burning tries.
  if (!senders.ios && !senders.android) return json({ configured: false, sent: 0 })
  try {
    return json({ configured: { ios: !!senders.ios, android: !!senders.android }, ...(await sendDue(store, senders)) })
  } catch (e) {
    console.error('[notify-push]', (e as Error).message)
    return json({ error: 'Push run failed' }, 500)
  }
}

// ── Signing (WebCrypto, works in Deno and Node) ─────────────────────────────

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))

function pemBody(pem: string) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function signJwt(alg: 'ES256' | 'RS256', pem: string, header: Record<string, unknown>, claims: Record<string, unknown>) {
  const params = alg === 'ES256'
    ? { import: { name: 'ECDSA', namedCurve: 'P-256' }, sign: { name: 'ECDSA', hash: 'SHA-256' } }
    : { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, sign: { name: 'RSASSA-PKCS1-v1_5' } }
  const key = await crypto.subtle.importKey('pkcs8', pemBody(pem), params.import, false, ['sign'])
  const input = `${b64urlJson({ alg, typ: 'JWT', ...header })}.${b64urlJson(claims)}`
  const sig = await crypto.subtle.sign(params.sign, key, new TextEncoder().encode(input))
  return `${input}.${b64url(sig)}`
}

// ── APNs (iPhone) ───────────────────────────────────────────────────────────

export type ApnsConfig = { keyP8: string; keyId: string; teamId: string; bundleId: string; production: boolean }

export function apnsSender(cfg: ApnsConfig, f: typeof fetch = fetch, now = () => Date.now()): Sender {
  let cached: { jwt: string; at: number } | null = null
  const host = cfg.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
  return async (token, m) => {
    // Apple wants the provider token refreshed at most every 20–60 minutes.
    if (!cached || now() - cached.at > 50 * 60 * 1000) {
      cached = { jwt: await signJwt('ES256', cfg.keyP8, { kid: cfg.keyId }, { iss: cfg.teamId, iat: Math.floor(now() / 1000) }), at: now() }
    }
    const res = await f(`${host}/3/device/${token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${cached.jwt}`,
        'apns-topic': cfg.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default', badge: m.badge }, link: m.link, type: m.type }),
    })
    if (res.ok) return { ok: true }
    const reason = (await res.json().catch(() => ({})))?.reason || `http ${res.status}`
    const dead = res.status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)
    return { ok: false, dead, error: reason }
  }
}

// ── FCM (Android) ───────────────────────────────────────────────────────────

export type ServiceAccount = { project_id: string; client_email: string; private_key: string }

export function fcmSender(sa: ServiceAccount, f: typeof fetch = fetch, now = () => Date.now()): Sender {
  let cached: { token: string; until: number } | null = null
  async function accessToken() {
    if (cached && now() < cached.until) return cached.token
    const iat = Math.floor(now() / 1000)
    const assertion = await signJwt('RS256', sa.private_key, {}, {
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
    })
    const res = await f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) throw new Error(`google token ${res.status}`)
    cached = { token: data.access_token, until: now() + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000 }
    return cached.token
  }
  return async (token, m) => {
    const res = await f(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: m.title, body: m.body },
          data: { link: m.link, type: m.type },
          android: { priority: 'HIGH', notification: { sound: 'default', notification_count: m.badge } },
        },
      }),
    })
    if (res.ok) return { ok: true }
    const err = (await res.json().catch(() => ({})))?.error || {}
    const code = err.details?.find?.((x: any) => x.errorCode)?.errorCode || err.status || `http ${res.status}`
    const dead = res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && /registration token/i.test(err.message || ''))
    return { ok: false, dead, error: code }
  }
}
