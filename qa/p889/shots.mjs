// P889 shots: agent setup spend step and Billing at 1440 and 390 (light).
// Run: node qa/p889/shots.mjs (preview on :4889). Saves PNGs next to this file and prints measurements.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4889'
const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const setup = { step: 'spend', watched: 999, captions: true, lowData: false, licence: { states: ['TX', 'OK', 'LA'], ok: true },
  products: 'both', calendar: { provider: null }, tz: 'America/Chicago', tzOk: true,
  week: Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => [d, { on: !['Sat', 'Sun'].includes(d), start: '9:00 AM', end: '6:00 PM' }])),
  spend: { daily: 100 }, take: { mode: 'both', hours: Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => [d, { on: !['Sat', 'Sun'].includes(d), start: '9:00 AM', end: '5:00 PM' }])) }, push: null, terms: false }
const views = [
  ['setup', '/template/welcome', '[aria-label="Live-call hours per weekday"]'],
  ['billing', '/template/billing', '[aria-label="Your daily lead spend"]'],
]
const browser = await chromium.launch()
for (const [name, path, focus] of views) {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w > 500 ? 1000 : 844 }, reducedMotion: 'reduce', deviceScaleFactor: 1 })
    await ctx.addInitScript(s => { localStorage.setItem('ohvara-theme', 'light'); localStorage.setItem('ov-setup-878', s) }, JSON.stringify(setup))
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', e => errs.push(e.message))
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    if (focus) await page.locator(focus).first().scrollIntoViewIfNeeded().catch(() => {})
    const m = await page.evaluate(sel => {
      const el = sel && document.querySelector(sel)
      return { overflowX: document.documentElement.scrollWidth - innerWidth, found: sel ? !!el : true, h1: document.querySelector('h2')?.innerText }
    }, focus)
    const target = name === 'billing' ? page.locator('[aria-label="Your daily lead spend"]') : null
    if (target) await target.screenshot({ path: `${DIR}${name}-${w}.png` })
    else await page.screenshot({ path: `${DIR}${name}-${w}.png`, fullPage: w <= 500 })
    console.log(name, w, JSON.stringify(m), errs.length ? `errors: ${errs.join(' | ')}` : 'no errors')
    await ctx.close()
  }
}
await browser.close()
