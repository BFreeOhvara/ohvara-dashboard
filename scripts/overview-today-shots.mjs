// Portal parity T3 shots: /agent (the old Overview + Today's cards) at 1440 and 390, light and dark, with every
// Supabase call mocked (no real project, account or credentials; nothing is written).
//   node scripts/overview-today-shots.mjs [outDir] [label] [appRoot]
// label new (default) = /agent as it is in this checkout, with the Today cards; old = /agent served from appRoot
// (a `git archive <commit>` copy of an app from before the Today cards), which must show none of them.
// Writes overview-<width>-<theme>-<label>.png and overview-<label>.json (card order, scroll width) to outDir
// and exits 1 on any failure: sideways scroll, a page error, a write, or an old card missing.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { zonedTimeToUtcIso } from '../src/lib/timezones.js'

const OUT = process.argv[2] || 'qa/portal-parity-overview'
const LABEL = process.argv[3] || 'new'
const ROOT = resolve(process.argv[4] || '.')
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = Number(process.env.PORT) || 5700 + Math.floor(Math.random() * 300)
mkdirSync(OUT, { recursive: true })

// ── Seed data (the same agent and inbounds as scripts/portal-v2-shots.mjs) ────
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-29T21:20:00Z') // Thu Oct 29, 4:20 PM Chicago
const at = (d, hm) => {
  const day = new Date(NOW.getTime() + d * 864e5).toLocaleDateString('en-CA', { timeZone: TZ })
  return zonedTimeToUtcIso(`${day}T${hm}`, TZ)
}
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Jordan Rivera', email: 'jordan.rivera@example.com', timezone: TZ,
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
const EVENTS = [
  ev(7, 'booked', 'done', at(-1, '10:08'), 'Booked with you', { appointment_at: at(1, '10:00') }),
  ev(6, 'booked', 'done', at(-1, '12:30'), 'Booked with you', { appointment_at: at(0, '16:45') }),
  ev(6, 'reminder', 'done', at(0, '15:45'), 'Reminder text sent'),
  ev(10, 'booked', 'done', at(-3, '09:30'), 'Booked with you', { appointment_at: at(0, '10:00') }),
  ev(22, 'booked', 'done', at(0, '13:12'), 'Booked with you', { appointment_at: at(0, '18:30') }),
  ev(3, 'va_call', 'scheduled', at(1, '10:00'), 'VA tries again'),
]
const REPLIES = [
  { id: 'r1', lead_id: id(7), body: 'Sounds good, see you then', received_at: at(0, '11:31'), handled_at: null },
  { id: 'r2', lead_id: id(3), body: 'Can you call me after 5?', received_at: at(0, '09:14'), handled_at: null },
]
const TIERS = [{ key: 'servicing_appointments', name: 'Servicing + Appointments', monthly_appointments: 12, is_active: true, sort_order: 30 }]
// The old Overview's own data: cancellation calls (policies). Booked this and last week, one confirmed
// cancelled, one No answer client on "Confirm number" (the Needs your attention box).
const P = (n, first, last, o = {}) => ({
  id: `c${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`, agent_id: AGENT, client_first_name: first, client_last_name: last,
  client_phone: `+155502001${String(n).padStart(2, '0')}`, state: 'TX', client_city: 'Austin', client_timezone: TZ, carrier_id: null, carrier_name: 'Sample Life',
  scheduled_call_at: null, fulfillment_stage: 'Pending', assigned_fulfillment_id: null, fulfillment_claimed_at: null, fulfillment_started_at: null,
  fulfillment_completed_at: null, cancellation_substatus: null, cancellation_confirmation: null, call_live_since: null, last_call_outcome: null,
  call_attempts: 0, last_call_at: null, recovery_step: null, recovery_retry_at: null, recovery_am_sent_at: null, recovery_pm_sent_at: null,
  missed_step: null, missed_retry_at: null, sms_consent: true, created_at: at(0, '09:00'), updated_at: at(0, '09:00'),
  agent: { id: AGENT, full_name: 'Jordan Rivera' }, assigned: null, details: { current_carrier: 'Sample Life' }, ...o,
})
const POLICIES = [
  P(1, 'Alex', 'Sample', { scheduled_call_at: at(1, '11:00'), created_at: at(-2, '10:00') }),
  P(2, 'Blake', 'Example', { scheduled_call_at: at(2, '14:30'), created_at: at(-1, '15:00') }),
  P(3, 'Charlie', 'Placeholder', { scheduled_call_at: at(-1, '10:00'), created_at: at(-3, '09:00'), last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: at(-1, '10:30'), recovery_step: 'number_check' }),
  P(4, 'Devon', 'Sample', { scheduled_call_at: at(-6, '13:00'), created_at: at(-8, '09:00'), fulfillment_stage: 'Complete', fulfillment_completed_at: at(-6, '13:40') }),
  P(5, 'Ellis', 'Example', { scheduled_call_at: at(-5, '09:30'), created_at: at(-7, '12:00') }),
  P(6, 'Finley', 'Placeholder', { scheduled_call_at: at(-4, '15:00'), created_at: at(-6, '16:00'), fulfillment_stage: 'Complete', fulfillment_completed_at: at(-1, '15:30') }),
]

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'jordan.rivera@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// Reads get seed data (anything unknown gets an empty answer); any write fails the run.
async function mock(page, state) {
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
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
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path.startsWith('/auth/v1/') || path.startsWith('/functions/v1/')) return json(route, 200, {})
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'agent_inbounds') return json(route, 200, INBOUNDS)
      if (name === 'my_push_settings') return json(route, 200, { push_on: false })
      if (name === 'my_money_banner') return json(route, 200, null)
      if (/^(set_|add_|mark_|create_|update_|delete_)/.test(name)) state.writes.push(name)
      return json(route, 200, [])
    }
    const table = path.replace('/rest/v1/', '')
    if (method !== 'GET') { state.writes.push(`${method} ${table}`); return json(route, 200, []) }
    switch (table) {
      case 'app_settings': return rows([{ id: 1, agent_billing_enforced: false }])
      case 'policies': return json(route, 200, POLICIES)
      case 'inbound_events': return json(route, 200, EVENTS)
      case 'lead_sms_replies': return json(route, 200, REPLIES)
      case 'membership_tiers': return json(route, 200, TIERS)
      case 'agent_duty': return rows([{ on_duty: true, since: at(0, '14:14') }])
      case 'recovery_config': return rows([{ id: 1, sms_live: false, voice_live: false, recording_live: false }])
      default: return rows([])
    }
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
// The old Overview's cards, in page order (desktop; the phone gets PhoneHome's sections).
const OLD_DESKTOP = ['Good afternoon, Jordan', 'Booked this week', 'Cancelled this week', 'Needs your attention', 'Last week']
const OLD_PHONE = ['Good afternoon, Jordan', 'Bookings this week', 'Needs you', 'Up next', 'Booked this week', 'Cancelled this week']
// The desktop Overview fits one screen, so its slim Today strip words the plan card "Appointments this month".
const TODAY = ['Next appointment', 'Live call transfers', 'Appointments left this month', 'Today’s appointments', 'New inbounds']
const TODAY_DESKTOP = TODAY.map(t => (t === 'Appointments left this month' ? 'Appointments this month' : t))
const results = []
let failed = false

for (const w of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
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
    const state = { writes: [], errors: [] }
    page.on('pageerror', e => state.errors.push(String(e)))
    await mock(page, state)
    const failures = []
    await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(w === 390 ? '.ph-stack' : '.ov-hero', { timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.tc-skel')
      && !/Loading your calls/.test(document.body.innerText), null, { timeout: 20000 })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(600)
    const m = await page.evaluate(() => ({
      text: document.body.innerText,
      scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth,
      todayCards: document.querySelectorAll('.tc-card').length,
      amberBoxes: document.querySelectorAll('.ov-attn').length,
      smallTargets: [...document.querySelectorAll('.tc-grid a, .tc-grid button')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width && r.height < 44
      }).map(el => el.textContent.trim().slice(0, 30)),
    }))
    const order = (list) => list.map(t => m.text.indexOf(t))
    const old = w === 390 ? OLD_PHONE : OLD_DESKTOP
    const oldAt = order(old)
    if (oldAt.some(i => i < 0)) failures.push(`old card missing: ${old.filter((_, i) => oldAt[i] < 0).join(', ')}`)
    if (oldAt.some((v, i) => i && v < oldAt[i - 1])) failures.push('old cards out of order')
    const todayWant = w === 390 ? TODAY : TODAY_DESKTOP
    const todayAt = order(todayWant)
    if (LABEL === 'new' && todayAt.some(i => i < 0)) failures.push(`Today card missing: ${todayWant.filter((_, i) => todayAt[i] < 0).join(', ')}`)
    if (LABEL !== 'new' && m.todayCards) failures.push(`${m.todayCards} Today card(s) in the old app`)
    if (m.scrollWidth > m.width) failures.push(`sideways scroll ${m.scrollWidth}>${m.width}`)
    if (m.amberBoxes > 1) failures.push(`${m.amberBoxes} amber boxes`)
    if (w === 390 && m.smallTargets.length) failures.push(`touch targets under 44px: ${m.smallTargets.join(' | ')}`)
    if (state.errors.length) failures.push(`page errors: ${state.errors.join(' | ')}`)
    if (state.writes.length) failures.push(`writes: ${state.writes.join(', ')}`)
    const file = `overview-${w}-${theme}-${LABEL}.png`
    await page.screenshot({ path: join(OUT, file), fullPage: true })
    results.push({ file, scrollWidth: m.scrollWidth, width: m.width, todayCards: m.todayCards, amberBoxes: m.amberBoxes, oldAt, todayAt, failures })
    if (failures.length) failed = true
    console.log(`${failures.length ? 'FAIL' : 'ok  '} ${file}${failures.length ? `: ${failures.join('; ')}` : ''}`)
    await ctx.close()
  }
}
writeFileSync(join(OUT, `overview-${LABEL}.json`), JSON.stringify(results, null, 2))
await browser.close()
await server.close()
process.exit(failed ? 1 : 0)
