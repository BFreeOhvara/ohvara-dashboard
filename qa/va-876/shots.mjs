// P876 — QA shots at 1440 and 390, both themes, uBlock Origin Lite on (complete mode): the Overview without the shift
// bar; the phone open over the page; the phone slid away mid-call with the rail icon lit; merge with three people;
// the Pay page tabs; the Report a bug pop-up; admin's Bug reports list.
//   node qa/va-876/shots.mjs --base-url http://localhost:4876 --ubo <uBO Lite folder holding manifest.json>
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

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo876-')), {
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

const F = p => `${BASE}/template/fulfillment${p}`
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    if (flag('--only') && flag('--only') !== `${theme}-${w}`) continue
    const page = await ctx.newPage()
    await page.setViewportSize({ width: w, height: h })
    const errs = []; page.on('pageerror', e => errs.push(e.message))
    const go = async url => { await page.goto(url, { waitUntil: 'load' }); await page.evaluate(t => localStorage.setItem('ohvara-theme', t), theme); await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.tp-app', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1800) }
    const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) }); console.log(theme, w, name, JSON.stringify(await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, crash: !!document.querySelector('.ov-crash') })))) }
    const icon = w >= 1000 ? '.fs-ri-phone' : '.fs-top-phone'

    await go(F(''))
    await page.evaluate(() => localStorage.removeItem('ohvara-bug-reports:v1'))
    await shot('overview')
    await page.click(icon); await page.waitForTimeout(500)
    await shot('phone-open')
    await page.locator('.fs-call .fs-ph-todo .fs-rb.is-go').first().click(); await page.waitForTimeout(800)
    await page.click('.fs-call button[aria-label="Add a carrier or the agent to the call"]')
    await page.locator('.fs-cs-sheet .fx-mrow:has(svg.lucide-building2)').first().click()
    await page.waitForTimeout(2800)
    await page.click('.fs-call .fs-cs-merge'); await page.waitForTimeout(400)
    await page.locator('.fs-cs-line').scrollIntoViewIfNeeded()
    await shot('merge-three')
    await page.click('.fs-call-tab'); await page.waitForTimeout(800)
    await shot('slid-away-live')

    await go(F('/pay'))
    await shot('pay-tabs')
    if (w >= 1000) await page.click('.fx-rail button[aria-label="Help and support"]')
    else { await page.click('.fx-bar button[aria-label="More"]'); await page.waitForTimeout(300); await page.goto(F('/pay')); await page.waitForTimeout(1500); await page.evaluate(() => document.querySelector('.fx-rail button[aria-label="Help and support"]')?.click()) }
    await page.waitForTimeout(400)
    await page.click('button:has-text("Report a bug")'); await page.waitForSelector('textarea', { state: 'visible' }); await page.waitForTimeout(600)
    await page.fill('textarea >> nth=0', 'The Payouts tab shows a grey block behind the 4')
    await page.fill('textarea >> nth=1', 'Just the number, no block')
    await shot('report-bug')
    await page.click('button:has-text("Send")'); await page.waitForTimeout(400)

    await page.goto(`${BASE}/preview/admin/settings?tab=bugs`, { waitUntil: 'load' }); await page.waitForTimeout(2200)
    await page.locator('.adm-bugs').scrollIntoViewIfNeeded().catch(() => {})
    await shot('admin-bugs')
    console.log(theme, w, 'errors', errs.length ? errs.join(' | ') : 'none')
    await page.close()
  }
}
await ctx.close()
