// P1020 proof: the loading screen on a slow (mocked) backend, desktop + phone, and the reversed app intro.
//   node scripts/p1020-loader.mjs [outDir]
// Every Supabase call is mocked (no real project, no login). "Slow" holds each call for DELAY ms so the loader shows;
// "fast" answers at once and the loader must never show. Writes checks.json + videos (.webm) into outDir.
import process from 'node:process'
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/p1020'
const SB = 'https://mock.supabase.co'
const PORT = 5300 + Math.floor(Math.random() * 400)
const DELAY = 1600
mkdirSync(OUT, { recursive: true })

const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = { id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago', is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard' }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const session = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000, user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: '2025-01-01T00:00:00Z' } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function mock(page, delay) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (delay) await sleep(delay)
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    const table = path.replace('/rest/v1/', '')
    if (table === 'app_settings') return json(route, 200, single ? { id: 1, agent_billing_enforced: false } : [{ id: 1, agent_billing_enforced: false }])
    return json(route, 200, single ? {} : [])
  }).catch(() => {})
}

// Logs every moment a loader is on screen: when it showed, whether it covered the page area, and where.
const WATCH = () => {
  window.__ol = []
  let on = null
  const tick = () => {
    const el = document.querySelector('.ol.is-on, .ol.ol-boot')
    const vis = el && Number(getComputedStyle(el).opacity) > 0.5 ? el : null
    const key = vis ? `${vis.classList.contains('ol-area')}|${Math.round(vis.getBoundingClientRect().top)}` : ''
    if (vis && on && key !== on.key) { on.off = Math.round(performance.now()); on.handoff = true; on = null }
    if (vis && !on) {
      const r = vis.getBoundingClientRect(), cs = getComputedStyle(vis)
      on = { key, at: Math.round(performance.now()), area: vis.classList.contains('ol-area'), phone: vis.classList.contains('ol-phone'), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
        bg: cs.backgroundImage.slice(0, 60), body: getComputedStyle(vis.querySelector('.olb')).fill, wing: getComputedStyle(vis.querySelector('.olw')).fill,
        word: getComputedStyle(vis.querySelector('.ol-word')).display, wingAnim: getComputedStyle(vis.querySelector('.olw')).animationName, barAnim: getComputedStyle(vis.querySelector('.ol-track i')).animationName,
        header: (() => { const h = document.querySelector('.tp-top, .fx-top, .ma-top, header'); return h ? Math.round(h.getBoundingClientRect().bottom) : null })() }
      window.__ol.push(on)
    } else if (!vis && on) { on.off = Math.round(performance.now()); on = null }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const res = {}

async function run(name, { w, h, theme, delay, phone = false, reduce = false, video = false, then }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, reducedMotion: reduce ? 'reduce' : 'no-preference',
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null), ...(video ? { recordVideo: { dir: OUT, size: { width: w, height: h } } } : null) })
  await ctx.addInitScript(([s, th]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', th) }, [session, theme])
  await ctx.addInitScript(WATCH)
  const page = await ctx.newPage(); const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  await mock(page, delay)
  await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tp-main, .ma', { timeout: 60000 })
  await page.waitForFunction(() => !document.querySelector('.ol'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(600)
  if (then) await then(page)
  res[name] = { log: await page.evaluate(() => window.__ol), left: await page.evaluate(() => document.querySelectorAll('.ol').length), errors }
  const vid = page.video()
  await ctx.close()
  if (vid) renameSync(await vid.path(), join(OUT, `${name}.webm`))
}

// Desktop light, slow: first load, then a page change inside the portal (Leads) while its data is slow.
const pageChange = async page => {
  await page.evaluate(() => { window.__ol.push({ mark: 'page change', at: Math.round(performance.now()), links: [...document.querySelectorAll('a[href^="/agent/"]')].map(a => a.getAttribute('href')).slice(0, 12) }) })
  const link = page.locator('a[href="/agent/leads"], a[href^="/agent/leads"]').first()
  if (await link.count()) { await link.click(); await page.waitForTimeout(400); await page.waitForFunction(() => !document.querySelector('.ol'), null, { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(700) }
}
await run('desktop-light-slow', { w: 1280, h: 800, theme: 'light', delay: DELAY, video: true, then: pageChange })
await run('desktop-dark-slow', { w: 1280, h: 800, theme: 'dark', delay: DELAY })
await run('phone-slow', { w: 390, h: 844, theme: 'dark', delay: DELAY, phone: true, video: true, then: pageChange })
await run('desktop-fast', { w: 1280, h: 800, theme: 'light', delay: 0, then: pageChange })
await run('phone-reduce-slow', { w: 390, h: 844, theme: 'dark', delay: DELAY, phone: true, reduce: true })

// The app intro (public/intro.js), mounted as the app would on a cold start, recorded at phone size.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, recordVideo: { dir: OUT, size: { width: 390, height: 844 } } })
  const page = await ctx.newPage()
  await page.goto(`${base}/intro.js`)
  await page.setContent('<html><body style="margin:0;background:#0A1F44"></body></html>')
  await page.addScriptTag({ url: `${base}/intro.js` })
  await page.waitForTimeout(500)
  res.intro = await page.evaluate(() => {
    const i = window.OhvaraIntro.mount(document.body, 'B', false)
    i.play()
    const r = i.root
    return { bg: getComputedStyle(r).backgroundColor, front: r.querySelector('.oi-front path').getAttribute('fill'), wing: r.querySelector('.oi-wing path').getAttribute('fill') }
  })
  await page.waitForTimeout(2600)
  const vid = page.video(); await ctx.close(); renameSync(await vid.path(), join(OUT, 'intro.webm'))
}

for (const f of readdirSync(OUT)) if (/^[0-9a-f]{32}\.webm$/.test(f)) renameSync(join(OUT, f), join(OUT, `stray-${f}`))
writeFileSync(join(OUT, 'checks.json'), JSON.stringify(res, null, 1))
console.log(JSON.stringify(res, null, 1))
await browser.close(); await server.close()
