import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

// P908 QA: desktop must not change. 1440 shots of every agent page from two servers (before, after) and a pixel diff.
//   node qa/p908/desk.mjs http://localhost:4909 http://localhost:4908
const [A, B] = process.argv.slice(2)
const OUT = 'qa/p908/desk'
mkdirSync(OUT, { recursive: true })
const PAGES = ['', 'leads', 'leads/sample-lead-1', 'clients', 'clients/sample-client-3', 'calendar', 'more', 'billing', 'activity', 'settings', 'submit', 'request-service', 'messages']
const browser = await chromium.launch()
let diffs = 0
for (const theme of ['light', 'dark']) {
  const shots = {}
  for (const [k, base] of [['a', A], ['b', B]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' })
    await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* sample */ } }, theme)
    await ctx.route(/127\.0\.0\.1:1|supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
    const page = await ctx.newPage()
    for (const p of PAGES) {
      await page.goto(`${base}/template/${p}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      shots[`${k}:${p}`] = await page.screenshot({ path: `${OUT}/${theme}-${p.replace(/\//g, '_') || 'overview'}-${k}.png` })
    }
    await ctx.close()
  }
  for (const p of PAGES) {
    const same = Buffer.compare(shots[`a:${p}`], shots[`b:${p}`]) === 0
    if (!same) diffs++
    console.log(theme, p || 'overview', same ? 'same' : 'DIFFERENT')
  }
}
await browser.close()
console.log('different:', diffs)
