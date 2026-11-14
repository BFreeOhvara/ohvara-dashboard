// P1002 — phone sweep: opens each phone screen at 390 (light + dark), records console errors + horizontal overflow,
// saves PNGs. BASE=http://localhost:5001 node scripts/p1002-shots.mjs <outDir> [filter]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const BASE = process.env.BASE || 'http://localhost:5001'
const OUT = process.argv[2] || 'qa/p1002'
const FILTER = process.argv[3] || ''
mkdirSync(OUT, { recursive: true })
const R = [
  ['va-today', '/template/fulfillment'], ['va-clients', '/template/fulfillment?s=clients'], ['va-calendar', '/template/fulfillment/calendar'],
  ['va-rota', '/template/fulfillment/schedule'], ['va-messages', '/template/fulfillment/messages'], ['va-me', '/template/fulfillment/more'],
  ['va-pay', '/template/fulfillment/pay'], ['va-search', '/template/fulfillment?s=search'], ['va-settings', '/template/fulfillment/settings'],
  ['ag-home', '/template'], ['ag-leads', '/template/leads'], ['ag-calendar', '/template/calendar'], ['ag-messages', '/template/messages'],
  ['ag-help', '/template/more'], ['ag-clients', '/template/clients'],
  ['ad-home', '/preview/admin'], ['ad-team', '/preview/admin/team'], ['ad-agents', '/preview/admin/agents'], ['ad-messages', '/preview/admin/messages'],
  ['ad-you', '/preview/admin/settings'], ['ad-setup', '/preview/admin/setup'], ['ad-numbers', '/preview/admin/numbers'],
  ['ad-compliance', '/preview/admin/compliance'], ['ad-help', '/preview/admin?s=help'],
]
const out = {}
const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  for (const [name, url] of R) {
    if (FILTER && !name.includes(FILTER)) continue
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: scheme })
    await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
    const p = await ctx.newPage(); const errors = []
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|127\.0\.0\.1:1/.test(m.text())) errors.push(m.text().slice(0, 160)) })
    p.on('pageerror', e => errors.push(String(e).slice(0, 160)))
    await p.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {})
    await p.waitForTimeout(1200)
    const m = await p.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), vpx: document.querySelector('.ma-viewport')?.scrollLeft || 0, overflowX: document.documentElement.scrollWidth - innerWidth, crash: !!document.querySelector('.ov-crash'), title: document.title, text: document.body.innerText.slice(0, 60).replace(/\s+/g, ' ') }))
    await p.screenshot({ path: join(OUT, `${name}-${scheme}.png`) })
    out[`${name}-${scheme}`] = { url, ...m, errors }
    await ctx.close()
  }
}
await browser.close()
writeFileSync(join(OUT, 'results.json'), JSON.stringify(out, null, 1))
const bad = Object.entries(out).filter(([, v]) => v.errors.length || v.overflowX > 0 || v.vpx > 0 || v.crash)
console.log(`${Object.keys(out).length} views, ${bad.length} flagged`)
for (const [k, v] of bad) console.log(k, 'overflow', v.overflowX, 'crash', v.crash, v.errors.slice(0, 2).join(' | '))
