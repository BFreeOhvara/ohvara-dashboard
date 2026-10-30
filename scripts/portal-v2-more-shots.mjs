// Screenshots and checks for the v2 agent portal's Calendar, Clients and Plan & billing with every
// Supabase call mocked: no real project, account or credentials are touched, nothing is written.
//   node scripts/portal-v2-more-shots.mjs [outDir]            (npm run shots:portal-v2-more)
//   node scripts/portal-v2-more-shots.mjs [outDir] --baseline (only the flag-off pages, saved as the
//                                                              "before" text to compare against)
// Writes PNGs plus measurements.json into outDir (default qa/portal-v2-more) and exits 1 on any failure.
// Checks (all against the mock):
//   18 passes = 3 routes (/agent/calendar, /agent/clients list + one detail, /agent/plan) x 1920/1440/390
//   x light/dark; each asserts no /\b(meta|facebook|google|ads?)\b/i in document.body.innerText and
//   scrollWidth <= width. Plan also: no /\$\s?\d/, 4 tier cards, every choose button disabled.
//   Clients detail shows servicing tasks. The cancellation flow runs from v2 Clients (Change this
//   booking, Confirm number end to end, Call & rebook, Book a cancellation call).
//   Flag off: /agent/clients and /agent/billing are the old pages (same text as the baseline run on
//   the pre-change code, and as ?portal=v1); /agent/calendar and /agent/plan go back to /agent.
import process from 'node:process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { zonedTimeToUtcIso } from '../src/lib/timezones.js'

const args = process.argv.slice(2)
const BASELINE = args.includes('--baseline')
const OUT = args.find(a => !a.startsWith('--')) || 'qa/portal-v2-more'
const BASE_FILE = join(OUT, 'baseline-flag-off.json')
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = Number(process.env.PORT) || 5700 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })
if (!BASELINE) for (const f of readdirSync(OUT)) if (/\.png$/.test(f)) rmSync(join(OUT, f))

// What the app chrome asks for besides the page's own queries. Anything else fails a v2 pass.
const ALLOWED = {
  tables: { carriers: [], notifications: [], agent_billing_tiers: [] },
  rpc: { my_standing_threads: [], agent_weekly_usage: [], my_money_banner: null, my_push_settings: { push_on: false }, my_incoming_transfer: [] },
  functions: { 'fetch-secrets': { capabilities: {}, secrets: [] } },
}

// ── Seed data: the mockup's week (Mon Oct 26 – Sun Nov 1), now Thu Oct 29, 4:13 PM Chicago ──
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-29T21:13:00Z')
const day = d => new Date(NOW.getTime() + d * 864e5).toLocaleDateString('en-CA', { timeZone: TZ })
const at = (d, hm) => zonedTimeToUtcIso(`${day(d)}T${hm}`, TZ)
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Jordan Rivera', email: 'jordan.rivera@example.com', timezone: TZ,
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard', membership_tier: null,
  billing_current_period_end: at(5, '12:00'),
}
const uid = (p, n) => `${p}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`
const APPT = 'booked_appointment'
const LIVE = 'live_call'
const L = (n, name, product, stage, o = {}) => ({
  lead_id: uid('b', n), lead_type: product === LIVE ? 'policy_help' : 'mortgage_protection', inbound_product: product, inbound_stage: stage,
  outcome: null, outcome_at: null, live_call_result: null, contact_name: name, phone: `+155501002${String(n).padStart(2, '0')}`,
  city: null, state: 'FL', lead_source: null, qualifier_answers: {}, transfer_status: null, transferred_at: null, va_outcome: null,
  booking_id: null, client_policy_id: null, delivered_at: at(-10, '09:00'), created_at: at(-10, '09:00'), ...o,
})
const DANA_NEW = uid('c', 1)
const INBOUNDS = [
  L(1, 'Dana Rivera', APPT, 'sold', { outcome: 'sold', outcome_at: '2026-10-03T20:00:00Z', city: 'Austin', state: 'TX', phone: '+15550100142', client_policy_id: DANA_NEW, delivered_at: '2026-09-30T15:00:00Z', created_at: '2026-09-30T15:00:00Z' }),
  L(2, 'Tom Becker', APPT, 'sold', { outcome: 'sold', outcome_at: at(-1, '12:00') }),
  L(3, 'Priya Shah', APPT, 'met'),
  L(4, 'Marcus Hale', APPT, 'follow_up', { outcome: 'follow_up', outcome_at: at(-2, '11:00') }),
  L(5, 'Jordan Placeholder', APPT, 'met'),
  L(6, 'Keisha Moore', LIVE, 'booked', { live_call_result: 'booked', va_outcome: 'booked' }),
  L(7, 'Maria Lopez', APPT, 'booked', { state: 'CO' }),
  L(8, 'Chris Nguyen', APPT, 'booked'),
  L(9, 'Bartholomew Vandenberghe-Oyelaran', APPT, 'booked'),
  L(10, 'Grace Kim', APPT, 'booked'),
  L(11, 'Avery Sample', APPT, 'new', { delivered_at: at(0, '15:58'), created_at: at(0, '15:58') }),
  L(12, 'Cameron Sample', APPT, 'lost', { outcome: 'not_interested', outcome_at: at(-5, '15:00') }),
]
let evN = 0
const ev = (lead, kind, state, when, label, detail = {}, actor = {}) => ({
  id: uid('e', ++evN), lead_id: uid('b', lead), kind, state, at: when, label, detail,
  actor_name: actor.name ?? null, actor_role: actor.role ?? null, created_at: when,
})
const VA = { name: 'Our VA', role: 'fulfillment' }
const ME = { name: 'Jordan Rivera', role: 'agent' }
const booked = (lead, d, hm, actor = VA, detail = {}) => ev(lead, 'booked', 'done', at(d - 2, '10:00'), 'Booked with you', { appointment_at: at(d, hm), ...detail }, actor)
const EVENTS = [
  ev(1, 'booked', 'done', '2026-10-01T15:00:00Z', 'Booked with you', { appointment_at: '2026-10-02T15:00:00Z' }, VA),
  booked(2, -1, '11:00'),
  booked(3, -2, '13:00'),
  booked(4, -2, '09:30', {}, { booked_by: 'client' }),
  booked(5, 0, '09:00'),
  booked(6, 0, '15:30'),
  booked(7, 0, '17:00'),
  ev(7, 'reminder', 'done', at(-1, '17:00'), 'Reminder text sent', { summary: 'The day before' }),
  ev(7, 'reminder', 'done', at(0, '16:00'), 'Reminder text sent', { summary: '1 hour before' }),
  booked(8, 1, '10:30', ME),
  booked(9, 1, '13:30', {}, { booked_by: 'client' }),
  booked(10, 2, '11:00'),
]
const AGENT_EMBED = { id: AGENT, full_name: 'Jordan Rivera' }
const B = (n, first, last, o = {}) => ({
  id: uid('d', n), agent_id: AGENT, client_first_name: first, client_last_name: last, client_phone: `+155501003${String(n).padStart(2, '0')}`,
  state: 'FL', client_city: null, client_timezone: TZ, carrier_id: null, carrier_name: null, scheduled_call_at: null,
  fulfillment_stage: 'Pending', assigned_fulfillment_id: null, fulfillment_claimed_at: null, fulfillment_started_at: null,
  fulfillment_completed_at: null, cancellation_substatus: null, cancellation_confirmation: null, call_live_since: null,
  last_call_outcome: null, call_attempts: 0, last_call_at: null, recovery_step: null, recovery_retry_at: null,
  recovery_am_sent_at: null, recovery_pm_sent_at: null, missed_step: null, missed_retry_at: null, sms_consent: true,
  created_at: at(-3, '14:12'), updated_at: at(-3, '14:12'), agent: AGENT_EMBED, assigned: null, details: { current_carrier: null },
  fulfillment_assigned: true, product_type: null, monthly_premium: null, effective_date: null, policy_sold_date: null, status: 'Submitted', ...o,
})
const LEE = uid('d', 1), ANA = uid('d', 2), MAX = uid('d', 3), SAM = uid('d', 4), DANA_OLD = uid('d', 5)
const BOOKINGS = [
  B(1, 'Lee', 'Park', { state: 'OH', client_city: 'Columbus', client_timezone: 'America/New_York', scheduled_call_at: at(1, '14:30') }),
  B(2, 'Ana', 'Gomez', { state: 'TX', scheduled_call_at: at(-1, '16:00'), fulfillment_stage: 'Complete', fulfillment_completed_at: at(-1, '16:40'), call_attempts: 1, last_call_at: at(-1, '16:05') }),
  B(3, 'Maximiliana-Alexandrina', 'Featherstonehaugh-Worthington', { state: 'PA', scheduled_call_at: at(-7, '10:00'), last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: at(-6, '10:00'), recovery_step: 'call_directly' }),
  B(4, 'Sam', 'Ortiz', { scheduled_call_at: at(-3, '11:00'), last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: at(-2, '11:00'), recovery_step: 'number_check' }),
  B(5, 'Dana', 'Rivera', { state: 'TX', client_city: 'Austin', client_phone: '+15550100142', carrier_name: 'Banner Life', product_type: 'Term 10', monthly_premium: 71.88, scheduled_call_at: at(1, '11:00'), created_at: '2026-10-27T19:12:00Z' }),
]
const OTHER_POLICIES = [
  { id: DANA_NEW, carrier_name: 'Mutual of Omaha', product_type: 'Term 20', monthly_premium: 64.2, effective_date: '2026-10-03', policy_sold_date: '2026-10-03', status: 'In force', fulfillment_assigned: false, fulfillment_stage: null, created_at: '2026-10-03T20:00:00Z' },
]
const T = (n, o) => ({ id: uid('f', n), agent_id: AGENT, lead_id: null, policy_id: null, status: 'scheduled', due_at: null, done_at: null, note: null, created_at: '2026-10-03T20:00:00Z', ...o })
const TASKS = [
  T(1, { lead_id: uid('b', 1), policy_id: DANA_NEW, kind: 'chargeback_watch', due_at: '2027-10-03T20:00:00Z' }),
  T(2, { lead_id: uid('b', 1), policy_id: DANA_NEW, kind: 'draft_date_change', due_at: at(5, '10:00'), note: 'carrier call', created_at: at(-1, '09:00') }),
  T(3, { lead_id: uid('b', 1), policy_id: DANA_NEW, kind: 'beneficiary_change', status: 'requested', created_at: at(-1, '13:00') }),
  T(4, { lead_id: uid('b', 1), policy_id: DANA_NEW, kind: 'review_call', status: 'done', due_at: '2026-10-12T15:00:00Z', done_at: '2026-10-12T15:30:00Z' }),
  T(5, { lead_id: uid('b', 1), policy_id: DANA_NEW, kind: 'packet_check', status: 'done', due_at: '2026-10-06T15:00:00Z', done_at: '2026-10-06T15:30:00Z' }),
  T(6, { lead_id: uid('b', 2), kind: 'packet_check', due_at: at(6, '12:00'), created_at: at(-1, '12:00') }),
  T(7, { lead_id: uid('b', 2), kind: 'review_call', due_at: at(29, '12:00'), created_at: at(-1, '12:00') }),
  T(8, { lead_id: uid('b', 2), kind: 'chargeback_watch', due_at: '2027-10-28T17:00:00Z', created_at: at(-1, '12:00') }),
  T(9, { policy_id: MAX, kind: 'beneficiary_change', status: 'requested', created_at: at(-1, '10:00') }),
]
const TIERS = [
  { key: 'cancellations', name: 'Cancellations', product_keys: ['cancellations'], price_cents: null, monthly_appointments: null, description: null, sort_order: 10, is_active: true },
  { key: 'servicing', name: 'Servicing', product_keys: ['servicing'], price_cents: null, monthly_appointments: null, description: null, sort_order: 20, is_active: true },
  { key: 'servicing_appointments', name: 'Servicing + Appointments', product_keys: ['servicing', 'booked_appointments'], price_cents: null, monthly_appointments: null, description: null, sort_order: 30, is_active: true },
  { key: 'servicing_live_calls', name: 'Servicing + Live Calls', product_keys: ['servicing', 'live_calls'], price_cents: null, monthly_appointments: null, description: null, sort_order: 40, is_active: true },
]

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const nowSec = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'jordan.rivera@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body, extra = {}) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
const inList = v => (v || '').replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map(s => s.replace(/"/g, '')).filter(Boolean)

// ── The mock ─────────────────────────────────────────────────────────────────
// opts: { flag, tiers: 'rows' | 'empty' | 'error', loose } — loose: the old pages run, so requests
// outside the v2 list are answered empty and recorded, not failed.
async function mock(page, opts, state) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    state.unexpected.push(`host ${u.host}`)
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const q = url.searchParams
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    const odd = (what, body = []) => { (opts.loose ? state.loose : state.unexpected).push(what); return json(route, 200, body) }

    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path.startsWith('/auth/v1/')) return odd(`${method} auth ${path.replace('/auth/v1/', '')}`, {})
    if (path.startsWith('/functions/v1/')) {
      const name = path.replace('/functions/v1/', '')
      if (method === 'GET' && name in ALLOWED.functions) return json(route, 200, ALLOWED.functions[name])
      return odd(`${method} function ${name}`, {})
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'agent_inbounds') return json(route, 200, state.inbounds)
      if (name === 'agent_confirm_recovery_number') {
        const body = JSON.parse(req.postData() || '{}')
        state.writes.push({ name, body })
        const p = state.bookings.find(b => b.id === body.p_policy)
        if (!p) return json(route, 400, { code: 'P0002', message: 'Not found' })
        Object.assign(p, { recovery_step: 'followup' })
        return json(route, 200, null)
      }
      if (method === 'POST' && name in ALLOWED.rpc) return json(route, 200, ALLOWED.rpc[name])
      return odd(`${method} rpc ${name}`)
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (method === 'HEAD') return odd(`HEAD table ${table}`, null)
      if (method !== 'GET') { state.writes.push({ name: `${method} ${table}` }); return json(route, 200, []) }
      switch (table) {
        case 'app_settings': return rows([{ id: 1, agent_portal_v2: opts.flag, agent_billing_enforced: false }])
        case 'inbound_events': {
          const lead = (q.get('lead_id') || '').replace('eq.', '')
          const list = lead ? state.events.filter(e => e.lead_id === lead)
            : state.events.filter(e => e.state === 'scheduled' || ['booked', 'reminder', 'transferred'].includes(e.kind))
          return json(route, 200, [...list].sort((a, b) => new Date(a.at) - new Date(b.at)))
        }
        case 'policies': {
          if (q.get('id')) { const ids = inList(q.get('id')); return json(route, 200, [...state.bookings, ...OTHER_POLICIES].filter(p => ids.includes(p.id))) }
          if (q.get('fulfillment_assigned') === 'eq.true') return json(route, 200, state.bookings)
          return odd(`GET policies ${url.search}`)
        }
        case 'servicing_tasks':
          state.reads.add(table)
          return json(route, 200, TASKS.filter(t => t.status !== 'cancelled'))
        case 'membership_tiers':
          if (opts.tiers === 'error') return json(route, 500, { code: 'XX000', message: 'mock failure' })
          return json(route, 200, opts.tiers === 'empty' ? [] : TIERS)
        case 'agent_duty': return json(route, 200, [{ on_duty: true }])
        default:
          if (table in ALLOWED.tables) return rows(ALLOWED.tables[table])
          return odd(`GET table ${table}`, single ? null : [])
      }
    }
    return odd(`${method} ${path}`, {})
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
const BANNED = /\b(meta|facebook|google|ads?)\b/i
const MONEY = /\$\s?\d/

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const extra = []

async function open(w, theme, opts) {
  const ctx = await browser.newContext({
    viewport: SIZES[w], colorScheme: theme, timezoneId: TZ, locale: 'en-US',
    ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null),
  })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  await ctx.clock.setFixedTime(NOW)
  const page = await ctx.newPage()
  const state = { unexpected: [], loose: [], reads: new Set(), writes: [], pageErrors: [], inbounds: structuredClone(INBOUNDS), events: structuredClone(EVENTS), bookings: structuredClone(BOOKINGS) }
  page.on('pageerror', e => state.pageErrors.push(String(e)))
  await mock(page, opts, state)
  return { ctx, page, state }
}

async function ready(page) {
  await page.waitForSelector('.pv-content', { timeout: 20000 })
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.pv-skel'), null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}
const measure = page => page.evaluate(() => ({
  text: document.body.innerText,
  scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth,
  errorCards: document.querySelectorAll('[role="alert"]').length,
  events: [...document.querySelectorAll('.pv-ev2')].filter(e => e.offsetParent).length,
  agenda: [...document.querySelectorAll('.pv-ag-row')].filter(e => e.offsetParent).length,
  tasks: document.querySelectorAll('.pv-task').length,
  tiers: document.querySelectorAll('.pv-tier').length,
  tierButtons: [...document.querySelectorAll('.pv-tier button')].map(b => ({ disabled: b.disabled, text: b.textContent.trim() })),
  small: [...document.querySelectorAll('.pv-content a, .pv-content button, .pv-tabbar a')].filter(e => e.offsetParent)
    .map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) } })
    .filter(r => r.h < 44 || r.w < 44),
}))
const check = (failures, cond, msg) => { if (!cond) failures.push(msg) }

const DANA = uid('b', 1)
const ROUTES = [
  { name: 'calendar', views: [{ path: '/agent/calendar' }] },
  { name: 'clients', views: [{ suffix: 'list', path: '/agent/clients' }, { suffix: 'detail', path: `/agent/clients?open=${DANA}` }] },
  { name: 'plan', views: [{ path: '/agent/plan' }] },
]
const expectFor = {
  calendar: ({ failures, m, w }) => {
    for (const s of ['Every appointment, whoever booked it.', 'Maria Lopez', 'Booked by an Ohvara VA', 'They picked the time', 'Chris Nguyen']) check(failures, m.text.includes(s), `calendar: missing "${s}"`)
    if (w === 390) {
      check(failures, m.agenda >= 6, `calendar 390: ${m.agenda} agenda rows, expected 6+`)
      check(failures, m.events === 0, 'calendar 390: week grid is showing')
      check(failures, /Today\s+Thu, Oct 29/.test(m.text) && m.text.includes('Show next week'), 'calendar 390: agenda not grouped from Today')
    } else {
      check(failures, m.text.includes('Oct 26 – Nov 1'), 'calendar: no "Oct 26 – Nov 1" range')
      check(failures, m.events >= 12, `calendar: ${m.events} events in the week grid, expected 12+`)
      for (const s of ['Later today', 'Open inbound', 'Next up']) check(failures, m.text.includes(s), `calendar: missing "${s}"`)
    }
  },
  clients: ({ failures, m, view, w }) => {
    if (view === 'list' || w !== 390) for (const s of ['Dana Rivera', 'From an inbound', 'Existing', 'Lee Park', 'All', 'From inbounds']) check(failures, m.text.includes(s), `clients list: missing "${s}"`)
    if (view === 'detail' || w !== 390) {
      for (const s of ['Policies', 'Mutual of Omaha', '$64.20', 'Chargeback watch', 'Month 1 of 12', 'Draft date change', 'Requested', 'Scheduled', 'Done', 'Request servicing', 'Cancellations', 'Waiting for Fulfillment', 'Consent']) check(failures, m.text.includes(s), `clients detail: missing "${s}"`)
      check(failures, m.tasks >= 4, `clients detail: ${m.tasks} servicing tasks, expected 4`)
    }
  },
  plan: ({ failures, m }) => {
    check(failures, m.text.match(MONEY) === null, `plan: amount in innerText: ${m.text.match(MONEY)?.[0]}`)
    check(failures, m.tiers === 4, `plan: ${m.tiers} tier cards, expected 4`)
    check(failures, m.tierButtons.length === 4 && m.tierButtons.every(b => b.disabled && b.text === 'Available soon'), `plan: choose buttons ${JSON.stringify(m.tierButtons)}`)
    check(failures, (m.text.match(/Price set by Ohvara/g) || []).length === 4, 'plan: not 4 x "Price set by Ohvara"')
    for (const s of ['You must be active in Ohvara to get live transfers.', 'How it works', 'What you do', 'Live Calls', 'Booked Appointments']) check(failures, m.text.includes(s), `plan: missing "${s}"`)
  },
}

async function pass(route, w, theme) {
  const { ctx, page, state } = await open(w, theme, { flag: true, tiers: 'rows' })
  const failures = []
  const shots = []
  let text = ''
  let m
  try {
    for (const v of route.views) {
      await page.goto(`${base}${v.path}`, { waitUntil: 'domcontentloaded' })
      await ready(page)
      m = await measure(page)
      text += `\n${m.text}`
      const tag = v.suffix ? ` ${v.suffix}` : ''
      check(failures, m.scrollWidth <= m.width, `${route.name}${tag}: sideways scroll ${m.scrollWidth}>${m.width}`)
      check(failures, m.errorCards === 0, `${route.name}${tag}: ${m.errorCards} error card(s)`)
      if (w === 390) check(failures, m.small.length === 0, `${route.name}${tag}: targets under 44px ${JSON.stringify(m.small)}`)
      expectFor[route.name]({ failures, m, view: v.suffix, w })
      const file = `${route.name}${v.suffix ? `-${v.suffix}` : ''}-${w}-${theme}.png`
      await page.screenshot({ path: join(OUT, file), fullPage: true })
      shots.push(file)
    }
  } catch (e) {
    failures.push(`page did not load: ${String(e.message).split('\n')[0]}`)
  }
  const banned = text.match(BANNED)
  check(failures, banned === null, `banned word in innerText: ${banned?.[0]}`)
  check(failures, state.pageErrors.length === 0, `pageErrors: ${state.pageErrors.join(' | ')}`)
  check(failures, state.unexpected.length === 0, `unexpected requests: ${[...new Set(state.unexpected)].join(', ')}`)
  check(failures, state.writes.length === 0, `unexpected writes: ${state.writes.map(x => x.name).join(', ')}`)
  results.push({ route: route.name, width: w, theme, shots, bannedMatch: banned?.[0] ?? null, moneyMatch: route.name === 'plan' ? (m?.text.match(MONEY)?.[0] ?? null) : undefined, scrollWidth: m?.scrollWidth, innerWidth: m?.width, failures })
  await ctx.close()
}

// The old pages with the flag off: no v2 shell, the old sidebar, and the main area's text.
async function oldPage(url, opts, shot) {
  const { ctx, page, state } = await open(1440, 'dark', { ...opts, loose: true })
  await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main', { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => ({
    v2: !!document.querySelector('.pv'), path: location.pathname, text: document.querySelector('main')?.innerText ?? '',
    side: [...document.querySelectorAll('aside a')].map(a => a.textContent.trim()).join('|'),
  }))
  if (shot) await page.screenshot({ path: join(OUT, shot), fullPage: true })
  await ctx.close()
  return { ...info, pageErrors: state.pageErrors }
}

const OLD = [['clients', '/agent/clients'], ['billing', '/agent/billing']]

try {
  if (BASELINE) {
    const saved = {}
    for (const [name, url] of OLD) saved[name] = await oldPage(url, { flag: false }, null)
    writeFileSync(BASE_FILE, JSON.stringify(saved, null, 2) + '\n')
    console.log(`baseline saved: ${BASE_FILE} (${OLD.map(([n]) => `${n} ${saved[n].text.length} chars`).join(', ')})`)
  } else {
    // 1. The 18 passes
    for (const r of ROUTES) for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) await pass(r, w, theme)

    // 2. The cancellation flow from v2 Clients (1440 light).
    {
      const { ctx, page, state } = await open(1440, 'light', { flag: true, tiers: 'rows', loose: true })
      const failures = []
      const go = async u => { await page.goto(`${base}${u}`, { waitUntil: 'domcontentloaded' }); await ready(page) }
      const card = () => page.locator('section[aria-label="Cancellations"]')
      // a. Booked: the old status sentence and journey; Change this booking opens the old Change a booking.
      await go(`/agent/clients?open=${LEE}`)
      const a = await card().innerText()
      check(failures, /Waiting for Fulfillment/.test(a) && /Journey/.test(a) && /Old policy cancelled/.test(a), `flow a: card text ${JSON.stringify(a)}`)
      await page.screenshot({ path: join(OUT, 'flow-a-booked-1440-light.png'), fullPage: true })
      await card().getByRole('button', { name: 'Change this booking' }).click()
      await page.waitForURL(u => u.pathname === '/agent/book' && u.searchParams.get('change') === LEE, { timeout: 10000 }).catch(() => failures.push('flow a: did not open /agent/book?change='))
      await page.getByText('Change a booking', { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => failures.push('flow a: old Change a booking page not shown'))
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(OUT, 'flow-a-change-booking-1440-light.png'), fullPage: true })
      // b. Confirm number, end to end: the old ConfirmNumber writes agent_confirm_recovery_number and the card moves on.
      await go(`/agent/clients?open=${SAM}`)
      check(failures, /Confirm their number to continue/.test(await card().innerText()), 'flow b: no Confirm number status')
      await card().getByRole('button', { name: 'Yes, this is the right number' }).click()
      await page.waitForFunction(() => /texting them a link to pick a time/.test(document.querySelector('section[aria-label="Cancellations"]')?.innerText || ''), null, { timeout: 10000 })
        .catch(() => failures.push('flow b: card did not move on to the text follow-up'))
      const wb = state.writes.filter(x => x.name === 'agent_confirm_recovery_number')
      check(failures, wb.length === 1 && wb[0].body.p_policy === SAM && wb[0].body.p_phone === null, `flow b: writes ${JSON.stringify(state.writes)}`)
      await page.screenshot({ path: join(OUT, 'flow-b-confirmed-1440-light.png'), fullPage: true })
      // c. Needs attention: Call & rebook opens the old re-book picker in place.
      await go(`/agent/clients?open=${MAX}`)
      await card().getByRole('button', { name: /Call & rebook/ }).click()
      await card().getByText('Re-book for', { exact: false }).waitFor({ timeout: 10000 }).catch(() => failures.push('flow c: re-book picker not shown'))
      check(failures, await card().getByRole('button', { name: 'Cancel' }).isVisible(), 'flow c: no Cancel on the picker')
      await page.screenshot({ path: join(OUT, 'flow-c-rebook-1440-light.png'), fullPage: true })
      // d. A sold inbound with no booking: Book a cancellation call opens the old Book a call.
      await go(`/agent/clients?open=${uid('b', 2)}`)
      await card().getByRole('link', { name: 'Book a cancellation call' }).click()
      await page.waitForURL(u => u.pathname === '/agent/book', { timeout: 10000 }).catch(() => failures.push('flow d: did not open /agent/book'))
      await page.waitForSelector('main', { timeout: 15000 })
      await page.waitForTimeout(1200)
      const d = await page.evaluate(() => ({ v2: !!document.querySelector('.pv'), text: document.querySelector('main')?.innerText || '' }))
      check(failures, !d.v2 && /Book/.test(d.text), 'flow d: old Book a call not shown')
      await page.screenshot({ path: join(OUT, 'flow-d-book-call-1440-light.png'), fullPage: true })
      check(failures, state.pageErrors.length === 0, `flow: pageErrors ${state.pageErrors.join(' | ')}`)
      const otherWrites = state.writes.filter(x => x.name !== 'agent_confirm_recovery_number')
      check(failures, otherWrites.length === 0, `flow: other writes ${JSON.stringify(otherWrites)}`)
      extra.push({ check: 'cancellation flow from v2 Clients: status + journey, Change this booking -> /agent/book?change=, Confirm number writes agent_confirm_recovery_number once and moves on, Call & rebook opens the picker, Book a cancellation call -> /agent/book', failures })
      await ctx.close()
    }

    // 3. Plan with zero rows, and a failed read.
    for (const [tiers, want] of [['empty', 'Plans are being set up'], ['error', "We couldn't load the plans"]]) {
      const { ctx, page, state } = await open(390, 'dark', { flag: true, tiers })
      const failures = []
      await page.goto(`${base}/agent/plan`, { waitUntil: 'domcontentloaded' })
      await page.getByText(want).waitFor({ timeout: 20000 }).catch(() => failures.push(`plan ${tiers}: "${want}" not shown`))
      await page.waitForTimeout(400)
      const m = await measure(page)
      check(failures, m.text.includes('How it works') && m.text.match(MONEY) === null && BANNED.exec(m.text) === null && m.scrollWidth <= m.width, `plan ${tiers}: page checks`)
      check(failures, state.pageErrors.length === 0, `plan ${tiers}: pageErrors`)
      await page.screenshot({ path: join(OUT, `plan-${tiers}-390-dark.png`), fullPage: true })
      extra.push({ check: `plan, membership_tiers ${tiers}: "${want}", How it works still shown`, failures })
      await ctx.close()
    }

    // 4. Flag off: the old pages, the same as before this change and as ?portal=v1; the new routes go home.
    {
      const before = existsSync(BASE_FILE) ? JSON.parse(readFileSync(BASE_FILE, 'utf8')) : null
      for (const [name, url] of OLD) {
        const failures = []
        const off = await oldPage(url, { flag: false }, `old-${name}-flag-off-1440-dark.png`)
        const v1 = await oldPage(`${url}?portal=v1`, { flag: true }, null)
        check(failures, !off.v2 && off.path === url, `${name}: flag off shows v2 or moved (${off.path})`)
        check(failures, /Book a call/.test(off.side), `${name}: old sidebar missing (${off.side})`)
        check(failures, off.pageErrors.length === 0, `${name}: pageErrors ${off.pageErrors.join(' | ')}`)
        check(failures, off.text.length > 0 && off.text === v1.text, `${name}: flag off and ?portal=v1 differ`)
        if (before) check(failures, off.text === before[name].text && off.side === before[name].side, `${name}: text differs from the pre-change baseline`)
        else failures.push(`${name}: no baseline file (${BASE_FILE}); run with --baseline on the pre-change code first`)
        extra.push({ check: `flag off ${url}: old page, same text as ${before ? 'the pre-change baseline and ' : ''}?portal=v1 (${off.text.length} chars)`, failures })
      }
      for (const url of ['/agent/calendar', '/agent/plan']) {
        const failures = []
        const off = await oldPage(url, { flag: false }, null)
        check(failures, off.path === '/agent' && !off.v2, `${url}: flag off landed on ${off.path} (v2=${off.v2})`)
        extra.push({ check: `flag off ${url} goes back to /agent`, failures })
      }
    }
  }
} finally {
  if (!BASELINE) writeFileSync(join(OUT, 'measurements.json'), JSON.stringify({ passes: results, extra }, null, 2) + '\n')
  await browser.close()
  await server.close()
}

if (!BASELINE) {
  for (const r of results) console.log(`${r.route.padEnd(9)} ${String(r.width).padEnd(5)} ${r.theme.padEnd(5)} banned=${r.bannedMatch}${r.moneyMatch !== undefined ? ` money=${r.moneyMatch}` : ''} scroll=${r.scrollWidth}/${r.innerWidth} ${r.failures.length ? `FAIL: ${r.failures.join(' / ')}` : 'ok'}`)
  for (const e of extra) console.log(`${e.failures.length ? 'FAIL' : 'ok  '} ${e.check}${e.failures.length ? ` -> ${e.failures.join(' / ')}` : ''}`)
  const failed = results.filter(r => r.failures.length).length + extra.filter(e => e.failures.length).length
  console.log(`${results.length} passes, ${extra.length} extra checks, ${failed} failed`)
  process.exit(failed || results.length !== 18 ? 1 : 0)
}
