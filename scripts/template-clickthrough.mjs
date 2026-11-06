// Click-through check for the clickable template (/template). Nothing is committed; output goes to a temp folder.
//   node scripts/template-clickthrough.mjs                      production build + vite preview on localhost
//   node scripts/template-clickthrough.mjs --base-url <url>     a live site (polls up to 10 minutes for /template)
// Visits all 15 routes at 1440 and 390, light and dark, in a fresh logged-out browser each time, and fails on:
// a request that leaves the allowed host, a console or page error, sideways scroll, page text under 200 characters,
// a link that leaves /template or reaches an empty page, a button that changes neither the DOM nor the URL,
// or the named client missing from Clients, Calendar, Activity or Messages. Prints a table; exit 1 on any failure.
import process from 'node:process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, preview } from 'vite'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const BASE_ARG = flag('--base-url')
const OUT = mkdtempSync(join(tmpdir(), 'template-clickthrough-'))
const ROUTES = ['', 'leads', 'leads/sample-lead-1', 'calendar', 'clients', 'clients/sample-client-1', 'submit', 'request-service', 'messages', 'activity', 'billing', 'settings', 'more', 'signup', 'welcome']
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const NAMED = 'Gloria Santos'
const NAMED_ON = ['clients', 'calendar', 'activity', 'messages']
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
const url = r => `${base}/template${r ? `/${r}` : ''}`

const browser = await chromium.launch()
const norm = p => p.replace(/\/+$/, '') || '/'

async function freshPage(view, theme, watch) {
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, reducedMotion: 'reduce' })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* no storage */ } }, theme)
  const page = await ctx.newPage()
  if (watch) {
    page.on('request', req => {
      const u = new URL(req.url())
      if (u.protocol === 'data:' || u.protocol === 'blob:') return
      if (u.host !== BASE_HOST || /\.supabase\.co$/.test(u.hostname)) watch.outside.add(`${req.method()} ${u.host}${u.pathname}`)
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

// Pass 1: every route, both sizes, both themes.
const links = new Set()
for (const view of VIEWS) {
  for (const theme of ['light', 'dark']) {
    for (const r of ROUTES) {
      const where = `${view.w} ${theme} /template/${r}`
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
        const bad = []
        if (watch.outside.size) bad.push(`outside requests ${[...watch.outside].join(', ')}`)
        if (watch.errors.size) bad.push([...watch.errors].join('; '))
        if (m.scroll) bad.push('sideways scroll')
        if (m.len < 200) bad.push(`page text ${m.len} characters`)
        if (m.theme !== theme) bad.push(`theme is ${m.theme}`)
        const base1 = r.split('/')[0]
        if (NAMED_ON.includes(base1) && !r.includes('/') && !m.text.includes(NAMED)) bad.push(`${NAMED} missing`)
        if (view.w === 1440 && theme === 'dark' || view.w === 390 && theme === 'light') await page.screenshot({ path: join(OUT, `${view.w}-${theme}-${r.replaceAll('/', '_') || 'overview'}.png`) })
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
  for (const h of links) {
    const abs = new URL(h, `${base}/template/`)
    if (abs.host !== BASE_HOST || !abs.pathname.startsWith('/template')) { fail('link', `${h} leaves /template`); continue }
    if (seen.has(abs.pathname)) continue
    seen.add(abs.pathname)
    try {
      await page.goto(abs.href, { waitUntil: 'load' })
      await page.waitForSelector('.tp', { timeout: 15000 })
      const end = new URL(page.url())
      const len = (await page.evaluate(() => document.body.innerText.trim().length))
      if (!end.pathname.startsWith('/template')) fail('link', `${h} ended at ${end.pathname}`)
      else if (norm(end.pathname) !== norm(abs.pathname)) fail('link', `${h} was sent on to ${end.pathname}`)
      if (len < 200) fail('link', `${h} reached a page with ${len} characters`)
    } catch (e) { fail('link', `${h}: ${String(e.message).split('\n')[0]}`) }
  }
  console.log(`Followed ${seen.size} distinct links.`)
  await ctx.close()
}

// Pass 3: click each visible button on a fresh load; it must change the DOM or the URL.
// Buttons behind an open drawer (inert) can't be clicked by anyone, so they're skipped.
const VISIBLE = `(() => [...document.querySelectorAll('button, [role="button"]')].filter(b => {
  const r = b.getBoundingClientRect(); const cs = getComputedStyle(b)
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !b.disabled && b.getAttribute('aria-hidden') !== 'true' && !b.closest('[inert]')
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
      try {
        await page.evaluate(`${VISIBLE}[${i}].scrollIntoView({ block: 'center' })`)
        const box = await page.evaluate(`(() => { const r = ${VISIBLE}[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
        await page.mouse.click(box.x, box.y)
        await page.waitForTimeout(120)
        const after = await page.evaluate(() => ({ dom: document.documentElement.outerHTML, url: location.href }))
        clicked++
        if (after.dom === before.dom && after.url === before.url) fail(`${view.w} dark /template/${r}`, `silent button "${info}"`)
      } catch (e) { fail(`${view.w} dark /template/${r}`, `click "${info}": ${String(e.message).split('\n')[0]}`) }
    }
  }
  await ctx.close()
}
console.log(`Clicked ${clicked} buttons.`)

// Pass 4 (P854): the agent Calendar works like the VA Schedule (click a day, ?day=, Back, Esc, no Week/Day), and a
// Taken slot in Book a call can't be picked.
{
  const where = '1440 dark P854 calendar'
  const { ctx, page } = await freshPage(VIEWS[0], 'dark', null)
  const day = () => new URL(page.url()).searchParams.get('day')
  try {
    await open(page, 'calendar')
    if (await page.locator('.fx-tools [aria-label="View"]').count()) fail(where, 'the Week/Day toggle is still there')
    if (await page.locator('.fx-daybox').count()) fail(where, 'a day box shows on the plain week')
    await page.locator('.fx-week .tp-tgrid-h b[role="button"]', { hasText: 'Thu' }).click()
    await page.waitForTimeout(450)
    if (day() !== '2026-11-05' || !(await page.locator('.fx-daybox').isVisible())) fail(where, `clicking Thu: day=${day()}`)
    if ((await page.locator('.fx-week .tp-tcol').count()) !== 1) fail(where, 'the grid did not narrow to the day')
    await page.screenshot({ path: join(OUT, '1440-dark-p854-calendar-day.png') })
    await page.goBack()
    await page.waitForTimeout(450)
    if (await page.locator('.fx-daybox').count()) fail(where, 'Back did not close the box')
    await page.locator('.fx-daystrip button', { hasText: 'Wed' }).click()
    await page.waitForTimeout(450)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
    if (await page.locator('.fx-daybox').count() || day()) fail(where, 'Esc did not close the box')
    await page.goto(`${url('calendar')}?day=2026-11-06`, { waitUntil: 'load' })
    await page.waitForSelector('.fx-daybox', { timeout: 8000 }).catch(() => fail(where, 'a ?day= link did not open the day'))
    // Book a call, Appointment: Gloria Santos (Miami, ET) on Tue 3. Denise is at 11:00 AM CT, so 12:00 PM ET is taken.
    await open(page, 'calendar')
    await page.getByRole('button', { name: 'Book a call' }).first().click()
    await page.waitForTimeout(400)
    if ((await page.locator('.tp-sheet').getByRole('radio', { name: /Tue\s*3/ }).getAttribute('aria-checked')) !== 'true') fail(where, 'Book a call did not start on Tue 3')
    await page.locator('.tp-sheet').getByRole('button', { name: /^Time \(the client's time\):/ }).click()
    await page.waitForTimeout(300)
    const taken = page.getByRole('option', { name: /^12:00 PM\s*Taken/ })
    if ((await taken.getAttribute('aria-disabled')) !== 'true') fail(where, '12:00 PM ET is not greyed out')
    await taken.click({ force: true })
    await page.waitForTimeout(200)
    if (!(await page.locator('.fx-sellist').isVisible())) fail(where, 'picking a taken slot closed the list')
    await page.screenshot({ path: join(OUT, '1440-dark-p854-bookcall-taken.png') })
    await page.getByRole('option', { name: /^1:00 PM/ }).click()
    const line = await page.locator('.tp-sheet .fx-tzline').innerText()
    if (!/1:00 PM ET, client's time \(Miami, FL\)/.test(line) || !/That's 12:00 PM CT for you/.test(line)) fail(where, `time line reads "${line.replace(/\n/g, ' / ')}"`)
    rows.push({ where, outside: '-', errors: '-', scroll: '-', text: '-', result: failures.some(f => f.startsWith(where)) ? 'FAIL' : 'ok' })
  } catch (e) { fail(where, String(e.message).split('\n')[0]) }
  await ctx.close()
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
