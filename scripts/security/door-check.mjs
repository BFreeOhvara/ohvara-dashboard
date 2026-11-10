// P922 door check: what can a stranger reach over the internet with only the
// public key? Rerun after every big change:   node scripts/security/door-check.mjs
//
// Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (the publishable key every
// browser has) from .env.local / the environment. Sends only requests that a
// correctly locked door refuses before doing anything: no sign-in, no real
// secret, empty or junk bodies. Nothing is created, sent or charged when the
// doors are locked. Prints one line per door and exits 1 if any door is open.
//
//   1. Tables: every table in supabase/migrations, read with the public key.
//      Locked = 401/403 (no grant) or 404 (not exposed). OPEN = 200 with rows.
//   2. Functions (RPC): every public function in supabase/migrations, called
//      signed out. Locked = 401/403/404. OPEN = anything that ran.
//   3. Storage: list every bucket signed out. Private buckets must list nothing.
//   4. Edge functions: each one with no auth, the public key only, and wrong
//      secrets / signatures (cron header, Twilio, Stripe, GoHighLevel).
//      Locked = 4xx. A public-by-design link function (invite, reschedule,
//      sign, sign-in, sign-up) must answer a junk token without data.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
function env(name) {
  if (process.env[name]) return process.env[name]
  for (const f of ['.env.local', '../ohvara-dashboard/.env.local']) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    const m = readFileSync(p, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}
const URL_ = env('VITE_SUPABASE_URL')
const KEY = env('VITE_SUPABASE_ANON_KEY')
if (!URL_ || !KEY) { console.error('Need VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'); process.exit(2) }
if (!KEY.startsWith('sb_publishable_') && !/"role":"anon"/.test(Buffer.from(KEY.split('.')[1] ?? '', 'base64url').toString())) {
  console.error('Refusing: VITE_SUPABASE_ANON_KEY is not a publishable/anon key'); process.exit(2)
}

const open = []
const line = (ok, kind, name, detail) => {
  if (!ok) open.push(`${kind} ${name}`)
  console.log(`${ok ? 'locked' : 'OPEN  '}  ${kind.padEnd(8)} ${name.padEnd(34)} ${detail}`)
}
async function hit(path, init = {}) {
  try {
    const r = await fetch(URL_ + path, { ...init, signal: AbortSignal.timeout(20000) })
    const text = await r.text()
    return { status: r.status, text }
  } catch (e) { return { status: 0, text: String(e?.message ?? e) } }
}
const pub = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// Names from the migrations (latest wins; dropped ones are skipped).
const migDir = join(root, 'supabase', 'migrations')
const sql = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(join(migDir, f), 'utf8').replace(/--[^\n]*/g, '')).join('\n')
const tables = new Set(), funcs = new Set()
for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) tables.add(m[1].toLowerCase())
for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) tables.delete(m[1].toLowerCase())
for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi)) funcs.add(m[1].toLowerCase())

// 1. Tables
console.log(`\n# Tables (${tables.size}), signed out`)
for (const t of [...tables].sort()) {
  const r = await hit(`/rest/v1/${t}?select=*&limit=1`, { headers: pub })
  const rows = r.status === 200 ? (() => { try { return JSON.parse(r.text).length } catch { return -1 } })() : 0
  const ok = r.status !== 200 || rows === 0
  // 200 with [] still means the door is unlocked (RLS hides rows today); report it once P922's revoke is live.
  line(ok && r.status !== 200, 'table', t, r.status === 200 ? `200, ${rows} row(s) visible${rows === 0 ? ' (grant still open, RLS hides rows)' : ''}` : `${r.status}`)
}

// 2. Functions
console.log(`\n# Functions (${funcs.size}), signed out`)
for (const f of [...funcs].sort()) {
  const r = await hit(`/rest/v1/rpc/${f}`, { method: 'POST', headers: { ...pub, 'Content-Type': 'application/json' }, body: '{}' })
  // 401/403 = no execute grant. 404 PGRST202 = not callable with no args (or gone); check the code below.
  let code = ''
  try { code = JSON.parse(r.text).code ?? '' } catch { /* not json */ }
  const ok = r.status === 401 || r.status === 403 || (r.status === 404) || code === '42501'
  line(ok, 'rpc', f, `${r.status} ${code}`)
}

// 3. Storage
console.log('\n# Storage buckets, signed out')
for (const b of ['avatars', 'training', 'bug-screenshots', 'licence-docs', 'policy-docs']) {
  const r = await hit(`/storage/v1/object/list/${b}`, { method: 'POST', headers: { ...pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 5 }) })
  let n = 0; try { n = JSON.parse(r.text).length ?? 0 } catch { n = 0 }
  const isPublic = b === 'avatars' || b === 'training'
  line(isPublic || n === 0, 'storage', b, `${r.status}, ${n} listed${isPublic ? ' (public bucket by design)' : ''}`)
  const up = await hit(`/storage/v1/object/${b}/p922-door-check.txt`, { method: 'POST', headers: { ...pub, 'Content-Type': 'text/plain' }, body: 'p922' })
  line(up.status >= 400, 'upload', b, `${up.status}`)
}

// 4. Edge functions
const fnDir = join(root, 'supabase', 'functions')
const slugs = readdirSync(fnDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name).sort()
// Public by design: a junk token must get a refusal without data (4xx, or 200 with an error/empty answer).
const publicLinks = new Set(['claim-invite', 'recovery-reschedule', 'doc-sign', 'username-sign-in', 'self-signup', 'account-email'])
const variants = [
  ['no auth', {}],
  ['public key', pub],
  ['wrong cron', { ...pub, 'x-ohvara-cron': 'p922-wrong', 'x-ohvara-secret': 'p922-wrong', 'x-cron-secret': 'p922-wrong' }],
  ['bad Twilio sig', { ...pub, 'X-Twilio-Signature': 'cDkyMndyb25n', 'Content-Type': 'application/x-www-form-urlencoded' }],
  ['bad Stripe sig', { ...pub, 'stripe-signature': 't=1,v1=p922wrong' }],
  ['wrong GHL secret', { ...pub, 'x-ghl-secret': 'p922-wrong', 'x-ghl-signature': 'p922-wrong', 'x-webhook-secret': 'p922-wrong' }],
]
console.log(`\n# Edge functions (${slugs.length})`)
for (const s of slugs) {
  for (const [label, headers] of variants) {
    const isForm = headers['Content-Type'] === 'application/x-www-form-urlencoded'
    const body = isForm ? 'p922=1' : JSON.stringify(publicLinks.has(s) ? { token: 'p922-junk', t: 'p922-junk', action: 'check' } : {})
    const r = await hit(`/functions/v1/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
    let ok = r.status >= 400 || r.status === 0
    if (!ok && publicLinks.has(s)) ok = !/client|phone|email|policy_id|agent_id|first_name/i.test(r.text) || /error|invalid|expired|not found/i.test(r.text)
    line(ok, 'edge', `${s} [${label}]`, `${r.status} ${r.text.replace(/\s+/g, ' ').slice(0, 70)}`)
    if (r.status === 404 && label === 'no auth') break // not deployed or retired: one line is enough
  }
}

console.log(`\n${open.length ? `${open.length} OPEN door(s):\n  ${open.join('\n  ')}` : 'Every door locked.'}`)
process.exit(open.length ? 1 : 0)
