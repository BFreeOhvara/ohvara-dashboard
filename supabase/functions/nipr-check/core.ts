// P881 — nipr-check: the agent's NPN against NIPR (N-H-07..10), and the daily re-check (N-A-06).
//
//   POST { action: 'check', npn }                 signed-in agent: look up their NPN, apply it, return their licence
//   POST { action: 'check', npn, profile_id }     admin: re-run it for an agent
//   POST { action: 'view' }                       the agent's licence (same shape as my_licence())
//   POST { action: 'daily' } + x-ohvara-cron      pg_cron, 6 AM Central: re-check every checked agent
//
// The judging is here; the writes are one SQL call, licence_apply_check() (P881 migration), which keeps only
// active life states, drops lapsed ones with both sides notified, opens admin reviews and updates ad targeting.
import type { Lookup, Registry, RegLicence } from './registry.ts'

export type Status = 'verified' | 'no_life' | 'not_found' | 'registry_down' | 'mismatch'
export type Judged = { status: Status; name: string | null; licences: RegLicence[]; reason?: string }

export interface Store {
  userFromJwt(jwt: string): Promise<string | null>
  caller(id: string): Promise<{ role: string | null; is_active: boolean | null; full_name: string | null } | null>
  cronOk(secret: string): Promise<boolean>
  apply(agentId: string, npn: string, j: Judged, daily: boolean): Promise<Record<string, unknown>>
  view(agentId: string): Promise<Record<string, unknown> | null>
  // Agents to re-check daily: an NPN that was verified or found without a life line.
  dailyAgents(): Promise<{ id: string; npn: string; full_name: string | null }[]>
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ohvara-cron',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const NPN = /^\d{6,10}$/

// What the agent reads. Plain words; never "NIPR" jargon beyond "the national licence registry".
export const MESSAGES: Record<Status | 'duplicate', string> = {
  verified: 'We found your licence. Pick the states you want leads in; only verified states can be picked.',
  no_life: 'We found your NPN, but no active life licence. You need one to get leads. Your account stays open; add the licence and check again.',
  not_found: 'We couldn\'t find that NPN on the national licence registry. Check the number, or send us your licence to check by hand.',
  registry_down: 'The national licence registry isn\'t answering right now. Try again in a few minutes, or send us your licence to check by hand. You can finish the other setup steps; leads start once it\'s verified.',
  mismatch: 'The name on that licence doesn\'t match your account, so an admin will check it by hand. You can finish the other setup steps; leads start once it\'s verified.',
  duplicate: 'That NPN is already on another Ohvara account, so an admin will check it by hand. You can finish the other setup steps; leads start once it\'s verified.',
}

const norm = (s: string | null | undefined) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, '').trim()
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])
const parts = (s: string | null | undefined) => norm(s).split(/\s+/).filter(p => p && !SUFFIX.has(p))

// Same person: the account's last name is the registry's last name, and the first names start with the same
// letter (Jim / James is fine; a different person isn't). Anything else goes to an admin, never a dead end.
export function sameName(account: string | null, reg: { first: string | null; last: string | null; name: string | null }): boolean {
  const a = parts(account)
  if (a.length < 2) return false
  const last = parts(reg.last).join(' ') || parts(reg.name).slice(-1).join(' ')
  const first = parts(reg.first)[0] || parts(reg.name)[0] || ''
  const aLast = a.slice(1).join(' ')
  const lastOk = !!last && (aLast === last || a[a.length - 1] === last.split(' ').slice(-1)[0] || aLast.replace(/ /g, '') === last.replace(/ /g, ''))
  return lastOk && !!first && a[0][0] === first[0]
}

export function todayCentral(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(now))
}

// A state counts when the licence is active, carries an active life line and hasn't expired.
export const goodLicence = (l: RegLicence, today: string) => l.active && l.life && (!l.expires_on || l.expires_on >= today)

export function judge(lookup: Lookup, accountName: string | null, daily: boolean, today = todayCentral()): Judged {
  if (lookup.kind === 'down') return { status: 'registry_down', name: null, licences: [], reason: lookup.reason }
  if (lookup.kind === 'not_found') return { status: 'not_found', name: null, licences: [] }
  const e = lookup.entity
  // The daily re-check skips the name: it was settled when the agent was verified.
  if (!daily && !sameName(accountName, e)) return { status: 'mismatch', name: e.name, licences: e.licences }
  const status: Status = e.licences.some(l => goodLicence(l, today)) ? 'verified' : 'no_life'
  return { status, name: e.name, licences: e.licences }
}

class Refused extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
const refuse = (m: string, s: number): never => { throw new Refused(m, s) }

export async function checkOne(store: Store, registry: Registry, agentId: string, npn: string, accountName: string | null) {
  const j = judge(await registry.lookup(npn), accountName, false)
  const view = await store.apply(agentId, npn, j, false)
  const status = (view?.status as string) || j.status
  return {
    ok: true, status, registry: registry.configured ? 'connected' : 'not_connected',
    message: MESSAGES[status as Status] ?? MESSAGES[j.status], licence: view,
  }
}

export async function daily(store: Store, registry: Registry) {
  if (!registry.configured) return { ok: true, skipped: 'no_registry', checked: 0 }
  let checked = 0, down = 0, failed = 0
  for (const a of await store.dailyAgents()) {
    try {
      const j = judge(await registry.lookup(a.npn), a.full_name, true)
      if (j.status === 'registry_down') { down++; continue }   // an outage never drops a state
      await store.apply(a.id, a.npn, j, true)
      checked++
    } catch { failed++ }
  }
  return { ok: true, checked, down, failed }
}

export async function handle(req: Request, store: Store, registry: Registry): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const body = await req.json().catch(() => ({}))
    const cron = req.headers.get('x-ohvara-cron')
    if (cron != null) {
      if (!(await store.cronOk(cron))) refuse('Not allowed', 401)
      if (body?.action !== 'daily') refuse('Unknown action', 400)
      return json(await daily(store, registry))
    }
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const userId = jwt ? await store.userFromJwt(jwt) : null
    if (!userId) refuse('Sign in first', 401)
    const me = await store.caller(userId!)
    if (!me || me.is_active === false) refuse('Not allowed', 403)
    const admin = me!.role === 'admin'
    if (!admin && me!.role !== 'agent') refuse('Agents only', 403)
    const target = admin && typeof body?.profile_id === 'string' ? body.profile_id : userId!

    if (body?.action === 'view') return json({ ok: true, licence: await store.view(target) })
    if (body?.action !== 'check') refuse('Unknown action', 400)
    const npn = String(body?.npn ?? '').replace(/\D/g, '')
    if (!NPN.test(npn)) return json({ ok: false, status: 'invalid', message: 'An NPN is 6 to 10 digits. You\'ll find it on your state licence or at nipr.com.' }, 400)
    const who = target === userId ? me : await store.caller(target)
    if (!who) refuse('Agent not found', 404)
    return json(await checkOne(store, registry, target, npn, who!.full_name))
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message }, e.status)
    return json({ error: 'Something went wrong. Try again.' }, 500)
  }
}
