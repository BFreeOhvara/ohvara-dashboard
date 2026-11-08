// P891 proof (sample data): agent Add clients / Import with good, missing and duplicate rows; the VA welcome call
// (text consent only on yes, Welcomed, No answer retry); the admin welcome backlog. 1440 and 390, light.
//   node scripts/book-891-check.mjs --base-url http://localhost:5291 [--out media/p891]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/book-891'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const CSV = [
  'First name\tLast name\tPhone\tState\tCarrier\tPolicy number\tMonthly premium',
  'Ana\tRuiz\t512-555-0101\tTX\tAmerico\tAM-501\t61.50',
  'Bo\tLee\t\tTX\tAmerico\tAM-502\t40',
  'Dup\tBook\t512-555-0177\tTX\tAmerico\tAM-1234567\t40',
  'Dup\tRow\t512-555-0178\tTX\tAmerico\tAM-501\t40',
  'Cy\tDay\t(512) 555-0103\tGA\tForesters\tFF-503\t52',
].join('\n')

const browser = await chromium.launch()
const rows = []
for (const v of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 160)}`))
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  const r = { w: v.w }

  // Agent: Clients page with the sample import.
  await page.goto(`${BASE}/template/clients`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.fx-cgrid .fx-ccard')
  await page.waitForTimeout(500)
  r.cards = await page.locator('.fx-cgrid .fx-ccard').count()
  r.addedTags = await page.locator('.bi-by').count()
  r.clientsSideways = await sideways()
  await page.screenshot({ path: `${OUT}/agent-clients-${v.w}.png` })

  // Import: paste, read, review.
  await page.getByRole('button', { name: 'Add clients', exact: true }).click()
  await page.getByRole('tab', { name: 'Import' }).click()
  await page.locator('.bi-import textarea').fill(CSV)
  await page.getByRole('button', { name: 'Read the paste' }).click()
  await page.waitForSelector('.bi-review')
  r.review = await page.evaluate(() => [...document.querySelectorAll('.bi-row .tp-chip')].map(c => c.textContent.trim()).join('|'))
  r.btnBeforeTick = await page.locator('.tp-sheet-f .tp-primary').isDisabled()
  await page.locator('.bi-ack input').check()
  r.btnLabel = (await page.locator('.tp-sheet-f .tp-primary').textContent()).trim()
  r.drawerSideways = await page.evaluate(() => { const b = document.querySelector('.tp-sheet-b'); return b ? b.scrollWidth > b.clientWidth + 1 : null })
  await page.screenshot({ path: `${OUT}/agent-import-review-${v.w}.png` })
  await page.locator('.tp-sheet-f .tp-primary').click()
  await page.waitForTimeout(600)
  r.cardsAfter = await page.locator('.fx-cgrid .fx-ccard').count()

  // One client form: a duplicate phone is flagged.
  await page.getByRole('button', { name: 'Add clients', exact: true }).click()
  await page.locator('.bi-form input').nth(0).fill('Ivy')
  await page.locator('.bi-form input').nth(1).fill('Tran')
  await page.locator('.bi-form input[aria-label="Phone"]').fill('5125550199')
  r.oneDup = await page.evaluate(() => document.querySelector('.bi-row .tp-chip')?.textContent.trim() || '')
  await page.keyboard.press('Escape')

  // An added client's drawer: Added → Welcomed → Serviced.
  await page.goto(`${BASE}/template/clients/sample-client-9`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.bi-steps')
  r.bookOn = await page.evaluate(() => document.querySelector('.bi-steps .is-on')?.textContent || '')
  await page.screenshot({ path: `${OUT}/agent-added-client-${v.w}.png` })

  // VA: Maria's welcome call. Answer is locked until started; yes logs consent; Welcomed closes it.
  await page.goto(`${BASE}/template/fulfillment/servicing/st-13`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.wc-facts')
  r.yesLocked = await page.getByRole('button', { name: 'Yes, texts are fine' }).isDisabled()
  await page.locator('.tp-sheet, .fx-rec, body').getByRole('button', { name: 'Start' }).first().click()
  await page.getByRole('button', { name: 'Yes, texts are fine' }).click()
  r.said = await page.locator('.wc-said').textContent()
  r.vaSideways = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') || document.body; return d.scrollWidth > d.clientWidth + 1 })
  await page.screenshot({ path: `${OUT}/va-welcome-call-${v.w}.png`, fullPage: v.w < 600 })
  await page.getByRole('button', { name: 'Record the result' }).click()
  r.outcomes = await page.evaluate(() => [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].map(b => b.textContent.trim()).join('|'))
  await page.getByRole('radio', { name: 'Welcomed' }).click()
  await page.getByRole('button', { name: 'Save result' }).click()
  await page.waitForTimeout(400)
  r.vaDone = await page.locator('.fs-done h3').textContent().catch(() => '')

  // No answer on Gene's: back tomorrow.
  await page.goto(`${BASE}/template/fulfillment/servicing/st-14`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.wc-facts')
  await page.getByRole('button', { name: 'Start' }).first().click()
  await page.getByRole('button', { name: 'Record the result' }).click()
  await page.getByRole('radio', { name: 'No answer' }).click()
  await page.getByRole('button', { name: 'Save result' }).click()
  await page.waitForTimeout(400)
  r.retry = await page.locator('.fx-when').first().textContent()

  // Admin: welcome calls waiting.
  await page.goto(`${BASE}/preview/admin/pipeline?tab=servicing`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  r.adminRows = await page.locator('[aria-label="Welcome calls waiting"] .adm-step').count()
  await page.getByRole('button', { name: 'More a day' }).click()
  r.perDay = await page.locator('.wl-cap b').textContent()
  r.adminSideways = await sideways()
  await page.screenshot({ path: `${OUT}/admin-welcome-${v.w}.png` })

  r.errors = errors.length
  if (errors.length) console.log(v.w, errors)
  rows.push(r)
  await ctx.close()
}
await browser.close()
for (const r of rows) console.log(JSON.stringify(r))
