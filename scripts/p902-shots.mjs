// P902 proof (sample data): each flow after the first call, at 1440 and 390 (light). Agent lead timelines (booked
// flow with Planned texts; not now with no time; wrong number) and admin Leads › AI calls (both flows + lead quality).
// Measures sideways scroll, page errors, the Planned count and any "AI" on agent pages.
//   node scripts/p902-shots.mjs --base-url http://localhost:4902 [--out qa/p902]
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/p902'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const PAGES = [
  { key: 'agent-booked-flow', url: '/template/leads/sample-lead-17', scroll: 'Messages and changes', agent: true },
  { key: 'agent-no-answer-then-booked', url: '/template/leads/sample-lead-1', scroll: 'Messages and changes', agent: true },
  { key: 'admin-flows', url: '/preview/admin/inbounds?view=ai', scroll: 'Texts after the first call' },
]
const browser = await chromium.launch()
const report = []
for (const v of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  for (const p of PAGES) {
    errors.length = 0
    await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    if (p.scroll) {
      await page.evaluate(t => {
        const el = [...document.querySelectorAll('h2, h3, p, div, span')].find(e => e.childElementCount <= 1 && e.textContent.trim() === t)
        el?.scrollIntoView({ block: 'start' })
      }, p.scroll)
    }
    await page.waitForTimeout(300)
    const m = await page.evaluate(agent => {
      const text = document.body.innerText
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        planned: (text.match(/\bPlanned\b/g) || []).length,
        ai: agent ? /\bAI\b|GoHighLevel/.test(text) : null,
      }
    }, !!p.agent)
    const file = `${OUT}/${p.key}-${v.w}.png`
    await page.screenshot({ path: file })
    report.push({ page: p.key, width: v.w, ...m, errors: [...errors] })
  }
  await ctx.close()
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
