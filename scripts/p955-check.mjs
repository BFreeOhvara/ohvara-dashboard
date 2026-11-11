// P955 — browser check of the sign-up's "What do you need?" with every Supabase and Stripe call mocked (no real
// project, key or card is touched): each product alone and each mix shows the right total and lines, Leads alone asks
// for the plan and details, Reactivation only charges nothing and opens the portal, Pay sends the products picked.
//   node scripts/p955-check.mjs [outDir]       (default .p955-qa, not committed)
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { BOOK, pricesOf } from '../src/lib/priceBook.js'

const OUT = process.argv[2] || '.p955-qa'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5957
mkdirSync(OUT, { recursive: true })
const P = pricesOf(BOOK)

const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const SELF = { id: AGENT, role: 'agent', full_name: 'Alex Rivera', email: 'alex@example.com', timezone: 'America/Chicago', is_active: true,
  billing_exempt: false, billing_status: 'none', signup_source: 'self', leads_status: 'none' }
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

// The same sums as billing_signup_quote in 268_products.sql.
function quote(tier, dailyCents, products = ['leads']) {
  const leads = products.includes('leads'), svc = products.includes('servicing')
  if (!leads && !svc) return { tier: 'reactivation', label: 'Reactivation', setup_cents: 0, plan_cents: 0, days: [], spend_cents: 0, fee_cents: 0, total_cents: 0, free: true, lines: [], products }
  const s = svc ? P.servicingOnly * 100 : 0
  const lines = []
  let plan = 0, spend = 0, fee = 0, label = 'Servicing only'
  if (leads) {
    const t = P.tiers.find(x => x.key === tier)
    plan = t.monthly * 100; spend = 2 * dailyCents; fee = Math.round(spend * P.leadFee); label = t.label
    lines.push({ key: 'leads', label: `${t.label} plan, first month`, cents: plan })
  }
  if (svc) lines.push({ key: 'servicing', label: 'Servicing, first month', cents: s })
  return { tier, label, setup_cents: P.setupFee * 100, plan_cents: plan + s, days: leads ? ['2026-11-12', '2026-11-13'] : [], spend_cents: spend,
    fee_cents: fee, total_cents: P.setupFee * 100 + plan + s + spend + fee, lines, products, free: false, founding_left: 0 }
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
      if (body.action === 'signup_quote') return json(route, 200, quote(body.tier, body.daily_cents, body.products))
      if (body.action === 'card_check') return json(route, 200, { card: 'Visa ending 4242' })
      if (body.action === 'signup') { st.paid = true; return json(route, 200, { ...quote(body.tier, body.daily_cents, body.products), status: 'paid', failure: null, skipped: null }) }
      return json(route, 200, {})
    }
    if (path.startsWith('/functions/v1/')) return json(route, 200, {})
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, st.profile)
    if (path === '/rest/v1/rpc/agent_portal_access') return json(route, 200, st.paid ? { self: true, servicing: true, leads: false, unlocked: true } : { self: true, servicing: false, leads: false, unlocked: false })
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
  checks.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
const total = page => page.locator('[data-testid="sc-total"]').textContent()
const tick = async (page, k) => { await page.locator(`.sc-prod[data-product="${k}"]`).click(); await page.waitForTimeout(600) }
const picked = page => page.evaluate(() => [...document.querySelectorAll('.sc-prod.is-on')].map(e => e.dataset.product))

try {
  for (const w of [1440, 375]) {
    const st = { profile: SELF, calls: [], paid: false }
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: 'light' })
    await ctx.addInitScript(s => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', 'light') }, sessionOf(SELF))
    const page = await ctx.newPage()
    page.on('pageerror', e => check(`no page error (${w})`, false, String(e)))
    await mock(page, st)
    await page.goto(base + '/agent', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="sc-products"]', { timeout: 30000 })
    await page.waitForTimeout(900)

    check(`three product cards, Leads ticked first (${w})`, JSON.stringify(await picked(page)) === '["leads"]' && (await page.locator('.sc-prod').count()) === 3)
    check(`Leads alone: $2,022 at Growth $100/day (${w})`, (await total(page)) === usd(quote('growth', 10000).total_cents), await total(page))
    check(`Leads shows the plan and the details (${w})`, (await page.locator('#sc-daily').count()) === 1 && (await page.locator('.sc-det, .sc-dcard').count()) > 0)

    await tick(page, 'servicing')
    check(`Leads + Servicing: + $499 (${w})`, (await total(page)) === usd(quote('growth', 10000, ['leads', 'servicing']).total_cents), await total(page))
    check(`Leads + Servicing: two plan lines (${w})`, (await page.locator('[data-testid="sc-summary"] .lk-sum').allTextContents()).some(t => t.startsWith('Servicing, first month')))

    await tick(page, 'reactivation')
    check(`all three = Leads + Servicing today (${w})`, (await total(page)) === usd(quote('growth', 10000, ['leads', 'servicing']).total_cents), await total(page))

    await tick(page, 'leads')
    check(`Servicing + Reactivation: setup + $499 (${w})`, (await total(page)) === usd((P.setupFee + P.servicingOnly) * 100), await total(page))
    check(`no Leads: no slider, no details (${w})`, (await page.locator('#sc-daily').count()) === 0 && (await page.locator('.sc-dcard').count()) === 0)

    await tick(page, 'servicing')
    check(`Reactivation only: $0 today (${w})`, (await total(page)) === '$0', await total(page))
    const btn = (await page.locator('[data-testid="sc-pay"]').textContent()).trim()
    check(`Reactivation only: "Open my portal" (${w})`, btn === 'Open my portal', btn)
    await tick(page, 'reactivation')
    check(`the last product can't be unticked (${w})`, JSON.stringify(await picked(page)) === '["reactivation"]')
    check(`no sideways scroll (${w})`, !(await sideways(page)))
    await page.locator('.sc').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(OUT, `signup-react-${w}.png`) })

    if (w === 1440) {
      await page.locator('[data-testid="sc-pay"]').click()
      await page.waitForTimeout(1500)
      const pay = st.calls.find(c => c.action === 'signup')
      check('Open my portal sends products: ["reactivation"]', JSON.stringify(pay?.products) === '["reactivation"]' && pay?.daily_cents == null, pay)
      // A fresh page: Leads + Servicing for the shot.
      await ctx.close()
      const st2 = { profile: SELF, calls: [], paid: false }
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
      await ctx2.addInitScript(s => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', 'light') }, sessionOf(SELF))
      const p2 = await ctx2.newPage()
      await mock(p2, st2)
      await p2.goto(base + '/agent', { waitUntil: 'domcontentloaded' })
      await p2.waitForSelector('[data-testid="sc-products"]', { timeout: 30000 })
      await p2.waitForTimeout(800)
      await tick(p2, 'servicing')
      await p2.locator('.sc').scrollIntoViewIfNeeded()
      await p2.screenshot({ path: join(OUT, 'signup-leads-servicing-1440.png') })
      await ctx2.close()
    } else {
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
const failed = checks.filter(c => !c.ok).length
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)
