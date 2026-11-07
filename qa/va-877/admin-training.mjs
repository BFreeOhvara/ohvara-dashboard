// P877 Phase 2 — admin Settings → Training on the preview: per VA, videos watched, Try it done, check scores.
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:4877'
const b = await chromium.launch()
const out = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })
  await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(String(e)))
  await p.goto(`${BASE}/preview/admin/settings?tab=training`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  const m = { url: p.url().replace(BASE, '') }
  m.people = await p.$$eval('.adm-tr-row small', xs => xs.map(x => x.textContent))
  await p.click('.adm-tr-row >> nth=2'); await p.waitForTimeout(500)
  m.keisha = await p.$$eval('.adm-tr-lessons small', xs => xs.slice(0, 9).map(x => x.textContent))
  m.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  await p.locator('.adm-tr-person >> nth=2').screenshot({ path: `qa/va-877/admin-training-${w}.png` }).catch(e => { m.shotErr = String(e).slice(0, 80) })
  m.errors = errs
  out[w] = m
  await ctx.close()
}
console.log(JSON.stringify(out, null, 1))
await b.close()
