// Checks the locked welcome and per-product access in a browser with every Supabase
// and Stripe call mocked, so no real project, account, key or card is touched.
//   node scripts/locked-welcome-shots.mjs [outDir]
// Writes PNGs plus checks.json into outDir (default .lw-qa, not committed).
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || '.lw-qa'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const ahead = h => new Date(Date.now() + h * 3600e3).toISOString()
const BASE = {
  id: AGENT, role: 'agent', full_name: 'Alex Rivera', email: 'alex.rivera@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'none', billing_tier: 'standard',
}
const SELF = { ...BASE, signup_source: 'self', leads_status: 'none' }
const TIERS = [
  { key: 'standard', name: 'Standard', weekly_cents: 19900, weekly_cap: 7, is_active: true, sort_order: 1 },
  { key: 'premium', name: 'Premium', weekly_cents: 34900, weekly_cap: 16, is_active: true, sort_order: 2 },
]
const USAGE = { used: 0, weekly_cap: 7, enforced: true, tier_name: 'Standard', week_start: ago(48), week_end: ahead(120) }

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: BASE.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// A stand-in for Stripe.js, so the embed mounts without the network or a real key.
const FAKE_STRIPE = `window.Stripe = function () {
  const fn = () => {}
  return {
    elements: fn, createToken: fn, createPaymentMethod: fn, confirmCardPayment: fn, _registerWrapper: fn, registerAppInfo: fn,
    createEmbeddedCheckoutPage: async () => ({
      mount(el) { const box = document.createElement('div'); box.id = 'fake-stripe'; box.textContent = 'Stripe form'; box.style.minHeight = '320px'; box.style.padding = '16px'; el.appendChild(box) },
      unmount() {}, destroy() {},
    }),
  }
}`

// st: what the mocked backend answers for this page.
async function mock(page, st) {
  await page.route('https://js.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_STRIPE }))
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path === '/functions/v1/agent-billing') {
      const body = req.postDataJSON() || {}
      st.calls.push(body)
      if (body.action === 'checkout') return st.checkout ? st.checkout(route, body) : json(route, 200, { client_secret: 'cs_test_mock', publishable_key: 'pk_test_mock' })
      return json(route, 200, { configured: true, billing_status: st.profile.billing_status })
    }
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') { st.profileReads++; return json(route, 200, st.profile) }
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [USAGE])
    if (path === '/rest/v1/rpc/agent_portal_access') {
      st.accessCalls++
      const a = typeof st.access === 'function' ? st.access() : st.access
      return a === 404 ? json(route, 404, { code: 'PGRST202', message: 'Could not find the function' }) : json(route, 200, a)
    }
    const table = path.replace('/rest/v1/', '')
    if (table === 'agent_billing_tiers') return rows(TIERS)
    if (table === 'app_settings') return rows([{ id: 1, agent_billing_enforced: !!st.enforced }])
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
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function open(theme, w, st, native = false) {
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th, nat]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
    if (nat) window.androidBridge = { postMessage() {} }
  }, [SESSION, theme, native])
  const page = await ctx.newPage()
  // A desktop browser posing as the app has no native plugins, so those errors mean nothing.
  if (!native) page.on('pageerror', e => check(`no page error (${w} ${theme})`, false, String(e)))
  await mock(page, st)
  return { ctx, page }
}

const state = (profile, extra = {}) => ({ profile, access: 404, enforced: false, calls: [], accessCalls: 0, profileReads: 0, ...extra })
const go = async (page, path) => {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ov-sb-nav, .ph-tabbar, .ph-book, .ph-app', { timeout: 30000 })
  await page.waitForTimeout(900)
}
const has = (page, sel) => page.locator(sel).count().then(n => n > 0)
const hasText = (page, text) => page.getByText(text, { exact: false }).count().then(n => n > 0)
const noSideways = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })

const WELCOME = '.lk-hero'
const ADD = 'Add a Servicing plan to submit deals'

try {
  // ── every stub, both widths, both themes ─────────────────────────────────
  const EXPECT = {
    none: { '/agent': 'welcome', '/agent/book': 'welcome', '/agent/clients': 'welcome' },
    unknown: { '/agent': 'welcome', '/agent/book': 'welcome', '/agent/clients': 'welcome' },
    servicing: { '/agent': 'open', '/agent/book': 'open', '/agent/clients': 'open' },
    leads: { '/agent': 'open', '/agent/book': 'open', '/agent/clients': 'open' },
    leads_only: { '/agent': 'open', '/agent/book': 'add', '/agent/clients': 'add' },
    invited: { '/agent': 'open', '/agent/book': 'open', '/agent/clients': 'open' },
  }
  for (const theme of ['dark', 'light']) {
    for (const w of [1280, 390]) {
      const st = state(BASE)
      const { ctx, page } = await open(theme, w, st)
      for (const [stub, routes] of Object.entries(EXPECT)) {
        for (const [route, want] of Object.entries(routes)) {
          await go(page, `${route}?portalstub=${stub}`)
          const welcome = await has(page, WELCOME)
          const add = await hasText(page, ADD)
          const got = welcome ? 'welcome' : add ? 'add' : 'open'
          check(`${stub} ${route} ${w} ${theme} shows ${want}`, got === want, got)
          const s = await noSideways(page)
          check(`no sideways scroll ${stub} ${route} ${w} ${theme}`, s.sw <= s.cw, s)
          if (route === '/agent' || want === 'add') await shot(page, `${stub}-${route.replaceAll('/', '_')}-${w}-${theme}`)
          if (stub === 'unknown' && route === '/agent') check(`unknown has the note ${w} ${theme}`, await hasText(page, 'couldn’t check your account'))
          if (w === 390 && route === '/agent/book' && (want === 'welcome' || want === 'add')) check(`phone keeps the tab bar on a gated Submit (${stub} ${theme})`, await has(page, '.ph-tabbar'))
        }
      }
      // Locked, these stay open.
      for (const route of ['/settings', '/agent/billing', '/agent/leads', ...(w === 390 ? ['/agent/more'] : [])]) {
        await go(page, `${route}?portalstub=none`)
        check(`none ${route} ${w} ${theme} stays open`, !(await has(page, WELCOME)))
        const s = await noSideways(page)
        check(`no sideways scroll none ${route} ${w} ${theme}`, s.sw <= s.cw, s)
      }
      if (w === 390) {
        await go(page, '/agent/more?portalstub=none')
        await shot(page, `more-locked-390-${theme}`)
        check(`More while locked: no plan, no meter (${theme})`, await hasText(page, 'No plan yet') && !(await has(page, '.ph-meter')) && !(await hasText(page, 'Standard plan')))
        check(`More while locked: its pages dim (${theme})`, await page.locator('.ph-mrow.is-locked').count() === 2)
        await page.getByRole('button', { name: 'Choose a plan' }).click()
        await page.waitForSelector(WELCOME)
        await page.waitForTimeout(500)
        check(`More's Choose a plan lands on the plans (${theme})`, await page.locator('.lk-sec').evaluate(el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 }))
      }
      await ctx.close()
    }
  }

  // ── the page's rules ─────────────────────────────────────────────────────
  {
    const st = state(SELF, { access: { self: true, servicing: false, leads: false, unlocked: false } })
    const { ctx, page } = await open('dark', 1280, st)
    await go(page, '/agent')
    check('leads card has no button or link', await page.locator('.lk-soon button, .lk-soon a').count() === 0)
    check('leads card says Opens soon', await hasText(page, 'Opens soon · not available to buy yet'))
    const prices = await page.$$eval('.lk-pl-price .lk-money', e => e.map(x => [x.textContent, getComputedStyle(x).fontFamily]))
    check('plan prices come from the tiers', JSON.stringify(prices.map(p => p[0])) === '["$199","$349"]', prices)
    check('plan prices are in JetBrains Mono', prices.every(p => p[1].includes('JetBrains Mono')), prices)
    check('JetBrains Mono is really loaded', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('600 26px "JetBrains Mono"') }))
    // Checkout: the plan section opens it, with the plan and a return to /agent.
    await page.locator('.lk-sec').scrollIntoViewIfNeeded()
    await page.waitForSelector('#fake-stripe', { timeout: 10000 })
    const first = st.calls.find(c => c.action === 'checkout')
    check('checkout sends the plan', first?.tier === 'standard', first)
    check('checkout returns to /agent', first?.return_url === `${base}/agent`, first)
    check('test mode pill shows for a pk_test key', await page.locator('.lk-co .pv-pill', { hasText: 'Test mode' }).count() === 1)
    check('test mode line shows', await hasText(page, 'Test mode: no real card is charged.'))
    await page.locator('.lk-pl', { hasText: 'Premium' }).click()
    await page.waitForFunction(() => document.querySelector('#fake-stripe'))
    await page.waitForTimeout(300)
    const last = st.calls.filter(c => c.action === 'checkout').pop()
    check('switching plan opens a new session', last?.tier === 'premium', last)
    check('summary follows the plan', (await page.locator('.lk-sum').textContent()).includes('16 a week') && (await page.locator('.lk-sum').textContent()).includes('$349'))
    await shot(page, 'checkout-1280-dark')
    await ctx.close()
  }
  for (const [name, code, status, text] of [
    ['not set up', 'not_configured', 503, 'Checkout couldn’t open'],
    ['already subscribed', 'already_subscribed', 409, 'You already have a subscription'],
  ]) {
    const st = state(SELF, {
      access: { self: true, servicing: false, leads: false, unlocked: false },
      checkout: (route) => json(route, status, { error: 'no', code }),
    })
    const { ctx, page } = await open('light', 390, st)
    await go(page, '/agent')
    await page.locator('.lk-hero .ov-hero-btn').click()
    await page.waitForTimeout(1200)
    check(`checkout ${name}: says so`, await hasText(page, text))
    check(`checkout ${name}: nothing charged or paid twice wording`, await hasText(page, code === 'already_subscribed' ? 'don’t need to pay again' : 'Nothing was charged'))
    await page.locator('.lk-problem').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(OUT, `checkout-${code}-390-light.png`) })
    await ctx.close()
  }

  // ── fail closed, and who never sees it ───────────────────────────────────
  {
    const st = state(SELF, { access: 404 })
    const { ctx, page } = await open('dark', 1280, st)
    await go(page, '/agent/book')
    await page.waitForTimeout(1500) // the query's one retry
    check('self-signup with the RPC missing is locked', await has(page, WELCOME))
    check('self-signup with the RPC missing gets the note', await hasText(page, 'couldn’t check your account'))
    await ctx.close()
  }
  {
    const st = state(BASE, { access: 404 })
    const { ctx, page } = await open('dark', 1280, st)
    await go(page, '/agent')
    check('invited with the columns and RPC missing: normal page', !(await has(page, WELCOME)) && !(await hasText(page, 'access is paused')))
    check('invited never calls the RPC', st.accessCalls === 0, st.accessCalls)
    await shot(page, 'invited-flag-off-1280-dark')
    await ctx.close()
  }
  {
    const st = state(BASE, { enforced: true })
    const { ctx, page } = await open('dark', 1280, st)
    await go(page, '/agent')
    check('invited with the flag on: today’s paused card', await hasText(page, 'Your portal access is paused') && !(await has(page, WELCOME)))
    await go(page, '/settings')
    check('invited with the flag on: Settings open', !(await hasText(page, 'Your portal access is paused')))
    await shot(page, 'invited-flag-on-settings-1280-dark')
    await ctx.close()
  }
  for (const [role, path] of [['fulfillment', '/fulfillment'], ['admin', '/admin']]) {
    const st = state({ ...BASE, role, signup_source: 'self' }, { enforced: true })
    const { ctx, page } = await open('dark', 1280, st)
    await go(page, `${path}?portalstub=none`)
    check(`${role} never sees the welcome or the card`, !(await has(page, WELCOME)) && !(await hasText(page, 'access is paused')))
    check(`${role} never calls the RPC`, st.accessCalls === 0, st.accessCalls)
    check(`${role} has no locked rows`, await page.locator('.ov-sb-row.is-locked').count() === 0)
    await ctx.close()
  }

  // ── back from checkout ───────────────────────────────────────────────────
  {
    let n = 0
    const st = state(SELF, { access: () => (++n < 3 ? { self: true, servicing: false, leads: false, unlocked: false } : { self: true, servicing: true, leads: false, unlocked: true }) })
    const { ctx, page } = await open('dark', 1280, st)
    await page.addInitScript(() => sessionStorage.setItem('ohvara-portal-checkout', JSON.stringify({ tier: 'standard', test: true })))
    await page.goto(`${base}/agent?session_id=cs_test_1`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.lk-ring', { timeout: 30000 })
    await page.evaluate(() => { window.__noReload = true })
    check('confirming shows', await hasText(page, 'Confirming your payment…'))
    check('confirming keeps the plan row', await hasText(page, 'Servicing · 7 a week'))
    await shot(page, 'confirming-1280-dark')
    const reads = st.profileReads
    await page.waitForSelector('text=You’re in, Alex.', { timeout: 20000 })
    check('polling reached the unlocked moment', true)
    check('status was asked (heals from Stripe)', st.calls.filter(c => c.action === 'status').length >= 2, st.calls.length)
    check('no reload on unlock', await page.evaluate(() => window.__noReload === true))
    check('url is a clean /agent', new URL(page.url()).pathname === '/agent' && !new URL(page.url()).search, page.url())
    await page.waitForTimeout(600)
    check('profile refreshed', st.profileReads > reads, [reads, st.profileReads])
    check('moment says the week’s allowance', await hasText(page, 'You have 7 submissions this week'))
    check('sidebar locks are gone', await page.locator('.ov-sb-row.is-locked').count() === 0)
    await shot(page, 'unlocked-1280-dark')
    await page.getByRole('button', { name: 'Look around' }).click()
    await page.waitForTimeout(300)
    check('Look around goes to the Overview', !(await hasText(page, 'You’re in')))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ov-sb-nav')
    await page.waitForTimeout(900)
    check('the moment is one time: a reload shows the Overview', !(await hasText(page, 'You’re in')) && !(await has(page, WELCOME)))
    await ctx.close()
  }
  {
    let unlocked = false
    const st = state(SELF, { access: () => ({ self: true, servicing: unlocked, leads: false, unlocked }) })
    const { ctx, page } = await open('light', 390, st)
    await page.goto(`${base}/agent?session_id=cs_test_2`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.lk-ring', { timeout: 30000 })
    await page.screenshot({ path: join(OUT, 'confirming-390-light.png'), fullPage: true })
    const t0 = Date.now()
    await page.waitForSelector('text=This is taking a little longer.', { timeout: 75000 })
    const secs = (Date.now() - t0) / 1000
    check('still confirming after about 60 seconds', secs > 55 && secs < 70, secs)
    const looks = st.calls.filter(c => c.action === 'status').length
    check('polled about every 2 seconds', looks >= 25 && looks <= 34, looks)
    await page.waitForTimeout(3000)
    check('polling stopped', st.calls.filter(c => c.action === 'status').length === looks)
    check('still: Check again and See Billing', await hasText(page, 'Check again') && await hasText(page, 'See Billing'))
    await page.screenshot({ path: join(OUT, 'still-390-light.png'), fullPage: true })
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.waitForTimeout(800)
    check('Check again stays calm when nothing changed', await hasText(page, 'Last checked'))
    unlocked = true
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.waitForSelector('text=You’re in, Alex.', { timeout: 10000 })
    check('Check again opens the portal', true)
    await page.screenshot({ path: join(OUT, 'unlocked-390-light.png'), fullPage: true })
    const s = await noSideways(page)
    check('no sideways scroll on the moment 390', s.sw <= s.cw, s)
    await page.getByRole('link', { name: 'Submit your first deal' }).click()
    await page.waitForTimeout(600)
    check('Submit your first deal opens Submit', new URL(page.url()).pathname === '/agent/book' && !(await has(page, WELCOME)), page.url())
    await page.goBack()
    await page.waitForTimeout(600)
    check('coming back shows the Overview, not the moment', new URL(page.url()).pathname === '/agent' && !(await hasText(page, 'You’re in')))
    await ctx.close()
  }
  {
    const st = state(SELF, { access: { self: true, servicing: false, leads: false, unlocked: false } })
    const { ctx, page } = await open('dark', 1280, st)
    await go(page, '/agent')
    check('abandoned checkout (no session_id): plain locked, no message', await has(page, WELCOME) && !(await has(page, '.lk-ring')))
    await ctx.close()
  }

  // ── the phone app ────────────────────────────────────────────────────────
  for (const theme of ['dark', 'light']) {
    const st = state(SELF, { access: { self: true, servicing: false, leads: false, unlocked: false } })
    const { ctx, page } = await open(theme, 390, st, true)
    await go(page, '/agent')
    check(`native ${theme}: locked page`, await has(page, WELCOME))
    check(`native ${theme}: existing wording`, await hasText(page, 'Billing is managed on the Ohvara website.'))
    check(`native ${theme}: no pay buttons or plans`, await page.locator('.lk-pl, .lk-co, .ov-solid, .lk-hero .ov-hero-btn').count() === 0)
    check(`native ${theme}: no prices`, !(/\$\d/.test(await page.locator('.ph-main').innerText())))
    check(`native ${theme}: never opens checkout`, !st.calls.some(c => c.action === 'checkout'))
    await shot(page, `native-locked-390-${theme}`)
    await go(page, '/agent/book?portalstub=leads_only')
    check(`native ${theme}: leads only has no add button`, await page.locator('.lk a, .lk button').count() === 0)
    check(`native ${theme}: leads only wording`, await hasText(page, 'Servicing isn’t on your account'))
    await shot(page, `native-leadsonly-390-${theme}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  await server.close()
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(checks, null, 2))
}
const failed = checks.filter(c => !c.ok)
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
