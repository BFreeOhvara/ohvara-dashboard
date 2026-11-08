// P852 proof: the Fulfillment (VA) pages on REAL data, signed in as the test VA (~/.atlas/test-logins.json "fulfill"),
// View: Real (lib/dataMode PREVIEW_IDS lets the test VA preview it).
//   node scripts/shell-852-shots.mjs --base-url <url> [--no-shots]
// Two passes: "filled" reads the test VA's own rows; "empty" answers every VA-data read with [] (route stub), so the
// first-run / empty states show. 1440 + 390, light + dark. Shots to qa/fulfillment-852/. Measures: sideways scroll,
// console errors, error box, loading stuck, sample footer gone, no sample names on the page, and lists every backend
// write (should be none: the script only reads).
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
const login = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8')).fulfill
const OUT = 'qa/fulfillment-852'
mkdirSync(OUT, { recursive: true })

const URLS = ['/fulfillment', '/fulfillment/leads', '/fulfillment/schedule', '/fulfillment/pipeline', '/fulfillment/servicing', '/fulfillment/pay', '/fulfillment/training', '/messages', '/settings']
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
// VA-data reads the real hooks make (hooks/fulRealData.js). Profile, settings and auth pass through.
const DATA = /\/rest\/v1\/(rpc\/(va_queue|va_servicing_queue|my_message_threads|va_agent_roster|va_lead_replies)|policies|policy_messages|notifications|fulfillment_cancels|fulfillment_payouts|fulfillment_payout_accounts)\b/
// Names that exist only in the sample (data.js, p879): none may show on real data.
const SAMPLE_NAMES = /Maya Brooks|Gloria Santos|Angela Moore|Dana Walker|Marcus Reed|Priya Shah|Leo Grant/
const failures = []
const writes = []
const rows = []
const fail = (where, msg) => failures.push(`${where}: ${msg}`)
const browser = await chromium.launch()

for (const pass of ['filled', 'empty']) {
  for (const theme of ['light', 'dark']) {
    for (const view of VIEWS) {
      const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: theme })
      await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t); localStorage.setItem('ohvara-view', 'real') } catch { /* private */ } }, theme)
      if (pass === 'empty') await ctx.route(DATA, r => (r.request().method() === 'GET' || /\/rpc\//.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.continue()))
      const page = await ctx.newPage()
      const errors = []
      // A worktree's node_modules is a junction outside Vite's allowed folder, so its font files 403 locally (not on the live build).
      // P851's rota probe: va_shift_week 404s until migration 231 is applied, and the pages fall back to "not set" (door list).
      const PROBE = /\/rpc\/va_shift_week|\/rpc\/va_day_off/
      const FONT = /@fs\/.*\.woff|Failed to load resource: the server responded with a status of 403/
      page.on('console', m => { if (m.type() === 'error' && !FONT.test(m.text()) && !/status of 404/.test(m.text())) errors.push(m.text().slice(0, 200)) })
      page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 200)}`))
      page.on('response', r => { if (r.status() >= 400 && !FONT.test(r.url()) && !(r.status() === 404 && PROBE.test(r.url()))) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 140)}`) })
      page.on('request', r => {
        const u = r.url()
        if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /supabase\.co/.test(u) && !/\/auth\/v1\/|\/functions\/v1\/(self-signup|username-sign-in)/.test(u) && !/last_login_at/.test(r.postData() || '') && !/\/rest\/v1\/rpc\//.test(u)) writes.push(`${r.method()} ${u.replace(/^https:\/\/[^/]+/, '').slice(0, 100)}`)
        if (/\/rpc\/(va_claim|va_release|va_set_lead_outcome|fulfillment_(start|end|mark|pass|save)|va_servicing_(claim|release|outcome|schedule|send|done|cancel))/.test(u)) writes.push(`RPC ${u.replace(/^https:\/\/[^/]+/, '')}`)
      })
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
      await page.fill('input[placeholder="you@email.com"]', login.email)
      await page.fill('input[placeholder="Your password"]', login.password)
      await page.click('button[type="submit"]')
      await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => fail(pass, 'sign-in failed'))
      for (const url of URLS) {
        const where = `${pass} ${view.w} ${theme} ${url}`
        errors.length = 0
        await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
        await page.waitForSelector('.tp-app', { timeout: 15000 }).catch(() => fail(where, 'no shell'))
        await page.waitForTimeout(1500)
        const m = await page.evaluate(() => ({
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          first: document.querySelectorAll('.dz-first').length,
          err: !!document.querySelector('.dz-err'),
          loading: !!document.querySelector('.dz-skel'),
          sampleFoot: !!document.querySelector('.tp-foot'),
          text: document.querySelector('.tp-app')?.innerText || '',
        }))
        const sampleHit = (SAMPLE_NAMES.exec(m.text) || [])[0]
        if (SHOTS) await page.screenshot({ path: join(OUT, `${pass}-${url.slice(1).replace(/\//g, '-')}-${view.w}-${theme}.png`) })
        if (m.sideways > 0) fail(where, `sideways ${m.sideways}px`)
        if (m.err) fail(where, 'error box')
        if (m.loading) fail(where, 'still loading')
        if (m.sampleFoot) fail(where, 'sample footer on real data')
        if (sampleHit) fail(where, `sample name on real data: ${sampleHit}`)
        if (errors.length) fail(where, `console: ${errors[0]}`)
        rows.push(`${pass.padEnd(6)} ${view.w} ${theme.padEnd(5)} ${url.padEnd(24)} first=${m.first} chars=${m.text.length} sx=${m.sideways} err=${errors.length}`)
      }
      await ctx.close()
    }
  }
}
await browser.close()
console.log(rows.join('\n'))
console.log(`\nWrites (${writes.length}):\n${[...new Set(writes)].join('\n') || '  none'}`)
if (failures.length) { console.log(`\n${failures.length} failure(s):\n  - ${[...new Set(failures)].join('\n  - ')}`); process.exit(1) }
console.log('\nAll checks passed.')
