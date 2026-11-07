// P878 — QA shots at 1440 and 390, both themes, uBlock Origin Lite on (complete mode), for every agent and lead screen
// P878 changed. Prints overflow and page errors per shot.
//   node qa/fe-878/shots.mjs --base-url http://localhost:4878 --ubo <uBO Lite folder holding manifest.json> [--only dark-1440]
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
const T = p => `${BASE}/template${p}`

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo878-')), {
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

const SETUP = { step: 'spend', watched: 360, captions: true, lowData: false, licence: { npn: '19283746', states: ['TX'], attested: { TX: 'Nov 2, 2:14 PM' }, verified: 'x' }, products: 'both', calendar: { provider: null }, tz: 'America/Chicago', tzOk: true, week: { Mon: { on: true, start: '9:00 AM', end: '6:00 PM' }, Tue: { on: true, start: '9:00 AM', end: '6:00 PM' }, Wed: { on: true, start: '9:00 AM', end: '6:00 PM' }, Thu: { on: true, start: '9:00 AM', end: '6:00 PM' }, Fri: { on: true, start: '9:00 AM', end: '5:00 PM' }, Sat: { on: false, start: '9:00 AM', end: '6:00 PM' }, Sun: { on: false, start: '9:00 AM', end: '6:00 PM' } }, spend: { appts: 60, live: 40 }, push: null, terms: false }

for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    if (flag('--only') && flag('--only') !== `${theme}-${w}`) continue
    const page = await ctx.newPage()
    await page.setViewportSize({ width: w, height: h })
    const errs = []; page.on('pageerror', e => errs.push(e.message))
    const go = async (url, sel = '.tp-app') => {
      await page.goto(url, { waitUntil: 'load' })
      await page.evaluate(t => localStorage.setItem('ohvara-theme', t), theme)
      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector(sel, { timeout: 20000 }).catch(() => {})
      await page.waitForTimeout(1500)
    }
    const shot = async (name, full = false) => {
      await page.waitForTimeout(450)
      await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: full })
      const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, crash: !!document.querySelector('.ov-crash') }))
      console.log(theme, w, name, JSON.stringify(m), errs.length ? `ERR ${errs.splice(0).join(' | ')}` : '')
    }
    const click = async sel => { try { await page.locator(sel).first().click({ timeout: 5000 }); await page.waitForTimeout(500) } catch { console.log('  could not click', sel) } }

    await go(T(''))
    await shot('overview')
    await go(T('/leads'))
    await shot('leads-board')
    await go(T('/leads/sample-lead-15'))
    await shot('lead-drawer')
    await go(T('/calendar'))
    await click('button:has-text("Hours")')
    await shot('calendar-hours')
    await go(T('/submit?lead=sample-lead-16'))
    await page.locator('input[type=date]').first().fill('1971-03-14')
    await click('.fx-sub-f button:has-text("Next")')
    await click('button:has-text("Replaces a policy"), [aria-label="Replaces a policy"]')
    await click('button:has-text("Add a second insured")')
    await shot('submit-policy', true)
    await go(T('/activity?view=results'))
    await shot('results', true)
    await go(T('/billing'))
    await shot('billing-pilot', true)
    await go(T('/billing?plan=paid&billing=failed'))
    await shot('billing-paid', true)
    await go(T('/settings'))
    await click('button:has-text("Licence"), [role=tab]:has-text("Licence")')
    await shot('settings-licence')
    await go(T('/signup'), '.tp-solo')
    await click('button:has-text("Yes")')
    await shot('signup', true)
    await go(T('/welcome'), '.tp-solo')
    await page.evaluate(s => localStorage.setItem('ov-setup-878', JSON.stringify(s)), SETUP)
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500)
    await shot('setup-spend', true)
    await go(T('/d/book'), '.dd')
    await click('.dd-slots button:not([disabled])')
    await shot('deedstone-book', true)
    await go(T('/d/opt-out'), '.dd')
    await shot('deedstone-optout')
    await page.close()
  }
}
await ctx.close()
