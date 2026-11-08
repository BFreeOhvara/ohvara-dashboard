// P892 shots: the VA "From the AI" card (live hand-off + callback task), admin Leads › AI calls and Settings › AI caller,
// at 1440 and 390 (light). Run: node qa/p892/shots.mjs (vite preview on :4892). Prints measurements.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4892'
const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const views = [
  ['va-handoff', '/template/fulfillment/leads/vq-10', 'From the AI'],
  ['va-callback', '/template/fulfillment/leads/vq-11', 'From the AI'],
  ['admin-ai-calls', '/preview/admin/inbounds?view=ai', 'AI calls · today'],
  ['admin-ai-settings', '/preview/admin/settings?tab=ai', 'AI caller'],
]
const browser = await chromium.launch()
for (const [name, path, text] of views) {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w > 500 ? 900 : 844 }, reducedMotion: 'reduce', deviceScaleFactor: 1 })
    await ctx.addInitScript(() => localStorage.setItem('ohvara-theme', 'light'))
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', e => errs.push(e.message))
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const el = page.getByText(text, { exact: true }).first()
    const found = await el.count()
    if (found) await el.scrollIntoViewIfNeeded().catch(() => {})
    const m = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - innerWidth,
      wide: [...document.querySelectorAll('.ai-from, .ai-view, .ai-tiles, .ai-stops, .fx-blk')].filter(e => e.scrollWidth > e.clientWidth + 1).length,
      tiles: document.querySelectorAll('.ai-tiles > div').length, rows: document.querySelectorAll('.ai-rows li').length,
      url: location.pathname + location.search,
    }))
    await page.screenshot({ path: `${DIR}${name}-${w}.png` })
    console.log(name, w, 'found', found, JSON.stringify(m), errs.length ? `errors: ${errs.join(' | ')}` : 'no errors')
    await ctx.close()
  }
}
await browser.close()
