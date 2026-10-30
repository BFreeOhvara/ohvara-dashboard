// Screenshots the regrouped agent sidebar / renamed pages with every Supabase call
// mocked, so no real project, account or credentials are touched.
//   node scripts/nav-regroup-shots.mjs [outDir]
// Writes PNGs plus checks.json into outDir (default qa/nav-regroup).
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/nav-regroup'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const AGENT = '11111111-1111-4111-8111-111111111111'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const ahead = h => new Date(Date.now() + h * 3600e3).toISOString()
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard',
  billing_current_period_end: ahead(120),
}
const USAGE = { used: 3, weekly_cap: 7, enforced: true, tier_name: 'Standard', week_start: ago(48), week_end: ahead(120) }
const row = (id, first, last, extra) => ({
  id, agent_id: AGENT, client_first_name: first, client_last_name: last, client_phone: '+15555550100',
  state: 'TX', client_city: 'Austin', client_timezone: 'America/Chicago', carrier_id: null, carrier_name: 'Mock Life',
  scheduled_call_at: ahead(3), fulfillment_stage: null, assigned_fulfillment_id: null, call_attempts: 0,
  last_call_outcome: null, recovery_step: null, created_at: ago(20), updated_at: ago(2), sms_consent: true,
  agent: { id: AGENT, full_name: 'Test Agent' }, assigned: null, details: { current_carrier: 'Mock Life' }, ...extra,
})
const BOOKINGS = [
  row('p1', 'Alma', 'Reyes', {}),
  row('p2', 'Ben', 'Okafor', { scheduled_call_at: ago(5), last_call_outcome: 'no_answer', call_attempts: 2, recovery_step: 'call_directly', last_call_at: ago(4) }),
  row('p3', 'Carla', 'Mendez', { scheduled_call_at: ago(30), fulfillment_stage: 'Complete', fulfillment_completed_at: ago(26), cancellation_confirmation: 'MOCK123' }),
]

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [USAGE])
    const table = path.replace('/rest/v1/', '')
    if (table === 'policies') return rows(BOOKINGS)
    return rows([])
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function open(theme, w) {
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  const page = await ctx.newPage()
  page.on('pageerror', e => check(`no page error (${w} ${theme})`, false, String(e)))
  await mock(page)
  return { ctx, page }
}

const ROUTES = { '/agent': 'overview', '/agent/leads': 'leads', '/agent/calendar': 'calendar', '/agent/clients': 'clients', '/agent/book': 'book', '/agent/more': 'more' }
const scrollInfo = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))

try {
  for (const theme of ['dark', 'light']) {
    for (const w of [1920, 1440, 390]) {
      const { ctx, page } = await open(theme, w)
      for (const [route, name] of Object.entries(ROUTES)) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector(w !== 390 ? '.ov-sb-nav' : '.ph-tabbar, .ph-book', { timeout: 30000 })
        await page.waitForTimeout(1200)
        await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`), fullPage: false })
        // /agent/more is the phone's page: a desktop visit goes home by design.
        if (!(route === '/agent/more' && w === 1440)) check(`${route} stays put (${w} ${theme})`, new URL(page.url()).pathname === route, new URL(page.url()).pathname)
        if (w === 390 && route === '/agent/more') {
          const rows = await page.$$eval('main button, main a', els => els.map(e => e.textContent.trim()).filter(Boolean))
          check(`More page has Leads and Calendar rows, no Inbounds row (${theme})`, rows.some(t => t.startsWith('Leads')) && rows.some(t => t.startsWith('Calendar')) && !rows.some(t => /^Inbounds/.test(t)), rows)
          for (const [label, path] of [['Leads', '/agent/leads'], ['Calendar', '/agent/calendar']]) {
            await page.locator('main button', { hasText: new RegExp('^' + label) }).first().click()
            await page.waitForTimeout(800)
            check(`More > ${label} lands on ${path} (${theme})`, new URL(page.url()).pathname === path, new URL(page.url()).pathname)
            await page.goto(base + route, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('.ph-tabbar, .ph-book', { timeout: 30000 })
          }
        }
        if (w === 390) {
          const s = await scrollInfo(page)
          check(`no sideways scroll ${route} ${w} ${theme}`, s.sw <= s.cw, s)
        }
        if (w !== 390 && route === '/agent' && theme === 'dark') {
          const groups = await page.$$eval('.ov-sb-nav [role=group]', gs => gs.map(g => ({ group: g.getAttribute('aria-label'), items: [...g.querySelectorAll('.ov-sb-label')].map(e => e.textContent.trim()) })))
          check(`sidebar has the five groups, Leads between Today and Servicing (${w})`, JSON.stringify(groups) === JSON.stringify([
            { group: 'Today', items: ['Overview', 'Activity'] },
            { group: 'Leads', items: ['Leads', 'Calendar'] },
            { group: 'Servicing', items: ['Clients', 'Submit'] },
            { group: 'Communications', items: ['Messages'] },
            { group: 'Account', items: ['Billing', 'Settings'] },
          ]), groups)
          const badge = await page.$$eval('.ov-sb-badge.is-amber', e => e.map(x => x.textContent.trim()))
          check('Clients amber needs-attention badge shows', badge.length === 1 && badge[0] === '1', badge)
        }
        if (w !== 390 && theme === 'dark' && ['/agent/clients', '/agent/book', '/agent/leads', '/agent/calendar'].includes(route)) {
          const h = (await page.locator('h1.ov-hname').first().textContent()).trim()
          check(`header on ${route} (${w})`, h === { '/agent/clients': 'Clients', '/agent/book': 'Submit', '/agent/leads': 'Leads', '/agent/calendar': 'Calendar' }[route], h)
        }
        if (w === 390 && route === '/agent/more') {
          const rows = await page.$$eval('.ph-mrow .ph-mrow-label', e => e.map(x => x.textContent.trim()))
          check(`More page has Leads and Calendar, no Inbounds (${theme})`, rows.includes('Leads') && rows.includes('Calendar') && !rows.includes('Inbounds'), rows)
        }
        if (w === 390 && (route === '/agent/leads' || route === '/agent/calendar')) {
          const t = (await page.locator('.ph-h1, h1').first().textContent()).trim()
          check(`phone title on ${route} (${theme})`, t === (route === '/agent/leads' ? 'Leads' : 'Calendar'), t)
        }
        if (w === 390 && theme === 'dark' && route === '/agent') {
          const labels = await page.$$eval('.ph-tabbar a, .ph-tabbar button', els => els.map(e => e.getAttribute('aria-label')))
          check('phone bar + is labelled Submit', labels.includes('Submit') && !labels.some(l => /Book a call/.test(l || '')), labels)
        }
      }
      if (w === 1440 && theme === 'dark') {
        // Go-to search
        await page.goto(base + '/agent', { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.ov-sb-nav')
        const input = page.locator('input[role=combobox]:visible').first()
        const pagesFor = async q => {
          await input.fill(q)
          await page.waitForTimeout(500)
          return page.$$eval('.ov-gs-page-icon ~ .ov-gs-name', e => e.map(x => x.textContent.trim()))
        }
        for (const [q, want] of [['leads', 'Leads'], ['calendar', 'Calendar'], ['clients', 'Clients'], ['submit', 'Submit']]) { const r = await pagesFor(q); check(`Go-to '${q}' finds the page`, r.includes(want), r) }
        await input.fill('alma'); await page.waitForTimeout(500)
        const foot = await page.$$eval('.ov-gs-foot span', e => e.map(x => x.textContent.trim()))
        check("footer hint reads 'Enter to open in Clients' (client row active)", foot.some(t => t === 'Enter to open in Clients'), foot)
        await page.screenshot({ path: join(OUT, 'goto-client-1440-dark.png') })
        // Redirects
        for (const [from, to] of [['/agent/inbounds', '/agent/leads'], ['/agent/inbounds/abc', '/agent/leads/abc'], ['/agent/policies', '/agent/clients'], ['/agent/submissions', '/agent/book']]) {
          await page.goto(base + from, { waitUntil: 'domcontentloaded' })
          await page.waitForTimeout(1500)
          check(`${from} lands on ${to}`, new URL(page.url()).pathname === to, new URL(page.url()).pathname)
        }
      }
      await ctx.close()
    }
  }
} finally {
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(checks, null, 2))
  await browser.close()
  await server.close()
}
if (checks.some(c => !c.ok)) process.exitCode = 1
