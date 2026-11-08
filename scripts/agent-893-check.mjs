// P893 checks (sample data, http://localhost:5293): inert Overview items, the avatar toggle, Submit required vs optional.
import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const out = {}
await p.goto('http://localhost:5293/template', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
out.inert = await p.evaluate(() => {
  const q = s => [...document.querySelectorAll(s)]
  const clickables = sel => q(`${sel} a, ${sel} button`).length
  const ptr = sel => q(`${sel} *`).filter(e => getComputedStyle(e).cursor === 'pointer').length
  return { book: [clickables('.fx-ringstats'), ptr('.fx-ringstats'), q('.fx-ovl-book a').length], next: [q('.fx-ovl-next a, .fx-ovl-next button').map(e => e.textContent.trim() || e.getAttribute('aria-label')), ptr('.fx-later')], mix: [clickables('.fx-mix-key'), ptr('.fx-mix-key'), q('.fx-ovl-mix a').length], fyi: q('.lc-fyi').length, call: q('.fx-ovl-next a').some(a => /Call/.test(a.textContent)), weekDays: q('.fx-wk > li').length }
})
const me = '.fx-top .fx-me'
out.hoverCursor = await p.locator(me).evaluate(e => getComputedStyle(e).cursor)
await p.click(me); await p.waitForTimeout(450)
out.open = await p.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { exp: e.getAttribute('aria-expanded'), top: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e, menu: !!document.querySelector('.fx-menu'), transform: getComputedStyle(e).transform } }, me)
await p.screenshot({ path: 'qa/p893/after/avatar-open-1440.png', clip: { x: 1040, y: 0, width: 400, height: 380 } })
await p.click(me); await p.waitForTimeout(60)
out.closing = await p.evaluate(() => ({ leaving: !!document.querySelector('.fx-menu-layer.is-leaving'), anim: getComputedStyle(document.querySelector('.fx-menu') || document.body).animationName }))
await p.waitForTimeout(400)
out.closed = await p.evaluate(s => ({ menu: !!document.querySelector('.fx-menu'), exp: document.querySelector(s).getAttribute('aria-expanded') }), me)
// Submit: required vs optional
await p.goto('http://localhost:5293/template/submit', { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
out.clientLabels = await p.evaluate(() => [...document.querySelectorAll('.fx-sub-body .tp-field > span')].map(e => e.textContent))
await p.click('.fx-sub-f .tp-primary'); await p.waitForTimeout(300)
out.clientBad = await p.evaluate(() => [...document.querySelectorAll('.fx-sub-body .tp-danger, .fx-sub-body [aria-invalid="true"], .fx-sub-body .is-bad')].length)
out.needed = await p.evaluate(() => [...document.querySelectorAll('.fx-sub-check li')].map(e => e.textContent))
console.log(JSON.stringify(out, null, 1)); await b.close()
