// P893 proof (sample data): agent Overview, Leads, Clients, Activity, Billing at 1440, 1920 and 390, light and dark,
// plus a count of pointer-cursor elements that should be inert.
//   node scripts/agent-893-shots.mjs --base-url http://localhost:5293 [--out qa/p893/after] [--only 1440]
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/p893/after'
const ONLY = flag('--only')
const PAGES = (flag('--pages') || 'overview,leads,clients,activity,billing').split(',')
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const ROUTE = { overview: '/template', leads: '/template/leads', clients: '/template/clients', activity: '/template/activity', billing: '/template/billing' }
const sizes = [{ w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 390, h: 844 }].filter(v => !ONLY || String(v.w) === ONLY)
const themes = (flag('--themes') || 'light,dark').split(',')
const browser = await chromium.launch()
const report = []
for (const v of sizes) for (const t of themes) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: t })
  await ctx.addInitScript(x => { try { localStorage.setItem('theme', x); localStorage.setItem('ohvara-theme', x) } catch { /* private */ } }, t)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  for (const p of PAGES) {
    await page.goto(`${BASE}${ROUTE[p]}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1400)
    const m = await page.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      // P893 #7: the lead board's columns reach the content's right edge
      board: (() => { const b = document.querySelector('.fx-board, .ld-board, [class*="board"]'); if (!b) return null; const r = b.getBoundingClientRect(); const main = b.closest('main') || document.body; return { right: Math.round(r.right), mainRight: Math.round(main.getBoundingClientRect().right), w: Math.round(r.width) } })(),
    }))
    report.push({ w: v.w, t, p, ...m })
    await page.screenshot({ path: `${OUT}/${p}-${v.w}-${t}.png`, fullPage: v.w === 390 })
  }
  if (errors.length) report.push({ w: v.w, t, errors })
  await ctx.close()
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report))
