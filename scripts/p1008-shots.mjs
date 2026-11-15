// P1008 proof: admin phone Setup > What GoHighLevel set up, Audit log (390 wide, light + dark); agent phone Leads empty state.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const BASE = process.env.BASE || 'http://localhost:5173'
const OUT = process.argv[2] || 'qa/p1008'
mkdirSync(OUT, { recursive: true })
const res = {}
const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: scheme })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage(); const errors = []
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  p.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  const measure = async name => { res[`${name}-${scheme}`] = await p.evaluate(() => ({ ox: document.documentElement.scrollWidth - innerWidth, vpx: document.querySelector('.ma-viewport')?.scrollLeft || 0 })) }
  // Setup tickets, then the sample of what GoHighLevel set up
  await p.goto(BASE + '/preview/admin?s=tickets', { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(900)
  const sample = p.getByText('See a sample', { exact: true }); if (await sample.count()) await sample.first().click()
  await p.waitForTimeout(500)
  const h = p.getByText('What GoHighLevel set up', { exact: true }).first()
  res[`ghl-present-${scheme}`] = await h.count()
  if (await h.count()) await h.scrollIntoViewIfNeeded()
  await p.waitForTimeout(400); await measure('ghl')
  await p.screenshot({ path: join(OUT, `ghl-1-${scheme}.png`) })
  res[`ghl-text-${scheme}`] = await p.evaluate(() => [...document.querySelectorAll('.am-ghl h2, .am-ghl .ma-h2 h2')].map(e => e.textContent))
  await p.evaluate(() => { const v = document.querySelector('.ma-scroll, .ma-page, main') ; const t = document.querySelector('.am-ghl .ma-list:last-of-type'); t?.scrollIntoView({ block: 'end' }) })
  await p.waitForTimeout(400); await p.screenshot({ path: join(OUT, `ghl-2-${scheme}.png`) })
  // Audit log from Help
  await p.goto(BASE + '/preview/admin?s=audit', { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(900)
  res[`audit-rows-${scheme}`] = await p.locator('.am-aud').count()
  await measure('audit'); await p.screenshot({ path: join(OUT, `audit-${scheme}.png`) })
  await p.locator('input[aria-label="Search the log"]').fill('zzzz-none'); await p.waitForTimeout(300)
  res[`audit-search-empty-${scheme}`] = await p.locator('.am-aud').count()
  // Help row opens it
  await p.goto(BASE + '/preview/admin?s=help', { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(700)
  await p.getByText('Audit log', { exact: true }).first().click(); await p.waitForTimeout(600)
  res[`help-opens-audit-${scheme}`] = await p.locator('.am-aud').count()
  await p.screenshot({ path: join(OUT, `help-${scheme}.png`) })
  res[`errors-${scheme}`] = errors
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(res, null, 1))
