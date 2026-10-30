// Inbounds page (served at /agent/leads) shots and checks, every Supabase call mocked (no real project, no
// login, no live data).
//   node scripts/inbounds-shots.mjs [outDir]      (or: npm run shots:inbounds)
// Opens /agent/leads?sample=1 (and &empty=1, &fail=1, tab=live) on the dev server at 1920x1080, 1440x900 and
// 390, light and dark, plus the production-like paths (no ?sample): the empty "not getting inbounds yet" state,
// one lone inbound with explained empty columns, and the old /agent/inbounds URLs forwarding with their query
// string. Writes PNGs and checks.json into outDir and exits 1 on any failed check.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/inbounds-page'
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

async function mock(page, leads) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/agent_inbounds') return json(route, 200, leads)
    const table = path.replace('/rest/v1/', '')
    if (table === 'app_settings') return json(route, 200, single ? { id: 1, agent_billing_enforced: false } : [{ id: 1, agent_billing_enforced: false }])
    return json(route, 200, single ? {} : [])
  })
}

// One real-shaped inbound (not the fixture): every other stage on the board stays empty.
const LONE = [{
  lead_id: '22222222-2222-4222-8222-222222222222', lead_type: 'mortgage_protection', inbound_product: 'booked_appointment',
  inbound_stage: 'new', outcome: null, outcome_at: null, live_call_result: null, contact_name: 'Test Person', phone: '(555) 010-0199',
  city: null, state: null, delivered_at: iso(BASE - 20 * 6e4), created_at: iso(BASE - 20 * 6e4),
}]

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []

async function open({ w, h, theme, path = '/agent/leads', query = 'sample=1', phone = false, leads = [], wait = '.inb-page' }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([s, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
    localStorage.setItem('ohvara-theme', th)
  }, [session, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.setFixedTime(BASE)
  await mock(page, leads)
  await page.goto(`${base}${path}${query ? `?${query}` : ''}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(wait, { timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
  return { ctx, page, errors }
}

const check = (name, ok, fail, extra) => { results.push({ name, pass: !!ok, ...(ok ? null : { fail }), ...extra }); if (!ok) console.error('FAIL', name, fail) }
const shot = (page, name, full) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: !!full })
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
const cols = page => page.$$eval('.inb-col', els => els.map(e => ({
  title: e.querySelector('.pv-col-head b')?.innerText, cards: e.querySelectorAll('.inb-card').length, empty: e.querySelector('.inb-col-empty')?.innerText || null,
})))

try {
  // The old URLs forward with the query string.
  {
    const a = await open({ w: 1440, h: 900, theme: 'light', path: '/agent/inbounds', query: 'tab=live&sample=1&x=1' })
    const u = new URL(a.page.url())
    check('/agent/inbounds forwards with its query string', u.pathname === '/agent/leads' && u.search === '?tab=live&sample=1&x=1', a.page.url())
    await a.ctx.close()
    const b = await open({ w: 1440, h: 900, theme: 'light', path: '/agent/inbounds/abc-123', query: 'x=1', wait: 'body' })
    await b.page.waitForURL(/\/agent\/leads\/abc-123/, { timeout: 15000 })
    const v = new URL(b.page.url())
    check('/agent/inbounds/:id forwards with its query string', v.pathname === '/agent/leads/abc-123' && v.search === '?x=1', b.page.url())
    await b.ctx.close()
  }
  for (const theme of ['light', 'dark']) {
    for (const [w, h, phone] of [[1920, 1080, false], [1440, 900, false], [390, 844, true]]) {
      const tag = `${w}-${theme}`
      // Board with the dev sample: a card in every column
      let { ctx, page, errors } = await open({ w, h, theme, phone })
      await page.waitForSelector('.inb-card', { timeout: 30000 })
      const c = await cols(page)
      check(`${tag} board: five stage columns, a card in every one`, c.length === 5 && c.every(x => x.cards >= 1), JSON.stringify(c), { cols: c })
      check(`${tag} board: no sideways scroll`, (await sideways(page)) <= 0, 'sideways scroll')
      const slot = await page.evaluate(() => ({ start: !!document.querySelector('.inb-start'), tabs: document.querySelectorAll('.inb-tab').length }))
      check(`${tag} board: no Start state when there are inbounds`, !slot.start && slot.tabs === 2, JSON.stringify(slot))
      const hd = await page.evaluate(() => ({
        text: document.body.innerText, h: [...document.querySelectorAll('h1')].map(e => e.innerText.trim()).filter(Boolean),
        page: document.querySelector('.inb-page')?.innerText || '',
      }))
      check(`${tag} header: page title Leads (and on desktop its subtitle) is in the top bar`, hd.h.includes('Leads') && (phone || /Everyone who came in for you/.test(hd.text)), JSON.stringify(hd.h), { h1: hd.h })
      check(`${tag} wording: the word "inbound" is not on the page`, !/inbound/i.test(hd.page), (hd.page.match(/.{0,30}inbound.{0,30}/i) || [''])[0])
      await shot(page, `board-${tag}`, phone)
      check(`${tag} page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
      // Live calls: at least 5 rows
      ;({ ctx, page, errors } = await open({ w, h, theme, phone, query: 'sample=1&tab=live' }))
      await page.waitForSelector('.pv-log-row', { timeout: 30000 })
      const rows = await page.$$eval('.pv-log-row', els => els.length)
      check(`${tag} live: at least 5 rows`, rows >= 5, `${rows} rows`, { rows })
      check(`${tag} live: no sideways scroll`, (await sideways(page)) <= 0, 'sideways scroll')
      await shot(page, `live-${tag}`, phone)
      await ctx.close()
      // Sample, no inbounds: "You're not getting inbounds yet" with Start
      ;({ ctx, page, errors } = await open({ w, h, theme, phone, query: 'sample=1&empty=1', wait: '.inb-start' }))
      const st = await page.evaluate(() => ({
        h: document.querySelector('.inb-start h2')?.innerText, to: document.querySelector('.inb-start a')?.getAttribute('href'),
        label: document.querySelector('.inb-start a')?.innerText.trim(), open: document.querySelector('.inb-explain')?.open,
      }))
      check(`${tag} empty: not-getting-inbounds state with Start`, /not getting leads yet/.test(st.h) && st.label === 'Start' && st.to === '/agent/billing' && st.open === true, JSON.stringify(st), st)
      check(`${tag} empty: header title kept, no "inbound" wording`, (await page.evaluate(() => [...document.querySelectorAll('h1')].some(e => e.innerText.trim() === 'Leads'))) && !/inbound/i.test(await page.evaluate(() => document.querySelector('.inb-page').innerText)), 'header missing or inbound wording')
      check(`${tag} empty: no sideways scroll`, (await sideways(page)) <= 0, 'sideways scroll')
      await shot(page, `empty-${tag}`, phone)
      await ctx.close()
      // Production-like path (no ?sample): the same empty state, then one lone inbound with explained empty stages
      ;({ ctx, page, errors } = await open({ w, h, theme, phone, query: '', wait: '.inb-start' }))
      check(`${tag} real, no inbounds: Start state and no fixture`, !(await page.$('.inb-card')), 'a card is on the page')
      await ctx.close()
      ;({ ctx, page, errors } = await open({ w, h, theme, phone, query: '', leads: LONE, wait: '.inb-card' }))
      const cl = await cols(page)
      const empties = cl.filter(x => !x.cards)
      check(`${tag} real, one inbound: four empty stages each explain themselves`,
        cl.length === 5 && empties.length === 4 && empties.every(x => x.empty && x.empty.split('\n').filter(Boolean).length >= 2), JSON.stringify(cl), { cols: cl })
      check(`${tag} real, one inbound: no sideways scroll`, (await sideways(page)) <= 0, 'sideways scroll')
      await shot(page, `empty-stages-${tag}`, phone)
      check(`${tag} real: page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
      // Error
      ;({ ctx, page, errors } = await open({ w, h, theme, phone, query: 'sample=1&fail=1' }))
      check(`${tag} fail: error card with Try again, no sideways scroll`, (await page.$('button:has-text("Try again")')) && (await sideways(page)) <= 0, 'no error card or sideways scroll')
      await shot(page, `fail-${tag}`, phone)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 2))
const bad = results.filter(r => !r.pass)
console.log(`${results.length - bad.length}/${results.length} checks passed`)
process.exit(bad.length ? 1 : 0)
