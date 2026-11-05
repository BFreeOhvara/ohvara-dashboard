import { chromium } from 'playwright'
const b = await chromium.launch()
for (const t of ['dark', 'light']) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await p.addInitScript(t => { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) }, t)
  await p.goto('http://localhost:5173/template/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  const r = await p.evaluate(() => { const m = document.querySelector('.fx-top .fx-mark').getBoundingClientRect(), w = document.querySelector('.fx-top .fx-brand b').getBoundingClientRect(); return { mark: [m.top, m.bottom], word: [w.top, w.bottom], markMid: (m.top + m.bottom) / 2 } })
  console.log(t, JSON.stringify(r))
  await p.screenshot({ path: `qa/shell-840/logo-${t}.png`, clip: { x: 0, y: 0, width: 220, height: 80 } })
}
await b.close()
