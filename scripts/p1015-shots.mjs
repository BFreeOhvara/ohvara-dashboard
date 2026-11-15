// P1015: phone shots at 390 (light + dark) and desktop shots at 1440 for the before/after identical check.
// node scripts/p1015-shots.mjs phone|desktop <tag>
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
const [mode = 'phone', tag = 'after'] = process.argv.slice(2)
const BASE = process.env.BASE || 'http://localhost:5015'
const b = await chromium.launch(); const sums = {}
const run = async (scheme, vp, pages) => {
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, hasTouch: vp.width < 600, reducedMotion: 'reduce' })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage()
  for (const [name, url, act] of pages) {
    await p.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500)
    if (act) { await act(p); await p.waitForTimeout(700) }
    const buf = await p.screenshot({ clip: mode === 'phone' ? { x: 0, y: 0, width: 390, height: 360 } : undefined, fullPage: false })
    const f = `qa/p1015/${mode}-${tag}-${name}-${scheme}.png`; writeFileSync(f, buf); sums[f] = createHash('sha1').update(buf).digest('hex').slice(0, 10)
  }
  await ctx.close()
}
const tab = n => p => p.getByRole('tab', { name: n }).first().click()
if (mode === 'phone') {
  const pages = [
    ['admin-agents', '/preview/admin/agents', null],
    ['admin-team', '/preview/admin/fulfillment', null],
    ['admin-team-calendar', '/preview/admin/fulfillment', tab('Calendar')],
    ['admin-compliance', '/preview/admin/compliance', null],
    ['va-clients', '/template/fulfillment?s=clients', null],
    ['agent-leads', '/template/leads', null],
  ]
  for (const s of ['light', 'dark']) await run(s, { width: 390, height: 844 }, pages)
} else {
  const pages = [['agents', '/preview/admin/agents'], ['team', '/preview/admin/fulfillment'], ['compliance', '/preview/admin/compliance'], ['overview', '/preview/admin'], ['leads', '/template/leads'], ['va-clients', '/template/fulfillment/pipeline'], ['va-calendar', '/template/fulfillment/calendar']].map(x => [...x, null])
  for (const s of ['light', 'dark']) await run(s, { width: 1440, height: 900 }, pages)
}
await b.close(); writeFileSync(`qa/p1015/${mode}-${tag}.json`, JSON.stringify(sums, null, 1)); console.log(Object.keys(sums).length, 'shots')
