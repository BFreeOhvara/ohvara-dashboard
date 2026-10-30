// Calendar page shots and checks, every Supabase call mocked (no real project, no login, no live data).
//   node scripts/calendar-shots.mjs [outDir]
// Opens /agent/calendar?sample=1 (and &empty=1, &fail=1) on the dev server at 1920x1080, 1440x900 and 390,
// light and dark, on a fixed clock (Fri Oct 30, 12:10 PM Central). Writes PNGs and checks.json into outDir
// and exits 1 on any failed check.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/calendar-page'
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

async function open({ w, h, theme, query = 'sample=1', phone = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([s, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
    localStorage.setItem('ohvara-theme', th)
  }, [session, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.setFixedTime(BASE)
  await mock(page)
  await page.goto(`${base}/agent/calendar?${query}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.cal-page', { timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
  return { ctx, page, errors }
}

const check = (name, ok, fail, extra) => { results.push({ name, pass: !!ok, ...(ok ? null : { fail }), ...extra }); if (!ok) console.error('FAIL', name, fail) }
const shot = (page, name, full) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: !!full })
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

try {
  for (const theme of ['light', 'dark']) {
    for (const [w, h] of [[1920, 1080], [1440, 900]]) {
      const tag = `${w}x${h}-${theme}`
      // Week, filled
      let { ctx, page, errors } = await open({ w, h, theme })
      await page.waitForSelector('.cal-ev', { timeout: 30000 })
      const blocks = await page.$$eval('.cal-ev', els => els.map(e => e.style.gridColumn))
      check(`${tag} week: blocks`, blocks.length >= 6 && new Set(blocks).size >= 4, `${blocks.length} blocks over ${new Set(blocks).size} days`, { blocks: blocks.length, days: new Set(blocks).size })
      check(`${tag} week: today highlighted`, await page.$('.cal-wk-dh.today'), 'no .today header')
      check(`${tag} week: now marker`, await page.$('.cal-wk-now'), 'no now line')
      const fit = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }))
      check(`${tag} week: fits the screen`, fit.sh <= fit.ih + 1, `page ${fit.sh} > viewport ${fit.ih}`, fit)
      const clip = await page.evaluate(() => { const r = document.querySelector('.cal-main').getBoundingClientRect(); return { bottom: Math.round(r.bottom), ih: innerHeight } })
      check(`${tag} week: grid inside viewport`, clip.bottom <= clip.ih + 1, `bottom ${clip.bottom} > ${clip.ih}`, clip)
      check(`${tag} week: no sideways scroll`, (await sideways(page)) <= 0, 'sideways scroll')
      await shot(page, `calendar-week-${tag}`)
      // Panel: an inbound appointment
      await page.getByRole('button', { name: /Elena Marsh/ }).first().click()
      await page.waitForSelector('.cal-panel')
      const panel = await page.$eval('.cal-panel', el => ({
        text: el.innerText, tel: el.querySelector('a[href^="tel:"]')?.getAttribute('href'), sms: el.querySelector('a[href^="sms:"]')?.getAttribute('href'),
        links: [...el.querySelectorAll('a')].map(a => a.textContent.trim()),
      }))
      check(`${tag} panel: name, phone, state, stage, both zones`,
        /Elena Marsh/.test(panel.text) && /\(555\) 010-0148/.test(panel.text) && /Ohio/.test(panel.text) && /Booked/.test(panel.text) && /Your time/.test(panel.text) && /Their time/.test(panel.text),
        panel.text, { text: panel.text })
      check(`${tag} panel: tel and sms links`, panel.tel === 'tel:+15550100148' && panel.sms === 'sms:+15550100148', JSON.stringify(panel))
      check(`${tag} panel: no Reschedule on an inbound`, !panel.links.includes('Reschedule') && panel.links.includes('Open lead'), JSON.stringify(panel.links))
      const fitP = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }))
      check(`${tag} panel: still fits`, fitP.sh <= fitP.ih + 1, JSON.stringify(fitP))
      await shot(page, `calendar-panel-inbound-${tag}`)
      // Panel: a booked call (Reschedule), and the live call
      await page.getByRole('button', { name: /Kevin Duarte/ }).first().click()
      const kev = await page.$eval('.cal-panel', el => [...el.querySelectorAll('a')].map(a => [a.textContent.trim(), a.getAttribute('href')]))
      check(`${tag} panel: Reschedule links to the existing change flow`, kev.some(([t, href]) => t === 'Reschedule' && /^\/agent\/book\?change=sample-booking-/.test(href)), JSON.stringify(kev))
      await page.getByRole('button', { name: /Helen Park/ }).first().click()
      const live = await page.$eval('.cal-panel', el => ({ badge: !!el.querySelector('.cal-live'), links: [...el.querySelectorAll('a')].map(a => a.textContent.trim()) }))
      check(`${tag} panel: live badge, no Reschedule`, live.badge && !live.links.includes('Reschedule'), JSON.stringify(live))
      await shot(page, `calendar-panel-live-${tag}`)
      // Day view from a day header; prev / next / today
      await page.locator('.cal-wk-dh.today').click()
      await page.waitForSelector('.cal-dg')
      const day = await page.evaluate(() => ({ open: document.querySelectorAll('.cal-dg-o').length, cards: document.querySelectorAll('.cal-dv').length, label: document.querySelector('.cal-range').innerText }))
      check(`${tag} day: opens from a day header with quiet Open rows`, day.cards >= 4 && day.open > 0 && /Friday, Oct 30/.test(day.label), JSON.stringify(day), day)
      await shot(page, `calendar-day-${tag}`)
      await page.getByRole('button', { name: 'Next day' }).click()
      await page.getByRole('button', { name: 'Next day' }).click()
      await page.waitForSelector('.cal-dg')
      const sun = await page.evaluate(() => ({ msg: document.querySelector('.cal-msg h3')?.innerText, label: document.querySelector('.cal-range').innerText }))
      check(`${tag} day: empty Sunday explains`, /Nothing booked on Sunday/.test(sun.msg || ''), JSON.stringify(sun), sun)
      await shot(page, `calendar-day-empty-${tag}`)
      await page.getByRole('button', { name: 'Today', exact: true }).click()
      await page.getByRole('button', { name: 'Week', exact: true }).click()
      await page.getByRole('button', { name: 'Next week' }).click()
      const nw = await page.evaluate(() => document.querySelector('.cal-range').innerText)
      await page.getByRole('button', { name: 'Previous week' }).click()
      const pw = await page.evaluate(() => document.querySelector('.cal-range').innerText)
      check(`${tag} week: next and previous`, /Nov 2/.test(nw) && /Oct 26/.test(pw), `${nw} / ${pw}`)
      check(`${tag} page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
      // Empty week
      ;({ ctx, page, errors } = await open({ w, h, theme, query: 'sample=1&empty=1' }))
      const emp = await page.evaluate(() => ({
        h3: document.querySelector('.cal-msg h3')?.innerText, cta: document.querySelector('.cal-msg a.cal-cta')?.getAttribute('href'), text: document.querySelector('.cal-msg p')?.innerText,
      }))
      check(`${tag} empty: explains and links to Book a call`, emp.h3 === 'Nothing booked this week' && emp.cta === '/agent/book' && /Booked calls and leads that book on your calendar show up here\./.test(emp.text), JSON.stringify(emp), emp)
      await shot(page, `calendar-empty-${tag}`)
      await ctx.close()
      // Error
      ;({ ctx, page, errors } = await open({ w, h, theme, query: 'sample=1&fail=1' }))
      check(`${tag} fail: error card with Try again`, await page.$('.cal-msg[role="alert"] button'), 'no error card')
      await shot(page, `calendar-fail-${tag}`)
      await page.getByRole('button', { name: 'Try again' }).first().click()
      await page.waitForSelector('.cal-ev', { timeout: 15000 })
      check(`${tag} fail: Try again recovers`, true)
      await ctx.close()
      // Loading skeleton: read while the sample module is still loading is racy, so drive it with a stalled import.
    }
    // Phone
    const tag = `390-${theme}`
    let { ctx, page, errors } = await open({ w: 390, h: 844, theme, phone: true })
    await page.waitForSelector('.cal-agr', { timeout: 30000 })
    const ph = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.cal-agr')].map(a => a.getAttribute('href')), desk: document.querySelectorAll('.cal-ev').length,
      panel: [...document.querySelectorAll('.cal-panel')].some(e => e.getClientRects().length), sw: document.documentElement.scrollWidth - innerWidth,
    }))
    check(`${tag} agenda: rows link out, no panel, no sideways scroll`, ph.rows.length >= 4 && ph.rows.every(h => /^\/agent\/(inbounds\/|clients\?open=)/.test(h)) && !ph.panel && ph.sw <= 0, JSON.stringify(ph), ph)
    await shot(page, `calendar-agenda-${tag}`, true)
    await page.locator('.cal-strip button').nth(2).click()
    await shot(page, `calendar-agenda-earlier-${tag}`, true)
    check(`${tag} page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
    for (const [q, nm] of [['sample=1&empty=1', 'empty'], ['sample=1&fail=1', 'fail']]) {
      ;({ ctx, page, errors } = await open({ w: 390, h: 844, theme, phone: true, query: q }))
      const sw = await sideways(page)
      const shown = await page.evaluate(() => [...document.querySelectorAll('.cal-msg')].find(e => e.getClientRects().length)?.innerText || '')
      check(`${tag} ${nm}: shows and no sideways scroll`, sw <= 0 && (nm === 'empty' ? /Nothing booked this week/.test(shown) && /Book a call/.test(shown) : /couldn’t load/.test(shown) && /Try again/.test(shown)), `${sw} ${shown}`)
      await shot(page, `calendar-${nm}-${tag}`, true)
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
