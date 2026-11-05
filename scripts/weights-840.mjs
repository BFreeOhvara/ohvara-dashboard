// P840: every visible text node's weight on the shell pages; flags body < 500, titles / numbers / tabs < 600
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const out = {}
for (const pg of ['', 'leads', 'clients', 'calendar', 'activity', 'billing', 'settings', 'messages']) {
  await p.goto(`http://localhost:5173/template/${pg}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  out[pg || 'overview'] = await p.evaluate(() => {
    const low = {}, weak = {}
    for (const el of document.querySelectorAll('.tp *')) {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); if (!r.width || cs.visibility === 'hidden') continue
      const w = +cs.fontWeight, name = `${el.tagName}.${(el.className?.baseVal ?? el.className ?? '').toString().split(' ').slice(0, 2).join('.')}`
      if (w < 500) low[name] = w
      const strong = el.matches('h1,h2,h3,.fx-tab,.tp-num,.tp-money,.fx-huge,.fx-huge2,b') || parseFloat(cs.fontSize) >= 20
      if (strong && w < 600) weak[name] = `${w} ${cs.fontSize}`
    }
    return { low, weak }
  })
}
console.log(JSON.stringify(out, null, 1))
await b.close()
