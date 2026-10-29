// Screenshots /agent/billing (and the approved mockup) with every Supabase call
// mocked, so no real project, account or credentials are touched.
//   node scripts/prepaid-billing-shots.mjs [outDir]
// Writes PNGs plus measurements.json into outDir (default qa/prepaid-billing).
import process from 'node:process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/prepaid-billing'
const MOCKUP = process.env.MOCKUP_FILE || 'C:/Users/freem/obsidian-mind/ohvara/leads/mockups/billing-balance.html'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

// ── Seed data (cents) ────────────────────────────────────────────────────────
const PRICES = [{ lead_type: 'mortgage_protection', price_cents: 3000 }, { lead_type: 'policy_help', price_cents: 5500 }]
const OPTIONS = [{ amount_cents: 10000 }, { amount_cents: 25000 }, { amount_cents: 50000 }]
const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString()
// newest first; balance_after is consistent row to row
const LEDGER = [
  { id: 'l1', kind: 'lead_charge', amount_cents: -3000, balance_after_cents: 4000, lead_type: 'mortgage_protection', created_at: ago(0.5) },
  { id: 'l2', kind: 'lead_charge', amount_cents: -5500, balance_after_cents: 7000, lead_type: 'policy_help', created_at: ago(2) },
  { id: 'l3', kind: 'topup', amount_cents: 10000, balance_after_cents: 12500, lead_type: null, created_at: ago(5) },
  { id: 'l4', kind: 'lead_charge', amount_cents: -3000, balance_after_cents: 2500, lead_type: 'mortgage_protection', created_at: ago(30) },
  { id: 'l5', kind: 'lead_charge', amount_cents: -5500, balance_after_cents: 5500, lead_type: 'policy_help', created_at: ago(52) },
  { id: 'l6', kind: 'topup', amount_cents: 10000, balance_after_cents: 11000, lead_type: null, created_at: ago(120) },
]
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard',
  billing_current_period_end: new Date(Date.now() + 5 * 864e5).toISOString(),
}
const TIERS = [
  { key: 'standard', name: 'Standard', weekly_cents: 35000, weekly_cap: 7, sort_order: 1, is_active: true },
  { key: 'premium', name: 'Premium', weekly_cents: 50000, weekly_cap: 14, sort_order: 2, is_active: true },
]
const USAGE = { used: 3, weekly_cap: 7, enforced: true, tier_name: 'Standard', week_start: ago(48), week_end: new Date(Date.now() + 5 * 864e5).toISOString() }

// ── Scenarios ────────────────────────────────────────────────────────────────
// data: balance + ledger; fail: table that answers 500; hold: calls wait on a gate.
const SCENARIOS = {
  main: { balance: 4000, ledger: LEDGER },
  empty: { balance: 0, ledger: [] },
  low: { balance: 1900, ledger: LEDGER.map((r, i) => (i === 0 ? { ...r, balance_after_cents: 1900 } : r)) },
  loading: { balance: 4000, ledger: LEDGER, hold: true },
  error: { balance: 4000, ledger: LEDGER, fail: 'agent_lead_ledger' },
}

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}

const CORS = {
  'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
}
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, sc, gate, seen) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = (all) => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [USAGE])
    const table = path.replace('/rest/v1/', '')
    if (['agent_lead_balance', 'lead_prices', 'prepaid_topup_options', 'agent_lead_ledger'].includes(table)) {
      seen.push(table)
      if (sc.hold) await gate
      if (sc.fail === table) return json(route, 500, { code: 'XX000', message: 'mock failure', details: null, hint: null })
      if (table === 'agent_lead_balance') return rows([{ balance_cents: sc.balance }])
      if (table === 'lead_prices') return rows(PRICES)
      if (table === 'prepaid_topup_options') return rows(OPTIONS)
      return rows(sc.ledger)
    }
    if (table === 'agent_billing_tiers') return rows(TIERS)
    return rows([])
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }

const measure = (page) => page.evaluate(() => {
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left * 100) / 100, top: Math.round(r.top * 100) / 100, width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 } }
  const de = document.documentElement
  const pre = box('.ov-bill-col.is-pre'), plan = box('.ov-bill-col.is-plan')
  const heroNum = document.querySelector('.ov-bal-num')
  const topups = [...document.querySelectorAll('.ov-bal-topups .ov-hero-btn')].map(b => ({ text: b.textContent, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), font: getComputedStyle(b).fontFamily.split(',')[0] }))
  return {
    pre, plan,
    sideBySide: !!(pre && plan && pre.left >= plan.left + plan.width - 1 && Math.abs(pre.top - plan.top) < 2),
    underPlan: !!(pre && plan && pre.top >= plan.top + plan.height - 1 && Math.abs(pre.left - plan.left) < 2),
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, bodyScrollWidth: document.body.scrollWidth,
    maxRight: Math.round(Math.max(...[...document.body.querySelectorAll('*')].map(e => e.getBoundingClientRect().right)) * 100) / 100,
    theme: de.getAttribute('data-theme'),
    balanceFont: heroNum ? getComputedStyle(heroNum).fontFamily.split(',')[0] : null,
    balanceText: heroNum?.textContent ?? null,
    topups,
    history: [...document.querySelectorAll('#ov-bal-history ~ ul li, section[aria-labelledby="ov-bal-history"] li')].map(li => li.innerText.replace(/\n/g, ' | ')),
  }
})

// Set before Vite reads its env: the app talks to a fake host, never the real project.
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []

async function shot(scName, theme, w) {
  const sc = SCENARIOS[scName]
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  let release; const gate = new Promise(r => { release = r })
  const seen = []
  await mock(page, sc, gate, seen)
  await page.goto(`${base}/agent/billing`, { waitUntil: 'domcontentloaded' })
  if (scName === 'loading') await page.waitForSelector('.ov-bal-skel', { timeout: 30000 })
  else if (scName === 'error') await page.getByText("Balance isn't available right now.").waitFor({ timeout: 30000 })
  else await page.waitForSelector('.ov-bal-num', { timeout: 30000 })
  await page.waitForTimeout(700) // card fade-in, fonts
  const m = await measure(page)
  const file = `app-${scName}-${w}-${theme}.png`
  await page.screenshot({ path: join(OUT, file), fullPage: true })
  results.push({ file, scenario: scName, width: w, theme, requests: [...new Set(seen)], pageErrors: errors, ...m })
  release()
  await ctx.close()
}

async function mockupShot(theme, w) {
  if (!existsSync(MOCKUP)) return
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  const page = await ctx.newPage()
  await page.goto(`file:///${MOCKUP.replace(/\\/g, '/')}?theme=${theme}`, { waitUntil: 'load' }).catch(() => {})
  await page.waitForTimeout(800)
  const file = `mockup-${w}-${theme}.png`
  await page.screenshot({ path: join(OUT, file), fullPage: false })
  const m = await page.evaluate(() => {
    const r = document.querySelector('#prepaid')?.getBoundingClientRect()
    const p = document.querySelector('.col')?.getBoundingClientRect()
    return { pre: r && { left: r.left, top: r.top, width: r.width }, plan: p && { left: p.left, top: p.top, width: p.width, height: p.height }, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }
  })
  results.push({ file, scenario: 'mockup', width: w, theme, ...m })
  await ctx.close()
}

try {
  for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) await shot('main', theme, w)
  for (const sc of ['empty', 'low', 'loading', 'error']) {
    await shot(sc, 'light', 1440)
    await shot(sc, 'dark', 390)
  }
  for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) await mockupShot(theme, w)
} finally {
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(results, null, 2))
  await browser.close()
  await server.close()
}
for (const r of results) {
  console.log(`${r.file.padEnd(28)} pre=${r.pre ? `${r.pre.width}w@(${r.pre.left},${r.pre.top})` : '-'} plan=${r.plan ? `${r.plan.width}w@(${r.plan.left},${r.plan.top})` : '-'} side=${r.sideBySide} under=${r.underPlan} scroll=${r.scrollWidth}/${r.clientWidth} err=${(r.pageErrors || []).length}`)
}
