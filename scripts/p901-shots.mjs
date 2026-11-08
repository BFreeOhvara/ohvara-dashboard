// P901 proof (sample data): every screen that shows a price, at 1440 and 390 (light), plus measures: the prices the
// page shows, any old price / Scale / "Draft price" text left, sideways scroll and page errors.
//   node scripts/p901-shots.mjs --base-url http://localhost:4901 [--out qa/p901]
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/p901'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const PAGES = [
  { key: 'agent-billing-paid', url: '/template/billing?plan=paid' },
  { key: 'agent-setup-spend-paid', url: '/template/welcome?plan=paid' },
  { key: 'agent-signup', url: '/template/signup' },
  { key: 'admin-billing', url: '/preview/admin/billing' },
  { key: 'admin-agent-dana', url: '/preview/admin/agents/ag-dana' },
  { key: 'admin-agent-priya-pilot', url: '/preview/admin/agents/ag-priya', clickText: 'Pilot' },
  { key: 'admin-split-rules', url: '/preview/admin/settings?tab=split' },
]
const OLD = /\$\s?(997|697|1,797|3,497|497)\b|\bScale\b|[Dd]raft price|3-month minimum|Priced with you/
const sizes = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const browser = await chromium.launch()
const report = []
for (const v of sizes) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'light' })
  // Setup opens on its Lead spend step (Welcome keeps progress under ov-setup-878; the steps before it are gated).
  await ctx.addInitScript(() => { try { localStorage.setItem('ov-setup-878', JSON.stringify({ step: 'spend', watched: 360, captions: true, lowData: false, products: 'both', calendar: { provider: 'google' }, tz: 'America/Chicago', tzOk: true, spend: { daily: 120 }, take: { mode: 'both' }, push: null, terms: false })) } catch { /* private */ } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  for (const p of PAGES) {
    errors.length = 0
    await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    if (p.click) await page.locator('.wz-steps button', { hasText: p.click }).first().click().catch(() => errors.push(`no ${p.click} button`))
    if (p.clickText) await page.getByRole('tab', { name: p.clickText }).first().click().catch(() => {})
    await page.waitForTimeout(800)
    const m = await page.evaluate(old => {
      const text = document.body.innerText
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        prices: [...new Set(text.match(/\$[\d,]+(?:\.\d\d)?(?= ?(?:\/ ?month|a month|\/mo))/g) || [])],
        has: ['$799', '$1,699', '$2,999', '$499', '$299', 'Month to month', 'Call ads (Google)'].filter(s => text.includes(s)),
        old: (text.match(new RegExp(old, 'g')) || []).slice(0, 5),
      }
    }, OLD.source)
    report.push({ w: v.w, page: p.key, ...m, errors: [...errors] })
    await page.screenshot({ path: `${OUT}/${p.key}-${v.w}.png`, fullPage: v.w === 390 })
  }
  await ctx.close()
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
for (const r of report) console.log(JSON.stringify(r))
