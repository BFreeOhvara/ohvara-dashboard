// Agent page ease and card lift checks, every Supabase call mocked (no real project, no login, no live data).
//   node scripts/page-ease-check.mjs [outDir]
// Builds the app and serves the production build, so lazy pages are real chunks (delayed here, so a first visit
// really has an empty wrapper). Routes are walked by clicking links, at 1440 and 390, light and dark. Every
// animation frame from the click to 1500 ms is sampled. Writes checks.json and PNGs; exits 1 on any failed check.
import process from 'node:process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build, preview } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/page-ease'
const DIST = 'dist/page-ease-check'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5700 + Math.floor(Math.random() * 200)
mkdirSync(OUT, { recursive: true })

const ID = '11111111-1111-4111-8111-111111111111'
const NOW = Date.now()
const iso = ms => new Date(ms).toISOString()
const profileFor = (role, extra) => ({
  id: ID, role, full_name: 'Test Person', email: 'test.person@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: false, billing_status: 'active', billing_tier: 'standard', ...extra,
})
const TIERS = [
  { key: 'starter', name: 'Starter', weekly_cents: 4900, weekly_cap: 5, sort_order: 1, is_active: true },
  { key: 'standard', name: 'Standard', weekly_cents: 9900, weekly_cap: 15, sort_order: 2, is_active: true },
  { key: 'pro', name: 'Pro', weekly_cents: 19900, weekly_cap: null, sort_order: 3, is_active: true },
]
const client = (n, extra) => ({
  id: `2222222${n}-2222-4222-8222-222222222222`, agent_id: ID, client_first_name: ['Dana', 'Sam', 'Lee'][n], client_last_name: 'Client', client_phone: '+15555550100',
  state: 'TX', client_city: 'Austin', client_timezone: 'America/Chicago', carrier_id: null, carrier_name: 'Test Carrier', scheduled_call_at: iso(NOW + (n + 1) * 864e5),
  fulfillment_stage: 'New', assigned_fulfillment_id: null, last_call_outcome: null, call_attempts: 0, sms_consent: true, replaced_old_policy: true, policy_number: `P${n}`,
  created_at: iso(NOW - 864e5), updated_at: iso(NOW - 864e5), agent: { id: ID, full_name: 'Test Person' }, assigned: null, details: { current_carrier: 'Old Carrier' }, ...extra,
})
const POLICIES = [client(0), client(1), client(2)]

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(NOW / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ID, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const session = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: ID, aud: 'authenticated', role: 'authenticated', email: 'test.person@example.com', app_metadata: {}, user_metadata: {}, created_at: iso(NOW - 1e11) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const wait = ms => new Promise(r => setTimeout(r, ms))

async function mock(page, profile, { chunkDelay = 400, dataDelay = 250 } = {}) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? {} : all)
    if (path.startsWith('/functions/v1/agent-billing')) {
      return json(route, 200, {
        configured: true, amount_cents: 500, direction: 'up', invoices: [], card: null,
        subscription: { status: 'active', current_period_end: iso(NOW + 5 * 864e5), cancel_at_period_end: false, tier: 'standard' },
      })
    }
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile)
    await wait(dataDelay) // later data arriving must never start another ease
    if (path === '/rest/v1/agent_billing_tiers') return rows(TIERS)
    if (path === '/rest/v1/policies') return rows(POLICIES)
    if (path === '/rest/v1/app_settings') return rows([{ id: 1, agent_billing_enforced: false }])
    return rows([])
  })
  // The lazy pages' chunks, slow enough that a first visit really waits for them.
  await page.route(/\/assets\/(Calendar|Inbounds)[-.][^/]*\.js$/, async route => { await wait(chunkDelay); await route.continue() })
}

// In the page: samples every frame from before the click until `ms`.
const SAMPLER = () => {
  window.__startSampling = (ms = 1500) => {
    const s = { t0: performance.now(), ms, frames: 0, anims: [], seen: new Set(), minOpacity: 1, lowest: '', wrap: document.querySelector('.agent-motion'), waitFrames: 0, gotText: false, blankAfterText: 0, sideways: 0, fixedInTarget: new Set(), widthsEasing: new Set(), done: false }
    const note = (el, why) => {
      const o = Number(getComputedStyle(el).opacity)
      if (o < s.minOpacity) { s.minOpacity = o; s.lowest = `${why} ${el.tagName}.${el.className}` }
    }
    const tick = () => {
      const now = performance.now() - s.t0
      s.frames++
      for (const a of document.getAnimations()) {
        if (a.id === 'page-ease' && !s.seen.has(a)) { s.seen.add(a); s.anims.push(a); s.firstAt ??= now; s.lastAt = now }
      }
      const wrap = document.querySelector('.agent-motion')
      if (wrap) {
        // Each route has a new wrapper. Empty frames before its first content are the lazy page's fallback={null}.
        if (wrap !== s.wrap) { s.wrap = wrap; s.gotText = false }
        note(wrap, 'wrapper')
        for (const a of wrap.getAnimations({ subtree: true })) if (a.effect?.target) note(a.effect.target, a.id || a.animationName || 'anim')
        if (wrap.innerText.trim()) s.gotText = true
        else if (s.gotText) s.blankAfterText++
        else s.waitFrames++
      }
      for (const a of s.anims) {
        if (a.playState !== 'running' && a.playState !== 'paused') continue
        for (const n of a.effect.target.querySelectorAll('*')) if (getComputedStyle(n).position === 'fixed') s.fixedInTarget.add(n.className || n.tagName)
      }
      s.sideways = Math.max(s.sideways, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (s.anims.some(a => a.playState === 'running')) s.widthsEasing.add(document.documentElement.clientWidth)
      if (now < ms) requestAnimationFrame(tick); else s.done = true
    }
    window.__s = s
    requestAnimationFrame(tick)
  }
  window.__report = () => {
    const s = window.__s
    const targets = s.anims.map(a => a.effect.target)
    return {
      eases: s.anims.length, frames: s.frames, minOpacity: s.minOpacity, lowest: s.lowest, firstAt: Math.round(s.firstAt ?? -1), spread: Math.round((s.lastAt ?? 0) - (s.firstAt ?? 0)),
      fills: [...new Set(s.anims.map(a => a.effect.getComputedTiming().fill))],
      gotText: s.gotText, blankAfterText: s.blankAfterText, waitFrames: s.waitFrames, sideways: s.sideways, fixedInTarget: [...s.fixedInTarget],
      widthsEasing: [...s.widthsEasing], widthAtRest: document.documentElement.clientWidth,
      leftover: targets.reduce((n, t) => n + t.getAnimations().length, 0),
      transforms: [...new Set(targets.filter(t => t.isConnected).map(t => getComputedStyle(t).transform))],
      targets: targets.map(t => `${t.tagName.toLowerCase()}.${String(t.className).split(' ').slice(0, 2).join('.')}`),
    }
  }
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
await build({ logLevel: 'error', build: { outDir: DIST, emptyOutDir: true } })
const server = await preview({ logLevel: 'error', build: { outDir: DIST }, preview: { port: PORT, strictPort: true } })
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const results = []
const check = (name, ok, fail, extra) => {
  results.push({ name, pass: !!ok, ...(ok ? null : { fail }), ...extra })
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(fail)}`}`)
}

async function open({ w = 1440, h = 900, theme = 'dark', phone = false, reduced = false, role = 'agent', profile, start = '/agent', ...mocks }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference',
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null),
  })
  await ctx.addInitScript(([s, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
    localStorage.setItem('ohvara-theme', th)
  }, [session, theme])
  await ctx.addInitScript(SAMPLER)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await mock(page, profile || profileFor(role), mocks)
  await page.goto(`${base}${start}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main > div', { timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1200)
  return { ctx, page, errors, phone }
}

// Phone: pages off the tab bar open from More. Desktop: the sidebar has them all.
async function press(page, phone, sel) {
  const el = page.locator(sel).first()
  if (phone) await el.tap(); else await el.click()
}
// More has no Billing row: its Billing card's Manage billing button is the way there.
const MORE_ROW = { '/agent/leads': 'Leads', '/agent/calendar': 'Calendar', '/agent/activity': 'Activity', '/agent/billing': 'Manage billing', '/settings': 'Settings' }
// Gets to where the route's link can be pressed. Its own route change, so it comes before any sampling.
async function prepRoute(page, phone, path) {
  if (!phone || !MORE_ROW[path] || new URL(page.url()).pathname === '/agent/more') return
  const sub = await page.locator('.ph-subhead .ph-back').count()
  await press(page, phone, sub ? '.ph-subhead .ph-back' : '.ph-tabbar a[href="/agent/more"]')
  await page.waitForURL('**/agent/more')
  await page.waitForTimeout(700)
}
async function clickRoute(page, phone, path) {
  if (phone && MORE_ROW[path]) return press(page, phone, `.ph-main button:has-text("${MORE_ROW[path]}"), .ph-main a:has-text("${MORE_ROW[path]}")`)
  const sel = phone ? `.ph-tabbar a[href="${path}"]` : `aside a[href="${path}"], nav a[href="${path}"]`
  return press(page, phone, sel)
}

const WALK = ['/agent/clients', '/agent/calendar', '/agent/leads', '/agent/activity', '/agent/billing', '/settings', '/agent']
const TAG_FAIL = r => {
  const bad = []
  if (r.eases < 1) bad.push('no ease')
  if (r.minOpacity < 0.5) bad.push(`opacity ${r.minOpacity} ${r.lowest}`)
  if (r.fills.some(f => f !== 'backwards')) bad.push(`fill ${r.fills}`)
  if (r.blankAfterText) bad.push(`${r.blankAfterText} blank frames`)
  if (r.spread > 34) bad.push(`second start ${r.spread}ms after the first`)
  if (r.leftover) bad.push(`${r.leftover} animations left`)
  if (r.transforms.some(t => t !== 'none')) bad.push(`transform ${r.transforms}`)
  if (r.sideways > 0) bad.push(`sideways ${r.sideways}`)
  if (r.widthsEasing.some(w => w !== r.widthAtRest)) bad.push(`scrollbar came or went while easing ${r.widthsEasing} vs ${r.widthAtRest}`)
  if (r.fixedInTarget.length) bad.push(`fixed inside a target ${r.fixedInTarget}`)
  return bad
}

async function visit(page, phone, path) {
  await prepRoute(page, phone, path)
  await page.evaluate(() => window.__startSampling(1500))
  await clickRoute(page, phone, path)
  await page.waitForFunction(() => window.__s.done, null, { timeout: 15000 })
  await page.waitForURL(u => u.pathname === path, { timeout: 2000 })
  await page.waitForTimeout(350) // the last delayed block has ended by now
  return page.evaluate(() => window.__report())
}

try {
  // ── Walk: first visits (lazy chunks not loaded), then repeat visits ──────────
  for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
    for (const theme of ['light', 'dark']) {
      const tag = `${w}-${theme}`
      const { ctx, page, errors } = await open({ w, h, theme, phone })
      for (const round of ['first', 'repeat']) {
        for (const path of WALK) {
          const r = await visit(page, phone, path)
          const bad = TAG_FAIL(r)
          check(`${tag} ${round} ${path}`, !bad.length, bad, { eases: r.eases, frames: r.frames, minOpacity: r.minOpacity, firstAt: r.firstAt, waitFrames: r.waitFrames, targets: r.targets })
        }
      }
      check(`${tag} no page errors`, !errors.length, errors)
      await ctx.close()
    }
  }

  // ── Extra routes with fixed bars (Submit on a phone) and full bleed (Messages) ──
  for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
    const { ctx, page } = await open({ w, h, phone })
    for (const path of ['/messages', '/agent/submit']) {
      const r = await visit(page, phone, path)
      const bad = TAG_FAIL(r).filter(b => !(b === 'no ease' && path === '/agent/submit' && phone))
      check(`${w} extra ${path}`, !bad.length, bad, { eases: r.eases, targets: r.targets })
      if (phone && path === '/agent/submit') break
    }
    await ctx.close()
  }

  // ── Stagger: fill, and the last block paused at 0 ───────────────────────────
  {
    const { ctx, page } = await open({})
    await page.locator('aside a[href="/agent/clients"], nav a[href="/agent/clients"]').first().click()
    await page.waitForTimeout(800)
    await page.evaluate(() => {
      window.__firstFrame = new Promise(res => {
        const look = () => {
          const anims = document.getAnimations().filter(a => a.id === 'page-ease')
          if (!anims.length) return requestAnimationFrame(look)
          const fills = anims.map(a => a.effect.getComputedTiming().fill)
          const delays = anims.map(a => a.effect.getComputedTiming().delay)
          const durations = anims.map(a => a.effect.getComputedTiming().duration)
          const last = anims[anims.length - 1]
          last.pause(); last.currentTime = 0
          const cs = getComputedStyle(last.effect.target)
          const out = { n: anims.length, fills, delays, durations, opacity: cs.opacity, transform: cs.transform }
          last.cancel()
          res(out)
        }
        look()
      })
    })
    await page.locator('aside a[href="/agent/activity"], nav a[href="/agent/activity"]').first().click()
    const s = await page.evaluate(() => window.__firstFrame)
    check('stagger: every fill is backwards', s.fills.length > 1 && s.fills.every(f => f === 'backwards'), s, { s })
    check('stagger: 40 ms apart, 250 ms each', s.delays.every((d, i) => d === i * 40) && s.durations.every(d => d === 250), s)
    check('stagger: last target paused at 0 reads 0.5 and 8px', s.opacity === '0.5' && s.transform === 'matrix(1, 0, 0, 1, 0, 8)', s)
    await ctx.close()
  }

  // ── 50 ms into a route change: same text as at rest (repeat visit, data cached) ──
  for (const [w, h, phone, theme, path] of [[1440, 900, false, 'dark', '/agent/activity'], [1440, 900, false, 'light', '/agent/calendar'], [390, 844, true, 'dark', '/agent/calendar']]) {
    const tag = `${w}-${theme}`
    const { ctx, page } = await open({ w, h, theme, phone })
    await prepRoute(page, phone, path)
    await clickRoute(page, phone, path)
    await page.waitForTimeout(2100)
    const rest = await page.evaluate(() => document.querySelector('.agent-motion').innerText)
    await page.screenshot({ path: join(OUT, `${tag}${path.replaceAll('/', '-')}-rest.png`) })
    await (phone ? prepRoute(page, phone, path) : clickRoute(page, phone, '/agent'))
    await page.waitForTimeout(900)
    // Freeze the ease at 50 ms so the screenshot is that frame.
    await page.evaluate(() => {
      window.__frozen = new Promise(res => {
        const look = () => {
          const anims = document.getAnimations().filter(a => a.id === 'page-ease')
          if (!anims.length) return requestAnimationFrame(look)
          anims.forEach(a => { a.pause(); a.currentTime = 50 })
          res(anims.length)
        }
        look()
      })
    })
    await clickRoute(page, phone, path)
    const frozen = await page.evaluate(() => window.__frozen)
    const text50 = await page.evaluate(() => document.querySelector('.agent-motion').innerText)
    const opacities = await page.evaluate(() => document.getAnimations().filter(a => a.id === 'page-ease').map(a => Number(getComputedStyle(a.effect.target).opacity)))
    await page.screenshot({ path: join(OUT, `${tag}${path.replaceAll('/', '-')}-50ms.png`) })
    check(`${tag} ${path}: 50 ms frame has the resting text`, frozen > 0 && text50 === rest, { frozen, restLen: rest.length, at50Len: text50.length })
    check(`${tag} ${path}: 50 ms frame is at 0.5 or more`, opacities.length > 0 && opacities.every(o => o >= 0.5), opacities)
    await ctx.close()
  }

  // ── Drawers and modals right after a route change ───────────────────────────
  const settledBox = sel => page => page.evaluate(selector => {
    const el = document.querySelector(selector)
    if (!el) return null
    el.getAnimations().forEach(a => { if (a.id !== 'page-ease') a.finish() })
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }, sel)

  for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
    const rowSel = phone ? '.ph-main button:has-text("Dana"), .ph-main a:has-text("Dana"), .ph-main [role=button]:has-text("Dana")' : '.pl-row:has-text("Dana")'
    const drawerSel = '[role=dialog][aria-modal=true]'
    const openIt = async (delay, how) => {
      const { ctx, page } = await open({ w, h, phone, dataDelay: 0 })
      await clickRoute(page, phone, '/agent/clients')
      await page.waitForTimeout(600)
      await clickRoute(page, phone, '/agent')
      await page.waitForTimeout(600)
      await clickRoute(page, phone, '/agent/clients')
      const t0 = Date.now()
      if (delay) await page.waitForTimeout(delay)
      if (how === 'real') await press(page, phone, rowSel)
      else {
        await page.evaluate(sel => new Promise(res => {
          const q = sel.split(', ').map(s => s.replace(/:has-text\("Dana"\)/, '')).join(', ')
          const look = () => {
            const row = [...document.querySelectorAll(q)].find(e => e.textContent.includes('Dana'))
            if (!row) return requestAnimationFrame(look)
            row.click()
            res()
          }
          look()
        }), rowSel)
      }
      const took = Date.now() - t0
      await page.waitForSelector(drawerSel)
      const box = await settledBox(drawerSel)(page)
      const easeAlive = await page.evaluate(() => document.getAnimations().filter(a => a.id === 'page-ease').length)
      await ctx.close()
      return { box, took, easeAlive }
    }
    const later = await openIt(2000, 'real')
    const soon = await openIt(0, 'real')
    const soonNoPointer = await openIt(0, 'script')
    check(`${w} client drawer: real click at ${soon.took} ms matches after 2 s`, soon.box && JSON.stringify(soon.box) === JSON.stringify(later.box) && soon.easeAlive === 0, { soon, later })
    check(`${w} client drawer: scripted click at ${soonNoPointer.took} ms matches after 2 s`, soonNoPointer.box && JSON.stringify(soonNoPointer.box) === JSON.stringify(later.box), { soonNoPointer, later })
  }
  {
    const modal = async delay => {
      const { ctx, page } = await open({ dataDelay: 0 })
      await clickRoute(page, false, '/agent/billing')
      await page.waitForTimeout(1200)
      await clickRoute(page, false, '/agent')
      await page.waitForTimeout(800)
      await clickRoute(page, false, '/agent/billing')
      const t0 = Date.now()
      if (delay) await page.waitForTimeout(delay)
      // Clicked from inside the page as soon as it can open, with no pointerdown to stop the ease first.
      const easing = await page.evaluate(() => new Promise(res => {
        const look = () => {
          const dlg = document.querySelector('[role=dialog]')
          if (dlg) {
            dlg.getAnimations().forEach(a => a.finish())
            const r = dlg.getBoundingClientRect()
            return res({ running: document.getAnimations().filter(a => a.id === 'page-ease').length, left: r.left, width: r.width, inWrapper: !!dlg.closest('.agent-motion') })
          }
          const btn = [...document.querySelectorAll('.agent-motion button')].find(b => /^(Upgrade|Switch) to /.test(b.textContent.trim()))
          btn?.click()
          requestAnimationFrame(look)
        }
        look()
      }))
      const took = Date.now() - t0
      // Its text comes from a preview call, and the height follows the text; measure once that has landed.
      await page.waitForFunction(() => !document.querySelector('[role=dialog]').textContent.includes('Working out'))
      const box = await settledBox('[role=dialog]')(page)
      await page.screenshot({ path: join(OUT, `1440-billing-modal-${delay ? 'late' : 'soon'}.png`) })
      await ctx.close()
      return { box, took, easing }
    }
    const later = await modal(2000)
    const soon = await modal(0)
    check(`1440 billing modal: at ${soon.took} ms matches after 2 s`, soon.box && JSON.stringify(soon.box) === JSON.stringify(later.box) && soon.easing.left === later.box.left && soon.easing.width === later.box.width, { soon, later })
  }
  // A dialog landing inside a block mid-ease cancels the ease in that same frame, and a fixed node sits on the viewport.
  {
    const { ctx, page } = await open({})
    await page.evaluate(() => {
      window.__midEase = new Promise(res => {
        const look = () => {
          const anims = document.getAnimations().filter(a => a.id === 'page-ease')
          if (!anims.length) return requestAnimationFrame(look)
          const d = document.createElement('div')
          d.setAttribute('role', 'dialog')
          d.style.cssText = 'position:fixed;inset:0;'
          anims[0].effect.target.appendChild(d)
          queueMicrotask(() => {
            const r = d.getBoundingClientRect()
            // A fixed node on <body> shows what the viewport's box really is (the page reserves a scrollbar gutter).
            const ref = document.createElement('div')
            ref.style.cssText = 'position:fixed;inset:0;'
            document.body.appendChild(ref)
            const v = ref.getBoundingClientRect()
            ref.remove()
            res({ before: anims.length, states: anims.map(a => a.playState), left: r.left, top: r.top, width: r.width, height: r.height, vw: v.width, vh: v.height })
          })
        }
        look()
      })
    })
    await clickRoute(page, false, '/agent/activity')
    const m = await page.evaluate(() => window.__midEase)
    check('dialog in a block mid-ease cancels the ease first', m.states.every(s => s === 'idle') && m.left === 0 && m.top === 0 && m.width === m.vw && m.height === m.vh, m)
    await ctx.close()
  }
  // The first key press stops the ease.
  {
    const { ctx, page } = await open({})
    await page.evaluate(() => { window.__startSampling(600) })
    await clickRoute(page, false, '/agent/activity')
    await page.keyboard.press('Shift')
    const alive = await page.evaluate(() => window.__s.anims.filter(a => a.playState === 'running').length)
    const running = await page.evaluate(() => document.getAnimations().filter(a => a.id === 'page-ease').length)
    check('a key press cancels the ease', alive === 0 && running === 0, { alive, running })
    await ctx.close()
  }

  // ── A banner above a lazy page does not count as its content ────────────────
  {
    const { ctx, page, errors } = await open({ profile: profileFor('agent', { email_confirm_pending: true }) })
    const r = await visit(page, false, '/agent/calendar')
    const banner = await page.evaluate(() => !!document.querySelector('.ov-confirm-banner'))
    check('confirm banner + first lazy visit: the page eases, the banner does not', banner && r.eases > 0 && !r.targets.some(t => t.includes('ov-confirm-banner')) && r.firstAt > 300, { banner, ...r })
    check('confirm banner: no page errors', !errors.length, errors)
    await ctx.close()
  }
  // ── A lazy chunk later than 1500 ms just appears, complete ──────────────────
  {
    const { ctx, page } = await open({ chunkDelay: 2200 })
    await page.evaluate(() => window.__startSampling(3000))
    await clickRoute(page, false, '/agent/calendar')
    await page.waitForFunction(() => window.__s.done, null, { timeout: 15000 })
    const r = await page.evaluate(() => window.__report())
    check('lazy chunk past 1500 ms: no ease, complete at 1', r.eases === 0 && r.gotText && r.minOpacity === 1, r)
    await ctx.close()
  }

  // ── Reduced motion ──────────────────────────────────────────────────────────
  for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
    const { ctx, page } = await open({ w, h, phone, reduced: true })
    for (const path of ['/agent/clients', '/agent/calendar', '/agent']) {
      await prepRoute(page, phone, path)
      await page.evaluate(() => window.__startSampling(700))
      await clickRoute(page, phone, path)
      await page.waitForFunction(() => window.__s.done)
      const r = await page.evaluate(() => window.__report())
      const wrapperAnim = await page.evaluate(() => getComputedStyle(document.querySelector('.agent-motion')).animationName)
      check(`${w} reduced motion ${path}: no ease`, r.eases === 0 && r.minOpacity === 1 && wrapperAnim === 'none', { ...r, wrapperAnim })
    }
    if (!phone) {
      const card = page.locator('.agent-motion .ov-card').first()
      const before = await card.boundingBox()
      await card.hover()
      await page.waitForTimeout(300)
      const after = await card.boundingBox()
      check('reduced motion: a card does not move on hover', before.y === after.y, { before: before.y, after: after.y })
    }
    await ctx.close()
  }

  // ── Hover lift ──────────────────────────────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open({ theme })
    const cards = await page.locator('.agent-motion .ov-card').count()
    let moved = 0
    const moves = []
    for (let i = 0; i < cards; i++) {
      const card = page.locator('.agent-motion .ov-card').nth(i)
      await page.mouse.move(2, 2)
      await page.waitForTimeout(220)
      const before = await card.boundingBox()
      if (!before || before.y + before.height / 2 > 900) continue
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
      await page.waitForTimeout(260)
      const after = await card.boundingBox()
      const d = before.y - after.y
      moves.push(Math.round(d * 100) / 100)
      if (d >= 1 && d <= 2) moved++
    }
    const nested = await page.locator('.agent-motion .ov-card .ov-card').count()
    check(`${theme} /agent: hovered cards rise 1 to 2 px`, moved > 0 && moves.every(d => d >= 1 && d <= 2), moves, { cards, moved, moves, nested })
    const card = page.locator('.agent-motion .ov-card').first()
    const b = await card.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(260)
    const shadow = await card.evaluate(e => getComputedStyle(e).boxShadow)
    const insets = (shadow.match(/inset/g) || []).length
    const layers = shadow.split(/,(?![^(]*\))/).length
    const want = theme === 'light' ? [4, 2] : [2, 1]
    check(`${theme}: lift keeps the shadow layers (${want[0]} total, ${want[1]} inset)`, layers === want[0] && insets === want[1], shadow)
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    check(`${theme}: lift adds no sideways scroll`, sideways <= 0, sideways)
    await page.screenshot({ path: join(OUT, `1440-${theme}-agent-hover.png`) })

    // Clients: the full list box stays; a modal stays.
    await clickRoute(page, false, '/agent/clients')
    await page.waitForTimeout(900)
    const list = page.locator('.pl-list').first()
    const lb = await list.boundingBox()
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
    await page.waitForTimeout(260)
    const la = await list.boundingBox()
    check(`${theme} .pl-list does not move`, lb.y === la.y, { before: lb.y, after: la.y })
    await page.locator('.pl-row:has-text("Dana")').first().click()
    await page.waitForSelector('[role=dialog][aria-modal=true]')
    await page.waitForTimeout(350)
    await ctx.close()
  }
  {
    const { ctx, page } = await open({})
    await clickRoute(page, false, '/agent/billing')
    await page.waitForTimeout(1200)
    await page.locator('.agent-motion button:has-text("Switch"), .agent-motion button:has-text("Upgrade"), .agent-motion button:has-text("Choose")').first().click()
    const m = page.locator('[role=dialog]').first()
    await m.waitFor()
    await page.waitForTimeout(300)
    const before = await m.boundingBox()
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.waitForTimeout(260)
    const after = await m.boundingBox()
    check('a modal does not move on hover', before.y === after.y, { before: before.y, after: after.y })
    await ctx.close()
  }
  // Pointer parked on a card's bottom pixel: the lift must not flicker in and out.
  {
    const { ctx, page } = await open({})
    const card = page.locator('.agent-motion .ov-card').first()
    const b = await card.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 0.5)
    await page.evaluate(() => {
      const c = document.querySelector('.agent-motion .ov-card')
      window.__tops = []
      const t0 = performance.now()
      const tick = () => { window.__tops.push(c.getBoundingClientRect().top); if (performance.now() - t0 < 1500) requestAnimationFrame(tick) }
      tick()
    })
    await page.waitForTimeout(1600)
    const tops = await page.evaluate(() => window.__tops)
    let turns = 0
    for (let i = 2; i < tops.length; i++) if ((tops[i] - tops[i - 1]) * (tops[i - 1] - tops[i - 2]) < 0) turns++
    results.push({ name: 'info: pointer on the bottom pixel', pass: true, turns, frames: tops.length })
    console.log(`info  pointer on a card's bottom pixel: ${turns} direction changes in ${tops.length} frames`)
    await ctx.close()
  }

  // ── At 390 with touch: no lift ──────────────────────────────────────────────
  {
    const { ctx, page } = await open({ w: 390, h: 844, phone: true })
    const card = page.locator('.agent-motion .ov-card').first()
    const before = await card.boundingBox()
    await card.hover({ force: true })
    await page.waitForTimeout(260)
    const after = await card.boundingBox()
    const matches = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)
    check('390 touch: no lift', before.y === after.y && !matches, { before: before.y, after: after.y, matches })
    await ctx.close()
  }

  // ── Fulfillment and Admin stay as they are ──────────────────────────────────
  for (const [role, start, others] of [['fulfillment', '/fulfillment', ['/fulfillment/pipeline', '/settings']], ['admin', '/admin', ['/admin/pipeline', '/settings']]]) {
    for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
      const { ctx, page } = await open({ w, h, phone, role, start })
      for (const path of [start, ...others]) {
        if (path !== start) {
          await page.evaluate(p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
          await page.waitForTimeout(700)
        }
        const info = await page.evaluate(() => {
          const wrap = (document.querySelector('.ph-main') || document.querySelector('main')).firstElementChild
          return { cls: wrap.className, anim: wrap.style.animation, eases: document.getAnimations().filter(a => a.id === 'page-ease').length }
        })
        check(`${role} ${w} ${path}: fadeUp 160ms kept, no agent motion`, /fadeUp/.test(info.anim) && /160ms/.test(info.anim) && !info.cls.includes('agent-motion') && info.eases === 0, info)
        if (!phone) {
          const card = page.locator('main .ov-card').first()
          if (await card.count()) {
            const before = await card.boundingBox()
            await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
            await page.waitForTimeout(260)
            const after = await card.boundingBox()
            check(`${role} ${path}: a card does not move on hover`, before.y === after.y, { before: before.y, after: after.y })
            await page.mouse.move(2, 2)
          }
        }
      }
      await ctx.close()
    }
  }
  // Admin on an agent page is still an agent page.
  {
    const { ctx, page } = await open({ role: 'admin', start: '/agent/activity' })
    const info = await page.evaluate(() => { const w = document.querySelector('main').firstElementChild; return { cls: w.className, anim: w.style.animation } })
    check('admin on /agent/activity: agent motion, no fadeUp', info.cls.includes('agent-motion') && !info.anim, info)
    await ctx.close()
  }
} finally {
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(results, null, 1))
  await browser.close()
  await server.close()
  rmSync(DIST, { recursive: true, force: true })
}
const failed = results.filter(r => !r.pass)
console.log(`${results.length - failed.length} of ${results.length} passed`)
process.exit(failed.length ? 1 : 0)
