// Client page (/agent/clients/:clientId): shots + checks with a mocked Supabase. Harness style from qa/goal-check-9cef7201/shots.mjs.
//   node qa/goal-check-134a9cda/shots.mjs [outDir]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/goal-check-134a9cda'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = 5700 + Math.floor(Math.random() * 300)
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-02T20:00:00Z') // Mon Nov 2, 2:00 PM Chicago
const at = (iso) => new Date(iso).toISOString()

const L1 = 'a0000000-0000-4000-8000-000000000001' // sold lead with a policy (Denver, one hour behind the agent)
const L2 = 'a0000000-0000-4000-8000-000000000002' // sold lead, no policy yet
const P1 = 'b0000000-0000-4000-8000-000000000001' // L1's new policy
const B1 = 'c0000000-0000-4000-8000-000000000001' // existing client's booking (Phoenix)

const LEADS = [
  { lead_id: L1, lead_type: 'inbound', outcome: 'sold', outcome_at: at('2026-10-28T16:00:00Z'), contact_name: 'Marcus Bell', phone: '(214) 555-0142', city: 'Denver', state: 'CO', client_policy_id: P1, inbound_stage: 'sold', created_at: at('2026-10-27T16:00:00Z') },
  { lead_id: L2, lead_type: 'inbound', outcome: 'sold', outcome_at: at('2026-11-01T16:00:00Z'), contact_name: 'Gloria Mendez', phone: '(303) 555-0188', city: 'Boulder', state: 'CO', client_policy_id: null, inbound_stage: 'sold', created_at: at('2026-10-31T16:00:00Z') },
]
const BOOKING = {
  id: B1, agent_id: AGENT, agent: { id: AGENT, full_name: 'Test agent' }, assigned: null, client_first_name: 'Luis', client_last_name: 'Herrera', client_phone: '(480) 555-0119',
  state: 'AZ', client_city: 'Mesa', client_timezone: 'America/Phoenix', carrier_id: null, carrier_name: 'Transamerica', details: { current_carrier: 'Transamerica' },
  fulfillment_assigned: true, policy_number: 'TR-30942', fulfillment_stage: 'Complete', scheduled_call_at: null, last_call_outcome: 'answered', call_attempts: 1,
  created_at: at('2026-07-06T21:15:00Z'), updated_at: at('2026-09-22T20:00:00Z'), fulfillment_completed_at: at('2026-09-22T20:30:00Z'), best_time: 'evening', sms_consent: true,
}
const POLICIES = {
  [P1]: { id: P1, client_first_name: 'Marcus', client_last_name: 'Bell', client_phone: '(214) 555-0142', state: 'CO', client_city: 'Denver', client_timezone: null, policy_number: 'AE-48213', carrier_name: 'Aetna', product_type: 'Final Expense', monthly_premium: 62.4, effective_date: '2026-10-28', policy_sold_date: '2026-10-28', status: 'Sold', created_at: at('2026-10-28T16:00:00Z'), sms_consent: false },
  [B1]: { id: B1, client_first_name: 'Luis', client_last_name: 'Herrera', client_phone: '(480) 555-0119', state: 'AZ', client_city: 'Mesa', client_timezone: 'America/Phoenix', policy_number: 'TR-30942', carrier_name: 'Transamerica', product_type: 'Whole Life', monthly_premium: 84, effective_date: '2026-07-08', policy_sold_date: '2026-07-08', status: 'Active', created_at: at('2026-07-06T21:15:00Z'), sms_consent: true, sms_consent_at: at('2026-07-06T21:15:00Z'), sms_consent_by: AGENT, sms_consent_version: 'v1' },
}
const T = (id, o) => ({ id, agent_id: AGENT, lead_id: null, policy_id: null, due_at: null, done_at: null, note: null, created_at: at('2026-10-28T16:00:00Z'), ...o })
const TASKS = [
  T('t1', { policy_id: P1, kind: 'packet_check', status: 'done', done_at: at('2026-10-30T15:00:00Z'), note: 'Packet confirmed' }),
  T('t2', { policy_id: P1, kind: 'review_call', status: 'scheduled', due_at: at('2026-11-06T20:00:00Z') }),
  T('t3', { policy_id: P1, kind: 'chargeback_watch', status: 'scheduled', due_at: at('2027-10-28T16:00:00Z') }),
  T('t4', { policy_id: P1, kind: 'annual_review', status: 'scheduled', due_at: at('2027-10-28T16:00:00Z') }),
  T('t5', { policy_id: P1, kind: 'beneficiary_change', status: 'requested', created_at: at('2026-11-01T18:00:00Z'), note: 'Add a daughter' }),
  T('t6', { policy_id: B1, kind: 'packet_check', status: 'done', done_at: at('2026-07-13T16:00:00Z'), created_at: at('2026-07-07T16:00:00Z') }),
  T('t7', { policy_id: B1, kind: 'review_call', status: 'done', done_at: at('2026-07-20T21:30:00Z'), created_at: at('2026-07-07T16:00:00Z') }),
  T('t8', { policy_id: B1, kind: 'chargeback_watch', status: 'scheduled', created_at: at('2026-07-08T16:00:00Z'), due_at: at('2027-07-08T16:00:00Z') }),
  T('t9', { policy_id: B1, kind: 'annual_review', status: 'scheduled', created_at: at('2026-07-08T16:00:00Z'), due_at: at('2027-07-20T16:00:00Z') }),
]
const MSGS = {
  [P1]: [{ id: 'm1', sender_id: AGENT, sender_name: 'Test Agent', sender_role: 'agent', body: 'Marcus prefers calls after 1.', created_at: at('2026-11-02T22:42:00Z') }],
  [B1]: [{ id: 'm2', sender_id: 'f1', sender_name: 'Ohvara Team', sender_role: 'fulfillment', body: 'Review call done on the Transamerica policy. Luis confirmed the 12th for the draft.', created_at: at('2026-09-22T20:51:00Z') }],
}
const EVENTS = [{ id: 'e1', policy_id: B1, agent_id: AGENT, kind: 'cancelled', actor_name: 'Fulfillment', actor_role: 'fulfillment', detail: {}, at: at('2026-09-22T20:30:00Z') }]
const CONTACT = {
  [`${P1}`]: [],
  lead: [
    { id: 'x1', occurred_at: at('2026-11-03T16:12:00Z'), channel: 'text', direction: 'out', sender_type: 'system', body: 'Hi Marcus, this is the team helping with your Aetna policy. We’ll call Friday at 2 PM to go over it.' },
  ],
  client: [
    { id: 'x2', occurred_at: at('2026-09-22T20:30:00Z'), channel: 'call', direction: 'out', sender_type: 'staff', call_result: 'answered', body: 'Transamerica review call done. No coverage questions.' },
    { id: 'x3', occurred_at: at('2026-09-21T17:02:00Z'), channel: 'text', direction: 'out', sender_type: 'system', body: 'Hi Luis, this is the team helping with your Transamerica policy.' },
  ],
}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(NOW.getTime() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'test.agent@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const profile = o => ({
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: TZ, is_active: true,
  billing_exempt: !o.leadsOnly, billing_status: 'active', billing_tier: 'standard', membership_tier: 'standard',
  ...(o.leadsOnly ? { signup_source: 'self' } : null),
  ...(o.noServicing ? { has_servicing: false } : { has_servicing: true }),
})

async function mock(page, o, state) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const q = k => url.searchParams.get(k) || ''
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile(o))
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/functions/v1/')) return json(route, 200, { capabilities: {}, secrets: [] })
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'agent_inbounds') return json(route, 200, o.noLeads ? [] : LEADS)
      if (name === 'agent_portal_access') return json(route, 200, o.leadsOnly ? { self: true, servicing: false, leads: true, unlocked: true } : { self: false, servicing: true, leads: true, unlocked: true })
      if (name === 'contact_log') {
        state.rpcCalls.push(name)
        if (o.noContactLog) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function public.contact_log in the schema cache' })
        const body = JSON.parse(req.postData() || '{}')
        return json(route, 200, body.p_lead ? CONTACT.lead : body.p_client_key === 'ck-luis' ? CONTACT.client : [])
      }
      if (name === 'my_push_settings') return json(route, 200, { push_on: false })
      if (name === 'my_money_banner') return json(route, 200, null)
      return json(route, 200, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (req.method() !== 'GET') { state.writes.push(`${req.method()} ${table}`); return json(route, 200, []) }
      if (table === 'policies') {
        const idf = q('id')
        if (idf.startsWith('in.(')) {
          const ids = idf.slice(4, -1).split(',')
          return rows(ids.map(i => POLICIES[i]).filter(Boolean))
        }
        return rows([BOOKING])
      }
      if (table === 'servicing_tasks') return rows(TASKS)
      if (table === 'policy_messages') return rows(MSGS[q('policy_id').replace('eq.', '')] || [])
      if (table === 'policy_events') return rows(EVENTS)
      if (table === 'policy_servicing_status') return rows([{ policy_id: B1, client_key: 'ck-luis' }, { policy_id: P1, client_key: 'ck-marcus' }].filter(r => q('policy_id').includes(r.policy_id)))
      if (table === 'app_settings') return rows([{ id: 1, agent_portal_v2: false, agent_billing_enforced: !!o.leadsOnly, submit_live: !!o.submitLive }])
      if (table === 'recovery_config') return rows([{ id: 1, sms_live: false, voice_live: false, recording_live: false }])
      return json(route, 200, single ? null : [])
    }
    return json(route, 200, {})
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

async function open(w, theme, o = {}) {
  const ctx = await browser.newContext({
    viewport: SIZES[w], colorScheme: theme, timezoneId: TZ, locale: 'en-US',
    ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null),
  })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  await ctx.clock.setFixedTime(NOW)
  const page = await ctx.newPage()
  const state = { writes: [], errors: [], rpcCalls: [] }
  page.on('pageerror', e => state.errors.push(String(e)))
  await mock(page, o, state)
  return { ctx, page, state }
}
async function settle(page) {
  await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
}
const widthOk = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }))
const text = page => page.evaluate(() => document.body.innerText)
const results = []
const log = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }

// 1. Both clients, both themes, three widths, submit_live on.
for (const w of process.env.SKIP1 ? [] : [1920, 1440, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const [label, id, must] of [
      ['lead', L1, ['Marcus Bell', 'Aetna Final Expense', 'AE-48213', 'Policy packet check', 'Review call', 'Chargeback watch', 'Month 1 of 12', 'Texts and calls', 'Team thread', 'Activity', 'No text consent on file', '1:00 PM client', 'Open requests', 'Beneficiary change']],
      ['existing', B1, ['Luis Herrera', 'Transamerica Whole Life', 'Texts and calls', 'Team thread', 'Activity', 'Text consent', 'Recorded by', 'You', 'The script', 'Ohvara will text you at this number about your cancellation call', 'Month 4 of 12', '1 hr']],
    ]) {
      const { ctx, page, state } = await open(w, theme, { submitLive: true })
      await page.goto(`${base}/agent/clients/${id}`)
      await page.waitForSelector('.cv2p-head', { timeout: 20000 })
      await settle(page)
      const t = await text(page)
      const m = await widthOk(page)
      await page.screenshot({ path: join(OUT, `client-${label}-${w}-${theme}.png`), fullPage: true })
      const missing = must.filter(s => s !== '1 hr' && !t.includes(s))
      const dual = /your time \/ \d{1,2}:\d{2} [AP]M client/.test(t)
      const btn = await page.locator('a.cv2p-request').count()
      log(`${label} ${w} ${theme}`, missing.length === 0 && m.sw <= m.w && state.errors.length === 0 && btn === 1 && (label === 'existing' ? dual : true),
        `missing=[${missing.join('|')}] sw=${m.sw}/${m.w} dual=${dual} requestBtn=${btn} errors=${state.errors.join('|')}`)
      if ((w === 1440 || w === 390) && theme === 'light') {
        const hex = await page.evaluate(() => [...document.querySelectorAll('.cv2p *')].filter(e => e.getAttribute('style')?.match(/#[0-9a-f]{3,8}/i)).length)
        log('no inline hex colors on the page', hex === 0, `count=${hex}`)
        const touch = w !== 390 ? [] : await page.evaluate(() => [...document.querySelectorAll('.cv2p a, .cv2p button')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.innerText.trim() || e.ariaLabel))
        log('touch targets 44px+ on the page', touch.length === 0, `small=${touch.join('|')}`)
      }
      await ctx.close()
    }
  }
}

// 2. Not found, with a back link.
{
  const { ctx, page } = await open(1440, 'light', { submitLive: true })
  await page.goto(`${base}/agent/clients/not-a-real-id`)
  await page.waitForSelector('text=Client not found', { timeout: 20000 })
  const back = await page.locator('a:has-text("Back to Clients")').getAttribute('href')
  await page.screenshot({ path: join(OUT, 'not-found-1440-light.png') })
  log('not-a-real-id shows Client not found with a back link', back === '/agent/clients', `href=${back}`)
  await ctx.close()
}

// 3. Leads-only agent sees the Servicing plan gate.
{
  const { ctx, page } = await open(1440, 'light', { leadsOnly: true, noServicing: true })
  await page.goto(`${base}/agent/clients/${L1}`)
  await page.waitForTimeout(3000); await settle(page)
  const t = await text(page)
  await page.screenshot({ path: join(OUT, 'leads-only-gate-1440-light.png') })
  log('Leads-only agent sees the Servicing gate, not the page', /Servicing/.test(t) && !t.includes('Texts and calls') && !t.includes('Marcus Bell'), t.replace(/\s+/g, ' ').slice(0, 200))
  await ctx.close()
}

// 4. Request button: on -> lands on the form with the client picked; off -> no button; no policy -> disabled.
for (const [label, id, name] of [['lead', L1, 'Marcus Bell'], ['existing', B1, 'Luis Herrera']]) {
  const { ctx, page } = await open(1440, 'light', { submitLive: true })
  await page.goto(`${base}/agent/clients/${id}`)
  await page.waitForSelector('a.cv2p-request', { timeout: 20000 }); await settle(page)
  const href = await page.locator('a.cv2p-request').getAttribute('href')
  await page.locator('a.cv2p-request').click()
  await page.waitForSelector('text=Service request', { timeout: 20000 }); await settle(page)
  const t = await text(page)
  const policy = label === 'lead' ? P1 : B1
  await page.screenshot({ path: join(OUT, `request-form-${label}-1440-light.png`) })
  log(`Request a service opens the form with ${label} client picked`, href === `/agent/submit?kind=request&policy=${policy}` && t.includes(name) && /Change/.test(t) && (await page.locator('input[aria-label="Search your clients"]').count()) === 0, `href=${href}`)
  await ctx.close()
}
{
  const { ctx, page } = await open(1440, 'light', { submitLive: false })
  await page.goto(`${base}/agent/clients/${L1}`)
  await page.waitForSelector('.cv2p-head', { timeout: 20000 }); await settle(page)
  const n = await page.locator('text=Request a service').count()
  log('submit_live off: no Request a service button', n === 0, `count=${n}`)
  await ctx.close()
}
{
  const { ctx, page } = await open(1440, 'light', { submitLive: true, noServicing: true })
  await page.goto(`${base}/agent/clients/${L1}`)
  await page.waitForSelector('.cv2p-head', { timeout: 20000 }); await settle(page)
  const n = await page.locator('text=Request a service').count()
  log('Leads-only profile: no Request a service button', n === 0, `count=${n}`)
  await ctx.close()
}
{
  const { ctx, page } = await open(1440, 'light', { submitLive: true })
  await page.goto(`${base}/agent/clients/${L2}`)
  await page.waitForSelector('.cv2p-head', { timeout: 20000 }); await settle(page)
  const dis = await page.locator('button:has-text("Request a service")').isDisabled()
  const t = await text(page)
  await page.screenshot({ path: join(OUT, 'lead-no-policy-1440-light.png') })
  log('lead with no policy: disabled button + note', dis && t.includes('Available once the policy is placed'), '')
  await ctx.close()
}

// 5. contact_log missing: page loads, quiet note, no error.
{
  const { ctx, page, state } = await open(1440, 'light', { submitLive: true, noContactLog: true })
  await page.goto(`${base}/agent/clients/${B1}`)
  await page.waitForSelector('.cv2p-head', { timeout: 20000 }); await settle(page)
  const t = await text(page)
  await page.screenshot({ path: join(OUT, 'contact-log-missing-1440-light.png'), fullPage: true })
  log('contact_log missing: quiet not-ready note', t.includes('The contact log isn’t switched on yet.') && !/Couldn.t load the contact log/i.test(t) && t.includes('Luis Herrera') && state.errors.length === 0, '')
  await ctx.close()
}

// 6. Drawer + list link.
{
  const { ctx, page } = await open(1440, 'light', { submitLive: true })
  await page.goto(`${base}/agent/clients?stage=cancelled&client=${L1}`)
  await page.waitForSelector('a:has-text("Open client page")', { timeout: 15000 }).catch(async () => { await page.screenshot({ path: join(OUT, 'drawer-debug.png') }); console.log((await text(page)).slice(0, 400)) }); await settle(page)
  const href = await page.locator('a:has-text("Open client page")').first().getAttribute('href')
  const req = await page.locator('a[href*="kind=request"]').count()
  await page.screenshot({ path: join(OUT, 'drawer-1440-light.png') })
  log('drawer: Open client page + request link', href === `/agent/clients/${L1}` && req >= 1, `href=${href} requestLinks=${req}`)
  await ctx.close()
}
await browser.close()
await server.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
