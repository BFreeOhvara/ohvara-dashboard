// P975 proof on sample data (/template has no backend): the VA phone app at 390x844 — every tab (light), Today dark,
// the day sheet, a call brief, the call screen with the carrier merged, the result sheet, Rota next week; a recorded
// tab swipe and swipe-back; and the desktop VA desk at 1440 (unchanged).
//   node scripts/p975-shots.mjs <outDir>
import process from 'node:process'
import { mkdirSync, readdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = resolve(process.argv[2] || 'qa/p975')
mkdirSync(OUT, { recursive: true })
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.VITE_SUPABASE_ANON_KEY = 'sample-preview'
const PORT = 5300 + Math.floor(Math.random() * 400)
const server = await createServer({ root: resolve('.'), server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch()
const log = { errors: [], checks: {} }
const phone = async (theme, video) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(video ? { recordVideo: { dir: OUT, size: { width: 390, height: 844 } } } : {}) })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, theme)
  return ctx
}
const watch = page => {
  page.on('pageerror', e => log.errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/403|Failed to load resource/.test(m.text())) log.errors.push(m.text().slice(0, 160)) })
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) })
const wait = (page, ms = 700) => page.waitForTimeout(ms)
const tab = (page, label) => page.locator(`.ma-tabbar button[aria-label^="${label}"]`).click()
async function swipe(page, x0, x1, y = 420, steps = 12) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y }] })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(700)
}
const onTab = page => page.evaluate(() => document.querySelector('.ma-tabbar .ma-tab.is-on')?.getAttribute('aria-label'))
const step = async (name, fn) => { try { await fn() } catch (e) { log.errors.push(`STEP ${name}: ${e.message.split('\n')[0]}`) } }

try {
  // ---- light: every tab and the flows ----
  const ctx = await phone('light')
  const page = await ctx.newPage(); watch(page)
  await page.goto(`${base}/template/fulfillment`, { waitUntil: 'networkidle' }); await wait(page, 1500)
  log.checks.sideways = await page.evaluate(() => document.documentElement.scrollWidth)
  await shot(page, '01-today')
  await step('notif', async () => {
    await page.locator('button[aria-label^="Notifications"]').click(); await wait(page, 800); await shot(page, '02-notifications')
  })
  await step('search', async () => {
    await page.goto(`${base}/template/fulfillment`, { waitUntil: 'networkidle' }); await wait(page, 1200)
    await page.locator('button[aria-label="Search clients"]').click(); await wait(page, 900)
    await page.locator('.va-find input').fill('ma'); await wait(page, 400); await shot(page, '03-search')
  })
  await step('brief', async () => {
    await page.goto(`${base}/template/fulfillment`, { waitUntil: 'networkidle' }); await wait(page, 1200)
    await page.locator('button[aria-label="Call brief"]').first().click(); await wait(page, 900); await shot(page, '04-brief')
    log.checks.briefFacts = await page.evaluate(() => [...document.querySelectorAll('.va-facts small')].map(s => s.textContent))
    await page.locator('.ma-scrim').first().click({ position: { x: 195, y: 40 } }); await wait(page, 800)
  })
  await step('calendar', async () => {
    await tab(page, 'Calendar'); await wait(page, 900); await shot(page, '05-calendar')
    await page.locator('.ma-day.is-today').click(); await wait(page, 900); await shot(page, '06-day-sheet')
    log.checks.daySheet = await page.evaluate(() => ({ hours: document.querySelectorAll('.va-hour').length, now: !!document.querySelector('.va-now'), slots: [...document.querySelectorAll('.va-slot .ma-tag')].map(t => t.textContent) }))
    await page.locator('.ma-sheet .va-wide').click(); await wait(page, 600)
  })
  await step('rota', async () => {
    await tab(page, 'Rota'); await wait(page, 900); await shot(page, '07-rota')
    await page.locator('.va-seg button', { hasText: 'Next week' }).click(); await wait(page, 900); await shot(page, '08-rota-next-week')
  })
  await step('messages', async () => {
    await tab(page, 'Messages'); await wait(page, 900); await shot(page, '09-messages')
    await page.locator('.va-thread').first().click(); await wait(page, 900); await shot(page, '10-chat')
    log.checks.bubbleMax = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.ma-bub')].map(m => m.getBoundingClientRect().width / m.closest('.ma-chat').getBoundingClientRect().width)).toFixed(2))
  })
  await step('me', async () => {
    await page.goto(`${base}/template/fulfillment/more`, { waitUntil: 'networkidle' }); await wait(page, 1200); await shot(page, '11-me')
  })
  // the call: take a caller on hold, add the carrier, it merges; end → the result sheet that can't be closed
  await step('call', async () => {
    await tab(page, 'Today'); await wait(page, 900)
    await page.locator('.va-hold').click(); await wait(page, 900)
    await page.locator('.va-cb', { hasText: 'Add carrier' }).click(); await wait(page, 3200)
    log.checks.merged = await page.locator('.va-call-merged').textContent().catch(() => null)
    await shot(page, '12-call-merged')
    await page.locator('button[aria-label="End call"]').click(); await wait(page, 900); await shot(page, '13-result-sheet')
    await page.locator('.va-result .ma-scrim').click({ force: true }); await page.keyboard.press('Escape'); await wait(page, 600)
    log.checks.resultStays = await page.locator('.va-result').count()
    await page.locator('.ma-pick[data-result="agent"]').click(); await wait(page, 900)
    log.checks.resultGone = await page.locator('.va-result').count()
    log.checks.minTarget = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.ma-tabbar button, .ma-ib, .ma-btn, .ma-chip, .ma-round, .va-cb, .ma-pick')].filter(b => b.offsetParent).map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))))
    log.checks.small = await page.evaluate(() => [...document.querySelectorAll('button, a, input')].filter(b => b.offsetParent && b.closest('.ma, .ma-layer')).map(b => [b.className.split(' ')[0], Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height), (b.textContent || b.getAttribute('aria-label') || '').slice(0, 20)]).filter(x => Math.min(x[1], x[2]) < 44))
  })
  await ctx.close()

  // ---- dark Today ----
  const dctx = await phone('dark')
  const dp = await dctx.newPage(); watch(dp)
  await dp.goto(`${base}/template/fulfillment`, { waitUntil: 'networkidle' }); await wait(dp, 1500); await shot(dp, '14-today-dark')
  await dctx.close()

  // ---- recorded: swipe between tabs, then a slide-in screen swiped back ----
  await step('swipe', async () => {
    const vctx = await phone('light', true)
    const vp = await vctx.newPage(); watch(vp)
    await vp.goto(`${base}/template/fulfillment`, { waitUntil: 'networkidle' }); await wait(vp, 1500)
    const t0 = await onTab(vp)
    await swipe(vp, 330, 60); const t1 = await onTab(vp)
    await swipe(vp, 330, 60); const t2 = await onTab(vp)
    await swipe(vp, 60, 330); const t3 = await onTab(vp)
    await tab(vp, 'Messages'); await wait(vp, 800)
    await vp.locator('.va-thread').first().click(); await wait(vp, 900)
    const inThread = await vp.locator('.ma-layer-r').count()
    await swipe(vp, 8, 330, 500, 14); await wait(vp, 600)
    const afterBack = await vp.locator('.ma-layer-r').count()
    log.checks.swipe = { t0, t1, t2, t3, inThread, afterBack }
    await vctx.close()
    for (const f of readdirSync(OUT).filter(f => f.endsWith('.webm') && !f.startsWith('15'))) renameSync(join(OUT, f), join(OUT, '15-swipe-tab-and-back.webm'))
  })

  // ---- desktop VA desk at 1440: still the desk ----
  const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const wp = await wctx.newPage(); watch(wp)
  await wp.goto(`${base}/template/fulfillment`, { waitUntil: 'networkidle' }); await wait(wp, 1500)
  log.checks.desk = await wp.evaluate(() => ({ phoneApp: !!document.querySelector('.ma'), rail: document.querySelectorAll('.fx-ri').length }))
  await shot(wp, '16-desk-1440')
  await wctx.close()

  // ---- contact sheet ----
  const pngs = readdirSync(OUT).filter(f => /^\d\d-.*\.png$/.test(f) && !f.startsWith('16'))
  const cells = pngs.map(f => `<figure><img src="data:image/png;base64,${readFileSync(join(OUT, f)).toString('base64')}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`).join('')
  const cs = await browser.newPage({ viewport: { width: 1400, height: 800 } })
  await cs.setContent(`<style>body{margin:0;padding:12px;background:#e9e9e4;font:600 12px system-ui;display:grid;grid-template-columns:repeat(8,1fr);gap:8px}img{width:100%;border-radius:8px;display:block}figure{margin:0}figcaption{padding:3px 2px}</style>${cells}`)
  await cs.waitForTimeout(400)
  await cs.screenshot({ path: join(OUT, 'contact-sheet.png'), fullPage: true })
} finally {
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(log, null, 2))
  await browser.close(); await server.close()
}
console.log(JSON.stringify(log, null, 1))
