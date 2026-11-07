// P868 — Submit a policy shots: phone mid-typing, state dropdown open, Book a call open, carrier type-ahead open, at
// 1440 and 390, with uBlock Origin Lite on (complete mode).
//   node qa/carriers-868/shots.mjs --base-url http://localhost:4868 --ubo <uBO Lite folder holding manifest.json>
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

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo868-')), {
  headless: false, viewport: { width: 1440, height: 900 }, colorScheme: 'light',
  args: [`--disable-extensions-except=${UBO}`, `--load-extension=${UBO}`],
})
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null)
if (!sw) { console.log('FAIL blocker did not load'); await ctx.close(); process.exit(1) }
const ext = await ctx.newPage()
await ext.goto(`chrome-extension://${new URL(sw.url()).host}/dashboard.html`)
console.log('blocker level', await ext.evaluate(() => chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: 3 })))
await ext.close()
await new Promise(r => setTimeout(r, 3000))

const out = []
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: w, height: h })
  await page.goto(`${BASE}/template/submit`, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[type=tel]')
  const shot = async name => { await page.waitForTimeout(450); const f = join(OUT, `${name}-${w}.png`); await page.screenshot({ path: f }); out.push(f) }
  const measure = async () => page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, crash: !!document.querySelector('.ov-crash') }))

  await page.fill('input[placeholder="First and last name"]', 'Ruth Ellison')
  await page.click('input[type=tel]')
  await page.keyboard.type('1512555')
  await page.locator('input[type=tel]').scrollIntoViewIfNeeded()
  console.log(w, 'phone mid-typing:', await page.inputValue('input[type=tel]'), JSON.stringify(await measure()))
  await shot('phone-typing')

  await page.click('button[aria-label^="State:"]')
  await page.keyboard.press('t')
  console.log(w, 'state active:', await page.textContent('.fx-selopt.is-active'))
  await shot('state-open')
  await page.click('.fx-selopt:has-text("Texas")')
  await page.fill('.fx-form-grid input:not([type=tel]):not([placeholder])', 'Austin')
  await page.click('input[type=tel]'); await page.keyboard.press('End'); await page.keyboard.type('0188')

  await page.click('[role=tab]:has-text("Book a call")')
  await page.click('button[aria-label^="Time (the client"]')
  console.log(w, 'times:', await page.locator('.fx-selopt').count())
  await shot('book-open')
  await page.locator('.fx-selopt:not(.is-disabled)').first().click()
  await page.click('button:has-text("Next")')

  await page.click('button[aria-label^="Carrier:"]')
  await page.keyboard.type('A')
  console.log(w, 'carriers for A:', (await page.locator('.fx-selopt b').allTextContents()).slice(0, 5).join(', '), JSON.stringify(await measure()))
  await shot('carrier-open')
  await page.close()
}
console.log(out.join('\n'))
await ctx.close()
