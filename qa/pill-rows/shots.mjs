// Stretchy pill on the Leads, Clients, client page, bell and invite rows. Every Supabase call is mocked (no real project, no login).
//   node qa/pill-rows/shots.mjs [outDir]
// For each row at 1440 and 390, light and dark: the row at rest, the flight paused at 200 ms, the end; the edges, the rects
// before and after, and a reduced-motion run (no pill, so the rest state is what the row was before the hook) to compare with.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/pill-rows'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
const AGENT = '11111111-1111-4111-8111-111111111111'
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const session = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000, user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'qa@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date(nowS * 1000 - 1e11).toISOString() } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const { buildSample } = await server.ssrLoadModule('/src/lib/inboundsSample.js')
const sample = buildSample()
const SOLD = { ...sample.leads[0], lead_id: 'sold-1', contact_name: 'Dana Whitfield', phone: '(555) 010-0777', outcome: 'sold', outcome_at: new Date().toISOString(), client_policy_id: 'pol-3', inbound_stage: 'booked' }
const LEADS = [...sample.leads, SOLD]
const policy = (id, carrier, n) => ({ id, agent_id: AGENT, client_first_name: 'Dana', client_last_name: 'Whitfield', client_phone: '5550100777', state: 'TX', client_city: 'Austin', client_timezone: 'America/Chicago', policy_number: n, carrier_name: carrier, product_type: 'term', monthly_premium: 82.5, status: 'booked', fulfillment_assigned: true, fulfillment_stage: 'booked', created_at: new Date().toISOString(), scheduled_call_at: null, details: null })
const POLICIES = [policy('pol-1', 'Mutual of Omaha', 'MO-44821'), policy('pol-2', 'Americo', 'AM-90117'), policy('pol-3', 'Foresters Financial', 'FF-30018')]
const t0 = Date.now()
const LOG = [0, 1, 2, 3, 4, 5].map(i => ({ id: `c${i}`, subject: 'client', client_key: 'k1', lead_id: 'sold-1', policy_id: 'pol-1', agent_id: AGENT, occurred_at: new Date(t0 - i * 3600e3).toISOString(), channel: i % 2 ? 'call' : 'text', direction: i % 3 ? 'out' : 'in', sender_type: 'va', sender_name: 'Mia', body: `Message ${i}`, call_result: i % 2 ? 'completed' : null, kind: 'x', source: 'x', label: null }))
const NOTES = [0, 1, 2].map(i => ({ id: `n${i}`, type: 'booking', title: `Notice ${i}`, detail: 'Something happened', link: '/agent', created_at: new Date(t0 - i * 60e3).toISOString(), read: false, needs_action: i === 0 }))

const mock = (page, role) => page.route(`${SB}/**`, async route => {
  const req = route.request()
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const path = new URL(req.url()).pathname
  const table = path.replace('/rest/v1/', '')
  const single = (req.headers().accept || '').includes('vnd.pgrst.object')
  const profile = { id: AGENT, role, full_name: 'Test User', email: 'qa@example.com', timezone: 'America/Chicago', is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard' }
  if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true, sms: true, email: true })
  if (path.startsWith('/auth/v1/')) return json(route, 200, {})
  if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile)
  if (path === '/rest/v1/rpc/agent_inbounds') return json(route, 200, LEADS)
  if (path === '/rest/v1/rpc/contact_log') return json(route, 200, LOG)
  if (table === 'policy_servicing_status') return json(route, 200, [{ policy_id: 'pol-1', client_key: 'k1' }])
  // The by-id read (a client's policies) gets what it asks for; the agent's bookings read gets the two old ones.
  if (table === 'policies') { const m = /id=in.(([^)]*))/.exec(decodeURIComponent(new URL(req.url()).search)); return json(route, 200, m ? POLICIES.filter(p => m[1].replace(/"/g, '').split(',').includes(p.id)) : POLICIES.slice(0, 2)) }
  if (table === 'notifications') return json(route, 200, NOTES)
  if (table === 'app_settings') return json(route, 200, single ? { id: 1, agent_billing_enforced: false } : [{ id: 1, agent_billing_enforced: false }])
  return json(route, 200, single ? {} : [])
})

const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const check = (name, ok, info) => { results.push({ name, pass: !!ok, ...(info === undefined ? null : { info }) }); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function open(w, h, theme, url, rowSel, { role = 'agent', reduced = false, noWait = false } = {}) {
  const phone = w < 600
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference', ...(phone ? { isMobile: true, hasTouch: true } : null) })
  await ctx.addInitScript(([s, th]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', th) }, [session, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await mock(page, role)
  await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'domcontentloaded' })
  if (rowSel && !noWait) await page.waitForSelector(rowSel, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  if (rowSel && !noWait) await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), rowSel)
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    const box = n => { const r = n.getBoundingClientRect(); return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)] }
    window.__items = row => [...row.children].filter(c => !c.classList.contains('sp-pill'))
    // Relative to the row (size, then each button from the row corner), so a page that settles a few px apart cannot fail it.
    window.__rects = sel => { const row = document.querySelector(sel); const o = row.getBoundingClientRect(); const rel = n => { const r = n.getBoundingClientRect(); return [+(r.left - o.left).toFixed(2), +(r.top - o.top).toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)] }; return { row: [+o.width.toFixed(2), +o.height.toFixed(2)], items: window.__items(row).map(rel) } }
    window.__edges = sel => {
      const l = document.querySelector(`${sel} .sp-pill .sp-layer`); if (!l) return null
      const m = /inset\(([\d.-]+)px calc\(100% - ([\d.-]+)px\) calc\(100% - ([\d.-]+)px\) ([\d.-]+)px/.exec(getComputedStyle(l).clipPath)
      return m && { top: +m[1], right: +m[2], bottom: +m[3], left: +m[4] }
    }
    window.__target = (sel, i) => { const row = document.querySelector(sel); const o = row.getBoundingClientRect(), r = window.__items(row)[i].getBoundingClientRect(); return { top: r.top - o.top - row.clientTop, left: r.left - o.left - row.clientLeft, right: r.right - o.left - row.clientLeft, bottom: r.bottom - o.top - row.clientTop } }
    // Click item i, then hold every animation at 0.
    window.__start = async (sel, i) => {
      window.__items(document.querySelector(sel))[i].click()
      // A link goes through the router first, so wait (up to 40 frames) for the pill before holding.
      for (let n = 0; n < 40; n++) { await new Promise(r => requestAnimationFrame(r)); if (document.querySelector(`${sel} .sp-pill`)) break }
      document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0 })
    }
    window.__seek = ms => document.getAnimations().forEach(a => { a.currentTime = ms })
    window.__play = () => document.getAnimations().forEach(a => a.play())
    window.__line = (sel, i) => Math.round(window.__items(document.querySelector(sel))[i].getBoundingClientRect().top)
  })
  return { ctx, page, errors }
}
const crop = async (page, sel, path, pad = 10) => {
  const b = await page.locator(sel).boundingBox()
  const size = page.viewportSize()
  await page.screenshot({ path, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(b.width + 2 * pad, size.width), height: b.height + 2 * pad } })
}

// A same-line move on one row: frames, edges, rect identity and the mark that says the row was not remounted.
async function flight(page, tag, sel, from, to, extra = {}) {
  const base = `${tag}`
  await page.evaluate(([s, i]) => window.__items(document.querySelector(s))[i].click(), [sel, from])
  await page.waitForTimeout(900)
  await page.evaluate(s => { document.querySelector(s).__mark = 1 }, sel)
  const pre = await page.evaluate(s => window.__rects(s), sel)
  await crop(page, extra.cropSel || sel, join(OUT, `${base}-1-rest.png`))
  await page.evaluate(([s, i]) => window.__start(s, i), [sel, to])
  await page.evaluate(() => window.__seek(200))
  const mid = await page.evaluate(([s, i]) => ({ pills: document.querySelectorAll(`${s} .sp-pill`).length, e: window.__edges(s), t: window.__target(s, i), docOver: document.documentElement.scrollWidth - innerWidth }), [sel, to])
  await crop(page, extra.cropSel || sel, join(OUT, `${base}-2-200ms.png`))
  await page.evaluate(() => { window.__seek(0); window.__play() })
  await page.waitForTimeout(900)
  const post = await page.evaluate(([s]) => ({ pills: document.querySelectorAll(`${s} .sp-pill`).length, kept: document.querySelector(s)?.__mark === 1, cls: document.querySelector(s)?.className, rects: window.__rects(s) }), [sel])
  await crop(page, extra.cropSel || sel, join(OUT, `${base}-3-end.png`))
  const apart = mid.e && (Math.abs(mid.e.left - mid.t.left) > 1 || Math.abs(mid.e.right - mid.t.right) > 1) && mid.e.left < mid.t.right && mid.e.right > mid.t.left - 400
  check(`${tag} pill is mid-flight at 200 ms, edges apart from the target`, mid.pills === 1 && mid.e && apart && mid.docOver <= 0, { e: mid.e, t: mid.t, docOver: mid.docOver })
  check(`${tag} overlay gone after the flight, row not remounted, no sp- classes left`, post.pills === 0 && post.kept && !/sp-/.test(post.cls || ''), { pills: post.pills, kept: post.kept, cls: post.cls })
  return { pre, post: post.rects }
}

// Reduced motion: no pill at all, so this is the rest state a row had before the hook. Same click, same rects.
async function restRects(w, h, theme, url, rowSel, from, to, opts = {}) {
  const { ctx, page } = await open(w, h, theme, url, rowSel, { ...opts, reduced: true })
  if (opts.before) await opts.before(page)
  await page.evaluate(([s, i]) => window.__items(document.querySelector(s))[i].click(), [rowSel, from])
  await page.waitForTimeout(600)
  const pre = await page.evaluate(s => window.__rects(s), rowSel)
  await page.evaluate(([s, i]) => window.__items(document.querySelector(s))[i].click(), [rowSel, to])
  await page.waitForTimeout(600)
  const post = await page.evaluate(s => window.__rects(s), rowSel)
  await ctx.close()
  return { pre, post }
}

// For a row that wraps: [a, b] on one line, and [c, d] on different lines (null when the row is on one line).
async function pairs(page, sel) {
  return page.evaluate(s => {
    const tops = window.__items(document.querySelector(s)).map(el => Math.round(el.getBoundingClientRect().top))
    let same = null, diff = null
    for (let i = 0; i < tops.length; i++) for (let j = 0; j < tops.length; j++) {
      if (i === j) continue
      if (!same && tops[i] === tops[j]) same = [i, j]
      if (!diff && tops[i] !== tops[j]) diff = [i, j]
    }
    return { same, diff, lines: new Set(tops).size }
  }, sel)
}

// A move between two lines: the selection changes and no pill ever appears.
async function instant(page, tag, sel, from, to) {
  await page.evaluate(([s, i]) => window.__items(document.querySelector(s))[i].click(), [sel, from])
  await page.waitForTimeout(900)
  const r = await page.evaluate(async ([s, i]) => {
    const row = document.querySelector(s); let seen = 0
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('sp-pill')) seen++ }).observe(row, { childList: true })
    const b = window.__items(row)[i]; b.click()
    for (let n = 0; n < 8; n++) await new Promise(r => requestAnimationFrame(r))
    return { seen, on: /(^| )(on|is-on)( |$)/.test(b.className), live: row.querySelectorAll('.sp-pill').length, cls: row.className, anims: row.getAnimations({ subtree: true }).length }
  }, [sel, to])
  check(`${tag} switches instantly, no .sp-pill`, r.seen === 0 && r.live === 0 && r.on && !/sp-/.test(r.cls) && r.anims === 0, r)
}

// One row end to end: run the flight, then compare rects to the reduced-motion run.
async function row(theme, w, h, tag, url, sel, from, to, opts = {}) {
  if (process.env.ONLY && !tag.includes(process.env.ONLY)) return
  const { ctx, page, errors } = await open(w, h, theme, url, sel, opts)
  if (opts.before) await opts.before(page)
  if (from === 'auto') {
    const p = await pairs(page, sel)
    console.log(tag, 'lines', p.lines, JSON.stringify(p))
    if (p.diff) await instant(page, tag, sel, p.diff[0], p.diff[1])
    ;[from, to] = p.same
  }
  const live = await flight(page, tag, sel, from, to, opts)
  const base = await restRects(w, h, theme, url, sel, from, to, opts)
  // A bold selected label shifts a few rows about 1px on master too, so the row is held to what it did with no pill at all.
  check(`${tag} rects before and after the selection match the no-pill run (master's)`, same(live.pre, base.pre) && same(live.post, base.post), { shiftsOnMaster: !same(base.pre, base.post), pre: live.pre, post: live.post })
  if (same(live.pre, live.post)) check(`${tag} rects before and after the selection are identical`, true)
  check(`${tag} no page errors`, errors.length === 0, errors)
  await ctx.close()
}

const openBell = async page => {
  await page.locator('.nt-bell >> visible=true').first().click()
  await page.waitForSelector('.nt-tabs', { timeout: 30000 })
  await page.waitForTimeout(500)
}
const openInvite = w => async page => {
  if (w >= 600) {
    await page.locator('.ov-sb-account, .ov-sb-avatar').first().click()
    await page.getByText('Invite an agent').first().click()
  } else {
    await page.getByText('Invite an agent').first().click()
  }
  await page.waitForSelector('.ov-invite-seg', { timeout: 30000 })
  await page.waitForTimeout(600)
}
// A role that is not an agent: the bell's tab row must never grow a pill.
async function noPill(theme, w, h, url, role) {
  if (process.env.ONLY && !`bell-${role}-${theme}-${w}`.includes(process.env.ONLY)) return
  const tag = `bell-${role}-${theme}-${w}`
  const { ctx, page, errors } = await open(w, h, theme, url, '.nt-bell', { role, noWait: true })
  await page.waitForSelector('.nt-bell', { state: 'attached', timeout: 30000 })
  await openBell(page)
  await crop(page, '.nt-tabs', join(OUT, `${tag}-1-rest.png`))
  await instant(page, tag, '.nt-tabs', 1, 0)
  await instant(page, tag, '.nt-tabs', 0, 1)
  await crop(page, '.nt-tabs', join(OUT, `${tag}-2-after.png`))
  check(`${tag} no page errors`, errors.length === 0, errors)
  await ctx.close()
}

for (const theme of ['light', 'dark']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const t = `${theme}-${w}`
    await row(theme, w, h, `bell-agent-${t}`, '/agent', '.nt-tabs', 1, 0, { noWait: true, before: openBell })
    await row(theme, w, h, `invite-agent-${t}`, w >= 600 ? '/agent' : '/agent/more', '.ov-invite-seg', 0, 1, { noWait: true, before: openInvite(w) })
    await noPill(theme, w, h, '/admin', 'admin')
    await noPill(theme, w, h, '/fulfillment', 'fulfillment')
  }
}
for (const theme of ['light', 'dark']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const t = `${theme}-${w}`
    // Leads: Live calls tab, the four filter chips; the tab cards.
    await row(theme, w, h, `leads-fchip-${t}`, '/agent/leads?tab=live', '.pv-filters', 'auto')
    await row(theme, w, h, `leads-tabs-${t}`, '/agent/leads', '.inb-tabs', 0, 1)
    // Clients list and the client page.
    await row(theme, w, h, `clients-range-${t}`, '/agent/clients?stage=cancelled', '.cv2-range', 0, 1)
    await row(theme, w, h, `client-log-range-${t}`, '/agent/clients/sold-1', '.cpl-range', 0, 1)
    await row(theme, w, h, `client-pick-${t}`, '/agent/clients/sold-1', '.cpl-pick', 'auto')
  }
}
writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 1))
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`)
await browser.close()
await server.close()
process.exit(results.every(r => r.pass) ? 0 : 1)
