// P831: record a page change into Clients (ours) and Customers (Solvik) as video, plus frame strips, so the
// build-in motion can be compared side by side.
//   node scripts/shell-motion-rec.mjs --base-url http://localhost:5173 --out qa/shell-831/motion-before [--solvik]
import process from 'node:process'
import { mkdirSync, renameSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', 'http://localhost:5173').replace(/\/$/, '')
const OUT = flag('--out', 'qa/shell-831/motion')
const SOLVIK = args.includes('--solvik')
mkdirSync(OUT, { recursive: true })

async function rec(name, url, clickSel, ready) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
  const page = await ctx.newPage()
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('ohvara-theme', 'dark') } catch { /* */ } })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector(ready)
  await page.waitForTimeout(2500)
  const t0 = Date.now()
  await page.click(clickSel)
  // frames through the change
  for (const ms of [100, 250, 400, 550, 700, 900, 1200]) {
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
    await page.screenshot({ path: `${OUT}/${name}-${String(ms).padStart(4, '0')}ms.png` })
  }
  await page.waitForTimeout(800)
  const v = page.video()
  await ctx.close()
  renameSync(await v.path(), `${OUT}/${name}.webm`)
  await browser.close()
}

if (SOLVIK) await rec('solvik-customers', 'https://demo.codeandchill.store/solvik/', 'text=Customers', 'text=Overview')
else await rec('ours-clients', `${BASE}/template`, '.fx-tabs >> text=Clients', '.fx-tabs')
console.log('done', OUT)
