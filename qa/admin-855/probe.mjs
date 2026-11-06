// P855 probe: sign in as the test admin (~/.atlas/test-logins.json) on a local build and visit every admin page.
//   node qa/admin-855/probe.mjs --base-url http://127.0.0.1:5185 [--tag before|after] [--shots]
// Records per page: text length, console errors, page errors, backend (supabase) responses >= 400, non-GET writes.
import process from 'node:process'
import { readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const TAG = flag('--tag') || 'run'
const SHOTS = args.includes('--shots')
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
mkdirSync('qa/admin-855', { recursive: true })

const PAGES = ['/admin', '/admin/agents', '/admin/fulfillment', '/admin/inbounds', '/admin/clients', '/admin/billing', '/admin/messages', '/admin/settings', '/admin/connect']
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const browser = await chromium.launch()
const out = []
for (const view of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  let cur = 'login'
  const rec = () => (out.find(o => o.key === cur) || out[out.push({ key: cur, errors: [], bad: [], writes: [] }) - 1])
  page.on('console', m => { if (m.type() === 'error') rec().errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', e => rec().errors.push(`PAGEERROR ${e.message.slice(0, 200)}`))
  page.on('response', r => { if (/supabase\.co/.test(r.url()) && r.status() >= 400) rec().bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^.*supabase\.co/, '').slice(0, 70)}`) })
  page.on('request', r => { if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /supabase\.co/.test(r.url()) && !/\/auth\/v1\//.test(r.url())) rec().writes.push(`${r.method()} ${r.url().replace(/^.*supabase\.co/, '').slice(0, 60)}`) })
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[placeholder="you@email.com"]', logins.admin.email)
  await page.fill('input[placeholder="Your password"]', logins.admin.password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(4000)
  for (const p of PAGES) {
    cur = `${view.w} ${p}`
    rec()
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    const info = await page.evaluate(() => ({ text: document.body.innerText.trim().length, shell: !!document.querySelector('.ad'), spinner: !!document.querySelector('.animate-spin'), h: document.body.innerText.trim().slice(0, 60).replace(/\s+/g, ' ') }))
    Object.assign(rec(), info, { url: page.url().replace(BASE, '') })
    if (SHOTS) await page.screenshot({ path: `qa/admin-855/${TAG}-${view.w}-${p.replace(/\//g, '_')}.png` })
  }
  await ctx.close()
}
await browser.close()
for (const o of out) {
  console.log(`${o.key.padEnd(24)} text=${String(o.text).padEnd(5)} shell=${o.shell} spin=${o.spinner} url=${o.url} | ${o.h}`)
  for (const e of [...new Set(o.errors)]) console.log(`    ERR  ${e}`)
  for (const b of [...new Set(o.bad)]) console.log(`    BAD  ${b}`)
  for (const w of o.writes) console.log(`    WRITE ${w}`)
}
