// SCRATCH (not committed): screenshots + checks for My Pipeline Clients vs In progress, Supabase fully mocked.
//   node scripts/_pl-shots.mjs <group> <outDir>     group = agent | urls | inter | other
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const GROUP = process.argv[2] || 'agent'
const OUT = process.argv[3] || 'qa/goal-check-a959442c'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = 5700 + Math.floor(Math.random() * 300)
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-30T15:07:00Z') // Fri Oct 30, 10:07 AM Chicago
const iso = (days, h = 12, m = 0) => new Date(Date.UTC(2026, 9, 30 + days, h + 5, m)).toISOString()

const NAMES = {
  booked: [['Omar', 'Haddad', 'Tulsa', 'OK', 'Mutual of Omaha'], ['Helen', 'Park', 'Hendersonville', 'NC', 'Globe Life'], ['Alicia', 'Moreno', 'Tucson', 'AZ', 'Aetna'], ['Robert', 'Ellis', 'Mobile', 'AL', 'Transamerica'], ['Maria', 'Santos', 'Pensacola', 'FL', 'State Farm'], ['Teresa', 'Wynn', 'Evansville', 'IN', 'Allstate'], ['Linda', 'Brooks', 'Austin', 'TX', 'Prudential'], ['Greg', 'Olson', 'Dayton', 'OH', 'Aetna']],
  noAnswer: [['Earl', 'Tucker', 'Macon', 'GA', 'Allstate'], ['Nina', 'Patel', 'Fresno', 'CA', 'Globe Life'], ['Frank', 'Dorsey', 'Akron', 'OH', 'State Farm']],
  confirm: [['Ruth', 'Bell', 'Boise', 'ID', 'Prudential'], ['Calvin', 'Moss', 'Reno', 'NV', 'Transamerica']],
  call: [['Diane', 'Foster', 'Salem', 'OR', 'Aetna']],
  cancelled: [['Janet', 'Cole', 'Tampa', 'FL', 'Globe Life'], ['Victor', 'Nguyen', 'Plano', 'TX', 'State Farm'], ['Paula', 'Reyes', 'Mesa', 'AZ', 'Mutual of Omaha'], ['Darnell', 'Price', 'Mobile', 'AL', 'Allstate'], ['Sandra', 'Kim', 'Raleigh', 'NC', 'Aetna'], ['Walter', 'Hayes', 'Dayton', 'OH', 'Transamerica']],
}
const POLNUM = { 2: 'HX-4471-82', 9: 'AB 90017-3', 14: 'hx-5520-11' }
let seq = 0
const mk = (kind, [f, l, city, st, car], o = {}) => {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, agent_id: AGENT, agent: { id: AGENT, full_name: 'Test agent' }, assigned: null,
    client_first_name: f, client_last_name: l, client_phone: `(555) 010-${String(2000 + seq * 37).slice(0, 4)}`, state: st, client_city: city, client_timezone: TZ,
    carrier_id: null, carrier_name: car, details: { current_carrier: car }, fulfillment_assigned: true, policy_number: POLNUM[seq] || null, fulfillment_stage: kind === 'cancelled' ? 'Complete' : 'Assigned',
    scheduled_call_at: null, call_live_since: null, last_call_outcome: null, call_attempts: 0, last_call_at: null, recovery_step: null,
    recovery_retry_at: null, created_at: iso(-3 - seq % 9, 9, 5), updated_at: iso(-1), fulfillment_completed_at: null, ...o,
  }
}
const ROWS = []
NAMES.booked.forEach((n, i) => ROWS.push(mk('booked', n, { scheduled_call_at: iso(i < 3 ? 0 : i, [9, 11, 14, 10, 9, 13, 11, 16][i], i === 0 ? 30 : 0), call_live_since: i === 0 ? iso(0, 9, 30) : null })))
NAMES.noAnswer.forEach((n, i) => ROWS.push(mk('na', n, { last_call_outcome: 'no_answer', call_attempts: 2 - (i === 2 ? 1 : 0), last_call_at: iso(-1 - i), scheduled_call_at: iso(-1), recovery_step: ['retry_locked', 'followup', null][i], recovery_retry_at: iso(3, 10) })))
NAMES.confirm.forEach(n => ROWS.push(mk('confirm', n, { last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: iso(-1), recovery_step: 'number_check' })))
NAMES.call.forEach(n => ROWS.push(mk('call', n, { last_call_outcome: 'no_answer', call_attempts: 3, last_call_at: iso(-2), recovery_step: 'call_directly' })))
NAMES.cancelled.forEach((n, i) => ROWS.push(mk('cancelled', n, { last_call_outcome: 'answered', call_attempts: 1, last_call_at: iso(-2 - i * 3), fulfillment_completed_at: iso(-2 - i * 3, 15), created_at: iso(-9 - i * 3) })))
const ID = { booked: ROWS[1].id, live: ROWS[0].id, needs: ROWS[13].id, confirm: ROWS[11].id, noAnswer: ROWS[8].id, cancelled: ROWS[14].id, cancelledOld: ROWS[19].id }

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'test.agent@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const profile = role => ({
  id: AGENT, role, full_name: role === 'admin' ? 'Admin' : role === 'fulfillment' ? 'Fulfillment rep' : 'Test agent', email: 'test.agent@example.com', timezone: TZ, is_active: true,
  billing_exempt: true, billing_status: 'active', billing_tier: 'standard', membership_tier: 'standard',
})

async function mock(page, o, state) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile(o.role || 'agent'))
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/functions/v1/')) return json(route, 200, { capabilities: {}, secrets: [] })
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'my_push_settings') return json(route, 200, { push_on: false })
      if (name === 'my_money_banner') return json(route, 200, null)
      return json(route, 200, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (req.method() !== 'GET') { state.writes.push(`${req.method()} ${table}`); return json(route, 200, []) }
      if (table === 'policies') {
        if (o.fail) return json(route, 500, { message: 'mock failure' })
        const mine = o.role === 'fulfillment' ? state.rows.map(r => ({ ...r, assigned_fulfillment_id: AGENT, assigned: { id: AGENT, full_name: 'Fulfillment rep' } })) : state.rows
        return rows(o.empty ? [] : mine)
      }
      if (table === 'app_settings') return rows([{ id: 1, agent_portal_v2: false, agent_billing_enforced: false }])
      if (table === 'recovery_config') return rows([{ id: 1, sms_live: false, voice_live: false, recording_live: false }])
      return json(route, 200, single ? null : [])
    }
    return json(route, 200, {})
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
console.log('listen');await server.listen();console.log('listening')
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

async function open(w, theme, o = {}) {
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
  const state = { rows: structuredClone(ROWS), writes: [], errors: [] }
  page.on('pageerror', e => state.errors.push(String(e)))
  await mock(page, o, state)
  return { ctx, page, state }
}
async function ready(page, sel) {
  await page.waitForSelector(sel, { timeout: 20000 })
  await page.waitForFunction(() => !/Loading (clients|your clients)/.test(document.body.innerText), null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}
const SEL = w => (w === 390 ? '.ph-h1' : '.pl-page')
// What the page shows: side, tab, counts, list text.
const read = page => page.evaluate(() => {
  const on = [...document.querySelectorAll('.pl-seg button.is-on')].map(b => b.innerText.replace(/\s+/g, ' ').trim())
  const sel = document.querySelector('.pl-tab.is-sel .nm')?.innerText || null
  const phoneOn = [...document.querySelectorAll('.ph-seg-btn.is-on .ph-seg-label')].map(e => e.innerText)
  const groups = [...document.querySelectorAll('.ph-group-label')].map(e => e.innerText.replace(/\s+/g, ' ').trim())
  const rows = document.querySelectorAll('.pl-row').length + document.querySelectorAll('.ph-row').length
  return {
    side: on[0] || null, tab: sel, phoneFilter: phoneOn, groups, rows, drawer: !!document.querySelector('[role="dialog"]'),
    total: document.querySelector('.pl-total')?.innerText.replace(/\s+/g, ' ') || null,
    sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, h: window.innerHeight,
  }
})
const results = []
const log = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) })
const measure = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }))
const flat = a => a.map(s => s.replace(/\s+/g, ' ').trim())

for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) {
  const tag = `${w}-${theme}`
  {
    const { ctx, page, state } = await open(w, theme)
    await page.goto(base + '/agent/clients?stage=cancelled'); await ready(page, SEL(w))
    const m = await measure(page)
    await shot(page, `clients-${tag}`)
    log(`clients ${tag}`, m.sw <= m.w && state.errors.length === 0, `sw=${m.sw}/${m.w} errors=${state.errors.join('|')}`)
    await ctx.close()
  }
  if (w !== 390) {
    {
      const { ctx, page, state } = await open(w, theme)
      await page.goto(base + '/agent/clients?stage=cancelled'); await ready(page, SEL(w))
      const box = page.locator('input[aria-label="Find a client"]')
      if (await box.count()) {
        await box.fill('HX 4471'); await page.waitForTimeout(400)
        const rows = flat(await page.locator('.cv2-row').allInnerTexts())
        const ph = await box.getAttribute('placeholder')
        await shot(page, `clients-card-search-${tag}`)
        log(`clients card policy search ${tag}`, rows.length === 1 && /Helen Park/.test(rows[0]) && state.errors.length === 0, `placeholder="${ph}" rows=${JSON.stringify(rows)}`)
      } else log(`clients card policy search ${tag}`, false, 'Find a client box not on page')
      await ctx.close()
    }
    {
      const { ctx, page, state } = await open(w, theme)
      await page.goto(base + '/agent/clients'); await ready(page, SEL(w))
      await page.keyboard.press('/')
      await page.keyboard.type('hx-5520')
      await page.waitForSelector('[role="option"]', { timeout: 8000 }).catch(() => {})
      const opts = flat(await page.locator('[role="option"]').allInnerTexts())
      const ph = await page.locator('input[aria-label="Find any client"]').getAttribute('placeholder')
      await shot(page, `header-search-${tag}`)
      log(`header search policy ${tag}`, opts.length === 1 && /Diane Foster/.test(opts[0]) && state.errors.length === 0, `placeholder="${ph}" options=${JSON.stringify(opts)}`)
      await ctx.close()
    }
  } else {
    const { ctx, page, state } = await open(390, theme)
    await page.goto(base + '/agent/clients'); await ready(page, SEL(390))
    const inp = page.locator('.ph-search input')
    await inp.fill('ab 90017'); await page.waitForTimeout(400)
    const rows = flat(await page.locator('.ph-row').allInnerTexts())
    const m = await measure(page)
    const ph = await inp.getAttribute('placeholder')
    await shot(page, `phone-search-${tag}`)
    log(`phone search policy ${tag}`, rows.length === 1 && /Earl Tucker/.test(rows[0]) && m.sw <= m.w && state.errors.length === 0, `placeholder="${ph}" rows=${JSON.stringify(rows)} sw=${m.sw}/${m.w}`)
    await ctx.close()
  }
}

await browser.close()
await server.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
