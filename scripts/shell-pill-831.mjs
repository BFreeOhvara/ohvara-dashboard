// P831: the top-bar pill mid-flight (Overview -> Billing), cropped to the tab bar, to check it keeps its colour.
import { chromium } from 'playwright'
const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${BASE}/template`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const box = await page.locator('.fx-tabs').boundingBox()
const clip = { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 }
await page.click('.fx-tabs >> text=Billing')
const t0 = Date.now()
for (const ms of [120, 260, 400, 700]) {
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
  await page.screenshot({ path: `qa/shell-831/pill-${ms}ms.png`, clip })
}
await browser.close()
