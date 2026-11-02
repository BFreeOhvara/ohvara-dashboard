// Shots + checks for the regrouped agent sidebar against the PRODUCTION build (dist/).
// Every Supabase call is mocked, so no real project, account or credentials are touched.
//   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mock-anon-key npm run build
//   node qa/sidebar-regroup/shots.mjs
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { preview } from 'vite'
import { chromium } from 'playwright'

const OUT = 'qa/sidebar-regroup'
const SB = 'https://mock.supabase.co'
const PORT = 5700 + Math.floor(Math.random() * 200)
mkdirSync(OUT, { recursive: true })

const USER = '11111111-1111-4111-8111-111111111111'
const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const ahead = h => new Date(Date.now() + h * 3600e3).toISOString()
const profile = role => ({
  id: USER, role, full_name: 'Test ' + role, email: `test.${role}@example.com`, timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard',
  billing_current_period_end: ahead(120),
})
const USAGE = { used: 3, weekly_cap: 7, enforced: true, tier_name: 'Standard', week_start: ago(48), week_end: ahead(120) }
const row = (id, first, last, extra) => ({
  id, agent_id: USER, client_first_name: first, client_last_name: last, client_phone: '+15555550100',
  state: 'TX', client_city: 'Austin', client_timezone: 'America/Chicago', carrier_id: null, carrier_name: 'Mock Life',
  scheduled_call_at: ahead(3), fulfillment_stage: null, assigned_fulfillment_id: null, call_attempts: 0,
  last_call_outcome: null, recovery_step: null, created_at: ago(20), updated_at: ago(2), sms_consent: true,
  agent: { id: USER, full_name: 'Test agent' }, assigned: null, details: { current_carrier: 'Mock Life' }, ...extra,
})
const BOOKINGS = [
  row('p1', 'Alma', 'Reyes', {}),
  row('p2', 'Ben', 'Okafor', { scheduled_call_at: ago(5), last_call_outcome: 'no_answer', call_attempts: 2, recovery_step: 'call_directly', last_call_at: ago(4) }),
]

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'x@example.com', app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, role) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile(role))
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [USAGE])
    if (path.replace('/rest/v1/', '') === 'policies') return rows(BOOKINGS)
    return rows([])
  })
}

const SIZES = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'error' })
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function open(theme, w, role = 'agent') {
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  const page = await ctx.newPage()
  page.on('pageerror', e => check(`no page error (${role} ${w} ${theme})`, false, String(e)))
  await mock(page, role)
  return { ctx, page }
}
const groupsOf = page => page.$$eval('.ov-sb-nav [role=group]', gs => gs.map(g => ({ group: g.getAttribute('aria-label'), items: [...g.querySelectorAll('.ov-sb-label')].map(e => e.textContent.trim()) })))
const scrollInfo = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))

try {
  for (const theme of ['dark', 'light']) {
    // Desktop 1440
    {
      const { ctx, page } = await open(theme, 1440)
      await page.goto(base + '/agent', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.ov-sb-nav', { timeout: 30000 })
      await page.waitForTimeout(1200)
      await page.screenshot({ path: join(OUT, `sidebar-1440-${theme}.png`) })
      const groups = await groupsOf(page)
      check(`agent sidebar groups, 1440 ${theme}`, JSON.stringify(groups) === JSON.stringify([
        { group: 'Today', items: ['Overview', 'Activity'] },
        { group: 'Leads', items: ['Leads', 'Calendar'] },
        { group: 'Servicing', items: ['Clients', 'Submit'] },
        { group: 'Communications', items: ['Messages'] },
        { group: 'Account', items: ['Billing', 'Settings'] },
      ]), groups)
      // Search Go-to list
      const input = page.locator('input[role=combobox]:visible').first()
      await input.click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: join(OUT, `search-goto-1440-${theme}.png`) })
      const goto = await page.$$eval('.ov-gs-page-icon ~ .ov-gs-name', e => e.map(x => x.textContent.trim()))
      check(`search Go-to lists Leads, Clients, Submit (${theme})`, ['Leads', 'Clients', 'Submit'].every(n => goto.includes(n)) && !goto.some(n => /Inbounds|My Pipeline|Book a call/.test(n)), goto)
      // Page titles (h1.ov-hname) and the live line under them (.ov-hline) on the three renamed pages
      for (const [route, want] of [['/agent/leads', 'Leads'], ['/agent/clients', 'Clients'], ['/agent/submit', 'Submit']]) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('h1.ov-hname', { timeout: 30000 }); await page.waitForTimeout(1500)
        const h = (await page.locator('h1.ov-hname').first().textContent()).trim()
        const lines = await page.$$eval('.ov-hline', e => e.map(x => x.textContent.trim()))
        check(`${route} title reads ${want}, 1440 ${theme}`, new URL(page.url()).pathname === route && h === want, { path: new URL(page.url()).pathname, h1: h })
        check(`${route} live line has no Inbounds / My Pipeline / Book a call, 1440 ${theme}`, lines.length > 0 && !lines.some(l => /Inbounds|My Pipeline|Book a call/i.test(l)), lines)
        if (route === '/agent/leads' && theme === 'dark') await page.screenshot({ path: join(OUT, 'leads-route-1440-dark.png') })
      }
      await page.goto(base + '/agent/inbounds?tab=live', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      const u = new URL(page.url())
      check(`/agent/inbounds?tab=live lands on /agent/leads?tab=live (${theme})`, u.pathname === '/agent/leads' && u.search === '?tab=live', u.pathname + u.search)
      await page.goto(base + '/agent/book?change=x', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      const b = new URL(page.url())
      check(`/agent/book?change=x lands on /agent/submit?change=x (${theme})`, b.pathname === '/agent/submit' && b.search === '?change=x', b.pathname + b.search)
      await ctx.close()
    }
    // Phone 390
    {
      const { ctx, page } = await open(theme, 390)
      for (const [route, name] of [['/agent', 'phone-tabs'], ['/agent/more', 'phone-more']]) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.ph-tabbar', { timeout: 30000 })
        await page.waitForTimeout(1200)
        await page.screenshot({ path: join(OUT, `${name}-390-${theme}.png`) })
        const s = await scrollInfo(page)
        check(`no sideways scroll ${route} 390 ${theme}`, s.sw <= s.cw, s)
        if (route === '/agent') {
          const labels = await page.$$eval('.ph-tabbar a, .ph-tabbar button', els => els.map(e => (e.getAttribute('aria-label') || e.textContent).trim()))
          check(`phone tab bar reads Clients and Submit (${theme})`, labels.includes('Clients') && labels.includes('Submit') && !labels.some(l => /My Pipeline|Book a call/.test(l)), labels)
        } else {
          const rows = await page.$$eval('.ph-mrow .ph-mrow-label', e => e.map(x => x.textContent.trim()))
          check(`More list has Leads and Calendar, no Inbounds (${theme})`, rows.includes('Leads') && rows.includes('Calendar') && !rows.includes('Inbounds'), rows)
        }
      }
      // Phone title: at 390 DashboardLayout hands agent pages to PhoneShell, which draws no .ov-hphone-title (that span is in the
      // desktop/tablet header). Leads is a More sub-page, so its title is the PhoneSubHead's h1 (.ph-subhead h1).
      await page.goto(base + '/agent/leads', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.ph-subhead h1', { timeout: 30000 }); await page.waitForTimeout(1200)
      const pt = (await page.locator('.ph-subhead h1').first().textContent()).trim()
      const stale = await page.locator('.ov-hphone-title').count()
      check(`phone title (.ph-subhead h1) reads Leads on /agent/leads, 390 ${theme}`, pt === 'Leads' && new URL(page.url()).pathname === '/agent/leads', { h1: pt, ovHphoneTitleCount: stale })
      await page.screenshot({ path: join(OUT, `phone-leads-390-${theme}.png`) })
      await ctx.close()
    }
  }
  // Admin and Fulfillment sidebars (unchanged from before the regroup)
  for (const [role, route, want] of [
    ['admin', '/admin', [
      { group: 'Today', items: ['Overview'] }, { group: 'Work', items: ['Pipeline', 'Fulfillment', 'Payouts'] },
      { group: 'Communications', items: ['Messages'] }, { group: 'Account', items: ['Users', 'Settings'] }]],
    ['fulfillment', '/fulfillment', [
      { group: 'Today', items: ['Overview'] }, { group: 'Work', items: ['My calls', 'Leads', 'Pipeline', 'My pay'] },
      { group: 'Communications', items: ['Messages'] }, { group: 'Account', items: ['Settings'] }]],
  ]) {
    const { ctx, page } = await open('dark', 1440, role)
    await page.goto(base + route, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ov-sb-nav', { timeout: 30000 }); await page.waitForTimeout(1000)
    await page.screenshot({ path: join(OUT, `sidebar-${role}-1440-dark.png`) })
    const g = await groupsOf(page)
    check(`${role} sidebar unchanged`, JSON.stringify(g) === JSON.stringify(want), g)
    await ctx.close()
  }
} finally {
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(checks, null, 2))
  await browser.close()
  await new Promise(r => server.httpServer.close(r))
}
if (checks.some(c => !c.ok)) process.exitCode = 1
