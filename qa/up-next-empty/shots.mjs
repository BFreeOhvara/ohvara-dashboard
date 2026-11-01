// Up next empty-state shots: the Overview with no booked calls, 1920/1440/390, light and dark.
//   node qa/up-next-empty/shots.mjs
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { buildSample } from '../../src/lib/inboundsSample.js'

const OUT = 'qa/up-next-empty'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const BASE = Date.UTC(2026, 9, 30, 17, 10)
const iso = ms => new Date(ms).toISOString()
const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard',
  billing_current_period_end: iso(BASE + 5 * 864e5),
}
const { leads: LEADS, events: EVENTS } = buildSample(BASE)
const SOLD = LEADS.find(l => l.outcome === 'sold')
const OPEN_LEAD = LEADS.find(l => l.inbound_stage === 'booked')
const FEED = [
  { id: 'lead_inbound:1', kind: 'inbound', at: iso(BASE - 36e5), lead_id: OPEN_LEAD.lead_id, agent_id: AGENT, title: `New lead: ${OPEN_LEAD.contact_name}`, meta: {} },
  { id: 'lead_inbound:2', kind: 'inbound', at: iso(BASE - 72e5), lead_id: SOLD.lead_id, agent_id: AGENT, title: `New lead: ${SOLD.contact_name}`, meta: {} },
]
const PRICES = [{ lead_type: 'mortgage_protection', price_cents: 3000 }, { lead_type: 'policy_help', price_cents: 5500 }]
const OPTIONS = [{ amount_cents: 10000 }, { amount_cents: 25000 }, { amount_cents: 50000 }]
const ledgerAt = h => iso(BASE - h * 36e5)
const LEDGER = [
  { id: 'l1', kind: 'lead_charge', amount_cents: -3000, balance_after_cents: 4000, lead_type: 'mortgage_protection', created_at: ledgerAt(0.5) },
  { id: 'l2', kind: 'lead_charge', amount_cents: -5500, balance_after_cents: 7000, lead_type: 'policy_help', created_at: ledgerAt(2) },
  { id: 'l3', kind: 'topup', amount_cents: 10000, balance_after_cents: 12500, lead_type: null, created_at: ledgerAt(5) },
]
const TIERS = [
  { key: 'standard', name: 'Standard', weekly_cents: 35000, weekly_cap: 7, sort_order: 1, is_active: true },
  { key: 'premium', name: 'Premium', weekly_cents: 50000, weekly_cap: 14, sort_order: 2, is_active: true },
]
const USAGE = { used: 3, weekly_cap: 7, enforced: true, tier_name: 'Standard', week_start: iso(BASE - 48 * 36e5), week_end: iso(BASE + 5 * 864e5) }

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const session = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: iso(BASE - 1e11) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

const RPC = {
  get_my_profile: PROFILE,
  my_push_settings: { push_on: false },
  agent_inbounds: LEADS,
  agent_weekly_usage: [USAGE],
  my_money_banner: null,
  agent_activity_feed: FEED,
}
const TABLES = {
  inbound_events: [...EVENTS.values()].flat(),
  agent_lead_balance: [{ balance_cents: 4000 }],
  lead_prices: PRICES,
  prepaid_topup_options: OPTIONS,
  agent_lead_ledger: LEDGER,
  agent_billing_tiers: TIERS,
  app_settings: [{ id: 1, agent_billing_enforced: false }],
}

async function mock(page) {
  const emptyLeads = true
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (emptyLeads && name === 'agent_inbounds') return json(route, 200, [])
      return json(route, 200, name in RPC ? RPC[name] : [])
    }
    const table = path.replace('/rest/v1/', '')
    const rows = emptyLeads && table === 'inbound_events' ? [] : TABLES[table] || []
    return json(route, 200, single ? rows[0] ?? null : rows)
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })


const SIZES = [[1920, 1080, false], [1440, 900, false], [1440, 640, false], [390, 844, true]]
const lines = []
try {
  for (const theme of ['light', 'dark']) {
    for (const [w, h, phone] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
      await ctx.addInitScript(([s, t]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', t) }, [session, theme])
      const page = await ctx.newPage()
      await page.clock.setFixedTime(BASE)
      await mock(page)
      await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector(w === 390 ? '.ph-stack' : '.ov-hero', { timeout: 60000 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(1500)
      const card = page.locator('[data-ov="attn"]', { hasText: 'No calls booked' }).last()
      const found = await card.count()
      if (found) await card.scrollIntoViewIfNeeded()
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      const text = found ? (await card.innerText()).replace(/\n+/g, ' | ') : 'CARD NOT FOUND'
      await page.screenshot({ path: join(OUT, `overview-${w}x${h}-${theme}.png`), fullPage: true })
      if (found) await card.screenshot({ path: join(OUT, `upnext-${w}x${h}-${theme}.png`) })
      lines.push(`${w}x${h} ${theme}: sideways ${sideways}px; card: ${text}`)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(lines.join('\n'))
