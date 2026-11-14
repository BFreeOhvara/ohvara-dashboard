// P1001 — proof shots + measurements: Fulfillment Overview fits one screen, admin "Get the phone app" (desktop and
// phone), phone Messages without phone-only threads, and one avatar colour per person across pages.
// Runs against a local sample preview: BASE=http://localhost:5001 node scripts/p1001-shots.mjs <outDir>
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:5001'
const OUT = process.argv[2] || 'qa/p1001'
mkdirSync(OUT, { recursive: true })
const results = {}
const browser = await chromium.launch()

async function open(url, { w = 1440, h = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 768 })
  const p = await ctx.newPage()
  const errors = []
  p.on('console', m => { if (m.type() === 'error' && !/127\.0\.0\.1:1|Failed to load resource|ERR_CONNECTION/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  p.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  await p.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(1500)
  return { p, ctx, errors }
}
const avatars = p => p.evaluate(() => {
  const out = {}
  for (const el of document.querySelectorAll('[class*="av-sky"],[class*="av-apricot"],[class*="av-sage"],[class*="av-butter"]')) {
    const hue = el.className.match(/av-(sky|apricot|sage|butter)/)[1]
    const who = (el.textContent || '').trim().slice(0, 3) || el.getAttribute('aria-label') || '?'
    ;(out[who] ||= new Set()).add(hue)
  }
  return { hues: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]])), supportLogos: document.querySelectorAll('.ov-support-av').length, crash: !!document.querySelector('.ov-crash, [role=alert] .ov-crash-title') }
})

async function run(name, url, opts = {}, after) {
  const { p, ctx, errors } = await open(url, opts)
  const extra = after ? await after(p) : null
  await p.screenshot({ path: join(OUT, `${name}.png`) })
  results[name] = { url, ...opts, ...(await avatars(p)), extra, errors }
  await ctx.close()
}

// 1. Fulfillment Overview fits one screen at three desktop sizes.
for (const [w, h] of [[1366, 768], [1440, 900], [1920, 1080]]) {
  await run(`ful-overview-${w}`, '/template/fulfillment', { w, h }, p => p.evaluate(() => {
    const d = document.documentElement, cards = document.querySelector('.ov946-cards')
    return { pageScroll: d.scrollHeight - innerHeight, bodyScroll: document.body.scrollHeight - innerHeight, cardsInnerScroll: cards ? cards.scrollHeight - cards.clientHeight : null, overflowX: d.scrollWidth > innerWidth }
  }))
}
// 2. Avatars: the same person, the same colour on every page (desktop and phone).
for (const s of ['messages', 'calendar', 'settings']) await run(`ful-desk-${s}`, `/template/fulfillment/${s}`)
for (const s of ['overview', 'messages', 'more']) await run(`ful-phone-${s}`, `/template/fulfillment/${s}`, { w: 390, h: 844 },
  p => p.evaluate(() => ({ threads: [...document.querySelectorAll('.ma-thread b')].map(b => b.textContent), badges: [...document.querySelectorAll('.ma-tabbar .ma-badge, .ma-tab .ma-badge')].map(b => b.textContent) })))
for (const s of ['', '/messages', '/settings', '/clients']) await run(`agent-desk${s.replace('/', '-') || '-overview'}`, `/template${s}`)
for (const s of ['', '/messages', '/more']) await run(`agent-phone${s.replace('/', '-') || '-home'}`, `/template${s}`, { w: 390, h: 844 })
// 3. Admin: Get the phone app on desktop (rail) and phone (You); phone Messages has only agent and VA lines.
await run('admin-desk-getapp', '/preview/admin', {}, async p => {
  await p.getByRole('button', { name: 'Get the phone app' }).first().click().catch(e => String(e).slice(0, 80))
  await p.waitForTimeout(800)
  return p.evaluate(() => ({ drawer: !!document.querySelector('[role=dialog]'), text: document.querySelector('[role=dialog]')?.innerText.slice(0, 200), qr: !!document.querySelector('[role=dialog] svg, [role=dialog] img') }))
})
await run('admin-phone-getapp', '/preview/admin/settings', { w: 390, h: 844 }, async p => {
  const row = p.getByText('Get the phone app').first()
  const found = await row.count()
  if (found) { await row.click(); await p.waitForTimeout(800) }
  return p.evaluate(found => ({ row: !!found, drawer: !!document.querySelector('[role=dialog]'), text: document.querySelector('[role=dialog]')?.innerText.slice(0, 200) }), found)
})
await run('admin-phone-messages', '/preview/admin/messages', { w: 390, h: 844 },
  p => p.evaluate(() => ({ threads: [...document.querySelectorAll('.ma-thread b')].map(b => b.textContent), sub: document.querySelector('.ma-top small')?.textContent })))
await run('admin-desk-overview', '/preview/admin')

await browser.close()
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
