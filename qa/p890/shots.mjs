// P890 shots: Billing Pause leads (drawer, paused) and Resume at 1440 and 390 (light), sample shell only.
// Run: node qa/p890/shots.mjs. Starts its own Vite server; saves PNGs next to this file and prints measurements.
import { createServer } from 'vite'
import { chromium } from 'playwright'
const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
process.env.VITE_SUPABASE_URL = 'https://mock.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const PORT = 4890
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
let bad = 0
for (const w of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w > 500 ? 1000 : 844 }, reducedMotion: 'reduce' })
  await ctx.addInitScript(() => { localStorage.setItem('ohvara-theme', 'light') })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await page.goto(`http://localhost:${PORT}/template/billing`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const m = () => page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, text: document.body.innerText }))
  await page.getByRole('button', { name: /Pause leads/ }).first().click()
  await page.waitForTimeout(600)
  const d = await m(); d.text = await page.locator('[role=dialog]').last().innerText().catch(() => d.text)
  await page.screenshot({ path: `${DIR}pause-drawer-${w}.png` })
  await page.getByRole('button', { name: /^Pause$/ }).click()
  await page.waitForTimeout(800)
  await page.locator('.sp-paused').scrollIntoViewIfNeeded()
  const p = await m()
  await page.screenshot({ path: `${DIR}paused-${w}.png` })
  await page.getByRole('button', { name: /Resume now/ }).click()
  await page.waitForTimeout(800)
  const r = await m()
  await page.screenshot({ path: `${DIR}resumed-${w}.png` })
  const res = {
    w, drawer: /Your lead spend: none is used/.test(d.text),
    paused: /Paused until/.test(p.text), resumed: !/Paused until/.test(r.text), over: Math.max(d.over, p.over, r.over), errs: errs.length,
  }
  if (!res.drawer || !res.paused || !res.resumed || res.over > 0 || errs.length) bad++
  console.log(JSON.stringify(res), errs.join(' | '))
  await ctx.close()
}
await browser.close()
await server.close()
process.exit(bad ? 1 : 0)
