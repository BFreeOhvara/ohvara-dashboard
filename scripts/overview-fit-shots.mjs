// Overview fits one screen: shots and a MEASURED fit check, with every Supabase call mocked
// (no real project, no login, no live data).
//   node scripts/overview-fit-shots.mjs [outDir] [--before]
// Writes PNGs plus measurements.json into outDir (default qa/overview-fit/after, or .../before with --before).
// After mode asserts and exits 1 on any failure; --before only records (the old page is expected to fail).
//
// The check is on bounding rects, not scrollHeight <= innerHeight: the fit mode sets height:100dvh and
// overflow:hidden, so that passes even when content is cut off. For each size / theme / fixture it asserts
// that the hero, both trend cards, the chart, the attention box and its button sit inside the viewport,
// and that no card (the scrolling list aside) has scrollHeight > clientHeight.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const BEFORE = process.argv.includes('--before')
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || `qa/overview-fit/${BEFORE ? 'before' : 'after'}`
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A fixed clock (Fri Oct 30, 10:24 AM Central) so before and after shots match to the pixel.
const BASE = Date.UTC(2026, 9, 30, 15, 24)
const iso = ms => new Date(ms).toISOString()
const DAY = 864e5
const AT = (daysAgo, hour = 16) => iso(Date.UTC(2026, 9, 30 - daysAgo, hour, 0))
const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard',
}

const NAMES = [
  ['Marcus', 'Reed', 'Foresters'], ['Dana', 'Whitfield', 'Mutual of Omaha'], ['Teresa', 'Boone', 'Globe Life'], ['Curtis', 'Hale', 'Americo'],
  ['Priya', 'Nair', 'Transamerica'], ['Luis', 'Ortega', 'Aetna'], ['Janet', 'Kowalski', 'Corebridge'], ['Andre', 'Simmons', 'Royal Neighbors'],
  ['Grace', 'Lindholm', 'Foresters'], ['Owen', 'Tate', null], ['Maribel', 'Cruz', 'Americo'], ['Hank', 'Dorsey', 'Globe Life'],
]
let seq = 0
const mk = (over = {}) => {
  const n = ++seq
  return {
    id: `p${String(n).padStart(4, '0')}`, agent_id: AGENT, client_first_name: 'Client', client_last_name: `N${n}`, client_phone: '5551230000',
    state: 'TX', client_timezone: 'America/Chicago', carrier_name: null, scheduled_call_at: null, fulfillment_stage: 'Queued',
    fulfillment_completed_at: null, call_live_since: null, last_call_outcome: null, call_attempts: 0, last_call_at: null,
    recovery_step: null, missed_step: null, created_at: AT(40), updated_at: AT(1), details: { current_carrier: null }, ...over,
  }
}
// Booked and cancelled counts: this week (Mon Oct 26 to today) and last week (Mon Oct 19 to Sun Oct 25).
const HISTORY = () => {
  const out = []
  const booked = [[4, 2], [3, 1], [1, 3], [0, 1], [11, 3], [10, 1], [9, 2], [8, 4], [7, 2]] // [daysAgo, count]
  const cancelledDays = new Set([3, 1, 0, 10, 9, 8, 7])
  for (const [d, c] of booked) {
    for (let i = 0; i < c; i++) {
      const done = cancelledDays.has(d) && i === 0
      out.push(mk({
        created_at: AT(d, 15 + i), scheduled_call_at: AT(d - 1, 18), client_first_name: 'Done', client_last_name: `D${d}${i}`,
        ...(done ? { fulfillment_stage: 'Complete', fulfillment_completed_at: AT(d, 20) } : null),
      }))
    }
  }
  return out
}
const attention = n => Array.from({ length: n }, (_, i) => {
  const [f, l, carrier] = NAMES[i % NAMES.length]
  return mk({
    client_first_name: f, client_last_name: l, details: { current_carrier: carrier },
    last_call_outcome: 'no_answer', recovery_step: i % 3 === 2 ? 'number_check' : 'call_directly', last_call_at: AT(1, 14 + (i % 5)),
  })
})
const UPCOMING = [[0, 16, 'Helen', 'Park', 'Globe Life'], [0, 19, 'Alicia', 'Moreno', 'Aetna'], [1, 15, 'Robert', 'Ellis', 'Transamerica'],
  [-3, 18, 'Nina', 'Vasquez', 'Foresters'], [-3, 20, 'Sam', 'Oakes', 'Americo'], [-4, 14, 'Paula', 'Greer', 'Mutual of Omaha']]
const upcoming = n => UPCOMING.slice(0, n).map(([d, h, f, l, c]) => mk({ client_first_name: f, client_last_name: l, scheduled_call_at: AT(-d, h), details: { current_carrier: c } }))
const LIVE = () => mk({ client_first_name: 'Helen', client_last_name: 'Park', call_live_since: iso(BASE - 120e3), fulfillment_stage: 'In progress', scheduled_call_at: iso(BASE - 600e3) })

const FIXTURES = {
  rows0: () => [...HISTORY()],
  rows4: () => [...HISTORY(), ...attention(4)],
  rows12: () => [...HISTORY(), ...attention(12)],
  caught: () => [...HISTORY(), ...upcoming(6)],
}
// Worst-case toggles.
const WORST = { call: true, err: true, confirm: true, grace: true }

// ── Mock ─────────────────────────────────────────────────────────────────────
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const sessionFor = profile => ({
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: profile.email, app_metadata: {}, user_metadata: {}, created_at: iso(BASE - 1000 * DAY) },
})
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, { profile, rows, failPolicies, grace }) {
  let policyCalls = 0 // failPolicies 'stale': the first load works, every refetch after it fails (the rows stay cached)
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const reply = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile)
    const table = path.replace('/rest/v1/', '')
    if (table === 'policies') {
      policyCalls++
      if (failPolicies === true || (failPolicies === 'stale' && policyCalls > 1)) return json(route, 500, { code: 'XX000', message: 'mock failure', details: null, hint: null })
      return reply(rows)
    }
    if (table === 'app_settings') return reply([{ id: 1, agent_billing_enforced: !!grace }])
    return single ? json(route, 200, {}) : json(route, 200, [])
  })
}

// ── Measure (runs in the page) ───────────────────────────────────────────────
const measure = page => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight
  const rect = e => { const r = e.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), height: +r.height.toFixed(1) } }
  const visible = e => !!e && e.getClientRects().length > 0
  const inside = r => r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5
  const out = { vw, vh, parts: {}, clipped: [], scrollers: [] }
  const grid = document.querySelector('.ov-grid')
  const parts = {
    hero: document.querySelector('section.ov-hero'),
    trend1: grid?.children[0]?.children[0],
    trend2: grid?.children[0]?.children[1],
    attn: grid?.children[1],
    attnBtn: grid?.children[1]?.querySelector('.ov-primary'),
    chart: grid?.children[2]?.querySelector('.ov-lw'),
    banner_call: [...document.querySelectorAll('p')].find(e => e.textContent.startsWith('Fulfillment is on a call'))?.parentElement ?? null,
    banner_err: document.querySelector('[role="alert"]'),
    banner_confirm: document.querySelector('.ov-confirm-banner'),
    banner_grace: [...document.querySelectorAll('span')].find(e => e.textContent.includes('payment didn')) ?.parentElement ?? null,
  }
  for (const [k, e] of Object.entries(parts)) {
    if (!e || !visible(e)) { out.parts[k] = null; continue }
    const r = rect(e)
    out.parts[k] = { ...r, inside: inside(r) }
    // Every card except the list: scrollHeight must not exceed clientHeight (cards, not the rows inside them).
    if (!k.endsWith('Btn') && (e.scrollHeight > e.clientHeight + 1)) out.clipped.push({ part: k, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight })
  }
  // The scrolling list inside the attention box (if any) and where the button sits under it.
  const box = parts.attn
  if (box) {
    for (const e of box.querySelectorAll('*')) {
      const oy = getComputedStyle(e).overflowY
      if ((oy === 'auto' || oy === 'scroll') && visible(e)) out.scrollers.push({ cls: String(e.className).slice(0, 40), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrolls: e.scrollHeight > e.clientHeight + 1, bottom: +e.getBoundingClientRect().bottom.toFixed(1) })
    }
    out.attnRows = [...box.querySelectorAll('.ov-attn-row, .ov-up-row')].filter(visible).length
    out.attnBtnText = parts.attnBtn ? parts.attnBtn.innerText.trim() : null
  }
  out.pageScroll = { scrollHeight: document.documentElement.scrollHeight, innerHeight: vh, scrollWidth: document.documentElement.scrollWidth, innerWidth: vw }
  out.fontsOk = document.fonts.status
  return out
})

// ── Run ──────────────────────────────────────────────────────────────────────
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const hashes = {}

async function open({ route = '/agent', w, h, theme, fixture = 'rows4', call = false, err = false, confirm = false, grace = false, role = 'agent', phone = false }) {
  const profile = { ...PROFILE, role, ...(confirm ? { email_confirm_pending: true } : null), ...(grace ? { billing_exempt: false, billing_status: 'past_due', billing_grace_until: iso(BASE + 3 * DAY), billing_current_period_end: iso(BASE + 3 * DAY) } : null) }
  const rows = FIXTURES[fixture]().concat(call ? [LIVE()] : [])
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [sessionFor(profile), theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.setFixedTime(BASE)
  await mock(page, { profile, rows, failPolicies: err, grace })
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
  if (route === '/agent' && !phone) {
    if (err) await page.locator('[role="alert"]').first().waitFor({ timeout: 90000 })
    else await page.waitForFunction(() => /Needs your attention|all caught up/.test(document.querySelector('.ov-grid')?.textContent || '') && !/Needs your attention—$/.test(document.querySelector('.ov-grid')?.children[1]?.textContent || ''), null, { timeout: 30000 })
  } else {
    await page.waitForSelector('.ov-hero, .ph-main, .tc-phone', { timeout: 30000 })
  }
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900) // fade-in, fonts
  return { ctx, page, errors }
}

const tag = o => [o.route === '/agent' || !o.route ? 'agent' : o.route.slice(1), o.fixture, o.worst ? `worst-${o.err === 'stale' ? 'stale-error' : o.err ? 'load-failed' : 'banners'}` : null, `${o.w}x${o.h}`, o.theme].filter(Boolean).join('-')

async function agentCase(o) {
  try { await agentCaseRun(o) } catch (e) {
    results.push({ file: null, case: tag(o), size: `${o.w}x${o.h}`, theme: o.theme, fixture: o.fixture, pass: false, fail: [`threw: ${String(e.message).split('\n')[0]}`], measured: null })
  }
}

async function agentCaseRun(o) {
  const { ctx, page, errors } = await open(o)
  const m = await measure(page)
  const file = `${tag(o)}.png`
  await page.screenshot({ path: join(OUT, file), fullPage: !!o.phone })
  await ctx.close()
  const fit = o.w >= 1280 && o.h >= 700
  const fail = []
  if (!o.phone) {
    const need = ['hero', 'trend1', 'trend2', 'chart', 'attn']
    if (!o.err) need.push('attnBtn') // a failed load shows the title and a dash, no list and no button (as today)
    for (const k of need) {
      if (!m.parts[k]) fail.push(`${k} missing`)
      else if (fit && !m.parts[k].inside) fail.push(`${k} outside viewport (top ${m.parts[k].top}, bottom ${m.parts[k].bottom}, vh ${m.vh})`)
    }
    for (const k of ['banner_call', 'banner_err', 'banner_confirm', 'banner_grace']) {
      const on = { banner_call: o.call, banner_err: o.err, banner_confirm: o.confirm, banner_grace: o.grace }[k]
      if (on && !m.parts[k]) fail.push(`${k} not showing`)
      if (on && fit && m.parts[k] && !m.parts[k].inside) fail.push(`${k} outside viewport`)
    }
    if (fit) for (const c of m.clipped) fail.push(`${c.part} clipped (scrollHeight ${c.scrollHeight} > clientHeight ${c.clientHeight})`)
    if (fit && m.pageScroll.scrollHeight > m.pageScroll.innerHeight + 1) fail.push(`page scrolls (${m.pageScroll.scrollHeight} > ${m.pageScroll.innerHeight})`)
    const expectRows = { rows4: 4, rows12: fit ? 12 : 4 }[o.fixture]
    if (!o.err && expectRows && m.attnRows !== expectRows) fail.push(`attention rows ${m.attnRows}, expected ${expectRows}`)
    if (!o.err && o.fixture === 'rows12') {
      const want = 'See all 12'
      if (!m.attnBtnText?.includes(want)) fail.push(`button says "${m.attnBtnText}", expected "${want}…"`)
      const sc = m.scrollers.find(s => s.scrolls)
      if (fit && !sc) fail.push('12 rows but no list scrolls inside the box')
      if (fit && sc && m.parts.attnBtn && m.parts.attnBtn.top < sc.bottom - 1) fail.push('button is not below the scrolling list')
    }
    if (!fit && m.pageScroll.scrollWidth > m.pageScroll.innerWidth + 1) fail.push('sideways scroll')
  } else {
    if (m.pageScroll.scrollWidth > m.pageScroll.innerWidth + 1) fail.push(`sideways scroll (${m.pageScroll.scrollWidth} > ${m.pageScroll.innerWidth})`)
    if (m.pageScroll.scrollHeight <= m.pageScroll.innerHeight) fail.push('phone page does not scroll vertically')
  }
  if (errors.length) fail.push(`page errors: ${errors.join(' | ')}`)
  results.push({ file, case: tag(o), size: `${o.w}x${o.h}`, theme: o.theme, fixture: o.fixture, banners: { call: !!o.call, err: !!o.err, confirm: !!o.confirm, grace: !!o.grace }, fit, pass: fail.length === 0, fail, measured: m })
}

// Other roles: a shot per size/theme, hashed so before and after can be compared pixel for pixel.
async function otherCase(route, role, w, h, theme) {
  const o = { route, role, w, h, theme, fixture: 'rows4' }
  const { ctx, page, errors } = await open(o)
  const buf = await page.screenshot({ fullPage: false })
  const file = `${tag(o)}.png`
  const { writeFileSync: wf } = await import('node:fs')
  wf(join(OUT, file), buf)
  await ctx.close()
  const sha = createHash('sha256').update(buf).digest('hex')
  hashes[file] = sha
  results.push({ file, case: tag(o), size: `${w}x${h}`, theme, route, sha256: sha, pass: errors.length === 0, fail: errors, measured: null })
}

try {
  const FIT_SIZES = [[1920, 1080], [1440, 900], [1920, 950], [1440, 780], [1280, 700]]
  for (const theme of ['dark', 'light']) {
    for (const [w, h] of FIT_SIZES) for (const fixture of ['rows0', 'rows4', 'rows12', 'caught']) await agentCase({ w, h, theme, fixture })
    // Worst case: call banner, LoadError, ConfirmEmailBanner (and the payment banner) all showing.
    for (const [w, h] of [[1440, 780], [1280, 700]]) {
      await agentCase({ w, h, theme, fixture: 'rows12', call: true, err: 'stale', confirm: true, grace: true, worst: true }) // the three banners plus the payment one: refetch failed, old rows still cached
      await agentCase({ w, h, theme, fixture: 'rows12', err: true, confirm: true, grace: true, worst: true }) // first load failed: dashes, no list
      await agentCase({ w, h, theme, fixture: 'rows12', call: true, confirm: true, grace: true, worst: true }) // banners without the load error: the list and button stay in view
    }
    // Under 1280 wide or 700 tall: not fit mode. The cap stays at 4, the page scrolls as today.
    for (const [w, h] of [[1200, 800], [1440, 680]]) await agentCase({ w, h, theme, fixture: 'rows12' })
    // Phone: unchanged, scrolls vertically, never sideways.
    await agentCase({ w: 390, h: 844, theme, fixture: 'rows4', phone: true })
    // Admin and Fulfillment must look the same before and after.
    for (const [w, h] of [[1920, 1080], [1440, 900]]) {
      for (const [route, role] of [['/admin', 'admin'], ['/fulfillment', 'fulfillment']]) {
        try { await otherCase(route, role, w, h, theme) } catch (e) {
          results.push({ file: null, case: `${route.slice(1)}-${w}x${h}-${theme}`, pass: false, fail: [`threw: ${String(e.message).split('\n')[0]}`], measured: null })
        }
      }
    }
  }
} finally {
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify({ mode: BEFORE ? 'before' : 'after', total: results.length, failed: results.filter(r => !r.pass).length, results }, null, 2))
  await browser.close()
  await server.close()
}
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.case.padEnd(46)}${r.fail.length ? '  ' + r.fail.join('; ') : ''}`)
const failed = results.filter(r => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} pass (${BEFORE ? 'before mode: recorded only' : 'after mode'}) -> ${join(OUT, 'measurements.json')}`)
process.exit(BEFORE || failed === 0 ? 0 : 1)
