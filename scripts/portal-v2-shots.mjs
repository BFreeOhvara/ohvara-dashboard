// Screenshots and checks for the v2 agent portal (Today, Inbounds, Inbound detail, Plan, Settings' Active card) with every
// Supabase call mocked: no real project, account or credentials are touched, nothing is written.
//   node scripts/portal-v2-shots.mjs [outDir]      (npm run shots:portal-v2)
// Writes PNGs plus measurements.json into outDir (default qa/portal-v2) and exits 1 on any failure.
// Checks (all against the mock, none against the live database):
//   30 passes = 5 routes (/agent, /agent/inbounds with both tabs, /agent/inbounds/:id, /agent/plan, /settings#contact)
//   x 1920/1440/390 x light/dark; each asserts no /\b(meta|facebook|google|ads?)\b/i in document.body.innerText and
//   scrollWidth <= width.
//   agent_duty live (30 passes, "Active since 2:14 PM") and agent_duty 404 (Today at 1440 light + dark: "Coming soon").
//   Active switch at every size and theme: Today Off, click, reload shows "Active since 4:20 PM", Settings agrees, Settings
//   flips it back Off and Today agrees (agent_duty upserts on_duty true then false, nothing else written).
//   Transfer alert at every size and theme: Active + a my_incoming_transfer row = the alert, portaled to <body>, Dismiss
//   closes it; Inactive + the same row waiting = no poll and no alert.
//   Explainers open on first view, collapsed after, user choice remembered. Detail timeline has 1+ upcoming step.
//   Sold click: timeline gains the outcome and became_client events. Failed save rolls back with Try again.
//   v2 is the only agent portal (no flag): the nav links and old URLs are checked in portal-v2-more-shots.mjs.
import process from 'node:process'
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { zonedTimeToUtcIso } from '../src/lib/timezones.js'

const OUT = process.argv[2] || 'qa/portal-v2'
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (/\.png$/.test(f)) rmSync(join(OUT, f))

// ── What the app chrome genuinely asks for besides the v2 queries ────────────
// A table, rpc or function not listed here (and not one of the v2 ones) fails the run.
const ALLOWED = {
  // recovery_config: Settings → Client contact's text follow-up card; every live switch off.
  tables: { carriers: [], policies: [], notifications: [], agent_billing_tiers: [], recovery_config: [{ id: 1, sms_live: false, voice_live: false, recording_live: false }] },
  rpc: { my_standing_threads: [], agent_weekly_usage: [], my_money_banner: null, my_push_settings: { push_on: false } },
  functions: { 'fetch-secrets': { capabilities: {}, secrets: [] } },
}

// ── Seed data ────────────────────────────────────────────────────────────────
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-29T21:20:00Z') // Thu Oct 29, 4:20 PM Chicago, the mockup's "now"
const at = (d, hm) => { // d = days from today, hm = 'HH:MM' Chicago wall clock
  const day = new Date(NOW.getTime() + d * 864e5).toLocaleDateString('en-CA', { timeZone: TZ })
  return zonedTimeToUtcIso(`${day}T${hm}`, TZ)
}
const PROFILE = (tier) => ({
  id: AGENT, role: 'agent', full_name: 'Jordan Rivera', email: 'jordan.rivera@example.com', timezone: TZ,
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard', membership_tier: tier,
  billing_current_period_end: at(5, '12:00'),
})
const APPT = 'booked_appointment'
const LIVE = 'live_call'
const L = (n, name, product, stage, o = {}) => ({
  lead_id: `b${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`, lead_type: product === LIVE ? 'policy_help' : 'mortgage_protection',
  inbound_product: product, inbound_stage: stage, outcome: null, outcome_at: null, live_call_result: null, contact_name: name,
  phone: `+155501001${String(n).padStart(2, '0')}`, city: null, state: 'FL', lead_source: null,
  qualifier_answers: product === APPT ? { homeowner: true, mortgage_balance_band: '$250k–$500k', age_band: '45–54', best_time: 'Morning' } : {},
  transfer_status: null, transferred_at: null, va_outcome: null, booking_id: null, client_policy_id: null,
  delivered_at: at(0, '09:00'), created_at: at(0, '09:00'), ...o,
})
const id = n => `b${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`
const INBOUNDS = [
  L(1, 'Avery Sample', APPT, 'new', { delivered_at: at(0, '15:58'), created_at: at(0, '15:58') }),
  L(2, 'Rowan Example', APPT, 'new', { delivered_at: at(0, '16:11'), created_at: at(0, '16:11') }),
  L(3, 'Jamie Sample', APPT, 'contacting', { delivered_at: at(0, '08:05'), created_at: at(0, '08:05') }),
  L(4, 'Skyler Placeholder', APPT, 'contacting', { delivered_at: at(-2, '10:00'), created_at: at(-2, '10:00') }),
  L(5, 'Parker Sample', APPT, 'contacting', { delivered_at: at(-7, '10:00'), created_at: at(-7, '10:00') }),
  L(6, 'Riley Example', APPT, 'booked', { delivered_at: at(-1, '12:00'), created_at: at(-1, '12:00') }),
  L(7, 'Dana Sample', APPT, 'booked', { state: 'FL', phone: '+15550100142', delivered_at: at(-2, '19:12'), created_at: at(-2, '19:12') }),
  L(8, 'Taylor Placeholder', APPT, 'booked', { delivered_at: at(0, '11:20'), created_at: at(0, '11:20') }),
  L(9, 'Drew Example', APPT, 'booked', { delivered_at: at(-5, '14:00'), created_at: at(-5, '14:00') }),
  L(10, 'Morgan Placeholder', APPT, 'met', { delivered_at: at(-3, '09:00'), created_at: at(-3, '09:00') }),
  L(11, 'Logan Sample', APPT, 'sold', { outcome: 'sold', outcome_at: at(-3, '15:00'), delivered_at: at(-8, '09:00'), created_at: at(-8, '09:00') }),
  L(12, 'Reese Example', APPT, 'follow_up', { outcome: 'follow_up', outcome_at: at(-2, '11:00'), delivered_at: at(-9, '09:00'), created_at: at(-9, '09:00') }),
  L(13, 'Emerson Placeholder', APPT, 'sold', { outcome: 'sold', outcome_at: at(-8, '15:00'), delivered_at: at(-12, '09:00'), created_at: at(-12, '09:00') }),
  L(14, 'Cameron Sample', APPT, 'lost', { outcome: 'not_interested', outcome_at: at(-5, '15:00'), delivered_at: at(-10, '09:00'), created_at: at(-10, '09:00') }),
  L(21, 'Quinn Example', LIVE, 'met', { live_call_result: 'transferred', transfer_status: 'connected', transferred_at: at(0, '14:31'), delivered_at: at(0, '14:27'), created_at: at(0, '14:27') }),
  L(22, 'Casey Example', LIVE, 'booked', { live_call_result: 'booked', va_outcome: 'booked', delivered_at: at(0, '13:05'), created_at: at(0, '13:05') }),
  L(23, 'Harper Sample', LIVE, 'contacting', { live_call_result: 'missed', va_outcome: 'not_reached', delivered_at: at(0, '09:48'), created_at: at(0, '09:48') }),
  L(24, 'Sage Placeholder', LIVE, 'sold', { live_call_result: 'transferred', transfer_status: 'connected', outcome: 'sold', outcome_at: at(-1, '17:40'), delivered_at: at(-1, '17:20'), created_at: at(-1, '17:20') }),
  L(25, 'Blake Example', LIVE, 'booked', { live_call_result: 'booked', va_outcome: 'booked', delivered_at: at(-1, '11:02'), created_at: at(-1, '11:02') }),
  L(26, 'Finley Sample', LIVE, 'lost', { live_call_result: 'transferred', transfer_status: 'connected', outcome: 'not_interested', outcome_at: at(-2, '15:30'), delivered_at: at(-2, '15:15'), created_at: at(-2, '15:15') }),
  L(27, 'Bartholomew-Christophersonwilliamson Vandenberghe-Oyelaran', LIVE, 'new', { phone: null, delivered_at: at(0, '15:40'), created_at: at(0, '15:40') }),
]
let evN = 0
const ev = (lead, kind, state, when, label, detail = {}, actor = {}) => ({
  id: `e${String(++evN).padStart(7, '0')}-0000-4000-8000-000000000000`, lead_id: id(lead), kind, state, at: when, label, detail,
  actor_name: actor.name ?? null, actor_role: actor.role ?? null, created_at: when,
})
const VA = { name: 'Our VA', role: 'fulfillment' }
const EVENTS = [
  // Dana: the mockup's timeline
  ev(7, 'came_in', 'done', at(-2, '19:12'), 'Came in', { summary: 'Filled in the mortgage protection form.' }),
  ev(7, 'text_sent', 'done', at(-2, '19:12'), 'Welcome text sent', { summary: 'Automated' }),
  ev(7, 'va_call', 'done', at(-2, '19:14'), 'VA called, no answer', { summary: 'Try 1 (day 0)' }),
  ev(7, 'text_sent', 'done', at(-2, '19:15'), 'Missed-call text sent', { summary: 'Automated, with a link to pick a time' }),
  ev(7, 'va_call', 'done', at(-1, '10:02'), 'VA called and talked for 6 min', { summary: 'Try 2 (day 1). Owns her home, about $310k left on the mortgage.' }),
  ev(7, 'booked', 'done', at(-1, '10:08'), 'Booked with you', { summary: 'Fri, Oct 30, 10:00 AM', appointment_at: at(1, '10:00') }),
  ev(7, 'text_sent', 'done', at(-1, '10:08'), 'Confirmation text sent', { summary: 'Automated, with a reschedule link' }),
  ev(7, 'reminder', 'done', at(0, '10:00'), 'Reminder text sent', { summary: 'Automated, the day before' }),
  ev(7, 'text_received', 'done', at(0, '11:31'), 'Dana replied by text', { text: 'Sounds good, see you then' }),
  ev(7, 'note', 'done', at(-1, '10:10'), 'Note', { note: 'Wants cover for the whole mortgage. Her husband may join the call.' }, VA),
  ev(7, 'reminder', 'scheduled', at(1, '09:00'), 'Reminder text', { summary: '1 hour before, with a reschedule link' }),
  ev(7, 'booked', 'scheduled', at(1, '10:00'), 'Your appointment with Dana', { summary: 'Call her on (555) 010-0142' }),
  ev(7, 'rebooked', 'scheduled', at(1, '11:00'), 'VA calls to rebook', { summary: 'Within the hour, up to twice', when_label: "If she doesn't show" }),
  ev(7, 'outcome', 'scheduled', at(1, '12:00'), 'You mark the outcome', { summary: 'Sold, Follow up or Not interested', when_label: 'After you meet' }),
  // Today's appointments
  ev(6, 'booked', 'done', at(-1, '12:30'), 'Booked with you', { appointment_at: at(0, '16:45') }),
  ev(6, 'reminder', 'done', at(0, '15:45'), 'Reminder text sent'),
  ev(6, 'reminder', 'scheduled', at(0, '16:15'), 'Reminder text', { summary: 'Sent' }),
  ev(10, 'booked', 'done', at(-3, '09:30'), 'Booked with you', { appointment_at: at(0, '10:00') }),
  ev(22, 'booked', 'done', at(0, '13:12'), 'Booked with you', { appointment_at: at(0, '18:30') }),
  ev(25, 'booked', 'done', at(-1, '11:10'), 'Booked with you', { appointment_at: at(2, '09:30') }),
  ev(8, 'booked', 'done', at(0, '11:25'), 'Booked with you', { appointment_at: at(4, '13:00') }),
  ev(8, 'reminder', 'scheduled', at(3, '13:00'), 'Reminder text'),
  ev(9, 'booked', 'done', at(-4, '09:00'), 'Booked with you', { appointment_at: at(5, '11:30') }),
  ev(9, 'rebooked', 'done', at(-1, '09:00'), 'Rebooked after a no-show'),
  // What the VA does next
  ev(3, 'va_call', 'scheduled', at(1, '10:00'), 'VA tries again', { summary: 'Day 1' }),
  ev(4, 'va_call', 'scheduled', at(1, '10:00'), 'VA retries day 3'),
  ev(5, 'va_call', 'scheduled', at(0, '17:00'), 'VA retries day 7'),
  ev(12, 'follow_up', 'scheduled', at(7, '10:00'), 'Call back', {}),
  ev(11, 'outcome', 'done', at(-3, '15:00'), 'Sold', { outcome: 'sold' }, { name: 'Jordan Rivera', role: 'agent' }),
]
const SENT = [
  { id: 's1', lead_id: id(7), stage: 'just_submitted', status: 'sent', created_at: at(-2, '19:12') },
  { id: 's2', lead_id: id(7), stage: 'not_reached', status: 'sent', created_at: at(-2, '19:15') },
]
const REPLIES = [
  { id: 'r1', lead_id: id(7), body: 'Sounds good, see you then', received_at: at(0, '11:31'), handled_at: null },
  { id: 'r2', lead_id: id(3), body: 'Can you call me after 5?', received_at: at(0, '09:14'), handled_at: null },
]
// What my_incoming_transfer() returns while help-transfer puts a call through (first name only).
const TRANSFER = { help_call_id: 'f0000001-0000-4000-8000-000000000000', transfer_started_at: new Date(NOW.getTime() - 20e3).toISOString(), lead_id: id(7), caller_label: 'Dana' }
const DUTY_ROW = { live: { on_duty: true, since: at(0, '14:14') }, off: { on_duty: false, since: null } }
const TIERS = [
  { key: 'servicing', name: 'Servicing', monthly_appointments: null, is_active: true, sort_order: 20 },
  { key: 'servicing_appointments', name: 'Servicing + Appointments', monthly_appointments: 12, is_active: true, sort_order: 30 },
]

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const nowSec = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'jordan.rivera@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ── The mock ─────────────────────────────────────────────────────────────────
// opts: { duty: 'live' | 'off' | '404', tier, failNextOutcome, transfer }
// state: per-context copy of the data, plus what the page asked for.
async function mock(page, opts, state) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    state.unexpected.push(`host ${u.host} (${route.request().method()} ${u.pathname})`)
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

    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE(opts.tier))
    if (path.startsWith('/auth/v1/')) { state.unexpected.push(`${method} auth ${path.replace('/auth/v1/', '')}`); return json(route, 200, {}) }
    if (path.startsWith('/functions/v1/')) {
      const name = path.replace('/functions/v1/', '')
      if (method === 'GET' && name in ALLOWED.functions) return json(route, 200, ALLOWED.functions[name])
      // Settings → Client contact's Caller ID card asks for its status (a read); any other action fails the run.
      if (method === 'POST' && name === 'agent-caller-id' && JSON.parse(req.postData() || '{}').action === 'status') return json(route, 200, { configured: false })
      state.unexpected.push(`${method} function ${name}`); return json(route, 200, {})
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'agent_inbounds') { state.reads.add('agent_inbounds'); return json(route, 200, state.inbounds) }
      if (name === 'my_incoming_transfer') {
        // Like the function: the agent's own transferring call, only while on duty.
        state.transferPolls++
        return json(route, 200, opts.transfer && state.duty?.on_duty ? [TRANSFER] : [])
      }
      if (name === 'set_inbound_outcome' || name === 'add_inbound_note') {
        const body = JSON.parse(req.postData() || '{}')
        state.writes.push({ name, body })
        const lead = state.inbounds.find(l => l.lead_id === body.p_lead)
        if (!lead) return json(route, 400, { code: 'P0002', message: 'Lead not found' })
        const stamp = NOW.toISOString()
        const mk = (kind, label, detail) => ({ ...ev(0, kind, 'done', stamp, label, detail, { name: 'Jordan Rivera', role: 'agent' }), lead_id: lead.lead_id })
        if (name === 'add_inbound_note') {
          const e = mk('note', 'Note', { note: body.p_note }); state.events.push(e); return json(route, 200, e.id)
        }
        if (opts.failNextOutcome && !state.failed) { state.failed = true; return json(route, 400, { code: 'XX000', message: 'mock failure' }) }
        const stage = { sold: 'sold', follow_up: 'follow_up', not_interested: 'lost' }[body.p_outcome]
        Object.assign(lead, { inbound_stage: stage, outcome: body.p_outcome, outcome_at: stamp })
        state.events.push(mk('outcome', { sold: 'Sold', follow_up: 'Follow up', not_interested: 'Not interested' }[body.p_outcome], { outcome: body.p_outcome }))
        if (body.p_outcome === 'sold') state.events.push(mk('became_client', 'Became a client', {}))
        return json(route, 200, stage)
      }
      if (method === 'POST' && name in ALLOWED.rpc) return json(route, 200, ALLOWED.rpc[name])
      state.unexpected.push(`${method} rpc ${name}`); return json(route, 200, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (table === 'agent_duty' && method === 'POST' && opts.duty !== '404') {
        // The upsert from the Active switch. The server stamps since (agent_duty_guard, 174).
        const body = JSON.parse(req.postData() || '{}')
        state.writes.push({ name: 'agent_duty', body, onConflict: q.get('on_conflict') })
        const was = state.duty
        state.duty = { on_duty: body.on_duty, since: body.on_duty ? (was?.on_duty ? was.since : NOW.toISOString()) : null }
        return route.fulfill({ status: 201, headers: CORS, body: '' })
      }
      if (method !== 'GET') { state.unexpected.push(`${method} table ${table}`); return json(route, 200, []) }
      switch (table) {
        case 'app_settings': state.reads.add(table); return rows([{ id: 1, agent_billing_enforced: false }])
        case 'inbound_events': {
          state.reads.add(table)
          const lead = (q.get('lead_id') || '').replace('eq.', '')
          const list = lead ? state.events.filter(e => e.lead_id === lead)
            : state.events.filter(e => e.state === 'scheduled' || ['booked', 'reminder', 'transferred'].includes(e.kind))
          return json(route, 200, [...list].sort((a, b) => new Date(a.at) - new Date(b.at)))
        }
        case 'lead_followup_sms_log': state.reads.add(table); return json(route, 200, SENT.filter(s => s.lead_id === (q.get('lead_id') || '').replace('eq.', '')))
        case 'lead_sms_replies': {
          state.reads.add(table)
          const lead = (q.get('lead_id') || '').replace('eq.', '')
          return json(route, 200, lead && lead !== 'not.is.null' ? REPLIES.filter(r => r.lead_id === lead) : REPLIES.filter(r => !r.handled_at))
        }
        case 'membership_tiers': state.reads.add(table); return json(route, 200, TIERS)
        case 'agent_duty':
          state.reads.add(table)
          if (opts.duty === '404') return json(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.agent_duty' in the schema cache", details: null, hint: null })
          return rows(state.duty ? [state.duty] : [])
        default:
          if (table in ALLOWED.tables) return rows(ALLOWED.tables[table])
          state.unexpected.push(`GET table ${table}`); return json(route, 200, single ? null : [])
      }
    }
    state.unexpected.push(`${method} ${path}`)
    return json(route, 200, {})
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
const BANNED = /\b(meta|facebook|google|ads?)\b/i

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
  const state = {
    unexpected: [], reads: new Set(), writes: [], pageErrors: [], failed: false, transferPolls: 0,
    inbounds: structuredClone(INBOUNDS), events: structuredClone(EVENTS), duty: structuredClone(DUTY_ROW[opts.duty] ?? null),
  }
  page.on('pageerror', e => state.pageErrors.push(String(e)))
  await mock(page, opts, state)
  return { ctx, page, state }
}

async function ready(page, sel = '.pv-content') {
  await page.waitForSelector(sel, { timeout: 20000 })
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.pv-skel'), null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}
const measure = page => page.evaluate(() => ({
  alert: !!document.querySelector('.pv-ta'), alertInBody: document.querySelector('.pv-ta')?.parentElement === document.body,
  text: document.body.innerText,
  scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth,
  errorCards: document.querySelectorAll('[role="alert"]').length,
  upcoming: document.querySelectorAll('.pv-ev.up').length,
  openExplainers: [...document.querySelectorAll('details.pv-explain')].map(d => d.open),
}))
const check = (failures, cond, msg) => { if (!cond) failures.push(msg) }

// One pass = one route at one size and theme. `steps` runs inside the same page.
async function pass(route, w, theme, opts, expect) {
  const { ctx, page, state } = await open(w, theme, opts)
  const failures = []
  const shots = []
  let text = ''
  const grab = async (suffix) => {
    await ready(page, route.ready)
    const m = await measure(page)
    text += `\n${m.text}`
    check(failures, m.scrollWidth <= m.width, `${suffix}: sideways scroll ${m.scrollWidth}>${m.width}`)
    check(failures, m.errorCards === 0, `${suffix}: ${m.errorCards} error card(s)`)
    const file = `${route.name}${suffix ? `-${suffix}` : ''}-${w}-${theme}.png`
    await page.screenshot({ path: join(OUT, file), fullPage: true })
    shots.push(file)
    return m
  }
  let m
  try {
    await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded' })
    m = await grab(route.tabs ? 'booked' : '')
    expect.call(null, { failures, m, page, text: m.text, tab: 'booked' })
    if (route.tabs) {
      await page.goto(`${base}${route.path}?tab=live`, { waitUntil: 'domcontentloaded' })
      const m2 = await grab('live')
      expect.call(null, { failures, m: m2, page, text: m2.text, tab: 'live' })
    }
  } catch (e) {
    failures.push(`page did not load: ${String(e.message).split('\n')[0]}`)
  }
  const banned = text.match(BANNED)
  check(failures, banned === null, `banned word in innerText: ${banned?.[0]}`)
  check(failures, state.pageErrors.length === 0, `pageErrors: ${state.pageErrors.join(' | ')}`)
  check(failures, state.unexpected.length === 0, `unexpected requests: ${[...new Set(state.unexpected)].join(', ')}`)
  check(failures, state.writes.length === 0, `unexpected writes: ${state.writes.map(x => x.name).join(', ')}`)
  results.push({ route: route.name, width: w, theme, duty: opts.duty, shots, bannedMatch: banned?.[0] ?? null, scrollWidth: m?.scrollWidth, innerWidth: m?.width, upcoming: m?.upcoming, failures })
  await ctx.close()
}

const ROUTES = [
  { name: 'today', path: '/agent' },
  { name: 'inbounds', path: '/agent/inbounds', tabs: true },
  { name: 'detail', path: `/agent/inbounds/${id(7)}` },
  { name: 'plan', path: '/agent/plan' },
  { name: 'settings', path: '/settings#contact', ready: '.ov-set-main' },
]
const LIVE_OPTS = { duty: 'live', tier: 'servicing_appointments' }
const expectFor = {
  today: ({ failures, text }) => {
    for (const s of ['Riley Example', 'Active since 2:14 PM', 'Texts waiting', 'Today’s appointments', 'Live call transfers']) check(failures, text.includes(s), `today: missing "${s}"`)
    check(failures, !/Display only|Shown here for now/.test(text), 'today: display-only copy still shown')
    check(failures, !text.includes('Coming soon'), 'today: shows Coming soon while duty is live')
    check(failures, /4\s*of 12 left/.test(text) && /8 used/.test(text), 'today: plan usage is not "4 of 12 left, 8 used"')
  },
  inbounds: ({ failures, text, tab }) => {
    if (tab === 'booked') for (const s of ['How booked appointments work', 'Avery Sample', 'Sold / Follow up / Lost', 'Dana Sample']) check(failures, text.includes(s), `inbounds booked: missing "${s}"`)
    else for (const s of ['How live calls work', 'Quinn Example', 'Transferred', 'Missed', 'Not marked', 'Bartholomew-Christophersonwilliamson']) check(failures, text.includes(s), `inbounds live: missing "${s}"`)
  },
  plan: ({ failures, text }) => {
    check(failures, text.includes('Your portal rings and we call your phone.'), 'plan: missing "Your portal rings and we call your phone."')
    check(failures, !/\bpush\b/i.test(text), 'plan: still promises a push')
  },
  settings: ({ failures, text }) => {
    for (const s of ['Live call transfers', 'Active since 2:14 PM']) check(failures, text.includes(s), `settings: missing "${s}"`)
  },
  detail: ({ failures, m, text }) => {
    check(failures, m.upcoming >= 1, `detail: ${m.upcoming} upcoming steps, expected 1+`)
    for (const s of ['Dana Sample', 'Came in', 'Upcoming', 'How did it go?', 'Texting coming soon', '$250k–$500k']) check(failures, text.includes(s), `detail: missing "${s}"`)
  },
}

try {
  // 1. The 30 passes
  for (const r of ROUTES) for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) await pass(r, w, theme, LIVE_OPTS, expectFor[r.name])

  // 2. agent_duty 404: Today shows Coming soon, no error. Plan tier with no appointment number reads "—".
  for (const theme of ['light', 'dark']) {
    const { ctx, page, state } = await open(1440, theme, { duty: '404', tier: 'servicing' })
    const failures = []
    await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    const m = await measure(page)
    await page.screenshot({ path: join(OUT, `today-duty404-1440-${theme}.png`), fullPage: true })
    for (const s of ['Coming soon', 'Soon you can turn this on', 'This shows once your plan includes appointments']) check(failures, m.text.includes(s), `duty404: missing "${s}"`)
    check(failures, !m.text.includes("You're active"), 'duty404: shows active')
    check(failures, m.errorCards === 0, `duty404: ${m.errorCards} error card(s)`)
    check(failures, state.reads.has('agent_duty'), 'duty404: agent_duty was never asked')
    check(failures, BANNED.exec(m.text) === null, 'duty404: banned word')
    check(failures, m.scrollWidth <= m.width, 'duty404: sideways scroll')
    check(failures, state.pageErrors.length === 0, `duty404: pageErrors ${state.pageErrors.join(' | ')}`)
    check(failures, state.unexpected.length === 0, `duty404: unexpected ${[...new Set(state.unexpected)].join(', ')}`)
    extra.push({ check: `agent_duty 404, Today 1440 ${theme}`, failures })
    await ctx.close()
  }

  // 3. Explainers: open on the first view, collapsed after, the agent's own choice remembered, per tab.
  {
    const { ctx, page } = await open(1440, 'dark', LIVE_OPTS)
    const failures = []
    const openNow = async url => { await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' }); await ready(page); return page.evaluate(() => document.querySelector('details.pv-explain').open) }
    const seq = []
    seq.push(['booked, first view', await openNow('/agent/inbounds'), true])
    seq.push(['booked, second view', await openNow('/agent/inbounds'), false])
    seq.push(['live, first view', await openNow('/agent/inbounds?tab=live'), true])
    seq.push(['live, second view', await openNow('/agent/inbounds?tab=live'), false])
    await page.goto(`${base}/agent/inbounds`, { waitUntil: 'domcontentloaded' }); await ready(page)
    await page.locator('details.pv-explain summary').click()
    await page.waitForTimeout(200)
    seq.push(['booked, opened by the agent', await page.evaluate(() => document.querySelector('details.pv-explain').open), true])
    seq.push(['booked, after reload (choice remembered)', await openNow('/agent/inbounds'), true])
    await page.locator('details.pv-explain summary').click()
    await page.waitForTimeout(200)
    seq.push(['booked, closed again then reload', await openNow('/agent/inbounds'), false])
    for (const [label, got, want] of seq) check(failures, got === want, `explainer ${label}: open=${got}, expected ${want}`)
    extra.push({ check: `explainers: ${seq.map(([l, g]) => `${l}=${g ? 'open' : 'collapsed'}`).join('; ')}`, failures })
    await ctx.close()
  }

  // 4. Sold click: the timeline gains the outcome and became_client; the RPC got the right call.
  {
    const { ctx, page, state } = await open(1440, 'light', LIVE_OPTS)
    const failures = []
    await page.goto(`${base}/agent/inbounds/${id(7)}`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    const before = await page.locator('.pv-ev').count()
    const hadBefore = await page.locator('.pv-tl').innerText()
    check(failures, !/Became a client/.test(hadBefore), 'sold: already a client before the click')
    await page.screenshot({ path: join(OUT, 'detail-before-sold-1440-light.png'), fullPage: true })
    await page.getByRole('button', { name: 'Sold', exact: true }).click()
    await page.getByText('is now your client', { exact: false }).waitFor({ timeout: 10000 }).catch(() => failures.push('sold: no saved line'))
    await page.waitForFunction(() => /Became a client/.test(document.querySelector('.pv-tl')?.innerText || ''), null, { timeout: 10000 }).catch(() => failures.push('sold: timeline never showed Became a client'))
    await page.waitForTimeout(400)
    const tl = await page.locator('.pv-tl').innerText()
    const after = await page.locator('.pv-ev').count()
    check(failures, /\bSold\b/.test(tl), 'sold: timeline has no Sold outcome')
    check(failures, /Became a client/.test(tl), 'sold: timeline has no Became a client')
    check(failures, after === before + 2, `sold: timeline steps ${before} -> ${after}, expected +2`)
    check(failures, (await page.locator('.pv-ev.up').count()) >= 1, 'sold: upcoming steps vanished')
    check(failures, await page.getByRole('button', { name: 'Sold', exact: true }).getAttribute('aria-pressed') === 'true', 'sold: Sold is not pressed')
    const w = state.writes.filter(x => x.name === 'set_inbound_outcome')
    check(failures, w.length === 1 && w[0].body.p_outcome === 'sold' && w[0].body.p_lead === id(7), `sold: rpc calls ${JSON.stringify(w)}`)
    await page.screenshot({ path: join(OUT, 'detail-after-sold-1440-light.png'), fullPage: true })
    extra.push({ check: `Sold click: timeline ${before} -> ${after} steps, outcome + became_client shown, 1 set_inbound_outcome(sold)`, failures })
    await ctx.close()
  }

  // 5. A failed save rolls back and offers Try again; a note saves.
  {
    const { ctx, page, state } = await open(390, 'dark', { ...LIVE_OPTS, failNextOutcome: true })
    const failures = []
    await page.goto(`${base}/agent/inbounds/${id(7)}`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await page.getByRole('button', { name: 'Follow up', exact: true }).click()
    await page.getByText('Couldn’t save Follow up. Nothing changed.', { exact: false }).waitFor({ timeout: 10000 }).catch(() => failures.push('failure: no error line'))
    check(failures, await page.getByRole('button', { name: 'Follow up', exact: true }).getAttribute('aria-pressed') === 'false', 'failure: Follow up stayed pressed')
    await page.screenshot({ path: join(OUT, 'detail-save-failed-390-dark.png'), fullPage: true })
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await page.getByText('Marked Follow up', { exact: false }).waitFor({ timeout: 10000 }).catch(() => failures.push('failure: retry did not save'))
    await page.getByLabel('New note').fill('Call after 5 PM')
    await page.getByRole('button', { name: 'Save note', exact: true }).click()
    await page.getByText('Call after 5 PM', { exact: false }).waitFor({ timeout: 10000 }).catch(() => failures.push('note: never appeared'))
    check(failures, state.writes.map(x => x.name).join() === 'set_inbound_outcome,set_inbound_outcome,add_inbound_note', `failure: writes ${state.writes.map(x => x.name)}`)
    extra.push({ check: 'failed save rolls back with Try again; retry saves; note saves', failures })
    await ctx.close()
  }

  // 6a. The Active switch, both ways, at every size and theme: Today Off -> click -> reload shows Active since
  //     4:20 PM -> Settings agrees -> Settings flips it Off -> Today agrees. Only agent_duty is written.
  for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) {
    const { ctx, page, state } = await open(w, theme, { ...LIVE_OPTS, duty: 'off' })
    const failures = []
    const sw = page.locator('.a-active [role="switch"]')
    const setSw = page.getByRole('switch', { name: 'Active for live call transfers' })
    const text = () => page.evaluate(() => document.body.innerText)
    const fit = async label => { const m = await measure(page); check(failures, m.scrollWidth <= m.width, `${label}: sideways scroll ${m.scrollWidth}>${m.width}`) }
    try {
      await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
      await ready(page)
      check(failures, await sw.getAttribute('aria-checked') === 'false', 'switch: not Off at first')
      check(failures, (await text()).includes("You're not active"), 'switch: no "You\'re not active"')
      check(failures, !(await sw.getAttribute('aria-disabled')), 'switch: has aria-disabled')
      const box = await sw.boundingBox()
      check(failures, box && box.height >= 44 && box.width >= 44, `switch: touch target ${box?.width}x${box?.height}`)
      await fit('switch off')
      await page.screenshot({ path: join(OUT, `today-switch-off-${w}-${theme}.png`), fullPage: true })
      await sw.click()
      await page.waitForFunction(() => document.querySelector('.a-active [role="switch"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 10000 })
      await page.waitForTimeout(400)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await ready(page)
      check(failures, await sw.getAttribute('aria-checked') === 'true', 'switch: not On after reload')
      check(failures, (await text()).includes('Active since 4:20 PM'), 'switch: no "Active since 4:20 PM" after reload')
      await fit('switch on')
      await page.screenshot({ path: join(OUT, `today-switch-on-${w}-${theme}.png`), fullPage: true })
      await page.goto(`${base}/settings#contact`, { waitUntil: 'domcontentloaded' })
      await ready(page, '.ov-set-main')
      await setSw.waitFor({ timeout: 10000 })
      check(failures, await setSw.getAttribute('aria-checked') === 'true', 'settings: switch not On')
      check(failures, (await text()).includes('Active since 4:20 PM'), 'settings: no "Active since 4:20 PM"')
      await fit('settings on')
      await page.screenshot({ path: join(OUT, `settings-duty-on-${w}-${theme}.png`), fullPage: true })
      await setSw.click()
      await page.getByText('Not active. Live calls are booked on your calendar instead.').waitFor({ timeout: 10000 })
      await page.waitForTimeout(400)
      await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
      await ready(page)
      check(failures, await sw.getAttribute('aria-checked') === 'false', 'switch: Today not Off after Settings flipped it')
    } catch (e) {
      failures.push(`switch flow: ${String(e.message).split('\n')[0]}`)
    }
    const duty = state.writes.filter(x => x.name === 'agent_duty')
    check(failures, duty.map(x => x.body.on_duty).join() === 'true,false', `switch: agent_duty writes ${JSON.stringify(duty.map(x => x.body))}`)
    check(failures, duty.every(x => x.body.agent_id === AGENT && x.onConflict === 'agent_id'), 'switch: wrote a row that is not the agent\'s own')
    check(failures, state.writes.length === duty.length, `switch: other writes ${state.writes.map(x => x.name)}`)
    check(failures, state.pageErrors.length === 0, `switch: pageErrors ${state.pageErrors.join(' | ')}`)
    check(failures, state.unexpected.length === 0, `switch: unexpected ${[...new Set(state.unexpected)].join(', ')}`)
    extra.push({ check: `Active switch ${w} ${theme}: Off -> On (Active since 4:20 PM after reload) -> Settings agrees -> Off from Settings`, failures })
    await ctx.close()
  }

  // 6b. The transfer alert at every size and theme: Active rings (alert portaled to <body>, Dismiss closes it);
  //     Inactive with the same call waiting never polls and never shows.
  for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) {
    for (const duty of ['live', 'off']) {
      const { ctx, page, state } = await open(w, theme, { ...LIVE_OPTS, duty, transfer: true })
      const failures = []
      try {
        await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
        await ready(page)
        if (duty === 'live') {
          await page.waitForSelector('.pv-ta', { timeout: 10000 })
          await page.waitForTimeout(300)
          const m = await measure(page)
          check(failures, m.alertInBody, 'alert: not a direct child of <body>')
          check(failures, m.text.includes('Live call for you: Dana.') && m.text.includes('We’re calling your phone now. Pick up.'), 'alert: wrong words')
          check(failures, !/\+?1?\s*\(?555\)?/.test(await page.locator('.pv-ta').innerText()), 'alert: shows a phone number')
          check(failures, m.scrollWidth <= m.width, `alert: sideways scroll ${m.scrollWidth}>${m.width}`)
          const inView = await page.locator('.pv-ta').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })
          check(failures, inView, 'alert: not fully on screen')
          const btn = await page.getByRole('button', { name: 'Dismiss' }).boundingBox()
          check(failures, btn && btn.height >= 44, `alert: Dismiss is ${btn?.height}px tall`)
          await page.screenshot({ path: join(OUT, `today-alert-${w}-${theme}.png`) })
          await page.getByRole('button', { name: 'Dismiss' }).click()
          await page.waitForTimeout(4500)
          check(failures, !(await measure(page)).alert, 'alert: still open after Dismiss')
        } else {
          await page.waitForTimeout(9000)
          const m = await measure(page)
          check(failures, !m.alert, 'inactive: alert showed')
          check(failures, state.transferPolls === 0, `inactive: polled my_incoming_transfer ${state.transferPolls} time(s)`)
          await page.screenshot({ path: join(OUT, `today-inactive-no-alert-${w}-${theme}.png`) })
        }
      } catch (e) {
        failures.push(`alert flow: ${String(e.message).split('\n')[0]}`)
      }
      check(failures, state.pageErrors.length === 0, `alert: pageErrors ${state.pageErrors.join(' | ')}`)
      check(failures, state.unexpected.length === 0, `alert: unexpected ${[...new Set(state.unexpected)].join(', ')}`)
      check(failures, state.writes.length === 0, `alert: writes ${state.writes.map(x => x.name)}`)
      extra.push({ check: duty === 'live' ? `transfer alert ${w} ${theme}: Active, open over the page, portaled to body, Dismiss closes it (${state.transferPolls} polls)` : `transfer alert ${w} ${theme}: Inactive, no poll, no alert`, failures })
      await ctx.close()
    }
  }
} finally {
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify({ passes: results, extra }, null, 2) + '\n')
  await browser.close()
  await server.close()
}

for (const r of results) console.log(`${r.route.padEnd(9)} ${String(r.width).padEnd(5)} ${r.theme.padEnd(5)} banned=${r.bannedMatch} scroll=${r.scrollWidth}/${r.innerWidth} ${r.failures.length ? `FAIL: ${r.failures.join(' / ')}` : 'ok'}`)
for (const e of extra) console.log(`${e.failures.length ? 'FAIL' : 'ok  '} ${e.check}${e.failures.length ? ` -> ${e.failures.join(' / ')}` : ''}`)
const failed = results.filter(r => r.failures.length).length + extra.filter(e => e.failures.length).length
console.log(`${results.length} passes, ${extra.length} extra checks, ${failed} failed`)
process.exit(failed || results.length !== 30 ? 1 : 0)
