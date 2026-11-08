// P858 proof: every admin page on REAL data, signed in as the test admin (~/.atlas/test-logins.json "admin"),
// View: Real. Then the agent and VA portals load as before (P858 touches neither).
//   node scripts/admin-858-shots.mjs --base-url <url> [--no-shots]
// 1440 + 390, light + dark. Shots to qa/admin-858/. Measures: crash panel, uncaught errors, sideways scroll, stuck
// loading, sample footer, and lists every write (should be none: the script only reads) and every database object
// the live database doesn't have yet (migrations 230/232, on the door list).
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
const OUT = 'qa/admin-858'
mkdirSync(OUT, { recursive: true })

const PAGES = ['/admin', '/admin/agents', '/admin/setup', '/admin/fulfillment', '/admin/inbounds', '/admin/pipeline', '/admin/billing', '/admin/messages', '/admin/settings', '/admin/connect']
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const failures = []
const writes = []
const missing = new Set()
const rows = []
const fail = (where, msg) => failures.push(`${where}: ${msg}`)
const browser = await chromium.launch()

async function signIn(ctx, who, theme) {
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t); localStorage.setItem('ohvara-view', 'real') } catch { /* private */ } }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 200)}`))
  page.on('response', r => {
    const u = r.url()
    if (!/supabase\.co/.test(u) || r.status() < 400) return
    const path = u.replace(/^https:\/\/[^/]+/, '').split('?')[0]
    // A read of a table / function the live database doesn't have yet (230/232 unapplied): the page shows it empty.
    if ([400, 404].includes(r.status()) && r.request().method() !== 'POST' || /\/rpc\//.test(path)) missing.add(`${r.status()} ${path}`)
    else errors.push(`${r.status()} ${r.request().method()} ${path}`)
  })
  page.on('request', r => {
    const u = r.url()
    if (['GET', 'OPTIONS', 'HEAD'].includes(r.method()) || !/supabase\.co/.test(u)) return
    if (/\/auth\/v1\/|\/functions\/v1\/(self-signup|username-sign-in)/.test(u) || /last_login_at/.test(r.postData() || '')) return
    // RPCs are reads unless the name says it changes something.
    if (/\/rest\/v1\/rpc\//.test(u) && !/_(set|save|mark|assign|claim|release|send|decide|give|tick|map|start|end|record|delete)(_|$|\?)/.test(u)) return
    writes.push(`${r.method()} ${u.replace(/^https:\/\/[^/]+/, '').split('?')[0]}`)
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="you@email.com"]', logins[who].email)
  await page.fill('input[placeholder="Your password"]', logins[who].password)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => fail(who, 'sign-in failed'))
  await page.waitForLoadState('networkidle').catch(() => {})
  return { page, errors }
}

const measure = page => page.evaluate(() => ({
  sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  crash: !!document.querySelector('.ov-crash'),
  loading: /Loading the real numbers|Loading…/.test(document.querySelector('.fx-main')?.innerText || ''),
  sampleFoot: !!document.querySelector('.tp-foot'),
  slots: document.querySelectorAll('.es-slot, [data-engine-slot]').length,
  text: (document.querySelector('.fx-main') || document.body).innerText.length,
}))

for (const theme of ['light', 'dark']) {
  for (const view of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: theme })
    const { page, errors } = await signIn(ctx, 'admin', theme)
    for (const url of PAGES) {
      const where = `${view.w} ${theme} ${url}`
      errors.length = 0
      await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('.fx-main', { timeout: 15000 }).catch(() => fail(where, 'no shell'))
      await page.waitForTimeout(1200)
      const m = await measure(page)
      if (SHOTS) await page.screenshot({ path: join(OUT, `${url.slice(1).replace(/\//g, '-')}-${view.w}-${theme}.png`) })
      if (m.crash) fail(where, 'crash panel')
      if (m.sideways > 0) fail(where, `sideways ${m.sideways}px`)
      if (m.loading) fail(where, 'still loading')
      if (m.sampleFoot) fail(where, 'sample footer on real data')
      if (errors.length) fail(where, `console: ${errors[0]}`)
      rows.push(`admin ${view.w} ${theme.padEnd(5)} ${url.padEnd(20)} chars=${m.text} slots=${m.slots} sx=${m.sideways} err=${errors.length}`)
    }
    await ctx.close()
  }
}

// Agent and VA portals: P858 changes neither; they load, no crash, no uncaught error.
for (const [who, urls] of [['agent', ['/', '/leads', '/billing']], ['fulfill', ['/fulfillment', '/fulfillment/leads']]]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  const { page, errors } = await signIn(ctx, who, 'light')
  for (const url of urls) {
    errors.length = 0
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const m = await page.evaluate(() => ({ crash: !!document.querySelector('.ov-crash, .tp-crash, [role="alert"].crash'), len: document.body.innerText.length, at: location.pathname }))
    if (m.crash) fail(`${who} ${url}`, 'crash panel')
    if (errors.length) fail(`${who} ${url}`, `console: ${errors[0]}`)
    rows.push(`${who.padEnd(7)} ${url.padEnd(20)} -> ${m.at} chars=${m.len} err=${errors.length}`)
  }
  await ctx.close()
}
await browser.close()
console.log(rows.join('\n'))
console.log(`\nNot on the live database yet (${missing.size}):\n  ${[...missing].join('\n  ') || 'none'}`)
console.log(`\nWrites (${writes.length}):\n  ${[...new Set(writes)].join('\n  ') || 'none'}`)
if (failures.length) { console.log(`\n${failures.length} failure(s):\n  - ${[...new Set(failures)].join('\n  - ')}`); process.exit(1) }
console.log('\nAll checks passed.')
