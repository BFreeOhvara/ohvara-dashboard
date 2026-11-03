// Click-through check for the clickable template (/template). Nothing is committed; output goes to a temp folder.
//   node scripts/template-clickthrough.mjs                      production build + vite preview on localhost
//   node scripts/template-clickthrough.mjs --base-url <url>     a live site (polls up to 10 minutes for /template)
// Visits all 15 routes at 1440 and 390, light and dark, in a fresh logged-out browser each time, and fails on:
// a request that leaves the allowed host, a console or page error, sideways scroll, page text under 200 characters,
// a link that leaves /template or reaches an empty page, a button that changes neither the DOM nor the URL,
// or the named client missing from Clients, Calendar, Activity or Messages. Prints a table; exit 1 on any failure.
//   node scripts/template-clickthrough.mjs --logged-in          the shell at the real agent URLs on a faked backend (local build only)
// Same build, same passes, plus the role, phone-app, write, sign-out, delete, redirect and fake-id checks. It fakes
// every mock.supabase.co call and blocks every other host; it never uses a real login.
import process from 'node:process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, preview } from 'vite'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const BASE_ARG = flag('--base-url')
const LOGGED_IN = args.includes('--logged-in')
if (LOGGED_IN && BASE_ARG) { console.error('--logged-in runs only on the local build, on the faked backend.'); process.exit(1) }
const OUT = mkdtempSync(join(tmpdir(), 'template-clickthrough-'))
const AGENT_PAGES = ['/agent', '/agent/leads', '/agent/inbounds/sample-lead-1', '/agent/calendar', '/agent/clients', '/agent/clients/sample-client-1', '/agent/submit', '/agent/request-service', '/agent/activity', '/agent/billing', '/agent/more', '/settings', '/messages']
const ROUTES = LOGGED_IN ? AGENT_PAGES : ['', 'leads', 'leads/sample-lead-1', 'calendar', 'clients', 'clients/sample-client-1', 'submit', 'request-service', 'messages', 'activity', 'billing', 'settings', 'more', 'signup', 'welcome']
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const NAMED = 'Gloria Santos'
const NAMED_ON = ['clients', 'calendar', 'activity', 'messages']
const FOOT = 'Sample info. Changes reset when you reload.'
const SB_HOST = 'mock.supabase.co'
const failures = []
const rows = []
const fail = (where, msg) => { failures.push(`${where}: ${msg}`) }

let base
let server = null
if (BASE_ARG) {
  base = BASE_ARG.replace(/\/$/, '')
} else {
  process.env.VITE_SUPABASE_URL = 'https://mock.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'dummy-anon-key'
  const outDir = join(OUT, 'dist')
  console.log(`Building production bundle into ${outDir} ...`)
  await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } })
  const port = Number(process.env.PORT) || 5700 + Math.floor(Math.random() * 300)
  server = await preview({ logLevel: 'error', build: { outDir }, preview: { port, strictPort: true, host: '127.0.0.1' } })
  base = `http://127.0.0.1:${port}`
}
const BASE_HOST = new URL(base).host
const url = r => (LOGGED_IN ? `${base}${r}` : `${base}/template${r ? `/${r}` : ''}`)
const label = r => (LOGGED_IN ? r : `/template/${r}`)

const browser = await chromium.launch()
const norm = p => p.replace(/\/+$/, '') || '/'

// The faked backend for --logged-in. A role of null means no session.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const USER_ID = '00000000-0000-4000-8000-000000000001'
const writes = { profile: 0, lastLogin: 0, logout: 0, signupStatus: 0, deleteAccount: 0, other: [] }
let logoutAllowed = false
let shellDownloads = 0
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
function sessionFor(mfa) {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + 10 * 365 * 24 * 3600
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'sample@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  if (mfa) user.factors = [{ id: 'factor-1', status: 'verified', factor_type: 'totp' }]
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', aal: 'aal1', exp, iat })}.mock`, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: exp - iat, expires_at: exp, user }
}

async function fakeBackend(page, actor) {
  const profile = { id: USER_ID, role: actor.role, first_name: 'Sample', last_name: 'Person', full_name: 'Sample Person', email: 'sample@example.com', is_active: true }
  const strict = actor.role === 'agent' && !actor.native
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue()
    if (u.host === BASE_HOST) {
      if (/AgentShell/.test(u.pathname)) { if (actor.role === 'agent' && !actor.native) shellDownloads++; else fail(`${actor.role} ${page.url()}`, `downloaded ${u.pathname}`) }
      return route.continue()
    }
    return route.abort()
  })
  await page.route(`https://${SB_HOST}/**`, route => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const send = body => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (path === '/functions/v1/delete-account') { writes.deleteAccount++; fail('delete', `${method} ${path} on ${page.url()}`) }
    if (method !== 'GET' && method !== 'HEAD') {
      const body = req.postDataJSON() || {}
      const keys = Object.keys(body)
      if (method === 'POST' && path === '/rest/v1/rpc/get_my_profile') writes.profile++
      // The sign-in page asks whether sign-up is open. /login is not a shell page and this only reads; it is counted, not hidden.
      else if (method === 'POST' && path === '/functions/v1/self-signup' && new URL(page.url()).pathname === '/login' && keys.length === 1 && body.action === 'status') writes.signupStatus++
      else if (method === 'PATCH' && path === '/rest/v1/profiles' && keys.length === 1 && keys[0] === 'last_login_at') writes.lastLogin++
      else if (method === 'POST' && path === '/auth/v1/logout' && logoutAllowed) writes.logout++
      else if (strict) { writes.other.push(`${method} ${path}`); fail('write check', `${method} ${path} on ${page.url()}`) }
    }
    if (path === '/rest/v1/rpc/get_my_profile') return send(profile)
    if (path.startsWith('/auth/v1/') || path.startsWith('/functions/v1/')) return send({})
    if (path.startsWith('/rest/v1/rpc/')) return send([])
    return send((req.headers().accept || '').includes('vnd.pgrst.object') ? null : [])
  })
}

async function freshPage(view, theme, watch, actor = { role: 'agent' }) {
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, reducedMotion: 'reduce' })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* no storage */ } }, theme)
  if (LOGGED_IN && actor.role) await ctx.addInitScript(([session]) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(session)) }, [sessionFor(actor.mfa)])
  // Capacitor reads this bridge to decide it is inside the Android app.
  if (LOGGED_IN && actor.native) await ctx.addInitScript(() => { window.androidBridge = { postMessage() {} } })
  const page = await ctx.newPage()
  if (LOGGED_IN) await fakeBackend(page, actor)
  if (watch) {
    page.on('request', req => {
      const u = new URL(req.url())
      if (u.protocol === 'data:' || u.protocol === 'blob:') return
      if (LOGGED_IN ? u.host !== BASE_HOST && u.host !== SB_HOST : u.host !== BASE_HOST || /\.supabase\.co$/.test(u.hostname)) watch.outside.add(`${req.method()} ${u.host}${u.pathname}`)
    })
    page.on('console', m => { if (m.type() === 'error') watch.errors.add(`console: ${m.text().slice(0, 140)}`) })
    page.on('pageerror', e => watch.errors.add(`page: ${String(e.message).slice(0, 140)}`))
  }
  return { ctx, page }
}

async function open(page, r) {
  await page.goto(url(r), { waitUntil: 'load' })
  await page.waitForSelector('.tp', { timeout: 15000 })
  await page.waitForTimeout(250)
}

// Live site: wait until /template serves the template.
if (BASE_ARG) {
  const until = Date.now() + 10 * 60e3
  let ready = false
  const { ctx, page } = await freshPage(VIEWS[0], 'dark', null)
  while (Date.now() < until && !ready) {
    try {
      await page.goto(url(''), { waitUntil: 'load' })
      ready = await page.waitForSelector('.tp', { timeout: 8000 }).then(() => true, () => false)
    } catch { ready = false }
    if (!ready) { console.log('waiting for /template ...'); await new Promise(r => setTimeout(r, 15000)) }
  }
  await ctx.close()
  if (!ready) { console.error('FAIL: /template never served the template within 10 minutes'); process.exit(1) }
}

// A drawer's text and links, open, then closed again.
async function drawerView(page, title) {
  const button = title === 'Search' ? '.tp-search:visible, button[aria-label="Search"]:visible' : `button[aria-label="${title}"]:visible`
  const sheet = `[role="dialog"][aria-label="${title}"]`
  await page.locator(button).first().click()
  await page.waitForSelector(sheet)
  const seen = await page.evaluate(() => ({ text: document.body.innerText, hrefs: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')) }))
  await page.keyboard.press('Escape')
  await page.waitForSelector(sheet, { state: 'detached' })
  return seen
}

// Pass 1: every route, both sizes, both themes.
const links = new Set()
for (const view of VIEWS) {
  for (const theme of ['light', 'dark']) {
    for (const r of ROUTES) {
      const where = `${view.w} ${theme} ${label(r)}`
      const watch = { outside: new Set(), errors: new Set() }
      const { ctx, page } = await freshPage(view, theme, watch)
      try {
        await open(page, r)
        const m = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          len: document.body.innerText.trim().length,
          text: document.body.innerText,
          theme: document.documentElement.getAttribute('data-theme'),
          hrefs: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
        }))
        m.hrefs.forEach(h => links.add(h))
        if (view.w === 1440 && theme === 'dark' || view.w === 390 && theme === 'light') await page.screenshot({ fullPage: LOGGED_IN, path: join(OUT, `${view.w}-${theme}-${r.replaceAll('/', '_') || 'overview'}.png`) })
        const bad = []
        if (m.scroll) bad.push('sideways scroll')
        if (m.len < 200) bad.push(`page text ${m.len} characters`)
        if (m.theme !== theme) bad.push(`theme is ${m.theme}`)
        const base1 = r.split('/')[0]
        if (NAMED_ON.includes(base1) && !r.includes('/') && !m.text.includes(NAMED)) bad.push(`${NAMED} missing`)
        if (LOGGED_IN) {
          if (norm(new URL(page.url()).pathname) !== r) bad.push(`sent on to ${new URL(page.url()).pathname}`)
          if (!m.text.includes(FOOT)) bad.push(`footer "${FOOT}" missing`)
          for (const title of ['Menu', 'Search', 'Notifications']) {
            const d = await drawerView(page, title)
            d.hrefs.forEach(h => links.add(h))
            if (/template/i.test(d.text)) bad.push(`the word template is on screen with ${title} open`)
          }
        }
        if (watch.outside.size) bad.push(`outside requests ${[...watch.outside].join(', ')}`)
        if (watch.errors.size) bad.push([...watch.errors].join('; '))
        bad.forEach(b => fail(where, b))
        rows.push({ where, outside: watch.outside.size, errors: watch.errors.size, scroll: m.scroll ? 'yes' : 'no', text: m.len, result: bad.length ? 'FAIL' : 'ok' })
      } catch (e) {
        fail(where, String(e.message).split('\n')[0])
        rows.push({ where, outside: '-', errors: '-', scroll: '-', text: '-', result: 'FAIL' })
      }
      await ctx.close()
    }
  }
}

// Pass 2: follow every link found.
{
  const { ctx, page } = await freshPage(VIEWS[0], 'dark', null)
  const seen = new Set()
  const inScope = p => (LOGGED_IN ? /^\/(agent|settings|messages)(\/|$)/.test(p) : p.startsWith('/template'))
  for (const h of links) {
    const abs = new URL(h, LOGGED_IN ? `${base}/` : `${base}/template/`)
    if (abs.host !== BASE_HOST || !inScope(abs.pathname)) { fail('link', `${h} leaves ${LOGGED_IN ? 'the agent pages' : '/template'}`); continue }
    if (seen.has(abs.pathname)) continue
    seen.add(abs.pathname)
    try {
      await page.goto(abs.href, { waitUntil: 'load' })
      await page.waitForSelector('.tp', { timeout: 15000 })
      const end = new URL(page.url())
      const len = (await page.evaluate(() => document.body.innerText.trim().length))
      if (!inScope(end.pathname)) fail('link', `${h} ended at ${end.pathname}`)
      else if (norm(end.pathname) !== norm(abs.pathname)) fail('link', `${h} was sent on to ${end.pathname}`)
      if (len < 200) fail('link', `${h} reached a page with ${len} characters`)
    } catch (e) { fail('link', `${h}: ${String(e.message).split('\n')[0]}`) }
  }
  console.log(`Followed ${seen.size} distinct links.`)
  await ctx.close()
}

// Pass 3: click each visible button on a fresh load; it must change the DOM or the URL.
const VISIBLE = `(() => [...document.querySelectorAll('button, [role="button"]')].filter(b => {
  const r = b.getBoundingClientRect(); const cs = getComputedStyle(b)
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !b.disabled && b.getAttribute('aria-hidden') !== 'true'
}))()`
let clicked = 0
for (const view of VIEWS) {
  const { ctx, page } = await freshPage(view, 'dark', null)
  for (const r of ROUTES) {
    await open(page, r)
    const count = await page.evaluate(`${VISIBLE}.length`)
    for (let i = 0; i < count; i++) {
      if (i > 0) await open(page, r)
      const info = await page.evaluate(`(() => { const b = ${VISIBLE}[${i}]; return b ? (b.getAttribute('aria-label') || b.innerText || b.className).trim().slice(0, 40) : null })()`)
      if (info == null) continue
      const before = await page.evaluate(() => ({ dom: document.documentElement.outerHTML, url: location.href }))
      // Sign out is the one click allowed to write, and only while it lands on the sign-in page.
      const signingOut = LOGGED_IN && r === '/agent/more' && info === 'Sign out'
      logoutAllowed = signingOut
      try {
        await page.evaluate(`${VISIBLE}[${i}].scrollIntoView({ block: 'center' })`)
        const box = await page.evaluate(`(() => { const r = ${VISIBLE}[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
        await page.mouse.click(box.x, box.y)
        if (signingOut) await page.waitForURL(u => u.pathname === '/login', { timeout: 15000 })
        logoutAllowed = false
        await page.waitForTimeout(120)
        const after = await page.evaluate(() => ({ dom: document.documentElement.outerHTML, url: location.href }))
        clicked++
        if (after.dom === before.dom && after.url === before.url) fail(`${view.w} dark ${label(r)}`, `silent button "${info}"`)
      } catch (e) { logoutAllowed = false; fail(`${view.w} dark ${label(r)}`, `click "${info}": ${String(e.message).split('\n')[0]}`) }
    }
  }
  await ctx.close()
}
console.log(`Clicked ${clicked} buttons.`)

// The --logged-in passes that have no /template twin.
if (LOGGED_IN) {
  // Where a role lands, once the app has settled. Fails if the shell's .tp shows up when it should not (and the other way round).
  async function land(actor, path, want, { shell = false, minText = 0, view = VIEWS[0] } = {}) {
    const where = `${actor.role ?? 'logged out'}${actor.native ? ' phone app' : ''}${actor.mfa ? ' two-step' : ''} ${path}`
    const { ctx, page } = await freshPage(view, 'dark', null, actor)
    const end = () => { const u = new URL(page.url()); return u.pathname + u.search }
    try {
      await page.goto(url(path), { waitUntil: 'load' })
      await page.waitForURL(u => u.pathname + u.search === want, { timeout: 15000 }).catch(() => {})
      await page.waitForFunction(() => !document.querySelector('.animate-spin') && document.body.innerText.trim().length > 0, null, { timeout: 15000 }).catch(() => {})
      if (shell) await page.waitForSelector('.tp', { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(400)
      const m = await page.evaluate(() => ({ tp: !!document.querySelector('.tp'), len: document.body.innerText.trim().length }))
      const bad = []
      if (end() !== want) bad.push(`ended at ${end()}, wanted ${want}`)
      if (m.tp !== shell) bad.push(shell ? 'no .tp' : '.tp in the DOM')
      if (m.len < minText) bad.push(`page text ${m.len} characters`)
      bad.forEach(b => fail(where, b))
      console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${where} -> ${end()} (${shell ? 'shell' : 'no shell'}, ${m.len} characters)`)
    } catch (e) { fail(where, String(e.message).split('\n')[0]) }
    await ctx.close()
  }

  console.log('\nAdmin, Fulfillment, logged out:')
  const admin = { role: 'admin' }
  for (const p of ['/settings', '/messages', '/agent/submit', '/agent/activity']) await land(admin, p, p, { minText: 100 })
  await land(admin, '/agent/clients', '/admin/pipeline')
  await land(admin, '/agent/clients/x', '/admin/pipeline')
  await land(admin, '/fulfillment', '/admin')
  await land(admin, '/agent', '/admin')
  await land(admin, '/agent/request-service', '/admin')
  const ful = { role: 'fulfillment' }
  for (const p of ['/settings', '/messages']) await land(ful, p, p, { minText: 100 })
  await land(ful, '/agent/submit', '/fulfillment')
  await land(ful, '/agent/activity', '/fulfillment')
  await land(ful, '/agent/request-service', '/fulfillment')
  await land({ role: null }, '/agent', '/login')
  await land({ role: null }, '/agent/request-service', '/login')

  console.log('\nPhone app and two-step code:')
  // Request a service has no page in today's routes, so the app's catch-all sends it home.
  for (const p of AGENT_PAGES) await land({ role: 'agent', native: true }, p, p === '/agent/request-service' ? '/agent' : p, { view: VIEWS[1] })
  await land({ role: 'agent', mfa: true }, '/agent', '/login')

  console.log('\nRedirects and fake ids as agent:')
  const agent = { role: 'agent' }
  await land(agent, '/agent/book?change=x', '/agent/submit?change=x', { shell: true, minText: 200 })
  await land(agent, '/agent/inbounds?tab=live', '/agent/leads?tab=live', { shell: true, minText: 200 })
  await land(agent, '/agent/plan', '/agent/billing', { shell: true, minText: 200 })
  await land(agent, '/agent/submissions', '/agent/submit', { shell: true, minText: 200 })
  await land(agent, '/agent/policies', '/agent/clients', { shell: true, minText: 200 })
  await land(agent, '/agent/inbounds/not-a-real-id', '/agent/inbounds/not-a-real-id', { shell: true, minText: 200 })
  await land(agent, '/agent/clients/not-a-real-id', '/agent/clients/not-a-real-id', { shell: true, minText: 200 })

  // The dialog opens; it is never typed in or submitted.
  console.log('\nDelete my account:')
  for (const view of VIEWS) {
    for (const p of ['/settings', '/agent/more']) {
      const where = `delete ${view.w} ${p}`
      const { ctx, page } = await freshPage(view, 'dark', null)
      try {
        await open(page, p)
        await page.getByRole('button', { name: 'Delete my account' }).click()
        await page.waitForSelector('[role="dialog"][aria-labelledby="del-title"] #del-title', { timeout: 5000 })
        await page.screenshot({ path: join(OUT, `delete-${view.w}${p.replaceAll('/', '_')}.png`) })
        await page.getByRole('button', { name: 'Keep my account' }).click()
        await page.waitForSelector('#del-title', { state: 'detached', timeout: 5000 })
        console.log(`ok    ${where}: dialog opened, closed with Keep my account`)
      } catch (e) { fail(where, String(e.message).split('\n')[0]) }
      await ctx.close()
    }
  }

  // Sign out, then the sign-in page: it must look the same as one that never loaded the shell's stylesheet.
  console.log('\nSign out:')
  for (const view of VIEWS) {
    for (const theme of ['light', 'dark']) {
      const where = `sign out ${view.w} ${theme}`
      const { ctx, page } = await freshPage(view, theme, null)
      const before = writes.logout
      try {
        await open(page, '/agent/more')
        logoutAllowed = true
        await page.getByRole('button', { name: 'Sign out' }).click()
        await page.waitForURL(u => u.pathname === '/login', { timeout: 15000 })
        logoutAllowed = false
        if (writes.logout !== before + 1) fail(where, `${writes.logout - before} logout calls`)
        if (await page.evaluate(() => localStorage.getItem('sb-mock-auth-token'))) fail(where, 'the session is still stored')
        await page.mouse.move(0, 0)
        await page.evaluate(() => document.activeElement?.blur())
        await page.waitForTimeout(500)
        const after = await page.screenshot({ path: join(OUT, `login-after-sign-out-${view.w}-${theme}.png`) })
        const plain = await freshPage(view, theme, null, { role: null })
        await plain.page.goto(url('/login'), { waitUntil: 'load' })
        await plain.page.waitForSelector('input', { timeout: 15000 })
        await plain.page.evaluate(() => document.activeElement?.blur())
        await plain.page.waitForTimeout(500)
        const fresh = await plain.page.screenshot({ path: join(OUT, `login-fresh-${view.w}-${theme}.png`) })
        await plain.ctx.close()
        const same = after.equals(fresh)
        if (!same) fail(where, 'the sign-in page looks different after the shell was loaded')
        console.log(`${same ? 'ok  ' : 'FAIL'}  ${where}: POST /auth/v1/logout once, session cleared, /login pixel-equal to a fresh /login: ${same}`)
      } catch (e) { logoutAllowed = false; fail(where, String(e.message).split('\n')[0]) }
      await ctx.close()
    }
  }

  if (!shellDownloads) fail('shell', 'the agent never downloaded AgentShell, so the role download check proved nothing')
  console.log(`\nWrite list: get_my_profile ${writes.profile} (exempt), PATCH profiles last_login_at ${writes.lastLogin} (exempt), POST /auth/v1/logout ${writes.logout} (sign-out clicks only), anything else ${writes.other.length}. delete-account calls: ${writes.deleteAccount}.`)
  console.log(`Not on a shell page: the sign-in page's sign-up status read (POST /functions/v1/self-signup, action status) ${writes.signupStatus}.`)
}

await browser.close()
if (server) await server.close()

const pad = (s, n) => String(s).padEnd(n)
console.log(`\n${pad('screen (size theme route)', 44)}${pad('outside', 9)}${pad('errors', 8)}${pad('sideways', 10)}${pad('text', 7)}result`)
for (const r of rows) console.log(`${pad(r.where, 44)}${pad(r.outside, 9)}${pad(r.errors, 8)}${pad(r.scroll, 10)}${pad(r.text, 7)}${r.result}`)
console.log(`\nShots: ${OUT}`)
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`)
  failures.forEach(f => console.log(`  - ${f}`))
  process.exit(1)
}
console.log('\nAll checks passed.')
