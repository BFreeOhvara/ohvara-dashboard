// P872 — QA shots at 1440 and 390 with uBlock Origin Lite on (complete mode): the phone open, closed and minimised
// mid-call; the Training home; one lesson (top and its picture); the check; admin Settings → Training.
//   node qa/va-872/shots.mjs --base-url http://localhost:4872 --ubo <uBO Lite folder holding manifest.json>
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

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo872-')), {
  headless: false, viewport: { width: 1440, height: 900 }, colorScheme: 'light',
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
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: w, height: h })
  const errs = []; page.on('pageerror', e => errs.push(e.message))
  const go = async url => { await page.goto(url, { waitUntil: 'load' }); await page.waitForSelector('.tp-app, .adm', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1600) }
  const shot = async name => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, `${name}-${w}.png`) }); console.log(w, name, JSON.stringify(await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, crash: !!document.querySelector('.ov-crash') })))) }

  await go(F(''))
  await page.evaluate(() => localStorage.removeItem('ful-training:v1'))
  await go(F('/leads'))
  await shot('phone-closed')
  await page.click('.fs-dock-btn'); await page.waitForSelector('.fs-phone')
  await shot('phone-open')
  await page.fill('.fs-ph-entry input', '5125550161'); await page.click('.fs-ph-dial:has-text("Call")')
  await page.waitForTimeout(3200)
  await page.click('.fs-phone .fx-x')
  await shot('phone-minimised')
  console.log(w, 'pill', await page.locator('.fs-dock-pill').innerText(), '| hang-up buttons in DOM:', await page.locator('.fs-ctl.is-end').count())

  await go(F('/training'))
  await shot('training-home')
  await go(F('/training/inbound'))
  await shot('lesson')
  await page.locator('.tr-portal').scrollIntoViewIfNeeded()
  await shot('lesson-picture')
  await page.click('button:has-text("Take the check")')
  const qs = page.locator('.tr-qs > li')
  await qs.nth(0).locator('.tr-opt').nth(1).click()
  await qs.nth(1).locator('.tr-opt').nth(1).click()
  await shot('check')

  await go(`${BASE}/preview/admin/settings?tab=training`)
  await page.click('.adm-tr-row:has-text("Keisha Grant")')
  await shot('admin-training')
  console.log(w, 'errors', errs.length ? errs.join(' | ') : 'none')
  await page.close()
}
await ctx.close()
