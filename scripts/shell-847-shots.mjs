// P847 proof shots (sample pages under /template): fulfillment Messages, the agent's booking step (exact time and best
// time), Settings caller ID + time zone, the Overview clock (agent and fulfillment), an open dropdown with search, the
// VA Overview motion. 1440 and 390, light and dark. Also measures: no native select/datalist/date input in either shell,
// no page-wide sideways scroll, the clock ticks.
//   node scripts/shell-847-shots.mjs --base-url http://localhost:4847 [--out qa/shell-847]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/shell-847'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const fails = []
const fail = (w, m) => { fails.push(`${w}: ${m}`); console.log(`FAIL ${w}: ${m}`) }
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const T = '/template'

const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  for (const view of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: theme, reducedMotion: 'no-preference' })
    await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, theme)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error' && !/favicon|status of 40[34]/.test(m.text())) errors.push(m.text()) })
    const tag = `${view.w}-${theme}`
    const go = async url => { await page.goto(`${BASE}${T}${url}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1300) }
    const shot = name => page.screenshot({ path: `${OUT}/${name}-${tag}.png` })
    const measure = async where => {
      const m = await page.evaluate(() => ({
        native: document.querySelectorAll('select, datalist, input[type=date], input[type=time], input[type=datetime-local], input[type=month], input[type=week]').length,
        sideways: document.documentElement.scrollWidth - window.innerWidth,
      }))
      if (m.native) fail(`${where} ${tag}`, `${m.native} native pickers`)
      if (m.sideways > 1) fail(`${where} ${tag}`, `page scrolls sideways by ${m.sideways}px`)
    }

    // Overview clocks
    for (const [where, url] of [['agent-overview', ''], ['ful-overview', '/fulfillment']]) {
      await go(url)
      const a = await page.locator('.fx-clock').innerText().catch(() => '')
      if (!/\d:\d\d/.test(a) || !/(Central|Eastern|Mountain|Pacific|Alaska|Hawaii)/.test(a)) fail(`${where} ${tag}`, `clock missing: ${a}`)
      const s1 = await page.locator('.fx-clock-s').innerText().catch(() => '')
      await page.waitForTimeout(1300)
      const s2 = await page.locator('.fx-clock-s').innerText().catch(() => '')
      if (!s1 || s1 === s2) fail(`${where} ${tag}`, `clock did not tick (${s1} then ${s2})`)
      await measure(where)
      await shot(where)
    }

    // Fulfillment Messages: client first, agent under it
    await go('/fulfillment/messages')
    const head = await page.locator('.tp-conv-h .tp-grow').innerText()
    if (!head.startsWith('Gloria Santos') || !head.includes('Agent: Dana Walker') || head.includes('about')) fail(`ful-messages ${tag}`, `header: ${head.replace(/\n/g, ' | ')}`)
    await measure('ful-messages')
    await shot('ful-messages')

    // Agent booking step: cancellation call, exact time, then best time
    await go('')
    if (view.w >= 1000) await page.getByRole('button', { name: 'Book a call' }).first().click()
    else await page.locator('.fx-bar').getByRole('button', { name: 'Book' }).click()
    await page.waitForTimeout(500)
    { const r = page.getByRole('dialog').getByRole('radio', { name: 'Cancellation call' }); if (await r.isEnabled()) await r.click() }
    { const r = page.getByRole('dialog').getByRole('radio', { name: /Book a time with them/ }); if (await r.isEnabled()) await r.click() }
    await page.getByRole('dialog').getByRole('radio', { name: /^Fri/ }).click()
    await page.getByRole('button', { name: /^Time \(the client's time\):/ }).click()
    await page.waitForTimeout(450)
    await page.getByRole('option').nth(2).click()
    await page.waitForTimeout(400)
    const va = await page.locator('.fx-calltime-va').innerText()
    if (!/Goes to (Maya Brooks|Leo Grant|Sasha Ortiz|Devon Hale)/.test(va)) fail(`booking ${tag}`, `no VA shown: ${va}`)
    await measure('booking')
    await shot('booking-exact')
    await page.getByRole('radio', { name: /Best time to reach them/ }).click()
    await page.waitForTimeout(450)
    await shot('booking-window')
    await page.keyboard.press('Escape')

    // An open dropdown with search: the carrier list in the booking step
    await page.waitForTimeout(400)
    if (view.w >= 1000) await page.getByRole('button', { name: 'Book a call' }).first().click()
    else await page.locator('.fx-bar').getByRole('button', { name: 'Book' }).click()
    await page.waitForTimeout(400)
    { const r = page.getByRole('dialog').getByRole('radio', { name: 'Cancellation call' }); if (await r.isEnabled()) await r.click() }
    await page.getByRole('button', { name: /^Carrier they're leaving:/ }).click()
    await page.getByRole('combobox', { name: /Search Carrier they're leaving/ }).fill('li')
    await page.waitForTimeout(500)
    const opts = await page.getByRole('option').count()
    if (opts < 2) fail(`dropdown ${tag}`, `search left ${opts} options`)
    await page.keyboard.press('ArrowDown')
    await shot('dropdown-search')
    await page.keyboard.press('Escape')
    if (await page.locator('.fx-selmenu').count() && await page.locator('.fx-sel-layer:not(.is-leaving)').count()) fail(`dropdown ${tag}`, 'Escape did not close the list')
    await page.keyboard.press('Escape')

    // Settings: time zone (Profile) and caller ID (Active and calls)
    await go('/settings')
    await page.getByRole('button', { name: /^Time zone:/ }).click()
    await page.waitForTimeout(450)
    await shot('settings-timezone-open')
    await page.getByRole('option', { name: /Eastern/ }).first().click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('tab', { name: 'Active and calls' }).click()
    await page.waitForTimeout(400)
    await page.locator('.fx-callerid').scrollIntoViewIfNeeded()
    await shot('settings-callerid-notset')
    await page.getByRole('button', { name: 'Confirm this number' }).click()
    await page.waitForTimeout(400)
    await shot('settings-callerid-pending')
    await page.getByRole('button', { name: 'I typed the code' }).click()
    await page.waitForTimeout(400)
    const st = await page.locator('.fx-callerid-h').innerText()
    if (!st.includes('Confirmed')) fail(`callerid ${tag}`, 'did not reach Confirmed')
    await shot('settings-callerid-confirmed')
    // The saved zone shows on the Overview clock
    await page.goto(`${BASE}${T}`, { waitUntil: 'networkidle' }).catch(() => {})
    await measure('settings')

    // Fulfillment Settings time zone + Overview motion mid-way (the countdown ring, day ring, calls-per-hour line)
    await go('/fulfillment/settings')
    await page.getByRole('button', { name: /^Time zone:/ }).click()
    await page.waitForTimeout(450)
    await shot('ful-settings-timezone-open')
    await page.keyboard.press('Escape')
    await page.goto(`${BASE}${T}/fulfillment`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(450)
    await shot('ful-overview-motion-mid')
    const moving = await page.evaluate(() => document.getAnimations().length)
    if (!moving) fail(`ful-overview ${tag}`, 'no animations running on load')

    if (errors.length) fail(tag, `console: ${errors.slice(0, 3).join(' | ')}`)
    await ctx.close()
  }
}
await browser.close()
console.log(fails.length ? `${fails.length} failure(s)` : 'All checks passed.')
process.exit(fails.length ? 1 : 0)
