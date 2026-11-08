// P909 proof (sample data): every screen that shows a price or the nightly charge, at 1440 and 390 (light), plus
// measures: the prices and charges the page shows, any old price / weekly prepay / rollover text, sideways scroll
// and page errors.
//   node scripts/p909-shots.mjs --base-url http://localhost:4909 [--out qa/p909]
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/p909'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const PAGES = [
  { key: 'agent-billing-paid', url: '/template/billing?plan=paid' },
  { key: 'agent-billing-declined', url: '/template/billing?plan=paid&billing=failed' },
  { key: 'agent-billing-nocard', url: '/template/billing?plan=pilot&card=none' },
  { key: 'agent-setup-spend-paid', url: '/template/welcome?plan=paid', step: 'spend' },
  { key: 'agent-setup-card-paid', url: '/template/welcome?plan=paid', step: 'card' },
  { key: 'agent-signup', url: '/template/signup' },
  { key: 'admin-billing', url: '/preview/admin/billing' },
  { key: 'admin-billing-agents', url: '/preview/admin/billing?tab=agents' },
  { key: 'admin-billing-pilot', url: '/preview/admin/billing?tab=pilot' },
  { key: 'admin-settings-billing', url: '/preview/admin/settings?tab=pay' },
]
const OLD = /\$\s?(799|1,699|997|1,797|3,497)\b|Pro\+|over \$200|[Pp]repaid each week|rolls? (over|into)|bank transfer(?!s: cards only)/
const sizes = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const setup = step => ({ step, watched: 360, captions: true, lowData: false, products: 'both', calendar: { provider: 'google' }, tz: 'America/Chicago', tzOk: true, spend: { daily: 100 }, take: { mode: 'both' }, push: null, terms: false })
const browser = await chromium.launch()
const report = []
for (const v of sizes) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  for (const p of PAGES) {
    errors.length = 0
    if (p.step) {
      await page.goto(`${BASE}/template/signup`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(s => { try { localStorage.setItem('ov-setup-878', JSON.stringify(s)) } catch { /* private */ } }, setup(p.step))
    }
    await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const m = await page.evaluate(old => {
      const text = document.body.innerText
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        prices: [...new Set(text.match(/\$[\d,]+(?:\.\d\d)?(?= ?(?:\/ ?month|a month|\/mo))/g) || [])],
        has: ['$699', '$1,499', '$2,999', '$499', '$299', '$112', '12%', 'OHVARA LEADS', 'Cancel anytime', 'Fix card', 'Add a card', 'Founding', 'Max daily lead spend'].filter(s => text.includes(s)),
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
