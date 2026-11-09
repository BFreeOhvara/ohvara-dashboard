// P912: find hover "film" — every spot where hovering changes pixels outside the hovered clickable's own box,
// or where something that is not clickable reacts at all.
//   node scripts/hover-sweep-912.mjs --base-url http://localhost:5912 [--theme dark] [--widths 1440,1920] [--roles agent,fulfill,admin] [--only /agent] [--step 96] [--shots qa/hover-912]
// Signs in with ~/.atlas/test-logins.json. Transitions are zeroed so a hover paints at once; animations paused.
// For each grid point: park the mouse, shoot, hover, shoot, diff. Reports one line per offending element (deduped).
import process from 'node:process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', '').replace(/\/$/, '')
const THEME = flag('--theme', 'dark')
const WIDTHS = flag('--widths', '1440,1920').split(',').map(Number)
const ROLES = flag('--roles', 'agent,fulfill,admin').split(',')
const ONLY = flag('--only', null)
const STEP = Number(flag('--step', '96'))
const SHOTS = flag('--shots', null)
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))

const PAGES = {
  agent: ['/agent', '/agent/leads', '/agent/inbounds/sample-lead-1', '/agent/calendar', '/agent/clients', '/agent/clients/sample-client-1', '/agent/submit',
    '/agent/request-service', '/agent/activity', '/agent/billing', '/agent/more', '/settings', '/messages'],
  fulfill: ['/fulfillment', '/fulfillment/desk', '/fulfillment/schedule', '/fulfillment/pipeline', '/fulfillment/servicing', '/fulfillment/pay', '/fulfillment/more', '/fulfillment/training', '/messages', '/settings'],
  admin: ['/admin', '/admin/agents', '/admin/setup', '/admin/fulfillment', '/admin/inbounds', '/admin/pipeline', '/admin/billing', '/admin/messages', '/admin/settings', '/admin/connect'],
}

const STILL = `*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-play-state:paused!important;caret-color:transparent!important}`

// --gpu: a real-GPU Edge/Chrome (the film Brayden sees is a compositor effect; SwiftShader may hide it)
const browser = await chromium.launch(args.includes('--gpu') ? { channel: flag('--channel', 'msedge'), args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu-rasterization'] } : {})
const report = []

// Pixels that changed from park shot a to hover shot b — and, when c (a second park shot) is given, also from c to b,
// so a clock or live counter ticking between shots does not count.
function diff(a, b, c) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b), C = c ? PNG.sync.read(c) : null
  const ch = (X, i) => Math.max(Math.abs(X.data[i] - B.data[i]), Math.abs(X.data[i + 1] - B.data[i + 1]), Math.abs(X.data[i + 2] - B.data[i + 2])) > 6
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, lum = 0
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * 4
    if (ch(A, i) && (!C || ch(C, i))) {
      n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y
      lum += (B.data[i] + B.data[i + 1] + B.data[i + 2]) - (A.data[i] + A.data[i + 1] + A.data[i + 2])
    }
  }
  return n ? { n, box: { x: x0, y: y0, r: x1 + 1, b: y1 + 1 }, lum: Math.round(lum / n / 3) } : { n: 0 }
}

async function signIn(role, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 1920 ? 1080 : 900 }, colorScheme: THEME })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, THEME)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="you@email.com"]', logins[role].email)
  await page.fill('input[placeholder="Your password"]', logins[role].password)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 })
  await page.waitForLoadState('networkidle')
  return { ctx, page }
}

// What the pointer is over, the nearest thing that acts like a control, and its box.
const probe = ({ x, y }) => {
  const el = document.elementFromPoint(x, y)
  if (!el) return null
  const name = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`
  // The control: the nearest real control, else the outermost element showing a pointer cursor (cursor inherits).
  // A card whose whole face is a link (.fx-cover) counts as clickable, so its own hover is fine.
  const SEM = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],input,select,textarea,label,summary'
  let ctl = el.closest(SEM)
  if (!ctl) for (let e = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).cursor === 'pointer' && getComputedStyle(e.parentElement).cursor !== 'pointer') { ctl = e; break }
  let r = ctl ? ctl.getBoundingClientRect() : null
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.querySelector(':scope > .fx-cover, :scope > a.tp-cover') || (e !== ctl && e.matches(SEM))) {
      const q = e.getBoundingClientRect()
      if (!ctl) ctl = e
      r = r ? { left: Math.min(r.left, q.left), top: Math.min(r.top, q.top), right: Math.max(r.right, q.right), bottom: Math.max(r.bottom, q.bottom) } : q
    }
  }
  const tip = [...document.querySelectorAll('[role=tooltip],.recharts-tooltip-wrapper,[class*="tip"]')].some(t => t.getBoundingClientRect().width > 0 && getComputedStyle(t).visibility !== 'hidden' && getComputedStyle(t).opacity !== '0')
  return { el: name(el), ctl: ctl ? name(ctl) : null, box: r ? { x: r.left, y: r.top, r: r.right, b: r.bottom } : null, tip }
}

async function sweep(page, where) {
  await page.addStyleTag({ content: STILL })
  await page.mouse.move(1, 1)
  await page.waitForTimeout(400)
  const vp = page.viewportSize()
  const seen = new Map()
  const park = async () => { await page.mouse.move(vp.width - 2, vp.height - 2); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))) }
  for (let y = STEP / 2; y < vp.height; y += STEP) {
    for (let x = STEP / 2; x < vp.width; x += STEP) {
      await park()
      const a = await page.screenshot()
      await page.mouse.move(x, y)
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
      const b = await page.screenshot()
      if (diff(a, b).n < 40) continue
      const p = await page.evaluate(probe, { x, y }).catch(() => null)
      if (!p) continue
      await park()
      const d = diff(a, b, await page.screenshot())
      if (d.n < 40) continue
      let why = null
      if (!p.ctl) why = 'reacts but is not clickable'
      else {
        const o = Math.max(p.box.x - d.box.x, p.box.y - d.box.y, d.box.r - p.box.r, d.box.b - p.box.b)
        if (o > 3 && !p.tip) why = `paints ${Math.round(o)}px outside its box`
      }
      if (!why) continue
      const key = `${p.ctl || p.el}|${why.replace(/\d+px/, 'Npx')}`
      if (seen.has(key)) continue
      seen.set(key, true)
      const line = `${where} @${x},${y}: ${why} — over ${p.el}${p.ctl ? ` (control ${p.ctl})` : ''}; changed ${d.n}px in ${d.box.x},${d.box.y}–${d.box.r},${d.box.b}, lum ${d.lum > 0 ? '+' : ''}${d.lum}`
      report.push(line)
      console.log(line)
      if (SHOTS) {
        const tag = `${where.replace(/[^a-z0-9]+/gi, '-')}-${x}-${y}`
        writeFileSync(join(SHOTS, `${tag}-before.png`), a)
        writeFileSync(join(SHOTS, `${tag}-after.png`), b)
      }
    }
  }
}

for (const role of ROLES) {
  for (const w of WIDTHS) {
    const { ctx, page } = await signIn(role, w)
    const pages = PAGES[role]
    for (const url of pages) {
      if (ONLY && url !== ONLY) continue
      const where = `${role} ${w} ${THEME} ${url}`
      try {
        await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(900)
        await sweep(page, where)
        console.log(`done ${where}`)
      } catch (e) { report.push(`${where}: ERROR ${e.message.slice(0, 120)}`); console.log(`${where}: ERROR ${e.message.slice(0, 120)}`) }
    }
    await ctx.close()
  }
}
await browser.close()
console.log(`\n${report.filter(l => !/ERROR/.test(l)).length} stray hover areas`)
