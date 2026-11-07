// P879 — QA shots at 1440 and 390, both themes, uBlock Origin Lite on (complete mode). Admin: Live desk, Hours & pay,
// Quality, Records, Time off (swaps), the agent drawer (Pilot + Campaign), Pilot results, an Unassigned lead (consent
// proof), Compliance. VA: Overview (clock), a lead drawer (opted out, Check agent, outcome), Pay (hourly), Schedule.
//   node qa/fe-879/shots.mjs --base-url http://localhost:4879 --ubo <uBO Lite folder holding manifest.json>
import { chromium } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const BASE = flag('--base-url')
const UBO = flag('--ubo')
const OUT = dirname(fileURLToPath(import.meta.url))

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo879-')), {
  headless: false, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${UBO}`, `--load-extension=${UBO}`],
})
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null)
if (!sw) { console.log('FAIL blocker did not load'); await ctx.close(); process.exit(1) }
const ext = await ctx.newPage()
await ext.goto(`chrome-extension://${new URL(sw.url()).host}/dashboard.html`)
console.log('blocker level', await ext.evaluate(() => chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: 3 })))
await ext.close()
await new Promise(r => setTimeout(r, 3000))

const A = p => `${BASE}/preview/admin${p}`
const F = p => `${BASE}/template/fulfillment${p}`
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    if (flag('--only') && flag('--only') !== `${theme}-${w}`) continue
    const page = await ctx.newPage()
    await page.setViewportSize({ width: w, height: h })
    const errs = []; page.on('pageerror', e => errs.push(e.message))
    const go = async url => { await page.goto(url, { waitUntil: 'load' }); await page.evaluate(t => localStorage.setItem('ohvara-theme', t), theme); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800) }
    const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) }); console.log(theme, w, name, JSON.stringify(await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, crash: !!document.querySelector('.ov-crash'), blank: document.body.innerText.trim().length < 80 })))) }
    const into = async sel => { await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(300) }

    if (!args.includes('--va')) {
    for (const [tab, name] of [['desk', 'admin-desk'], ['pay', 'admin-hours'], ['quality', 'admin-quality'], ['records', 'admin-records'], ['requests', 'admin-timeoff']]) {
      await go(A(`/fulfillment?tab=${tab}`))
      if (tab === 'requests') await into('[aria-label="Shift swaps"]')
      await shot(name)
    }
    await go(A('/agents/ag-priya')); await into('[aria-label="Pilot"], .fx-blk:has-text("Pilot")')
    await page.locator('h3:has-text("Pilot")').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot('admin-agent-pilot')
    await go(A('/billing?tab=pilot')); await shot('admin-pilot-results')
    await go(A('/inbounds')); await page.locator('.fx-lcard:has-text("No agent") .fx-cover').first().click(); await page.waitForTimeout(900)
    await page.locator('h3:has-text("Unassigned")').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot('admin-unassigned')
    await page.locator('h3:has-text("Consent proof")').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot('admin-consent')
    await go(A('/settings?tab=compliance')); await shot('admin-compliance')
    }

    await go(F('')); await shot('va-overview')
    await go(F('/leads/vq-4'))
    await page.locator('button:has-text("Take it")').first().click().catch(() => {}); await page.waitForTimeout(600)
    await shot('va-lead-flags')
    await page.locator('h3:has-text("Check the agent")').first().scrollIntoViewIfNeeded().catch(() => {})
    await page.locator('button:has-text("Check agent")').first().click().catch(() => {}); await page.waitForTimeout(5200)
    await shot('va-check-agent')
    await page.locator('h3:has-text("Outcome")').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot('va-outcome')
    await go(F('/leads')); await shot('va-queue-tasks')
    await go(F('/pay')); await shot('va-pay')
    await go(F('/schedule')); await into('[aria-label="Swaps and open shifts"]'); await shot('va-schedule')
    console.log(theme, w, 'errors', errs.length ? errs.join(' | ') : 'none')
    await page.close()
  }
}
await ctx.close()
