// Screenshots the VA desk (/fulfillment/leads) logged in as "Test Fulfill", with every Supabase call
// mocked (migration 175 is not applied anywhere), so no real project, account or credential is touched.
//   node scripts/va-desk-shots.mjs [outDir]
// Writes PNGs plus measurements.json into outDir (default qa/va-desk).
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/va-desk'
const MOCKUP = process.env.MOCKUP_FILE || 'C:/Users/freem/obsidian-mind/ohvara/mockups/build-the-va-desk-queue-claim-4-item-che.html'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const USER = '22222222-2222-4222-8222-222222222222'
const mins = m => new Date(Date.now() + m * 60e3).toISOString()
const FULFILL = { id: USER, role: 'fulfillment', full_name: 'Test Fulfill', email: 'test.fulfill@example.com', timezone: 'America/Chicago', is_active: true, billing_exempt: true, billing_status: 'active' }
const AGENT = { ...FULFILL, id: '33333333-3333-4333-8333-333333333333', role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', billing_exempt: false }
const ROSTER = [
  { id: 'a1111111-1111-4111-8111-111111111111', full_name: 'Dana Whitfield' },
  { id: 'a2222222-2222-4222-8222-222222222222', full_name: 'Marcus Ortega' },
  { id: 'a3333333-3333-4333-8333-333333333333', full_name: 'Priya Raman' },
]
const hrs = { open: '08:00', close: '20:00' }
const CARRIERS = [
  ['Mutual of Omaha', 1], ['Lincoln Heritage', 2], ['Transamerica', 3], ['Globe Life', 4],
].map(([name, i]) => ({
  id: `c000000${i}-0000-4000-8000-000000000000`, name, aliases: [], sort_rank: i, is_active: true,
  hours: { mon: hrs, tue: hrs, wed: hrs, thu: hrs, fri: hrs, sat: hrs, sun: hrs }, hours_tz: 'America/New_York',
  hours_checked_at: new Date().toISOString(), hours_status: 'verified',
}))

const lead = (n, o) => ({
  lead_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, lead_type: 'policy_help', lead_source: 'google_ads',
  phone: `(713) 555-01${String(n).padStart(2, '0')}`, qualifier_answers: null, va_checklist: null, va_attempts: 0,
  va_callback_at: null, claimed_by_me: false, claim_expires_at: null, ...o,
})
const QUEUE = [
  lead(1, { contact_name: 'Rhonda Pickett', city: 'Houston', state: 'TX', bucket: 'callback_due', va_attempts: 1, va_callback_at: mins(-25), created_at: mins(-60 * 5) }),
  lead(2, { contact_name: 'Walter Banks', city: 'Tampa', state: 'FL', bucket: 'callback_due', va_attempts: 2, va_callback_at: mins(-8), created_at: mins(-60 * 26) }),
  lead(3, { contact_name: 'Alicia Moreno', city: 'Phoenix', state: 'AZ', bucket: 'new', created_at: mins(-6), lead_type: 'mortgage_protection' }),
  lead(4, { contact_name: 'Darnell Hughes', city: 'Atlanta', state: 'GA', bucket: 'new', created_at: mins(-42) }),
  lead(5, { contact_name: 'Susan Kowalski', city: 'Columbus', state: 'OH', bucket: 'new', created_at: mins(-60 * 3) }),
  lead(6, { contact_name: 'Terrence Boyd', city: 'Memphis', state: 'TN', bucket: 'not_reached', va_attempts: 2, created_at: mins(-60 * 9) }),
  lead(7, { contact_name: 'Joyce Lindqvist', city: 'Dallas', state: 'TX', bucket: 'not_reached', va_attempts: 1, created_at: mins(-60 * 30) }),
]
const HELD_ID = QUEUE[3].lead_id // Darnell Hughes
const CHECK3 = { question_type: 'Billing or payment', state: 'GA', urgency: 'This week' }
const CHECK4 = { ...CHECK3, carrier: 'Mutual of Omaha' }

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const now = Math.floor(Date.now() / 1000)
const sessionFor = p => ({
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: p.id, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`,
  refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, app_metadata: {}, user_metadata: {}, created_at: mins(-1000) },
})

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// held: null | { checklist }. A held lead comes back from va_queue as claimed_by_me, the way migration 175 returns it.
async function mock(page, profile, held, seen) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    const name = path.replace('/rest/v1/rpc/', '').replace('/rest/v1/', '')
    seen.push(name)
    if (name === 'get_my_profile') return json(route, 200, profile)
    if (name === 'va_queue') {
      return json(route, 200, QUEUE.map(r => (held && r.lead_id === HELD_ID
        ? { ...r, claimed_by_me: true, claim_expires_at: mins(11.5), va_checklist: held.checklist } : r)))
    }
    if (name === 'va_agent_roster') return json(route, 200, ROSTER)
    if (name === 'va_claim') return json(route, 200, mins(15))
    if (name === 'va_release' || name === 'va_set_lead_outcome') return json(route, 200, null)
    if (name === 'carriers') return rows(CARRIERS)
    return rows([])
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }

const measure = page => page.evaluate(() => {
  const de = document.documentElement
  const heads = [...document.querySelectorAll('.va-qsec')].map(s => ({
    label: s.getAttribute('aria-label'), cls: s.className.split(' ').filter(c => c.startsWith('ov-')).join(' '),
    names: [...s.querySelectorAll('.nm')].map(n => n.textContent),
    dueColor: s.querySelector('.due') ? getComputedStyle(s.querySelector('.due')).color : null,
    borderColor: getComputedStyle(s).borderTopColor,
  }))
  const qs = (sel) => document.querySelector(sel)
  return {
    url: location.pathname, title: qs('h1')?.textContent ?? null,
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
    maxRight: Math.round(Math.max(...[...document.body.querySelectorAll('*')].map(e => e.getBoundingClientRect().right)) * 100) / 100,
    theme: de.getAttribute('data-theme'),
    counts: [...document.querySelectorAll('.va-count')].map(c => c.innerText.replace(/\n/g, ' ')),
    sections: heads,
    sidebarLeads: [...document.querySelectorAll('a[href="/fulfillment/leads"]')].map(a => a.textContent.trim()),
    prog: qs('.va-prog')?.textContent ?? null,
    outcomeLocked: !!qs('.va-lock'),
    bookOpen: document.querySelector('[role="radio"][aria-checked="true"]')?.textContent ?? null,
    heldName: qs('.va-hero-name')?.textContent ?? null,
  }
})

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []

async function run(scName, theme, w, { path = '/fulfillment/leads', profile = FULFILL, held = null, steps, ready }) {
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [sessionFor(profile), theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  const seen = []
  await mock(page, profile, held, seen)
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
  await ready(page)
  if (steps) await steps(page)
  await page.waitForTimeout(700)
  const m = await measure(page)
  const file = `app-${scName}-${w}-${theme}.png`
  await page.screenshot({ path: join(OUT, file), fullPage: true })
  results.push({ file, scenario: scName, width: w, theme, requests: [...new Set(seen)], pageErrors: errors, ...m })
  await ctx.close()
}

const queueReady = p => p.getByRole('region', { name: 'Callback due' }).waitFor({ timeout: 30000 })
const heldReady = p => p.getByRole('region', { name: "Lead you're holding" }).waitFor({ timeout: 30000 })
const openBook = async p => {
  await p.getByRole('radio', { name: /Book a call/ }).click()
  await p.getByRole('button', { name: /Dana Whitfield/ }).click()
  await p.waitForTimeout(500)
}

try {
  for (const w of [1920, 1440, 390]) {
    for (const theme of ['light', 'dark']) {
      await run('queue', theme, w, { ready: queueReady })
      await run('held-3of4', theme, w, { held: { checklist: CHECK3 }, ready: heldReady })
      await run('held-4of4-book', theme, w, { held: { checklist: CHECK4 }, ready: heldReady, steps: openBook })
    }
  }
  // Phone More page row (390) and the error state when the 175 functions are missing
  await run('more', 'light', 390, { path: '/fulfillment/more', ready: p => p.getByText('Leads', { exact: true }).first().waitFor({ timeout: 30000 }) })
  // A non-fulfillment login must leave /fulfillment/leads
  await run('agent-redirect', 'light', 1440, {
    profile: AGENT, ready: p => p.waitForURL(u => !u.pathname.startsWith('/fulfillment'), { timeout: 30000 }),
  })
} finally {
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(results, null, 2))
  await browser.close()
  await server.close()
}
console.log(results.map(r => `${r.file}  ${r.url}  scroll ${r.scrollWidth}/${r.clientWidth}  errors ${r.pageErrors.length}`).join('\n'))
