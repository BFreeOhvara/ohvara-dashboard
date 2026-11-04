// P828 proof (P829: new layout selectors, record drawers, --out): the agent shell at the real agent URLs, signed in as the test accounts in ~/.atlas/test-logins.json.
//   node scripts/shell-live-check.mjs --base-url <url>      a running site (local `vite preview` of a real build, or production)
//   add --no-shots to skip the 78 screenshots (production re-check); --out <dir> picks the shot folder (default qa/shell-live)
// Agent: 13 URLs x 1920/1440/390 x light/dark. Each page: rail (desktop), search, account, title, Messages reachable
// (top bar on desktop, bottom bar on a phone), no console errors, no sideways scroll. Shots to qa/shell-live/.
// Admin + Fulfillment: their pages show no shell. Logged out: /agent lands on /login.
// Every non-GET request to the backend is listed: the shell may only write what sign-in already writes.
import process from 'node:process'
import { readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const SHOTS = !args.includes('--no-shots')
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const OUT = flag('--out') || 'qa/shell-live'
mkdirSync(OUT, { recursive: true })

const URLS = ['/agent', '/agent/leads', '/agent/inbounds/sample-lead-1', '/agent/calendar', '/agent/clients', '/agent/clients/sample-client-1', '/agent/submit',
  '/agent/request-service', '/agent/activity', '/agent/billing', '/agent/more', '/settings', '/messages']
const VIEWS = [{ w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 390, h: 844 }]
const failures = []
const writes = []
const fail = (where, msg) => failures.push(`${where}: ${msg}`)

const browser = await chromium.launch()

async function signIn(role, theme = 'dark', view = VIEWS[1]) {
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: theme })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 200)}`))
  page.on('request', r => {
    if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /supabase\.co/.test(r.url()) && !/\/auth\/v1\/token/.test(r.url())) {
      const body = /sign-in|signup|password/i.test(r.url()) ? '[body hidden]' : (r.postData() || '').replace(/"last_login_at":"[^"]+"/, '"last_login_at":"…"').slice(0, 80)
      writes.push(`${role} ${r.method()} ${r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 120)} ${body}`)
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
    const { ctx, page, errors } = await signIn('agent', theme, view)
    for (const url of URLS) {
      const where = `agent ${view.w} ${theme} ${url}`
      errors.length = 0
      await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('.tp-app', { timeout: 15000 }).catch(() => fail(where, 'no shell (.tp-app) on the page'))
      await page.waitForTimeout(SHOTS ? 1500 : 500) // let the page's entrance motion settle before measuring
      const m = await page.evaluate(desk => {
        const vis = el => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'
        const q = s => document.querySelector(s)
        return {
          path: location.pathname,
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rail: vis(q('.tp-rail')),
          oldSidebar: !!q('aside.sidebar, aside nav .nav-item'),
          search: desk ? vis(q('.tp-rail [aria-label^="Search"]')) : vis(q('.tp-bar [aria-label="Search"]')),
          account: desk ? vis(q('.tp-me')) : vis(q('.tp-phone-top [aria-label="Menu"]')),
          title: (q('.tp-head .tp-cn')?.textContent || '').trim(),
          messages: desk ? vis(q('.tp-top a[aria-label="Messages"]')) : vis(q('.tp-phone-top a[aria-label="Messages"]')),
          drawer: vis(q('.fx-rec')),
          sample: (q('.tp-foot')?.textContent || '').includes('Sample info'),
        }
      }, view.w >= 1000)
      const shot = `${url.slice(1).replace(/\//g, '-')}-${view.w}-${theme}.png`
      if (SHOTS) await page.screenshot({ path: join(OUT, shot) })
      if (m.path !== url) fail(where, `landed on ${m.path}`)
      if (m.sideways > 0) fail(where, `sideways scroll ${m.sideways}px`)
      if (view.w >= 1000 && !m.rail) fail(where, 'no left rail')
      if (m.oldSidebar) fail(where, 'old sidebar present')
      if (!m.search) fail(where, 'search missing')
      if (!m.account) fail(where, 'account missing')
      if (!m.title) fail(where, 'no title')
      if (!m.messages) fail(where, 'Messages not reachable')
      if (/\/(inbounds|clients)\/./.test(url) !== m.drawer) fail(where, m.drawer ? 'record drawer open on a list page' : 'record drawer missing')
      if (errors.length) fail(where, `console: ${errors[0]}`)
      rows.push(`${view.w} ${theme.padEnd(5)} ${url.padEnd(32)} ${m.title.padEnd(18)} rail=${m.rail ? 'y' : 'n'} drawer=${m.drawer ? 'y' : 'n'} sx=${m.sideways} err=${errors.length}`)
    }
    await ctx.close()
  }
}

// Admin and Fulfillment: today's screens, no shell anywhere.
for (const [role, urls] of [['admin', ['/admin', '/settings', '/messages', '/agent/leads']], ['fulfill', ['/fulfillment', '/settings', '/messages', '/agent']]]) {
  const { ctx, page, errors } = await signIn(role)
  for (const url of urls) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const shell = await page.evaluate(() => !!document.querySelector('.tp-app'))
    const path = await page.evaluate(() => location.pathname)
    if (SHOTS) await page.screenshot({ path: join(OUT, `role-${role}${url.replace(/\//g, '-')}-1440-dark.png`) })
    if (shell) fail(`${role} ${url}`, 'shows the agent shell')
    rows.push(`${role.padEnd(7)} ${url.padEnd(16)} -> ${path.padEnd(16)} shell=${shell ? 'YES' : 'no'} err=${errors.length}`)
  }
  await ctx.close()
}

// Logged out.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  for (const url of ['/agent', '/agent/leads', '/settings']) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
    const path = await page.evaluate(() => location.pathname)
    if (path !== '/login') fail(`logged out ${url}`, `landed on ${path}`)
    rows.push(`logged-out ${url.padEnd(14)} -> ${path}`)
  }
  await ctx.close()
}
await browser.close()

console.log(rows.join('\n'))
console.log(`\nWrites to the backend (${writes.length}):\n${[...new Set(writes)].join('\n') || '  none'}`)
if (failures.length) { console.log(`\n${failures.length} failure(s):\n  - ${failures.join('\n  - ')}`); process.exit(1) }
console.log('\nAll checks passed.')
