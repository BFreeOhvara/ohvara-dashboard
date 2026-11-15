// P1013: the gap under the date + clock line on Overview, admin vs agent vs VA (desktop + phone, light + dark).
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:5013'
const SHOT = process.argv.includes('--shots')
const PAGES = { agent: '/template', va: '/template/fulfillment', admin: '/preview/admin' }
const out = []
const browser = await chromium.launch()
for (const [w, h] of (process.env.SIZES ? JSON.parse(process.env.SIZES) : [[1440, 900], [390, 844]])) for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 500 })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage()
  for (const [who, path] of Object.entries(PAGES)) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1200)
    const r = await p.evaluate(() => {
      const c = [...document.querySelectorAll('.fx-clock, .ma-clock')].find(e => e.getBoundingClientRect().height > 0)
      if (!c) return null
      const cr = c.getBoundingClientRect()
      // the first block below the clock that overlaps it horizontally
      const blocks = [...document.querySelectorAll('section, .fx-tile, .ma-glass, .tp-card, [class*="-hero"], [class*="allclear"], [class*="caught"]')]
        .filter(e => { const b = e.getBoundingClientRect(); return b.height > 20 && b.top >= cr.top + 2 && b.left < cr.right && b.right > cr.left && !e.contains(c) })
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      const n = blocks[0]; const nr = n?.getBoundingClientRect()
      return { clockBottom: Math.round(cr.bottom), next: n ? (n.className || n.tagName).toString().slice(0, 50) : null, gap: nr ? Math.round(nr.top - cr.bottom) : null, ox: document.documentElement.scrollWidth - innerWidth }
    })
    out.push({ w, scheme, who, ...r })
    if (SHOT && scheme === 'light') await p.screenshot({ path: `qa/p1013/clock-${who}-${w}.png`, clip: { x: 0, y: 0, width: w, height: Math.min(h, 420) } })
  }
  await ctx.close()
}
await browser.close()
console.table(out)
