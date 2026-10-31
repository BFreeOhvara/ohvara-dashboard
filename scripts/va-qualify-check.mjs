// Browser check of the qualify route in qa/capture-views.json on the Vite dev server, every Supabase call mocked.
//   node scripts/va-qualify-check.mjs [outDir]
// Fulfill at 390x844, light and dark: the checklist shows, not an empty or loading state; no sideways scroll; no va_
// call and no database write. Signed out lands on /login; an agent is turned away to /agent. Writes the two PNGs and
// checks.json into outDir (default qa/va-qualify); exits 1 on a failed check.
import process from 'node:process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/va-qualify'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const view = JSON.parse(readFileSync('qa/capture-views.json', 'utf8')).views.find(v => v.id === 'va-qualify')
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const person = (id, role, name) => ({ id, role, full_name: name, email: `${role}@example.com`, timezone: 'America/Chicago', is_active: true, billing_exempt: true, billing_status: 'active' })
const FULFILL = person('22222222-2222-4222-8222-222222222222', 'fulfillment', 'Test Fulfill')
const AGENT = person('33333333-3333-4333-8333-333333333333', 'agent', 'Test Agent')
const sessionFor = p => ({
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: p.id, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`,
  refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString() },
})
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, profile, seen) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    seen.push({ method: req.method(), path })
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile)
    return json(route, 200, single ? {} : [])
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const check = (name, ok, detail) => { results.push({ name, pass: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`) }

async function open(theme, profile, route = view.route) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await ctx.addInitScript(([s, th]) => {
    if (s) localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
    localStorage.setItem('ohvara-theme', th)
  }, [profile ? sessionFor(profile) : null, theme])
  const page = await ctx.newPage()
  const seen = []
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await mock(page, profile, seen)
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
  return { ctx, page, seen, errors }
}

try {
  for (const theme of view.themes) {
    const { ctx, page, seen, errors } = await open(theme, FULFILL)
    const t = `fulfill 390 ${theme}`
    await page.getByRole('region', { name: 'Checklist' }).waitFor({ timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(900)
    const text = await page.evaluate(() => document.body.innerText)
    const m = await page.evaluate(() => ({ path: location.pathname, theme: document.documentElement.getAttribute('data-theme'), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    check(`${t}: landed on the route`, m.path === new URL(view.route, base).pathname, m.path)
    check(`${t}: theme applied`, m.theme === theme, m.theme)
    check(`${t}: expect text "${view.expect}" shows`, text.includes(view.expect))
    check(`${t}: checklist at 2 of 4, outcome locked`, /2 of 4/.test(text) && text.includes('Finish the checklist to pick an outcome.'))
    check(`${t}: not the empty, loading or error state`, !/Pick a lead to start|Nothing to work right now|couldn.t load|Your hold on this lead ended/i.test(text) && (await page.locator('[aria-busy="true"]').count()) === 0)
    check(`${t}: no sideways scroll`, m.scrollWidth === m.clientWidth, `${m.scrollWidth}/${m.clientWidth}`)
    check(`${t}: no page errors`, errors.length === 0, errors)
    const vaCalls = seen.filter(r => /\/(va_[a-z_]+|policies)$/.test(r.path))
    const writes = seen.filter(r => r.method !== 'GET' && !r.path.startsWith('/rest/v1/rpc/') && !r.path.startsWith('/functions/v1/'))
    check(`${t}: no va_ call or policies read`, vaCalls.length === 0, vaCalls)
    check(`${t}: no table write`, writes.length === 0, writes)
    results.push({ name: `${t}: every other request (the signed-in page chrome)`, pass: true, detail: [...new Set(seen.map(r => `${r.method} ${r.path}`))] })
    await page.screenshot({ path: join(OUT, `fulfillment-leads-390-${theme}.png`), fullPage: true })
    await ctx.close()
  }

  {
    // The way a VA works: release, tap a lead in the queue, book. All of it stays in memory on the sample.
    const { ctx, page, seen } = await open('light', FULFILL)
    await page.getByRole('button', { name: 'Release' }).click()
    await page.getByRole('button', { name: /Riley Sample/ }).click()
    await page.getByRole('region', { name: 'Checklist' }).waitFor({ timeout: 30000 })
    check('sample: tapping a lead in the queue opens the checklist', (await page.getByText('Riley Sample').count()) > 0)
    await page.getByRole('group', { name: 'Question type' }).getByRole('button', { name: 'Claim' }).click()
    await page.getByRole('combobox', { name: 'Carrier' }).selectOption('Sample Life')
    await page.getByRole('group', { name: 'Urgency' }).getByRole('button', { name: 'Today' }).click()
    await page.getByRole('radio', { name: /Book a call/ }).click()
    await page.getByRole('button', { name: /Avery Placeholder/ }).click()
    await page.locator('.va-slot:not([disabled])').first().click()
    await page.locator('.va-foot .va-btn').click()
    await page.getByText(/^Booked with Avery Placeholder/).waitFor({ timeout: 10000 })
    const touched = seen.filter(r => /\/(va_[a-z_]+|policies)$/.test(r.path) || (r.method !== 'GET' && !/\/rpc\/(get_my_profile|my_standing_threads)$/.test(r.path)))
    check('sample book flow: finishes with no va_ call, policies request or write', touched.length === 0, touched)
    await ctx.close()
  }

  {
    // Without the flag the page uses the real path and shows none of the sample.
    const { ctx, page, seen } = await open('light', FULFILL, new URL(view.route, base).pathname)
    await page.getByText('Nothing to work right now').waitFor({ timeout: 30000 })
    check('no flag: the page calls va_queue', seen.some(r => r.path === '/rest/v1/rpc/va_queue'))
    check('no flag: no sample lead shows', (await page.getByText('Jordan Placeholder').count()) === 0)
    await ctx.close()
  }

  {
    const { ctx, page } = await open('light', null)
    await page.waitForURL(u => u.pathname === '/login', { timeout: 30000 }).catch(() => {})
    check('signed out: lands on /login', new URL(page.url()).pathname === '/login', page.url())
    check('signed out: no checklist', (await page.getByText(view.expect).count()) === 0)
    await ctx.close()
  }
  {
    const { ctx, page } = await open('light', AGENT)
    await page.waitForURL(u => !u.pathname.startsWith('/fulfillment'), { timeout: 30000 }).catch(() => {})
    check('wrong role (agent): turned away to /agent', new URL(page.url()).pathname.startsWith('/agent'), page.url())
    check('wrong role (agent): no checklist', (await page.getByText(view.expect).count()) === 0)
    await ctx.close()
  }
} finally {
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 2))
  await browser.close()
  await server.close()
}
if (results.some(r => !r.pass)) process.exit(1)
