// P1029 proof (sample mode, Test Agent): the four agent-portal desktop changes + phone unchanged.
//   BASE=http://localhost:5029 node scripts/p1029-shots.mjs <outDir> <tag: before|after>
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const BASE = process.env.BASE || 'http://localhost:5029'
const OUT = process.argv[2] || 'qa/p1029'
const TAG = process.argv[3] || 'before'
mkdirSync(OUT, { recursive: true })
const b = await chromium.launch()
const res = {}
const open = async (w, h, scheme = 'light', phone = false) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: phone, isMobile: phone })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push(String(e).slice(0, 160)))
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|127\.0\.0\.1:1/.test(m.text())) p.errs.push(m.text().slice(0, 160)) })
  return p
}
const go = async (p, url) => { await p.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500) }
const shot = (p, name, sel) => (sel ? p.locator(sel).first().screenshot({ path: `${OUT}/${name}-${TAG}.png` }) : p.screenshot({ path: `${OUT}/${name}-${TAG}.png` }))
// desktop
for (const scheme of ['light']) {
  const p = await open(1440, 900, scheme)
  await go(p, '/template')
  await shot(p, 'desktop-overview-hero', '.fx-ovl-hero')
  res.hero = await p.evaluate(() => ({ text: document.querySelector('.fx-ovl-hero')?.innerText.replace(/\s+/g, ' ').slice(0, 300) }))
  const pick = async n => {
    const f = await p.$('.fx-wkf')
    if (!f) return false
    await f.click(); await p.waitForTimeout(300)
    await p.locator('.fx-selopt', { hasText: `Last ${n} weeks` }).first().click(); await p.waitForTimeout(700)
    return true
  }
  for (const n of [4, 12, 8]) {
    if (await pick(n)) {
      res[`ticks${n}`] = await p.evaluate(() => [...document.querySelectorAll('.fx-ovl-hero .ox-tick')].map(e => e.textContent).join(','))
      await shot(p, `desktop-overview-hero-${n}w`, '.fx-ovl-hero')
    }
  }
  await go(p, '/template/leads')
  const ids = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/leads/"], [data-lead]')].map(e => e.getAttribute('href') || e.getAttribute('data-lead')))])
  res.leadLinks = ids
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await go(p, `/template/leads/sample-lead-${id}`)
    const n = await p.evaluate(() => ({ bubbles: document.querySelectorAll('.lc-bub, .lt-bub').length, sent: document.querySelectorAll('.lc-bub.me, .lt-bub.is-us').length }))
    res[`lead${id}`] = n
    if (n.bubbles) { const t = p.locator('.lt-thread, .lc-tl').first(); await t.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300); await t.screenshot({ path: `${OUT}/desktop-lead${id}-thread-${TAG}.png` }).catch(() => {}) }
    if (id === 7) await p.screenshot({ path: `${OUT}/desktop-lead7-drawer-${TAG}.png` })
  }
  await go(p, '/template/billing')
  await shot(p, 'desktop-billing-plan', '.bl-plan')
  res.billing = await p.evaluate(() => ({ plan: document.querySelector('.bl-plan')?.innerText.replace(/\s+/g, ' ') }))
  await go(p, '/template/clients')
  await shot(p, 'desktop-clients-books', '[data-check-box]')
  res.clients = await p.evaluate(() => ({ rows: document.querySelectorAll('[data-check-box] .ck-rows li').length, more: document.querySelector('[data-check-more]')?.textContent }))
  res.errs = p.errs
}
// phone
{
  const p = await open(390, 844, 'light', true)
  for (const [n, u] of [['home', '/template'], ['leads', '/template/leads'], ['clients', '/template/clients'], ['more', '/template/more']]) {
    await go(p, u); await p.screenshot({ path: `${OUT}/phone-${n}-${TAG}.png` })
  }
  await go(p, '/template/billing'); await p.screenshot({ path: `${OUT}/phone-billing-${TAG}.png` })
  res.phoneErrs = p.errs
}
await b.close()
writeFileSync(`${OUT}/results-${TAG}.json`, JSON.stringify(res, null, 1))
console.log(JSON.stringify(res, null, 1))
