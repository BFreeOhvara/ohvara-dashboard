// Overview fits one screen: shots and a MEASURED fit check, with every Supabase call mocked
// (no real project, no login, no live data).
//   node scripts/overview-fit-shots.mjs [outDir] [--before]
// Writes PNGs plus measurements.json into outDir (default qa/overview-fit/after, or .../before with --before).
// After mode asserts and exits 1 on any failure; --before only records (the old page is expected to fail).
//
// Three agent types, each at the one-screen sizes (1920x1080, 1440x900, 1280x700 and two in between):
//   servicing  Servicing only: Your book, This week, Coming up, Steps done and the Get leads card, no Today strip
//   leads      Leads only (has_servicing false): the Leads panels fill the screen, none of the four servicing blocks
//   both       Servicing and Leads: everything, with the Today strip
//   paused     Servicing and a paused Leads buyer (leads_weekly_cents 0, inbounds): keeps today's appointments
//
// The check is on bounding rects, not scrollHeight <= innerHeight: the fit mode sets height:100dvh and
// overflow:hidden, so that passes even when content is cut off. The blocks are found by their data-ov
// attributes (book, week, coming-up, steps-done, get-leads, today-strip, leads-grid, attn), never by grid
// position. For every size / theme / type it asserts that each block that should show sits fully inside the
// viewport, that the page has no hole (the grid's bottom edge is the page's bottom edge and the last block in
// each column reaches it), and that no card (the scrolling lists aside) has scrollHeight > clientHeight.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const BEFORE = process.argv.includes('--before')
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || `qa/overview-fit/${BEFORE ? 'before' : 'after'}`
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A fixed clock (Fri Oct 30, 10:24 AM Central) so before and after shots match to the pixel.
const BASE = Date.UTC(2026, 9, 30, 15, 24)
const iso = ms => new Date(ms).toISOString()
const DAY = 864e5
const AT = (daysAgo, hour = 16) => iso(Date.UTC(2026, 9, 30 - daysAgo, hour, 0))
const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard', membership_tier: 'standard',
}
// The agent types. has_servicing false is the Leads-only test (Submit.jsx:37); leads_weekly_cents is the Leads buyer test.
const TYPES = {
  servicing: { label: 'Servicing only', profile: { has_servicing: true, leads_weekly_cents: 0 }, inbounds: false, cap: 7, used: 2 },
  leads: { label: 'Leads only', profile: { has_servicing: false, leads_weekly_cents: 4900 }, inbounds: true, cap: 7, used: 0 },
  both: { label: 'Both', profile: { has_servicing: true, leads_weekly_cents: 4900 }, inbounds: true, cap: 16, used: 2 },
  paused: { label: 'Servicing and a paused Leads buyer', profile: { has_servicing: true, leads_weekly_cents: 0 }, inbounds: true, cap: 7, used: 2 },
}

const NAMES = [
  ['Marcus', 'Reed', 'Foresters'], ['Dana', 'Whitfield', 'Mutual of Omaha'], ['Teresa', 'Boone', 'Globe Life'], ['Curtis', 'Hale', 'Americo'],
  ['Priya', 'Nair', 'Transamerica'], ['Luis', 'Ortega', 'Aetna'], ['Janet', 'Kowalski', 'Corebridge'], ['Andre', 'Simmons', 'Royal Neighbors'],
  ['Grace', 'Lindholm', 'Foresters'], ['Owen', 'Tate', null], ['Maribel', 'Cruz', 'Americo'], ['Hank', 'Dorsey', 'Globe Life'],
]
let seq = 0
const mk = (over = {}) => {
  const n = ++seq
  return {
    id: `p${String(n).padStart(4, '0')}`, agent_id: AGENT, client_first_name: 'Client', client_last_name: `N${n}`, client_phone: '5551230000',
    state: 'TX', client_timezone: 'America/Chicago', carrier_name: null, scheduled_call_at: null, fulfillment_stage: 'Queued',
    fulfillment_completed_at: null, call_live_since: null, last_call_outcome: null, call_attempts: 0, last_call_at: null,
    recovery_step: null, missed_step: null, created_at: AT(40), updated_at: AT(1), details: { current_carrier: null }, ...over,
  }
}
// Booked and cancelled counts: this week (Mon Oct 26 to today) and last week (Mon Oct 19 to Sun Oct 25).
const HISTORY = () => {
  const out = []
  const booked = [[4, 2], [3, 1], [1, 3], [0, 1], [11, 3], [10, 1], [9, 2], [8, 4], [7, 2]] // [daysAgo, count]
  const cancelledDays = new Set([3, 1, 0, 10, 9, 8, 7])
  for (const [d, c] of booked) {
    for (let i = 0; i < c; i++) {
      const done = cancelledDays.has(d) && i === 0
      out.push(mk({
        created_at: AT(d, 15 + i), scheduled_call_at: AT(d - 1, 18), client_first_name: 'Done', client_last_name: `D${d}${i}`,
        ...(done ? { fulfillment_stage: 'Complete', fulfillment_completed_at: AT(d, 20) } : null),
      }))
    }
  }
  return out
}
const attention = n => Array.from({ length: n }, (_, i) => {
  const [f, l, carrier] = NAMES[i % NAMES.length]
  return mk({
    client_first_name: f, client_last_name: l, details: { current_carrier: carrier },
    last_call_outcome: 'no_answer', recovery_step: i % 3 === 2 ? 'number_check' : 'call_directly', last_call_at: AT(1, 14 + (i % 5)),
  })
})
const UPCOMING = [[0, 16, 'Helen', 'Park', 'Globe Life'], [0, 19, 'Alicia', 'Moreno', 'Aetna'], [1, 15, 'Robert', 'Ellis', 'Transamerica'],
  [-3, 18, 'Nina', 'Vasquez', 'Foresters'], [-3, 20, 'Sam', 'Oakes', 'Americo'], [-4, 14, 'Paula', 'Greer', 'Mutual of Omaha']]
const upcoming = n => UPCOMING.slice(0, n).map(([d, h, f, l, c]) => mk({ client_first_name: f, client_last_name: l, scheduled_call_at: AT(-d, h), details: { current_carrier: c } }))
const LIVE = () => mk({ client_first_name: 'Helen', client_last_name: 'Park', call_live_since: iso(BASE - 120e3), fulfillment_stage: 'In progress', scheduled_call_at: iso(BASE - 600e3) })

const FIXTURES = {
  rows0: () => [...HISTORY()],
  rows4: () => [...HISTORY(), ...attention(4)],
  rows12: () => [...HISTORY(), ...attention(12)],
  caught: () => [...HISTORY(), ...upcoming(6)],
}
// Worst-case toggles.
const WORST = { call: true, err: true, confirm: true, grace: true }

// Servicing: tasks (steps done last week Oct 19 to 25, open steps with a due_at), clients by stage, saves.
const TASK_BASE = { agent_id: AGENT, lead_id: null, note: null, created_at: AT(20) }
const tasksFor = (rows, many) => {
  let n = 0
  const named = rows.filter(p => !p.client_last_name.startsWith('D') && !/^N\d+$/.test(p.client_last_name))
  const who = i => (named.length ? named[i % named.length] : rows.length ? rows[rows.length - 1 - (i % rows.length)] : { id: null })
  const t = (kind, status, over) => ({ ...TASK_BASE, id: `t${++n}`, kind, status, due_at: null, done_at: null, policy_id: who(n).id, ...over })
  const done = (kind, day, hour = 16) => t(kind, 'done', { done_at: iso(Date.UTC(2026, 9, day, hour, 0)), due_at: iso(Date.UTC(2026, 9, day, hour - 1, 0)) })
  const open = (kind, day, hour, status = 'scheduled') => t(kind, status, { due_at: iso(Date.UTC(2026, 9, day, hour, 0)) })
  const out = [
    done('packet_check', 19), done('packet_check', 20), done('packet_check', 22),
    done('review_call', 20), done('review_call', 21), done('review_call', 21, 18), done('review_call', 23), done('review_call', 23, 17),
    open('review_call', 30, 20), open('packet_check', 31, 15), open('annual_review', 31, 18),
    open('packet_check', 29, 16), // overdue: was due Thursday
  ]
  if (many) for (let i = 0; i < 6; i++) out.push(open(i % 2 ? 'review_call' : 'packet_check', 32 + i, 16 + (i % 3)))
  return out
}
const SAVES = [{ id: 's1', done_at: iso(Date.UTC(2026, 9, 21, 17, 0)) }, { id: 's2', done_at: iso(Date.UTC(2026, 9, 24, 17, 0)) }]
const CLIENT_ROWS = [
  ...Array.from({ length: 6 }, () => ({ stage: 'protected', open_requests: 0 })),
  { stage: 'setting_up', open_requests: 1 }, { stage: 'setting_up', open_requests: 0 },
  { stage: 'needs_attention', open_requests: 1 }, { stage: 'needs_attention', open_requests: 0 },
]

// Leads: inbounds (the Today strip and cards), their booked events and waiting texts.
const LEAD = (n, name, over) => ({
  lead_id: `L${n}`, contact_name: name, phone: '3055550142', inbound_stage: 'booked', inbound_product: 'booked_appointment',
  created_at: AT(0, 14), delivered_at: AT(0, 14), live_call_result: null, transferred_at: null, ...over,
})
const INBOUNDS = [
  LEAD(1, 'Dana Whitlock', { inbound_stage: 'met' }), LEAD(2, 'Curtis Lang'), LEAD(3, 'Nadia Haddad'),
  LEAD(4, 'Owen Pratt', { inbound_product: 'live_call' }), LEAD(5, 'Janelle Ortiz', { inbound_stage: 'contacting' }),
  LEAD(6, 'Renee Cole', { inbound_stage: 'new', created_at: AT(1, 20), delivered_at: AT(1, 20) }),
]
const appt = (n, hour) => ({ id: `e${n}`, lead_id: `L${n}`, kind: 'booked', state: 'scheduled', at: iso(Date.UTC(2026, 9, 30, hour, 0)), label: 'Booked', detail: { appointment_at: iso(Date.UTC(2026, 9, 30, hour, 0)) }, actor_name: null, actor_role: null, created_at: AT(2) })
const EVENTS = [appt(1, 14), appt(2, 20), appt(3, 21), appt(4, 22)] // 9:00, 3:00, 4:00, 5:00 PM Central
const TEXTS = [
  { id: 'x1', lead_id: 'L2', body: 'Can we do 4 instead of 3:30?', received_at: iso(BASE - 2 * 36e5) },
  { id: 'x2', lead_id: 'L5', body: 'Is this about the policy I asked about?', received_at: iso(BASE - 3 * 36e5) },
]

// ── Mock ─────────────────────────────────────────────────────────────────────
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const sessionFor = profile => ({
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: profile.email, app_metadata: {}, user_metadata: {}, created_at: iso(BASE - 1000 * DAY) },
})
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const FAIL = { code: 'XX000', message: 'mock failure', details: null, hint: null }

// book: ok | missing (agent_clients 404, migration 193 not applied) | error (500) | empty (no clients)
// outcome: ok | missing (servicing_tasks.outcome 42703) ; tasks: ok | error
async function mock(page, { profile, rows, failPolicies, grace, type, book = 'ok', outcome = 'ok', tasks = 'ok', usage = 'ok', many }) {
  let policyCalls = 0 // failPolicies 'stale': the first load works, every refetch after it fails (the rows stay cached)
  const t = TYPES[type]
  const taskRows = tasksFor(rows, many)
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const reply = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile)
    if (path === '/rest/v1/rpc/agent_weekly_usage') {
      if (usage === 'error') return json(route, 500, FAIL)
      return json(route, 200, [{ used: t.used, weekly_cap: t.cap, week_end: iso(Date.UTC(2026, 10, 2, 6, 0)), tier_name: t.cap === 16 ? 'Premium' : 'Standard', enforced: true }])
    }
    if (path === '/rest/v1/rpc/agent_inbounds') return json(route, 200, t.inbounds ? INBOUNDS : [])
    const table = path.replace('/rest/v1/', '')
    if (table === 'policies') {
      policyCalls++
      if (failPolicies === true || (failPolicies === 'stale' && policyCalls > 1)) return json(route, 500, FAIL)
      return reply(rows)
    }
    if (table === 'servicing_tasks') {
      if (url.searchParams.get('outcome')) {
        if (outcome === 'missing') return json(route, 400, { code: '42703', message: 'column servicing_tasks.outcome does not exist', details: null, hint: null })
        return json(route, 200, SAVES)
      }
      if (tasks === 'error') return json(route, 500, FAIL)
      return reply(taskRows)
    }
    if (table === 'agent_clients') {
      if (book === 'missing') return json(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.agent_clients' in the schema cache", details: null, hint: null })
      if (book === 'error') return json(route, 500, FAIL)
      return reply(book === 'empty' ? [] : CLIENT_ROWS)
    }
    if (table === 'inbound_events') return json(route, 200, t.inbounds ? EVENTS : [])
    if (table === 'lead_sms_replies') return json(route, 200, t.inbounds ? TEXTS : [])
    if (table === 'membership_tiers') return json(route, 200, [{ key: 'standard', name: 'Standard', monthly_appointments: 12, is_active: true, sort_order: 1 }])
    if (table === 'app_settings') return reply([{ id: 1, agent_billing_enforced: !!grace }])
    return single ? json(route, 200, {}) : json(route, 200, [])
  })
}

// ── Measure (runs in the page) ───────────────────────────────────────────────
const measure = page => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight
  const rect = e => { const r = e.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), height: +r.height.toFixed(1) } }
  const visible = e => !!e && e.getClientRects().length > 0
  const inside = r => r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5
  const out = { vw, vh, parts: {}, clipped: [], scrollers: [], hole: {} }
  const ov = name => document.querySelector(`[data-ov="${name}"]`)
  const grid = document.querySelector('.ov-grid') || ov('leads-grid')
  const attn = ov('attn')
  const parts = {
    hero: document.querySelector('section.ov-hero'),
    book: ov('book'),
    week: ov('week'),
    comingUp: ov('coming-up'),
    stepsDone: ov('steps-done'),
    getLeads: ov('get-leads'),
    strip: ov('today-strip'),
    leadsGrid: ov('leads-grid'),
    attn,
    attnBtn: attn?.querySelector('.ov-primary, .ag-slim-go'),
    banner_call: [...document.querySelectorAll('p')].find(e => e.textContent.startsWith('Fulfillment is on a call'))?.parentElement ?? null,
    banner_err: document.querySelector('[role="alert"]'),
    banner_confirm: document.querySelector('.ov-confirm-banner'),
    banner_grace: [...document.querySelectorAll('span')].find(e => e.textContent.includes('payment didn')) ?.parentElement ?? null,
  }
  for (const [k, e] of Object.entries(parts)) {
    if (!e || !visible(e)) { out.parts[k] = null; continue }
    const r = rect(e)
    out.parts[k] = { ...r, inside: inside(r) }
    // Every card except the list: scrollHeight must not exceed clientHeight (cards, not the rows inside them).
    if (!k.endsWith('Btn') && (e.scrollHeight > e.clientHeight + 1)) out.clipped.push({ part: k, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight })
  }
  // The Leads-only grid: each card on its own.
  const lg = ov('leads-grid')
  if (lg) {
    out.leadCards = [...lg.children].filter(visible).map(c => {
      const r = rect(c)
      if (c.scrollHeight > c.clientHeight + 1) out.clipped.push({ part: `leadCard ${c.getAttribute('aria-label') || c.className}`.slice(0, 60), scrollHeight: c.scrollHeight, clientHeight: c.clientHeight })
      return { label: c.getAttribute('aria-label') || String(c.className).slice(0, 30), ...r, inside: inside(r) }
    })
  }
  // No hole: the grid's bottom edge is the page's bottom edge (the padding under it only), and the last block of
  // each column reaches the grid's bottom edge.
  if (grid && visible(grid)) {
    const g = rect(grid)
    out.hole.gridBottom = g.bottom
    out.hole.gapBelow = +(vh - g.bottom).toFixed(1)
    const side = grid.querySelector('.ov-side')
    if (side && visible(side)) out.hole.sideLastBottom = +[...side.children].filter(visible).pop().getBoundingClientRect().bottom.toFixed(1)
    if (parts.stepsDone && visible(parts.stepsDone)) out.hole.leftLastBottom = rect(parts.stepsDone).bottom
    if (out.leadCards) out.hole.cardsLastBottom = Math.max(...out.leadCards.map(c => c.bottom))
  }
  // The scrolling list inside the attention box (if any) and where the button sits under it.
  if (attn) {
    for (const e of attn.querySelectorAll('*')) {
      const oy = getComputedStyle(e).overflowY
      if ((oy === 'auto' || oy === 'scroll') && visible(e)) out.scrollers.push({ cls: String(e.className).slice(0, 40), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrolls: e.scrollHeight > e.clientHeight + 1, bottom: +e.getBoundingClientRect().bottom.toFixed(1) })
    }
    out.attnRows = [...attn.querySelectorAll('.ov-attn-row, .ov-up-row, .ag-caught-row')].filter(visible).length
    out.attnBtnText = parts.attnBtn ? parts.attnBtn.innerText.trim() : null
  }
  // What the blocks say (for the dash and note checks).
  const text = e => (e ? e.innerText.replace(/\s+/g, ' ').trim() : null)
  out.text = {
    book: text(parts.book), week: text(parts.week), comingUp: text(parts.comingUp), stepsDone: text(parts.stepsDone), strip: text(parts.strip),
    bookNumbers: [...document.querySelectorAll('[data-ov="book"] .ov-bk-n')].map(e => e.innerText.trim()),
    bookHrefs: [...document.querySelectorAll('[data-ov="book"] a')].map(a => a.getAttribute('href')),
    stripLinks: [...document.querySelectorAll('[data-ov="today-strip"] a')].map(a => a.innerText.replace(/\s+/g, ' ').trim()),
    getLeadsHref: ov('get-leads')?.getAttribute('href') ?? null,
    stepLegend: [...document.querySelectorAll('[data-ov="steps-done"] .ov-sd-legend > span')].map(e => e.innerText.replace(/\s+/g, ' ').trim()),
    lastWeekChart: !!document.querySelector('.ov-lw:not(.ov-sd)'),
    trendCards: document.querySelectorAll('.ag-trend').length,
    ringCard: text(document.querySelector('.ph-ringcard')),
  }
  out.pageScroll = { scrollHeight: document.documentElement.scrollHeight, innerHeight: vh, scrollWidth: document.documentElement.scrollWidth, innerWidth: vw }
  out.fontsOk = document.fonts.status
  return out
})

// ── Run ──────────────────────────────────────────────────────────────────────
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const hashes = {}

async function open({ route = '/agent', w, h, theme, type = 'both', fixture = 'rows4', call = false, err = false, confirm = false, grace = false, role = 'agent', phone = false, book, outcome, tasks, usage, many, mode }) {
  const profile = { ...PROFILE, ...(role === 'agent' ? TYPES[type].profile : null), role, ...(confirm ? { email_confirm_pending: true } : null), ...(grace ? { billing_exempt: false, billing_status: 'past_due', billing_grace_until: iso(BASE + 3 * DAY), billing_current_period_end: iso(BASE + 3 * DAY) } : null) }
  // Leads-only agents have no policies of their own.
  const rows = (type === 'leads' ? [] : FIXTURES[fixture]()).concat(call ? [LIVE()] : [])
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [sessionFor(profile), theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.setFixedTime(BASE)
  await mock(page, { profile, rows, failPolicies: err, grace, type, book, outcome, tasks, usage, many })
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
  if (route === '/agent' && !phone && type === 'leads') {
    await page.waitForFunction(() => /Next appointment/.test(document.querySelector('[data-ov="leads-grid"]')?.textContent || '') && !/Texts waiting—$/.test(document.querySelector('.tc-a-texts')?.textContent || ''), null, { timeout: 30000 })
  } else if (route === '/agent' && !phone) {
    if (err) await page.locator('[role="alert"]').first().waitFor({ timeout: 90000 })
    else await page.waitForFunction(() => /Needs your attention|all caught up/.test(document.querySelector('[data-ov="attn"]')?.textContent || '') && !/Needs your attention—$/.test(document.querySelector('[data-ov="attn"]')?.textContent || ''), null, { timeout: 30000 })
    // A failing query retries a few times before it shows its error.
    const alertIn = { 'book-error': 'book', 'tasks-error': 'coming-up', 'usage-error': 'week' }[mode]
    if (alertIn) await page.locator(`[data-ov="${alertIn}"] [role="alert"]`).waitFor({ timeout: 60000 })
  } else {
    await page.waitForSelector('.ov-hero, .ph-main, .tc-phone', { timeout: 30000 })
  }
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(book === 'error' ? 1500 : 900) // fade-in, fonts, queries settling
  return { ctx, page, errors }
}

const tag = o => [o.route === '/agent' || !o.route ? 'agent' : o.route.slice(1), o.type && (o.route === '/agent' || !o.route) ? o.type : null, o.fixture, o.worst ? `worst-${o.err === 'stale' ? 'stale-error' : o.err ? 'load-failed' : 'banners'}` : null, o.mode || null, `${o.w}x${o.h}`, o.theme].filter(Boolean).join('-')

// ONLY=<regex> runs just the matching cases (for iterating); a full run leaves it unset.
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null
async function agentCase(o) {
  if (ONLY && !ONLY.test(tag(o))) return
  try { await agentCaseRun(o) } catch (e) {
    results.push({ file: null, case: tag(o), size: `${o.w}x${o.h}`, theme: o.theme, type: o.type, fixture: o.fixture, pass: false, fail: [`threw: ${String(e.message).split('\n')[0]}`], measured: null })
  }
}

// Which blocks each type must show. Leads-only shows none of the four servicing blocks; Servicing only shows no
// Today strip and the Get leads card; a paused Leads buyer keeps the strip.
const SHOWS = {
  servicing: { book: 1, week: 1, comingUp: 1, stepsDone: 1, attn: 1, strip: 0, getLeads: 1, leadsGrid: 0 },
  both: { book: 1, week: 1, comingUp: 1, stepsDone: 1, attn: 1, strip: 1, getLeads: 0, leadsGrid: 0 },
  paused: { book: 1, week: 1, comingUp: 1, stepsDone: 1, attn: 1, strip: 1, getLeads: 0, leadsGrid: 0 },
  leads: { book: 0, week: 0, comingUp: 0, stepsDone: 0, strip: 0, getLeads: 0, leadsGrid: 1 }, // attn: the Texts waiting box is one of its panels
}

async function agentCaseRun(o) {
  const { ctx, page, errors } = await open(o)
  const m = await measure(page)
  const file = `${tag(o)}.png`
  // Shots kept: the main case at the three required sizes for every type, the phone, the missing-data modes at 1440x900.
  const shoot = o.shot ?? (!o.worst && (o.phone || (['1920x1080', '1440x900', '1280x700'].includes(`${o.w}x${o.h}`)
    && (o.type === 'leads' || o.fixture === 'rows4') && (!o.mode || o.w === 1440 || o.mode === 'many-steps'))))
  if (shoot) await page.screenshot({ path: join(OUT, file), fullPage: !!o.phone })
  await ctx.close()
  const fit = o.w >= 1280 && o.h >= 700
  // Under 1280x700 the Today strip is the five Today cards instead.
  const want = fit ? SHOWS[o.type] : { ...SHOWS[o.type], strip: 0, leadsGrid: SHOWS[o.type].strip || SHOWS[o.type].leadsGrid }
  const fail = []
  if (!o.phone) {
    if (!m.parts.hero) fail.push('hero missing')
    else if (fit && !m.parts.hero.inside) fail.push(`hero outside viewport (bottom ${m.parts.hero.bottom}, vh ${m.vh})`)
    for (const k of Object.keys(want)) {
      const part = m.parts[k]
      if (want[k] && !part) fail.push(`${k} missing`)
      else if (!want[k] && part) fail.push(`${k} should not show for ${TYPES[o.type].label}`)
      else if (want[k] && fit && !part.inside && !(o.worst && o.h <= 700 && k === 'stepsDone')) fail.push(`${k} outside viewport (top ${part.top}, bottom ${part.bottom}, vh ${m.vh})`)
    }
    if (m.text.lastWeekChart) fail.push('the Booked / Cancelled last-week chart is still on the page')
    if (m.text.trendCards) fail.push('the Booked / Cancelled trend cards are still on the page')
    for (const k of ['banner_call', 'banner_err', 'banner_confirm', 'banner_grace']) {
      const on = { banner_call: o.call, banner_err: o.err, banner_confirm: o.confirm, banner_grace: o.grace }[k]
      if (on && !m.parts[k]) fail.push(`${k} not showing`)
      if (on && fit && m.parts[k] && !m.parts[k].inside) fail.push(`${k} outside viewport`)
    }
    // Three banners at once on a 700px-tall screen leave the chart no room (it is cut, never the blocks above it): not asserted there.
    const crowded = o.worst && o.h <= 700
    if (fit) for (const c of m.clipped.filter(c => !(crowded && c.part === 'stepsDone'))) fail.push(`${c.part} clipped (scrollHeight ${c.scrollHeight} > clientHeight ${c.clientHeight})`)
    if (fit && m.pageScroll.scrollHeight > m.pageScroll.innerHeight + 1) fail.push(`page scrolls (${m.pageScroll.scrollHeight} > ${m.pageScroll.innerHeight})`)
    if (fit && m.leadCards) for (const c of m.leadCards) if (!c.inside) fail.push(`Leads card "${c.label}" outside viewport (bottom ${c.bottom})`)
    // No hole: a gap under the grid of more than the page padding means a block stopped short.
    if (fit && !o.err && m.hole.gridBottom != null) {
      if (m.hole.gapBelow > 44) fail.push(`hole under the page: grid ends ${m.hole.gapBelow}px above the bottom`)
      for (const k of ['sideLastBottom', 'leftLastBottom', 'cardsLastBottom']) {
        if (m.hole[k] != null && m.hole.gridBottom - m.hole[k] > 3) fail.push(`hole: ${k} ${m.hole[k]} is ${+(m.hole.gridBottom - m.hole[k]).toFixed(1)}px short of the grid bottom ${m.hole.gridBottom}`)
      }
    }
    // Attention rows: the clients (all 12 in fit mode, 4 otherwise) plus the two waiting texts when the agent has Leads.
    const items = { rows4: 4, rows12: 12 }[o.fixture]
    if (o.type !== 'leads' && !o.err && !o.mode && items) {
      const texts = TYPES[o.type].inbounds ? 2 : 0
      const expectRows = (fit ? items : Math.min(items, 4)) + texts
      if (m.attnRows !== expectRows) fail.push(`attention rows ${m.attnRows}, expected ${expectRows}`)
    }
    if (o.type !== 'leads' && !o.err && !o.mode && o.fixture === 'rows12') {
      const want12 = 'See all 12'
      if (!m.attnBtnText?.includes(want12)) fail.push(`button says "${m.attnBtnText}", expected "${want12}…"`)
      const sc = m.scrollers.find(s => s.scrolls)
      if (fit && !sc) fail.push('12 rows but no list scrolls inside the box')
      if (fit && sc && m.parts.attnBtn && !m.parts.attnBtn.inside) fail.push('the See all button is outside the viewport')
    }
    if (o.type !== 'leads' && !o.err && !o.mode) {
      // Book numbers and the tile links; This week; the four kinds in the chart.
      if (m.text.bookNumbers.join() !== '6,2,2,2') fail.push(`book numbers ${m.text.bookNumbers.join('/')}, expected 6/2/2/2`)
      const hrefs = ['protected', 'setting_up', 'needs_attention', 'requests'].map(k => `/agent/clients?stage=${k}`)
      if (m.text.bookHrefs.join() !== hrefs.join()) fail.push(`book links ${m.text.bookHrefs.join(' ')}`)
      if (!/of (7|16) submissions used/.test(m.text.week || '')) fail.push(`this week says "${m.text.week}"`)
      if (!/Packet checks 3.*Review calls 5.*Cancellations 4.*Saves 2/.test(m.text.stepLegend.join(' '))) fail.push(`steps done legend "${m.text.stepLegend.join(' | ')}"`)
      if (!/Review call|Policy packet check/.test(m.text.comingUp || '')) fail.push(`coming up has no steps: "${m.text.comingUp}"`)
    }
    if (o.type === 'servicing' && m.text.getLeadsHref !== '/agent/leads') fail.push(`Get leads links to ${m.text.getLeadsHref}`)
    if (o.type === 'paused' && !m.text.stripLinks.some(t => t.startsWith('Today’s appointments'))) fail.push(`paused Leads buyer lost today's appointments (strip links: ${m.text.stripLinks.join(' | ')})`)
    // Error and missing-data modes.
    if (o.mode === 'book-missing' || o.mode === 'book-error') {
      if (m.text.bookNumbers.join() !== '—,—,—,—') fail.push(`book shows ${m.text.bookNumbers.join('/')} instead of dashes`)
      if (o.mode === 'book-missing' && !/aren’t ready yet/.test(m.text.book || '')) fail.push('no plain note under Your book')
      if (o.mode === 'book-error' && !/Couldn’t load your book/.test(m.text.book || '')) fail.push('no load error under Your book')
    }
    if (o.mode === 'outcome-missing') {
      if (!m.parts.stepsDone) fail.push('Steps done does not render without outcome')
      else if (!/Packet checks 3.*Review calls 5.*Cancellations 4.*Saves —/.test(m.text.stepLegend.join(' '))) fail.push(`legend without outcome: "${m.text.stepLegend.join(' | ')}"`)
    }
    if (o.mode === 'tasks-error') {
      if (!/Couldn’t load your next steps/.test(m.text.comingUp || '')) fail.push('Coming up shows no load error')
      if (!/Couldn’t load your steps/.test(m.text.stepsDone || '')) fail.push('Steps done shows no load error')
    }
    if (o.mode === 'usage-error' && !/Couldn’t load your weekly count/.test(m.text.week || '')) fail.push('This week shows no load error')
    if (o.mode === 'book-empty' && !/No clients yet/.test(m.text.book || '')) fail.push('empty book has no plain note')
    if (!fit && m.pageScroll.scrollWidth > m.pageScroll.innerWidth + 1) fail.push('sideways scroll')
  } else {
    if (m.pageScroll.scrollWidth > m.pageScroll.innerWidth + 1) fail.push(`sideways scroll (${m.pageScroll.scrollWidth} > ${m.pageScroll.innerWidth})`)
    if (m.pageScroll.scrollHeight <= m.pageScroll.innerHeight) fail.push('phone page does not scroll vertically')
    const has = { book: !!m.parts.book, comingUp: !!m.parts.comingUp, stepsDone: !!m.parts.stepsDone, getLeads: !!m.parts.getLeads, week: /Submissions this week/.test(m.text.ringCard || '') }
    const need = { servicing: ['book', 'week', 'comingUp', 'stepsDone', 'getLeads'], both: ['book', 'week', 'comingUp', 'stepsDone'], leads: [] }[o.type] || []
    for (const k of need) if (!has[k]) fail.push(`phone: ${k} missing`)
    if (o.type === 'leads') for (const k of ['book', 'comingUp', 'stepsDone', 'week']) if (has[k]) fail.push(`phone: ${k} should not show for Leads only`)
    if (o.type === 'both' && has.getLeads) fail.push('phone: Get leads card shows for a Leads buyer')
  }
  if (errors.length) fail.push(`page errors: ${errors.join(' | ')}`)
  results.push({ file: shoot ? file : null, case: tag(o), size: `${o.w}x${o.h}`, theme: o.theme, type: o.type, fixture: o.fixture, mode: o.mode || null, banners: { call: !!o.call, err: !!o.err, confirm: !!o.confirm, grace: !!o.grace }, fit, pass: fail.length === 0, fail, measured: m })
}

// Click each Your book tile and check the URL it lands on.
async function tileClicks() {
  if (ONLY && !/tile/.test(String(process.env.ONLY))) return
  const o = { w: 1440, h: 900, theme: 'light', type: 'both', fixture: 'rows4' }
  const fail = []
  try {
    for (const key of ['protected', 'setting_up', 'needs_attention', 'requests']) {
      const { ctx, page } = await open(o)
      await page.locator(`[data-ov="book"] a[href="/agent/clients?stage=${key}"]`).click()
      await page.waitForURL(u => u.pathname === '/agent/clients' && u.searchParams.get('stage') === key, { timeout: 15000 })
      await ctx.close()
    }
  } catch (e) { fail.push(`tile click: ${String(e.message).split('\n')[0]}`) }
  results.push({ file: null, case: 'agent-both-book-tile-clicks-1440x900-light', size: '1440x900', theme: 'light', type: 'both', pass: fail.length === 0, fail, measured: null })
}

// Other roles: a shot per size/theme, hashed so before and after can be compared pixel for pixel.
async function otherCase(route, role, w, h, theme) {
  if (ONLY) return
  const o = { route, role, w, h, theme, fixture: 'rows4' }
  const { ctx, page, errors } = await open(o)
  const buf = await page.screenshot({ fullPage: false })
  const file = `${tag(o)}.png`
  const { writeFileSync: wf } = await import('node:fs')
  wf(join(OUT, file), buf)
  await ctx.close()
  const sha = createHash('sha256').update(buf).digest('hex')
  hashes[file] = sha
  results.push({ file, case: tag(o), size: `${w}x${h}`, theme, route, sha256: sha, pass: errors.length === 0, fail: errors, measured: null })
}

try {
  const MAIN = [[1920, 1080], [1440, 900], [1280, 700]]
  const MORE = [[1920, 950], [1440, 780]]
  for (const theme of ['dark', 'light']) {
    // Servicing only and Both: every fixture at the three required sizes; two more sizes on the busy ones.
    for (const type of ['servicing', 'both']) {
      for (const [w, h] of MAIN) for (const fixture of ['rows0', 'rows4', 'rows12', 'caught']) await agentCase({ w, h, theme, type, fixture, shot: (fixture === 'rows4' && w >= 1280) || (fixture === 'caught' && w === 1440) })
      for (const [w, h] of MORE) for (const fixture of ['rows4', 'rows12']) await agentCase({ w, h, theme, type, fixture, shot: false })
    }
    // Leads only: the Leads panels fill the screen (no policies, so one fixture).
    for (const [w, h] of [...MAIN, ...MORE]) await agentCase({ w, h, theme, type: 'leads', fixture: 'rows0' })
    // A paused Leads buyer (leads_weekly_cents 0 with inbounds) keeps today's appointments.
    for (const [w, h] of MAIN.slice(0, 2)) await agentCase({ w, h, theme, type: 'paused', fixture: 'rows4' })
    // Many steps coming up: the list scrolls inside its card.
    await agentCase({ w: 1280, h: 700, theme, type: 'both', fixture: 'rows4', many: true, mode: 'many-steps' })
    // Missing and failed data: dashes and plain notes, never zeros; the chart still renders without outcome.
    for (const [w, h] of [[1440, 900], [1280, 700]]) {
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows4', book: 'missing', mode: 'book-missing' }) // agent_clients 404 (migration 193 not applied)
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows4', book: 'error', mode: 'book-error' })
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows4', book: 'empty', mode: 'book-empty' })
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows4', outcome: 'missing', mode: 'outcome-missing' })
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows4', tasks: 'error', mode: 'tasks-error' })
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows4', usage: 'error', mode: 'usage-error' })
    }
    // Worst case: call banner, LoadError, ConfirmEmailBanner (and the payment banner) all showing.
    for (const [w, h] of [[1440, 780], [1280, 700]]) {
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows12', call: true, err: 'stale', confirm: true, grace: true, worst: true, shot: false }) // refetch failed, old rows still cached
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows12', err: true, confirm: true, grace: true, worst: true, shot: false }) // first load failed: dashes, no list
      await agentCase({ w, h, theme, type: 'both', fixture: 'rows12', call: true, confirm: true, grace: true, worst: true, shot: false }) // banners without the load error
    }
    // Under 1280 wide or 700 tall: not fit mode. The cap stays at 4, the page scrolls as today.
    for (const [w, h] of [[1200, 800], [1440, 680]]) for (const type of ['servicing', 'both', 'leads']) await agentCase({ w, h, theme, type, fixture: 'rows12', shot: false })
    // Phone: scrolls vertically, never sideways.
    for (const type of ['both', 'servicing', 'leads']) await agentCase({ w: 390, h: 844, theme, type, fixture: 'rows4', phone: true })
    // Admin and Fulfillment must look the same before and after.
    for (const [w, h] of [[1920, 1080], [1440, 900]]) {
      for (const [route, role] of [['/admin', 'admin'], ['/fulfillment', 'fulfillment']]) {
        try { await otherCase(route, role, w, h, theme) } catch (e) {
          results.push({ file: null, case: `${route.slice(1)}-${w}x${h}-${theme}`, pass: false, fail: [`threw: ${String(e.message).split('\n')[0]}`], measured: null })
        }
      }
    }
  }
  await tileClicks()
} finally {
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify({ mode: BEFORE ? 'before' : 'after', total: results.length, failed: results.filter(r => !r.pass).length, results }, null, 2))
  await browser.close()
  await server.close()
}
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.case.padEnd(56)}${r.fail.length ? '  ' + r.fail.join('; ') : ''}`)
const failed = results.filter(r => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} pass (${BEFORE ? 'before mode: recorded only' : 'after mode'}) -> ${join(OUT, 'measurements.json')}`)
process.exit(BEFORE || failed === 0 ? 0 : 1)
