// P888 proof: the steps inside a task (Servicing st-11) and a cancel call (Schedule), scrolled to "On this call".
//   node scripts/servicing-888-steps.mjs --base-url http://localhost:5282 --call <id>
import process from 'node:process'
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = flag('--base-url'); const CALL = flag('--call'); const OUT = 'qa/servicing-888'
const b = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const [name, url] of [['task-steps', '/template/fulfillment/servicing/st-11'], ['call-steps', `/template/fulfillment/schedule/${CALL}`]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } })
    await p.goto(BASE + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
    const m = await p.evaluate(() => {
      const ol = document.querySelector('.fs-steps'); if (!ol) return { steps: 0 }
      ol.closest('section, .fx-blk')?.scrollIntoView({ block: 'start' })
      const d = [...document.querySelectorAll('[role=dialog], .fx-drawer')].pop()
      return { steps: ol.children.length, papers: !!ol.querySelector('.dc-bare'), gate: !!ol.querySelector('.dc-gate'), boxes: d ? d.querySelectorAll('.fx-blk').length : -1,
        sideways: document.documentElement.scrollWidth > innerWidth + 1, overflowX: d ? d.scrollWidth > d.clientWidth + 1 : null }
    })
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${OUT}/after-${name}-${w}.png` })
    console.log(name, w, JSON.stringify(m))
    await p.close()
  }
}
await b.close()
