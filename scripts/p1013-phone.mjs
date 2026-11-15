import { chromium } from 'playwright'
const b = await chromium.launch(); const out = []
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage()
  for (const [who, path] of [['agent', '/template'], ['va', '/template/fulfillment'], ['admin', '/preview/admin']]) {
    await p.goto('http://localhost:5013' + path, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500)
    out.push({ scheme, who, ...(await p.evaluate(() => {
      const c = [...document.querySelectorAll('.ma-clock, .fx-clock')].find(e => e.getBoundingClientRect().height > 0)
      const cr = c?.getBoundingClientRect()
      const h = document.querySelector('.ma-home-h'); const hb = h.getBoundingClientRect().bottom; const first = [...document.querySelectorAll('.ma-rise')].filter(e => !h.contains(e) && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().top >= hb - 1).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
      const fr = first?.getBoundingClientRect()
      return { clockIn: c?.parentElement?.className?.slice(0, 30), clockBottom: cr && Math.round(cr.bottom), first: first?.className?.slice(0, 30), gap: fr && cr ? Math.round(fr.top - cr.bottom) : null }
    })) })
    if (scheme === 'light') await p.screenshot({ path: `qa/p1013/phone-top-${who}.png`, clip: { x: 0, y: 0, width: 390, height: 300 } })
  }
  await ctx.close()
}
await b.close(); console.table(out)
