// P1002 — click-through proof of the deeper phone screens (390, light or dark). BASE=... node scripts/p1002-flow.mjs <outDir> [light|dark]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const BASE = process.env.BASE || 'http://localhost:5001'
const OUT = process.argv[2] || 'qa/p1002'; const scheme = process.argv[3] || 'light'
mkdirSync(OUT, { recursive: true })
const res = {}
const browser = await chromium.launch()
const ONLY = process.env.ONLY || ''
async function flow(name, url, steps) {
  if (ONLY && !ONLY.split(',').includes(name)) return
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: scheme })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage(); const errors = []
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|127\.0\.0\.1:1/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  p.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  await p.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1000)
  let n = 0
  for (const [label, fn] of steps) {
    try { await fn(p) } catch (e) { errors.push(`step "${label}": ${String(e).slice(0, 100)}`) }
    await p.waitForTimeout(700)
    const m = await p.evaluate(() => ({ vpx: document.querySelector('.ma-viewport')?.scrollLeft || 0, ox: document.documentElement.scrollWidth - innerWidth }))
    await p.screenshot({ path: join(OUT, `${name}-${++n}-${label}-${scheme}.png`) })
    res[`${name}-${n}-${label}`] = { ...m }
  }
  res[`${name}-errors`] = errors
  await ctx.close()
}
const scrollTab = y => p => p.evaluate(v => { for (const el of document.querySelectorAll('[data-ma-tab]')) if (!el.closest('[inert]')) el.scrollTo(0, v) }, y)
// Click the first visible, non-inert element whose own text (or aria-label) is `t` (or starts with it when `loose`).
const click = (t, loose) => async p => {
  const ok = await p.evaluate(([t, loose]) => {
    const els = [...document.querySelectorAll('button,a,[role=button],[role=tab],div,span,b,h3,h4')]
    const ok = e => !e.closest('[inert]') && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
    const own = e => (e.getAttribute('aria-label') || [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('') || e.textContent || '').trim()
    const hit = els.filter(ok).find(e => { const x = own(e); return loose ? x.startsWith(t) : x === t }) || els.filter(ok).find(e => (e.textContent || '').trim() === t)
    if (!hit) return false
    hit.click(); return true
  }, [t, loose])
  if (!ok) throw new Error(`no visible "${t}"`)
}
const navN = label => click(label)

await flow('ag-home', '/template', [['top', async () => {}], ['tiles', scrollTab(700)], ['tiles2', scrollTab(1400)]])
await flow('ag-leads', '/template/leads', [['top', async () => {}], ['lanes', scrollTab(500)], ['lanes2', scrollTab(1000)]])
await flow('ag-client', '/template/clients', [['list', async () => {}], ['client', click('Luis Ortega', true)], ['below', scrollTab(700)]])
await flow('ag-cal', '/template/calendar', [['week', async () => {}], ['nextweek', click('Next week', true)], ['callsheet', async p => { await click('This week', true)(p); await click('Gloria Santos', true)(p); await click('Open client')(p) }], ['openclient', scrollTab(600)]])
await flow('va-client', '/template/fulfillment?s=clients', [['list', async () => {}], ['client', click('Stage 4 of 5', true)], ['below', scrollTab(700)]])
await flow('va-cal', '/template/fulfillment/calendar', [['month', async () => {}], ['call', click('Gloria Santos', true)], ['actions', scrollTab(500)], ['openclient', click('Open client')], ['clientbelow', scrollTab(700)]])
await flow('va-today', '/template/fulfillment', [['top', async () => {}], ['below', scrollTab(500)], ['below2', scrollTab(1000)]])
await flow('ad-team', '/preview/admin', [['home', async () => {}], ['team', navN('Team')], ['calendar', click('Calendar')], ['rota', click('Rota')], ['timeoff', click('Time off')], ['hours', click('Hours & pay')]])
await flow('ad-home', '/preview/admin', [['top', async () => {}], ['mid', scrollTab(700)], ['low', scrollTab(1500)]])
await flow('ad-agent', '/preview/admin/agents', [['list', async () => {}], ['agent', click('Priya Shah', true)], ['access', scrollTab(900)]])
await browser.close()
writeFileSync(join(OUT, `flow-${scheme}.json`), JSON.stringify(res, null, 1))
for (const [k, v] of Object.entries(res)) { if (k.endsWith('errors') ? v.length : (v.vpx > 0 || v.ox > 0)) console.log('FLAG', k, JSON.stringify(v).slice(0, 300)) }
console.log('done', Object.keys(res).length)
