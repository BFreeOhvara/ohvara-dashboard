// P1026 proof: opening the portal and switching pages on a slow (mocked) backend, desktop + phone, before/after.
//   node scripts/p1026-loader.mjs [outDir] [label]   (run from the checkout to measure; vite serves the cwd)
// Every Supabase call is mocked (no real project, no login). "Slow" holds each call for DELAY ms so the loader shows;
// "fast" answers at once and the loader must never show. Writes checks.json + videos (.webm) into outDir.
import process from 'node:process'
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/p1026'
const LABEL = process.argv[3] || 'run'
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

// Every frame: is a loader up, is it a card in the page (not the whole window), is the shell showing, and is the body empty.
const WATCH = () => {
  window.__f = []
  const tick = () => {
    const root = document.getElementById('root')
    const rootVis = root && getComputedStyle(root).visibility !== 'hidden'
    const ols = [...document.querySelectorAll('.ol')].filter(el => Number(getComputedStyle(el).opacity) > 0.05)
    const full = ols.some(el => { const r = el.getBoundingClientRect(); return r.top <= 0 && r.left <= 0 && r.width >= innerWidth - 20 && r.height >= innerHeight - 20 })
    const box = ols.some(el => { const r = el.getBoundingClientRect(); return !(r.top <= 0 && r.left <= 0 && r.width >= innerWidth - 20 && r.height >= innerHeight - 20) })
    const head = document.querySelector('.tp-top, .fx-top, .fx-head, .ma-top, .tp-side, .tp-nav, nav')
    const shell = !!rootVis && !!head && head.getBoundingClientRect().height > 0
    const bodyEmpty = !!document.querySelector('.dz-load') || (shell && !!document.querySelector('.tp-main, .ma-solo') && !document.querySelector('.tp-main > *, .ma-solo > *'))
    const bx = ols.find(el => { const r = el.getBoundingClientRect(); return !(r.top <= 0 && r.left <= 0 && r.width >= innerWidth - 20 && r.height >= innerHeight - 20) })
    window.__f.push({ boxRect: bx ? [bx.className, ...['top','left','width','height'].map(k => Math.round(bx.getBoundingClientRect()[k])), getComputedStyle(bx).opacity] : null, t: Math.round(performance.now()), full, box, shell, loader: ols.length > 0, bodyEmpty, line: !!document.querySelector('.ol-top') })
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

async function run(name, { w, h, theme, phone = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, reducedMotion: 'no-preference',
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null), recordVideo: { dir: OUT, size: { width: w, height: h } } })
  await ctx.addInitScript(([s, th]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', th) }, [session, theme])
  await ctx.addInitScript(WATCH)
  const page = await ctx.newPage(); const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  await mock(page, DELAY)
  await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tp-main, .ma-viewport', { timeout: 90000 })
  await page.waitForFunction(() => !document.querySelector('.ol.is-on') && !document.querySelector('.dz-load'), null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const openEnd = await page.evaluate(() => window.__f.length)
  // switch pages: sidebar link (desktop) or the tab bar (phone)
  const link = page.locator(phone ? '.ma-tabbar .ma-tab' : 'a[href="/agent/leads"]').nth(phone ? 1 : 0)
  await link.click({ timeout: 8000 }).catch(e => errors.push('switch: ' + String(e).slice(0, 100)))
  await page.waitForTimeout(2600)
  const f = await page.evaluate(() => window.__f)
  const seg = a => f.slice(a.from, a.to)
  const sum = s => ({ frames: s.length, fullScreen: s.filter(x => x.full).length, box: s.filter(x => x.box).length, shellWithEmptyBody: s.filter(x => x.shell && x.bodyEmpty).length, shellWhileFullScreen: s.filter(x => x.full && x.shell).length, line: s.filter(x => x.line).length,
    firstFullAt: s.find(x => x.full)?.t ?? null, firstShellAt: s.find(x => x.shell)?.t ?? null })
  res[name + '-boxsample'] = f.filter(x => x.box).filter((_, i) => i % 60 === 0).map(x => x.boxRect)
  res[name] = { open: sum(seg({ from: 0, to: openEnd })), switchPages: sum(seg({ from: openEnd, to: f.length })), errors }
  const vid = page.video()
  await ctx.close()
  renameSync(await vid.path(), join(OUT, `${LABEL}-${name}.webm`))
}

await run('desktop-light', { w: 1280, h: 800, theme: 'light' })
await run('phone-dark', { w: 390, h: 844, theme: 'dark', phone: true })

for (const f of readdirSync(OUT)) if (/^[0-9a-f]{32}\.webm$/.test(f)) renameSync(join(OUT, f), join(OUT, `stray-${f}`))
writeFileSync(join(OUT, `checks-${LABEL}.json`), JSON.stringify(res, null, 1))
console.log(JSON.stringify(res, null, 1))
await browser.close(); await server.close()
