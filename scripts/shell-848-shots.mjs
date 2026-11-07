// P848 proof: the agent pages on REAL data, signed in as the test agent (~/.atlas/test-logins.json), View: Real.
//   node scripts/shell-848-shots.mjs --base-url <url> [--no-shots]
// Two passes: "filled" reads the test agent's own rows; "empty" answers every agent-data read with [] (route stub),
// so the first-run / empty states show. 1440 + 390, light + dark. Shots to qa/agent-848/. Measures: sideways scroll,
// console errors, error box, loading stuck, sample footer gone, and lists every backend write (should be none).
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
const login = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8')).agent
const OUT = 'qa/agent-848'
mkdirSync(OUT, { recursive: true })

const URLS = ['/agent', '/agent/leads', '/agent/calendar', '/agent/clients', '/agent/submit', '/agent/activity', '/agent/billing', '/settings', '/messages']
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
// Agent-data reads the real hooks make (hooks/agentRealData.js). Profile, settings and auth pass through.
const DATA = /\/rest\/v1\/(rpc\/(agent_inbounds|agent_servicing_items|my_message_threads|agent_activity_feed)|inbound_events|policies|policy_servicing_status|policy_messages|servicing_tasks|agent_inbound_spend|agent_lead_balance)\b/
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
      if (pass === 'empty') await ctx.route(DATA, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
      const page = await ctx.newPage()
      const errors = []
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
      page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 200)}`))
      page.on('request', r => {
        const u = r.url()
        if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /supabase\.co/.test(u) && !/\/auth\/v1\//.test(u) && !/\/rest\/v1\/rpc\//.test(u)) {
          writes.push(`${r.method()} ${u.replace(/^https:\/\/[^/]+/, '').slice(0, 100)}`)
        }
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
        await page.waitForTimeout(1200)
        const m = await page.evaluate(() => ({
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          first: document.querySelectorAll('.dz-first').length,
          empty: document.querySelectorAll('.dz-first, .tp-empty, [class*="empty"]').length,
          err: !!document.querySelector('.dz-err'),
          loading: !!document.querySelector('.dz-skel'),
          sampleFoot: !!document.querySelector('.tp-foot'),
          title: (document.querySelector('.tp-head .tp-cn')?.textContent || '').trim(),
          text: (document.querySelector('.tp-main')?.innerText || '').length,
        }))
        if (SHOTS) await page.screenshot({ path: join(OUT, `${pass}-${url.slice(1).replace(/\//g, '-')}-${view.w}-${theme}.png`) })
        if (m.sideways > 0) fail(where, `sideways ${m.sideways}px`)
        if (m.err) fail(where, 'error box')
        if (m.loading) fail(where, 'still loading')
        if (m.sampleFoot) fail(where, 'sample footer on real data')
        if (errors.length) fail(where, `console: ${errors[0]}`)
        rows.push(`${pass.padEnd(6)} ${view.w} ${theme.padEnd(5)} ${url.padEnd(16)} ${m.title.padEnd(16)} first=${m.first} empty=${m.empty} chars=${m.text} sx=${m.sideways} err=${errors.length}`)
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
