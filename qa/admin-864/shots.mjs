import process from 'node:process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

// P864 QA: uBlock Origin Lite ON (complete mode), light and dark, 1440 and 390. Shots + numbers in qa/admin-864.
//   node qa/admin-864/shots.mjs http://localhost:5864 <uBOL folder>
const [BASE, UBO] = process.argv.slice(2)
const OUT = 'qa/admin-864'
const PAGES = [
  ['admin-overview', '/preview/admin'], ['admin-money', '/preview/admin/billing'], ['admin-money-last', '/preview/admin/billing?period=last'],
  ['admin-connect', '/preview/admin/connect'], ['admin-setup-empty', '/preview/admin/connect?tab=setup'], ['admin-agents', '/preview/admin/agents'],
  ['agent-overview', '/template'], ['agent-leads', '/template/leads'], ['va-overview', '/template/fulfillment'], ['va-queue', '/template/fulfillment/leads'],
]
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ubo864-')), {
  headless: false, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${UBO}`, `--load-extension=${UBO}`],
})
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null)
if (!sw) { console.log('FAIL blocker did not load'); process.exit(1) }
const ext = await ctx.newPage()
await ext.goto(`chrome-extension://${new URL(sw.url()).host}/dashboard.html`)
console.log('blocker level', await ext.evaluate(() => chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: 3 })))
await ext.close()
await new Promise(r => setTimeout(r, 3000))

const measure = () => {
  const q = s => document.querySelector(s)
  const clock = q('.fx-clock')
  const r = clock?.getBoundingClientRect()
  const fs = s => (q(s) ? parseFloat(getComputedStyle(q(s)).fontSize) : null)
  const rail = [...document.querySelectorAll('.fx-rail [aria-label]')].map(e => e.getAttribute('aria-label'))
  const tabs = [...document.querySelectorAll('.fx-top .fx-tabs a, .fx-top .fx-tabs button')].map(e => e.textContent.trim().replace(/\d+$/, ''))
  const money = [...document.querySelectorAll('.adm-total .fx-huge')].map(e => Number(e.textContent.replace(/[^0-9-]/g, '')))
  const owners = [...document.querySelectorAll('.adm-owner-n')].map(e => Number(e.textContent.replace(/[^0-9-]/g, '')))
  return {
    clock: clock ? { text: clock.textContent, h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right), date: fs('.fx-clock-d'), time: fs('.fx-clock-t'), ap: fs('.fx-clock-ap'), base: [q('.fx-clock-d'), q('.fx-clock-t'), q('.fx-clock-ap')].map(e => Math.round(e.getBoundingClientRect().bottom)) } : null,
    overflowX: document.documentElement.scrollWidth > innerWidth, mainShown: q('.fx-main') ? getComputedStyle(q('.fx-main')).display !== 'none' : false,
    tabs, railConnect: rail.includes('Connect'), railApp: rail.includes('Get the phone app'), money, owners,
    empty: !!q('.adm-empty'), title: q('.fx-head h1')?.textContent || q('.fx-head')?.textContent.slice(0, 40),
  }
}
const report = []
for (const theme of ['light', 'dark']) {
  for (const v of VIEWS) {
    const page = await ctx.newPage()
    await page.setViewportSize({ width: v.w, height: v.h })
    await page.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, theme)
    for (const [name, path] of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'load' })
      await page.waitForTimeout(2600)
      const m = await page.evaluate(measure)
      report.push({ theme, w: v.w, name, ...m })
      await page.screenshot({ path: `${OUT}/${name}-${v.w}-${theme}.png`, fullPage: name.startsWith('admin-money') || name.startsWith('admin-setup') })
    }
    await page.close()
  }
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
for (const r of report) console.log(r.theme, r.w, r.name, JSON.stringify({ clock: r.clock && { h: r.clock.h, d: r.clock.date, t: r.clock.time, ap: r.clock.ap, base: r.clock.base, w: r.clock.w }, ox: r.overflowX, main: r.mainShown, tabs: r.tabs.join('|'), rc: r.railConnect, app: r.railApp, money: r.money, owners: r.owners, empty: r.empty }))
await ctx.close()
