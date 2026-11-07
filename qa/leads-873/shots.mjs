// P873 — the lead path shots: Leads stage tabs + board, a lead's timeline, Needs you now, the outcome prompt, and
// Submit's lead suggestions, at 1440 and 390, with uBlock Origin Lite on (complete mode). Also runs the flow
// Mark outcome → Sold → Submit for servicing → the form filled from the lead.
//   node qa/leads-873/shots.mjs --base-url http://localhost:5873 --ubo <uBO Lite folder holding manifest.json>
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

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo873-')), {
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

const fails = []
const check = (ok, what) => { if (!ok) fails.push(what) }
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: w, height: h })
  const go = async p => { await page.goto(`${BASE}/template${p}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900) }
  const shot = async name => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, `${name}-${w}.png`) }) }
  const base = () => page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, crash: !!document.querySelector('.ov-crash') }))

  // 1. Leads: stage tabs + the seven lanes.
  await go('/leads')
  const leads = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.lc-stages > *')].map(b => b.textContent),
    lanes: [...document.querySelectorAll('.fx-lane')].map(l => l.getAttribute('aria-label')),
    hidden: [...document.querySelectorAll('.fx-lane, .fx-lcard, .lc-stages')].filter(e => getComputedStyle(e).display === 'none').length,
    tabsFit: (() => { const t = document.querySelector('.lc-stages'); return [t.scrollWidth, t.clientWidth] })(),
  }))
  console.log(w, 'leads', JSON.stringify({ ...leads, ...(await base()) }))
  check(leads.lanes.length === 7 && leads.tabs.length === 8 && leads.hidden === 0, `${w} leads board`)
  await shot('leads-tabs')
  await page.click('.lc-stages >> text=Closed')
  const one = await page.evaluate(() => ({ url: location.search, lanes: document.querySelectorAll('.fx-lane').length, cards: document.querySelectorAll('.fx-lcard').length }))
  console.log(w, 'closed tab', JSON.stringify(one))
  check(one.lanes === 1 && one.cards === 3 && one.url === '?lane=closed', `${w} closed tab`)

  // 2. A lead's timeline (Ellen: booked, replied, reminders, appointment ended).
  await go('/leads/sample-lead-8')
  const tl = await page.evaluate(() => ({ rows: document.querySelectorAll('.lc-ev').length, texts: document.querySelectorAll('.lc-bub').length, scheduled: document.querySelectorAll('.lc-ev.is-later').length, preview: document.querySelectorAll('.lc-bub small').length, nudge: !!document.querySelector('.lc-nudge') }))
  console.log(w, 'timeline', JSON.stringify({ ...tl, ...(await base()) }))
  check(tl.rows >= 9 && tl.texts >= 5 && tl.nudge, `${w} timeline`)
  await page.locator('.lc-tl').scrollIntoViewIfNeeded()
  await page.evaluate(() => document.querySelector('.lc-tl').scrollIntoView({ block: 'start' }))
  await shot('lead-timeline')

  // 3. The outcome prompt, from the lead's "How did it go?".
  await page.click('.lc-nudge')
  await page.click('[role=radiogroup] >> text=Showed')
  await page.click('[role=radiogroup] >> text=Sold')
  const oc = await page.evaluate(() => ({ title: [...document.querySelectorAll('.tp-drawer h2, [role=dialog] h2')].map(e => e.textContent), choices: [...document.querySelectorAll('[role=radiogroup] [role=radio]')].map(b => b.textContent) }))
  console.log(w, 'outcome', JSON.stringify(oc))
  check(oc.choices.join() === 'Showed,No-show,Sold,Follow up,Not interested', `${w} outcome choices`)
  await shot('outcome-prompt')
  if (w === 1440) {
    await page.click('button:has-text("Mark sold")')
    await page.click('a:has-text("Submit for servicing")')
    await page.waitForTimeout(900)
    const sub = await page.evaluate(() => ({ url: location.pathname + location.search, name: document.querySelector('input[placeholder="First and last name"]')?.value, phone: document.querySelector('input[type=tel]')?.value, linked: document.querySelector('.lc-linked')?.textContent }))
    console.log(w, 'sold → submit', JSON.stringify(sub))
    check(sub.name === 'Ellen Park' && sub.phone === '(919) 555-0164' && /Your lead/.test(sub.linked || ''), 'sold → submit prefill')
  }

  // 4. Needs you now on the Overview, and the bell.
  await go('')
  const nn = await page.evaluate(() => ({ order: [...document.querySelectorAll('.fx-ovl-needs [data-trigger]')].map(e => e.dataset.trigger), actions: [...document.querySelectorAll('.fx-ovl-needs .lc-ncard button')].map(b => b.textContent), fyi: document.querySelectorAll('.fx-ovl-needs .lc-fyi li').length }))
  console.log(w, 'needs now', JSON.stringify({ ...nn, ...(await base()) }))
  check(nn.order.join() === 'live,starting,outcome,reply,follow,servicing', `${w} needs order`)
  await page.locator('.fx-ovl-needs').scrollIntoViewIfNeeded()
  await shot('needs-now')
  await page.click('.is-bell >> visible=true')
  await page.waitForTimeout(500)
  const bell = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.lc-rows [data-trigger]')].map(e => e.dataset.trigger), fyi: document.querySelectorAll('.lc-fyi li').length }))
  console.log(w, 'bell', JSON.stringify(bell))
  check(bell.rows.length === 6, `${w} bell rows`)
  await page.keyboard.press('Escape')

  // 5. Submit suggests your leads.
  await go('/submit')
  await page.click('input[placeholder="First and last name"]')
  await page.keyboard.type('Ro')
  const sg = await page.evaluate(() => ({ items: [...document.querySelectorAll('.lc-sugg [role=option]')].map(o => o.innerText.replace(/\n/g, ' | ')) }))
  console.log(w, 'suggestions', JSON.stringify({ ...sg, ...(await base()) }))
  check(sg.items.length >= 2, `${w} suggestions`)
  await page.evaluate(() => document.querySelector('.lc-sugg').scrollIntoView({ block: 'center' }))
  await shot('submit-suggestions')
  await page.keyboard.press('Enter')
  const filled = await page.evaluate(() => ({ name: document.querySelector('input[placeholder="First and last name"]').value, linked: !!document.querySelector('.lc-linked') }))
  console.log(w, 'picked', JSON.stringify(filled))
  check(filled.linked, `${w} pick fills`)
  await page.fill('input[placeholder="First and last name"]', 'Zed Nobody')
  console.log(w, 'no match', await page.textContent('.lc-sugg-none').catch(() => 'none shown'))
  await page.close()
}
console.log(fails.length ? `FAIL ${fails.join('; ')}` : 'ALL CHECKS PASS')
await ctx.close()
