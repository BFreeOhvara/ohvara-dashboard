// P917 — phone (390): the client sheet and the bell sheet slide up and back down; after 30 taps they still do.
import { chromium } from 'playwright'
const [base = 'http://localhost:4917', theme = 'dark', out = 'qa/p917'] = process.argv.slice(2)
const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true })
const wait = ms => page.waitForTimeout(ms)
const sample = (sel, ms) => page.evaluate(([sel, ms]) => new Promise(done => { const o = []; const t0 = performance.now(); const tick = () => { const el = document.querySelector(sel); o.push(el ? getComputedStyle(el).transform : 'gone'); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(new Set(o).size) }; requestAnimationFrame(tick) }), [sel, ms])
const run = async label => {
  await page.goto(base + '/template/clients'); await wait(1600)
  const card = page.locator('.mx-person .mx-cover').first()
  const inS = sample('.mx-sheet', 520); await card.click(); const sIn = await inS
  await wait(150); await page.screenshot({ path: `${out}/390-${theme}-${label}-client-sheet.png`, scale: 'css' })
  const outS = sample('.mx-sheet', 320); await page.locator('.mx-sheet .mx-ib').first().click(); const sOut = await outS
  await wait(300)
  const bell = page.locator('[aria-label^="Your to-dos"]:visible').first()
  const bIn = sample('.mx-act', 520); await bell.click(); const bi = await bIn
  await wait(300)
  const bOut = sample('.mx-act', 320); await page.locator('.mx-act .mx-ib').first().click(); const bo = await bOut
  await wait(300)
  return { sheetIn: sIn, sheetOut: sOut, bellIn: bi, bellOut: bo }
}
const first = await run('first')
for (let i = 0; i < 30; i++) { const tabs = page.locator('.mx-tab:visible'); const n = await tabs.count(); if (n) await tabs.nth(i % n).click().catch(() => {}); await wait(200) }
const later = await run('after30')
console.log(JSON.stringify({ first, later, settled: await page.evaluate(() => [...document.documentElement.classList].filter(c => /settled/.test(c))) }))
await browser.close()
