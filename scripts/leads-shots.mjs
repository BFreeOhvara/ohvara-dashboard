// Screenshots /agent/leads (populated, empty with delivery on, empty with delivery
// off) with every Supabase call mocked, so no real project, account or credentials
// are touched and nothing is written anywhere.
//   node scripts/leads-shots.mjs [outDir]      (npm run shots:leads)
// Writes 12 PNGs plus measurements.json into outDir (default qa/agent-leads).
// Exits 1 if any shot has an error card, page error, query mismatch, unexpected
// request, missing settings card, wrong card count or (at 390) sideways scroll.
import process from 'node:process'
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/agent-leads'
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (/^leads-.*\.png$/.test(f)) rmSync(join(OUT, f))

// ── What the app chrome genuinely asks for besides the Leads queries ─────────
// Found by running the script once with these lists empty and reading `unexpected`.
// Each is answered with an empty body. A table or rpc not listed here (and not
// leads, agent_lead_settings or get_my_profile) fails the run, and so does any
// write to one of them.
// Value = the body the mock answers with (null = no row / empty).
const ALLOWED = {
  tables: {
    carriers: [], // the app shell reads the carrier list
    policies: [], // app chrome reads the agent's policies
    notifications: [], // bell in the header
    app_settings: [], // app-wide switches (empty = defaults)
    agent_billing_tiers: [], // billing gate reads the tier list
  },
  rpc: {
    my_standing_threads: [], // Messages badge in the nav
    agent_weekly_usage: [], // billing usage for the gate
    my_money_banner: null, // red money banner (null = none)
    my_push_settings: { push_on: false }, // push switch state
  },
  functions: {
    'fetch-secrets': { capabilities: {}, secrets: [] }, // SecretsContext (GET); empty = env defaults
  },
}
// Hosts other than localhost and the fake Supabase host the page may reach
// (fonts and assets the app already needs). Anything else is aborted and fails the run.
const ALLOWED_HOSTS = {}

// ── Seed data ────────────────────────────────────────────────────────────────
const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString()
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard',
  billing_current_period_end: new Date(Date.now() + 5 * 864e5).toISOString(),
}
// Raw DB shape (what PostgREST returns for the exact select the page sends).
const row = (id, contact_name, phone, state, hoursAgo, agent_status, qualifier_answers) => ({
  id, created_at: ago(hoursAgo + 0.05), contact_name, phone, state, qualifier_answers, agent_status, delivered_at: ago(hoursAgo),
})
const LEADS = [
  row('a0000001-0000-4000-8000-000000000001', 'Jordan Placeholder', '+15550100123', 'TX', 0.2, null,
    { homeowner: true, mortgage_balance_band: '$100k–$250k', age_band: '45–54', smoker: false, best_time: 'Morning' }),
  row('a0000001-0000-4000-8000-000000000002', 'Maximiliana-Alexandrina Featherstonehaugh-Worthington', '+15550100124', 'FL', 24, 'contacted',
    { homeowner: true, mortgage_balance_band: '$250k–$500k', age_band: '55–64', smoker: true, best_time: 'Evening' }),
  row('a0000001-0000-4000-8000-000000000003', 'Sam Example', '+15550100125', 'OH', 72, 'closed',
    { homeowner: true, mortgage_balance_band: 'Under $100k', age_band: '35–44', smoker: false, best_time: 'Anytime' }),
  row('a0000001-0000-4000-8000-000000000004', 'Riley Sample', '+15550100126', 'TX', 120, 'bad', { homeowner: false, age_band: '25–34' }),
  row('a0000001-0000-4000-8000-000000000005', 'Casey Fixture', null, 'PA', 200, 'assigned',
    { homeowner: true, mortgage_balance_band: '$100k–$250k', age_band: '45–54', smoker: false, best_time: 'Afternoon' }),
]
const SETTINGS_ON = { active: true, states: ['FL', 'OH', 'TX'], daily_cap: 5 }

const SCENARIOS = {
  populated: { leads: LEADS, settings: SETTINGS_ON, expectCards: 5, heading: null },
  'empty-on': { leads: [], settings: SETTINGS_ON, expectCards: 0, heading: 'No leads yet' },
  'empty-off': { leads: [], settings: null, expectCards: 0, heading: 'Delivery is off' },
}

// What the page must send, to the letter. Anything else is a mismatch + a 400.
const LEADS_QUERY = {
  select: 'id,created_at,contact_name,phone,state,qualifier_answers,agent_status,delivered_at',
  lead_type: 'eq.mortgage_protection',
  assigned_rep_id: `eq.${AGENT}`,
  order: 'delivered_at.desc.nullslast',
  limit: '200',
}
const SETTINGS_QUERY = { select: 'active,states,daily_cap', agent_id: `eq.${AGENT}` }

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

// Compare the request's query string to the expected one; returns a mismatch note or null.
function checkQuery(url, expected, label) {
  const got = Object.fromEntries(url.searchParams.entries())
  const bad = []
  for (const [k, v] of Object.entries(expected)) if (got[k] !== v) bad.push(`${k}: expected ${v}, saw ${got[k] ?? '(missing)'}`)
  return bad.length ? `${label}: ${bad.join('; ')}` : null
}

// state: { requests, answered, mismatches, unexpected, leadsGets, settingsGets }
async function mock(page, sc, state) {
  // Registered first = lowest priority: catches every host except the fake Supabase one (handled below).
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    if (ALLOWED_HOSTS[u.host]) return route.continue()
    state.unexpected.push(`host ${u.host} (${route.request().method()} ${u.pathname})`)
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = (all) => json(route, 200, single ? all[0] ?? null : all)

    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path.startsWith('/auth/v1/')) {
      const name = path.replace('/auth/v1/', '')
      state.unexpected.push(`${method} auth ${name}`)
      return json(route, 200, {})
    }
    if (path.startsWith('/functions/v1/')) {
      const name = path.replace('/functions/v1/', '')
      if (method === 'GET' && name in ALLOWED.functions) return json(route, 200, ALLOWED.functions[name])
      state.unexpected.push(`${method} function ${name}`)
      return json(route, 200, {})
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (method === 'POST' && name in ALLOWED.rpc) return json(route, 200, ALLOWED.rpc[name])
      state.unexpected.push(`${method} rpc ${name}`)
      return json(route, 200, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (table === 'leads' || table === 'agent_lead_settings') {
        state.requests.push(`${method} ${table}`)
        if (method !== 'GET') { // nothing is stored; the write is only recorded
          state.answered.push({ method, table, status: 200 })
          return json(route, 200, [])
        }
        const isLeads = table === 'leads'
        const bad = isLeads ? checkQuery(url, LEADS_QUERY, 'leads') : checkQuery(url, SETTINGS_QUERY, 'agent_lead_settings')
        if (bad) {
          state.mismatches.push(bad)
          return json(route, 400, { code: 'MOCK', message: `query mismatch: ${bad}`, details: null, hint: null })
        }
        if (isLeads) { state.leadsGets++; return json(route, 200, sc.leads) }
        state.settingsGets++
        return rows(sc.settings ? [sc.settings] : [])
      }
      if (method === 'GET' && table in ALLOWED.tables) return rows(ALLOWED.tables[table])
      state.unexpected.push(`${method} table ${table}`)
      return json(route, 200, single ? null : [])
    }
    state.unexpected.push(`${method} ${path}`)
    return json(route, 200, {})
  })
}

const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }

const measure = (page) => page.evaluate(() => {
  const de = document.documentElement
  const errs = [...document.querySelectorAll('section.ov-card[role="alert"]')]
  const headings = [...document.querySelectorAll('h3')].map(h => h.textContent.trim())
  return {
    leadCards: document.querySelectorAll('article.ov-card').length,
    settingsCardPresent: !!document.querySelector('section[aria-label="Lead settings"]'),
    errorCards: errs.length,
    errorTitles: errs.map(e => e.querySelector('h3')?.textContent.trim() ?? ''),
    emptyHeading: ['No leads yet', 'Delivery is off'].find(t => headings.includes(t)) ?? null,
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
    maxRight: Math.round(Math.max(...[...document.body.querySelectorAll('*')].map(e => e.getBoundingClientRect().right)) * 100) / 100,
  }
})

// Set before Vite reads its env: the app talks to a fake host, never the real project,
// and the Leads page flag is on for this process only (never in a .env file or Vercel).
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
process.env.VITE_LEADS_PAGE = '1'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []

async function shot(scName, theme, w, withClicks = false) {
  const sc = SCENARIOS[scName]
  const ctx = await browser.newContext({
    viewport: SIZES[w], colorScheme: theme, timezoneId: 'America/Chicago', locale: 'en-US',
    ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null),
  })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(String(e)))
  const state = { requests: [], answered: [], mismatches: [], unexpected: [], leadsGets: 0, settingsGets: 0 }
  await mock(page, sc, state)
  const failures = []
  await page.goto(`${base}/agent/leads`, { waitUntil: 'domcontentloaded' })
  try {
    // Real content, not a sleep: lead cards or the empty heading, then the loaded settings card.
    if (sc.expectCards > 0) await page.waitForSelector('article.ov-card', { timeout: 20000 })
    else await page.getByRole('heading', { name: sc.heading, exact: true }).waitFor({ timeout: 20000 })
    await page.waitForSelector('section[aria-label="Lead settings"]', { timeout: 20000 })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(700) // card fade-in
  } catch (e) {
    failures.push(`content did not appear: ${String(e.message).split('\n')[0]}`)
  }
  const m = await measure(page)
  const file = `leads-${scName}-${w}-${theme}.png`
  await page.screenshot({ path: join(OUT, file), fullPage: true })

  let clickCheck
  if (withClicks) {
    // Proves clicking can't leak: the mock answers the writes and nothing is stored.
    // No further shots are taken from this context.
    const card = page.locator('article.ov-card').first()
    await card.getByRole('button', { name: 'Contacted', exact: true }).click()
    await page.getByRole('button', { name: 'Save settings', exact: true }).click()
    await page.getByText('✓ Saved at').waitFor({ timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(300)
    const w2 = state.answered
    clickCheck = {
      leadsPatchAnswered: w2.some(a => a.method === 'PATCH' && a.table === 'leads' && a.status === 200),
      settingsWriteAnswered: w2.some(a => ['PATCH', 'POST'].includes(a.method) && a.table === 'agent_lead_settings' && a.status === 200),
      writes: w2.map(a => `${a.method} ${a.table}`),
    }
    if (!clickCheck.leadsPatchAnswered) failures.push('click check: no PATCH leads answered')
    if (!clickCheck.settingsWriteAnswered) failures.push('click check: no PATCH/POST agent_lead_settings answered')
    if (state.answered.length !== 2) failures.push(`click check: expected exactly 2 writes, saw ${state.answered.length}`)
  } else if (state.answered.length) {
    failures.push(`unexpected writes: ${state.answered.map(a => `${a.method} ${a.table}`).join(', ')}`)
  }

  if (m.errorCards > 0) failures.push(`errorCards=${m.errorCards} (${m.errorTitles.join(' | ')})`)
  if (pageErrors.length) failures.push(`pageErrors=${pageErrors.length}`)
  if (state.mismatches.length) failures.push(`mismatches=${state.mismatches.length}`)
  if (state.unexpected.length) failures.push(`unexpected=${[...new Set(state.unexpected)].join(', ')}`)
  if (!m.settingsCardPresent) failures.push('settings card missing')
  if (m.leadCards !== sc.expectCards) failures.push(`leadCards=${m.leadCards}, expected ${sc.expectCards}`)
  if (sc.heading && m.emptyHeading !== sc.heading) failures.push(`empty heading: expected "${sc.heading}", saw ${m.emptyHeading}`)
  if (state.leadsGets < 1) failures.push('no valid leads query seen')
  if (state.settingsGets < 1) failures.push('no valid settings query seen')
  if (w === 390 && m.scrollWidth !== m.clientWidth) failures.push(`sideways scroll ${m.scrollWidth}/${m.clientWidth}`)

  results.push({
    file, scenario: scName, width: w, theme,
    requests: [...new Set(state.requests)], mismatches: state.mismatches, unexpected: [...new Set(state.unexpected)],
    leadsQueriesChecked: state.leadsGets, settingsQueriesChecked: state.settingsGets,
    ...m, pageErrors, ...(clickCheck ? { clickCheck } : null), failures,
  })
  await ctx.close()
}

try {
  for (const sc of Object.keys(SCENARIOS)) {
    for (const w of [1440, 390]) {
      for (const theme of ['light', 'dark']) await shot(sc, theme, w, sc === 'populated' && w === 1440 && theme === 'light')
    }
  }
} finally {
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(results, null, 2) + '\n')
  await browser.close()
  await server.close()
}

for (const r of results) {
  console.log(`${r.file.padEnd(34)} cards=${r.leadCards} settings=${r.settingsCardPresent} err=${r.errorCards} scroll=${r.scrollWidth}/${r.clientWidth} ${r.failures.length ? `FAIL: ${r.failures.join(' / ')}` : 'ok'}`)
}
const failed = results.filter(r => r.failures.length)
console.log(`${results.length} shots, ${failed.length} failed`)
process.exit(failed.length || results.length !== 12 ? 1 : 0)
