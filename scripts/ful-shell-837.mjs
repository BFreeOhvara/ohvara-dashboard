// P837 proof: the Fulfillment shell at the real Fulfillment URLs, signed in as the test Fulfillment login in
// ~/.atlas/test-logins.json ("fulfill"). Also checks the agent shell and the admin pages are unchanged.
//   node scripts/ful-shell-837.mjs --base-url <url> [--no-shots] [--out qa/fulfillment-837]
// Each page x 1920/1440/390 x light/dark: the shell frame is there, the title, tabs (desktop) or bottom bar (phone),
// no console errors, no sideways scroll. Every non-GET request to the backend is listed (the shell adds none).
// Only clicks that read: the search palette and the account menu, each closed with Escape.
import process from 'node:process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const SHOTS = !args.includes('--no-shots')
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const OUT = flag('--out') || 'qa/fulfillment-837'
mkdirSync(OUT, { recursive: true })

const URLS = [['today', '/fulfillment'], ['queue', '/fulfillment/leads'], ['calls', '/fulfillment/desk'], ['clients', '/fulfillment/pipeline'],
  ['servicing', '/fulfillment/servicing'], ['pay', '/fulfillment/pay'], ['messages', '/messages'], ['settings', '/settings']]
const VIEWS = [{ w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 390, h: 844 }]
const failures = []
const writes = new Set()
const fail = (where, msg) => failures.push(`${where}: ${msg}`)
const browser = await chromium.launch()

async function signIn(role, theme, view) {
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: theme })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 200)}`))
  page.on('request', r => {
    if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /supabase\.co/.test(r.url()) && !/\/auth\/v1\//.test(r.url())) {
      const rpc = r.url().replace(/^https:\/\/[^/]+/, '').split('?')[0]
      // Reads that PostgREST sends as POST (rpc) are listed by name; the reviewer checks none of them write.
      writes.add(`${role} ${r.method()} ${rpc}`)
    }
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="you@email.com"]', logins[role].email)
  await page.fill('input[placeholder="Your password"]', logins[role].password)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => fail(role, `still on ${page.url()} after sign-in`))
  await page.waitForLoadState('networkidle')
  return { ctx, page, errors }
}

const rows = []
for (const theme of ['light', 'dark']) {
  for (const view of VIEWS) {
    const { ctx, page, errors } = await signIn('fulfill', theme, view)
    for (const [key, url] of URLS) {
      const where = `fulfill ${view.w} ${theme} ${url}`
      errors.length = 0
      await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      const m = await page.evaluate(() => {
        const app = document.querySelector('.tp-app.fs')
        const vis = el => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none'
        return {
          shell: !!app,
          path: location.pathname,
          title: [...document.querySelectorAll('.fx-head .fx-line')].map(e => e.textContent.trim()).join(' '),
          tabs: vis(document.querySelector('.fx-top .fx-tabs')),
          bar: vis(document.querySelector('.fx-bar')),
          rail: vis(document.querySelector('.fx-rail')),
          side: document.documentElement.scrollWidth - window.innerWidth,
          crash: /Something went wrong/i.test(document.body.innerText),
          oldSidebar: !!document.querySelector('aside.sidebar, .ov-sidebar, nav[aria-label="Main"]'),
          text: (document.querySelector('.fs-main')?.innerText || '').length,
        }
      })
      const phone = view.w < 768
      if (!m.shell) fail(where, 'no Fulfillment shell')
      if (m.path !== url) fail(where, `landed on ${m.path}`)
      if (phone ? !m.bar : !(m.tabs && m.rail)) fail(where, phone ? 'no bottom bar' : 'no tabs/rail')
      if (m.side > 1) fail(where, `sideways scroll ${m.side}px`)
      if (m.crash) fail(where, 'crash card')
      if (m.text < 20) fail(where, 'page body is empty')
      const errs = errors.filter(e => !/favicon|Failed to load resource: the server responded with a status of 40[34]/.test(e))
      if (errs.length) fail(where, `console: ${errs.join(' | ')}`)
      rows.push({ where, ...m, errors: errs.length })
      if (SHOTS) await page.screenshot({ path: `${OUT}/${key}-${view.w}-${theme}.png`, fullPage: view.w >= 768 })
    }
    if (view.w === 1440) {
      await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' })
      await page.keyboard.press('Control+k')
      const pal = await page.locator('.fx-pal').isVisible().catch(() => false)
      if (!pal) fail(`fulfill ${theme}`, 'Ctrl K did not open search')
      if (SHOTS && pal) await page.screenshot({ path: `${OUT}/search-1440-${theme}.png` })
      await page.keyboard.press('Escape')
      await page.click('.fx-tr .fx-me')
      const menu = await page.locator('.fx-menu').isVisible().catch(() => false)
      if (!menu) fail(`fulfill ${theme}`, 'account menu did not open')
      if (SHOTS && menu) await page.screenshot({ path: `${OUT}/menu-1440-${theme}.png` })
      await page.keyboard.press('Escape')
    }
    await ctx.close()
  }
}

// The other portals are unchanged: the agent still gets the agent shell, admin still gets today's pages.
{
  const { ctx, page } = await signIn('agent', 'dark', VIEWS[1])
  await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
  const a = await page.evaluate(() => ({ agentShell: !!document.querySelector('.tp-app.fx:not(.fs)'), fs: !!document.querySelector('.fs') }))
  if (!a.agentShell || a.fs) fail('agent /agent', `agent shell ${a.agentShell}, fulfillment shell ${a.fs}`)
  await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' })
  if (await page.locator('.fs').count()) fail('agent /fulfillment', 'agent got the Fulfillment shell')
  rows.push({ where: 'agent', ...a, landedFrom_fulfillment: new URL(page.url()).pathname })
  await ctx.close()
}
{
  const { ctx, page } = await signIn('admin', 'dark', VIEWS[1])
  for (const url of ['/admin', '/fulfillment', '/fulfillment/leads']) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
    const fs = await page.locator('.fs, .tp-app').count()
    if (fs) fail(`admin ${url}`, 'admin got a shell')
    rows.push({ where: `admin ${url}`, landed: new URL(page.url()).pathname, shell: fs > 0 })
  }
  await ctx.close()
}

await browser.close()
writeFileSync(`${OUT}/results.json`, JSON.stringify({ rows, writes: [...writes], failures }, null, 2))
console.log(`${rows.length} checks, ${failures.length} failures`)
console.log('Backend non-GET calls:', [...writes].join('\n  ') || 'none')
if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
