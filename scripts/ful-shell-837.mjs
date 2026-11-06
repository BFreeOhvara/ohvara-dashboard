// P837 proof: the Fulfillment shell at the real Fulfillment URLs, signed in as the test Fulfillment login in
// ~/.atlas/test-logins.json ("fulfill"). Also checks the agent shell and the admin pages are unchanged.
//   node scripts/ful-shell-837.mjs --base-url <url> [--no-shots] [--out qa/fulfillment-845] [--preview]
// P845: the rebuilt VA pages (sample info). Adds Overview and each record drawer's own URL, and --preview: the same
// P846: Calls became Schedule (calendar, rota, day off, live-call overlay); checks cover those and the old /desk redirect.
// P854: no Week/Day toggle; a clicked day opens its box (?day=, Back, Esc, X); client-time pickers; a Taken slot can't
// be picked; Pass on needs a free VA; a phone opens the day full screen.
// pages at /template/fulfillment with no sign-in (Messages and Settings at /fulfillment/messages|settings there),
// plus a click-through of the VA flows. The agent/admin checks run in the signed-in mode only.
// Each page x 1920/1440/390 x light/dark: the shell frame is there, the title, tabs (desktop) or bottom bar (phone),
// no console errors, no sideways scroll. Every non-GET request to the backend is listed (the shell adds none).
// Only clicks that read: the search palette and the account menu, each closed with Escape.
// P857: the rail's + menu (keyboard: Enter opens, arrows move, Esc closes back to the +; each item does its old
// button's job), the in-app phone (search, dial pad, in-call controls, result, recent; a live call rings in it), Get
// the app, and the rail lists (VA and agent). Its shots always go to qa/ful-857 (1440 + 390, light + dark).
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
const OUT857 = 'qa/ful-857'
mkdirSync(OUT857, { recursive: true })
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
    // P847: built-in dropdowns (no native select): pick from the list; the carrier list has a search box
    await page.getByRole('button', { name: /^Question type:/ }).click()
    await page.getByRole('option', { name: 'Coverage question' }).click()
    await page.getByRole('button', { name: /^Their carrier:/ }).click()
    await page.getByRole('combobox', { name: /Search Their carrier/ }).fill('globe')
    await page.keyboard.press('Enter')
    if (!(await page.getByRole('button', { name: 'Their carrier: Globe Life' }).count())) throw new Error('carrier search did not pick Globe Life')
    await page.getByRole('radio', { name: 'This week' }).click()
    if (!(await page.getByRole('button', { name: 'Book an agent' }).isEnabled())) throw new Error('Book stayed off after 4 answers')
    await page.getByRole('button', { name: 'Book an agent' }).click()
    // P854: the time is the person's (Jacksonville, ET) inside Dana's hours; the first open slot.
    await page.getByRole('button', { name: /^Time \(the client's time\):/ }).click()
    await page.locator('.fx-selopt:not(.is-disabled)').first().click()
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
  // P854: the week with a day you click open, client-time pickers, the 30-minute rule.
  await step('P854 day box: click a day, URL, Back, Esc, no Week/Day', async () => {
    await go('/fulfillment/schedule')
    if (await page.locator('.fx-tools [aria-label="View"]').count()) throw new Error('the Week/Day toggle is still there')
    if (await page.locator('.fx-daybox').count()) throw new Error('a day box shows on the plain week')
    const full = await page.evaluate(() => { const g = document.querySelector('.fx-grid').getBoundingClientRect().width; const w = document.querySelector('.fx-week').getBoundingClientRect().width; return w / g })
    if (full < 0.98) throw new Error(`week grid is ${Math.round(full * 100)}% wide, not full width`)
    await page.locator('.fx-week .tp-tgrid-h b[role="button"]', { hasText: 'Tue' }).click()
    await page.waitForTimeout(450)
    if (new URL(page.url()).searchParams.get('day') !== '2026-11-03') throw new Error(`URL day is ${new URL(page.url()).searchParams.get('day')}`)
    if (!(await page.locator('.fx-daybox').isVisible())) throw new Error('clicking Tue did not open its box')
    if ((await page.locator('.fx-week .tp-tcol').count()) !== 1) throw new Error('the grid did not narrow to the day')
    if ((await page.locator('.fx-daystrip [aria-pressed="true"]').innerText()).replace(/\s/g, '') !== 'Tue3') throw new Error('the strip does not light Tue')
    if (SHOTS) await page.screenshot({ path: `${OUT}/p854-day-1440-${theme}.png` })
    await page.locator('.fx-daystrip button', { hasText: 'Wed' }).click()
    await page.waitForTimeout(450)
    if (new URL(page.url()).searchParams.get('day') !== '2026-11-04' || !(await page.locator('.fx-daybox h2', { hasText: 'Wed, Nov 4' }).isVisible())) throw new Error('another day did not swap the box')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    if (await page.locator('.fx-daybox').count()) throw new Error('Esc did not close the box')
    if (new URL(page.url()).searchParams.get('day')) throw new Error('Esc left the day in the URL')
    await page.locator('.fx-week .tp-tcol[data-day="3"]').click({ position: { x: 6, y: 6 } })
    await page.waitForTimeout(450)
    if (new URL(page.url()).searchParams.get('day') !== '2026-11-03') throw new Error('empty column space did not open the day')
    await page.goBack()
    await page.waitForTimeout(500)
    if (await page.locator('.fx-daybox').count()) throw new Error('Back did not close the box')
    await page.locator('.fx-daystrip button', { hasText: 'Thu' }).click()
    await page.waitForTimeout(450)
    await page.locator('.fx-daystrip button', { hasText: 'Thu' }).click()
    await page.waitForTimeout(500)
    if (await page.locator('.fx-daybox').count()) throw new Error('the same day again did not close the box')
    await go('/fulfillment/schedule?day=2026-11-10')
    if (!(await page.locator('.fx-daybox h2', { hasText: 'Tue, Nov 10' }).isVisible())) throw new Error('a link with ?day= did not reopen the day')
    await page.locator('.fx-daybox .fx-daybox-x').click()
    await page.waitForTimeout(500)
    if (await page.locator('.fx-daybox').count()) throw new Error('the X did not close the box')
    // A block still opens its drawer, and closing it comes back to the open day.
    await go('/fulfillment/schedule?day=2026-11-05')
    await page.locator('.fx-week a.tp-ev', { hasText: 'Gloria Santos' }).click()
    await page.waitForTimeout(500)
    if (!/schedule\/cl-8$/.test(new URL(page.url()).pathname)) throw new Error('a block did not open its drawer')
    const when = await page.locator('.fx-rec .fx-when').first().innerText()
    if (!/2:00 PM · client 3:00 PM ET/.test(when)) throw new Error(`drawer time reads "${when}", not both clocks`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    if (new URL(page.url()).searchParams.get('day') !== '2026-11-05' || !(await page.locator('.fx-daybox').isVisible())) throw new Error('closing the drawer lost the open day')
  })
  await step('P854 taken slot: greyed out, cannot be picked; Pass on to a free VA', async () => {
    await go('/fulfillment/schedule/cl-8')
    await page.locator('.fx-rec-f').getByRole('button', { name: 'Move' }).click()
    await page.waitForTimeout(400)
    // The day starts on Fri 6 (the next working day after the call).
    if ((await page.locator('.tp-sheet').getByRole('radio', { name: /Fri\s*6/ }).getAttribute('aria-checked')) !== 'true') throw new Error('Move did not start on Fri 6')
    await page.locator('.tp-sheet').getByRole('button', { name: /^New time \(the client's time\):/ }).click()
    await page.waitForTimeout(300)
    // Fri 6: Maya and Sasha are on; both have a call at 10:00 AM CT, so 11:00 AM ET is taken.
    const taken = page.getByRole('option', { name: /^11:00 AM\s*Taken/ })
    if ((await taken.getAttribute('aria-disabled')) !== 'true') throw new Error('11:00 AM ET is not greyed out')
    await taken.click({ force: true })
    await page.waitForTimeout(200)
    if (!(await page.locator('.fx-sellist').isVisible())) throw new Error('picking a taken slot closed the list')
    if (SHOTS) await page.screenshot({ path: `${OUT}/p854-taken-1440-${theme}.png` })
    await page.getByRole('option', { name: /^12:00 PM/ }).click()
    await page.waitForTimeout(200)
    const line = await page.locator('.tp-sheet .fx-tzline').innerText()
    if (!/12:00 PM ET, client's time \(Miami, FL\)/.test(line) || !/That's 11:00 AM CT for you/.test(line)) throw new Error(`time line reads "${line.replace(/\n/g, ' / ')}"`)
    if (!(await page.locator('.tp-sheet').getByRole('button', { name: 'Move it' }).isEnabled())) throw new Error('Move it stayed off on an open slot')
    await go('/fulfillment/schedule/cl-8')
    await page.locator('.fx-rec-f').getByRole('button', { name: 'Pass on' }).click()
    await page.waitForTimeout(300)
    // Thu 5 2:00 PM: Leo and Devon both have a 2:00 PM call, so nobody else is free.
    if (await page.locator('.tp-sheet').getByRole('button', { name: 'Pass it on' }).isEnabled()) throw new Error('Pass on allowed with nobody free')
    await page.keyboard.press('Escape')
  })
  await step('live call overlay + day off', async () => {
    await go('/fulfillment')
    if (!(await page.getByText(/Your shift today\s*8:00 AM to 6:00 PM/).first().isVisible())) throw new Error('Overview has no shift line')
    if (await page.locator('[aria-label="Active or away"], [role="switch"][aria-label="Active"]').count()) throw new Error('an Active/Away switch is still on the page')
    await page.locator('.fx-rail').getByRole('button', { name: 'Calls and more' }).click()
    await page.getByRole('menuitem', { name: /^Live call/ }).click()
    await page.waitForTimeout(500)
    if (!(await page.locator('.fs-phone').getByText(/Calling is off right now/).first().isVisible())) throw new Error('live call did not ring in the phone from the + menu')
    if (SHOTS) await page.screenshot({ path: `${OUT}/flow-live-overlay-1440-${theme}.png` })
    await page.getByRole('button', { name: 'Open the call' }).click()
    await page.waitForTimeout(600)
    if (!/schedule\/cl-\d+$/.test(new URL(page.url()).pathname)) throw new Error(`Open the call went to ${new URL(page.url()).pathname}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.locator('.fx-rail').getByRole('button', { name: 'Calls and more' }).click()
    await page.getByRole('menuitem', { name: /^Request a day off/ }).click()
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
    await page.waitForTimeout(400)
    if (!(await page.locator('.fs-phone').getByText(/Calling is off right now/).first().isVisible())) throw new Error('Start call did not open the phone saying calls are off')
    if (!(await page.locator('.fs-phone').getByRole('button', { name: /^Call [A-Z]/ }).count())) throw new Error('Start call did not open the phone on that client')
    await page.locator('.fs-phone .fx-x').click()
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
    // P847: client first, the agent under it
    if (!(await page.locator('.tp-conv-h b').getByText('Gloria Santos', { exact: true }).isVisible())) throw new Error('client title missing')
    if (!(await page.locator('.tp-conv-h').getByText('Agent: Dana Walker').isVisible())) throw new Error('agent subtext missing')
    if (await page.getByText(/· about /).count()) throw new Error('old "about" title still shown')
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
  await step('p857 + menu, phone, get the app', () => railAndPhone(page, theme))
  const errs = errors.filter(e => !/favicon/.test(e))
  if (errs.length) fail(where, `console: ${errs.join(' | ')}`)
  rows.push({ where, flows: 10 })
  await phoneDay(theme)
}

// P857: the + menu and the in-app phone at 1440, then both as bottom sheets at 390.
async function railList(page) { return page.evaluate(() => [...document.querySelector('.fx-rail').children].map(e => (e.tagName === 'I' ? '|' : e.getAttribute('aria-label').replace(/ \(Ctrl K\)/, '')))) }
async function railAndPhone(page, theme) {
  const go = async url => { await page.goto(`${BASE}/template${url}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700) }
  const phone = page.locator('.fs-phone')
  await go('/fulfillment')
  const va = await railList(page)
  // No phone-looking buttons left beside each other: one + and one Phone.
  for (const gone of ['Live call', 'Your next call', 'Log a call', 'Book for an agent', 'Request a day off']) if (va.includes(gone)) throw new Error(`${gone} is still on the rail`)
  if (va.filter(x => x === 'Phone').length !== 1 || !va.includes('Calls and more') || !va.includes('Get the phone app')) throw new Error(`rail reads ${va.join(' ')}`)
  // Keyboard: Enter opens, focus on the first item, arrows move, Esc closes and focus goes back to the +.
  const plus = page.locator('.fx-rail').getByRole('button', { name: 'Calls and more' })
  await plus.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  const f1 = await page.evaluate(() => `${document.activeElement?.getAttribute('role')} ${document.activeElement?.textContent}`)
  if (!/^menuitem Next call/.test(f1)) throw new Error(`Enter did not focus the first item (${f1})`)
  await page.keyboard.press('ArrowDown')
  const f2 = await page.evaluate(() => document.activeElement?.textContent)
  if (!/^Live call/.test(f2)) throw new Error(`ArrowDown went to ${f2}`)
  await page.keyboard.press('End')
  if (!/^Request a day off/.test(await page.evaluate(() => document.activeElement?.textContent))) throw new Error('End did not reach the last item')
  if (SHOTS) await page.screenshot({ path: `${OUT857}/menu-1440-${theme}.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  if (await page.locator('.fs-cmenu').count()) throw new Error('Esc did not close the menu')
  if (!(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Calls and more'))) throw new Error('focus did not go back to the +')
  await page.keyboard.press(' ')
  await page.waitForTimeout(250)
  if (!(await page.locator('.fs-cmenu').isVisible())) throw new Error('Space did not open the menu')
  await page.keyboard.press('Escape')
  // Each item does what its old button did.
  const pick = async name => { await plus.click(); await page.getByRole('menuitem', { name }).click(); await page.waitForTimeout(500) }
  await pick(/^Next call/)
  if (!/schedule\/cl-\d+$/.test(new URL(page.url()).pathname)) throw new Error(`Next call went to ${new URL(page.url()).pathname}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await pick(/^Log a call/)
  if (!(await page.locator('.tp-sheet').getByText('Pick the call. Its result is saved on the call.').isVisible())) throw new Error('Log a call did not open')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await pick(/^Book for an agent/)
  if (!(await page.locator('.tp-sheet').getByRole('button', { name: 'Book it' }).count())) throw new Error('Book for an agent did not open')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // Live call rings in the phone; Answer goes to the call screen.
  await pick(/^Live call/)
  if (!(await phone.getByRole('button', { name: 'Answer' }).isVisible())) throw new Error('Live call did not ring in the phone')
  if (SHOTS) await page.screenshot({ path: `${OUT857}/phone-ring-1440-${theme}.png` })
  await phone.getByRole('button', { name: 'Answer' }).click()
  await page.waitForTimeout(1300)
  const t = await phone.locator('.fs-ph-timer').innerText()
  if (!/0[01]:0[1-9]/.test(t)) throw new Error(`call timer reads ${t.replace(/\n/g, ' ')}`)
  if (!/their time/.test(await phone.locator('.fs-ph-tz').innerText())) throw new Error('no client local time on the call')
  await phone.getByRole('button', { name: 'Mute' }).click()
  if ((await phone.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')) !== 'true') throw new Error('Mute did not press')
  await phone.getByRole('button', { name: 'Hold' }).click()
  if (!(await phone.getByText('On hold').isVisible())) throw new Error('Hold did not hold')
  await phone.getByRole('button', { name: 'Keypad' }).click()
  await phone.locator('.fs-pad .fs-key', { hasText: '5' }).click()
  if ((await phone.locator('.fs-ph-tones').innerText()).trim() !== '5') throw new Error('in-call keypad did not take a key')
  if (SHOTS) await page.screenshot({ path: `${OUT857}/phone-call-1440-${theme}.png` })
  // Close the panel mid-call: the rail's phone shows the call; reopening shows it again.
  await phone.locator('.fx-x').click()
  await page.waitForTimeout(300)
  if (!(await page.locator('.fx-rail').getByRole('button', { name: 'Phone, on a call' }).count())) throw new Error('rail phone does not show the call')
  await page.locator('.fx-rail').getByRole('button', { name: 'Phone, on a call' }).click()
  await phone.getByRole('button', { name: 'Hang up' }).click()
  await page.waitForTimeout(300)
  if (!(await phone.getByText('How did it go?').first().isVisible())) throw new Error('no result step after Hang up')
  await phone.getByRole('radio', { name: 'No answer' }).click()
  await phone.getByRole('textbox', { name: /Notes/ }).fill('Rang out, try at 4.')
  if (SHOTS) await page.screenshot({ path: `${OUT857}/phone-result-1440-${theme}.png` })
  await phone.getByRole('button', { name: 'Save result' }).click()
  await page.waitForTimeout(300)
  if (!(await phone.getByRole('tab', { name: 'Recent', selected: true }).count())) throw new Error('did not land on Recent after saving')
  // Search a client by name, and dial a number on the pad.
  await phone.getByRole('tab', { name: 'Keypad' }).click()
  await phone.getByRole('textbox', { name: /Search a client/ }).fill('gloria')
  await phone.getByRole('button', { name: /Gloria Santos/ }).click()
  if (!(await phone.getByRole('button', { name: 'Call Gloria' }).isVisible())) throw new Error('search did not open the client')
  await phone.getByRole('button', { name: 'Dial pad' }).click()
  for (const d of '2145550199') await phone.locator('.fs-pad .fs-key', { hasText: d }).first().click()
  if (!(await phone.getByRole('button', { name: 'Call', exact: true }).isEnabled())) throw new Error('Call stayed off with 10 digits')
  if (SHOTS) await page.screenshot({ path: `${OUT857}/phone-pad-1440-${theme}.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if (await phone.count()) throw new Error('Esc did not close the phone')
  // Get the app: the same sheet as the agent side.
  await page.locator('.fx-rail').getByRole('button', { name: 'Get the phone app' }).click()
  if (!(await page.locator('.tp-sheet').getByText('Get the phone app').isVisible())) throw new Error('Get the app did not open')
  await page.keyboard.press('Escape')
  // The agent rail, for the ship note.
  await go('')
  const agent = await railList(page)
  rows.push({ where: `rails ${theme}`, va: va.join(' '), agent: agent.join(' ') })
  // A phone: the bar's raised + opens the same actions as a sheet (with Phone first); the phone is a sheet too.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme })
  await ctx.addInitScript(th => { try { localStorage.setItem('ohvara-theme', th) } catch { /* private mode */ } }, theme)
  const p2 = await ctx.newPage()
  try {
    await p2.goto(`${BASE}/template/fulfillment`, { waitUntil: 'networkidle' })
    await p2.waitForTimeout(800)
    await p2.locator('.fx-bar').getByRole('button', { name: 'Calls and more' }).click()
    await p2.waitForTimeout(400)
    const sheet = await p2.evaluate(() => { const r = document.querySelector('.fs-cmenu').getBoundingClientRect(); return { l: r.left, r: document.documentElement.clientWidth - r.right } })
    // Same geometry as the agent's Create sheet (10px left; its right inset is 25px in a 390 view).
    if (sheet.l > 12 || sheet.r > 30) throw new Error(`+ menu is not a bottom sheet: ${JSON.stringify(sheet)}`)
    if (SHOTS) await p2.screenshot({ path: `${OUT857}/menu-390-${theme}.png` })
    await p2.getByRole('menuitem', { name: /^Phone/ }).click()
    await p2.waitForTimeout(500)
    const ph = await p2.evaluate(() => { const r = document.querySelector('.fs-phone').getBoundingClientRect(); return { l: r.left, b: innerHeight - r.bottom, side: document.documentElement.scrollWidth - innerWidth } })
    if (ph.l > 12 || ph.b > 12 || ph.side > 1) throw new Error(`phone is not a bottom sheet: ${JSON.stringify(ph)}`)
    if (SHOTS) await p2.screenshot({ path: `${OUT857}/phone-390-${theme}.png` })
    await p2.keyboard.press('Escape')
    await p2.locator('.fx-bar').getByRole('button', { name: 'More', exact: true }).click()
    await p2.getByRole('button', { name: 'Get the phone app' }).click()
    if (!(await p2.locator('.tp-sheet').getByText('Get the phone app').isVisible())) throw new Error('Get the app missing from the phone menu')
    await p2.keyboard.press('Escape')
    if (SHOTS) { await p2.waitForTimeout(400); await p2.screenshot({ path: `${OUT857}/overview-390-${theme}.png` }) }
  } finally { await ctx.close() }
  await go('/fulfillment')
  if (SHOTS) await page.screenshot({ path: `${OUT857}/overview-1440-${theme}.png` })
}

// P854: on a phone the week is a list; tapping a day opens it full screen with Back to the week.
async function phoneDay(theme) {
  const where = `phone day ${theme}`
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, theme)
  const page = await ctx.newPage()
  try {
    await page.goto(`${BASE}/template/fulfillment/schedule`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    await page.locator('.fx-weeklist button', { hasText: 'Thu' }).click()
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => { const r = document.querySelector('.fx-daybox')?.getBoundingClientRect(); return r ? { w: r.width, h: r.height, pos: getComputedStyle(document.querySelector('.fx-daybox')).position } : null })
    if (!m || m.pos !== 'fixed' || m.w < 389 || m.h < 840) fail(where, `the day is not full screen: ${JSON.stringify(m)}`)
    if (SHOTS) await page.screenshot({ path: `${OUT}/p854-day-390-${theme}.png` })
    await page.getByRole('button', { name: 'Back to the week' }).click()
    await page.waitForTimeout(500)
    if (await page.locator('.fx-daybox').count()) fail(where, 'Back to the week did not close it')
    if (SHOTS) await page.screenshot({ path: `${OUT}/p854-week-390-${theme}.png` })
  } catch (e) { fail(where, e.message.split('\n')[0]) }
  await ctx.close()
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
