// Wording sweep check: agents see "lead" and "leads", never "inbound". Loads the agent's Overview, Leads, a lead's
// page, Calendar, Clients, Activity, More, Billing and Settings at 1440 and 390 (light theme), every Supabase call
// mocked, on a fixed clock (Fri Oct 30, 12:10 PM Central). Asserts the visible text and every aria-label / title /
// placeholder / alt contains no /inbound/i, and that nothing scrolls sideways at 390.
//   node scripts/wording-shots.mjs after  [outDir]     (default qa/wording-sweep; exits 1 on a failed check)
//   node scripts/wording-shots.mjs before [outDir]     (run on the pre-change source; records hits, never fails)
// Writes <page>-<before|after>-<1440|390>-light.png and checks-<mode>.json into outDir.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { buildSample } from '../src/lib/inboundsSample.js'

const MODE = process.argv[2] === 'before' ? 'before' : 'after'
const OUT = process.argv[3] || 'qa/wording-sweep'
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

async function mock(page, { emptyLeads }) {
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

// name, path, options. `ready` is a selector that proves the page's own content arrived.
const PAGES = [
  { name: 'overview', path: '/agent', ready: w => (w === 390 ? '.ph-stack' : '.ov-hero') },
  { name: 'leads', path: '/agent/leads', ready: () => '.pv-icard' },
  { name: 'lead', path: `/agent/inbounds/${OPEN_LEAD.lead_id}`, ready: () => '.pv-d-card' },
  { name: 'calendar', path: '/agent/calendar?sample=1', ready: () => '.cal-page' },
  { name: 'clients', path: '/agent/clients?stage=cancelled', ready: () => '.cv2-chip' },
  { name: 'activity', path: '/agent/activity', ready: () => 'main' },
  { name: 'more', path: '/agent/more', ready: () => 'main' },
  { name: 'billing', path: '/agent/billing', ready: () => '.ov-bal-num' },
  { name: 'settings', path: '/settings', ready: () => 'main' },
  { name: 'leads-empty', path: '/agent/leads', ready: () => '.inb-start', emptyLeads: true }, // the "You're not getting leads yet" banner
]
const SIZES = [[1440, 900, false], [390, 844, true]]

// Everything an agent can read or hear: visible text plus every attribute a screen reader or tooltip uses.
const collect = page => page.evaluate(() => {
  const attrs = []
  for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[alt],[aria-description],[aria-roledescription]')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-roledescription']) {
      const v = el.getAttribute(a)
      if (v) attrs.push(`${a}="${v}"`)
    }
  }
  return { text: document.body.innerText, attrs }
})
const hitsIn = ({ text, attrs }) => [
  ...text.split('\n').filter(l => /inbound/i.test(l)).map(l => `text: ${l.trim()}`),
  ...attrs.filter(a => /inbound/i.test(a)).map(a => `attr: ${a}`),
]

const results = []
try {
  for (const [w, h, phone] of SIZES) {
    for (const pg of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
      await ctx.addInitScript(s => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', 'light') }, session)
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(String(e)))
      await page.clock.setFixedTime(BASE)
      await mock(page, pg)
      await page.goto(`${base}${pg.path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector(pg.ready(w), { timeout: 60000 })
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.tc-skel'), null, { timeout: 30000 }).catch(() => {})
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(1200)

      const found = hitsIn(await collect(page))
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      await page.screenshot({ path: join(OUT, `${pg.name}-${MODE}-${w}-light.png`), fullPage: true })
      results.push({ page: pg.name, width: w, inboundHits: found, sideways, pageErrors: errors })

      // Header search (agent branch): placeholder, group heading and empty message
      if (pg.name === 'overview' && !phone) {
        const box = page.locator('input[placeholder^="Search clients"]').first()
        await box.fill('Nadia')
        await page.waitForTimeout(500)
        const s = hitsIn(await collect(page))
        const heads = await page.$$eval('.ov-gs-head', els => els.map(e => e.textContent.trim()))
        await page.screenshot({ path: join(OUT, `search-${MODE}-${w}-light.png`) })
        results.push({ page: 'search (typed "Nadia")', width: w, inboundHits: s, sideways: 0, pageErrors: errors, groups: heads })
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

const bad = results.filter(r => r.inboundHits.length || r.sideways > 0 || r.pageErrors.length)
writeFileSync(join(OUT, `checks-${MODE}.json`), JSON.stringify(results, null, 2))
for (const r of results) console.log(`${r.inboundHits.length || r.sideways > 0 || r.pageErrors.length ? 'FAIL' : 'ok  '} ${r.page} @${r.width}: ${r.inboundHits.length} inbound hit(s), sideways ${r.sideways}px${r.groups ? `, groups ${JSON.stringify(r.groups)}` : ''}`)
if (MODE === 'after' && bad.length) process.exit(1)
