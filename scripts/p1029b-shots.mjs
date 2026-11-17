// P1029 follow-up: Billing "Your own leads" row: [Import leads] [Remove own leads]; Remove Leads link back beside Your states.
//   BASE=http://localhost:5029 node scripts/p1029b-shots.mjs <outDir> <before|after>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const BASE = process.env.BASE || 'http://localhost:5029'
const OUT = process.argv[2] || 'qa/p1029b'; const TAG = process.argv[3] || 'after'
mkdirSync(OUT, { recursive: true })
const b = await chromium.launch()
for (const [w, h, phone] of [[1920, 1080, false], [1440, 900, false], [390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/template/billing`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  const r = await p.evaluate(() => ({ own: [...document.querySelectorAll('[data-row="own"] button')].map(x => x.textContent), foot: [...document.querySelectorAll('.bl-plan-acts button')].map(x => x.textContent) }))
  console.log(w, JSON.stringify(r))
  const name = phone ? 'phone-billing' : `desktop-billing-plan-${w}`
  if (phone) await p.screenshot({ path: `${OUT}/${name}-${TAG}.png` }); else await p.locator('.bl-plan').screenshot({ path: `${OUT}/${name}-${TAG}.png` })
  if (!phone && w === 1920 && TAG === 'after') {
    await p.locator('[data-manage="reactivation"]').click(); await p.waitForTimeout(700)
    await p.screenshot({ path: `${OUT}/desktop-confirm-own-leads-after.png` })
    console.log('confirm', await p.evaluate(() => document.querySelector('[data-confirm-remove="reactivation"]')?.textContent))
  }
  await ctx.close()
}
await b.close()
