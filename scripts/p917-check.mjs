// P917 — checked by really clicking and hovering in a visible browser (headed Chromium, a real window on screen).
// For each animation it samples the moving element every frame (in the page, requestAnimationFrame) and saves a few
// screenshots before / during / after; then a contact sheet per view is made by scripts/p917-sheet.py.
//   node scripts/p917-check.mjs --base http://localhost:4917 --out qa/p917 [--w 1440 --h 900 --theme dark] [--only motion]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('base', 'http://localhost:4917')
const OUT = arg('out', 'qa/p917')
const W = +arg('w', 1440), H = +arg('h', 900), THEME = arg('theme', 'dark'), ONLY = arg('only', 'all')
const tag = `${W}-${THEME}`
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: false, args: [`--window-size=${W + 20},${H + 140}`] })
const page = await browser.newPage({ viewport: { width: W, height: H }, colorScheme: THEME })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const report = { base: BASE, w: W, h: H, theme: THEME, views: {} }
const wait = ms => page.waitForTimeout(ms)
const go = async p => { await page.goto(BASE + p); await wait(1800) }
const phone = W < 768
let shotN = 0
const shot = async (name, clip) => { const f = join(OUT, `${tag}-${String(++shotN).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: f, clip, scale: 'css' }); return f }

// Samples a CSS property of the first element matching sel, every frame, for ms. Returns [{t, v}] (t from the start).
const sample = (sel, prop, ms) => page.evaluate(([sel, prop, ms]) => new Promise(done => {
  const out = []; const t0 = performance.now()
  const tick = () => {
    const el = document.querySelector(sel)
    const t = Math.round(performance.now() - t0)
    out.push({ t, v: el ? getComputedStyle(el)[prop] : 'gone' })
    if (t < ms) requestAnimationFrame(tick); else done(out)
  }
  requestAnimationFrame(tick)
}), [sel, prop, ms])
// How many distinct values a sampled run went through (a real animation passes through many).
const steps = run => new Set(run.map(r => r.v)).size
const settledState = () => page.evaluate(() => ({ appSettled: !!document.querySelector('.tp-app.is-settled'), htmlSettled: [...document.documentElement.classList].filter(c => /settled/.test(c)), anim: !!document.querySelector('.tp-app.is-anim') }))

// ── Messages: open and close like the avatar menu ──
async function messages(root) {
  await go(root)
  const icon = page.locator('.fx-ib[href*="messages"]:visible').first()
  if (!(await icon.count())) { report.views.messages = { skipped: 'no header Messages icon at this width' }; return }
  const b = await icon.boundingBox()
  const clip = { x: Math.max(0, W - 760), y: 0, width: Math.min(760, W), height: Math.min(H, 560) }
  await shot('msg-before', clip)
  const runP = sample('.fx-main', 'transform', 420)
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await wait(70); await shot('msg-open-70ms', clip)
  const open = await runP
  await wait(300); await shot('msg-open-done', clip)
  const iconPressed = await page.evaluate(() => getComputedStyle([...document.querySelectorAll('.fx-ib.active')].find(e => e.offsetWidth > 0)).transform)
  // the avatar menu, for comparison
  const av = await page.locator('.fx-me:visible').first().boundingBox()
  const avRun = sample('.fx-menu', 'transform', 420)
  await page.mouse.click(av.x + av.width / 2, av.y + av.height / 2)
  const avOpen = await avRun
  await page.mouse.click(av.x + av.width / 2, av.y + av.height / 2); await wait(400)
  const closeP = sample('.fx-main', 'transform', 260)
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await wait(90); await shot('msg-close-90ms', clip)
  const close = await closeP
  await wait(500); await shot('msg-after-overview', clip)
  const after = await page.evaluate(() => ({ path: location.pathname, cls: document.querySelector('.tp-app').className }))
  report.views.messages = { openSteps: steps(open), closeSteps: steps(close), open: open.filter((_, i) => i % 4 === 0).map(r => `${r.t}:${r.v}`), iconPressed, avatarMenuSteps: steps(avOpen), after }
}

// ── Drawers: a client drawer in and out, the notifications panel for comparison ──
async function drawers(root) {
  await go(CLIENTS)
  const card = page.locator('.fx-ccard .fx-cover').first()
  const clip = { x: 0, y: 0, width: W, height: H }
  const inRun = sample('.fx-rec', 'transform', 520)
  await card.click()
  await wait(90); await shot('client-drawer-in-90ms', clip)
  const din = await inRun
  await wait(300); await shot('client-drawer-open', clip)
  const outRun = sample('.fx-rec', 'transform', 320)
  await page.locator('.fx-rec .fx-x').first().click()
  await wait(80); await shot('client-drawer-out-80ms', clip)
  const dout = await outRun
  await wait(300)
  // Escape and click outside close it the same way
  await card.click(); await wait(600)
  const escRun = sample('.fx-rec', 'transform', 320)
  await page.keyboard.press('Escape')
  const desc = await escRun
  await wait(300)
  let dside = 'n/a: below 1000 px the drawer covers the screen (no outside)'
  if (W >= 1000) {
    await card.click(); await wait(600)
    const outsideRun = sample('.fx-rec', 'transform', 320)
    await page.mouse.click(40, H - 40)
    dside = await outsideRun
    await wait(400)
  }
  // notifications
  const bell = page.locator('.fx-ib.is-bell:visible').first()
  const bin = sample('.tp-sheet', 'transform', 520)
  await bell.click()
  await wait(90); await shot('bell-in-90ms', clip)
  const nin = await bin
  await wait(300)
  const bout = sample('.tp-sheet', 'transform', 320)
  await page.keyboard.press('Escape')
  await wait(80); await shot('bell-out-80ms', clip)
  const nout = await bout
  report.views.drawers = { clientIn: steps(din), clientOutX: steps(dout), clientOutEsc: steps(desc), clientOutOutside: typeof dside === 'string' ? dside : steps(dside), bellIn: steps(nin), bellOut: steps(nout), lastOut: dout.at(-1)?.v }
}

// ── Cards: hover lifts, click presses, a sweep makes a wave, and 30 clicks later it still moves ──
const hoverLift = async sel => {
  const el = page.locator(sel).first()
  await el.scrollIntoViewIfNeeded()
  const b = await el.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + 6)
  await wait(380)
  const v = await page.evaluate(s => getComputedStyle(document.querySelector(s)).translate, sel)
  await page.mouse.move(5, H - 5); await wait(800)
  return v
}
async function cards(root) {
  await go(CLIENTS)
  const clip = { x: 0, y: 0, width: W, height: H }
  const sel = '.fx-cgrid > .fx-ccard'
  const first = await hoverLift(sel)
  // hover frames
  const b = await page.locator(sel).first().boundingBox()
  await shot('card-rest', { x: b.x - 10, y: b.y - 14, width: Math.min(b.width * 2 + 40, W - b.x + 10), height: b.height + 28 })
  await page.mouse.move(b.x + b.width / 2, b.y + 8); await wait(260)
  await shot('card-hover', { x: b.x - 10, y: b.y - 14, width: Math.min(b.width * 2 + 40, W - b.x + 10), height: b.height + 28 })
  await page.mouse.down(); await wait(120)
  const pressed = await page.evaluate(s => getComputedStyle(document.querySelector(s)).scale, sel)
  await page.mouse.move(5, H - 5); await page.mouse.up(); await wait(800)
  // the wave: sweep across the first row of cards and read every card's lift at one moment mid-sweep
  const row = await page.evaluate(s => { const els = [...document.querySelectorAll(s)]; const top = els[0].getBoundingClientRect().top; return els.filter(e => Math.abs(e.getBoundingClientRect().top - top) < 4).map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }) }, sel)
  const y = row[0].y + row[0].h / 2
  await page.mouse.move(row[0].x + 4, y)
  const stepsN = 18
  for (let i = 1; i <= stepsN; i++) { await page.mouse.move(row[0].x + 4 + (row.at(-1).x + row.at(-1).w - row[0].x - 8) * i / stepsN, y); await wait(22) }
  const wave = await page.evaluate(s => { const els = [...document.querySelectorAll(s)]; const top = els[0].getBoundingClientRect().top; return els.filter(e => Math.abs(e.getBoundingClientRect().top - top) < 8).map(e => getComputedStyle(e).translate) }, sel)
  await shot('card-sweep-wave', { x: 0, y: Math.max(0, row[0].y - 20), width: W, height: row[0].h + 40 })
  await page.mouse.move(5, H - 5); await wait(900)
  report.views.cards = { firstHover: first, pressed, wave, rowCards: row.length }
}

// 30 clicks across the shell (tabs, icons, the avatar menu, drawers open and shut), then the same hover.
async function thirty(root) {
  const tabs = ['Leads', 'Clients', 'Calendar', 'Overview', 'Activity', 'Billing']
  let n = 0
  const click = async loc => { if (await loc.count()) { await loc.first().click({ timeout: 4000 }).catch(() => {}); n++; await wait(260) } }
  await go(root)
  for (let round = 0; n < 30 && round < 6; round++) {
    for (const t of tabs) { if (n >= 30) break; await click(page.locator('.fx-tabs a, .fx-tabs button').filter({ hasText: t })) }
    await click(page.locator('.fx-ib.is-bell:visible')); await page.keyboard.press('Escape'); await wait(300)
    await click(page.locator('.fx-me:visible')); await click(page.locator('.fx-me:visible'))
    await click(page.locator('.fx-ib[href*="messages"]:visible')); await click(page.locator('.fx-ib[href*="messages"]:visible'))
  }
  await go(`${root}/clients`).catch(() => {})
  // not a reload: navigate in-app so the session (and any stuck state) carries over
  const settled = await settledState()
  report.views.after30 = { clicks: n, ...settled }
}
async function thirtyInApp(root) {
  // the same, without reloading at the end: back to Clients through the tab
  const tabs = ['Leads', 'Clients', 'Calendar', 'Overview', 'Activity', 'Billing']
  let n = 0
  const click = async loc => { if (await loc.count()) { await loc.first().click({ timeout: 4000 }).catch(() => {}); n++; await wait(240) } }
  await go(root)
  const tabN = await page.locator('.fx-tabs a:visible').count()
  while (n < 30) {
    for (let k = 0; k < tabN; k++) { if (n >= 30) break; await click(page.locator('.fx-tabs a:visible').nth(k)) }
    await click(page.locator('.fx-ib.is-bell:visible')); await page.keyboard.press('Escape'); await wait(260)
    await click(page.locator('.fx-me:visible')); await click(page.locator('.fx-me:visible'))
  }
  await click(page.locator('.fx-tabs a:visible').filter({ hasText: 'Clients' })); await wait(1400)
  if (!(await page.locator('.fx-cgrid > .fx-ccard').count())) { await go(CLIENTS) } // the tab is named otherwise: open it (a reload)
  const lift = await hoverLift('.fx-cgrid > .fx-ccard')
  // and a drawer still slides
  const inRun = sample('.fx-rec', 'transform', 520)
  await page.locator('.fx-ccard .fx-cover').first().click()
  const din = await inRun
  await page.keyboard.press('Escape'); await wait(400)
  report.views.after30InApp = { clicks: n, lift, drawerInSteps: steps(din), ...(await settledState()) }
}

// ── Layout: Leads with live cards keeps full-size columns and scrolls; Activity has no page scroll; Billing ──
async function layout(root) {
  await go(`${root}/leads`)
  const leads = await page.evaluate(() => ({ live: document.querySelectorAll('.lv-card').length, kinds: [...new Set([...document.querySelectorAll('.lv-k')].map(e => e.textContent))], answer: [...document.querySelectorAll('.lv-card button')].some(b => /answer/i.test(b.textContent)), liveBg: document.querySelector('.lv-card') && getComputedStyle(document.querySelector('.lv-card')).backgroundColor, board: Math.round(document.querySelector('.lc-board')?.getBoundingClientRect().height || 0), scroll: document.scrollingElement.scrollHeight, inner: innerHeight }))
  // mark every live call (the cards go away) and compare the board
  for (let i = 0; i < 6; i++) {
    const btn = page.locator('.lv-card .lv-res[data-result="not_interested"]').first()
    if (!(await btn.count())) break
    await btn.click(); await wait(300)
    const save = page.locator('.tp-layer .tp-sheet footer .tp-primary, .tp-layer .tp-sheet .tp-primary').first()
    if (await save.count()) { await save.click().catch(() => {}); await wait(500) }
  }
  await wait(600)
  const after = await page.evaluate(() => ({ live: document.querySelectorAll('.lv-card').length, board: Math.round(document.querySelector('.lc-board')?.getBoundingClientRect().height || 0), scroll: document.scrollingElement.scrollHeight }))
  await go(`${root}/activity`)
  const activity = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: innerHeight, box: document.querySelector('.fx-act-body') && getComputedStyle(document.querySelector('.fx-act-body')).overflowY }))
  await go(`${root}/billing`)
  const billing = await page.evaluate(() => ({ sections: [...document.querySelectorAll('section[aria-label]')].map(s => s.getAttribute('aria-label')), card: document.querySelector('.bl-cardface')?.getAttribute('aria-label'), charges: [...document.querySelectorAll('.bl-charges > li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()).slice(0, 8), teamTime: /team time|at cost/i.test(document.body.innerText) }))
  await go(root)
  const overview = await page.evaluate(() => ({ liveCards: document.querySelectorAll('.lv-card').length, todos: [...document.querySelectorAll('[aria-label="Your to-dos"] .fx-ncard, [aria-label="Your to-dos"] li')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).slice(0, 6) }))
  report.views.layout = { leads, leadsAfterMarking: after, activity, billing, overview }
}

const root = arg('root', '/template')
const CLIENTS = arg('clients', `${root}/clients`)
try {
  if (ONLY === 'all' || ONLY === 'layout') await layout(root)
  if (ONLY === 'all' || ONLY === 'motion') { await messages(root); await drawers(root); await cards(root); await thirtyInApp(root) }
  if (ONLY === 'shell') { await messages(root); await drawers(root) }
} catch (e) { report.error = String(e.stack || e) }
report.errors = errors
writeFileSync(join(OUT, `${tag}-${root.replace(/\W/g, '') || 'root'}-report.json`), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1).slice(0, 6000))
await browser.close()
