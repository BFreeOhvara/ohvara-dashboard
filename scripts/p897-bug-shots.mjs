// P897: proof the four VA bugs from P877 are fixed (sample data, Supabase blocked), at 1440 and 390 wide.
//   node scripts/p897-bug-shots.mjs [base] [outDir]
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:4897'
const OUT = process.argv[3] || 'C:/Users/freem/obsidian-mind/media/p897'
const b = await chromium.launch()
const out = {}
for (const [W, H] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, colorScheme: 'dark', isMobile: W < 500, hasTouch: W < 500 })
  await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(String(e)))
  const go = async () => { await p.goto(`${BASE}/template/fulfillment`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200) }
  const click = async sel => { await p.locator(sel).first().click(); await p.waitForTimeout(700) }
  const phone = () => p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Phone')?.click())
  const chipFit = name => p.evaluate(n => [...document.querySelectorAll(`[role=radiogroup][aria-label="${n}"] > *`)].map(c => ({ t: c.textContent, fits: c.scrollWidth <= c.clientWidth + 1 && c.scrollHeight <= c.clientHeight + 1 })), name)
  const r = {}
  // 1 + 4: How did it go? chips, then Cancelled with a confirmation number (the toast)
  await go(); await phone(); await p.waitForTimeout(600)
  await click('button[aria-label="Call Gloria Santos"]'); await p.waitForTimeout(800)
  await click('[aria-label="End the call"]')
  r.result = await chipFit('How did it go?')
  await p.screenshot({ path: `${OUT}/result-chips-${W}.png` })
  await p.locator('.fs-ph-call input').first().fill('GL-418820')
  await click('.fs-ph-call button:has-text("Save · Available")')
  r.toast = await p.locator('.tp-note-toast').first().innerText().catch(() => '')
  await p.screenshot({ path: `${OUT}/cancelled-toast-${W}.png` })
  // 3: Recent lists the saved call once
  await click('[role=tab]:has-text("Recent")')
  r.recentGloria = await p.locator('.fs-ph-recent li b', { hasText: 'Gloria Santos' }).count()
  await p.screenshot({ path: `${OUT}/recent-once-${W}.png` })
  // 2: Live transfer agent chips
  await go(); await phone(); await p.waitForTimeout(600)
  await click('button[aria-label="Call Angela Moore"]'); await p.waitForTimeout(800)
  await p.getByRole('button', { name: 'Transfer', exact: true }).first().click(); await p.waitForTimeout(700)
  r.agents = await chipFit('Agent')
  await p.screenshot({ path: `${OUT}/transfer-chips-${W}.png` })
  r.sideways = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  r.pageErrors = errs.length
  out[W] = r
  await ctx.close()
}
console.log(JSON.stringify(out, null, 1))
await b.close()
