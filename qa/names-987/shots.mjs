// P987 — no personal names for agents and VAs. Sample-data template only (/template), no backend touched.
//   node qa/names-987/shots.mjs [outDir]      (run from the repo root)
// Sweeps agent and VA pages (desktop 1440 + phone 390) for "Brayden" / "Jordan" in the visible text, opens the
// support threads, and saves three proof shots: agent phone Help, VA phone Help, VA "Swap a shift" sheet.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/names-987/out'
const PORT = 5900 + Math.floor(Math.random() * 90)
mkdirSync(OUT, { recursive: true })
const NAMES = /brayden|jordan|braden/i

const AGENT = ['/template', '/template/leads', '/template/calendar', '/template/clients', '/template/messages', '/template/activity', '/template/billing', '/template/settings', '/template/more', '/template/signup']
const VA = ['/template/fulfillment', '/template/fulfillment/calendar', '/template/fulfillment/pipeline', '/template/fulfillment/schedule', '/template/fulfillment/pay', '/template/fulfillment/more', '/template/fulfillment/training', '/template/fulfillment/messages', '/template/fulfillment/settings']

const server = await createServer({ server: { port: PORT, strictPort: true, fs: { allow: ['.', 'C:/Users/freem/ohvara-dashboard/node_modules'] } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch()
const hits = []
const checks = {}
const scan = async (page, where) => {
  const text = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('input[placeholder],textarea[placeholder]')].map(e => e.placeholder).join(' '))
  const m = text.match(new RegExp(NAMES.source, 'gi'))
  if (m) hits.push({ where, found: [...new Set(m)] })
  return text
}
const go = async (page, url) => { await page.goto(base + url, { waitUntil: 'networkidle' }); await page.waitForTimeout(500) }
const clickText = async (page, re) => { const el = page.getByText(re).first(); await el.click(); await page.waitForTimeout(600) }

try {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    for (const u of [...AGENT, ...VA]) { await go(page, u); await scan(page, `${u} @${w}`) }
    // the support threads
    for (const u of ['/template/messages', '/template/fulfillment/messages']) {
      await go(page, u)
      try { await clickText(page, /Ohvara Support/); await scan(page, `${u} support thread @${w}`) } catch { checks[`${u} support @${w}`] = 'no support row found' }
    }
    await page.close()
  }

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  // agent phone Help
  await go(phone, '/template/more'); await clickText(phone, /^Help$/); await clickText(phone, /How do I reach a person/)
  checks.agentHelp = (await scan(phone, 'agent phone Help')).includes('We answer, usually the same day')
  await phone.screenshot({ path: join(OUT, 'agent-help-390.png') })
  // VA phone Help
  await go(phone, '/template/fulfillment/more'); await clickText(phone, /^Help$/)
  checks.vaHelp = (await scan(phone, 'VA phone Help')).toLowerCase().includes('ohvara support')
  await phone.screenshot({ path: join(OUT, 'va-help-390.png') })
  // VA approval flow: Swap a shift sheet
  await go(phone, '/template/fulfillment/schedule'); await clickText(phone, /^Swap a shift$/)
  checks.vaSwap = (await scan(phone, 'VA swap sheet')).includes('then Ohvara confirms')
  await phone.screenshot({ path: join(OUT, 'va-swap-390.png') })
  await phone.close()
} finally {
  await browser.close()
  await server.close()
}
const res = { hits, checks }
writeFileSync(join(OUT, 'results.json'), JSON.stringify(res, null, 2))
console.log(JSON.stringify(res, null, 2))
