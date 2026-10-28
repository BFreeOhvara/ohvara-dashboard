// Screenshots /fulfillment/leads (the VA desk) as a mocked "Test Fulfill", with
// every Supabase call answered locally by Playwright routes. No real project,
// account or credential is touched. Needs the VA desk sources on the branch
// (atlas/eac4b2e0 until it merges).
//   node qa/va-desk/shots.mjs [outDir]        (run from the repo root)
// Writes PNGs plus results.json into outDir (default qa/va-desk/out).
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/va-desk/out'
const MOCKUP = process.env.MOCKUP_FILE || 'C:/Users/freem/obsidian-mind/ohvara/mockups/build-the-va-desk-queue-claim-4-item-che.html'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5700 + Math.floor(Math.random() * 200)
mkdirSync(OUT, { recursive: true })

const USER = '22222222-2222-4222-8222-222222222222'
const ago = m => new Date(Date.now() - m * 60e3).toISOString()
const ahead = m => new Date(Date.now() + m * 60e3).toISOString()
const PROFILE = {
  id: USER, role: 'fulfillment', full_name: 'Test Fulfill', email: 'test.fulfill@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: true, billing_status: 'active', fulfillment_access: true,
}
const QUEUE = [
  { lead_id: 'c1', lead_type: 'policy_help', contact_name: 'Riley Sample', phone: '+15555550101', city: 'Columbus', state: 'OH', va_checklist: null, bucket: 'callback_due', va_attempts: 1, va_callback_at: ago(20), created_at: ago(1500) },
  { lead_id: 'c2', lead_type: 'mortgage_protection', contact_name: 'Casey Demo', phone: '+15555550102', city: 'Austin', state: 'TX', va_checklist: null, bucket: 'callback_due', va_attempts: 1, va_callback_at: ago(5), created_at: ago(2900) },
  { lead_id: 'n1', lead_type: 'policy_help', contact_name: 'Jordan Placeholder', phone: '+15555550103', city: 'Dallas', state: 'TX', va_checklist: null, bucket: 'new', va_attempts: 0, va_callback_at: null, created_at: ago(12) },
  { lead_id: 'n2', lead_type: 'mortgage_protection', contact_name: 'Maximiliana-Alexandrina Featherstonehaugh-Worthington', phone: '+15555550104', city: 'Miami', state: 'FL', va_checklist: null, bucket: 'new', va_attempts: 0, va_callback_at: null, created_at: ago(40) },
  { lead_id: 'n3', lead_type: 'mortgage_protection', contact_name: 'Sam Example', phone: '+15555550105', city: 'Atlanta', state: 'GA', va_checklist: null, bucket: 'new', va_attempts: 0, va_callback_at: null, created_at: ago(65) },
  { lead_id: 'n4', lead_type: 'policy_help', contact_name: '', phone: '+15555550106', city: 'Toledo', state: 'OH', va_checklist: null, bucket: 'new', va_attempts: 0, va_callback_at: null, created_at: ago(180) },
  { lead_id: 'r1', lead_type: 'policy_help', contact_name: 'Morgan Test', phone: '+15555550107', city: 'Tampa', state: 'FL', va_checklist: null, bucket: 'not_reached', va_attempts: 1, va_callback_at: null, created_at: ago(300) },
  { lead_id: 'r2', lead_type: 'mortgage_protection', contact_name: 'Avery Stand-in', phone: '+15555550108', city: 'Houston', state: 'TX', va_checklist: null, bucket: 'not_reached', va_attempts: 2, va_callback_at: null, created_at: ago(1700) },
]
const ROSTER = [
  { id: 'a1', full_name: 'Nate Example' }, { id: 'a2', full_name: 'Jordan Sample' }, { id: 'a3', full_name: 'Rego Placeholder' },
]
const WK = { open: '08:00', close: '17:00' }
const CARRIERS = ['Carrier A', 'Carrier B', 'Carrier C'].map((name, i) => ({
  id: `car${i}`, name, aliases: [],
  hours: { mon: WK, tue: WK, wed: WK, thu: WK, fri: WK, sat: null, sun: null },
  hours_tz: 'America/Chicago', hours_status: 'verified', hours_checked_at: new Date().toISOString(),
}))

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// opts: { holdMin, claimError, queue, queueFail, outcomeCode }
async function mock(page, opts, calls) {
  const state = { claimed: null, expires: null }
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    calls.push(`${req.method()} ${path}`)
    if (path.startsWith('/functions/v1/')) return json(route, 200, {})
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/va_queue') {
      if (opts.queueFail) return json(route, 500, { code: 'XX000', message: 'mock failure' })
      const q = (opts.queue || QUEUE).map(r => (r.lead_id === state.claimed ? { ...r, claimed_by_me: true, claim_expires_at: state.expires } : { ...r, claimed_by_me: false, claim_expires_at: null }))
      return json(route, 200, q)
    }
    if (path === '/rest/v1/rpc/va_claim') {
      if (opts.claimError) return json(route, 400, { code: opts.claimError, message: 'mock' })
      state.claimed = JSON.parse(req.postData() || '{}').p_lead
      state.expires = ahead(opts.holdMin ?? 14.55)
      return json(route, 200, state.expires)
    }
    if (path === '/rest/v1/rpc/va_release') { state.claimed = null; return route.fulfill({ status: 204, headers: CORS }) }
    if (path === '/rest/v1/rpc/va_set_lead_outcome') {
      calls.push(`BODY ${req.postData()}`)
      if (opts.outcomeCode) return json(route, 400, { code: opts.outcomeCode, message: 'mock' })
      state.claimed = null
      return route.fulfill({ status: 204, headers: CORS })
    }
    if (path === '/rest/v1/rpc/va_agent_roster') return json(route, 200, ROSTER)
    const table = path.replace('/rest/v1/', '')
    if (table === 'policies' && req.method() === 'POST') { calls.push('BOOK-INSERT'); return json(route, 201, single ? { id: 'pol-1' } : [{ id: 'pol-1' }]) }
    if (table === 'carriers') return rows(CARRIERS)
    return rows([])
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
// The mockup-approved logistics line and the "Coverage question" label are the only allowed hits.
const BANNED = /price|premium|quote|cost|\$\s?\d|benefit|coverage/i
const ALLOWED = ['Logistics only. Any coverage question goes to a licensed agent.', 'Coverage question']

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []

async function open(theme, w, opts = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[w], colorScheme: theme, ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  const page = await ctx.newPage()
  const errors = []; const calls = []
  page.on('pageerror', e => errors.push(String(e)))
  // The mock host has no realtime socket and no push settings: both are noise, not the desk.
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket connection|"push","settings"/.test(m.text())) errors.push(m.text()) })
  await mock(page, opts, calls)
  await page.goto(`${base}/fulfillment/leads`, { waitUntil: 'domcontentloaded' })
  return { ctx, page, errors, calls }
}

const metrics = page => page.evaluate(() => {
  const de = document.documentElement
  return {
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
    maxRight: Math.round(Math.max(...[...document.body.querySelectorAll('*')].map(e => e.getBoundingClientRect().right))),
    theme: de.getAttribute('data-theme'),
    text: document.body.innerText,
  }
})

async function snap(name, c, extra = {}) {
  const { page, errors, calls } = c
  await page.waitForTimeout(700)
  const m = await metrics(page)
  const bannedLines = m.text.split('\n').filter(l => BANNED.test(l) && !ALLOWED.includes(l.trim()))
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
  results.push({ name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, sideways: m.scrollWidth > m.clientWidth, theme: m.theme, bannedLines, pageErrors: [...errors], ...extra, rpc: [...new Set(calls.filter(x => x.includes('/rpc/')))] })
  console.log(name.padEnd(34), `scroll=${m.scrollWidth}/${m.clientWidth}`, `banned=${JSON.stringify(bannedLines)}`, `err=${errors.length}`)
}

const waitQueue = page => page.waitForSelector('.va-qrow', { timeout: 30000 })
const group = (p, g, label) => p.getByRole('group', { name: g, exact: true }).getByRole('button', { name: label, exact: true }).click()
const checklist = p => p.locator('.va-prog').innerText()
const locks = p => p.locator('.va-pick').evaluateAll(b => b.map(x => x.disabled))

try {
  // 1) The six required sizes: the queue, then the claimed view.
  for (const w of [1920, 1440, 390]) for (const theme of ['light', 'dark']) {
    const c = await open(theme, w)
    await waitQueue(c.page)
    await snap(`queue-${w}-${theme}`, c)
    await c.page.getByRole('button', { name: /Jordan Placeholder/ }).click()
    await c.page.waitForSelector('.ov-hero', { timeout: 15000 })
    await snap(`claimed-${w}-${theme}`, c, { checklist: await checklist(c.page) })
    await c.ctx.close()
  }

  // 2) States at 1440 light and 390 dark: 3/4 locked, 4/4 unlocked, Book, Transfer, Not reached.
  for (const [w, theme] of [[1440, 'light'], [390, 'dark']]) {
    const c = await open(theme, w)
    const p = c.page
    await waitQueue(p)
    await p.getByRole('button', { name: /Jordan Placeholder/ }).click()
    await p.waitForSelector('.ov-hero')
    await group(p, 'Question type', 'Claim')
    await p.locator('select[aria-label="Carrier"]').selectOption('Carrier A')
    await group(p, 'Urgency', 'Today')
    await p.locator('select[aria-label="State"]').selectOption('') // State is pre-filled from the lead; clear it to show 3 of 4
    await snap(`state-3of4-locked-${w}-${theme}`, c, { checklist: await checklist(p), outcomesDisabled: await locks(p) })
    await p.locator('select[aria-label="State"]').selectOption('TX')
    await snap(`state-4of4-unlocked-${w}-${theme}`, c, { checklist: await checklist(p), outcomesDisabled: await locks(p) })
    await p.getByRole('radio', { name: /Book a call/ }).click()
    await p.getByRole('button', { name: /Nate Example/ }).click()
    await p.waitForSelector('.va-day', { timeout: 15000 })
    await p.waitForSelector('.va-slot:not([disabled])', { timeout: 15000 })
    await p.locator('.va-slot:not([disabled])').first().click()
    await snap(`state-book-${w}-${theme}`, c, { bookButton: await p.locator('.va-foot .va-btn').innerText() })
    await p.locator('.va-foot .va-btn').click()
    await p.waitForSelector('.va-done', { timeout: 15000 })
    await snap(`state-booked-${w}-${theme}`, c, { bookCalls: c.calls.filter(x => x.startsWith('BODY') || x === 'BOOK-INSERT') })
    // Back to the queue, take the lead again for Transfer and Not reached
    await p.getByRole('button', { name: 'Back to queue' }).click()
    await p.waitForSelector('.va-qrow')
    await p.getByRole('button', { name: /Jordan Placeholder/ }).click()
    await p.waitForSelector('.ov-hero')
    await group(p, 'Question type', 'Claim'); await group(p, 'Urgency', 'Today')
    await p.locator('select[aria-label="Carrier"]').selectOption('Carrier A')
    await p.getByRole('radio', { name: /Record a transfer/ }).click()
    await p.getByRole('button', { name: /Jordan Sample/ }).click()
    await snap(`state-transfer-${w}-${theme}`, c)
    await p.getByRole('radio', { name: /Not reached/ }).click()
    await snap(`state-callback-${w}-${theme}`, c)
    await p.getByRole('button', { name: 'Save and go back to the queue' }).click()
    await p.waitForSelector('.va-done', { timeout: 15000 })
    await snap(`state-done-${w}-${theme}`, c)
    await c.ctx.close()
  }

  // 3) A transfer's saved body: the agent and the checklist, nothing about money
  {
    const c = await open('light', 1440)
    const p = c.page
    await waitQueue(p)
    await p.getByRole('button', { name: /Jordan Placeholder/ }).click()
    await p.waitForSelector('.ov-hero')
    await group(p, 'Question type', 'Claim'); await group(p, 'Urgency', 'Today')
    await p.locator('select[aria-label="Carrier"]').selectOption('Carrier A')
    await p.getByRole('radio', { name: /Record a transfer/ }).click()
    await p.getByRole('button', { name: /Jordan Sample/ }).click()
    await p.getByRole('button', { name: /Save transfer to/ }).click()
    await p.waitForSelector('.va-done')
    results.push({ name: 'transfer-body', body: c.calls.filter(x => x.startsWith('BODY')) })
    await c.ctx.close()
  }

  // 4) Claim expired: the VA is returned to the queue
  for (const [w, theme] of [[1440, 'light'], [390, 'dark']]) {
    const c = await open(theme, w, { holdMin: 0.06 })
    const p = c.page
    await waitQueue(p)
    await p.getByRole('button', { name: /Jordan Placeholder/ }).click()
    await p.waitForSelector('.ov-hero')
    await p.getByText('Your hold on this lead ended').waitFor({ timeout: 15000 })
    await snap(`state-hold-ended-${w}-${theme}`, c)
    await p.getByRole('button', { name: 'Back to queue' }).click()
    await p.waitForSelector('.va-qrow')
    await snap(`state-back-in-queue-${w}-${theme}`, c, { heroGone: (await p.locator('.ov-hero').count()) === 0, jordanRowEnabled: await p.getByRole('button', { name: /Jordan Placeholder/ }).isEnabled() })
    await c.ctx.close()
  }

  // 5) Lost race, queue error, empty queue
  {
    const c = await open('light', 1440, { claimError: '55006' })
    await waitQueue(c.page)
    await c.page.getByRole('button', { name: /Jordan Placeholder/ }).click()
    await c.page.getByText('Another VA already has this lead').waitFor()
    await snap('state-lost-race-1440-light', c)
    await c.ctx.close()
    const e = await open('dark', 390, { queueFail: true })
    await e.page.getByText("We couldn't load the queue").waitFor({ timeout: 30000 })
    await snap('state-queue-error-390-dark', e)
    await e.ctx.close()
    const m = await open('light', 390, { queue: [] })
    await m.page.getByText('Nothing to work right now').waitFor({ timeout: 30000 })
    await snap('state-queue-empty-390-light', m)
    await m.ctx.close()
  }

  // 6) The approved mockup, both theme frames, at the same widths
  for (const w of [1920, 1440, 390]) {
    const ctx = await browser.newContext({ viewport: SIZES[w], ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
    const page = await ctx.newPage()
    await page.goto(`file:///${MOCKUP}`, { waitUntil: 'load' })
    await page.waitForTimeout(800)
    for (const th of ['dark', 'light']) {
      await page.locator(`#f-${th}`).screenshot({ path: join(OUT, `mockup-${w}-${th}.png`) })
    }
    await ctx.close()
  }
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  await server.close()
}
