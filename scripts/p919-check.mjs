// P919 proof: signed in as the test admin, agent and VA (~/.atlas/test-logins.json), in a visible browser, against a
// local dev server. Every old portal address lands on a new page, nothing shows the old admin pages, and the switch
// that used to keep a tab on them (?classic=1 / sessionStorage) does nothing. Run: node scripts/p919-check.mjs --base=http://localhost:4919
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d
const BASE = arg('base', 'http://localhost:4919').replace(/\/$/, '')
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
mkdirSync('qa/p919', { recursive: true })

// [address opened, where it must land (pathname, or pathname+hash), which frame must show]
const CASES = {
  admin: [
    ['/admin?classic=1', '/admin', 'adm'], ['/admin/pipeline', '/admin/pipeline', 'adm'], ['/admin/fulfillment', '/admin/fulfillment', 'adm'],
    ['/admin/payouts', '/admin/billing', 'adm'], ['/admin/users', '/admin/settings', 'adm'], ['/admin/more', '/admin/settings', 'adm'],
    ['/admin/carriers', '/settings', 'old-shared'], ['/admin/nope', '/admin', 'adm'],
    ['/agent/submit', '/admin/pipeline', 'adm'], ['/agent/activity', '/admin', 'adm'], ['/agent/clients', '/admin/pipeline', 'adm'],
    ['/fulfillment', '/admin', 'adm'], ['/fulfillment/desk', '/admin/fulfillment', 'adm'], ['/fulfillment/leads', '/admin/inbounds', 'adm'],
    ['/fulfillment/pipeline', '/admin/pipeline', 'adm'], ['/', '/admin', 'adm'],
  ],
  agent: [['/agent', '/agent', 'agent'], ['/agent/submit', '/agent/submit', 'agent'], ['/agent/clients', '/agent/clients', 'agent'], ['/admin', '/agent', 'agent'], ['/admin/pipeline', '/agent', 'agent']],
  fulfill: [['/fulfillment', '/fulfillment', 'fs'], ['/fulfillment/desk', null, 'fs'], ['/fulfillment/pipeline', '/fulfillment/pipeline', 'fs'], ['/admin', '/fulfillment', 'fs']],
}

const frameOf = page => page.evaluate(() => {
  const app = document.querySelector('.tp-app')
  if (app?.classList.contains('adm')) return 'adm'
  if (app?.classList.contains('fs')) return 'fs'
  if (app) return 'agent'
  return document.querySelector('main, #root > *') ? 'old-shared' : 'none'
})

const failures = []
const browser = await chromium.launch({ headless: false })
for (const who of ['admin', 'agent', 'fulfill']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  // The stuck state Brayden hit: this tab remembered "use the old pages".
  await page.evaluate(() => sessionStorage.setItem('ohvara-admin-classic', '1'))
  await page.fill('input[placeholder="you@email.com"]', logins[who].email)
  await page.fill('input[placeholder="Your password"]', logins[who].password)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => failures.push(`${who}: sign-in failed`))
  await page.waitForLoadState('networkidle').catch(() => {})
  const landed = new URL(page.url()).pathname
  await page.waitForTimeout(1200); console.log(`${who}: signed in, landed on ${landed} (${await frameOf(page)})`)
  for (const [from, to, frame] of CASES[who]) {
    await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const u = new URL(page.url())
    const got = await frameOf(page)
    const okPath = to === null || u.pathname === to
    const ok = okPath && got === frame
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${who} ${from} -> ${u.pathname}${u.hash} [${got}]`)
    if (!ok) failures.push(`${who} ${from} -> ${u.pathname} [${got}], wanted ${to} [${frame}]`)
  }
  if (who === 'admin') {
    const stored = await page.evaluate(() => sessionStorage.getItem('ohvara-admin-classic'))
    if (stored !== null) failures.push(`admin: classic flag still stored (${stored})`)
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
    const text = await page.evaluate(() => document.body.innerText)
    // Open the avatar menu and read it.
    const av = page.locator('button.fx-me:visible').first()
    if (await av.count()) { await av.click().catch(() => {}); await page.waitForTimeout(400) }
    const menu = await page.evaluate(() => document.querySelector('.fx-menu')?.innerText || '')
    console.log(`admin avatar menu: ${menu.replace(/\s+/g, ' ').slice(0, 160)}`)
    if (/old admin|classic/i.test(text + menu)) failures.push('admin: a way back to the old pages is still shown')
    await page.screenshot({ path: 'qa/p919/admin-menu.png' })
    // Revenue → Payouts: the real bank row (signed in, real view).
    await page.evaluate(() => localStorage.setItem('ohvara-view', 'real'))
    await page.goto(`${BASE}/admin/billing?tab=payouts`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const bank = await page.evaluate(() => [...document.querySelectorAll('li')].find(li => /Your bank/.test(li.innerText))?.innerText.replace(/\s+/g, ' ') || 'missing')
    console.log(`admin real Revenue bank row: ${bank}`)
    if (/7781/.test(bank) || bank === 'missing') failures.push(`admin: real bank row wrong (${bank})`)
    await page.evaluate(() => localStorage.removeItem('ohvara-view'))
  }
  if (errors.length) failures.push(`${who} page errors: ${errors.join(' | ')}`)
  await ctx.close()
}
await browser.close()
console.log(failures.length ? `\nFAILURES (${failures.length}):\n${failures.join('\n')}` : '\nALL PASS')
process.exit(failures.length ? 1 : 0)
