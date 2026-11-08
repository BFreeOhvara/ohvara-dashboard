// P899 proof (sample data): Clients with the "Still on the books?" lists, the client drawer, and the monthly list
// answered (one tap, tick one off, Lapsed) at 1440 and 390, plus Submit's fields.
//   node scripts/p899-shots.mjs --base-url http://localhost:4899 [--out qa/p899]
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/p899'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const report = []
const cards = page => page.evaluate(() => [...document.querySelectorAll('.fx-ccard')].map(c => `${c.querySelector('h3')?.textContent}:${c.querySelector('.fx-tag')?.textContent}`))
for (const v of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'light' })
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light'); localStorage.setItem('ohvara-theme', 'light') } catch { /* private */ } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const r = { w: v.w }

  await page.goto(`${BASE}/template/clients`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  Object.assign(r, await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    pills: [...document.querySelectorAll('.fx-fpill')].map(b => b.textContent),
    lists: [...document.querySelectorAll('.ck-list .ck-h p')].map(p => p.textContent),
    tags: [...document.querySelectorAll('.ck-req')].map(t => t.textContent),
  })))
  r.cards = await cards(page)
  await page.screenshot({ path: `${OUT}/clients-${v.w}.png`, fullPage: v.w === 390 })
  await page.locator('.ck-list').first().screenshot({ path: `${OUT}/monthly-list-${v.w}.png` })

  // The drawer: fields, status, request tag, messages; Call only on a phone.
  await page.goto(`${BASE}/template/clients/sample-client-5`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  r.drawer = await page.evaluate(() => {
    const d = document.querySelector('.fx-rec')
    const shown = el => !!el && getComputedStyle(el).display !== 'none'
    return { facts: [...d.querySelectorAll('.fx-facts dt')].map(x => x.textContent), blocks: [...d.querySelectorAll('.fx-blk h3, .fx-blk header h3')].map(x => x.textContent),
      tag: d.querySelector('.ck-req-hero')?.textContent || null, callBtn: shown(d.querySelector('.lc-tel')), number: shown(d.querySelector('.lc-num')),
      stepper: !!d.querySelector('.fx-stepper, [aria-label="Servicing stage"]'), policyNo: /SAMPLE-1005/.test(d.textContent) }
  })
  await page.screenshot({ path: `${OUT}/drawer-${v.w}.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // One tap: the 27th list (Luis, Carla) → Protected. Tick Irene off on the 30th → Working.
  await page.goto(`${BASE}/template/clients`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('.ck-list').first().getByRole('button', { name: /All still on the books/ }).click()
  await page.waitForTimeout(400)
  const second = page.locator('.ck-list').first()
  await second.locator('.ck-off input').first().check()
  await second.getByRole('button', { name: /Save: 1 fell off/ }).click()
  await page.waitForTimeout(400)
  r.afterAnswers = await cards(page)
  r.listsLeft = await page.locator('.ck-list').count()
  // Lapsed on Tom's card → confirm → Working.
  await page.locator('.fx-ccard', { hasText: 'Tom Reyes' }).getByRole('button', { name: 'Lapsed' }).click()
  await page.getByRole('button', { name: 'Yes, it lapsed' }).click()
  await page.waitForTimeout(500)
  r.tomAfterLapsed = (await cards(page)).find(x => x.startsWith('Tom Reyes'))
  await page.screenshot({ path: `${OUT}/clients-answered-${v.w}.png`, fullPage: v.w === 390 })

  // Submit's policy step: only carrier, draft day, premium (optional), notes; Replacing → old carrier + old draft day.
  await page.goto(`${BASE}/template/submit`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  r.submitClientFields = await page.evaluate(() => [...document.querySelectorAll('.fx-sub-body .tp-field > span, .fx-sub-body label > span')].map(x => x.textContent).filter(Boolean))
  if (errors.length) r.errors = errors
  report.push(r)
  await ctx.close()
}
await browser.close()
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
