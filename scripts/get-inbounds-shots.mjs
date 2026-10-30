// Screenshots /agent/inbounds (Get inbounds panel) and /agent (Start cards) with every Supabase call mocked,
// so no real project, account or credentials are touched. agent-billing inbound_get / inbound_set answer
// from the contract in the brief; the backend isn't needed.
//   node scripts/get-inbounds-shots.mjs [outDir]
// Writes PNGs plus measurements.json into outDir (default qa/get-inbounds).
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/get-inbounds'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5700 + Math.floor(Math.random() * 200)
mkdirSync(OUT, { recursive: true })

const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const soon = new Date(Date.now() + 5 * 864e5).toISOString()
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard', billing_current_period_end: soon,
}
const TIERS = [{ key: 'standard', name: 'Standard', weekly_cents: 29900, weekly_cap: 16, sort_order: 1, is_active: true }]
const USAGE = { used: 2, weekly_cap: 16, enforced: true, tier_name: 'Standard', week_start: ago(48), week_end: soon }

const MIN = 10000
const EST = { live_call: 5500, booked_appointment: 9000 }
const row = (type, label, weekly_cents, paused = false) => ({ type, label, weekly_cents, paused, estimate_count: Math.floor(weekly_cents / EST[type]) })
const inbound = (live, appt, over = {}) => ({
  configured: true, comped: false, billed: true, subscribed: true, mode: 'test',
  min_weekly_cents: MIN, presets: [10000, 20000, 30000, 40000, 60000, 80000], estimate_cents: EST,
  types: [row('live_call', 'Live Calls', ...live), row('booked_appointment', 'Booked Appointments', ...appt)],
  ...over,
})
const SCENARIOS = {
  empty: { get: inbound([0], [0]) },
  spending: { get: inbound([40000], [30000]) },
  paused: { get: inbound([40000], [30000, true]) },
  allpaused: { get: inbound([40000, true], [30000, true]) },
  error: { fail: 500, message: 'Couldn’t reach billing right now.' },
  notsub: { get: inbound([0], [0], { subscribed: false }), profile: { billing_status: 'none', billing_tier: null } },
  comped: { get: inbound([0], [0], { comped: true, billed: false, subscribed: false }), profile: { billing_exempt: true } },
  native: { get: inbound([40000], [30000]), native: true },
  notopen: { get: inbound([0], [0], { configured: false }) },
  locked: { get: inbound([0], [0], { subscribed: false }), profile: { billing_status: 'none', billing_tier: null }, enforced: true },
}

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, sc, log, opts = {}) {
  let state = sc.get
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/agent-billing')) {
      const body = JSON.parse(req.postData() || '{}')
      log.push(body)
      if (body.action === 'inbound_get') {
        if (opts.hold) await opts.hold
        if (sc.fail) return json(route, sc.fail, { error: sc.message })
        return json(route, 200, state)
      }
      if (body.action === 'inbound_set') {
        if (opts.setError) return json(route, opts.setError.status, { error: opts.setError.message })
        if (body.weekly_cents < state.min_weekly_cents) return json(route, 400, { error: 'The minimum is $100 a week.' })
        state = { ...state, types: state.types.map(t => (t.type === body.type ? row(t.type, t.label, body.weekly_cents, body.paused) : t)) }
        return json(route, 200, state)
      }
      return json(route, 200, { configured: true })
    }
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, { ...PROFILE, ...sc.profile })
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [USAGE])
    const table = path.replace('/rest/v1/', '')
    if (table === 'agent_billing_tiers') return rows(TIERS)
    if (table === 'app_settings') return rows([{ key: 'agent_billing_enforced', value: !!sc.enforced, agent_billing_enforced: !!sc.enforced }])
    return rows([])
  })
}

const BANNED = /\b(meta|google|facebook|balance|per lead|per call|per appointment|per booking)\b|—/i
const measure = page => page.evaluate(() => {
  const de = document.documentElement
  const small = [...document.querySelectorAll('.pv button, .ph-sheet button, .ov-drawer button, a.ov-ghost')]
    .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height < 44 })
    .map(b => `${b.textContent.trim() || b.getAttribute('aria-label')}:${Math.round(b.getBoundingClientRect().height)}`)
  return {
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, scrollHeight: de.scrollHeight, theme: de.getAttribute('data-theme'),
    text: document.body.innerText,
    controls: [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(t => /^(Start|Change|Pause|Resume|Save)\b/.test(t)),
    startCard: [...document.querySelectorAll('a.ov-ghost[href="/agent/inbounds"]')].map(a => a.textContent.trim()),
    small,
  }
})

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }

async function open(name, theme, w, path, opts = {}) {
  const sc = SCENARIOS[name]
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th, native]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
    if (native) window.webkit = { messageHandlers: { bridge: { postMessage() {} } } }
  }, [SESSION, theme, !!sc.native])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  const log = []
  await mock(page, sc, log, opts)
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
  return { ctx, page, log, errors }
}

async function record(page, log, errors, file, extra = {}) {
  await page.waitForTimeout(600)
  const { text, ...m } = await measure(page)
  await page.screenshot({ path: join(OUT, file), fullPage: !extra.viewport })
  results.push({ file, ...m, banned: text.match(BANNED)?.[0] ?? null, sets: log.filter(b => b.action === 'inbound_set'), gets: log.filter(b => b.action === 'inbound_get').length, pageErrors: errors, ...extra })
}

const READY = { empty: 'You’re not getting inbounds yet', spending: 'Your inbound spend', paused: 'Your inbound spend', allpaused: 'Your inbounds are paused', error: 'Couldn’t reach billing right now.', notsub: 'Start Policy Servicing first', comped: 'You’re not billed', native: 'Billing is managed on the Ohvara website.', notopen: 'Inbounds aren’t open yet', locked: 'Start Policy Servicing first' }

async function pageShot(name, theme, w) {
  const { ctx, page, log, errors } = await open(name, theme, w, '/agent/inbounds')
  await page.getByText(READY[name]).first().waitFor({ timeout: 45000 })
  await record(page, log, errors, `inbounds-${name}-${w}-${theme}.png`, { scenario: name, width: w })
  await ctx.close()
}

async function overviewShot(name, theme, w) {
  const { ctx, page, log, errors } = await open(name, theme, w, '/agent')
  await page.getByRole('button', { name: /book a call|submit/i }).first().waitFor({ timeout: 45000 })
  await page.waitForTimeout(800)
  await record(page, log, errors, `overview-${name}-${w}-${theme}.png`, { scenario: `overview-${name}`, width: w })
  await ctx.close()
}

// The entry into the page: a More row on a phone, a sidebar row on desktop. Neither in the phone app.
async function navShot(name, theme, w) {
  const { ctx, page, log, errors } = await open(name, theme, w, w === 390 ? '/agent/more' : '/settings')
  await page.getByText('Settings').first().waitFor({ timeout: 45000 })
  await page.waitForTimeout(800)
  const entry = w === 390 ? page.getByRole('button', { name: 'Inbounds' }) : page.locator('a[href="/agent/inbounds"]')
  await record(page, log, errors, `nav-${name}-${w}-${theme}.png`, { scenario: `nav-${name}`, width: w, navEntries: await entry.count() })
  await ctx.close()
}

async function loadingShot(theme, w) {
  let release
  const hold = new Promise(r => { release = r })
  const { ctx, page, log, errors } = await open('spending', theme, w, '/agent/inbounds', { hold })
  await page.locator('[aria-busy="true"]').first().waitFor({ timeout: 45000 })
  await record(page, log, errors, `inbounds-loading-${w}-${theme}.png`, { scenario: 'loading', width: w })
  release()
  await ctx.close()
}

// Where the Start buttons go: not subscribed to Billing, the Overview / Home card to the page. Comped never sends.
const pathAfter = async (page, name) => {
  await page.getByRole(name === 'Start card' ? 'link' : 'button', { name: 'Start', exact: true }).first().click()
  await page.waitForTimeout(500)
  return new URL(page.url()).pathname
}
async function linkChecks(w) {
  const out = {}
  {
    const { ctx, page } = await open('notsub', 'light', w, '/agent/inbounds')
    await page.getByText(READY.notsub).first().waitFor({ timeout: 45000 })
    out.notsubStart = await pathAfter(page, 'Start')
    await ctx.close()
  }
  {
    const { ctx, page } = await open('empty', 'light', w, '/agent')
    await page.locator('a.ov-ghost[href="/agent/inbounds"]').first().waitFor({ timeout: 45000 })
    out.cardStart = await pathAfter(page, 'Start card')
    await ctx.close()
  }
  console.log(`links-${w} ${JSON.stringify(out)}`)
  results.push({ file: `links-${w}`, ...out })
}

// Sheet flows: opens above the page, live line, below-minimum server message, a refused save, a good save, row pause.
async function sheetFlows(theme, w) {
  const tag = `${w}-${theme}`
  const dialog = page => page.locator('[role="dialog"]')
  {
    const { ctx, page, log, errors } = await open('spending', theme, w, '/agent/inbounds')
    await page.getByRole('button', { name: 'Change Live Calls' }).click()
    await dialog(page).waitFor()
    await page.waitForTimeout(450)
    const placed = await dialog(page).evaluate(el => {
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { parentIsBody: el.parentElement === document.body, onScreen: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.height > 0, onTop: el.contains(top) }
    })
    await page.getByRole('button', { name: '$600' }).click()
    const live = await dialog(page).getByRole('status').innerText()
    await record(page, log, errors, `sheet-change-${tag}.png`, { scenario: 'sheet-change', width: w, placed, live, viewport: true })
    await page.getByLabel('Or enter your own').fill('40')
    const below = await dialog(page).getByRole('status').innerText()
    const hint = await dialog(page).getByText('The minimum is').first().innerText()
    await record(page, log, errors, `sheet-below-min-${tag}.png`, { scenario: 'sheet-below-min', width: w, below, hint, viewport: true })
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await dialog(page).getByRole('alert').waitFor()
    const server = await dialog(page).getByRole('alert').innerText()
    await record(page, log, errors, `sheet-below-min-server-${tag}.png`, { scenario: 'sheet-below-min-server', width: w, server, viewport: true })
    await page.getByLabel('Or enter your own').fill('500')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await dialog(page).waitFor({ state: 'detached' })
    await page.getByText('$800').first().waitFor()
    await page.getByRole('button', { name: 'Pause Booked Appointments' }).click()
    await page.getByText('No new inbounds while paused').waitFor()
    await record(page, log, errors, `after-save-and-pause-${tag}.png`, { scenario: 'after-save-and-pause', width: w })
    await ctx.close()
  }
  {
    const { ctx, page, log, errors } = await open('spending', theme, w, '/agent/inbounds', { setError: { status: 403, message: 'Inbound spend is test mode only for now.' } })
    await page.getByRole('button', { name: 'Change Live Calls' }).click()
    await dialog(page).getByRole('button', { name: '$600' }).click()
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await dialog(page).getByRole('alert').waitFor()
    const server = await dialog(page).getByRole('alert').innerText()
    await record(page, log, errors, `sheet-refused-${tag}.png`, { scenario: 'sheet-refused', width: w, server, viewport: true })
    await ctx.close()
  }
  {
    const { ctx, page, log, errors } = await open('empty', theme, w, '/agent/inbounds')
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await dialog(page).waitFor()
    await page.waitForTimeout(450)
    await record(page, log, errors, `sheet-start-${tag}.png`, { scenario: 'sheet-start', width: w, viewport: true })
    await ctx.close()
  }
}

try {
  for (const name of ['empty', 'spending', 'paused', 'error', 'notsub', 'comped', 'native']) {
    for (const w of [1440, 390]) for (const theme of ['light', 'dark']) await pageShot(name, theme, w)
  }
  for (const name of ['allpaused', 'notopen', 'locked']) { await pageShot(name, 'light', 1440); await pageShot(name, 'dark', 390) }
  await pageShot('spending', 'light', 1920); await pageShot('spending', 'dark', 1920)
  await loadingShot('light', 1440); await loadingShot('dark', 390)
  for (const name of ['empty', 'spending', 'allpaused', 'comped', 'native']) {
    for (const w of [1440, 390]) await overviewShot(name, name === 'spending' ? 'dark' : 'light', w)
  }
  await overviewShot('empty', 'dark', 390); await overviewShot('empty', 'dark', 1440)
  for (const name of ['spending', 'native']) for (const w of [1440, 390]) await navShot(name, 'light', w)
  for (const w of [1440, 390]) for (const theme of ['light', 'dark']) await sheetFlows(theme, w)
  for (const w of [1440, 390]) await linkChecks(w)
} finally {
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(results, null, 2))
  await browser.close()
  await server.close()
}
for (const r of results.filter(x => x.controls)) {
  console.log(`${r.file.padEnd(46)} scroll=${r.scrollWidth}/${r.clientWidth} height=${r.scrollHeight} controls=${r.controls.length} card=${JSON.stringify(r.startCard)} gets=${r.gets} sets=${r.sets.length} small=${r.small.length} banned=${r.banned} err=${r.pageErrors.length}`)
}
