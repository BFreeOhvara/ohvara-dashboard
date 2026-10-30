// SCRATCH (not committed): screenshots + checks for My Pipeline Clients vs In progress, Supabase fully mocked.
//   node scripts/_pl-shots.mjs <group> <outDir>     group = agent | urls | inter | other
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const GROUP = process.argv[2] || 'agent'
const OUT = process.argv[3] || 'qa/clients-split'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = 5700 + Math.floor(Math.random() * 300)
const TZ = 'America/Chicago'
const AGENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-30T15:07:00Z') // Fri Oct 30, 10:07 AM Chicago
const iso = (days, h = 12, m = 0) => new Date(Date.UTC(2026, 9, 30 + days, h + 5, m)).toISOString()

const NAMES = {
  booked: [['Omar', 'Haddad', 'Tulsa', 'OK', 'Mutual of Omaha'], ['Helen', 'Park', 'Hendersonville', 'NC', 'Globe Life'], ['Alicia', 'Moreno', 'Tucson', 'AZ', 'Aetna'], ['Robert', 'Ellis', 'Mobile', 'AL', 'Transamerica'], ['Maria', 'Santos', 'Pensacola', 'FL', 'State Farm'], ['Teresa', 'Wynn', 'Evansville', 'IN', 'Allstate'], ['Linda', 'Brooks', 'Austin', 'TX', 'Prudential'], ['Greg', 'Olson', 'Dayton', 'OH', 'Aetna']],
  noAnswer: [['Earl', 'Tucker', 'Macon', 'GA', 'Allstate'], ['Nina', 'Patel', 'Fresno', 'CA', 'Globe Life'], ['Frank', 'Dorsey', 'Akron', 'OH', 'State Farm']],
  confirm: [['Ruth', 'Bell', 'Boise', 'ID', 'Prudential'], ['Calvin', 'Moss', 'Reno', 'NV', 'Transamerica']],
  call: [['Diane', 'Foster', 'Salem', 'OR', 'Aetna']],
  cancelled: [['Janet', 'Cole', 'Tampa', 'FL', 'Globe Life'], ['Victor', 'Nguyen', 'Plano', 'TX', 'State Farm'], ['Paula', 'Reyes', 'Mesa', 'AZ', 'Mutual of Omaha'], ['Darnell', 'Price', 'Mobile', 'AL', 'Allstate'], ['Sandra', 'Kim', 'Raleigh', 'NC', 'Aetna'], ['Walter', 'Hayes', 'Dayton', 'OH', 'Transamerica']],
}
let seq = 0
const mk = (kind, [f, l, city, st, car], o = {}) => {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, agent_id: AGENT, agent: { id: AGENT, full_name: 'Test agent' }, assigned: null,
    client_first_name: f, client_last_name: l, client_phone: `(555) 010-${String(2000 + seq * 37).slice(0, 4)}`, state: st, client_city: city, client_timezone: TZ,
    carrier_id: null, carrier_name: car, details: { current_carrier: car }, fulfillment_stage: kind === 'cancelled' ? 'Complete' : 'Assigned',
    scheduled_call_at: null, call_live_since: null, last_call_outcome: null, call_attempts: 0, last_call_at: null, recovery_step: null,
    recovery_retry_at: null, created_at: iso(-3 - seq % 9, 9, 5), updated_at: iso(-1), fulfillment_completed_at: null, ...o,
  }
}
const ROWS = []
NAMES.booked.forEach((n, i) => ROWS.push(mk('booked', n, { scheduled_call_at: iso(i < 3 ? 0 : i, [9, 11, 14, 10, 9, 13, 11, 16][i], i === 0 ? 30 : 0), call_live_since: i === 0 ? iso(0, 9, 30) : null })))
NAMES.noAnswer.forEach((n, i) => ROWS.push(mk('na', n, { last_call_outcome: 'no_answer', call_attempts: 2 - (i === 2 ? 1 : 0), last_call_at: iso(-1 - i), scheduled_call_at: iso(-1), recovery_step: ['retry_locked', 'followup', null][i], recovery_retry_at: iso(3, 10) })))
NAMES.confirm.forEach(n => ROWS.push(mk('confirm', n, { last_call_outcome: 'no_answer', call_attempts: 2, last_call_at: iso(-1), recovery_step: 'number_check' })))
NAMES.call.forEach(n => ROWS.push(mk('call', n, { last_call_outcome: 'no_answer', call_attempts: 3, last_call_at: iso(-2), recovery_step: 'call_directly' })))
NAMES.cancelled.forEach((n, i) => ROWS.push(mk('cancelled', n, { last_call_outcome: 'answered', call_attempts: 1, last_call_at: iso(-2 - i * 3), fulfillment_completed_at: iso(-2 - i * 3, 15), created_at: iso(-9 - i * 3) })))
const ID = { booked: ROWS[1].id, live: ROWS[0].id, needs: ROWS[13].id, confirm: ROWS[11].id, noAnswer: ROWS[8].id, cancelled: ROWS[14].id, cancelledOld: ROWS[19].id }

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'test.agent@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const profile = role => ({
  id: AGENT, role, full_name: role === 'admin' ? 'Admin' : role === 'fulfillment' ? 'Fulfillment rep' : 'Test agent', email: 'test.agent@example.com', timezone: TZ, is_active: true,
  billing_exempt: true, billing_status: 'active', billing_tier: 'standard', membership_tier: 'standard',
})

async function mock(page, o, state) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile(o.role || 'agent'))
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/functions/v1/')) return json(route, 200, { capabilities: {}, secrets: [] })
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'my_push_settings') return json(route, 200, { push_on: false })
      if (name === 'my_money_banner') return json(route, 200, null)
      return json(route, 200, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (req.method() !== 'GET') { state.writes.push(`${req.method()} ${table}`); return json(route, 200, []) }
      if (table === 'policies') {
        if (o.fail) return json(route, 500, { message: 'mock failure' })
        const mine = o.role === 'fulfillment' ? state.rows.map(r => ({ ...r, assigned_fulfillment_id: AGENT, assigned: { id: AGENT, full_name: 'Fulfillment rep' } })) : state.rows
        return rows(o.empty ? [] : mine)
      }
      if (table === 'app_settings') return rows([{ id: 1, agent_portal_v2: false, agent_billing_enforced: false }])
      if (table === 'recovery_config') return rows([{ id: 1, sms_live: false, voice_live: false, recording_live: false }])
      return json(route, 200, single ? null : [])
    }
    return json(route, 200, {})
  })
}

const SIZES = { 1920: { width: 1920, height: 1080 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

async function open(w, theme, o = {}) {
  const ctx = await browser.newContext({
    viewport: SIZES[w], colorScheme: theme, timezoneId: TZ, locale: 'en-US',
    ...(w === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null),
  })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  await ctx.clock.setFixedTime(NOW)
  const page = await ctx.newPage()
  const state = { rows: structuredClone(ROWS), writes: [], errors: [] }
  page.on('pageerror', e => state.errors.push(String(e)))
  await mock(page, o, state)
  return { ctx, page, state }
}
async function ready(page, sel) {
  await page.waitForSelector(sel, { timeout: 20000 })
  await page.waitForFunction(() => !/Loading (clients|your clients)/.test(document.body.innerText), null, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}
const SEL = w => (w === 390 ? '.ph-h1' : '.pl-page')
// What the page shows: side, tab, counts, list text.
const read = page => page.evaluate(() => {
  const on = [...document.querySelectorAll('.pl-seg button.is-on')].map(b => b.innerText.replace(/\s+/g, ' ').trim())
  const sel = document.querySelector('.pl-tab.is-sel .nm')?.innerText || null
  const phoneOn = [...document.querySelectorAll('.ph-seg-btn.is-on .ph-seg-label')].map(e => e.innerText)
  const groups = [...document.querySelectorAll('.ph-group-label')].map(e => e.innerText.replace(/\s+/g, ' ').trim())
  const rows = document.querySelectorAll('.pl-row').length + document.querySelectorAll('.ph-row').length
  return {
    side: on[0] || null, tab: sel, phoneFilter: phoneOn, groups, rows, drawer: !!document.querySelector('[role="dialog"]'),
    total: document.querySelector('.pl-total')?.innerText.replace(/\s+/g, ' ') || null,
    sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, h: window.innerHeight,
  }
})
const results = []
const log = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }

if (GROUP === 'agent') {
  for (const w of [1440, 1920, 390]) for (const theme of ['light', 'dark']) {
    for (const [tag, url] of [['progress', '/agent/clients'], ['clients', '/agent/clients?stage=cancelled'], ['needs', '/agent/clients?stage=needs'], ['clientopen', `/agent/clients?open=${ID.cancelled}`], ['empty', '/agent/clients']]) {
      if (tag === 'clientopen' && false) continue
      const { ctx, page, state } = await open(w, theme, tag === 'empty' ? { empty: true } : {})
      await page.goto(base + url)
      await ready(page, SEL(w))
      if (tag === 'empty') { await page.waitForTimeout(300) }
      const m = await read(page)
      await page.screenshot({ path: join(OUT, `${tag}-${w}-${theme}.png`) })
      const noSide = m.sw <= m.w
      const noPage = w === 390 ? true : m.sh <= m.h
      log(`${tag} ${w} ${theme}`, noSide && noPage && state.errors.length === 0, `sw=${m.sw}/${m.w} sh=${m.sh}/${m.h} errors=${state.errors.length} side=${m.side} tab=${m.tab}`)
      // the empty Clients side at desktop too
      if (tag === 'empty' && w !== 390) {
        await page.goto(base + '/agent/clients?stage=cancelled'); await ready(page, SEL(w))
        await page.screenshot({ path: join(OUT, `empty-clients-${w}-${theme}.png`) })
      }
      if (tag === 'empty' && w === 390) {
        await page.goto(base + '/agent/clients?stage=cancelled'); await ready(page, SEL(w))
        await page.screenshot({ path: join(OUT, `empty-clients-${w}-${theme}.png`) })
      }
      await ctx.close()
    }
  }
}

if (GROUP === 'urls') {
  const urls = [
    ['/agent/clients', 'In progress', 'Booked', []],
    ['/agent/clients?stage=all&range=week', 'In progress', 'Booked', []],
    ['/agent/clients?stage=booked', 'In progress', 'Booked', ['Booked']],
    ['/agent/clients?stage=noAnswer', 'In progress', 'No answer', ['No answer']],
    ['/agent/clients?stage=needs', 'In progress', 'Needs attention', ['Needs you']],
    ['/agent/clients?stage=needsAttention', 'In progress', 'Needs attention', ['Needs you']],
    ['/agent/clients?stage=confirmNumber', 'In progress', 'Needs attention', ['Needs you']],
    ['/agent/clients?stage=cancelled', 'Clients', null, []],
    [`/agent/clients?open=${ID.cancelled}`, 'Clients', null, []],
    [`/agent/clients?open=${ID.booked}`, 'In progress', 'Booked', []],
    [`/agent/clients?open=${ID.noAnswer}`, 'In progress', 'No answer', []],
    [`/agent/clients?open=${ID.needs}&rebook=1`, 'In progress', 'Needs attention', []],
    ['/agent/clients?range=month', 'In progress', 'Booked', []],
  ]
  for (const w of [1440, 390]) {
    for (const [url, side, tab, phoneFilter] of urls) {
      const { ctx, page, state } = await open(w, 'light')
      await page.goto(base + url)
      await ready(page, SEL(w))
      if (url.includes('rebook')) await page.waitForSelector('text=Re-book for', { timeout: 8000 }).catch(() => {})
      const m = await read(page)
      const sideOk = w === 390 ? (side === 'Clients' ? /^Clients/.test(m.side || '') : /^In progress/.test(m.side || '')) : (m.side || '').startsWith(side)
      const tabOk = w === 390 ? JSON.stringify(m.phoneFilter) === JSON.stringify(phoneFilter) : (tab === null || m.tab === tab)
      let extra = ''
      let ok = sideOk && tabOk
      if (url.includes('rebook')) { const picker = await page.locator('text=Re-book for').count(); ok = ok && picker > 0; extra += ` picker=${picker}` }
      if (url.includes('open=') && !url.includes('rebook')) {
        const drawerText = await page.locator('[role="dialog"], .ph-sheet, aside').allInnerTexts()
        extra += ` drawerSeen=${drawerText.length > 0}`
      }
      if (url.includes('range=month') || url.includes('range=week')) extra += ` total=${m.total}`
      log(`url ${w} ${url.replace('/agent/clients', '')}`, ok && state.errors.length === 0, `side=${m.side} tab=${m.tab} filter=${JSON.stringify(m.phoneFilter)}${extra}`)
      await ctx.close()
    }
  }
  // closing a drawer keeps the side (no stage in url)
  for (const w of [1440, 390]) {
    const { ctx, page } = await open(w, 'light')
    await page.goto(base + `/agent/clients?open=${ID.cancelled}`); await ready(page, SEL(w))
    await page.keyboard.press('Escape'); await page.waitForTimeout(700)
    const m = await read(page)
    log(`close keeps Clients side ${w}`, /^Clients/.test(m.side || '') && !page.url().includes('open='), `url=${page.url().replace(base, '')} side=${m.side}`)
    await ctx.close()
  }
}

if (GROUP === 'inter') {
  const w = 1440
  {
    const { ctx, page } = await open(w, 'light')
    await page.goto(base + '/agent/clients'); await ready(page, SEL(w))
    // recently booked
    const recent = await page.locator('.pl-rc').count()
    log('recently booked lists 3', recent === 3, `n=${recent}`)
    // / hotkey
    await page.keyboard.press('/')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    log('/ focuses search', focused === 'Find any client', focused)
    // search finds Paula Reyes (cancelled) -> jumps to Clients
    await page.keyboard.type('paula')
    await page.waitForSelector('[role="option"]')
    await page.screenshot({ path: join(OUT, 'search-1440-light.png') })
    await page.keyboard.press('Enter'); await page.waitForTimeout(600)
    let m = await read(page)
    log('search cancelled client jumps to Clients', /^Clients/.test(m.side) && m.drawer !== undefined && page.url().includes('stage=cancelled') && page.url().includes('open='), `${page.url().replace(base, '')} side=${m.side}`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    await page.keyboard.press('/'); await page.keyboard.type('helen'); await page.waitForSelector('[role="option"]')
    await page.keyboard.press('Enter'); await page.waitForTimeout(600)
    m = await read(page)
    log('search booked client jumps to In progress', /^In progress/.test(m.side) && m.tab === 'Booked', `${page.url().replace(base, '')} side=${m.side} tab=${m.tab}`)
    // drawer footer on booked
    let txt = await page.locator('body').innerText()
    log('booked drawer: Change this booking + Message Fulfillment', txt.includes('Change this booking') && txt.includes('Message Fulfillment'))
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    // live pulse on Booked
    const live = await page.locator('text=On a call').count()
    log('live pulse on Booked rows', live > 0, `n=${live}`)
    // next call box
    txt = await page.locator('.pl-next').innerText()
    log('next Fulfillment call box', /Next Fulfillment call/.test(txt), txt.replace(/\s+/g, ' '))
    await ctx.close()
  }
  {
    const { ctx, page } = await open(w, 'light')
    // needs: call & rebook, confirm number
    await page.goto(base + `/agent/clients?open=${ID.needs}`); await ready(page, SEL(w))
    let txt = await page.locator('body').innerText()
    log('needs drawer: Call & rebook', txt.includes('Call & rebook'))
    await page.screenshot({ path: join(OUT, 'drawer-needs-1440-light.png') })
    await page.goto(base + `/agent/clients?open=${ID.confirm}`); await ready(page, SEL(w))
    txt = await page.locator('body').innerText()
    log('confirm drawer: Confirm number', txt.includes('Yes, this is the right number') && txt.includes('Change number'))
    await page.goto(base + `/agent/clients?open=${ID.cancelled}`); await ready(page, SEL(w))
    await page.screenshot({ path: join(OUT, 'drawer-clients-1440-light.png') })
    txt = await page.locator('body').innerText()
    log('cancelled drawer: Message Fulfillment', txt.includes('Message Fulfillment'))
    await ctx.close()
  }
  for (const range of ['all', 'week', 'month']) {
    const { ctx, page } = await open(w, 'light')
    await page.goto(base + `/agent/clients?range=${range}`); await ready(page, SEL(w))
    const m1 = await read(page)
    await page.locator('.pl-seg button', { hasText: 'Clients' }).click(); await page.waitForTimeout(400)
    const m2 = await read(page)
    const sec = await page.locator('.pl-sec b').innerText().catch(() => '')
    log(`range=${range} counts`, true, `${m1.total} | In progress btn "${m1.side}" | clients side "${m2.side}" | sec="${sec.replace(/\s+/g, ' ')}" rows=${m2.rows}`)
    await ctx.close()
  }
  {
    // side switch round trip keeps the tab
    const { ctx, page } = await open(w, 'light')
    await page.goto(base + '/agent/clients?stage=noAnswer'); await ready(page, SEL(w))
    await page.locator('.pl-seg button', { hasText: 'Clients' }).click(); await page.waitForTimeout(300)
    let m = await read(page)
    const a = /^Clients/.test(m.side)
    await page.locator('.pl-seg button', { hasText: 'In progress' }).click(); await page.waitForTimeout(300)
    m = await read(page)
    log('switch sides and back keeps No answer', a && m.tab === 'No answer', `tab=${m.tab} url=${page.url().replace(base, '')}`)
    await ctx.close()
  }
  {
    const { ctx, page } = await open(w, 'light', { empty: true })
    await page.goto(base + '/agent/clients'); await ready(page, SEL(w))
    const txt = await page.locator('body').innerText()
    log('empty: Book a call button', txt.includes('Book a call') && txt.includes('No calls waiting'))
    await ctx.close()
  }
  {
    const { ctx, page } = await open(w, 'light', { fail: true })
    await page.goto(base + '/agent/clients'); await page.waitForTimeout(4000)
    const txt = await page.locator('body').innerText()
    await page.screenshot({ path: join(OUT, 'error-1440-light.png') })
    log('load error shows LoadError', /Couldn.t load|Try again/.test(txt))
    await ctx.close()
  }
  // phone
  {
    const { ctx, page } = await open(390, 'light')
    await page.goto(base + '/agent/clients'); await ready(page, SEL(390))
    await page.locator('.ph-search input').fill('pa'); await page.waitForTimeout(400)
    const groups = await page.locator('.ph-group-label').allInnerTexts()
    await page.screenshot({ path: join(OUT, 'phone-search-390-light.png') })
    log('phone search spans both sides', groups.some(g => /Cancelled/.test(g)) && groups.some(g => /Booked|No answer/.test(g)), groups.join(' | '))
    await page.locator('.ph-search input').fill('')
    await page.locator('.pl-seg button', { hasText: 'Clients' }).click(); await page.waitForTimeout(300)
    const t = await page.locator('body').innerText()
    log('phone Clients: coming soon sections', t.includes('Sold leads') && t.includes('Servicing') && t.includes('Coming soon'))
    // tap targets
    const small = await page.evaluate(() => [...document.querySelectorAll('.pl-seg button, .ph-row, .ph-seg-btn')].filter(e => e.getBoundingClientRect().height < 44).length)
    log('phone tap targets >= 44', small === 0, `small=${small}`)
    await page.locator('.ph-row').first().click(); await page.waitForTimeout(600)
    await page.screenshot({ path: join(OUT, 'phone-sheet-390-light.png') })
    await ctx.close()
  }
}

if (GROUP === 'other') {
  const LABEL = process.argv[4] || 'after'
  for (const [role, url, tag] of [['fulfillment', '/fulfillment/pipeline', 'fulfillment'], ['admin', '/admin/pipeline', 'admin']]) {
    for (const theme of ['light', 'dark']) {
      const { ctx, page, state } = await open(1440, theme, { role })
      await page.goto(base + url)
      await page.waitForSelector('.pl-page', { timeout: 20000 }).catch(() => {})
      await page.waitForTimeout(1500)
      const info = await page.evaluate(() => ({
        total: document.querySelector('.pl-total')?.innerText.replace(/\s+/g, ' ') || null,
        tabs: [...document.querySelectorAll('.pl-tab')].map(t => t.innerText.replace(/\s+/g, ' ')),
        rows: [...document.querySelectorAll('.pl-row2')].map(t => t.innerText.replace(/\s+/g, ' ')),
        nan: /NaN|undefined/.test(document.body.innerText),
        side: !!document.querySelector('.pl-seg'),
      }))
      await page.screenshot({ path: join(OUT, `${tag}-${LABEL}-1440-${theme}.png`) })
      writeFileSync(join(OUT, `${tag}-${LABEL}-${theme}.json`), JSON.stringify(info, null, 1))
      log(`${tag} ${LABEL} ${theme}`, !info.nan && info.total && state.errors.length === 0, JSON.stringify(info))
      if (role === 'admin' && theme === 'light') {
        await page.goto(base + '/agent/clients'); await page.waitForTimeout(1500)
        console.log('admin on /agent/clients lands on', page.url().replace(base, ''))
      }
      await ctx.close()
    }
  }
}

await browser.close()
await server.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
