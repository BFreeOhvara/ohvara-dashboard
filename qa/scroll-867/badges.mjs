// P867 C — click every tab that carries a count, in all three portals, and check its badge keeps the neutral count
// look when selected. Usage: node qa/scroll-867/badges.mjs http://localhost:5867 [dark|light]
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5867'
const THEME = process.argv[3] || 'dark'
const ONLY = process.argv[4]
const PAGES0 = [
  '/preview/admin', '/preview/admin/agents', '/preview/admin/setup', '/preview/admin/fulfillment', '/preview/admin/inbounds',
  '/preview/admin/pipeline', '/preview/admin/billing', '/preview/admin/messages', '/preview/admin/settings', '/preview/admin/connect',
  '/template', '/template/leads', '/template/calendar', '/template/clients', '/template/activity', '/template/billing', '/template/messages', '/template/settings',
  '/template/fulfillment', '/template/fulfillment/leads', '/template/fulfillment/schedule', '/template/fulfillment/pipeline',
  '/template/fulfillment/servicing', '/template/fulfillment/pay', '/template/fulfillment/messages', '/template/fulfillment/settings',
]
const PAGES = ONLY ? PAGES0.filter(p => p.includes(ONLY)) : PAGES0

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: THEME })
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, THEME)
const groups = new Map()
let bad = 0
for (const path of PAGES) {
  const page = await ctx.newPage()
  await page.goto(BASE + path, { waitUntil: 'load' })
  await page.waitForTimeout(1400)
  const n = await page.locator('.fx-pt:has(> b.fx-pt-n), .fx-pt:has(.fx-tb)').count()
  for (let i = 0; i < n; i++) {
    const tab = page.locator('.fx-pt:has(> b.fx-pt-n), .fx-pt:has(.fx-tb)').nth(i)
    if (!(await tab.isVisible())) { console.log('HIDDEN', path, i, await tab.textContent()); continue }
    const isNav = await tab.evaluate(el => el.tagName === 'A')
    if (!isNav) await tab.click({ force: true }).catch(() => {})
    else { await tab.click({ force: true }).catch(() => {}); await page.waitForTimeout(700) }
    await page.waitForTimeout(250)
    const r = await page.locator('.fx-pt:has(> b.fx-pt-n), .fx-pt:has(.fx-tb)').nth(i).evaluate(el => {
      const b = el.querySelector(':scope > b.fx-pt-n, .fx-tb')
      const probe = document.createElement('i')
      probe.style.cssText = 'position:absolute;background:var(--sh-count);color:var(--sh-count-ink)'
      b.parentElement.appendChild(probe)
      const want = getComputedStyle(probe)
      const got = getComputedStyle(b)
      const out = { group: el.parentElement.getAttribute('aria-label') || el.closest('[aria-label]')?.getAttribute('aria-label') || '?', tab: el.textContent.trim(), on: el.classList.contains('is-on'),
        ok: got.backgroundColor === want.backgroundColor && got.color === want.color, got: got.backgroundColor + ' / ' + got.color, want: want.backgroundColor + ' / ' + want.color }
      probe.remove()
      return out
    }).catch(e => { console.log('ERR', path, i, String(e).slice(0, 160)); return null })
    if (!r) continue
    const key = `${path} · ${r.group}`
    groups.set(key, [...(groups.get(key) || []), r.tab])
    if (!r.on || !r.ok) { if (!r.ok) bad++; console.log(`${r.ok ? 'ok  ' : 'BAD '} ${key} · "${r.tab}" selected=${r.on} badge ${r.got} (count tokens ${r.want})`) }
    if (isNav) { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForTimeout(900) }
  }
  await page.close()
}
for (const [k, tabs] of groups) console.log(`group ${k}: ${tabs.join(', ')}`)
console.log(`${THEME}: ${bad} badge(s) with the selected look`)
await browser.close()
process.exit(bad ? 1 : 0)
