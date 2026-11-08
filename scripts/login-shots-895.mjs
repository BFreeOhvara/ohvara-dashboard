// P895 — the new /login page: shots at 1440, 1920 and 390 in light and dark, layout numbers, and the sign-in,
// wrong-password, Forgot password and sign-up paths, with every Supabase call mocked (no real project or password).
//   node scripts/login-shots-895.mjs [outDir]
// Writes PNGs plus checks.json into outDir (default .p895-qa, not committed).
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || '.p895-qa'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

const AGENT = '11111111-1111-4111-8111-111111111111'
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const USER = { id: AGENT, aud: 'authenticated', role: 'authenticated', email: 'test.agent@example.com', app_metadata: {}, user_metadata: {}, factors: [], created_at: new Date().toISOString() }
const SESSION = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000, user: USER }
const PROFILE = { id: AGENT, role: 'agent', full_name: 'Test Agent', email: USER.email, is_active: true, timezone: 'America/Chicago' }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, st) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname
    if (path === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}')
      st.tokenCalls.push(body.email)
      if (body.password === 'right-password') { st.signedIn = true; return json(route, 200, SESSION) }
      return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' })
    }
    if (path === '/auth/v1/user') return json(route, 200, USER)
    if (path === '/auth/v1/factors' || path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/functions/v1/account-email') { st.resetCalls.push(JSON.parse(req.postData() || '{}')); return json(route, 200, { ok: true }) }
    if (path === '/functions/v1/self-signup') return json(route, 200, { open: true })
    if (path.startsWith('/functions/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, st.signedIn ? PROFILE : null)
    if (path.startsWith('/rest/v1/rpc/')) return json(route, 200, null)
    return json(route, 200, [])
  })
}

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch()
const checks = { layout: {}, flows: {}, errors: [] }

async function open(theme, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await ctx.addInitScript(th => { localStorage.setItem('ohvara-theme', th) }, theme)
  const page = await ctx.newPage()
  const st = { tokenCalls: [], resetCalls: [], signedIn: false }
  page.on('pageerror', e => checks.errors.push(`${theme} ${w}: ${e.message}`))
  await mock(page, st)
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.lg-card h2')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  return { ctx, page, st }
}

const VIEWS = [['1440', 1440, 900], ['1920', 1920, 1080], ['390', 390, 844]]
for (const theme of ['dark', 'light']) {
  for (const [name, w, h] of VIEWS) {
    const { ctx, page } = await open(theme, w, h)
    checks.layout[`${theme}-${name}`] = await page.evaluate(() => {
      const r = el => { const b = document.querySelector(el)?.getBoundingClientRect(); return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
      const card = r('.lg-card')
      const story = r('.lg-story')
      const flow = r('.lg-flow')
      const cs = getComputedStyle(document.querySelector('.lg-card'))
      return {
        card, story, flow,
        cardCentreX: card && +((card.x + card.w / 2) / innerWidth).toFixed(3),
        cardCentreY: card && +((card.y + card.h / 2) / innerHeight).toFixed(3),
        cardFirst: !story || !card || card.y < story.y || story.x + story.w <= card.x,
        hOverflow: document.documentElement.scrollWidth > innerWidth,
        vScroll: document.documentElement.scrollHeight - innerHeight,
        font: getComputedStyle(document.querySelector('.lg-card h2')).fontFamily.split(',')[0],
        cardBg: cs.backgroundColor, blur: cs.backdropFilter,
        theme: document.documentElement.dataset.theme,
        h1: document.querySelector('.lg-h1')?.textContent,
        oldWords: /cancel/i.test(document.body.innerText),
        signupHref: document.querySelector('.lg-join a')?.getAttribute('href'),
        bits: ['Forgot password?', 'Keep me signed in', 'Get the phone app', 'Privacy', 'Terms'].filter(t => !document.body.innerText.includes(t)),
        eye: !!document.querySelector('.sx-eye'),
      }
    })
    await page.screenshot({ path: join(OUT, `login-${theme}-${name}.png`), fullPage: name === '390' })
    await ctx.close()
  }
}

// Flows (dark, 1440): wrong password, right password -> /agent, Forgot password, sign-up link
{
  const { ctx, page, st } = await open('dark', 1440, 900)
  await page.fill('input[name=email]', 'test.agent@example.com')
  await page.fill('input[name=password]', 'wrong')
  await page.click('.sx-eye')
  checks.flows.eyeShows = await page.getAttribute('input[name=password]', 'type')
  await page.click('button[type=submit]')
  await page.waitForSelector('.sx-alert')
  checks.flows.wrong = await page.textContent('.sx-alert')
  await page.screenshot({ path: join(OUT, 'login-dark-1440-wrong.png') })
  await page.fill('input[name=password]', 'right-password')
  await page.click('button[type=submit]')
  await page.waitForURL(/\/agent/, { timeout: 15000 }).catch(() => {})
  checks.flows.afterSignIn = new URL(page.url()).pathname
  checks.flows.tokenCalls = st.tokenCalls.length
  await ctx.close()
}
{
  const { ctx, page, st } = await open('light', 1440, 900)
  await page.fill('input[name=email]', 'test.agent@example.com')
  await page.click('.sx-link--forgot')
  checks.flows.forgotPrefill = await page.inputValue('input[name=email]')
  await page.click('button[type=submit]')
  await page.waitForSelector('.sx-ok')
  checks.flows.forgotSent = st.resetCalls[0]
  await page.screenshot({ path: join(OUT, 'login-light-1440-forgot.png') })
  await page.click('.sx-btn--ghost')
  await page.click('.lg-join a')
  await page.waitForURL(/\/signup/)
  checks.flows.signupLands = new URL(page.url()).pathname
  await ctx.close()
}
{
  // /login?forgot=1 (the /signup "Reset your password" link) opens the reset form
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await mock(page, { tokenCalls: [], resetCalls: [] })
  await page.goto(base + '/login?forgot=1')
  await page.waitForSelector('.lg-card h2')
  checks.flows.forgotParam = await page.textContent('.lg-card h2')
  await ctx.close()
}

writeFileSync(join(OUT, 'checks.json'), JSON.stringify(checks, null, 2))
console.log(JSON.stringify(checks, null, 1))
await browser.close()
await server.close()
