// P834: the + create menu, the new rail shortcuts and their drawers, on sample /template. Shots to qa/shell-834.
//   node scripts/shell-create-834.mjs --base-url http://localhost:5173
import process from 'node:process'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', 'http://localhost:5173').replace(/\/$/, '')
const OUT = 'qa/shell-834'
const b = await chromium.launch()
const out = []
for (const theme of ['dark', 'light']) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.addInitScript(t => { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) }, theme)
  await page.goto(`${BASE}/template`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500)
  const toast = async () => (await page.locator('.tp-note-toast').textContent({ timeout: 3000 }).catch(() => '')) || ''

  await page.click('.fx-rail [aria-label="Create"]'); await page.waitForTimeout(400)
  const items = await page.locator('.fx-cmenu [role="menuitem"]').allTextContents()
  await page.screenshot({ path: `${OUT}/create-menu-1440-${theme}.png` })
  out.push(`${theme} + menu: ${items.length} items (${items.map(t => t.replace(/[A-Z][a-z].*$/, m => m.split(/(?=[A-Z])/)[0])).join(' | ')})`)

  await page.click('.fx-cmenu >> text=Add a note to a client'); await page.waitForTimeout(300)
  await page.fill('.tp-sheet textarea', 'Prefers a call after 5'); await page.click('.tp-sheet >> text=Save note')
  out.push(`${theme} add note -> "${await toast()}"`)
  await page.waitForTimeout(3400)

  await page.click('.fx-rail [aria-label="Create"]'); await page.waitForTimeout(300)
  await page.click('.fx-cmenu >> text=Log a call'); await page.waitForTimeout(300)
  await page.click('.tp-sheet >> text=Left a voicemail'); await page.click('.tp-sheet >> text=Log it')
  out.push(`${theme} log call -> "${await toast()}"`)

  await page.click('.fx-rail [aria-label="Get the phone app"]'); await page.waitForTimeout(800)
  const qr = await page.locator('.fx-app-qr img').count()
  const stores = await page.locator('.fx-app-store').allTextContents()
  await page.screenshot({ path: `${OUT}/get-app-1440-${theme}.png` })
  out.push(`${theme} get app: QR ${qr ? 'shown' : 'MISSING'}, stores ${stores.join(' / ')}`)
  await page.keyboard.press('Escape')

  await page.click('.fx-rail [aria-label="Help and support"]'); await page.waitForTimeout(300)
  out.push(`${theme} help: ${(await page.locator('.tp-sheet .fx-mrow b').allTextContents()).join(' | ')}`)
  await page.keyboard.press('Escape')

  await page.click('.fx-rail [aria-label="Messages"]'); await page.waitForTimeout(700)
  const m = page.url()
  await page.click('.fx-rail [aria-label="Calendar"]'); await page.waitForTimeout(700)
  out.push(`${theme} rail Messages -> ${new URL(m).pathname}, Calendar -> ${new URL(page.url()).pathname}`)
  out.push(`${theme} errors: ${errors.length ? errors.slice(0, 3).join(' ; ') : 'none'}`)
  await page.close()
}
// Phone: the bar's + opens the same menu as a bottom sheet
const ph = await b.newPage({ viewport: { width: 390, height: 844 } })
await ph.goto(`${BASE}/template`, { waitUntil: 'networkidle' }); await ph.waitForTimeout(1200)
await ph.click('.fx-bar [aria-label="Create"]'); await ph.waitForTimeout(400)
const r = await ph.locator('.fx-cmenu').boundingBox()
await ph.screenshot({ path: `${OUT}/create-menu-390-dark.png` })
out.push(`390 + menu: ${Math.round(r.width)}x${Math.round(r.height)} at y ${Math.round(r.y)}`)
await b.close()
console.log(out.join('\n'))
