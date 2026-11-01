// Up next empty line and sidebar "submissions" wording: shots and asserts, every Supabase call mocked
// (no real project, no login, no live data; any write fails the run).
//   node scripts/overview-copy-fix-shots.mjs [outDir]       (default qa/overview-copy-fix)
// The empty state: a servicing agent with clients, nothing needing attention, no upcoming calls, weekly cap 16,
// not self-locked, not needsServicing, and the Submit switch OFF (app_settings.submit_live false), which is the
// case that used to say "bookings". The data comes from the mocked HTTP layer (not a pre-seeded query cache), so a
// real fetch cannot overwrite it; each case waits for the sidebar card and the Up next card to render.
// Cases:
//   1440 light / dark  slim card: header "No calls booked", line under it "Submit your next client when they say yes." (the
//                      phrase "No calls booked" shows once, not twice), and "N of 16 submissions"
//   1100 light / dark  wider layout: heading "No calls booked." above "Submit your next client when they say yes."
//   390 light          NO-CHANGE check: a phone gets PhoneShell/PhoneHome, which render neither the Sidebar nor
//                      ComingUpCard, so the new text cannot appear; only loads, no sideways scroll, no old string.
// Exits 1 on any failed assert.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/overview-copy-fix'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const BASE = Date.UTC(2026, 9, 30, 15, 24) // Fri Oct 30, 10:24 AM Central
const iso = ms => new Date(ms).toISOString()
const AT = (daysAgo, hour = 16) => iso(Date.UTC(2026, 9, 30 - daysAgo, hour, 0))
const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard', membership_tier: 'standard',
  has_servicing: true, leads_weekly_cents: 0,
}
const USED = 2
const CAP = 16
// Clients whose calls are all done: none needs attention, none is upcoming.
const POLICIES = [['Marcus', 'Reed', 'Foresters'], ['Dana', 'Whitfield', 'Mutual of Omaha'], ['Teresa', 'Boone', 'Globe Life'], ['Curtis', 'Hale', 'Americo']]
  .map(([f, l, carrier], i) => ({
    id: `p${i + 1}`, agent_id: AGENT, client_first_name: f, client_last_name: l, client_phone: '5551230000', state: 'TX',
    client_timezone: 'America/Chicago', carrier_name: carrier, scheduled_call_at: AT(6 - i, 18), fulfillment_stage: 'Complete',
    fulfillment_completed_at: AT(6 - i, 19), call_live_since: null, last_call_outcome: null, call_attempts: 1, last_call_at: AT(6 - i, 18),
    recovery_step: null, missed_step: null, created_at: AT(20), updated_at: AT(5), details: { current_carrier: carrier },
  }))
const CLIENT_ROWS = [{ stage: 'protected', open_requests: 0 }, { stage: 'protected', open_requests: 0 }, { stage: 'setting_up', open_requests: 0 }, { stage: 'protected', open_requests: 0 }]

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: iso(BASE - 1000 * 864e5) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, writes) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const reply = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/agent_weekly_usage') {
      return json(route, 200, [{ used: USED, weekly_cap: CAP, week_end: iso(Date.UTC(2026, 10, 2, 6, 0)), tier_name: 'Premium', enforced: true }])
    }
    if (path === '/rest/v1/rpc/agent_inbounds') return json(route, 200, [])
    if (path === '/rest/v1/rpc/my_push_settings') return json(route, 200, { push_on: false })
    if (path.startsWith('/rest/v1/rpc/')) {
      if (/^(set_|add_|mark_|create_|update_|delete_)/.test(path.replace('/rest/v1/rpc/', ''))) writes.push(path)
      return json(route, 200, [])
    }
    const table = path.replace('/rest/v1/', '')
    if (method !== 'GET') { writes.push(`${method} ${table}`); return json(route, 200, []) }
    if (table === 'policies') return reply(POLICIES)
    if (table === 'agent_clients') return reply(CLIENT_ROWS)
    if (table === 'servicing_tasks') return reply([])
    if (table === 'membership_tiers') return json(route, 200, [{ key: 'standard', name: 'Standard', monthly_appointments: 12, is_active: true, sort_order: 1 }])
    // The Submit switch is OFF.
    if (table === 'app_settings') return reply([{ id: 1, agent_billing_enforced: false, submit_live: false }])
    return single ? json(route, 200, {}) : json(route, 200, [])
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

const OLD_EMPTY = 'Nothing on the books yet'
const NEW_LINE = 'Submit your next client when they say yes.'
const CASES = [
  { w: 1440, h: 900, theme: 'light', kind: 'slim' },
  { w: 1440, h: 900, theme: 'dark', kind: 'slim' },
  { w: 1100, h: 900, theme: 'light', kind: 'wide' },
  { w: 1100, h: 900, theme: 'dark', kind: 'wide' },
  { w: 390, h: 844, theme: 'light', kind: 'phone' },
]
const results = []
let failed = false

for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, colorScheme: c.theme, ...(c.kind === 'phone' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, c.theme])
  const page = await ctx.newPage()
  const errors = []
  const writes = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.setFixedTime(BASE)
  await mock(page, writes)
  await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
  const failures = []
  const name = `copy-${c.w}-${c.theme}-${c.kind}`
  try {
    if (c.kind === 'phone') {
      await page.waitForSelector('.ph-main, .ph-stack', { timeout: 30000 })
    } else {
      // The mocked clients render (the Up next card says "all caught up" only after the policies load) and the
      // sidebar card shows the mocked usage.
      await page.waitForFunction(() => /all caught up/.test(document.querySelector('[data-ov="attn"]')?.textContent || '')
        && /of 16/.test(document.querySelector('.ov-sb-usage-line')?.textContent || ''), null, { timeout: 30000 })
    }
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(900)
  } catch (e) {
    failures.push(`page did not render the mocked data: ${String(e.message).split('\n')[0]}`)
  }
  const m = await page.evaluate(() => {
    const line = document.querySelector('.ov-sb-usage-line')
    const none = document.querySelector('.ag-caught-none')
    const attn = document.querySelector('[data-ov="attn"]')
    return {
      text: document.body.innerText,
      docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,
      sbLine: line ? { text: line.textContent.replace(/\s+/g, ' ').trim(), scrollWidth: line.scrollWidth, clientWidth: line.clientWidth } : null,
      sbCardText: document.querySelector('.ov-sb-usage')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      slimNone: none ? none.textContent.trim() : null,
      slimHeader: document.querySelector('.ag-caught-h')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      attnText: attn ? attn.innerText.replace(/\s+/g, ' ').trim() : null,
      bookingsInSidebar: /bookings/i.test(document.querySelector('.ov-sb-usage')?.innerText || ''),
    }
  })
  const check = (ok, msg) => { if (!ok) failures.push(msg) }
  check(!m.text.includes(OLD_EMPTY), `old string "${OLD_EMPTY}" is on the page`)
  check(m.docScroll <= m.docClient, `sideways scroll ${m.docScroll}>${m.docClient}`)
  check(errors.length === 0, `page errors: ${errors.join(' | ')}`)
  check(writes.length === 0, `writes: ${writes.join(', ')}`)
  const asserts = []
  if (c.kind === 'phone') {
    check(m.sbLine === null, 'the phone should not render the Sidebar card')
    asserts.push('phone loads', `document scrollWidth ${m.docScroll} <= clientWidth ${m.docClient}`, 'no old "Nothing on the books yet"', 'no Sidebar card (so no "bookings" in one)')
  } else {
    check(!!m.sbLine, 'sidebar usage line missing')
    if (m.sbLine) {
      const ok = m.sbLine.scrollWidth <= m.sbLine.clientWidth
      check(ok, `.ov-sb-usage-line clipped: scrollWidth ${m.sbLine.scrollWidth} > clientWidth ${m.sbLine.clientWidth} ("${m.sbLine.text}")`)
      check(m.sbLine.text === `${USED} of ${CAP} submissions`, `sidebar line reads "${m.sbLine.text}"`)
      asserts.push(`${ok ? 'PASS' : 'FAIL'} .ov-sb-usage-line scrollWidth ${m.sbLine.scrollWidth} <= clientWidth ${m.sbLine.clientWidth} ("${m.sbLine.text}")`)
    }
    check(!m.bookingsInSidebar, 'the sidebar card still says "bookings"')
    if (c.kind === 'slim') {
      check(m.slimNone === NEW_LINE, `slim line reads "${m.slimNone}"`)
      check(m.slimHeader && m.slimHeader.includes('No calls booked'), `slim header reads "${m.slimHeader}"`)
      check((m.attnText.match(/No calls booked/g) || []).length === 1, `"No calls booked" should appear once on the slim card, found ${(m.attnText.match(/No calls booked/g) || []).length}`)
    } else {
      check(m.slimNone === null, 'the slim card showed at the wider layout')
      check(/No calls booked\. Submit your next client when they say yes\./.test(m.attnText), `wider card reads "${m.attnText}"`)
      check((m.attnText.match(/No calls booked/g) || []).length === 1, 'wider layout should say "No calls booked" once')
    }
  }
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: c.kind === 'phone' })
  results.push({ file: `${name}.png`, ...c, sbLine: m.sbLine, sbCardText: m.sbCardText, slimNone: m.slimNone, attnText: m.attnText, docScroll: m.docScroll, docClient: m.docClient, asserts, failures })
  if (failures.length) failed = true
  console.log(`${failures.length ? 'FAIL' : 'ok  '} ${name}.png${failures.length ? `: ${failures.join('; ')}` : ''}`)
  for (const a of asserts) console.log(`      ${a}`)
  await ctx.close()
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
await browser.close()
await server.close()
process.exit(failed ? 1 : 0)
