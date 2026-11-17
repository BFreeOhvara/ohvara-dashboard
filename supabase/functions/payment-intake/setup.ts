// payment-intake setup — P1027. One-time Resend set-up done server-side, so no key or signing secret is ever copied
// by hand: POST ?setup=resend adds notices.ohvara.com to Resend (receiving only) if missing, creates the email.received
// webhook pointing here, and keeps its signing secret in Vault. It runs only while no secret is saved (one-shot);
// afterwards it answers 409. POST ?setup=verify asks Resend to re-check the DNS. GET ?setup=status shows the domain's DNS records and status (public DNS facts only).
// The secret is never returned. Tests: setup.test.ts.

export type ResendApi = (method: string, path: string, body?: unknown) => Promise<{ ok: boolean; status: number; json: Record<string, unknown> }>
export type SecretStore = { get(): Promise<string | null>; set(s: string): Promise<boolean> }

const DOMAIN = 'notices.ohvara.com'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const list = (j: Record<string, unknown>) => (Array.isArray(j.data) ? (j.data as Record<string, unknown>[]) : [])
const records = (d: Record<string, unknown>) => (Array.isArray(d.records) ? (d.records as Record<string, unknown>[]) : [])
  .map(r => ({ record: r.record, type: r.type, name: r.name, value: r.value, priority: r.priority, status: r.status }))

async function domain(api: ResendApi, create: boolean) {
  const l = await api('GET', '/domains')
  if (!l.ok) throw new Error(`Resend domains: ${l.status}`)
  let d = list(l.json).find(x => x.name === DOMAIN)
  if (!d && create) {
    const c = await api('POST', '/domains', { name: DOMAIN, capabilities: { sending: 'disabled', receiving: 'enabled' } })
    if (!c.ok) throw new Error(`Resend add domain: ${c.status} ${String(c.json.message ?? '')}`.trim())
    d = c.json
  }
  if (!d) return null
  const g = await api('GET', `/domains/${d.id}`)
  return g.ok ? g.json : d
}

export async function setup(req: Request, api: ResendApi, secrets: SecretStore, endpoint: string): Promise<Response> {
  const mode = new URL(req.url).searchParams.get('setup')
  try {
    if (mode === 'status' && req.method === 'GET') {
      const d = await domain(api, false)
      // How many emails Resend has received lately and when the last came in (no addresses or content).
      const rx = await api('GET', '/emails/receiving?limit=20')
      const got = list(rx.json)
      const received = rx.ok ? { count: got.length, latest_at: got.map(x => String(x.created_at ?? '')).sort().pop() ?? null } : null
      return json(200, { domain: DOMAIN, found: !!d, status: d?.status ?? null, records: d ? records(d) : [], webhook_secret_saved: !!(await secrets.get()), received })
    }
    if (mode === 'verify' && req.method === 'POST') {
      // After the DNS records are added: ask Resend to check them now (safe to repeat).
      const d = await domain(api, false)
      if (!d) return json(404, { error: 'Run POST ?setup=resend first' })
      const v = await api('POST', `/domains/${d.id}/verify`)
      const g = await domain(api, false)
      return json(v.ok ? 200 : 502, { domain: DOMAIN, status: g?.status ?? null, records: g ? records(g) : [] })
    }
    if (mode !== 'resend' || req.method !== 'POST') return json(400, { error: 'Use POST ?setup=resend, POST ?setup=verify or GET ?setup=status' })
    if (await secrets.get()) return json(409, { error: 'Already set up' })
    const d = await domain(api, true)
    // A webhook for this endpoint without a saved secret can't be used (Resend shows the secret once): replace it.
    const w = await api('GET', '/webhooks')
    for (const x of list(w.json)) if (x.endpoint === endpoint) await api('DELETE', `/webhooks/${x.id}`)
    const c = await api('POST', '/webhooks', { endpoint, events: ['email.received'] })
    const s = typeof c.json.signing_secret === 'string' ? c.json.signing_secret : ''
    if (!c.ok || !s) throw new Error(`Resend webhook: ${c.status} ${String(c.json.message ?? '')}`.trim())
    await secrets.set(s)
    return json(200, { domain: DOMAIN, status: d?.status ?? null, records: d ? records(d) : [], webhook: 'created' })
  } catch (e) {
    return json(502, { error: (e as Error).message })
  }
}
