import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

// P908 QA: the phone build (below 768 px at the real /template addresses), every screen at 390 and 430, light and dark. Full-page shots for pages,
// the viewport for sheets. Numbers: sideways scroll, tap targets under 44 px, text under 16 px (outside chips/badges).
//   node qa/p908/shots.mjs http://localhost:4908 [onlyWidth]
const [BASE = 'http://localhost:4908', ONLY] = process.argv.slice(2)
const OUT = 'qa/p908/shots'
mkdirSync(OUT, { recursive: true })
const SCREENS = [
  ['01-overview', '/template'],
  ['02-leads-booked', '/template/leads'],
  ['03-leads-follow-up', '/template/leads?lane=follow'],
  ['04-lead-sheet', '/template/leads/sample-lead-1', { sheet: true }],
  ['05-lead-pick-result', '/template/leads/sample-lead-8?outcome=1', { sheet: true }],
  ['06-clients', '/template/clients'],
  ['07-client-sheet', '/template/clients/sample-client-3', { sheet: true }],
  ['08-client-app-link', '/template/clients/sample-client-3', { sheet: true, click: '.mx-sheet-f .mx-btn:not(.is-primary)' }],
  ['09-calendar', '/template/calendar'],
  ['10-calendar-call', '/template/calendar', { sheet: true, click: '.mx-ev .mx-cover' }],
  ['11-more', '/template/more'],
  ['12-billing', '/template/billing'],
  ['13-activity', '/template/activity'],
  ['14-settings', '/template/settings'],
  ['15-submit', '/template/submit'],
  ['16-request-service', '/template/request-service'],
  ['17-messages', '/template/messages'],
  ['17b-messages-thread', '/template/messages', { click: '.tp-thread:nth-child(2)' }],
  ['18-create', '/template', { sheet: true, click: '.mx-fab' }],
  ['19-bell', '/template', { sheet: true, click: '.mx-top .mx-ib[aria-label^="Your to-dos"]' }],
  ['20-spend-sheet', '/template/leads', { sheet: true, click: '.mx-pill[aria-label^="Change your daily"]' }],
]
const WIDTHS = ONLY ? [Number(ONLY)] : [390, 430]
const browser = await chromium.launch()
const report = []
for (const theme of ['dark', 'light']) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme })
    await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* sample */ } }, theme)
    await ctx.route(/127\.0\.0\.1:1|supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
    const page = await ctx.newPage()
    for (const [name, path, o = {}] of SCREENS) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      if (o.click) { await page.click(o.click); await page.waitForTimeout(500) }
      const m = await page.evaluate(() => {
        const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]') && !el.closest('.mx-lane[aria-hidden="true"]') }
        const top = document.querySelector('.mx-layer:last-of-type') || document
        const small = [...top.querySelectorAll('button, a, input, textarea, [role="tab"]')].filter(vis).filter(el => !el.classList.contains('mx-cover'))
          .map(el => { const r = el.getBoundingClientRect(); return { t: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) } })
          .filter(x => x.h < 44 || x.w < 44)
        const tiny = [...top.querySelectorAll('p, span, b, small, dd, li, h2, h3')].filter(vis)
          .filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
          .filter(el => !el.closest('.mx-tab, .mx-badge, .mx-tag, .tp-chip, .mx-stab span, .mx-count, .mx-foot, .tp-av, .mx-me, .mx-dots, .tp-pending'))
          .map(el => ({ t: el.textContent.trim().slice(0, 24), px: parseFloat(getComputedStyle(el).fontSize) })).filter(x => x.px < 16)
        return { sideways: document.documentElement.scrollWidth > innerWidth, small: small.slice(0, 8), tiny: [...new Set(tiny.map(x => `${x.px}:${x.t}`))].slice(0, 8) }
      })
      report.push({ name, w, theme, ...m })
      const h = w === 390 ? 844 : 932
      if (!o.sheet) {
        // A tall window instead of fullPage, so the tab bar sits at the bottom and the swipe pager stays on its status.
        const full = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewportSize({ width: w, height: Math.max(h, full) })
        await page.waitForTimeout(300)
        await page.evaluate(() => { const p = document.querySelector('.mx-pager'); const on = p && [...p.children].findIndex(c => c.getAttribute('aria-hidden') === 'false'); if (p && on >= 0) p.scrollTo({ left: on * p.clientWidth, behavior: 'instant' }) })
        await page.waitForTimeout(200)
      }
      await page.screenshot({ path: `${OUT}/${name}-${w}-${theme}.png` })
      await page.setViewportSize({ width: w, height: h })
    }
    await ctx.close()
  }
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
const bad = report.filter(r => r.sideways)
console.log(`shots ${report.length}, sideways ${bad.length}${bad.length ? ` (${bad.map(b => `${b.name}@${b.w}`).join(', ')})` : ''}`)
for (const r of report.filter(x => x.theme === 'dark' && x.w === WIDTHS[0])) console.log(r.name, 'small:', JSON.stringify(r.small), 'tiny:', JSON.stringify(r.tiny))
