// Settings → Contact (Text follow-up + Texting number): shots + checks with a mocked Supabase.
// Harness style from qa/goal-check-134a9cda/shots.mjs.   node qa/settings-texting-number/shots.mjs [outDir]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || 'qa/settings-texting-number'
mkdirSync(OUT, { recursive: true })
const SB = 'https://mock.supabase.co'
const SB_HOST = new URL(SB).host
const PORT = 5700 + Math.floor(Math.random() * 300)
const TZ = 'America/Chicago'
const USER = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-02T20:00:00Z')

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowSec = Math.floor(NOW.getTime() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated', aal: 'aal1', exp: nowSec + 36000, iat: nowSec })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowSec + 36000,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'test@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, o, state) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.host === `localhost:${PORT}` || u.host === SB_HOST) return route.continue()
    return route.abort()
  })
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const rows = all => json(route, 200, single ? all[0] ?? null : all)
    const profile = () => ({
      id: USER, role: o.role, full_name: 'Test User', email: 'test@example.com', timezone: TZ, is_active: true,
      billing_exempt: true, billing_status: 'active', billing_tier: 'standard', membership_tier: 'standard', has_servicing: true,
      no_answer_sms_opt_in: state.optIn,
    })
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, profile())
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: false, missing: [] })
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '')
      if (name === 'agent_portal_access') return json(route, 200, { self: false, servicing: true, leads: true, unlocked: true })
      if (name === 'my_push_settings') return json(route, 200, { push_on: false })
      return json(route, 200, [])
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      if (req.method() !== 'GET') {
        state.writes.push(`${req.method()} ${table}`)
        if (table === 'profiles' && o.failSave) return json(route, 500, { code: '500', message: 'boom' })
        if (table === 'profiles') state.optIn = !!JSON.parse(req.postData() || '{}').no_answer_sms_opt_in
        return json(route, 200, [])
      }
      if (table === 'recovery_config') return rows([{ id: true, sms_live: !!o.smsLive, voice_live: false, recording_live: false, reminder_time: '09:00:00', evening_time: '18:00:00', missed_grace_min: 10, missed_text_delay_min: 15 }])
      if (table === 'app_settings') return rows([{ id: 1, agent_portal_v2: false, agent_billing_enforced: false }])
      return json(route, 200, single ? null : [])
    }
    return json(route, 200, {})
  })
}

const SIZES = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } }
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

async function open(w, theme, o) {
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
  const state = { writes: [], errors: [], optIn: false }
  page.on('pageerror', e => state.errors.push(String(e)))
  await mock(page, o, state)
  await page.goto(`${base}/settings#contact`)
  await page.waitForSelector('section[aria-label="Text follow-up"]', { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(2500)
  return { ctx, page, state }
}
const widthOk = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }))
const text = page => page.evaluate(() => document.body.innerText)
// The harness page can remount once shortly after load (mock auth), wiping the open confirm box; click again until it stays.
async function openConfirm(page) {
  for (let i = 0; i < 5; i++) {
    await page.getByRole('switch', { name: 'Text clients after a missed call' }).click()
    await page.waitForTimeout(1200)
    if (await page.getByRole('checkbox').count()) return
  }
}
const log = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`)

// Warm-up: the first load makes Vite optimise dependencies and reload the page.
{ const w0 = await open(1280, 'light', { role: 'agent' }); await w0.page.waitForTimeout(4000); await w0.ctx.close() }

// 1. Agent and admin, two widths, two themes; texting live off and on.
for (const w of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const [role, smsLive] of [['agent', false], ['agent', true], ['admin', false]]) {
      const { ctx, page, state } = await open(w, theme, { role, smsLive })
      const t = await text(page)
      const m = await widthOk(page)
      await page.screenshot({ path: join(OUT, `${role}${smsLive ? '-live' : ''}-${w}-${theme}.png`), fullPage: true })
      const card = await page.locator('section[aria-label="Texting number"]').count()
      const order = await page.evaluate(() => {
        const s = [...document.querySelectorAll('section.ov-set-card')].map(e => e.getAttribute('aria-label'))
        return s.indexOf('Text follow-up') >= 0 && s.indexOf('Texting number') === s.indexOf('Text follow-up') + 1
      })
      const controls = await page.locator('section[aria-label="Texting number"] input, section[aria-label="Texting number"] button').count()
      const want = role === 'admin' ? card === 0
        : card === 1 && order && controls === 0 && t.includes(smsLive ? 'one shared number' : 'once carriers approve')
      log(`${role}${smsLive ? ' sms_live' : ''} ${w} ${theme}`, want && m.sw <= m.w && state.errors.length === 0, `card=${card} order=${order} controls=${controls} sw=${m.sw}/${m.w} errors=${state.errors.join('|')}`)
      await ctx.close()
    }
  }
}

// 2. Opt-in: Saved after turning on and off; a failed save shows the error; 44px targets.
for (const w of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    const { ctx, page, state } = await open(w, theme, { role: 'agent' })
    const sw = page.getByRole('switch', { name: 'Text clients after a missed call' })
    await openConfirm(page)
    const small = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Text follow-up"] button, section[aria-label="Text follow-up"] label')].filter(e => e.getBoundingClientRect().height < 44 && e.getAttribute('role') !== 'switch').map(e => e.innerText.trim() || e.getAttribute('aria-label')))
    await page.screenshot({ path: join(OUT, `optin-confirm-${w}-${theme}.png`), fullPage: true })
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Turn on' }).click()
    await page.waitForSelector('[role=status]')
    await page.screenshot({ path: join(OUT, `optin-saved-${w}-${theme}.png`), fullPage: true })
    const on = (await text(page)).includes('On. You agreed to this once')
    await page.waitForSelector('[role=status]', { state: 'detached', timeout: 5000 })
    await sw.click()
    await page.waitForSelector('[role=status]')
    const off = (await text(page)).includes('Off. Missed calls just show')
    const m = await widthOk(page)
    log(`opt-in on/off Saved ${w} ${theme}`, on && off && state.writes.length === 2 && m.sw <= m.w && small.length === 0, `on=${on} off=${off} writes=${state.writes} small=${small.join('|')} sw=${m.sw}/${m.w}`)
    await ctx.close()

    const f = await open(w, theme, { role: 'agent', failSave: true })
    await openConfirm(f.page)
    await f.page.getByRole('checkbox').check()
    await f.page.getByRole('button', { name: 'Turn on' }).click()
    await f.page.waitForSelector('text=Couldn’t save that', { timeout: 8000 })
    const ft = await text(f.page)
    await f.page.screenshot({ path: join(OUT, `optin-error-${w}-${theme}.png`), fullPage: true })
    log(`failed save shows error ${w} ${theme}`, ft.includes('Couldn’t save that') && !ft.includes('Saved') && ft.includes('I confirm my clients'), JSON.stringify({ e: ft.includes('Couldn’t save that'), s: ft.includes('Saved'), c: ft.includes('I confirm my clients') }))
    await f.ctx.close()
  }
}
await browser.close()
await server.close()
