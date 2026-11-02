// Screenshots /agent/leads and a lead page (/agent/inbounds/<id>) with every Supabase call mocked, for the
// duty switch, Follow up date, Not interested reason, and Sold then Submit for servicing. Migration 210 is not
// applied, so the mock plays the part of set_inbound_outcome and agent_inbounds: it stores nothing outside this
// process and no real project, account or key is touched.
//   node scripts/leads-outcome-shots.mjs [outDir]      (default qa/leads-outcomes)
// Exits 1 on a page error, a sideways scroll at 390, or a check that does not hold.
import process from 'node:process'
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/leads-outcomes'
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (/\.png$/.test(f)) rmSync(join(OUT, f))

const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const ahead = h => new Date(Date.now() + h * 3600e3).toISOString()
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago', is_active: true,
  billing_exempt: false, billing_status: 'active', billing_tier: 'standard', has_servicing: true,
  billing_current_period_end: new Date(Date.now() + 5 * 864e5).toISOString(),
}
const lead = (id, name, phone, state, product, stage, extra = {}) => ({
  lead_id: id, lead_type: product === 'live_call' ? 'policy_help' : 'mortgage_protection', inbound_product: product, inbound_stage: stage,
  outcome: null, outcome_at: null, live_call_result: null, contact_name: name, phone, city: 'Tampa', state, lead_source: 'meta',
  qualifier_answers: { homeowner: true, mortgage_balance_band: '$100k–$250k', age_band: '55–64', smoker: false, best_time: 'Afternoon' },
  transfer_status: null, transferred_at: null, va_outcome: null, booking_id: null, client_policy_id: null,
  delivered_at: ago(30), created_at: ago(30.1), follow_up_at: null, outcome_reason: null, follow_up_due: false, ...extra,
})
const ID = n => `a0000001-0000-4000-8000-00000000000${n}`
const freshLeads = () => [
  lead(ID(1), 'Denise Walker', '+18135550127', 'FL', 'booked_appointment', 'met'),
  lead(ID(2), 'Kevin Shaw', '+15550100124', 'GA', 'booked_appointment', 'booked'),
  lead(ID(3), 'Paul Greene', '+15550100125', 'CO', 'booked_appointment', 'follow_up',
    { outcome: 'follow_up', follow_up_at: ago(20), follow_up_due: true }),
  lead(ID(4), 'Janelle Price', '+15550100126', 'AL', 'booked_appointment', 'sold', { outcome: 'sold', outcome_at: ago(5) }),
  lead(ID(5), 'Ruth Sims', '+15550100127', 'MO', 'booked_appointment', 'lost', { outcome: 'not_interested', outcome_at: ago(6), outcome_reason: 'Already has coverage' }),
  lead(ID(6), 'Marla Hayes', '+15550100128', 'IL', 'live_call', 'follow_up',
    { live_call_result: 'transferred', outcome: 'follow_up', follow_up_at: ahead(70), follow_up_due: false }),
  lead(ID(7), 'Sam Tate', '+15550100129', 'KY', 'live_call', 'follow_up',
    { live_call_result: 'transferred', outcome: 'follow_up', follow_up_at: ago(2), follow_up_due: true }),
]

const ALLOWED = {
  tables: { carriers: [], policies: [], notifications: [], app_settings: [], agent_billing_tiers: [], inbound_events: [], lead_followup_sms_log: [], lead_sms_replies: [] },
  rpc: { my_standing_threads: [], agent_weekly_usage: [], my_money_banner: null, my_push_settings: { push_on: false } },
  functions: { 'fetch-secrets': { capabilities: {}, secrets: [] } },
}

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const MISSING = { code: 'PGRST202', message: 'Could not find the function public.set_inbound_outcome in the schema cache', details: null, hint: null }
const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.agent_duty' in the schema cache", details: null, hint: null }

// opts: { plan, outcomeMissing, dutyMissing, duty }
async function mock(page, st, opts) {
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    st.unexpected.push(`host ${u.host}`)
    return route.abort()
  })
  let duty = { on_duty: !!opts.duty, since: opts.duty ? ago(3) : null }
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, { ...PROFILE, has_servicing: opts.plan !== false })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/functions/v1/')) {
      const name = path.replace('/functions/v1/', '')
      return json(route, 200, name in ALLOWED.functions ? ALLOWED.functions[name] : {})
    }
    if (path === '/rest/v1/rpc/agent_inbounds') return json(route, 200, st.leads)
    if (path === '/rest/v1/rpc/set_inbound_outcome') {
      const a = JSON.parse(req.postData() || '{}')
      st.writes.push(a)
      if (opts.outcomeMissing && a.p_outcome !== 'sold') return json(route, 404, MISSING)
      const l = st.leads.find(x => x.lead_id === a.p_lead)
      const stage = { sold: 'sold', follow_up: 'follow_up', not_interested: 'lost' }[a.p_outcome]
      Object.assign(l, {
        outcome: a.p_outcome, outcome_at: new Date().toISOString(), inbound_stage: stage,
        follow_up_at: a.p_outcome === 'follow_up' ? a.p_follow_up_at : null, follow_up_due: false,
        outcome_reason: a.p_outcome === 'not_interested' ? a.p_reason : null,
      })
      return json(route, 200, stage)
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name in ALLOWED.rpc) return json(route, 200, ALLOWED.rpc[name])
      st.unexpected.push(`rpc ${name}`)
      return json(route, 200, [])
    }
    if (path === '/rest/v1/agent_duty') {
      if (opts.dutyMissing) return json(route, 404, MISSING_TABLE)
      if (method === 'GET') return rows(duty.on_duty || duty.since ? [duty] : [])
      const body = JSON.parse(req.postData() || '{}')
      duty = { on_duty: body.on_duty, since: body.on_duty ? new Date().toISOString() : null }
      st.writes.push({ agent_duty: body })
      return json(route, 201, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (method === 'GET' && table in ALLOWED.tables) return rows(ALLOWED.tables[table])
      st.unexpected.push(`${method} table ${table}`)
      return json(route, 200, single ? null : [])
    }
    return json(route, 200, {})
  })
}

const SIZES = { 1280: { width: 1280, height: 800 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []

// name, route, opts, steps(page, st) -> notes
async function run(name, route, opts, steps, sizes = [1280, 390], themes = ['light', 'dark']) {
  for (const w of sizes) {
    for (const theme of themes) {
      const ctx = await browser.newContext({
        viewport: SIZES[w], colorScheme: theme, timezoneId: 'America/Chicago', locale: 'en-US',
        ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null),
      })
      await ctx.addInitScript(([session, th]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(session)); localStorage.setItem('ohvara-theme', th) }, [SESSION, theme])
      const page = await ctx.newPage()
      const pageErrors = []
      page.on('pageerror', e => pageErrors.push(String(e)))
      const st = { leads: freshLeads(), writes: [], unexpected: [] }
      await mock(page, st, opts)
      const failures = []
      await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
      try {
        await steps(page, st)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(700)
      } catch (e) {
        failures.push(`step failed: ${String(e.message).split('\n')[0]}`)
      }
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        text: document.body.innerText,
      }))
      const file = `${name}-${w}-${theme}.png`
      await page.screenshot({ path: join(OUT, file), fullPage: true })
      if (pageErrors.length) failures.push(`pageErrors: ${pageErrors.join(' | ')}`)
      if (m.scrollWidth > m.clientWidth) failures.push(`sideways scroll ${m.scrollWidth}/${m.clientWidth}`)
      if (/is now your client|makes them your client|Becomes a client/.test(m.text)) failures.push('old client copy on the page')
      results.push({ file, writes: st.writes, unexpected: [...new Set(st.unexpected)], failures })
      await ctx.close()
    }
  }
}

const switchOf = page => page.getByRole('switch', { name: /Active for live call transfers/ })
const detail = (n) => `/agent/inbounds/${ID(n)}`

try {
  // /agent/leads
  await run('leads-populated', '/agent/leads', {}, async page => {
    await page.waitForSelector('a.inb-card', { timeout: 20000 })
    await switchOf(page).waitFor()
    await page.getByText('Not active.').waitFor()
  })
  await run('leads-duty-on', '/agent/leads', { duty: true }, async page => {
    await page.waitForSelector('a.inb-card', { timeout: 20000 })
    await page.getByText(/Active since/).waitFor()
  })
  await run('leads-live-tab', '/agent/leads?tab=live', {}, async page => {
    await page.waitForSelector('a.pv-log-row', { timeout: 20000 })
    await page.getByText('Follow up due').first().waitFor()
  }, [1280, 390], ['light'])
  await run('leads-duty-missing', '/agent/leads', { dutyMissing: true }, async page => {
    await page.waitForSelector('a.inb-card', { timeout: 20000 })
    await page.getByText(/Coming soon\./).waitFor()
  })
  await run('leads-duty-toggle', '/agent/leads', {}, async (page, st) => {
    await page.waitForSelector('a.inb-card', { timeout: 20000 })
    await page.getByText('Not active.').waitFor()
    await switchOf(page).click()
    await page.getByText(/Active since/).waitFor()
    if (!st.writes.some(w => w.agent_duty?.on_duty === true)) throw new Error('no agent_duty write')
  }, [1280], ['light'])

  // /agent/inbounds/<id>
  const card = page => page.getByRole('region', { name: 'Outcome' })
  await run('lead-follow-up-form', detail(1), {}, async page => {
    await card(page).getByRole('button', { name: 'Follow up' }).click()
    await card(page).getByLabel('Follow up on').waitFor()
  })
  await run('lead-follow-up-saved', detail(1), {}, async (page, st) => {
    await card(page).getByRole('button', { name: 'Follow up' }).click()
    const when = new Date(Date.now() + 3 * 864e5)
    const p = n => String(n).padStart(2, '0')
    await card(page).getByLabel('Follow up on').fill(`${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}T14:00`)
    await card(page).getByRole('button', { name: 'Save Follow up' }).click()
    await page.getByText(/^✓ Follow up \w{3} \d+ at 2:00 PM$/).waitFor({ timeout: 10000 })
    if (!st.writes[0]?.p_follow_up_at) throw new Error('p_follow_up_at not sent')
  })
  await run('lead-not-interested-required', detail(1), {}, async (page, st) => {
    await card(page).getByRole('button', { name: 'Not interested' }).click()
    await card(page).getByRole('button', { name: 'Save Not interested' }).click()
    await page.getByText('Say why they are not interested.').waitFor()
    if (st.writes.length) throw new Error('saved without a reason')
  }, [1280, 390], ['light'])
  await run('lead-not-interested-saved', detail(1), {}, async (page, st) => {
    await card(page).getByRole('button', { name: 'Not interested' }).click()
    await card(page).getByLabel('Why are they not interested?').fill('Already covered through work')
    await card(page).getByRole('button', { name: 'Save Not interested' }).click()
    await page.getByText('✓ Not interested: Already covered through work').waitFor({ timeout: 10000 })
    if (st.writes[0]?.p_reason !== 'Already covered through work') throw new Error('p_reason not sent')
  })
  await run('lead-sold-submit', detail(1), {}, async (page, st) => {
    await card(page).getByRole('button', { name: 'Sold' }).click()
    const link = card(page).getByRole('link', { name: 'Submit for servicing' })
    await link.waitFor({ timeout: 10000 })
    const href = await link.getAttribute('href')
    if (href !== `/agent/submit?kind=deal&lead=${ID(1)}`) throw new Error(`bad href ${href}`)
    await page.getByText('Counts toward this week.').waitFor()
  })
  await run('lead-sold-no-plan', detail(1), { plan: false }, async page => {
    await card(page).getByRole('button', { name: 'Sold' }).click()
    await page.getByText(/^✓ Marked Sold/).waitFor({ timeout: 10000 })
    await page.waitForTimeout(300)
    if (await card(page).getByRole('link', { name: 'Submit for servicing' }).count()) throw new Error('button shown without a plan')
  })
  await run('lead-outcome-missing', detail(1), { outcomeMissing: true }, async page => {
    await card(page).getByRole('button', { name: 'Follow up' }).click()
    const when = new Date(Date.now() + 3 * 864e5)
    const p = n => String(n).padStart(2, '0')
    await card(page).getByLabel('Follow up on').fill(`${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}T14:00`)
    await card(page).getByRole('button', { name: 'Save Follow up' }).click()
    await page.getByText(/isn.t ready yet/).waitFor({ timeout: 10000 })
  })
  await run('lead-follow-up-due', detail(3), {}, async page => {
    await page.getByText('Follow up due').first().waitFor({ timeout: 20000 })
  })
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  await browser.close()
  await server.close()
}

for (const r of results) console.log(`${r.file.padEnd(46)} ${r.failures.length ? `FAIL: ${r.failures.join(' / ')}` : 'ok'}${r.unexpected.length ? `  (unexpected: ${r.unexpected.join(', ')})` : ''}`)
const failed = results.filter(r => r.failures.length)
console.log(`${results.length} shots, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
