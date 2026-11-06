// P855: force a throw on Overview (temporary line, removed after) and look at the panel; then click to another tab.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
const BASE = process.argv[2]
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const b = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await (await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })).newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('input[placeholder="you@email.com"]', logins.admin.email)
  await page.fill('input[placeholder="Your password"]', logins.admin.password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3500)
  await page.goto(`${BASE}/admin?p855crash=1`)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `qa/admin-855/crash-panel-${w}.png` })
  const alert = await page.locator('[role=alert]').innerText().catch(() => 'NO PANEL')
  console.log(w, 'panel:', alert.replace(/\s+/g, ' '), '| classic link:', await page.locator('a:has-text("Open the classic admin")').getAttribute('href'), '| tabs still there:', await page.locator('nav[aria-label=Pages] a').count())
  if (w === 1440) {
    await page.click('a.fx-tab[href="/admin/agents"]'); await page.waitForTimeout(1500)
    console.log('after clicking Agents:', page.url().replace(BASE, ''), 'panel gone:', (await page.locator('[role=alert]').count()) === 0)
  }
}
await b.close()
