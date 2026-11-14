// P999 — proof shots + measurements for the new sign-in / create account screens and the admin agents filter.
// Runs against a local preview (sample data, no live database): BASE=http://localhost:4999 node scripts/p999-shots.mjs <outDir>
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:4999'
const OUT = process.argv[2] || 'qa/p999'
mkdirSync(OUT, { recursive: true })
const results = {}

const browser = await chromium.launch()
async function page({ w = 390, h = 844, theme = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 768 })
  if (theme) await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, theme)
  const p = await ctx.newPage()
  return { p, ctx }
}
const measure = p => p.evaluate(() => {
  const card = document.querySelector('.pa-card, .lg-card, .sx-card')?.getBoundingClientRect()
  const doc = document.documentElement
  const vis = sel => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? r.top >= 0 && r.bottom <= innerHeight : null }
  return {
    overflowX: doc.scrollWidth > innerWidth,
    card: card && { left: Math.round(card.left), right: Math.round(innerWidth - card.right), top: Math.round(card.top), bottom: Math.round(card.bottom), width: Math.round(card.width) },
    cardCentredPx: card ? Math.round(Math.abs((card.left + card.right) / 2 - innerWidth / 2)) : null,
    title: document.querySelector('.pa-card h2, .lg-card h2, .sx-card h2')?.textContent,
    titleAlign: (() => { const h = document.querySelector('.pa-card h2'); return h ? getComputedStyle(h).textAlign : null })(),
    signInBg: (() => { const b = document.querySelector('.pa-card button[type=submit]'); return b ? getComputedStyle(b).backgroundColor : null })(),
    apple: !!document.querySelector('.pa-sbtn--apple, .lg-sbtn--apple'), google: !!document.querySelector('.pa-sbtn--google, .lg-sbtn:not(.lg-sbtn--apple)'),
    createLink: [...document.querySelectorAll('a')].some(a => /Create account|Create an account/.test(a.textContent)),
    foot: [...document.querySelectorAll('.pa-foot a')].map(a => a.textContent),
    focusedVisible: document.activeElement && document.activeElement.tagName === 'INPUT' ? vis(':focus') : null,
  }
})

async function shot(name, url, opts = {}, after) {
  const { p, ctx } = await page(opts)
  await p.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(1200)
  if (after) await after(p)
  results[name] = await measure(p)
  await p.screenshot({ path: join(OUT, `${name}.png`) })
  await ctx.close()
}

await shot('phone-signin-light', '/login', { theme: null })
await shot('phone-signin-dark', '/login', { theme: 'dark' })
await shot('phone-create-light', '/signup?early=1')
await shot('phone-create-dark', '/signup?early=1', { theme: 'dark' })
await shot('phone-forgot-light', '/login?forgot=1')
// Keyboard open: the screen shrinks to ~480 px tall (what the app's web view does) with the password field focused.
await shot('phone-keyboard-light', '/login', { h: 480 }, async p => { await p.focus('input[name=password]'); await p.evaluate(() => document.activeElement.scrollIntoView({ block: 'center' })); await p.waitForTimeout(400) })
await shot('desk-signin-light', '/login', { w: 1440, h: 900 })
await shot('desk-signin-dark', '/login', { w: 1440, h: 900, theme: 'dark' })
await shot('desk-create-light', '/signup?early=1', { w: 1440, h: 900 })
// Admin (sample preview): the agents list, then the "Signed up, not active" filter.
await shot('admin-desk-agents', '/preview/admin/agents', { w: 1440, h: 900, theme: 'light' }, async p => {
  results.adminDeskOptions = await p.evaluate(() => [...document.querySelectorAll('[role=tab], .fx-seg button, button')].map(b => b.textContent.trim()).filter(t => /Signed up|^All/.test(t)))
})
await shot('admin-desk-idle', '/preview/admin/agents', { w: 1440, h: 900, theme: 'light' }, async p => {
  const b = p.getByText('Signed up, not active', { exact: false }).first()
  await b.click().catch(() => {}); await p.waitForTimeout(500)
  results.adminDeskIdleRows = await p.evaluate(() => [...document.querySelectorAll('.adm-tr:not(.adm-th) .adm-who b')].map(b => b.textContent))
})
await shot('admin-phone-agents', '/preview/admin/agents', { w: 390, h: 844, theme: 'light' }, async p => {
  const b = p.locator('.am-idle'); results.adminPhoneIdleButton = await b.textContent().catch(() => null)
  await b.click().catch(() => {}); await p.waitForTimeout(500)
  results.adminPhoneIdleRows = await p.evaluate(() => [...document.querySelectorAll('.ma-row b')].map(b => b.textContent))
})

await browser.close()
writeFileSync(join(OUT, 'measure.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 1))
