// Old and new agent portal, side by side, with every Supabase call mocked: no real project, account or credentials
// are touched and nothing is written. Every number, name and event on these pages is a fixture, so the shots are
// labelled mocked (checks.json: mocked true).
//   node scripts/agent-portal-finish-shots.mjs [outDir] [oldRoot]
// Writes into outDir (default qa/agent-portal-finish). pipeline = /agent/clients?stage=cancelled, the Clients side of My Pipeline:
//   old/{overview|pipeline|billing|activity}-{1440|390}-{light|dark}.png   16 shots, the app at commit 2b8337a
//   new/<the same 16 names>.png + billing-available-soon-{light,dark}.png  this checkout (fresh master)
//   empty/activity-empty-1440-light.png, empty/activity-empty-390-dark.png an agent with policy events and no inbounds
//   checks.json (commits, old-render method, old-side checks, scroll widths, empty-agent DOM checks)
// OLD = commit 2b8337a, the master-side parent of merge 3db9106. It is read out of git (ls-tree + cat-file, the same
// files `git archive` gives) into oldRoot (default .tmp-finish/old-2b8337a, uncommitted) and served by its own Vite.
// OLD RENDER: the test agent is on that commit's preview list, so a plain run would show the new pages. Before the
// page loads an init script sets localStorage ov_portal_preview = 'v1', and the app_settings mock returns its row
// with the flag column absent, which that commit reads as off. The URL switch is not used.
// If any old-side check fails the run stops: a comparison against a page that is not old proves nothing.
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { zonedTimeToUtcIso } from '../src/lib/timezones.js'
import { TEST_ACCOUNT_IDS } from '../src/lib/testAccounts.js'

const OLD_COMMIT = '2b8337a'
const OUT = resolve(process.argv[2] || 'qa/agent-portal-finish')
const OLD_ROOT = resolve(process.argv[3] || '.tmp-finish/old-2b8337a')
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT_NEW = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 300)
const PORT_OLD = PORT_NEW + 400
for (const d of ['old', 'new', 'empty']) mkdirSync(join(OUT, d), { recursive: true })

const git = (...args) => execFileSync('git', args, { maxBuffer: 1 << 28 })
const gitText = (...args) => git(...args).toString('utf8').trim()

// ── The old app: files of commit 2b8337a, plain Vite config (the real one asks git for a build id) ──────────
const KEEP = /^(src\/|public\/|index\.html$|postcss\.config\.js$|tailwind\.config\.js$)/
function extractOld(dir) {
  const full = gitText('rev-parse', `${OLD_COMMIT}^{commit}`)
  const marker = join(dir, '.archived-from')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === full) return full
  rmSync(dir, { recursive: true, force: true })
  const lines = git('ls-tree', '-r', '-z', '--full-tree', full).toString('utf8').split('\0').filter(Boolean)
  for (const line of lines) {
    const [meta, path] = line.split('\t')
    const [mode, type, sha] = meta.split(' ')
    if (type !== 'blob' || mode === '120000' || !KEEP.test(path)) continue
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), git('cat-file', 'blob', sha))
  }
  writeFileSync(join(dir, 'vite.config.js'),
    "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()], define: { __APP_BUILD__: JSON.stringify('old-2b8337a') } })\n")
  writeFileSync(marker, `${full}\n`)
  return full
}
const OLD_HASH = extractOld(OLD_ROOT)
const NEW_HASH = gitText('rev-parse', 'origin/master')
const HEAD_HASH = gitText('rev-parse', 'HEAD')
// The new side is this checkout; its app code must be master's (only tests and scripts differ).
const appDiff = gitText('diff', '--name-only', 'origin/master', '--', 'src', 'index.html', 'public', 'package.json')
  .split('\n').filter(f => f && !/\.test\.js$/.test(f))

// ── Seed data: the test agent, one day (today in Chicago, 4:20 PM) ───────────────────────────────────────────
const TZ = 'America/Chicago'
const [AGENT] = TEST_ACCOUNT_IDS
const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const NOW = new Date(zonedTimeToUtcIso(`${today}T16:20`, TZ))
const at = (d, hm) => {
  const day = new Date(NOW.getTime() + d * 864e5).toLocaleDateString('en-CA', { timeZone: TZ })
  return zonedTimeToUtcIso(`${day}T${hm}`, TZ)
}
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: TZ,
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard', membership_tier: 'servicing_appointments',
  billing_current_period_end: at(5, '12:00'),
}
const APPT = 'booked_appointment'
const LIVE = 'live_call'
const id = n => `b${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`
const L = (n, name, product, stage, o = {}) => ({
  lead_id: id(n), lead_type: product === LIVE ? 'policy_help' : 'mortgage_protection',
  inbound_product: product, inbound_stage: stage, outcome: null, outcome_at: null, live_call_result: null, contact_name: name,
  phone: `+155501001${String(n).padStart(2, '0')}`, city: null, state: 'FL', lead_source: null, qualifier_answers: {},
  transfer_status: null, transferred_at: null, va_outcome: null, booking_id: null, client_policy_id: null,
  delivered_at: at(0, '09:00'), created_at: at(0, '09:00'), ...o,
})
const INBOUNDS = [
  L(1, 'Avery Sample', APPT, 'new', { delivered_at: at(0, '15:58'), created_at: at(0, '15:58') }),
  L(2, 'Rowan Example', APPT, 'new', { delivered_at: at(0, '16:11'), created_at: at(0, '16:11') }),
  L(3, 'Jamie Sample', APPT, 'contacting', { delivered_at: at(0, '08:05'), created_at: at(0, '08:05') }),
  L(6, 'Riley Example', APPT, 'booked', { delivered_at: at(-1, '12:00'), created_at: at(-1, '12:00') }),
  L(7, 'Dana Sample', APPT, 'booked', { phone: '+15550100142', delivered_at: at(-2, '19:12'), created_at: at(-2, '19:12') }),
  L(10, 'Morgan Placeholder', APPT, 'met', { delivered_at: at(-3, '09:00'), created_at: at(-3, '09:00') }),
  L(21, 'Quinn Example', LIVE, 'met', { live_call_result: 'transferred', transfer_status: 'connected', transferred_at: at(0, '14:31'), delivered_at: at(0, '14:27'), created_at: at(0, '14:27') }),
  L(22, 'Casey Example', LIVE, 'booked', { live_call_result: 'booked', va_outcome: 'booked', delivered_at: at(0, '13:05'), created_at: at(0, '13:05') }),
]
let evN = 0
const ev = (lead, kind, state, when, label, detail = {}) => ({
  id: `e${String(++evN).padStart(7, '0')}-0000-4000-8000-000000000000`, lead_id: id(lead), kind, state, at: when, label, detail,
  actor_name: null, actor_role: null, created_at: when,
})
// Today's finished steps: one of each kind (came_in, text_sent, text_received, va_call, booked, transferred, outcome).
const EVENTS = [
  ev(21, 'came_in', 'done', at(0, '14:27'), null),
  ev(21, 'va_call', 'done', at(0, '14:29'), null, { summary: 'Reached, wants to talk now' }),
  ev(21, 'transferred', 'done', at(0, '14:31'), null),
  ev(22, 'came_in', 'done', at(0, '13:05'), null),
  ev(22, 'text_sent', 'done', at(0, '13:06'), null),
  ev(22, 'booked', 'done', at(0, '13:12'), 'Booked with you', { appointment_at: at(0, '18:30') }),
  ev(22, 'text_received', 'done', at(0, '13:20'), null, { text: 'Thursday works for me' }),
  ev(10, 'outcome', 'done', at(0, '12:05'), null, { summary: 'Follow up' }),
  ev(7, 'booked', 'done', at(-1, '10:08'), 'Booked with you', { appointment_at: at(1, '10:00') }),
  ev(6, 'booked', 'done', at(-1, '12:30'), 'Booked with you', { appointment_at: at(0, '16:45') }),
  ev(6, 'reminder', 'done', at(0, '15:45'), 'Reminder text sent'),
  ev(3, 'va_call', 'scheduled', at(1, '10:00'), 'VA tries again'),
]
const INBOUND_NAMES = ['Quinn Example', 'Casey Example', 'Morgan Placeholder']
const REPLIES = [
  { id: 'r1', lead_id: id(7), body: 'Sounds good, see you then', received_at: at(0, '11:31'), handled_at: null },
  { id: 'r2', lead_id: id(3), body: 'Can you call me after 5?', received_at: at(0, '09:14'), handled_at: null },
]
// Prices are null on purpose: Brayden has not set them, so the page reads "Price set by Ohvara".
const MT = (key, name, product_keys, sort_order, monthly_appointments = null) =>
  ({ key, name, product_keys, price_cents: null, monthly_appointments, description: null, sort_order, is_active: true })
const MEMBERSHIPS = [
  MT('cancellations', 'Cancellations', ['cancellations'], 10),
  MT('servicing', 'Servicing', ['servicing'], 20),
  MT('servicing_appointments', 'Servicing + Appointments', ['servicing', 'booked_appointments'], 30, 12),
  MT('servicing_live', 'Servicing + Live Calls', ['servicing', 'booked_appointments', 'live_calls'], 40, 12),
]
const P = (n, first, last, o = {}) => ({
  id: `c${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`, agent_id: AGENT, client_first_name: first, client_last_name: last,
  client_phone: `+155502001${String(n).padStart(2, '0')}`, state: 'TX', client_city: 'Austin', client_timezone: TZ, carrier_id: null, carrier_name: 'Sample Life',
  scheduled_call_at: null, fulfillment_stage: 'Pending', assigned_fulfillment_id: null, fulfillment_claimed_at: null, fulfillment_started_at: null,
  fulfillment_completed_at: null, cancellation_substatus: null, cancellation_confirmation: null, call_live_since: null, last_call_outcome: null,
  call_attempts: 0, last_call_at: null, recovery_step: null, recovery_retry_at: null, recovery_am_sent_at: null, recovery_pm_sent_at: null,
  missed_step: null, missed_retry_at: null, sms_consent: true, created_at: at(0, '09:00'), updated_at: at(0, '09:00'),
  agent: { id: AGENT, full_name: 'Test Agent' }, assigned: null, details: { current_carrier: 'Sample Life' }, ...o,
})
const POLICIES = [
  P(1, 'Alex', 'Sample', { scheduled_call_at: at(1, '11:00'), created_at: at(-2, '10:00') }),
  P(2, 'Blake', 'Example', { scheduled_call_at: at(2, '14:30'), created_at: at(-1, '15:00') }),
  P(3, 'Charlie', 'Placeholder', { scheduled_call_at: at(-1, '10:00'), created_at: at(-3, '09:00'), last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: at(-1, '10:30'), recovery_step: 'number_check' }),
  P(4, 'Devon', 'Sample', { scheduled_call_at: at(-6, '13:00'), created_at: at(-8, '09:00'), fulfillment_stage: 'Complete', fulfillment_completed_at: at(-6, '13:40') }),
  P(5, 'Ellis', 'Example', { scheduled_call_at: at(-5, '09:30'), created_at: at(-7, '12:00') }),
  P(6, 'Finley', 'Placeholder', { scheduled_call_at: at(-4, '15:00'), created_at: at(-6, '16:00'), fulfillment_stage: 'Complete', fulfillment_completed_at: at(-1, '15:30') }),
]
// policy_events as the page selects them (policy and agent embedded). Today: a booking, a moved call, a no-show.
let peN = 0
const PE = (n, kind, when, o = {}) => {
  const p = POLICIES[n - 1]
  return {
    id: `d${String(++peN).padStart(7, '0')}-0000-4000-8000-000000000000`, policy_id: p.id, agent_id: AGENT, kind, from_status: null,
    actor_name: null, actor_role: null, detail: {}, at: when,
    policy: { client_first_name: p.client_first_name, client_last_name: p.client_last_name, state: 'TX', client_city: 'Austin', client_timezone: TZ },
    agent: { full_name: 'Test Agent' }, ...o,
  }
}
const POLICY_EVENTS = [
  PE(1, 'booked', at(0, '10:15'), { detail: { scheduled_call_at: at(1, '11:00') } }),
  PE(2, 'moved', at(0, '09:40'), { detail: { from: at(1, '09:00'), to: at(2, '14:30') } }),
  PE(3, 'no_answer', at(0, '11:40'), { actor_name: 'Sam Rivera', actor_role: 'fulfillment', detail: { attempt: 2 } }),
]
const LEDGER = [
  { id: 'l1', kind: 'lead_charge', amount_cents: -3000, balance_after_cents: 4000, lead_type: 'mortgage_protection', created_at: at(0, '15:50') },
  { id: 'l2', kind: 'lead_charge', amount_cents: -5500, balance_after_cents: 7000, lead_type: 'policy_help', created_at: at(0, '13:00') },
  { id: 'l3', kind: 'topup', amount_cents: 10000, balance_after_cents: 12500, lead_type: null, created_at: at(-1, '16:00') },
]
const PRICES = [{ lead_type: 'mortgage_protection', price_cents: 3000 }, { lead_type: 'policy_help', price_cents: 5500 }]
const OPTIONS = [{ amount_cents: 10000 }, { amount_cents: 25000 }, { amount_cents: 50000 }]
const BILLING_TIERS = [
  { key: 'standard', name: 'Standard', weekly_cents: 35000, weekly_cap: 7, sort_order: 1, is_active: true },
  { key: 'premium', name: 'Premium', weekly_cents: 50000, weekly_cap: 14, sort_order: 2, is_active: true },
]
const USAGE = { used: 3, weekly_cap: 7, enforced: true, tier_name: 'Standard', week_start: at(-2, '12:00'), week_end: at(5, '12:00') }

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// Reads get fixture rows (anything unknown is empty); any write is recorded and fails the run.
// scenario 'full' = the agent above; 'empty' = the same agent with policy events and no inbounds at all.
async function mock(page, state, scenario) {
  const empty = scenario === 'empty'
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host.startsWith('localhost:') || u.host === SB_HOST) return route.continue()
    state.blocked.push(u.host)
    return route.abort()
  })
  await page.route(`${SB}/**`, route => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    const inRange = (list, key = 'at') => {
      const bounds = url.searchParams.getAll(key)
      const lo = bounds.find(b => b.startsWith('gte.'))?.slice(4)
      const hi = bounds.find(b => b.startsWith('lt.'))?.slice(3)
      return list.filter(r => (!lo || new Date(r[key]) >= new Date(lo)) && (!hi || new Date(r[key]) < new Date(hi)))
    }
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path.startsWith('/auth/v1/') || path.startsWith('/functions/v1/')) return json(route, 200, {})
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'agent_inbounds') return json(route, 200, empty ? [] : INBOUNDS)
      // Migration 185 is not applied: the feed function is not there, so Activity falls back to policy_events.
      if (name === 'agent_activity_feed') return json(route, 404, { code: 'PGRST202', message: 'Could not find the function public.agent_activity_feed in the schema cache', details: null, hint: null })
      if (name === 'agent_weekly_usage') return json(route, 200, [USAGE])
      if (name === 'my_push_settings') return json(route, 200, { push_on: false })
      if (name === 'my_money_banner') return json(route, 200, null)
      if (/^(set_|add_|mark_|create_|update_|delete_)/.test(name)) state.writes.push(name)
      return json(route, 200, [])
    }
    const table = path.replace('/rest/v1/', '')
    if (method !== 'GET' && method !== 'HEAD') { state.writes.push(`${method} ${table}`); return json(route, 200, []) }
    switch (table) {
      // The row has no flag column at all: the old commit reads that as off.
      case 'app_settings': return rows([{ id: 1, agent_billing_enforced: false }])
      case 'policies': return json(route, 200, POLICIES)
      case 'policy_events': return json(route, 200, inRange(POLICY_EVENTS))
      case 'inbound_events':
        if (empty) return json(route, 200, [])
        return json(route, 200, url.searchParams.get('state') === 'eq.done' ? inRange(EVENTS.filter(e => e.state === 'done')) : EVENTS)
      case 'lead_sms_replies': return json(route, 200, empty ? [] : REPLIES)
      case 'membership_tiers': return json(route, 200, MEMBERSHIPS)
      case 'agent_duty': return rows([{ on_duty: true, since: at(0, '14:14') }])
      case 'recovery_config': return rows([{ id: 1, sms_live: false, voice_live: false, recording_live: false }])
      case 'agent_lead_balance': return rows([{ balance_cents: 4000 }])
      case 'lead_prices': return rows(PRICES)
      case 'prepaid_topup_options': return rows(OPTIONS)
      case 'agent_lead_ledger': return rows(LEDGER)
      case 'agent_billing_tiers': return rows(BILLING_TIERS)
      default: return rows([])
    }
  })
}

// ── Servers and browser ──────────────────────────────────────────────────────────────────────────────────────
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const vite = (root, port) => createServer({ ...(root ? { root } : null), server: { port, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
const serverOld = await vite(OLD_ROOT, PORT_OLD)
const serverNew = await vite(null, PORT_NEW)
await serverOld.listen()
await serverNew.listen()
const BASE = { old: `http://localhost:${PORT_OLD}`, new: `http://localhost:${PORT_NEW}` }
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
const PAGES = [
  { name: 'overview', path: '/agent' },
  // The "Your clients" box lives on the Clients side of My Pipeline (the default view is In progress), so the shots open that side.
  { name: 'pipeline', path: '/agent/clients?stage=cancelled' },
  { name: 'billing', path: '/agent/billing' },
  { name: 'activity', path: '/agent/activity' },
]
// What the old pages must NOT show and the new ones do (old-side checks: true on old, false on new).
const TODAY_TEXT = ['Live call transfers', 'Today’s appointments', 'New inbounds']
const OLD_CHECKS = {
  overview: 'no Today cards text (Live call transfers, Today’s appointments, New inbounds)',
  pipeline: 'no "Your clients" box',
  billing: 'no "Available soon" on Billing',
  activity: 'no inbound rows (no inbound client names, no Lead update pill, no inbound row)',
}

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && detail !== '' ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function open(side, w, theme, scenario) {
  const ctx = await browser.newContext({
    viewport: SIZES[w], colorScheme: theme, timezoneId: TZ, locale: 'en-US',
    ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null),
  })
  await ctx.addInitScript(([session, th, old]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
    // The old pages: the preview choice is 'v1', set before the app loads.
    if (old) localStorage.setItem('ov_portal_preview', 'v1')
  }, [SESSION, theme, side === 'old'])
  await ctx.clock.setFixedTime(NOW)
  const page = await ctx.newPage()
  const state = { writes: [], errors: [], blocked: [] }
  page.on('pageerror', e => state.errors.push(String(e)))
  await mock(page, state, scenario)
  return { ctx, page, state }
}

async function load(page, side, path) {
  await page.goto(`${BASE[side]}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main, .ph-stack, .ph-tabbar', { timeout: 30000 })
  await page.waitForFunction(() => document.body.innerText.length > 200
    && !document.querySelector('[aria-busy="true"], .tc-skel, .ov-bal-skel, .pl2-skel')
    && !/Loading your calls/.test(document.body.innerText), null, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
}

const measure = (page, names) => page.evaluate(([todayText, inboundNames]) => {
  const text = document.body.innerText
  const de = document.documentElement
  const events = [...document.querySelectorAll('.ov-event')]
  return {
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
    url: location.pathname,
    title: (document.querySelector('h1')?.textContent || '').trim(),
    todayCards: todayText.filter(t => text.includes(t)),
    yourClients: !!document.querySelector('section[aria-label="Your clients"]'),
    availableSoon: [...document.querySelectorAll('button.pl2-soon')].length,
    availableSoonText: text.includes('Available soon'),
    inboundNames: inboundNames.filter(n => text.includes(n)),
    inboundRows: events.filter(e => e.getAttribute('data-kind') === 'inbound').length,
    leadUpdatePills: events.filter(e => e.textContent.includes('Lead update')).length,
    eventRows: events.length,
    eventKinds: events.map(e => e.getAttribute('data-kind')),
    prepaid: { inboundForm: text.includes('Inbound form'), inboundCall: text.includes('Inbound call'), meta: /\bMeta\b/.test(text), google: /\bGoogle\b/.test(text) },
    chips: [...document.querySelectorAll('.ov-filter .fb-chips button')].map(b => b.textContent.trim()),
    boxRows: [...document.querySelectorAll('.ov-actrows .pl-row2')].map(r => ({ label: r.querySelector('.l')?.textContent.trim(), count: r.querySelector('.c')?.textContent.trim(), zero: r.classList.contains('is-zero') })),
    hasError: /something went wrong|couldn.t load|error/i.test(text) ? (text.match(/.{0,40}(something went wrong|couldn.t load|error).{0,40}/i) || [''])[0] : null,
  }
}, [TODAY_TEXT, INBOUND_NAMES])

// "Is this the old page?" for one page: true on old, false on new.
const isOld = (pageName, m) => ({
  overview: m.todayCards.length === 0,
  pipeline: !m.yourClients,
  billing: !m.availableSoonText && m.availableSoon === 0,
  activity: m.inboundNames.length === 0 && m.inboundRows === 0 && m.leadUpdatePills === 0,
}[pageName])

const shots = []
const oldness = { old: {}, new: {} }
let failedOld = false

async function shoot(side, w, theme) {
  const { ctx, page, state } = await open(side, w, theme, 'full')
  for (const pg of PAGES) {
    await load(page, side, pg.path)
    const m = await measure(page)
    const file = `${side}/${pg.name}-${w}-${theme}.png`
    await page.screenshot({ path: join(OUT, file), fullPage: true })
    const old = isOld(pg.name, m)
    ;(oldness[side][pg.name] ||= {})[`${w}-${theme}`] = old
    shots.push({ file, side, page: pg.name, route: pg.path, width: w, theme, mocked: true, ...m, looksOld: old })
    if (side === 'new' && pg.name === 'billing' && w === 1440) {
      const tiers = page.locator('.pl2-tiers')
      if (await tiers.count()) await tiers.first().screenshot({ path: join(OUT, 'new', `billing-available-soon-${theme}.png`) })
      else check(`Available soon cards found to crop (${theme})`, false, '.pl2-tiers missing')
    }
    check(`${file} lands on ${pg.path}`, m.url === pg.path.split('?')[0], m.url)
    check(`${file} no page error, no write, nothing blocked beyond the mock`, state.errors.length === 0 && state.writes.length === 0, { errors: state.errors, writes: state.writes })
    state.errors.length = 0
    state.writes.length = 0
  }
  await ctx.close()
}

try {
  check(`old commit is ${OLD_COMMIT}`, OLD_HASH.startsWith(OLD_COMMIT), OLD_HASH)
  check('new side serves this checkout, and its app code equals origin/master', appDiff.length === 0, { head: HEAD_HASH, master: NEW_HASH, differs: appDiff })

  // OLD first: if it does not look old, stop.
  for (const w of [1440, 390]) for (const theme of ['light', 'dark']) await shoot('old', w, theme)
  for (const pg of PAGES) {
    const all = Object.values(oldness.old[pg.name])
    const ok = all.length === 4 && all.every(Boolean)
    check(`OLD is old: ${OLD_CHECKS[pg.name]}`, ok, oldness.old[pg.name])
    if (!ok) failedOld = true
  }
  if (failedOld) {
    console.log('STOP: an old-side check failed, so the comparison proves nothing. New shots not taken.')
  } else {
    for (const w of [1440, 390]) for (const theme of ['light', 'dark']) await shoot('new', w, theme)
    for (const pg of PAGES) {
      const all = Object.values(oldness.new[pg.name])
      check(`NEW is not old: ${OLD_CHECKS[pg.name]} is false`, all.length === 4 && all.every(v => v === false), oldness.new[pg.name])
    }
    // Every Today-card, "Your clients", Available soon and inbound-row fact, again at the row level.
    const fix = shots.filter(s => s.side === 'new' && s.page === 'activity')
    check('new Activity shows the inbound rows from the fixture (Lead update pills)', fix.every(s => s.inboundRows >= 6 && s.leadUpdatePills >= 6), fix.map(s => ({ f: s.file, rows: s.inboundRows, pills: s.leadUpdatePills })))
    const bills = shots.filter(s => s.side === 'new' && s.page === 'billing')
    check('new Billing: four Available soon cards, Prepaid card says Inbound form and Inbound call, never Meta or Google',
      bills.every(s => s.availableSoon === 4 && s.prepaid.inboundForm && s.prepaid.inboundCall && !s.prepaid.meta && !s.prepaid.google),
      bills.map(s => ({ f: s.file, soon: s.availableSoon, ...s.prepaid })))
  }

  // No sideways scroll at 390 (all 16 phone shots), and the 1440 ones for the record.
  for (const s of shots.filter(x => x.width === 390)) check(`no sideways scroll ${s.file}`, s.scrollWidth <= s.clientWidth, `${s.scrollWidth}<=${s.clientWidth}`)
  for (const s of shots.filter(x => x.width === 1440)) check(`no sideways scroll ${s.file} (desktop, for the record)`, s.scrollWidth <= s.clientWidth, `${s.scrollWidth}<=${s.clientWidth}`)

  // ── Empty agent, rendered: policy events, no inbounds ─────────────────────────────────────────────────────
  const empty = []
  if (!failedOld) {
    for (const [w, theme] of [[1440, 'light'], [390, 'dark']]) {
      const { ctx, page, state } = await open('new', w, theme, 'empty')
      await load(page, 'new', '/agent/activity')
      const m = await measure(page)
      const dom = await page.evaluate(() => {
        const text = document.body.innerText
        return {
          emptyLeadsBlock: /No new leads on this day/.test(text),
          emptyAllBlock: /Nothing yet today/.test(text),
          inboundsLabel: [...document.querySelectorAll('.ov-actrows .l')].some(e => /^Inbounds?$/i.test(e.textContent.trim())),
          anyInboundsWord: [...document.querySelectorAll('main *, .ph-stack *')].filter(e => e.children.length === 0 && /^Inbounds?$/i.test(e.textContent.trim())).map(e => e.className || e.tagName),
        }
      })
      const file = `empty/activity-empty-${w}-${theme}.png`
      await page.screenshot({ path: join(OUT, file), fullPage: true })
      const res = {
        file, width: w, theme, mocked: true, eventRows: m.eventRows, eventKinds: m.eventKinds, inboundRows: m.inboundRows, leadUpdatePills: m.leadUpdatePills,
        inboundNames: m.inboundNames, inboundsCountRow: dom.inboundsLabel, anyInboundsWord: dom.anyInboundsWord, emptyLeadsBlock: dom.emptyLeadsBlock,
        emptyAllBlock: dom.emptyAllBlock, chips: m.chips, boxRows: m.boxRows, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth,
      }
      empty.push(res)
      check(`empty agent ${w} ${theme}: policy events show (${m.eventRows} rows)`, m.eventRows === POLICY_EVENTS.length, m.eventKinds)
      check(`empty agent ${w} ${theme}: no inbound event row, no Lead update pill`, m.inboundRows === 0 && m.leadUpdatePills === 0 && m.inboundNames.length === 0, { rows: m.inboundRows, pills: m.leadUpdatePills, names: m.inboundNames })
      check(`empty agent ${w} ${theme}: no Inbounds count row, no "Inbounds" word anywhere`, !dom.inboundsLabel && dom.anyInboundsWord.length === 0, dom.anyInboundsWord)
      check(`empty agent ${w} ${theme}: no empty inbound block (no "No new leads" note, no "Nothing yet today")`, !dom.emptyLeadsBlock && !dom.emptyAllBlock, dom)
      check(`empty agent ${w} ${theme}: no page error, no write, no sideways scroll`, state.errors.length === 0 && state.writes.length === 0 && m.scrollWidth <= m.clientWidth, { errors: state.errors, writes: state.writes, sw: `${m.scrollWidth}<=${m.clientWidth}` })
      await ctx.close()
    }
  }

  const sum = side => Object.fromEntries(PAGES.map(pg => [pg.name, { check: OLD_CHECKS[pg.name], looksOld: oldness[side][pg.name] || null }]))
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify({
    mocked: true,
    note: 'Every Supabase call is mocked; names, events, balances and counts are fixtures, not live data.',
    agentId: AGENT,
    generatedAt: new Date().toISOString(),
    oldCommit: OLD_COMMIT,
    oldCommitFull: OLD_HASH,
    oldIsParentOfMerge: '3db9106 (master-side parent; not 3db9106^1 = 84be192)',
    newCommit: NEW_HASH.slice(0, 7),
    newCommitFull: NEW_HASH,
    checkoutHead: HEAD_HASH,
    newAppSourceDiffersFromMaster: appDiff,
    oldRenderMethod: {
      summary: 'localStorage ov_portal_preview=v1, flag column absent',
      localStorage: { ov_portal_preview: 'v1' },
      setBefore: 'page load (context.addInitScript)',
      appSettingsRow: { id: 1, agent_billing_enforced: false },
      flagColumn: 'absent from the app_settings row, read as off',
      urlSwitch: false,
    },
    activityVersion: {
      new: 'Activity from master with the all-events feed (7fd94301 merged): type filter chips, per-kind rows. agent_activity_feed answers 404 in the mock (migration 185 not applied), so the page uses its policy_events fallback and adds the finished inbound steps as Lead update rows.',
      old: 'Activity at 2b8337a: policy_events only, no inbound rows.',
    },
    oldSideChecks: { old: sum('old'), new: sum('new'), allOldTrue_allNewFalse: !failedOld },
    stoppedBecauseOldIsNotOld: failedOld,
    empty,
    shots: shots.map(({ text, eventKinds, ...rest }) => ({ ...rest, eventKinds })),
    checks,
  }, null, 2) + '\n')
} finally {
  await browser.close()
  await serverOld.close()
  await serverNew.close()
}
const failed = checks.filter(c => !c.ok)
console.log(`${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failedOld ? 2 : failed.length ? 1 : 0)
