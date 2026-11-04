// P835: drive the plan builder slider on public /template (Billing and Welcome) and read the ranges it shows,
// in both modes and themes, at $300, $1,000 and $3,000. Also reports page errors and sideways overflow.
//   node scripts/shell-plan-835.mjs [--base-url http://localhost:4179]
import process from 'node:process'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const i = args.indexOf('--base-url')
const BASE = (i >= 0 ? args[i + 1] : 'http://localhost:4179').replace(/\/$/, '')
const b = await chromium.launch()
const out = {}
for (const theme of ['dark', 'light']) {
  for (const w of [1440, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', e => errs.push(e.message))
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
    await p.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, theme)
    for (const path of ['/template/billing', '/template/welcome']) {
      await p.goto(BASE + path, { waitUntil: 'networkidle' })
      const sl = p.locator('input.pb-range').first()
      const res = {}
      for (const mode of ['Booked appointments', 'Live calls']) {
        const btn = p.getByRole('radio', { name: mode }).first()
        if (await btn.evaluate(e => e.tagName === 'BUTTON')) await btn.click()
        for (const v of [300, 1000, 3000]) {
          await sl.fill(String(v))
          await p.waitForTimeout(40)
          res[`${mode} $${v}`] = [await p.locator('.pb-amt b').first().textContent(), ...(await p.locator('.pb-outs b').allTextContents())].join(' | ')
        }
      }
      await p.getByRole('radio', { name: 'Booked appointments' }).first().click().catch(() => {})
      await sl.fill('1000')
      await p.waitForTimeout(1200)
      await p.locator('.pb-tile').first().screenshot({ path: `qa/shell-835/builder-${path.split('/').pop()}-${w}-${theme}.png` })
      out[`${theme} ${w} ${path}`] = { res, errs: [...errs], overflow: await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
    }
    await ctx.close()
  }
}
console.log(JSON.stringify(out, null, 1))
await b.close()
