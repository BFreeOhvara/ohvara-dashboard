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
//   Flag off: /agent is the old Overview, /agent/inbounds goes back to /agent; ?portal=v1 (flag on) is the same Overview.
import process from 'node:process'
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { zonedTimeToUtcIso } from '../src/lib/timezones.js'

const OUT = process.argv[2] || 'qa/portal-preview'
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })


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
const AGENT = process.env.AS_ID
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
// opts: { flag, duty: 'live' | 'off' | '404', tier, failNextOutcome, transfer }
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
        case 'app_settings': state.reads.add(table); return rows([{ id: 1, agent_portal_v2: opts.flag, agent_billing_enforced: false }])
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


// ── Portal preview list checks (flag OFF) ───────────────────────────────────
const MODE = process.env.MODE // 'preview' | 'stranger'
const OFF = { flag: false, duty: 'off', tier: 'servicing_appointments' }
const log = []
const ok = (cond, msg) => { log.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1 }
const isV2 = page => page.evaluate(() => !!document.querySelector('.pv-content'))
const isOld = page => page.evaluate(() => !!document.querySelector('.ph-app, .app-main:not(.pv-main)') && !document.querySelector('.pv-content'))
const linkInfo = page => page.evaluate(() => {
  const b = document.querySelector('.ov-preview-link')
  if (!b) return null
  const r = b.getBoundingClientRect(); const cs = getComputedStyle(b)
  return { text: b.textContent.trim(), h: r.height, color: cs.color }
})
const choice = page => page.evaluate(() => localStorage.getItem('ov_portal_preview'))
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
async function settle(page) { await page.waitForLoadState('networkidle').catch(() => {}); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900) }
async function shotLink(page, file) {
  await page.locator('.ov-preview-link').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, file) })
}

try {
  if (MODE === 'preview') {
    for (const [w, theme] of [[390, 'light'], [390, 'dark'], [1440, 'light']]) {
      const tag = `${w} ${theme}`
      const { ctx, page, state } = await open(w, theme, OFF)
      await page.goto(`${base}/agent`); await settle(page)
      ok(await isV2(page), `${tag}: flag off, preview user, no choice -> v2 Today loads`)
      let L = await linkInfo(page)
      ok(L?.text === 'Back to old pages', `${tag}: v2 page shows "${L?.text}"`)
      if (w === 390) { ok(L?.h >= 44, `${tag}: link tap height ${L?.h}px >= 44`); ok(await noSideScroll(page), `${tag}: v2 no sideways scroll`); await shotLink(page, `link-v2-today-390-${theme}.png`) }
      await page.locator('.ov-preview-link').click(); await settle(page)
      ok(await isOld(page) && new URL(page.url()).pathname === '/agent', `${tag}: tap -> old Overview at /agent`)
      ok(await choice(page) === 'v1', `${tag}: choice saved v1`)
      L = await linkInfo(page)
      ok(L?.text === 'Preview v2', `${tag}: old page shows "${L?.text}"`)
      if (w === 390) { ok(L?.h >= 44, `${tag}: old link tap height ${L?.h}px`); ok(await noSideScroll(page), `${tag}: old no sideways scroll`); await shotLink(page, `link-old-overview-390-${theme}.png`) }
      await page.reload(); await settle(page)
      ok(await isOld(page), `${tag}: reload keeps old pages`)
      await page.goto(`${base}/agent/inbounds`); await settle(page)
      ok(new URL(page.url()).pathname === '/agent' && await isOld(page), `${tag}: chose v1, /agent/inbounds -> old /agent`)
      await page.goto(`${base}/agent/billing`); await settle(page)
      await page.locator('.ov-preview-link').click(); await settle(page)
      ok(new URL(page.url()).pathname === '/agent/plan' && await isV2(page), `${tag}: Billing "Preview v2" -> v2 Plan`)
      await page.reload(); await settle(page)
      ok(await isV2(page) && await choice(page) === 'v2', `${tag}: reload keeps v2`)
      await page.goto(`${base}/settings`); await settle(page)
      ok(await linkInfo(page) === null, `${tag}: no link on /settings`)
      ok(state.writes.length === 0, `${tag}: no writes (${state.writes.length})`)
      ok(state.pageErrors.length === 0, `${tag}: no page errors ${state.pageErrors.join(' | ')}`)
      await ctx.close()
    }
  } else {
    for (const theme of ['light', 'dark']) {
      const tag = `stranger 390 ${theme}`
      const { ctx, page, state } = await open(390, theme, OFF)
      await ctx.addInitScript(() => localStorage.setItem('ov_portal_preview', 'v2'))
      await page.goto(`${base}/agent?preview=v2`); await settle(page)
      ok(await choice(page) === 'v2', `${tag}: ov_portal_preview=v2 planted by hand`)
      ok(await isOld(page), `${tag}: ?preview=v2 + planted v2 -> still old Overview`)
      ok(await linkInfo(page) === null, `${tag}: no preview link on old page`)
      for (const [from, to] of [['/agent/inbounds', '/agent'], ['/agent/calendar', '/agent'], ['/agent/plan', '/agent/billing'], ['/agent/inbounds/b0000007-0000-4000-8000-000000000000', '/agent']]) {
        await page.goto(`${base}${from}?preview=v2`); await settle(page)
        ok(new URL(page.url()).pathname === to && await isOld(page), `${tag}: ${from} -> ${new URL(page.url()).pathname} (want ${to})`)
      }
      await page.goto(`${base}/agent/clients`); await settle(page)
      ok(await isOld(page) && await linkInfo(page) === null, `${tag}: /agent/clients old My Pipeline, no link`)
      ok(state.pageErrors.length === 0, `${tag}: no page errors ${state.pageErrors.join(' | ')}`)
      await ctx.close()
    }
  }
} catch (e) { log.push(`FAIL threw: ${e.message}`); process.exitCode = 1 }
console.log(log.join('\n'))
await browser.close(); await server.close()
