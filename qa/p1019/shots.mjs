import { chromium } from 'playwright'
const tag = process.argv[2]; const BASE = 'http://localhost:5019'
const b = await chromium.launch()
for (const [vw, vp] of [['desktop', { width: 1440, height: 900 }]]) for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, reducedMotion: 'reduce', hasTouch: vp.width < 600 })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage()
  await p.goto(BASE + '/preview/admin/inbounds', { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500); await p.waitForSelector('.adm-leads-tools'); await p.waitForTimeout(1000)
  const info = await p.evaluate(() => { const t = document.querySelector('.adm-leads-tools'); const seg = t && t.querySelector('.adm-showing, .tp-seg'); return { text: t && t.innerText.replace(/\n/g, ' | '), segLeft: seg && Math.round(seg.getBoundingClientRect().left), hasShowing: !!(t && /Showing/.test(t.innerText)) } })
  console.log(vw, scheme, JSON.stringify(info))
  await p.screenshot({ path: `qa/p1019/${vw}-${tag}-${scheme}.png`, clip: vw === 'phone' ? { x: 0, y: 0, width: 390, height: 300 } : { x: 0, y: 0, width: 1440, height: 260 } })
  await ctx.close()
}
await b.close()
