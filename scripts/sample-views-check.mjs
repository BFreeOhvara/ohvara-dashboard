// Browser check of /agent/leads and /agent/calendar with ?sample=1 (and &empty=1, &fail=1), every Supabase call mocked.
//   node scripts/sample-views-check.mjs [outDir]
// Runs the Vite dev server (import.meta.env.DEV is on, so the sample flags work) at 1920x1080, 1440x900 and 390,
// light and dark, on a fixed clock (Fri Oct 30, 12:10 PM Central). Writes PNGs and checks.json; exits 1 on a failed check.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/sample-views'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const BASE = Date.UTC(2026, 9, 30, 17, 10)
const iso = ms => new Date(ms).toISOString()
const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard',
}
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const session = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: iso(BASE - 1e11) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/my_push_settings') return json(route, 200, { push_on: false })
    const table = path.replace('/rest/v1/', '')
    if (table === 'app_settings') return json(route, 200, single ? { id: 1, agent_billing_enforced: false } : [{ id: 1, agent_billing_enforced: false }])
    return json(route, 200, single ? {} : [])
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const shots = []

const check = (name, ok, fail, extra) => { results.push({ name, pass: !!ok, ...(ok ? null : { fail }), ...extra }); if (!ok) console.error('FAIL', name, fail) }
const shot = async (page, name) => { const p = join(OUT, `${name}.png`); await page.screenshot({ path: p, fullPage: true }); shots.push(p.replace(/\\/g, '/')) }
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
const ERR_TEXT = /couldn.t load|something went wrong|\berror\b|undefined|\bNaN\b|\[object/i
const bodyText = page => page.evaluate(() => document.body.innerText)
const settle = async page => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900) }

async function open({ w, h, theme, path, query, phone }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([s, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
    localStorage.setItem('ohvara-theme', th)
  }, [session, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|wss:\/\/mock\.supabase\.co/.test(m.text())) errors.push(m.text()) })
  await page.clock.setFixedTime(BASE)
  await mock(page)
  await page.goto(`${base}${path}?${query}`, { waitUntil: 'domcontentloaded' })
  return { ctx, page, errors }
}

async function noErrorText(page, errors) {
  const t = await bodyText(page)
  return { ok: !ERR_TEXT.test(t) && errors.length === 0, why: `${ERR_TEXT.exec(t)} ${errors.join(' | ')}` }
}

try {
  for (const theme of ['light', 'dark']) {
    for (const [w, h, phone] of [[1920, 1080, false], [1440, 900, false], [390, 844, true]]) {
      const tag = `${w}-${theme}`
      const common = { w, h, theme, phone }

      // Inbounds, booked tab
      let { ctx, page, errors } = await open({ ...common, path: '/agent/leads', query: 'sample=1' })
      await page.waitForSelector('.pv-icard', { timeout: 60000 }); await settle(page)
      const cols = await page.$$eval('.inb-col', els => els.map(e => ({ title: e.querySelector('b')?.textContent?.trim(), cards: e.querySelectorAll('.pv-icard').length })))
      check(`${tag} inbounds booked: 5 stage columns, a card in each`, cols.length === 5 && cols.every(c => c.cards >= 1), JSON.stringify(cols), { cols })
      check(`${tag} inbounds booked: no Start banner when filled`, !(await page.$('.inb-start')), 'banner shown with data')
      let ne = await noErrorText(page, errors)
      check(`${tag} inbounds booked: no error text`, ne.ok, ne.why)
      check(`${tag} inbounds booked: no sideways scroll`, (await sideways(page)) <= 0, `sideways ${await sideways(page)}`)
      await shot(page, `inbounds-booked-${tag}`)
      await ctx.close()

      // Inbounds, live calls
      ;({ ctx, page, errors } = await open({ ...common, path: '/agent/leads', query: 'sample=1&tab=live' }))
      await page.waitForSelector('.pv-log-row', { timeout: 60000 }); await settle(page)
      const rows = await page.$$eval('.pv-log-row', els => els.length)
      check(`${tag} inbounds live: at least 5 rows`, rows >= 5, `${rows} rows`, { rows })
      ne = await noErrorText(page, errors)
      check(`${tag} inbounds live: no error text`, ne.ok, ne.why)
      check(`${tag} inbounds live: no sideways scroll`, (await sideways(page)) <= 0, `sideways ${await sideways(page)}`)
      await shot(page, `inbounds-live-${tag}`)
      await ctx.close()

      // Inbounds, empty
      ;({ ctx, page, errors } = await open({ ...common, path: '/agent/leads', query: 'sample=1&empty=1' }))
      await page.waitForSelector('.inb-start', { timeout: 60000 }); await settle(page)
      const start = await page.$eval('.inb-start', el => ({ text: el.innerText, href: el.querySelector('a')?.getAttribute('href') }))
      check(`${tag} inbounds empty: Start banner with a Start link`, /not getting leads yet/.test(start.text) && /Start/.test(start.text) && !!start.href, JSON.stringify(start), { start })
      check(`${tag} inbounds empty: no sideways scroll, no page errors`, (await sideways(page)) <= 0 && errors.length === 0, `${await sideways(page)} ${errors.join(' | ')}`)
      await shot(page, `inbounds-empty-${tag}`)
      await ctx.close()

      // Inbounds, fail (the error card is the expected text here)
      ;({ ctx, page, errors } = await open({ ...common, path: '/agent/leads', query: 'sample=1&fail=1' }))
      await page.getByRole('button', { name: 'Try again' }).first().waitFor({ timeout: 60000 }); await settle(page)
      check(`${tag} inbounds fail: error card with Try again`, true)
      check(`${tag} inbounds fail: no sideways scroll, no page errors`, (await sideways(page)) <= 0 && errors.length === 0, `${await sideways(page)} ${errors.join(' | ')}`)
      await shot(page, `inbounds-fail-${tag}`)
      await page.getByRole('button', { name: 'Try again' }).first().click()
      await page.waitForSelector('.pv-icard', { timeout: 15000 })
      check(`${tag} inbounds fail: Try again recovers`, true)
      await ctx.close()

      // Calendar, sample
      ;({ ctx, page, errors } = await open({ ...common, path: '/agent/calendar', query: 'sample=1' }))
      await page.waitForSelector('.cal-page', { timeout: 60000 }); await settle(page)
      if (!phone) {
        await page.waitForSelector('.cal-ev', { timeout: 30000 })
        const blocks = await page.$$eval('.cal-ev', els => els.map(e => e.style.gridColumn))
        check(`${tag} calendar week: >=6 blocks over >=4 days`, blocks.length >= 6 && new Set(blocks).size >= 4, `${blocks.length} blocks over ${new Set(blocks).size} days`, { blocks: blocks.length, days: new Set(blocks).size })
        check(`${tag} calendar week: today highlighted`, await page.$('.cal-wk-dh.today'), 'no .today header')
        check(`${tag} calendar week: now line`, await page.$('.cal-wk-now'), 'no now line')
        ne = await noErrorText(page, errors)
        check(`${tag} calendar week: no error text`, ne.ok, ne.why)
        await shot(page, `calendar-week-${tag}`)
        await page.getByRole('button', { name: /Elena Marsh/ }).first().click()
        await page.waitForSelector('.cal-panel')
        const panel = await page.$eval('.cal-panel', el => el.innerText)
        check(`${tag} calendar panel: opens with the appointment`, /Elena Marsh/.test(panel) && /Your time/.test(panel), panel, { panel })
        await shot(page, `calendar-panel-${tag}`)
        await page.locator('.cal-wk-dh.today').click()
        await page.waitForSelector('.cal-dg')
        const day = await page.evaluate(() => ({ cards: document.querySelectorAll('.cal-dv').length, label: document.querySelector('.cal-range').innerText }))
        check(`${tag} calendar day view: opens on today with cards`, day.cards >= 4 && /Friday, Oct 30/.test(day.label), JSON.stringify(day), day)
        ne = await noErrorText(page, errors)
        check(`${tag} calendar day view: no error text`, ne.ok, ne.why)
        await shot(page, `calendar-day-${tag}`)
      } else {
        await page.waitForSelector('.cal-agr', { timeout: 30000 })
        const ph = await page.evaluate(() => ({ rows: document.querySelectorAll('.cal-agr').length }))
        check(`${tag} calendar agenda: rows shown`, ph.rows >= 1, JSON.stringify(ph), ph)
        ne = await noErrorText(page, errors)
        check(`${tag} calendar agenda: no error text`, ne.ok, ne.why)
        await shot(page, `calendar-agenda-${tag}`)
      }
      check(`${tag} calendar sample: no sideways scroll`, (await sideways(page)) <= 0, `sideways ${await sideways(page)}`)
      await ctx.close()

      // Calendar, empty
      ;({ ctx, page, errors } = await open({ ...common, path: '/agent/calendar', query: 'sample=1&empty=1' }))
      await page.waitForSelector('.cal-msg', { state: 'attached', timeout: 60000 }); await settle(page)
      const emp = await page.evaluate(() => [...document.querySelectorAll('.cal-msg')].find(e => e.getClientRects().length)?.innerText || '')
      check(`${tag} calendar empty: explains and offers Book a call`, /Nothing booked this week/.test(emp) && /Book a call/.test(emp), emp, { emp })
      check(`${tag} calendar empty: no sideways scroll, no page errors`, (await sideways(page)) <= 0 && errors.length === 0, `${await sideways(page)} ${errors.join(' | ')}`)
      await shot(page, `calendar-empty-${tag}`)
      await ctx.close()

      // Calendar, fail
      ;({ ctx, page, errors } = await open({ ...common, path: '/agent/calendar', query: 'sample=1&fail=1' }))
      await page.getByRole('button', { name: 'Try again' }).first().waitFor({ timeout: 60000 }); await settle(page)
      check(`${tag} calendar fail: error card with Try again`, true)
      check(`${tag} calendar fail: no sideways scroll, no page errors`, (await sideways(page)) <= 0 && errors.length === 0, `${await sideways(page)} ${errors.join(' | ')}`)
      await shot(page, `calendar-fail-${tag}`)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 2))
writeFileSync(join(OUT, 'screenshots.txt'), shots.join('\n') + '\n')
const bad = results.filter(r => !r.pass)
console.log(`${results.length - bad.length}/${results.length} checks passed, ${shots.length} screenshots in ${OUT}`)
process.exit(bad.length ? 1 : 0)
