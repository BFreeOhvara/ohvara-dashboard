// Twilio pieces shared by the fulfillment phone functions (fulfillment-voice,
// fulfillment-cancel-check). No Deno APIs, so node --test can load it.

function b64(bytes: ArrayBuffer) {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin)
}

// Twilio's request signature: HMAC-SHA1 (auth token) over the full URL, then
// every POST param name + value, sorted by name; base64.
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  return b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

export function sameString(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Reads a Twilio webhook: the form params, and whether the signature matches
// `publicUrl` + the request's query string.
export async function readTwilioRequest(req: Request, authToken: string, publicUrl: string) {
  const search = new URL(req.url).search
  const form: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(await req.text())) form[k] = v
  const expected = await twilioSignature(authToken, publicUrl + search, form)
  return { form, query: new URLSearchParams(search), ok: sameString(req.headers.get('X-Twilio-Signature') || '', expected) }
}

export const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Params = Record<string, string | string[]>
export type Twilio = (method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params) => Promise<{ status: number; data: any }>

// The REST client (paths under /2010-04-01/Accounts/{sid}).
export function twilioClient(sid: string, token: string, fetchImpl: typeof fetch = fetch): Twilio {
  return async (method, path, params) => {
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(params ?? {})) for (const one of [v].flat()) body.append(k, one)
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : null),
      },
      body: method === 'POST' ? body : undefined,
    })
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
    return { status: res.status, data }
  }
}
