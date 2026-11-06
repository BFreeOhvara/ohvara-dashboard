// P837 proof: the Fulfillment shell at the real Fulfillment URLs, signed in as the test Fulfillment login in
// ~/.atlas/test-logins.json ("fulfill"). Also checks the agent shell and the admin pages are unchanged.
//   node scripts/ful-shell-837.mjs --base-url <url> [--no-shots] [--out qa/fulfillment-845] [--preview]
// P845: the rebuilt VA pages (sample info). Adds Overview and each record drawer's own URL, and --preview: the same
// P846: Calls became Schedule (calendar, rota, day off, live-call overlay); checks cover those and the old /desk redirect.
// pages at /template/fulfillment with no sign-in (Messages and Settings at /fulfillment/messages|settings there),
// plus a click-through of the VA flows. The agent/admin checks run in the signed-in mode only.
// Each page x 1920/1440/390 x light/dark: the shell frame is there, the title, tabs (desktop) or bottom bar (phone),
// no console errors, no sideways scroll. Every non-GET request to the backend is listed (the shell adds none).
// Only clicks that read: the search palette and the account menu, each closed with Escape.
import process from 'node:process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const SHOTS = !args.includes('--no-shots')
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
const PREVIEW = args.includes('--preview')
const logins = PREVIEW ? {} : JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const OUT = flag('--out') || 'qa/fulfillment-845'
const PRE = PREVIEW ? '/template' : ''
mkdirSync(OUT, { recursive: true })

const URLS = [['overview', '/fulfillment'], ['queue', '/fulfillment/leads'], ['schedule', '/fulfillment/schedule'], ['clients', '/fulfillment/pipeline'],
  ['servicing', '/fulfillment/servicing'], ['pay', '/fulfillment/pay'],
  ['messages', PREVIEW ? '/fulfillment/messages' : '/messages'], ['settings', PREVIEW ? '/fulfillment/settings' : '/settings'],
  ['queue-drawer', '/fulfillment/leads/vq-1'], ['call-drawer', '/fulfillment/schedule/cl-8'], ['callback-drawer', '/fulfillment/schedule/vq-1'], ['booked-drawer', '/fulfillment/schedule/ap-1'], ['client-drawer', '/fulfillment/pipeline/fc-gloria'], ['servicing-drawer', '/fulfillment/servicing/st-1']]
const VIEWS = [{ w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 390, h: 844 }]
const failures = []
const writes = new Set()
const fail = (where, msg) => failures.push(`${where}: ${msg}`)
const browser = await chromium.launch()

async function signIn(role, theme, view) {
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: theme })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(`page: ${e.message.slice(0, 200)}`))
  page.on('request', r => {
    if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /supabase\.co/.test(r.url()) && !/\/auth\/v1\//.test(r.url())) {
      const rpc = r.url().replace(/^https:\/\/[^/]+/, '').split('?')[0]
      // Reads that PostgREST sends as POST (rpc) are listed by name; the reviewer checks none of them write.
      writes.add(`${role} ${r.method()} ${rpc}`)
    }
  })
  if (PREVIEW) return { ctx, page, errors }
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="you@email.com"]', logins[role].email)
  await page.fill('input[placeholder="Your password"]', logins[role].password)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => fail(role, `still on ${page.url()} after sign-in`))
  await page.waitForLoadState('networkidle')
  return { ctx, page, errors }
}

const rows = []
for (const theme of ['light', 'dark']) {
  for (const view of VIEWS) {
    const { ctx, page, errors } = await signIn('fulfill', theme, view)
    for (const [key, url] of URLS) {
      const where = `fulfill ${view.w} ${theme} ${url}`
      errors.length = 0
      await page.goto(`${BASE}${PRE}${url}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1400)
      const m = await page.evaluate(() => {
        const app = document.querySelector('.tp-app.fs')
        const vis = el => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none'
        return {
          shell: !!app,
          path: location.pathname.replace(/^\/template(?=\/)/, ''),
          drawer: vis(document.querySelector('.fx-rec')),
          sample: /Sample info/.test(document.body.innerText),
          title: [...document.querySelectorAll('.fx-head .fx-line')].map(e => e.textContent.trim()).join(' '),
          tabs: vis(document.querySelector('.fx-top .fx-tabs')),
          bar: vis(document.querySelector('.fx-bar')),
          rail: vis(document.querySelector('.fx-rail')),
          side: document.documentElement.scrollWidth - window.innerWidth,
          crash: /Something went wrong/i.test(document.body.innerText),
          oldSidebar: !!document.querySelector('aside.sidebar, .ov-sidebar, nav[aria-label="Main"]'),
          text: (document.querySelector('.fs-main')?.innerText || '').length,
        }
      })
      const phone = view.w < 768
      if (!m.shell) fail(where, 'no Fulfillment shell')
      if (m.path !== url) fail(where, `landed on ${m.path}`)
      if (phone ? !m.bar : !(m.tabs && m.rail)) fail(where, phone ? 'no bottom bar' : 'no tabs/rail')
      if (m.side > 1) fail(where, `sideways scroll ${m.side}px`)
      if (m.crash) fail(where, 'crash card')
      if (m.text < 20) fail(where, 'page body is empty')
      if (key.endsWith('-drawer') && !m.drawer) fail(where, 'record drawer did not open at its URL')
      if (!m.sample) fail(where, 'no sample-info line')
      const errs = errors.filter(e => !/favicon|Failed to load resource: the server responded with a status of 40[34]/.test(e))
      if (errs.length) fail(where, `console: ${errs.join(' | ')}`)
      rows.push({ where, ...m, errors: errs.length })
      // The Schedule is two screens tall (calendar, then the rota): a full-page shot catches the week tile mid-animation, so it is two viewport shots.
      if (SHOTS && key === 'schedule') {
        await page.screenshot({ path: `${OUT}/${key}-${view.w}-${theme}.png` })
        await page.locator('.fs-rota').scrollIntoViewIfNeeded()
        await page.waitForTimeout(700)
        await page.screenshot({ path: `${OUT}/${key}-rota-${view.w}-${theme}.png` })
      } else if (SHOTS) await page.screenshot({ path: `${OUT}/${key}-${view.w}-${theme}.png`, fullPage: view.w >= 768 && !key.endsWith('-drawer') })
    }
    if (view.w === 1440) {
      await page.goto(`${BASE}${PRE}/fulfillment`, { waitUntil: 'networkidle' })
      await page.keyboard.press('Control+k')
      const pal = await page.locator('.fx-pal').isVisible().catch(() => false)
      if (!pal) fail(`fulfill ${theme}`, 'Ctrl K did not open search')
      if (SHOTS && pal) await page.screenshot({ path: `${OUT}/search-1440-${theme}.png` })
      await page.keyboard.press('Escape')
      await page.click('.fx-tr .fx-me')
      const menu = await page.locator('.fx-menu').isVisible().catch(() => false)
      if (!menu) fail(`fulfill ${theme}`, 'account menu did not open')
      if (SHOTS && menu) await page.screenshot({ path: `${OUT}/menu-1440-${theme}.png` })
      await page.keyboard.press('Escape')
      if (PREVIEW) await clickThrough(page, theme, errors)
    }
    await ctx.close()
  }
}

// P845: the VA flows, sample only (nothing leaves the browser in the preview).
async function clickThrough(page, theme, errors) {
  const where = `flow ${theme}`
  const step = async (name, fn) => { try { await fn() } catch (e) { fail(where, `${name}: ${e.message.split('\n')[0]}`) } }
  errors.length = 0
  const go = async url => { await page.goto(`${BASE}/template${url}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700) }
  await step('queue take + book', async () => {
    await go('/fulfillment/leads/vq-3')
    await page.getByRole('button', { name: 'Take it' }).click()
    await page.locator('.fx-rec select').first().selectOption('Coverage question')
    await page.locator('.fx-rec input').first().fill('Globe Life')
    await page.getByRole('radio', { name: 'This week' }).click()
    if (!(await page.getByRole('button', { name: 'Book an agent' }).isEnabled())) throw new Error('Book stayed off after 4 answers')
    await page.getByRole('button', { name: 'Book an agent' }).click()
    if (SHOTS) await page.screenshot({ path: `${OUT}/flow-book-1440-${theme}.png` })
    await page.getByRole('button', { name: 'Book it' }).click()
    await page.waitForTimeout(700)
    if (await page.locator('.fx-board').getByText('Shirley Adams').count()) throw new Error('booked lead still on the board')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    // In-app navigation: the sample changes live in memory, so a reload would forget the booking.
    await page.locator('.fx-top').getByRole('link', { name: 'Schedule' }).click()
    await page.waitForTimeout(900)
    if (!(await page.locator('.fx-week a.tp-ev', { hasText: 'Shirley Adams' }).count())) throw new Error('booked appointment not on the Schedule')
  })
  await step('schedule: every kind opens, rota, old address redirects', async () => {
    await go('/fulfillment/desk/cl-8')
    if (new URL(page.url()).pathname !== '/template/fulfillment/schedule/cl-8') throw new Error(`old Calls drawer address landed on ${new URL(page.url()).pathname}`)
    await go('/fulfillment/desk')
    if (new URL(page.url()).pathname !== '/template/fulfillment/schedule') throw new Error('old Calls address did not land on Schedule')
    const top = await page.locator('.fx-top .fx-tabs').innerText()
    if (!/Schedule/.test(top) || /Calls/.test(top)) throw new Error(`tabs read: ${top.replace(/\n/g, ' ')}`)
    // every kind of item is on the calendar, and each opens its drawer at its own address
    const ev = await page.locator('.fx-week a.tp-ev').count()
    if (ev < 12) throw new Error(`only ${ev} items on the week`)
    for (const [ref, text] of [['cl-8', 'Cancellation call'], ['vq-1', 'Queue'], ['ap-1', 'Booked for Dana']]) {
      await go(`/fulfillment/schedule/${ref}`)
      if (!(await page.locator('.fx-rec').getByText(text).first().isVisible())) throw new Error(`${ref} drawer missing "${text}"`)
    }
    await go('/fulfillment/schedule')
    await page.locator('.fx-week a.tp-ev', { hasText: 'Angela Moore' }).click()
    await page.waitForTimeout(500)
    if (!/schedule\/vq-1$/.test(new URL(page.url()).pathname)) throw new Error('clicking a callback did not open its address')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.getByRole('radio', { name: 'Next week' }).click().catch(async () => { await page.getByRole('tab', { name: 'Next week' }).click() })
    await page.waitForTimeout(500)
    if (!(await page.locator('.fs-rota-t').getByText('Leo Grant').isVisible())) throw new Error('rota missing')
    if ((await page.locator('.fx-week .tp-tgrid-h b').count()) !== 5) throw new Error('week is not 5 days')
    if (SHOTS) await page.screenshot({ path: `${OUT}/flow-schedule-next-1440-${theme}.png`, fullPage: true })
  })
  await step('live call overlay + day off', async () => {
    await go('/fulfillment')
    if (!(await page.getByText(/Your shift today\s*8:00 AM to 6:00 PM/).first().isVisible())) throw new Error('Overview has no shift line')
    if (await page.locator('[aria-label="Active or away"], [role="switch"][aria-label="Active"]').count()) throw new Error('an Active/Away switch is still on the page')
    await page.getByRole('button', { name: 'Live call' }).click()
    await page.waitForTimeout(500)
    if (!(await page.getByText('Calling from the portal is switched off').isVisible())) throw new Error('live call overlay did not open from the rail')
    if (SHOTS) await page.screenshot({ path: `${OUT}/flow-live-overlay-1440-${theme}.png` })
    await page.getByRole('button', { name: 'Open the call' }).click()
    await page.waitForTimeout(600)
    if (!/schedule\/cl-\d+$/.test(new URL(page.url()).pathname)) throw new Error(`Open the call went to ${new URL(page.url()).pathname}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Request a day off' }).first().click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Tell the team' }).click()
    await page.waitForTimeout(500)
    await page.locator('.fx-top').getByRole('link', { name: 'Schedule' }).click()
    await page.waitForTimeout(900)
    if (!(await page.locator('.fs-rota-t').getByText('Off asked').first().isVisible())) throw new Error('day off not on the rota')
    await page.getByRole('button', { name: 'Take it back' }).click()
    await page.waitForTimeout(300)
    if (await page.locator('.fs-rota-t').getByText('Off asked').count()) throw new Error('day off not taken back')
  })
  await step('call cancelled', async () => {
    await go('/fulfillment/schedule/cl-8')
    await page.getByRole('button', { name: 'Start call' }).click()
    if (!(await page.getByText('Calling from the portal is switched off').isVisible())) throw new Error('call screen did not say calls are off')
    await page.locator('.tp-sheet .fx-x').click()
    await page.waitForTimeout(400)
    await page.locator('.fx-rec-f').getByRole('button', { name: 'Cancelled' }).click()
    await page.getByPlaceholder('e.g. GL-301977').fill('GL-777123')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForTimeout(400)
    if (!(await page.getByText('Old policy cancelled').first().isVisible())) throw new Error('no cancelled state')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.locator('.fx-top').getByRole('link', { name: 'Pay' }).click()
    await page.waitForTimeout(900)
    if (!(await page.getByText(/GL-777123/).count())) throw new Error('cancel not on Pay')
  })
  await step('servicing result', async () => {
    await go('/fulfillment/servicing/st-4')
    await page.locator('.fx-rec-f').getByRole('button', { name: 'Start' }).click()
    await page.getByRole('button', { name: 'Record the result' }).click()
    await page.getByRole('radio', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Save result' }).click()
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    if (!(await page.locator('.fs-donelist').getByText(/Tom Fischer/).count())) throw new Error('step not in Done this week')
  })
  await step('message', async () => {
    await go('/fulfillment/messages')
    await page.getByPlaceholder(/^Message Dana about Gloria/).fill('On it, calling at 2.')
    await page.getByRole('button', { name: 'Send' }).click()
    if (!(await page.locator('.tp-conv-b').getByText('On it, calling at 2.').isVisible())) throw new Error('message not shown')
    if (!(await page.getByText('Agent Dana Walker · about Gloria Santos').isVisible())) throw new Error('mirrored header missing')
  })
  await step('settings tabs + shift (no Active/Away)', async () => {
    await go('/fulfillment/settings')
    for (const t of ['Shift', 'Pay details', 'Notifications', 'Appearance', 'Profile']) await page.getByRole('tab', { name: t }).click()
    await page.getByRole('tab', { name: 'Shift' }).click()
    if (!(await page.locator('.fx-form').getByText(/Your shift today\s*8:00 AM to 6:00 PM/).isVisible())) throw new Error('Shift tab has no shift line')
    if (await page.locator('.fx-form').getByRole('switch', { name: 'Active' }).count()) throw new Error('Active switch still in Settings')
    if (await page.locator('.fx-prof').getByText(/Away|Active/).count()) throw new Error('profile card still says Active or Away')
    if (SHOTS) await page.screenshot({ path: `${OUT}/flow-shift-1440-${theme}.png` })
  })
  const errs = errors.filter(e => !/favicon/.test(e))
  if (errs.length) fail(where, `console: ${errs.join(' | ')}`)
  rows.push({ where, flows: 7 })
}

// The other portals are unchanged: the agent still gets the agent shell, admin still gets today's pages.
if (!PREVIEW) {
  const { ctx, page } = await signIn('agent', 'dark', VIEWS[1])
  await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
  const a = await page.evaluate(() => ({ agentShell: !!document.querySelector('.tp-app.fx:not(.fs)'), fs: !!document.querySelector('.fs') }))
  if (!a.agentShell || a.fs) fail('agent /agent', `agent shell ${a.agentShell}, fulfillment shell ${a.fs}`)
  await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' })
  if (await page.locator('.fs').count()) fail('agent /fulfillment', 'agent got the Fulfillment shell')
  rows.push({ where: 'agent', ...a, landedFrom_fulfillment: new URL(page.url()).pathname })
  await ctx.close()
}
if (!PREVIEW) {
  const { ctx, page } = await signIn('admin', 'dark', VIEWS[1])
  for (const url of ['/admin', '/fulfillment', '/fulfillment/leads']) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
    const fs = await page.locator('.fs, .tp-app').count()
    if (fs) fail(`admin ${url}`, 'admin got a shell')
    rows.push({ where: `admin ${url}`, landed: new URL(page.url()).pathname, shell: fs > 0 })
  }
  await ctx.close()
}

await browser.close()
writeFileSync(`${OUT}/results.json`, JSON.stringify({ rows, writes: [...writes], failures }, null, 2))
console.log(`${rows.length} checks, ${failures.length} failures`)
console.log('Backend non-GET calls:', [...writes].join('\n  ') || 'none')
if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
