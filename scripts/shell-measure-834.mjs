// P834: the numbers P834 asks for, ours (sample /template), to put beside Solvik's (scripts/solvik-probe-834.mjs):
// active pill colours, light base, card fills/borders/ink per theme, bar sizes, status button colours, the deep panel,
// plus the background-tab check (no animation frames at all: nothing may sit invisible or at 0).
//   node scripts/shell-measure-834.mjs --base-url http://localhost:5173
import process from 'node:process'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', 'http://localhost:5173').replace(/\/$/, '')
const browser = await chromium.launch()

const open = async (theme, path, { frozen = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, theme)
  // A background tab: animation frames never run.
  if (frozen) await page.addInitScript(() => { window.requestAnimationFrame = () => 0 })
  await page.goto(`${BASE}/template${path}`, { waitUntil: 'networkidle' })
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
  await page.waitForTimeout(frozen ? 1400 : 2000)
  return { page, ctx }
}

const measure = page => page.evaluate(() => {
  const cs = e => getComputedStyle(e)
  const q = s => document.querySelector(s)
  const box = e => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` }
  const on = q('.fx-tab.is-on')
  const card = q('.fx-lcard, .fx-ccard')
  const rail = q('.fx-rail'), ri = q('.fx-rail .fx-ri:not(.fx-plus)'), svg = ri?.querySelector('svg')
  const lane = q('.fx-lane')
  return {
    activePill: on && `${cs(on).backgroundColor} text ${cs(on).color}`,
    base: getComputedStyle(document.documentElement).getPropertyValue('--sh-base').trim(),
    surface: getComputedStyle(document.documentElement).getPropertyValue('--sh-surface').trim(),
    tile: q('.fx-tile') && `${cs(q('.fx-tile')).backgroundColor} border ${cs(q('.fx-tile')).borderTopColor}`,
    deep: q('.fx-tile.is-deep') && `${cs(q('.fx-tile.is-deep')).backgroundColor} ink ${cs(q('.fx-tile.is-deep h2')).color}`,
    card: card && `${cs(card).backgroundColor} border ${cs(card).borderTopWidth} ${cs(card).borderTopColor} title ${cs(card.querySelector('h3')).color} shadow ${cs(card).boxShadow.slice(0, 40)}`,
    lane: lane && `${cs(lane).backgroundColor}`,
    topBar: q('.fx-tabs') && `${box(q('.fx-tabs'))} tab ${box(on)}`,
    rail: rail && `${box(rail)} button ${box(ri)} icon ${svg && Math.round(svg.getBoundingClientRect().width)} items ${document.querySelectorAll('.fx-rail > .fx-ri').length} separators ${document.querySelectorAll('.fx-rail > .fx-hair').length}`,
    seg: q('.tp-seg > .on') && `${cs(q('.tp-seg > .on')).backgroundColor} text ${cs(q('.tp-seg > .on')).color}`,
    statusButtons: [...document.querySelectorAll('.fx-filter')].map(b => `${b.textContent.replace(/\d+$/, '')}: ${cs(b).backgroundColor}${b.classList.contains('is-on') ? ' (on)' : ''}`),
  }
})

for (const theme of ['dark', 'light']) {
  for (const path of ['', '/leads', '/clients']) {
    const { page, ctx } = await open(theme, path)
    console.log(theme, path || '/', JSON.stringify(await measure(page), null, 1))
    await ctx.close()
  }
}

// Background tab: no animation frames. Every page must show its content at full opacity and its real numbers.
for (const path of ['', '/leads', '/clients', '/calendar', '/activity', '/billing', '/settings']) {
  const { page, ctx } = await open('dark', path, { frozen: true })
  const r = await page.evaluate(() => {
    const hidden = [...document.querySelectorAll('.fx-main *, .fx-head *')].filter(e => e.offsetParent && e.textContent.trim() && !e.childElementCount)
      .filter(e => { let n = e; while (n && n !== document.body) { if (parseFloat(getComputedStyle(n).opacity) < 0.99) return true; n = n.parentElement } return false })
    const zeros = [...document.querySelectorAll('.fx-kpis b')].map(b => b.textContent)
    return { anim: document.querySelector('.fx').classList.contains('is-anim'), faded: hidden.length, sample: hidden.slice(0, 3).map(e => e.textContent.slice(0, 30)), kpis: zeros }
  })
  console.log('background tab', path || '/', JSON.stringify(r))
  await ctx.close()
}
await browser.close()
