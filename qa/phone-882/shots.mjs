// P882 — QA shots of the VA phone on the sample (voice_live stays off; all Supabase traffic is aborted): the call
// screen (no recording, Do not call and Need help), a ring with its 15 s countdown, the wrap-up timer after End, and the
// To call list with the pre-dial check blocking two rows (opted out; Florida's 3-calls-a-day limit).
//   node qa/phone-882/shots.mjs --base-url http://localhost:4882
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const BASE = args[args.indexOf('--base-url') + 1]
const OUT = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()

for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    // deviceScaleFactor 1 keeps the 1440 shots at 1440 px wide; the 390 ones are small already.
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
    const p = await ctx.newPage()
    const errs = []; p.on('pageerror', e => errs.push(e.message))
    await p.goto(`${BASE}/template/fulfillment`, { waitUntil: 'load' })
    await p.evaluate(t => localStorage.setItem('ohvara-theme', t), theme)
    await p.reload({ waitUntil: 'load' })
    await p.waitForSelector('.tp-app', { timeout: 20000 }).catch(() => {})
    await p.waitForTimeout(1500)
    const measure = () => p.evaluate(() => {
      const box = document.querySelector('.fs-call')
      const inner = box ? [...box.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.getBoundingClientRect().right > box.getBoundingClientRect().right + 1).length : 0
      return { overflow: document.documentElement.scrollWidth > window.innerWidth, phoneOverflow: inner, crash: !!document.querySelector('.ov-crash'), recording: /recording/i.test(box?.innerText || '') }
    })
    const shot = async name => { await p.waitForTimeout(400); await p.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) }); console.log(name, w, theme, JSON.stringify(await measure())) }
    const icon = w >= 1000 ? '.fs-ri-phone' : '.fs-top-phone'

    // 1. To call: the blocked rows (Marcus opted out; Joyce at Florida's limit).
    await p.click(icon); await p.waitForTimeout(500)
    await p.locator('.fs-call .fs-ph-row.is-blocked').first().scrollIntoViewIfNeeded()
    console.log('blocked rows', await p.locator('.fs-call .fs-ph-row.is-blocked .fs-ph-block').allInnerTexts())
    await shot('todo-blocked')
    // 2. The call screen.
    await p.locator('.fs-call .fs-ph-b').evaluate(el => { el.scrollTop = 0 })
    await p.click('.fs-call .fs-ph-todo button[aria-label="Call Shirley Adams"]')
    await p.waitForTimeout(800)
    await shot('call')
    await p.click('.fs-call .fs-cs-dnc'); await p.waitForTimeout(300)
    await shot('dnc-confirm')
    await p.click('.fs-call .fs-cs-sheet button:has-text("Keep calling")')
    // 3. End → wrap-up with its timer, +60 s once.
    await p.click('.fs-call button[aria-label="End the call"]'); await p.waitForTimeout(1200)
    await p.click('.fs-call .fs-cs-wrap .fx-pillbtn')
    await shot('wrap')
    await p.click('.fs-call button:has-text("Save · Available")'); await p.waitForTimeout(400)
    // 4. A ring (Calls and more → Live call) with the 15 s countdown. Slide the phone away first (it covers the tab bar on a phone).
    await p.click('.fs-call-tab'); await p.waitForTimeout(500)
    await p.click('button[aria-label="Calls and more"] >> visible=true'); await p.waitForTimeout(300)
    await p.click('[role="menuitem"]:has-text("Live call")'); await p.waitForTimeout(2200)
    await shot('ring')
    console.log('errors', theme, w, errs.length ? errs.join(' | ') : 'none')
    await ctx.close()
  }
}
await browser.close()
