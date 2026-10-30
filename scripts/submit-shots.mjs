// Checks the Submit page, its submit_live gate, Service request, leads-only, the Clients
// No-old-policy row and the admin switch in a browser with every Supabase call mocked.
//   node scripts/submit-shots.mjs [outDir]
// Writes PNGs into outDir (default .submit-qa, not committed). Touches no real project.
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || '.submit-qa'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const ahead = h => new Date(Date.now() + h * 3600e3).toISOString()
const BASE = {
  id: AGENT, role: 'agent', full_name: 'Alex Rivera', email: 'alex.rivera@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'premium',
}
const TIERS = [
  { key: 'standard', name: 'Standard', weekly_cents: 19900, weekly_cap: 7, is_active: true, sort_order: 1 },
  { key: 'premium', name: 'Premium', weekly_cents: 34900, weekly_cap: 16, is_active: true, sort_order: 2 },
]
const usage = (used, cap, enforced = true) => ({ used, weekly_cap: cap, enforced, tier_name: 'Premium', tier: 'premium', week_start: ago(48), week_end: ahead(120) })
const row = (id, first, last, extra = {}) => ({
  id, agent_id: AGENT, client_first_name: first, client_last_name: last, client_phone: '2515550197', state: 'AL', client_city: 'Mobile',
  client_timezone: 'America/Chicago', carrier_id: null, carrier_name: null, fulfillment_assigned: true, fulfillment_stage: 'Pending',
  scheduled_call_at: ahead(70), replaced_old_policy: true, new_carrier_name: null, best_time: null, created_at: ago(30), updated_at: ago(30),
  agent: { id: AGENT, full_name: 'Alex Rivera' }, details: { current_carrier: 'Globe Life' }, ...extra,
})
const ROWS = [
  row('p1', 'Helen', 'Park'),
  row('p2', 'Terrence', 'Holt', { replaced_old_policy: false, scheduled_call_at: null, new_carrier_name: 'Corebridge', best_time: 'afternoon', details: null }),
  row('p3', 'Renee', 'Castillo'),
]

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const JWT = id => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const session = p => ({
  access_token: JWT(p.id), refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
})
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// st: settings (the app_settings row), profile, usage, rpcs (every RPC call), patches (every PATCH body).
async function mock(page, st) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (req.method() === 'PATCH') { st.patches.push({ path, body: req.postDataJSON() }); return json(route, 200, [{ id: 1 }]) }
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, st.profile)
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [st.usage])
    if (path === '/rest/v1/rpc/agent_portal_access') return json(route, 404, { code: 'PGRST202', message: 'no' })
    if (path === '/rest/v1/rpc/agent_submit_service_request') {
      st.rpcs.push(req.postDataJSON())
      return st.refuse ? json(route, 400, { code: 'P0001', message: 'Servicing is not on your plan', hint: st.refuse }) : json(route, 200, 'req-1')
    }
    const table = path.replace('/rest/v1/', '')
    if (table === 'agent_billing_tiers') return rows(TIERS)
    if (table === 'app_settings') return rows([{ id: 1, ...st.settings }])
    if (table === 'policies') return rows(ROWS)
    return rows([])
  })
}

const SIZES = { 1280: { width: 1280, height: 800 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function open(theme, w, st) {
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([s, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
    localStorage.setItem('ohvara-theme', th)
  }, [session(st.profile), theme])
  const page = await ctx.newPage()
  page.on('pageerror', e => check(`no page error (${w} ${theme})`, false, String(e)))
  await mock(page, st)
  return { ctx, page }
}
const state = (o = {}) => ({ profile: BASE, settings: { submit_live: false }, usage: usage(5, 16), rpcs: [], patches: [], ...o })
const go = async (page, path) => {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ov-sb-nav, .ph-tabbar, .ph-book, .ph-app, .ph-subhead', { timeout: 30000 })
  await page.waitForTimeout(1100)
}
const hasText = (page, text) => page.getByText(text, { exact: false }).count().then(n => n > 0)
const bodyText = page => page.locator('body').innerText()
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
const sideways = async (page, label) => {
  const s = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  check(`no sideways scroll ${label}`, s.sw <= s.cw, s)
}
const sendBtn = page => page.getByRole('button', { name: /^(Send request|Send)$/ }).last()

try {
  for (const theme of ['dark', 'light']) {
    for (const w of [1280, 390]) {
      const tag = `${w} ${theme}`
      const file = n => `${n}-${w}-${theme}`

      // 1. off and unset: today's booking flow and nothing else
      for (const [label, settings] of [['off', { submit_live: false }], ['unset', {}]]) {
        const { ctx, page } = await open(theme, w, state({ settings }))
        await go(page, '/agent/submit')
        check(`${label}: New booking form (${tag})`, await hasText(page, 'First name'))
        check(`${label}: no chooser, no service request (${tag})`, !(await hasText(page, 'New deal for servicing')) && !(await hasText(page, 'Service request')))
        check(`${label}: no new meter text (${tag})`, !(await hasText(page, 'Submissions this week')))
        if (label === 'off') { await shot(page, file('off')); await sideways(page, `off ${tag}`) }
        await ctx.close()
      }
      // the old URL keeps the whole query string
      {
        const { ctx, page } = await open(theme, w, state())
        await go(page, '/agent/book?change=p1')
        check(`/agent/book?change=p1 redirects (${tag})`, page.url().endsWith('/agent/submit?change=p1'), page.url())
        check(`...and opens Change a booking (${tag})`, await hasText(page, 'Change a booking'))
        await go(page, '/agent/book')
        check(`/agent/book redirects (${tag})`, page.url().endsWith('/agent/submit'), page.url())
        await ctx.close()
      }

      // 2. on: chooser, deal, request
      {
        const st = state({ settings: { submit_live: true } })
        const { ctx, page } = await open(theme, w, st)
        await go(page, '/agent/submit')
        check(`chooser (${tag})`, await hasText(page, 'New deal for servicing') && await hasText(page, 'Service request') && await hasText(page, 'Change a booking'))
        check(`meter: Submissions this week, 5 of 16 (${tag})`, await hasText(page, 'Submissions this week') && (await bodyText(page)).includes('5 of 16'))
        check(`deal card says 11 left (${tag})`, await hasText(page, 'Uses 1 of your 11 left this week'))
        await shot(page, file('chooser')); await sideways(page, `chooser ${tag}`)

        await go(page, '/agent/submit?kind=deal')
        check(`?kind=deal renders SubmitDeal (${tag})`, await hasText(page, 'Submit a deal'))
        await sideways(page, `deal ${tag}`)

        await go(page, '/agent/submit?kind=request')
        check(`?kind=request renders the form (${tag})`, (await page.getByLabel('Search your clients').count()) > 0)
        await shot(page, file('request-empty')); await sideways(page, `request ${tag}`)
        await sendBtn(page).click()
        await page.waitForTimeout(300)
        check(`empty send shows what is missing (${tag})`, await hasText(page, 'Pick a client and a request'))
        await shot(page, file('request-missing'))
        await go(page, '/agent/submit?kind=request') // a full-page screenshot resizes the window; start the fill from a clean page
        await page.getByLabel('Search your clients').fill('Renee')
        await page.getByRole('option', { name: /Renee Castillo/ }).click()
        await page.getByRole('button', { name: /Beneficiary change/ }).click()
        await page.locator('textarea').fill('New beneficiary is her son, Marcus Castillo.')
        await page.getByRole('button', { name: /Afternoon/ }).click()
        await page.screenshot({ path: join(OUT, `${file('request-filled')}.png`) }); await sideways(page, `request filled ${tag}`)
        await sendBtn(page).click()
        await page.waitForSelector('text=Request sent', { timeout: 8000 }).catch(async () => {
          check(`request sent screen appears (${tag})`, false, { rpcs: st.rpcs, body: (await bodyText(page)).slice(0, 600) })
        })
        const sent = st.rpcs[0]
        check(`RPC args (${tag})`, sent && sent.p_policy === 'p3' && sent.p_kind === 'beneficiary_change' && sent.p_best_time === 'afternoon' && /Marcus/.test(sent.p_note), sent)
        check(`success state, no submission used (${tag})`, await hasText(page, 'Didn’t use a submission'))
        await shot(page, file('request-sent')); await sideways(page, `request sent ${tag}`)
        await ctx.close()
      }
      // refusal hints
      for (const [hint, text] of [['no_servicing', 'Leads only, so this request can’t be sent'], ['not_live', 'Service requests are not open yet']]) {
        const st = state({ settings: { submit_live: true }, refuse: hint })
        const { ctx, page } = await open(theme, w, st)
        await go(page, '/agent/submit?kind=request')
        await page.getByLabel('Search your clients').fill('Helen')
        await page.getByRole('option', { name: /Helen Park/ }).click()
        await page.getByRole('button', { name: /Lapse help/ }).click()
        await page.locator('textarea').fill('Lapsed last week.')
        await page.getByRole('button', { name: /Morning/ }).click()
        await sendBtn(page).click()
        await page.waitForTimeout(700)
        check(`${hint} message (${tag})`, await hasText(page, text))
        if (hint === 'no_servicing') await shot(page, file('request-refused'))
        await ctx.close()
      }

      // at the cap: the deal card stops, the request card stays open
      {
        const { ctx, page } = await open(theme, w, state({ settings: { submit_live: true }, usage: usage(16, 16) }))
        await go(page, '/agent/submit')
        check(`at cap: Weekly cap reached, request still a link (${tag})`, (await hasText(page, 'Weekly cap reached')) && (await page.locator('a[href*="kind=request"]').count()) === 1 && (await page.locator('a[href*="kind=deal"]').count()) === 0)
        await shot(page, file('chooser-cap')); await sideways(page, `cap ${tag}`)
        await ctx.close()
      }

      // leads-only; comped and gate-off are unaffected
      {
        const { ctx, page } = await open(theme, w, state({ settings: { submit_live: true }, profile: { ...BASE, has_servicing: false } }))
        await go(page, '/agent/submit')
        check(`leads-only view (${tag})`, (await hasText(page, 'Add Servicing to submit deals')) && (await hasText(page, 'How to add it')) && (await page.locator('a[href="/agent/billing"]').count()) > 0)
        check(`leads-only: no chooser (${tag})`, !(await hasText(page, 'New deal for servicing')))
        await shot(page, file('leads-only')); await sideways(page, `leads-only ${tag}`)
        await go(page, '/agent/submit?kind=request')
        check(`leads-only wins over ?kind (${tag})`, await hasText(page, 'Add Servicing to submit deals'))
        await ctx.close()
        const c = await open(theme, w, state({ settings: { submit_live: true }, profile: { ...BASE, has_servicing: false, billing_exempt: true } }))
        await go(c.page, '/agent/submit')
        check(`comped is unaffected (${tag})`, await hasText(c.page, 'New deal for servicing'))
        await c.ctx.close()
        const o = await open(theme, w, state({ settings: { submit_live: false }, profile: { ...BASE, has_servicing: false } }))
        await go(o.page, '/agent/submit')
        check(`gate off beats leads-only (${tag})`, !(await hasText(o.page, 'Add Servicing')))
        await o.ctx.close()
      }

      // Clients: a No-old-policy row
      {
        const { ctx, page } = await open(theme, w, state())
        await go(page, '/agent/clients')
        const body = await bodyText(page)
        check(`Clients lists the No-old-policy row as Submitted (${tag})`, /Submitted/.test(body) && /Terrence Holt/.test(body), body.slice(0, 200))
        check(`Clients: no Invalid Date, no NaN (${tag})`, !/Invalid Date|NaN/.test(body))
        await shot(page, file('clients')); await sideways(page, `clients ${tag}`)
        await go(page, '/agent/clients?open=p2')
        const drawer = await bodyText(page)
        check(`drawer: None to cancel, no Invalid Date, no Change booking button (${tag})`, /None to cancel/.test(drawer) && !/Invalid Date/.test(drawer) && !/Change (this )?booking/.test(drawer), drawer.slice(0, 300))
        await shot(page, file('clients-drawer'))
        await ctx.close()
      }
    }

    // 3. the admin switch (Settings, Team tools), desktop
    {
      const st = state({ profile: { ...BASE, role: 'admin', full_name: 'Admin Person' }, settings: { submit_live: false } })
      const { ctx, page } = await open(theme, 1280, st)
      await page.goto(`${base}/settings#team`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('text=Submit page live', { timeout: 30000 })
      const sw = page.getByRole('switch', { name: 'Submit page live' })
      check(`admin switch present and off (${theme})`, (await sw.count()) === 1 && (await sw.getAttribute('aria-checked')) === 'false')
      await shot(page, `admin-switch-${theme}`)
      check(`nothing flipped (${theme})`, st.patches.length === 0)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
process.exit(failed ? 1 : 0)
