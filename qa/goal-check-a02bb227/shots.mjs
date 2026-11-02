// Lead detail page sample mode (/agent/inbounds/:id?sample=1): shots + checks with a mocked Supabase.
// Harness style from qa/goal-check-134a9cda/shots.mjs.   node qa/goal-check-a02bb227/shots.mjs [outDir]
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/goal-check-a02bb227'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = 5700 + Math.floor(Math.random() * 300)
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-02T18:00:00Z')
const REAL = { lead_id: 'a0000000-0000-4000-8000-000000000001', lead_type: 'inbound', inbound_product: 'booked_appointment', inbound_stage: 'new', outcome: null, contact_name: 'Real Person', phone: '(214) 555-0142', state: 'TX', created_at: NOW.toISOString(), delivered_at: NOW.toISOString() }

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(NOW.getTime() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'test.agent@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const PROFILE = { id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: TZ, is_active: true, billing_exempt: true, billing_status: 'active', billing_tier: 'standard', membership_tier: 'standard', has_servicing: true }

async function mock(page, state) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    return route.abort()
  })
  // The mock host has no realtime server: close the socket quietly so it is not counted as a page error.
  await page.routeWebSocket(/mock\.supabase\.co/, ws => { state.sockets += 1; ws.close() })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    state.requests.push({ method: req.method(), url: req.url(), body: req.postData() || '' })
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/functions/v1/')) return json(route, 200, { capabilities: {}, secrets: [] })
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'agent_inbounds') return json(route, 200, [REAL])
      if (name === 'agent_portal_access') return json(route, 200, { self: false, servicing: true, leads: true, unlocked: true })
      if (name === 'my_push_settings') return json(route, 200, { push_on: false })
      if (name === 'my_money_banner') return json(route, 200, null)
      return json(route, 200, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (table === 'app_settings') return json(route, 200, [{ id: 1, agent_portal_v2: false, agent_billing_enforced: false }])
      if (table === 'recovery_config') return json(route, 200, [{ id: 1, sms_live: false, voice_live: false, recording_live: false }])
      return json(route, 200, single ? null : [])
    }
    return json(route, 200, {})
  })
}

const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

async function open(w, theme) {
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
  const state = { requests: [], errors: [], consoleErrors: [], sockets: 0 }
  page.on('pageerror', e => state.errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') state.consoleErrors.push(m.text()) })
  await mock(page, state)
  return { ctx, page, state }
}
async function settle(page) {
  await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
}
const results = []
const log = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }
const carriesSample = state => state.requests.filter(r => /sample-inb/.test(decodeURIComponent(r.url)) || /sample-inb/.test(r.body)).map(r => `${r.method} ${r.url}`)
const MISSING = /This lead.s? isn.t here|This lead isn.t here/

// 1. Sample lead, both widths and themes.
for (const w of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    const { ctx, page, state } = await open(w, theme)
    await page.goto(`${base}/agent/inbounds/sample-inb-01?sample=1`)
    await page.waitForSelector('[aria-label="Timeline"]', { timeout: 20000 })
    await settle(page)
    const t = await page.evaluate(() => document.body.innerText)
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }))
    await page.screenshot({ path: join(OUT, `sample-${w}-${theme}.png`), fullPage: true })
    const sections = {}
    for (const s of ['Lead', 'Timeline', 'Outcome', 'Texts', 'Notes']) sections[s] = await page.locator(`section[aria-label="${s}"]`).count()
    const outBtns = await page.locator('section[aria-label="Outcome"] .pv-outs button').evaluateAll(bs => bs.map(b => `${b.textContent}:${b.disabled}`))
    const saveDisabled = await page.locator('button:has-text("Save note")').isDisabled()
    await page.locator('textarea[aria-label="New note"]').fill('typing a note')
    const saveStill = await page.locator('button:has-text("Save note")').isDisabled()
    const missingText = MISSING.test(t)
    const carries = carriesSample(state)
    log(`sample ${w} ${theme}`,
      t.includes('Nadia Brooks') && Object.values(sections).every(n => n === 1) && !missingText && m.sw <= m.w
        && state.errors.length === 0 && state.consoleErrors.length === 0 && outBtns.length === 3 && outBtns.every(b => b.endsWith(':true')) && saveDisabled && saveStill && carries.length === 0,
      `name=${t.includes('Nadia Brooks')} sections=${JSON.stringify(sections)} sw=${m.sw}/${m.w} outcomeBtns=${outBtns.join(',')} saveNoteDisabled=${saveDisabled}/${saveStill} sampleRequests=${carries.length} pageErrors=[${state.errors.join('|')}] consoleErrors=[${state.consoleErrors.join('|')}] requests=${state.requests.length}`)
    await ctx.close()
  }
}

// 2. Unknown id with ?sample=1, and the sample id without ?sample=1: both stay "This lead isn't here".
for (const [label, path] of [['not-real-sample', '/agent/inbounds/not-real?sample=1'], ['sample-id-no-flag', '/agent/inbounds/sample-inb-01']]) {
  for (const w of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const { ctx, page, state } = await open(w, theme)
      await page.goto(`${base}${path}`)
      await page.waitForSelector('text=/This lead isn.t here/', { timeout: 20000 })
      await settle(page)
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }))
      await page.screenshot({ path: join(OUT, `${label}-${w}-${theme}.png`), fullPage: true })
      const t = await page.evaluate(() => document.body.innerText)
      log(`${label} ${w} ${theme}`, !t.includes('Nadia Brooks') && m.sw <= m.w && state.errors.length === 0,
        `sw=${m.sw}/${m.w} pageErrors=[${state.errors.join('|')}] consoleErrors=[${state.consoleErrors.join('|')}]`)
      await ctx.close()
    }
  }
}
writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 2))
await browser.close()
await server.close()
process.exit(results.every(r => r.ok) ? 0 : 1)
