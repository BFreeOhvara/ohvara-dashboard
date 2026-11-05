// P840 quick shot: node scripts/shot-840.mjs <path> <w> <theme> <out> [fullPage]
import { chromium } from 'playwright'
const [pg = '', w = '1440', theme = 'dark', out = 'qa/shell-840/tmp.png', full] = process.argv.slice(2)
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: +w, height: +w <= 500 ? 844 : 900 }, deviceScaleFactor: 1 })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, theme)
await p.goto(`http://localhost:5173/template/${pg}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2400)
await p.screenshot({ path: out, fullPage: !!full })
console.log(errs.length ? errs.slice(0, 5).join('\n') : 'no errors', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth))
await b.close()
