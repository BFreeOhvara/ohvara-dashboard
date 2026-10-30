// Scratch (not committed): /agent/billing shots for portal parity T6 with every Supabase call mocked.
//   node .scratch/billing-shots.mjs <outDir> <label> <path> [root]
// label = v2 | v1 | master | master-plan | pre-t2-plan; path = route to open. Signed in as the test agent (preview list),
// so v2 is on unless ?portal=v1. Functions answer { configured: true } to the mount-time status read only; nothing is clicked.
import process from 'node:process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const [OUT = 'qa/portal-parity-t6', LABEL = 'v2', PATH = '/agent/billing', ROOT = '.'] = process.argv.slice(2)
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const AGENT = '3f2b2df7-40b1-4921-80e2-09981c819642' // TEST_ACCOUNT_IDS (preview list)
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard', membership_tier: 'servicing_appointments',
  billing_current_period_end: new Date(Date.now() + 5 * 864e5).toISOString(),
}
const TIERS = [
  { key: 'standard', name: 'Standard', weekly_cents: 35000, weekly_cap: 7, sort_order: 1, is_active: true },
  { key: 'premium', name: 'Premium', weekly_cents: 50000, weekly_cap: 14, sort_order: 2, is_active: true },
]
const MEMBERSHIP = [
  { key: 'cancellations', name: 'Cancellations', product_keys: ['cancellations'], price_cents: null, monthly_appointments: null, description: null, sort_order: 10, is_active: true },
  { key: 'servicing', name: 'Servicing', product_keys: ['servicing'], price_cents: 29700, monthly_appointments: null, description: null, sort_order: 20, is_active: true },
  { key: 'servicing_appointments', name: 'Servicing + Appointments', product_keys: ['servicing', 'booked_appointments'], price_cents: 89950, monthly_appointments: 12, description: null, sort_order: 30, is_active: true },
  { key: 'servicing_live', name: 'Servicing + Live Calls', product_keys: ['servicing', 'live_calls'], price_cents: null, monthly_appointments: null, description: null, sort_order: 40, is_active: true },
]
const USAGE = { used: 3, weekly_cap: 7, enforced: true, tier_name: 'Standard', week_start: ago(48), week_end: new Date(Date.now() + 5 * 864e5).toISOString() }
const PRICES = [{ lead_type: 'mortgage_protection', price_cents: 3000 }, { lead_type: 'policy_help', price_cents: 5500 }]
const OPTIONS = [{ amount_cents: 10000 }, { amount_cents: 25000 }, { amount_cents: 50000 }]
const LEDGER = [
  { id: 'l1', kind: 'lead_charge', amount_cents: -3000, balance_after_cents: 4000, lead_type: 'mortgage_protection', created_at: ago(0.5) },
  { id: 'l2', kind: 'topup', amount_cents: 10000, balance_after_cents: 7000, lead_type: null, created_at: ago(5) },
]

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, calls) {
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (['data:', 'blob:'].includes(u.protocol) || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    calls.push(`blocked ${u.host}`)
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) { calls.push(`${req.method()} ${path} ${req.postData() || ''}`); if ((req.postData() || '').includes('"overview"')) return json(route, 200, { configured: true, subscription: { status: 'active', cancel_at_period_end: false, current_period_end: PROFILE.billing_current_period_end }, invoices: [], payment_method: null }); return json(route, 200, { configured: true }) }
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [USAGE])
    const table = path.replace('/rest/v1/', '')
    if (table === 'app_settings') return json(route, 200, { id: 1, agent_portal_v2: false })
    if (table === 'agent_billing_tiers') return rows(TIERS)
    if (table === 'membership_tiers') return rows(MEMBERSHIP)
    if (table === 'agent_lead_balance') return rows([{ balance_cents: 4000 }])
    if (table === 'lead_prices') return rows(PRICES)
    if (table === 'prepaid_topup_options') return rows(OPTIONS)
    if (table === 'agent_lead_ledger') return rows(LEDGER)
    return rows([])
  })
}

const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
const measure = page => page.evaluate(() => {
  const de = document.documentElement
  // Every text node showing an amount ($ and a digit): its font. Non-mono ones are listed.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const money = []
  for (let n; (n = walker.nextNode());) {
    const t = n.textContent.trim()
    if (!/\$\s?\d/.test(t) || !n.parentElement || !n.parentElement.offsetParent) continue
    money.push({ text: t.slice(0, 60), font: getComputedStyle(n.parentElement).fontFamily.split(',')[0].replace(/"/g, '') })
  }
  return {
    url: location.pathname + location.search,
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
    crumb: document.querySelector('.ov-hcrumb')?.innerText?.replace(/\s+/g, ' ') ?? null,
    planParts: !!document.querySelector('.pl2'),
    sections: [...document.querySelectorAll('main h2, main h3, [aria-label]')].map(e => e.getAttribute('aria-label') || e.innerText).filter(Boolean).slice(0, 60),
    money, moneyNotMono: money.filter(m => !/JetBrains Mono/.test(m.font)),
  }
})

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ root: resolve(ROOT), server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
try {
  for (const w of [1440, 390]) for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
    await ctx.addInitScript(([session, th]) => {
      localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
      localStorage.setItem('ohvara-theme', th)
    }, [SESSION, theme])
    const page = await ctx.newPage()
    const errors = []; const calls = []
    page.on('pageerror', e => errors.push(String(e)))
    await mock(page, calls)
    await page.goto(`${base}/${PATH.replace(/^\/+/, '')}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ov-bal-num, .pv-tier, .ov-mb-back, main h2', { timeout: 40000 })
    await page.waitForTimeout(1200)
    const m = await measure(page)
    const file = `billing-${w}-${theme}-${LABEL}.png`
    await page.screenshot({ path: join(OUT, file), fullPage: true })
    results.push({ file, ...m, pageErrors: errors, calls })
    await ctx.close()
  }
} finally {
  const mf = join(OUT, 'measurements.json')
  const prev = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')).filter(r => !results.some(n => n.file === r.file)) : []
  writeFileSync(mf, JSON.stringify([...prev, ...results], null, 2))
  await browser.close()
  await server.close()
}
for (const r of results) {
  console.log(`${r.file.padEnd(36)} url=${r.url} crumb=${r.crumb} parts=${r.planParts} scroll=${r.scrollWidth}/${r.clientWidth} money=${r.money.length} notMono=${JSON.stringify(r.moneyNotMono)} err=${r.pageErrors.length} calls=${JSON.stringify(r.calls)}`)
}
