// P888 proof: the VA Servicing page (sample) at 1440 and 390, light and dark, plus one task drawer.
//   node scripts/servicing-888-shots.mjs --base-url http://localhost:5282 --tag after [--out <dir>] [--task st-11]
// Measures the step board's height, small boxes under the board, sideways scroll and console errors.
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const TAG = flag('--tag') || 'shot'
const OUT = flag('--out') || 'qa/servicing-888'
const TASK = flag('--task')
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const browser = await chromium.launch()
const rows = []
for (const theme of ['light', 'dark']) {
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme })
    await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, theme)
    const page = await ctx.newPage()
    const errors = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 160)}`))
    await page.goto(`${BASE}/template/fulfillment/servicing`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.fs-board4', { timeout: 15000 })
    await page.waitForTimeout(700)
    const m = await page.evaluate(() => {
      const b = document.querySelector('.fs-board4')
      const lane = b?.querySelector('.fx-lane')
      const card = b?.querySelector('.fx-lcard')
      const page = document.querySelector('.fs-serv')
      return {
        board: Math.round(b?.getBoundingClientRect().height || 0),
        lane: Math.round(lane?.getBoundingClientRect().height || 0),
        card: card ? `${Math.round(card.getBoundingClientRect().width)}x${Math.round(card.getBoundingClientRect().height)}` : '-',
        blocks: page ? [...page.children].map(c => c.className.split(' ')[0]).join(',') : '',
        desk: !!document.querySelector('.mp-desk'),
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      }
    })
    const name = `${TAG}-servicing-${v.w}-${theme}.png`
    await page.screenshot({ path: `${OUT}/${name}` })
    if (TASK && theme === 'light') {
      await page.goto(`${BASE}/template/fulfillment/servicing/${TASK}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(700)
      await page.screenshot({ path: `${OUT}/${TAG}-task-${TASK}-${v.w}.png`, fullPage: v.w < 600 })
    }
    rows.push({ theme, w: v.w, ...m, errors: errors.length })
    await ctx.close()
  }
}
await browser.close()
console.table(rows)
