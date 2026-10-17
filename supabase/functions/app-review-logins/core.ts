// Prompt 775 — the App Review test logins: one sample agent, one sample
// Fulfillment rep, both marked demo (profiles.is_demo) so the database keeps
// everything they do away from real people, calls, texts, emails and money
// (migration 156). Admins only. "reset" makes the two accounts if they don't
// exist (or were deleted), sets new random passwords, and re-creates their
// sample data (demo_seed). The passwords are shown to the admin once, to
// paste into App Store Connect / Google Play; they're never stored or logged.

export const DEMO = {
  agent: { email: 'app-review-agent@ohvara.com', role: 'agent', name: 'Avery Demo (App Review)' },
  fulfillment: { email: 'app-review-fulfillment@ohvara.com', role: 'fulfillment', name: 'Riley Demo (App Review)' },
} as const
type Kind = keyof typeof DEMO

export interface Deps {
  caller(jwt: string): Promise<{ id: string; role: string | null; is_active: boolean | null; is_demo: boolean | null } | null>
  findByEmail(email: string): Promise<string | null>          // a live (not deleted) profile id
  createUser(email: string, password: string, role: string, name: string): Promise<string>
  setPassword(id: string, password: string): Promise<void>
  seed(agentId: string, repId: string): Promise<unknown>
  password(): string
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// 20 characters, letters and digits, no look-alikes (0/O, 1/l/I).
export function makePassword(rand: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const out: string[] = []
  while (out.length < 20) for (const b of rand(32)) if (b < 256 - (256 % abc.length) && out.length < 20) out.push(abc[b % abc.length])
  return out.join('')
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const me = jwt ? await deps.caller(jwt) : null
  if (!me) return json({ error: 'Not signed in' }, 401)
  if (me.role !== 'admin' || me.is_active === false || me.is_demo) return json({ error: 'Admins only' }, 403)

  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = body?.action || 'status'

  if (action === 'status') {
    const [a, f] = await Promise.all([deps.findByEmail(DEMO.agent.email), deps.findByEmail(DEMO.fulfillment.email)])
    return json({ agent: { email: DEMO.agent.email, exists: !!a }, fulfillment: { email: DEMO.fulfillment.email, exists: !!f } })
  }
  if (action !== 'reset') return json({ error: 'Unknown action' }, 400)

  const out: Record<string, { email: string; password: string }> = {}
  const ids: Partial<Record<Kind, string>> = {}
  try {
    for (const kind of ['agent', 'fulfillment'] as Kind[]) {
      const d = DEMO[kind]
      const password = deps.password()
      let id = await deps.findByEmail(d.email)
      if (id) await deps.setPassword(id, password)
      else id = await deps.createUser(d.email, password, d.role, d.name)
      ids[kind] = id
      out[kind] = { email: d.email, password }
    }
    await deps.seed(ids.agent!, ids.fulfillment!)
  } catch (e) {
    console.error('[app-review-logins] reset failed:', (e as Error).message)
    return json({ error: 'Couldn’t set up the App Review logins. Try again.' }, 500)
  }
  return json({ ok: true, ...out })
}
