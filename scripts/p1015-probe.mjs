// P1015 probe: at 390 px, find every chip/tab/segment row on the phone screens that wraps or overflows.
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:5015'
const SEL = '.ma-chips, .ma-seg, .mx-seg, .mx-stabs, .va-chips, .va-seg, .ph-seg, .pb-row, [role=tablist], [role=radiogroup]'
const SCREENS = {
  agent: ['/template', '/template/leads', '/template/clients', '/template/calendar', '/template/more', '/template/messages', '/template/billing', '/template/activity', '/template/settings', '/template/submit', '/template/request-service'],
  va: ['/template/fulfillment', '/template/fulfillment/calendar', '/template/fulfillment/schedule', '/template/fulfillment/more', '/template/messages', '/template/fulfillment/pipeline', '/template/fulfillment/pay', '/template/fulfillment/training', '/template/fulfillment/pipeline?s=clients', '/template/fulfillment?s=clients', '/template/fulfillment?s=search', '/template/fulfillment?s=notif', '/template/fulfillment?s=pay', '/template/fulfillment?s=help'],
  admin: ['/preview/admin', '/preview/admin/agents', '/preview/admin/fulfillment', '/preview/admin/messages', '/preview/admin/more', '/preview/admin/settings', '/preview/admin/compliance'],
}
const collect = sel => [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().height > 0).map(e => {
    const kids = [...e.children].filter(k => k.getBoundingClientRect().height > 0)
    const tops = new Set(kids.map(k => Math.round(k.getBoundingClientRect().top / 6)))
    return { cls: e.className.toString().slice(0, 50), label: e.getAttribute('aria-label'), n: kids.length, rows: tops.size, over: e.scrollWidth > e.clientWidth + 2, text: kids.map(k => k.textContent.trim().slice(0, 18)).join(' | ').slice(0, 80) }
  })
const b = await chromium.launch(); const out = []
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
const p = await ctx.newPage()
for (const [who, urls] of Object.entries(SCREENS)) for (const u of urls) {
  await p.goto(BASE + u, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1200)
  const r = await p.evaluate(collect, SEL)
  for (const x of r) out.push({ who, u, ...x })
  // click every tab / pill once and look again (each tab can show its own chip rows)
  const n = await p.locator('[role=tab]:visible, .pb-pill:visible').count()
  for (let i = 0; i < Math.min(n, 14); i++) {
    await p.locator('[role=tab]:visible, .pb-pill:visible').nth(i).click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(500)
    const r2 = await p.evaluate(collect, SEL)
    for (const x of r2) out.push({ who, u: u + ` [tab ${i}]`, ...x })
  }
}
await b.close()
console.table(out.filter(x => x.rows > 1 || x.over))

