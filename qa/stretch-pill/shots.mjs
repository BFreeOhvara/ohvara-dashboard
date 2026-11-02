// Stretchy pill shots and checks on /agent/calendar?sample=1, every Supabase call mocked (no real project, no login).
//   node qa/stretch-pill/shots.mjs [outDir]
// 1440 (.cal-seg, Week to Day) and 390 (.cal-strip, Fri to Sat; .cal-seg is hidden on phones), light and dark.
// Frames: rest, then the flight paused at 0 ms and 200 ms, then the end, once the overlay has come off.
// page-*.png is the whole screen, row-*.png the row up close. Writes checks.json and exits 1 on any failed check.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/stretch-pill'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
const BASE = Date.UTC(2026, 9, 30, 17, 10)
const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = { id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago', is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard' }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const session = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000, user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: new Date(BASE - 1e11).toISOString() } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const mock = page => page.route(`${SB}/**`, async route => {
  const req = route.request()
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const path = new URL(req.url()).pathname
  const single = (req.headers().accept || '').includes('vnd.pgrst.object')
  if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
  if (path.startsWith('/auth/v1/')) return json(route, 200, {})
  if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
  if (path.replace('/rest/v1/', '') === 'app_settings') return json(route, 200, single ? { id: 1, agent_billing_enforced: false } : [{ id: 1, agent_billing_enforced: false }])
  return json(route, 200, single ? {} : [])
})

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const check = (name, ok, info) => { results.push({ name, pass: !!ok, ...(info === undefined ? null : { info }) }); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function open(w, h, theme, scale, phone = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: scale, ...(phone ? { isMobile: true, hasTouch: true } : null) })
  await ctx.addInitScript(([s, th]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', th) }, [session, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.setFixedTime(BASE)
  await mock(page)
  await page.goto(`http://localhost:${PORT}/agent/calendar?sample=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.cal-page', { timeout: 180000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    window.__edges = () => {
      const l = document.querySelector('.sp-pill .sp-layer'); if (!l) return null
      const m = /inset\(([\d.-]+)px calc\(100% - ([\d.-]+)px\) calc\(100% - ([\d.-]+)px\) ([\d.-]+)px/.exec(getComputedStyle(l).clipPath)
      return m && { right: +m[2], left: +m[4] }
    }
    window.__rects = sel => { const row = document.querySelector(sel); const box = n => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }; return { row: box(row), btn: [...row.querySelectorAll('button')].map(box) } }
    window.__box = (sel, i) => { const o = document.querySelector(sel); const q = o.getBoundingClientRect(), r = o.querySelectorAll('button')[i].getBoundingClientRect(); return { left: r.left - q.left - o.clientLeft, right: r.right - q.left - o.clientLeft } }
    window.__start = async (sel, i) => {
      document.querySelector(sel).querySelectorAll('button')[i].click()
      await new Promise(r => requestAnimationFrame(r))
      document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0 })
    }
    window.__seek = ms => document.getAnimations().forEach(a => { a.currentTime = ms })
    window.__play = () => document.getAnimations().forEach(a => a.play())
  })
  return { ctx, page, errors }
}
const crop = async (page, sel, path, pad = 10) => {
  const b = await page.locator(sel).boundingBox()
  const size = page.viewportSize()
  await page.screenshot({ path, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(b.width + 2 * pad, size.width), height: b.height + 2 * pad } })
}

// One row's four frames: shoot(frameName) at rest, 0 ms, 200 ms and the end.
async function frames(page, sel, idx, shoot) {
  await shoot('1-rest')
  await page.evaluate(([s, i]) => window.__start(s, i), [sel, idx])
  await shoot('2-0ms')
  await page.evaluate(() => window.__seek(200))
  await shoot('3-200ms')
  await page.evaluate(() => { window.__seek(0); window.__play() })
  await page.waitForTimeout(900)
  await shoot('4-end')
}

for (const theme of ['light', 'dark']) {
  // ── 1440: the frames ──
  { const { ctx, page } = await open(1440, 900, theme, 1)
    await frames(page, '.cal-seg', 1, f => page.screenshot({ path: join(OUT, `page-1440-${theme}-${f}.png`) }))
    await ctx.close() }
  { const { ctx, page, errors } = await open(1440, 900, theme, 3)
    await frames(page, '.cal-seg', 1, f => crop(page, '.cal-seg', join(OUT, `row-1440-${theme}-${f}.png`)))

    // ── 1440: Week then Day, measured ──
    await page.locator('.cal-seg button').nth(0).click(); await page.waitForTimeout(900)
    const pre = await page.evaluate(() => window.__rects('.cal-seg'))
    await page.evaluate(() => window.__start('.cal-seg', 1))
    const at = async ms => { await page.evaluate(m => window.__seek(m), ms); return page.evaluate(() => window.__edges()) }
    const week = await page.evaluate(() => window.__box('.cal-seg', 0))
    const day = await page.evaluate(() => window.__box('.cal-seg', 1))
    const e0 = await at(0), e200 = await at(200), e360 = await at(360), e549 = await at(549)
    const pills = await page.locator('.cal-seg .sp-pill').count()
    check(`${theme} 1440 at 0 ms the pill sits on Week`, Math.abs(e0.left - week.left) < 0.6 && Math.abs(e0.right - week.right) < 0.6, e0)
    check(`${theme} 1440 at 200 ms the pill spans part of both buttons`, pills === 1 && e200.left > week.left && e200.left < week.right && e200.right > day.left && e200.right <= day.right, { e200, week, day })
    check(`${theme} 1440 at 360 ms the right edge has arrived and the left has not`, Math.abs(e360.right - day.right) < 0.6 && day.left - e360.left > 1, e360)
    check(`${theme} 1440 the left edge arrives by 550 ms`, Math.abs(e549.left - day.left) < 0.6, e549)
    await page.evaluate(() => window.__play())
    await page.waitForTimeout(900)
    check(`${theme} 1440 overlay count 0 after the flight`, (await page.locator('.cal-seg .sp-pill').count()) === 0)
    check(`${theme} 1440 row and button rects match pre-click`, same(pre, await page.evaluate(() => window.__rects('.cal-seg'))), pre)

    // ── 1440: quick clicks. Each re-click waits until the flight has really left, so each one interrupts it. ──
    for (let round = 0; round < 4; round++) {
      await page.locator('.cal-seg button').nth(1).click(); await page.waitForTimeout(900)
      const q = await page.evaluate(async () => {
        const { edgesAt } = await import('/src/lib/stretchPill.js')
        const parse = t => { const m = /inset\(([\d.-]+)px calc\(100% - ([\d.-]+)px\) calc\(100% - ([\d.-]+)px\) ([\d.-]+)px/.exec(t); return { top: +m[1], right: +m[2], bottom: +m[3], left: +m[4] } }
        const anim = () => document.querySelector('.cal-seg .sp-layer')?.getAnimations().find(a => a.effect.getKeyframes().some(k => k.clipPath))
        const [wk, dy] = document.querySelectorAll('.cal-seg button')
        const frameLog = []; const handoffs = []; let run = true
        const tick = () => {
          const a = anim(); const e = window.__edges()
          if (a && e) {
            const k = a.effect.getKeyframes()
            const want = edgesAt(parse(k[0].clipPath), parse(k.at(-1).clipPath), a.currentTime)
            frameLog.push({ off: Math.max(Math.abs(want.left - e.left), Math.abs(want.right - e.right)), n: document.querySelectorAll('.cal-seg .sp-pill').length })
          }
          if (run) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        const moving = async () => { for (let i = 0; i < 200; i++) { await new Promise(r => requestAnimationFrame(r)); if ((anim()?.currentTime ?? 0) > 30) return true } return false }
        const reclick = async b => {
          const ok = await moving()
          const before = window.__edges()
          b.click()
          await new Promise(r => setTimeout(r, 0))
          const s = parse(anim().effect.getKeyframes()[0].clipPath)
          handoffs.push(ok ? +Math.max(Math.abs(s.left - before.left), Math.abs(s.right - before.right)).toFixed(2) : null)
        }
        wk.click()
        await reclick(dy); await reclick(wk)
        await new Promise(r => setTimeout(r, 900)); run = false
        return { frames: frameLog.length, most: Math.max(...frameLog.map(f => f.n)), offCurve: +Math.max(...frameLog.map(f => f.off)).toFixed(2), handoffs, left: document.querySelectorAll('.cal-seg .sp-pill').length }
      })
      check(`${theme} 1440 quick clicks round ${round}: each flight starts where the last one was, every frame on the curve`, q.frames > 15 && q.most === 1 && q.handoffs.length === 2 && q.handoffs.every(h => h !== null && h < 6) && q.offCurve < 1.5 && q.left === 0, q)
    }
    check(`${theme} 1440 no page errors`, errors.length === 0, errors)
    await ctx.close() }

  // ── 390: the frames and the checks ──
  { const { ctx, page, errors } = await open(390, 844, theme, 2, true)
    const pre = await page.evaluate(() => window.__rects('.cal-strip'))
    await frames(page, '.cal-strip', 5, async f => {
      await page.screenshot({ path: join(OUT, `page-390-${theme}-${f}.png`) })
      await crop(page, '.cal-strip', join(OUT, `row-390-${theme}-${f}.png`), 4)
    })
    check(`${theme} 390 overlay count 0 after a flight, rects match pre-tap`, (await page.locator('.cal-strip .sp-pill').count()) === 0 && same(pre, await page.evaluate(() => window.__rects('.cal-strip'))))
    const f = await page.evaluate(async () => {
      await window.__start('.cal-strip', 1)
      window.__seek(200)
      const row = document.querySelector('.cal-strip')
      return { e: window.__edges(), pills: row.querySelectorAll('.sp-pill').length, rowOver: row.scrollWidth - row.clientWidth, docOver: document.documentElement.scrollWidth - innerWidth }
    })
    check(`${theme} 390 tap moves the pill, no sideways scroll in flight`, f.pills === 1 && f.e && f.rowOver <= 0 && f.docOver <= 0, f)
    await page.evaluate(() => { window.__seek(0); window.__play() })
    await page.waitForTimeout(900)
    check(`${theme} 390 no sideways scroll at rest`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0)
    check(`${theme} 390 no page errors`, errors.length === 0, errors)
    await ctx.close() }

  // ── reduced motion, through page.emulateMedia as the done-means names it ──
  for (const [w, h, scale, phone, sel] of [[1440, 900, 1, false, '.cal-seg'], [390, 844, 2, true, '.cal-strip']]) {
    const { ctx, page } = await open(w, h, theme, scale, phone)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const r = await page.evaluate(async sel => {
      const row = document.querySelector(sel); let seen = 0
      new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('sp-pill')) seen++ }).observe(row, { childList: true })
      const b = row.querySelectorAll('button')[1]; b.click()
      await new Promise(r => requestAnimationFrame(r))
      const out = { on: b.classList.contains('on'), bg: getComputedStyle(b).backgroundColor, anims: row.getAnimations({ subtree: true }).length }
      await new Promise(r => setTimeout(r, 300))
      return { ...out, seen, cls: row.className }
    }, sel)
    check(`${theme} ${w} reduced motion: no overlay, instant switch`, r.seen === 0 && r.on && r.anims === 0 && !/sp-/.test(r.cls) && r.bg !== 'rgba(0, 0, 0, 0)', r)
    await ctx.close()
  }
}
writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 1))
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`)
await browser.close()
await server.close()
process.exit(results.every(r => r.pass) ? 0 : 1)
