// P933 — browser check with every Supabase and Stripe call mocked (no real project, key or card is touched):
// the sign-up checkout (plan picker, slider estimate, booking desk "i", server total, pay → portal opens), the agent
// Billing breakdown under each lead charge, Admin › Settings › Billing (Stripe check shows the key prefix only) and
// Admin › Revenue › Charges. No "+12%" anywhere on the agent side.
//   node scripts/p933-check.mjs [outDir]       (default .p933-qa, not committed)
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { BOOK, pricesOf } from '../src/lib/priceBook.js'

const OUT = process.argv[2] || '.p933-qa'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })
const P = pricesOf(BOOK)

const AGENT = '11111111-1111-4111-8111-111111111111'
const ADMIN = '22222222-2222-4222-8222-222222222222'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const SELF = { id: AGENT, role: 'agent', full_name: 'Alex Rivera', email: 'alex@example.com', timezone: 'America/Chicago', is_active: true,
  billing_exempt: false, billing_status: 'none', signup_source: 'self', leads_status: 'none' }
const ADM = { id: ADMIN, role: 'admin', full_name: 'Brayden', email: 'admin@example.com', timezone: 'America/Chicago', is_active: true }

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const sessionOf = p => {
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: p.id, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
  return { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
    user: { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) } }
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// The server quote, the same sums as billing_signup_quote (price book v3).
function quote(tier, dailyCents) {
  if (tier === 'servicing') return { tier, label: 'Servicing only', daily_cents: 0, setup_cents: P.setupFee * 100, plan_cents: P.servicingOnly * 100, days: [], spend_cents: 0, fee_cents: 0, fee_rate: P.leadFee, total_cents: (P.setupFee + P.servicingOnly) * 100, version: 3, founding_left: 7 }
  const t = P.tiers.find(x => x.key === tier)
  const spend = 2 * dailyCents
  const fee = Math.round(spend * P.leadFee)
  return { tier, label: t.label, daily_cents: dailyCents, setup_cents: P.setupFee * 100, plan_cents: t.monthly * 100, days: ['2026-11-10', '2026-11-11'],
    spend_cents: spend, fee_cents: fee, fee_rate: P.leadFee, total_cents: P.setupFee * 100 + t.monthly * 100 + spend + fee, version: 3, founding_left: 7 }
}

const STRIPE_CHECK = {
  mode: 'live', key_prefix: 'sk_live_', publishable_mode: 'live', webhook_secret_set: true, webhook_url: `${SB}/functions/v1/agent-billing/webhook`,
  endpoint: null, endpoint_error: null, required_events: ['invoice.paid'], last_webhook: null, live_charging: false, live_charging_at: null, catalog: null,
  todo: [`In Stripe (live mode) > Developers > Webhooks, add an endpoint: ${SB}/functions/v1/agent-billing/webhook`, 'Events: invoice.paid'],
}

async function mock(page, st) {
  await page.route('https://js.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.Stripe=function(){return{elements(){return{create(){return{mount(){},on(){},destroy(){}}},getElement(){return null}}},registerAppInfo(){},_registerWrapper(){}}}' }))
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path === '/functions/v1/lead-spend') {
      const body = req.postDataJSON() || {}
      st.calls.push(body)
      if (body.action === 'signup_quote') return json(route, 200, quote(body.tier, body.daily_cents))
      if (body.action === 'card_check') return json(route, 200, { card: 'Visa ending 4242' })
      if (body.action === 'signup') { st.paid = true; return json(route, 200, { ...quote(body.tier, body.daily_cents), status: 'paid', failure: null, skipped: false }) }
      return json(route, 200, {})
    }
    if (path === '/functions/v1/agent-billing') {
      const body = req.postDataJSON() || {}
      st.calls.push(body)
      if (body.action === 'stripe_check') return json(route, 200, STRIPE_CHECK)
      return json(route, 200, { configured: true })
    }
    if (path.startsWith('/functions/v1/')) return json(route, 200, {})
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, st.profile)
    if (path === '/rest/v1/rpc/agent_portal_access') return json(route, 200, st.paid ? { self: true, servicing: true, leads: true, unlocked: true } : { self: true, servicing: false, leads: false, unlocked: false })
    return json(route, 200, single ? null : [])
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
async function open(profile, st, w = 1280, theme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 860 }, colorScheme: theme })
  await ctx.addInitScript(([s, th]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', th) }, [sessionOf(profile), theme])
  const page = await ctx.newPage()
  page.on('pageerror', e => check(`no page error (${profile.role} ${w})`, false, String(e)))
  await mock(page, st)
  return { ctx, page }
}
const go = async (page, path, sel) => { await page.goto(base + path, { waitUntil: 'domcontentloaded' }); await page.waitForSelector(sel, { timeout: 30000 }); await page.waitForTimeout(700) }
const bare12 = page => page.evaluate(() => /\+\s?12\s?%|plus 12%|12% of lead spend/i.test(document.body.innerText))
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false })

try {
  // ── Sign-up checkout ────────────────────────────────────────────────────
  for (const w of [1280, 390]) {
    const st = { profile: SELF, calls: [], paid: false }
    const { ctx, page } = await open(SELF, st, w)
    await go(page, '/agent', '[data-testid="sc-summary"]')
    const est0 = await page.locator('[data-testid="sc-estimate"]').textContent()
    check(`estimate at $100/day (${w})`, est0 === 'At $100/day: about $3,000 to your ads + $360 booking desk.', est0)
    const g = quote('growth', 10000)
    const total0 = await page.locator('[data-testid="sc-total"]').textContent()
    check(`Growth $100/day total from the server (${w})`, total0 === usd(g.total_cents), total0)
    check(`total in JetBrains Mono (${w})`, (await page.locator('[data-testid="sc-total"]').evaluate(e => getComputedStyle(e).fontFamily)).includes('JetBrains Mono'))
    // The slider moves the estimate and the server total.
    const slider = page.locator('#sc-daily')
    await slider.focus()
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(700)
    const est1 = await page.locator('[data-testid="sc-estimate"]').textContent()
    check(`estimate moves with the slider (${w})`, est1 === 'At $120/day: about $3,600 to your ads + $432 booking desk.', est1)
    const t1 = await page.locator('[data-testid="sc-total"]').textContent()
    check(`server total follows the slider (${w})`, t1 === usd(quote('growth', 12000).total_cents), t1)
    // The "i" opens the one explanation.
    await page.locator('.sc-i').first().click()
    const pop = await page.locator('.sc-pop').first().textContent()
    check(`booking desk "i" explains it (${w})`, pop.startsWith('Your ad money goes 100% to your ads. The booking desk is 12% of it'), pop)
    await page.locator('.sc-i').first().click()
    check(`no bare +12% on sign-up (${w})`, !(await bare12(page)))
    check(`no sideways scroll on sign-up (${w})`, !(await sideways(page)))
    // Servicing only.
    await page.locator('.sc-pl', { hasText: 'Servicing only' }).click()
    await page.waitForTimeout(700)
    const ts = await page.locator('[data-testid="sc-total"]').textContent()
    check(`servicing only = setup + $499 (${w})`, ts === `$${(P.setupFee + P.servicingOnly).toLocaleString('en-US')}`, ts)
    check(`servicing only hides the slider (${w})`, (await page.locator('#sc-daily').count()) === 0)
    if (w === 1280) {
      await page.locator('.sc-pl', { hasText: 'Growth' }).click()
      await page.waitForTimeout(700)
      await page.locator('.sc').scrollIntoViewIfNeeded()
      await shot(page, 'signup-1280-dark')
      await page.locator('[data-testid="sc-pay"]').click()
      await page.waitForTimeout(1500)
      const pay = st.calls.find(c => c.action === 'signup')
      check('Pay sends the plan and spend', pay?.tier === 'growth' && pay?.daily_cents === 12000, pay)
      check('paid: the You’re in moment shows', (await page.getByText('You’re in', { exact: false }).count()) > 0 && (await page.locator('[data-testid="sc-pay"]').count()) === 0)
    }
    await ctx.close()
  }

  // ── Agent Billing (sample): the breakdown under each lead charge ─────────
  {
    const st = { profile: { ...SELF, signup_source: 'invite', billing_status: 'active' }, calls: [], paid: true }
    const { ctx, page } = await open(st.profile, st)
    await go(page, '/agent/billing', '.bl-charges')
    const desk = await page.locator('.bl-ch-desk').allTextContents()
    check('each lead charge shows its breakdown', desk.length >= 3 && desk.some(t => t.startsWith('Tonight $') && t.includes('to your ads') && t.includes('booking desk')), desk.slice(0, 2))
    check('a past charge reads $112 · $100 to your ads · $12 booking desk', desk.includes('$112 · $100 to your ads · $12 booking desk'), desk)
    check('no bare +12% on Billing', !(await bare12(page)))
    await page.locator('.bl-charges').scrollIntoViewIfNeeded()
    await shot(page, 'agent-billing-1280-dark')
    await ctx.close()
  }

  // ── Admin › Settings › Billing and Revenue › Charges ─────────────────────
  {
    const st = { profile: ADM, calls: [], paid: false }
    const { ctx, page } = await open(ADM, st)
    await go(page, '/admin/settings?tab=billing', '[data-testid="stripe-check"]')
    const txt = await page.locator('.b933').innerText()
    check('Stripe check shows live mode', txt.includes('Live mode'))
    check('key shown as its prefix only', txt.includes('Starts sk_live_…') && !/sk_live_[A-Za-z0-9]{4,}/.test(txt))
    check('missing endpoint lists what to add', (await page.locator('[data-testid="stripe-todo"] li').count()) === 2)
    check('Live charging switch is off', await page.getByRole('switch', { name: 'Live charging' }).getAttribute('aria-checked') === 'false')
    await page.getByRole('switch', { name: 'Live charging' }).click()
    check('turning it on asks first', await page.getByRole('alertdialog', { name: 'Turn on live charging' }).count() === 1)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await shot(page, 'admin-billing-1280-dark')
    await go(page, '/admin/billing?tab=charges', '[data-testid="recent-charges"]')
    const head = await page.locator('[data-testid="recent-charges"] thead').innerText()
    check('Revenue labels it Booking desk (12%)', head.includes('Booking desk (12%)'), head)
    const rev = await page.locator('.adm-rev-head').innerText()
    check('headline says Booking desk (12%)', rev.includes('Booking desk (12%)'), rev)
    await ctx.close()
  }
} finally {
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(checks, null, 2))
  await browser.close()
  await server.close()
  const bad = checks.filter(c => !c.ok)
  console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`)
  process.exitCode = bad.length ? 1 : 0
}
