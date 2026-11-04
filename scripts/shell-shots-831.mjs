// P831: quick shots of the template shell (public /template, sample data) for review and side-by-sides.
//   node scripts/shell-shots-831.mjs --base-url http://localhost:5173 [--out qa/shell-831] [--pages overview,settings]
//   [--w 1440,390] [--themes dark,light] [--css "<extra css>"] [--tag name]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', 'http://localhost:5173').replace(/\/$/, '')
const OUT = flag('--out', 'qa/shell-831')
const PAGES = flag('--pages', 'overview,leads,clients,calendar,activity,billing,settings').split(',')
const WS = flag('--w', '1920,1440,390').split(',').map(Number)
const THEMES = flag('--themes', 'dark,light').split(',')
const CSS = flag('--css', '')
const TAG = flag('--tag', '')
const PATH = { overview: '', leads: '/leads', clients: '/clients', calendar: '/calendar', activity: '/activity', billing: '/billing', settings: '/settings', messages: '/messages', submit: '/submit' }
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
for (const theme of THEMES) {
  for (const w of WS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, theme)
    for (const p of PAGES) {
      await page.goto(`${BASE}/template${PATH[p]}`, { waitUntil: 'networkidle' })
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      if (CSS) await page.addStyleTag({ content: CSS })
      await page.waitForTimeout(1600)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      await page.screenshot({ path: `${OUT}/${p}${TAG ? `-${TAG}` : ''}-${w}-${theme}.png` })
      if (over > 0) errors.push(`${p} ${w}: sideways scroll ${over}px`)
    }
    if (errors.length) console.log(theme, w, errors.slice(0, 5))
    await ctx.close()
  }
}
await browser.close()
console.log('shots in', OUT)
