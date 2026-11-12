// P968 proof on sample data (/template has no backend): agent Leads stage-card height with and without imported lists,
// the imported-list card, and the rail / top-right lean on agent + VA. Reduced motion and touch turn the lean off.
//   node scripts/p968-shots.mjs <root> <outDir>     (root = the worktree to serve: this one, or a master checkout)
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const ROOT = resolve(process.argv[2] || '.')
const OUT = resolve(process.argv[3] || 'qa/p968')
mkdirSync(OUT, { recursive: true })
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.VITE_SUPABASE_ANON_KEY = 'sample-preview'
const PORT = 5300 + Math.floor(Math.random() * 400)
const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch()
const out = { leads: [], lean: [] }
try {
  for (const [w, h] of [[1440, 900], [1920, 1080], [1280, 700]]) {
    for (const withLists of [true, false]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
      const page = await ctx.newPage()
      await page.goto(`${base}/template/leads`, { waitUntil: 'networkidle' })
      await page.waitForSelector('.fx-lane')
      if (!withLists) await page.evaluate(() => document.querySelector('.rx-cards')?.remove())
      await page.waitForTimeout(900)
      const m = await page.evaluate(() => {
        const lane = document.querySelector('.fx-lane')
        const board = document.querySelector('.fx-board')
        return { lane: Math.round(lane.getBoundingClientRect().height), board: Math.round(board.getBoundingClientRect().height),
          page: document.documentElement.scrollHeight, cards: document.querySelectorAll('.rx-card').length, win: innerHeight }
      })
      const row = { w, h, withLists, ...m }
      out.leads.push(row)
      await page.screenshot({ path: join(OUT, `leads-${w}-${withLists ? 'lists' : 'none'}.png`), fullPage: true })
      await ctx.close()
    }
  }
  // Lean: hover near an icon's edge, read the translate on the svg (or the avatar), then leave.
  for (const [name, url, sel] of [['agent', '/template/leads', '.fx-ri'], ['agent-top', '/template/leads', '.fx-ib'], ['agent-me', '/template/leads', '.fx-me'], ['va', '/template/fulfillment', '.fx-ri'], ['va-top', '/template/fulfillment', '.fx-ib'], ['va-me', '/template/fulfillment', '.fx-me']]) {
    for (const mode of ['normal', 'reduced', 'touch']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference', hasTouch: mode === 'touch' })
      const page = await ctx.newPage()
      await page.goto(`${base}${url}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      const el = page.locator(`${sel}:visible`).first()
      const box = await el.boundingBox()
      if (!box) { out.lean.push({ name, mode, error: 'not found' }); await ctx.close(); continue }
      const before = await el.evaluate(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })
      if (mode === 'touch') {
        await el.dispatchEvent('pointermove', { pointerType: 'touch', clientX: box.x + box.width - 2, clientY: box.y + 2 })
      } else {
        await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2)
        await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2 + 4)
      }
      await page.waitForTimeout(700)
      const hov = await el.evaluate(e => {
        const t = e.querySelector(':scope > svg') || e
        const r = e.getBoundingClientRect()
        return { tf: getComputedStyle(t).transform, box: [r.left, r.top, r.width, r.height] }
      })
      await page.mouse.move(5, 5)
      await page.waitForTimeout(900)
      const after = await el.evaluate(e => { const t = e.querySelector(':scope > svg') || e; return getComputedStyle(t).transform })
      out.lean.push({ name, mode, hovered: hov.tf, boxMoved: hov.box.some((v, i) => Math.abs(v - before[i]) > 0.5) && !!el && !(await el.evaluate(e => !!e.querySelector(':scope > svg'))) ? 'avatar itself moves (by design)' : hov.box.some((v, i) => Math.abs(v - before[i]) > 0.5), after })
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
