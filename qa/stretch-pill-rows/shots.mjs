// Stretchy pill on the AgentUI rows (My Pipeline switch, stage tabs, range switch, Book a call switch), Supabase fully mocked.
//   node qa/stretch-pill-rows/shots.mjs [outDir]
// Each switch is clicked with the flight paused at 0 ms and 200 ms (shot), then played out. Checks per switch: the pill exists mid-flight,
// is gone at the end, and a layout-shift observer (every entry, recent-input ones too) reads 0. Fulfillment and Admin Pipeline must never get a pill.
// Writes checks.json and exits 1 on any failed check.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

// NOPILL=1 takes Element.animate away, so no flight can start: the baseline for "same as master" layout numbers.
const NOPILL = !!process.env.NOPILL
const OUT = process.argv[2] || 'qa/stretch-pill-rows'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-30T15:07:00Z')
const iso = (days, h = 12, m = 0) => new Date(Date.UTC(2026, 9, 30 + days, h + 5, m)).toISOString()

let seq = 0
const mk = (f, l, st, o = {}) => {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, agent_id: AGENT, agent: { id: AGENT, full_name: 'Test agent' }, assigned: null,
    client_first_name: f, client_last_name: l, client_phone: `(555) 010-${String(2000 + seq * 37).slice(0, 4)}`, state: st, client_city: 'Tulsa', client_timezone: TZ,
    carrier_id: null, carrier_name: 'Aetna', details: { current_carrier: 'Aetna' }, fulfillment_stage: 'Assigned',
    scheduled_call_at: null, call_live_since: null, last_call_outcome: null, call_attempts: 0, last_call_at: null, recovery_step: null,
    recovery_retry_at: null, created_at: iso(-3 - seq % 9, 9, 5), updated_at: iso(-1), fulfillment_completed_at: null, ...o,
  }
}
const ROWS = [
  mk('Omar', 'Haddad', 'OK', { scheduled_call_at: iso(0, 14) }), mk('Helen', 'Park', 'NC', { scheduled_call_at: iso(1, 10) }), mk('Alicia', 'Moreno', 'AZ', { scheduled_call_at: iso(2, 9) }),
  mk('Earl', 'Tucker', 'GA', { last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: iso(-1), scheduled_call_at: iso(-1), recovery_step: 'followup', recovery_retry_at: iso(3, 10) }),
  mk('Ruth', 'Bell', 'ID', { last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: iso(-1), recovery_step: 'number_check' }),
  mk('Diane', 'Foster', 'OR', { last_call_outcome: 'no_answer', call_attempts: 3, last_call_at: iso(-2), recovery_step: 'call_directly' }),
  mk('Janet', 'Cole', 'FL', { fulfillment_stage: 'Complete', last_call_outcome: 'answered', call_attempts: 1, last_call_at: iso(-2), fulfillment_completed_at: iso(-2, 15) }),
  mk('Victor', 'Nguyen', 'TX', { fulfillment_stage: 'Complete', last_call_outcome: 'answered', call_attempts: 1, last_call_at: iso(-5), fulfillment_completed_at: iso(-5, 15) }),
]

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000, user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'test.agent@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const profile = role => ({ id: AGENT, role, full_name: 'Test user', email: 'test.agent@example.com', timezone: TZ, is_active: true, billing_exempt: true, billing_status: 'active', billing_tier: 'standard', membership_tier: 'standard' })

async function mock(page, role) {
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile(role))
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/functions/v1/')) return json(route, 200, { capabilities: {}, secrets: [] })
    if (path.startsWith('/rest/v1/rpc/')) return json(route, 200, path.endsWith('my_push_settings') ? { push_on: false } : path.endsWith('my_money_banner') ? null : [])
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (req.method() !== 'GET') return json(route, 200, [])
      if (table === 'policies') {
        const mine = role === 'fulfillment' ? ROWS.map(r => ({ ...r, assigned_fulfillment_id: AGENT, assigned: { id: AGENT, full_name: 'Fulfillment rep' } })) : ROWS
        return json(route, 200, single ? mine[0] : mine)
      }
      if (table === 'app_settings') return json(route, 200, single ? { id: 1, agent_billing_enforced: false } : [{ id: 1, agent_portal_v2: false, agent_billing_enforced: false }])
      if (table === 'recovery_config') return json(route, 200, [{ id: 1, sms_live: false, voice_live: false, recording_live: false }])
      return json(route, 200, single ? null : [])
    }
    return json(route, 200, {})
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const check = (name, ok, info) => { results.push({ name, pass: !!ok, ...(info === undefined ? null : { info }) }); console.log(ok ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)) }

async function open(w, theme, role, url, ready) {
  const phone = w === 390
  const ctx = await browser.newContext({ viewport: { width: w, height: phone ? 844 : 900 }, colorScheme: theme, timezoneId: TZ, locale: 'en-US', deviceScaleFactor: phone ? 2 : 1, ...(phone ? { isMobile: true, hasTouch: true } : null) })
  await ctx.addInitScript(([s, th]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('ohvara-theme', th) }, [SESSION, theme])
  if (NOPILL) await ctx.addInitScript(() => { delete Element.prototype.animate })
  await ctx.clock.setFixedTime(NOW)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await mock(page, role)
  await page.goto(base + url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(ready, { timeout: 180000 })
  await page.waitForFunction(() => !/Loading (clients|your clients)/.test(document.body.innerText), null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    window.__cls = []
    new PerformanceObserver(list => { for (const e of list.getEntries()) { window.__cls.push(e.value); window.__src = (e.sources || []).map(s => s.node && (s.node.className || s.node.tagName)) } }).observe({ type: 'layout-shift', buffered: false })
    window.__edges = () => {
      const l = document.querySelector('.sp-pill .sp-layer'); if (!l) return null
      const m = /inset\(([\d.-]+)px calc\(100% - ([\d.-]+)px\) calc\(100% - ([\d.-]+)px\) ([\d.-]+)px/.exec(getComputedStyle(l).clipPath)
      const row = l.closest('.sp-pill').parentElement
      return m && { left: +m[4], right: +m[2] }
    }
    window.__rects = sel => [...document.querySelectorAll(sel)].map(n => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => +v.toFixed(2)) })
    window.__btn = sel => { const b = document.querySelector(sel); const row = b.parentElement; const r = b.getBoundingClientRect(), q = row.getBoundingClientRect(); return { left: +(r.left - q.left - row.clientLeft).toFixed(1), right: +(r.right - q.left - row.clientLeft).toFixed(1) } }
    // The router defers its update, so the flight can start a frame or two after the click: wait for the overlay, then pause everything.
    window.__start = async (sel, wait) => {
      document.querySelector(sel).click()
      if (!wait) return new Promise(r => setTimeout(r, 200))
      for (let i = 0; i < 60 && !document.querySelector('.sp-pill'); i++) await new Promise(r => requestAnimationFrame(r))
      document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0 })
    }
    window.__seek = ms => document.getAnimations().forEach(a => { a.currentTime = ms })
    window.__play = () => document.getAnimations().forEach(a => a.play())
  })
  return { ctx, page, errors }
}
const crop = async (page, sel, path, pad = 10) => {
  const b = await page.locator(sel).first().boundingBox()
  const size = page.viewportSize()
  await page.screenshot({ path, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(b.width + 2 * pad, size.width), height: b.height + 2 * pad } })
}
const sum = a => +a.reduce((s, v) => s + v, 0).toFixed(5)

// Click `clickSel`, shoot the paused flight, play it out. rowSel is the row (for the up-close shot and the layout read), shiftSel the buttons whose boxes must not move.
// baselineCls: a page-content shift (list or counts changing under the row) that master has too: the same number with the pill off (NOPILL=1).
async function fly(page, tag, { clickSel, rowSel, shotSel = rowSel, shiftSel = `${rowSel} button`, expectFlight = true, baselineCls = 0 }) {
  await page.evaluate(() => { window.__cls.length = 0 })
  const before = await page.evaluate(s => window.__rects(s), shiftSel)
  const from = await page.evaluate(sel => window.__btn(sel), `${rowSel} .is-on, ${rowSel} .is-sel`).catch(() => null)
  await page.evaluate(([sel, w]) => window.__start(sel, w), [clickSel, expectFlight && !NOPILL])
  const to = await page.evaluate(() => { const b = document.querySelector('.sp-target'); if (!b) return null; const row = b.parentElement; const r = b.getBoundingClientRect(), q = row.getBoundingClientRect(); return { left: +(r.left - q.left - row.clientLeft).toFixed(1), right: +(r.right - q.left - row.clientLeft).toFixed(1) } })
  const pills = await page.evaluate(() => document.querySelectorAll('.sp-pill').length)
  const at0 = await page.evaluate(() => window.__edges())
  await page.evaluate(() => window.__seek(200))
  const at200 = await page.evaluate(() => window.__edges())
  if (!NOPILL) {
    await crop(page, shotSel, join(OUT, `${tag}-mid.png`))
    await page.evaluate(() => window.__seek(0))
    await crop(page, shotSel, join(OUT, `${tag}-0ms.png`))
  }
  await page.evaluate(() => window.__play())
  await page.waitForTimeout(900)
  const left = await page.evaluate(() => document.querySelectorAll('.sp-pill, .sp-row, .sp-flying').length)
  const after = await page.evaluate(s => window.__rects(s), shiftSel)
  const cls = await page.evaluate(() => window.__cls.slice())
  if (cls.length) console.log("SHIFT SOURCES", tag, JSON.stringify(await page.evaluate(() => window.__src)))
  if (!NOPILL) await crop(page, shotSel, join(OUT, `${tag}-end.png`))
  const moved = before.length === after.length ? before.map((b, i) => Math.max(...b.map((v, j) => Math.abs(v - after[i][j])))).reduce((m, v) => Math.max(m, v), 0) : -1
  const spans = at200 && to && from ? at200.left < Math.min(to.left, from.left) + 0.5 || at200.right > Math.max(to.right, from.right) - 0.5 || (at200.right - at200.left) > Math.max(to.right - to.left, from.right - from.left) : false
  if (NOPILL) { console.log(`BASE ${tag} cls=${JSON.stringify(cls)} moved=${moved}`); return { before, after, moved, spans, cls: sum(cls) } }
  if (expectFlight) {
    check(`${tag}: pill flies (mid frame has one)`, pills === 1 && at200 && at0, { pills, at0, at200, from, to })
    const apart = (a, b) => Math.abs(a - b) > 1
    check(`${tag}: edges are apart mid-flight (pill is on neither the old nor the new button)`, at200 && to && from && apart(at200.left, to.left) && apart(at200.right, to.right) && apart(at200.left, from.left) && apart(at200.right, from.right), { at200, from, to })
  } else check(`${tag}: no pill`, pills === 0, { pills })
  check(`${tag}: overlay and sp- classes gone at the end`, left === 0, { left })
  check(baselineCls ? `${tag}: layout shift equals the no-pill baseline ${baselineCls} (page content, same on master)` : `${tag}: layout shift 0`, sum(cls) === sum([baselineCls]), { cls })
  return { before, after, moved, spans, cls: sum(cls) }
}

const rowMove = (tag, r, max = 0.5) => check(`${tag}: buttons did not move on selection (max ${max}px)`, r.moved >= 0 && r.moved <= max, { moved: r.moved, before: r.before, after: r.after })

// ONLY=clients|phone|book|pipelines runs one group; THEMES=light runs one theme.
const ONLY = process.env.ONLY
for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
  // ── 1440, agent My Pipeline ──
  if (!ONLY || ONLY === 'clients') {
    const { ctx, page, errors } = await open(1440, theme, 'agent', '/agent/clients', '.pl-tabs')
    const t = n => `agent-clients-1440-${theme}-${n}`
    // SideSwitch: In progress -> Clients (the switch remounts; persistKey carries the pill across)
    let r = await fly(page, t('side-to-clients'), { clickSel: '.pl-seg button:not(.is-on)', rowSel: '.pl-seg', shotSel: '.pl-list' })
    rowMove(t('side-to-clients'), r)
    await page.waitForSelector('.pl-seg')
    r = await fly(page, t('side-to-progress'), { clickSel: '.pl-seg button:not(.is-on)', rowSel: '.pl-seg', shotSel: '.pl-list' })
    rowMove(t('side-to-progress'), r)
    await page.waitForSelector('.pl-tabs')
    // The stage tabs
    r = await fly(page, t('tab-to-3'), { clickSel: '.pl-tab:last-child', rowSel: '.pl-tabs', shiftSel: '.pl-tabs .pl-tab' })
    rowMove(t('tab-to-3'), r)
    r = await fly(page, t('tab-to-2'), { clickSel: '.pl-tab:nth-child(2)', rowSel: '.pl-tabs', shiftSel: '.pl-tabs .pl-tab' })
    r = await fly(page, t('tab-to-1'), { clickSel: '.pl-tab:first-child', rowSel: '.pl-tabs', shiftSel: '.pl-tabs .pl-tab' })
    // The range switch (grid, full width)
    r = await fly(page, t('range'), { clickSel: '.pl-pipe .ov-range button:not(.is-on)', rowSel: '.pl-pipe .ov-range', baselineCls: 0.00010581063059949418 })
    rowMove(t('range'), r)
    r = await fly(page, t('range-back'), { clickSel: '.pl-pipe .ov-range button:last-child', rowSel: '.pl-pipe .ov-range', baselineCls: 0.00010581063059949418 })
    // Keyboard on the stage tabs
    await page.focus('.pl-tab.is-sel')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
    const k = await page.evaluate(() => {
      const a = document.activeElement
      const tabs = [...document.querySelectorAll('.pl-tab')]
      const cs = getComputedStyle(a)
      return { activeIsTab: a.classList.contains('pl-tab'), index: tabs.indexOf(a), selected: tabs.map(x => x.getAttribute('aria-selected')), tabIndex: tabs.map(x => x.tabIndex), focusVisible: a.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth}`, role: a.getAttribute('role') }
    })
    check(t('keyboard ArrowRight moves selection and focus, ring shows'), k.activeIsTab && k.index === 1 && k.selected[1] === 'true' && k.tabIndex[1] === 0 && k.tabIndex[0] === -1 && k.focusVisible && k.outline.startsWith('solid 2px'), k)
    await page.waitForTimeout(800)
    await crop(page, '.pl-tabs', join(OUT, `${t('keyboard')}.png`))
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(150)
    check(t('keyboard ArrowLeft goes back'), await page.evaluate(() => document.activeElement === document.querySelectorAll('.pl-tab')[0] && document.querySelectorAll('.pl-tab')[0].getAttribute('aria-selected') === 'true'))
    await page.waitForTimeout(800)
    check(t('no page errors'), errors.length === 0, errors)
    await ctx.close()
  }
  // ── 390, PhoneClients SideSwitch ──
  if (!ONLY || ONLY === 'phone') {
    const { ctx, page, errors } = await open(390, theme, 'agent', '/agent/clients', '.pl-seg')
    const t = n => `agent-clients-390-${theme}-${n}`
    const heights = await page.evaluate(() => [...document.querySelectorAll('.pl-seg button')].map(b => b.getBoundingClientRect().height))
    check(t('side switch buttons are 44px or taller'), heights.every(h => h >= 44), heights)
    const r = await fly(page, t('side'), { clickSel: '.pl-seg button:not(.is-on)', rowSel: '.pl-seg', shotSel: '.ph-side', baselineCls: 0.0859060892612475 })
    rowMove(t('side'), r)
    const heights2 = await page.evaluate(() => [...document.querySelectorAll('.pl-seg button')].map(b => b.getBoundingClientRect().height))
    check(t('buttons still 44px or taller after'), heights2.every(h => h >= 44), heights2)
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    check(t('no sideways scroll'), sw[0] <= sw[1], sw)
    // A real tap switches back
    await page.waitForTimeout(300)
    await page.locator('.pl-seg button:not(.is-on)').first().tap()
    await page.waitForTimeout(900)
    check(t('a real tap switches the side'), await page.evaluate(() => /^In progress/.test(document.querySelector('.pl-seg button.is-on').innerText)))
    check(t('no page errors'), errors.length === 0, errors)
    await ctx.close()
  }
  // ── Book a call switch ──
  // 390: New booking is PhoneBook, which has no switch, so the row only exists in change mode on a phone and there is nothing to fly to.
  for (const w of ONLY && ONLY !== 'book' ? [] : [1440]) {
    const { ctx, page, errors } = await open(w, theme, 'agent', '/agent/submit?change=1', '.ov-book-switch')
    const t = n => `agent-submit-${w}-${theme}-${n}`
    const widths = await page.evaluate(() => { const s = document.querySelector('.ov-book-switch'); return { row: s.getBoundingClientRect().width, btns: [...s.querySelectorAll('button')].map(b => b.getBoundingClientRect().width) } })
    // Warm-up: the first visit to New booking loads a font, and the hook drops a flight while fonts load (by design), so go there and back once first.
    await page.evaluate(() => document.querySelector('.ov-book-switch button:not(.is-on)').click())
    await page.waitForTimeout(1500)
    await page.evaluate(() => document.querySelector('.ov-book-switch button:not(.is-on)').click())
    await page.waitForTimeout(1500)
    const r = await fly(page, t('book'), { clickSel: '.ov-book-switch button:not(.is-on)', rowSel: '.ov-book-switch', shotSel: '.ov-book-switch' })
    const r2 = await fly(page, t('book-back'), { clickSel: '.ov-book-switch button:not(.is-on)', rowSel: '.ov-book-switch', shotSel: '.ov-book-switch' })
    const widths2 = await page.evaluate(() => { const s = document.querySelector('.ov-book-switch'); return { row: s.getBoundingClientRect().width, btns: [...s.querySelectorAll('button')].map(b => b.getBoundingClientRect().width) } })
    console.log('BOOKSWITCH widths', w, theme, JSON.stringify({ before: widths, after: widths2, moved: r.moved }))
    check(t('no page errors'), errors.length === 0, errors)
    await ctx.close()
  }
  // ── Fulfillment and Admin Pipeline: never a pill ──
  for (const [role, url] of ONLY && ONLY !== 'pipelines' ? [] : [['fulfillment', '/fulfillment/pipeline'], ['admin', '/admin/pipeline']]) {
    const { ctx, page, errors } = await open(1440, theme, role, url, '.pl-tabs')
    const t = n => `${role}-pipeline-1440-${theme}-${n}`
    const nTabs = await page.locator('.pl-tab').count()
    for (let i = 0; i < nTabs; i++) {
      await page.evaluate(() => window.__cls.length = 0)
      await page.locator('.pl-tab').nth(i).click()
      await page.waitForTimeout(120)
      const mid = await page.evaluate(() => document.querySelectorAll('.sp-row, .sp-pill, .sp-flying, .sp-target').length)
      check(t(`tab ${i} click: no pill, no sp- class`), mid === 0, { mid })
    }
    const ranges = await page.locator('.ov-range button').count()
    for (let i = 0; i < ranges; i++) {
      await page.locator('.ov-range button').nth(i).click()
      await page.waitForTimeout(120)
      const mid = await page.evaluate(() => document.querySelectorAll('.sp-row, .sp-pill, .sp-flying, .sp-target').length)
      check(t(`range button ${i} click: no pill`), mid === 0, { mid })
    }
    const total = await page.evaluate(() => document.querySelectorAll('.sp-row, .sp-pill').length)
    check(t('document.querySelectorAll(".sp-row, .sp-pill").length is 0'), total === 0 && nTabs > 0, { total, nTabs, ranges })
    await page.screenshot({ path: join(OUT, `${t('page')}.png`) })
    check(t('no page errors'), errors.length === 0, errors)
    await ctx.close()
  }
}

writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 2))
await browser.close()
await server.close()
const failed = results.filter(r => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
