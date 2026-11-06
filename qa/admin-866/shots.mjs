import process from 'node:process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

// P866 QA: uBlock Origin Lite ON (complete mode), light and dark, 1440 and 390. Shots + numbers in qa/admin-866.
//   node qa/admin-866/shots.mjs http://localhost:5866 <uBOL folder>
const [BASE, UBO] = process.argv.slice(2)
const OUT = 'qa/admin-866'
const PAGES = [
  ['admin-setup', '/preview/admin/setup', true], ['admin-setup-sample', '/preview/admin/setup', true, 'sample'],
  ['admin-setup-drawer', '/preview/admin/setup/ob-derek'], ['admin-connect', '/preview/admin/connect', true],
  ['admin-revenue', '/preview/admin/billing'], ['admin-overview', '/preview/admin'],
]
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }].filter(v => !process.env.ONLY_W || String(v.w) === process.env.ONLY_W)
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo866-')), {
  headless: false, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${UBO}`, `--load-extension=${UBO}`],
})
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null)
if (!sw) { console.log('FAIL blocker did not load'); process.exit(1) }
const ext = await ctx.newPage()
await ext.goto(`chrome-extension://${new URL(sw.url()).host}/dashboard.html`)
console.log('blocker level', await ext.evaluate(() => chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: 3 })))
await ext.close()
await new Promise(r => setTimeout(r, 3000))

const measure = () => {
  const q = s => document.querySelector(s)
  const all = s => [...document.querySelectorAll(s)]
  const rail = all('.fx-rail [aria-label]').map(e => e.getAttribute('aria-label'))
  return {
    overflowX: document.documentElement.scrollWidth > innerWidth, mainShown: q('.fx-main') ? getComputedStyle(q('.fx-main')).display !== 'none' : false,
    tabs: all('.fx-top .fx-tabs a').map(e => e.textContent.trim().replace(/\d+$/, '')), railConnect: rail.includes('Connect'), warnDot: !!q('.adm-warndot'),
    title: q('.fx-head h1')?.textContent || '', subTabs: all('.adm-pagetabs .fx-ptab').map(e => e.textContent.trim()),
    lanes: all('.adm-board7 .fx-lane').map(l => l.getAttribute('aria-label')), cards: all('.adm-scard').length,
    ready: all('.adm-ready-list li .tp-chip').map(e => e.textContent.trim()), goConnect: !!all('button').find(b => b.textContent.includes('Go to Connect')),
    drawer: q('.adm-steps') ? { done: all('.adm-steps li.is-done').length, total: all('.adm-steps li').length, pct: q('.adm-pctbig')?.textContent } : null,
    boardFits: q('.adm-board7') ? q('.adm-board7').scrollWidth <= q('.adm-board7').clientWidth + 1 : null,
    hidden: all('.adm-setup, .adm-connect, .fx-main').filter(e => getComputedStyle(e).display === 'none').length,
  }
}
const report = []
for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
  for (const v of VIEWS) {
    const page = await ctx.newPage()
    await page.setViewportSize({ width: v.w, height: v.h })
    await page.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, theme)
    for (const [name, path, full, act] of PAGES.filter(p => !process.env.ONLY || process.env.ONLY.split(',').includes(p[0]))) {
      await page.goto(BASE + path, { waitUntil: 'load' })
      await page.waitForTimeout(2400)
      if (act === 'sample') { await page.getByRole('button', { name: 'See a sample' }).click(); await page.waitForTimeout(1600) }
      const m = await page.evaluate(measure)
      report.push({ theme, w: v.w, name, ...m })
      await page.screenshot({ path: `${OUT}/${name}-${v.w}-${theme}.png`, fullPage: !!full })
    }
    await page.close()
  }
}

// Logic checks (one view): every card's % matches its drawer's ticks; tick a step, Mark live moves the card.
const page = await ctx.newPage()
await page.goto(`${BASE}/preview/admin/setup`, { waitUntil: 'load' })
await page.waitForTimeout(2400)
const cards = await page.evaluate(() => [...document.querySelectorAll('.adm-scard')].map(c => ({ name: c.querySelector('h3').textContent, pct: c.querySelector('.adm-scard-pct').textContent, href: c.querySelector('.fx-cover').getAttribute('href') })))
const match = []
for (const c of cards) {
  await page.goto(BASE + c.href, { waitUntil: 'load' })
  await page.waitForTimeout(1200)
  const d = await page.evaluate(() => ({ done: document.querySelectorAll('.adm-steps li.is-done').length, total: document.querySelectorAll('.adm-steps li').length, pct: document.querySelector('.adm-pctbig')?.textContent }))
  match.push({ ...c, ...d, ok: d.pct === c.pct && `${Math.round((d.done / d.total) * 100)}%` === c.pct })
}
// Derek: tick the test lead, then Mark live (client-side, same page so the sample store keeps the change)
await page.goto(`${BASE}/preview/admin/setup`, { waitUntil: 'load' })
await page.waitForTimeout(2000)
await page.getByRole('link', { name: "Open Derek Shaw's setup" }).click()
await page.waitForTimeout(900)
const liveBefore = await page.getByRole('button', { name: 'Mark live' }).isDisabled()
await page.getByRole('switch', { name: 'First test lead run and passed' }).click()
await page.waitForTimeout(300)
const liveAfterTick = await page.getByRole('button', { name: 'Mark live' }).isDisabled()
await page.getByRole('button', { name: 'Mark live' }).click()
await page.waitForTimeout(500)
const log = await page.evaluate(() => [...document.querySelectorAll('.adm-log li b')].slice(0, 2).map(b => b.textContent))
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
const liveLane = await page.evaluate(() => [...document.querySelectorAll('.fx-lane')].find(l => l.getAttribute('aria-label').startsWith('Live this week')).querySelectorAll('h3').length)
// Add a new client: the invite lands in Invited
await page.getByRole('button', { name: 'Add a new client' }).click()
await page.waitForTimeout(500)
await page.getByLabel('Full name').fill('Test Person')
await page.getByLabel('Email').fill('test.person@example.com')
await page.getByRole('button', { name: 'Send invite' }).click()
await page.waitForTimeout(800)
const invited = await page.evaluate(() => [...document.querySelectorAll('.fx-lane')][0].getAttribute('aria-label'))
const flow = { liveBefore, liveAfterTick, log, liveLane, invited }
writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, match, flow }, null, 1))
for (const r of report) console.log(r.theme, r.w, r.name, JSON.stringify({ ox: r.overflowX, main: r.mainShown, tabs: r.tabs.join('|'), rc: r.railConnect, dot: r.warnDot, title: r.title, sub: r.subTabs, lanes: r.lanes.length, cards: r.cards, ready: r.ready.join(','), go: r.goConnect, drawer: r.drawer, fits: r.boardFits, hidden: r.hidden }))
console.log('cards % = drawer ticks:', match.filter(m => m.ok).length, 'of', match.length, JSON.stringify(match.filter(m => !m.ok)))
console.log('flow', JSON.stringify(flow))
await ctx.close()
