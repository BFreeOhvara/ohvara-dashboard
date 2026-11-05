// P841: screens of Overview, Leads, Clients at 1440/390 x light/dark into qa/shell-841/<dir>/, and a count of
// visible items per page (cards/rows/tiles whose box is inside the first viewport), plus errors + sideways scroll.
//   node scripts/shell-shots-841.mjs [--base-url http://localhost:5173] [--dir after] [--no-shots]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || 'http://localhost:5173').replace(/\/$/, '')
const DIR = `qa/shell-841/${flag('--dir') || 'after'}`
const SHOTS = !args.includes('--no-shots')
mkdirSync(DIR, { recursive: true })
const PAGES = ['overview', 'leads', 'clients']
const ITEM = '.fx-card, .fx-tile, .tp-row-card, tbody tr, .fx-later li, .fx-act li, [role="row"], .fx-ncard, .fx-cl, .fx-list > li, li.fx-item'
const b = await chromium.launch()
const report = { visible: {}, errs: [], overflow: {} }
for (const theme of ['dark', 'light']) {
  for (const w of [1440, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1 })
    const p = await ctx.newPage()
    p.on('pageerror', e => report.errs.push(`${theme} ${w} ${e.message}`))
    p.on('console', m => { if (m.type() === 'error') report.errs.push(`${theme} ${w} ${m.text()}`) })
    await p.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, theme)
    for (const pg of PAGES) {
      await p.goto(`${BASE}/template/${pg === 'overview' ? '' : pg}`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(2200)
      const tag = `${theme}/${w}/${pg}`
      report.visible[tag] = await p.evaluate(sel => {
        const H = innerHeight; let n = 0
        for (const el of document.querySelectorAll(sel)) { const r = el.getBoundingClientRect(); if (r.width > 20 && r.height > 12 && r.top >= 0 && r.bottom <= H) n++ }
        return n
      }, ITEM)
      report.overflow[tag] = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      if (SHOTS) await p.screenshot({ path: `${DIR}/${pg}-${w}-${theme}.png`, fullPage: w === 390 })
    }
    await ctx.close()
  }
}
console.log(JSON.stringify(report, null, 1))
await b.close()
