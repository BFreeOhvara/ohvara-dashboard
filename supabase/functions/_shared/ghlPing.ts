// P939 — the Connect page's "Test connection": one harmless read from GoHighLevel
// (list one contact in the location; no write, nothing sent to anyone), answered
// in plain words. The key is used in one header and never returned or logged.
// fetch is passed in so tests never reach GoHighLevel. No Deno APIs.
export const GHL_BASE = 'https://services.leadconnectorhq.com'
export const GHL_VERSION = '2021-07-28'

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export type PingResult = { ok: boolean; message: string }

export function pingUrl(locationId: string) {
  return `${GHL_BASE}/contacts/?${new URLSearchParams({ locationId, limit: '1' })}`
}

export function pingMessage(status: number): PingResult {
  if (status >= 200 && status < 300) return { ok: true, message: 'OK. GoHighLevel accepted the key and found the location.' }
  if (status === 401) return { ok: false, message: 'GoHighLevel rejected the key. Check it was copied whole, and that it was not revoked.' }
  if (status === 403) return { ok: false, message: 'GoHighLevel knows the key but it is not allowed into this location. Check the location ID, and that the key has contacts access.' }
  if (status === 404 || status === 422) return { ok: false, message: 'GoHighLevel did not recognise the location ID. Check it on the Connect page.' }
  if (status === 429) return { ok: false, message: 'GoHighLevel asked us to slow down. Try again in a minute.' }
  if (status >= 500) return { ok: false, message: 'GoHighLevel had a problem on its side. Try again in a minute.' }
  return { ok: false, message: `GoHighLevel answered with an error (${status}).` }
}

export async function ghlPing(fetchFn: Fetch, apiKey: string, locationId: string): Promise<PingResult> {
  try {
    const res = await fetchFn(pingUrl(locationId), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_VERSION, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    await res.text().catch(() => '')
    return pingMessage(res.status)
  } catch {
    return { ok: false, message: 'Could not reach GoHighLevel. Try again in a minute.' }
  }
}
