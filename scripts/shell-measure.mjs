// P830: measure the agent shell the way the Solvik study did (sizes, weights, text colours, card fill, accent
// saturation). Usage: node scripts/shell-measure.mjs --base-url <url> [--path /template] [--theme dark|light] [--w 1440]
import process from 'node:process'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', 'http://localhost:4173').replace(/\/$/, '')
const PATH = flag('--path', '/template')
const THEME = flag('--theme', 'dark')
const W = Number(flag('--w', 1440))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: 900 } })
await page.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, THEME)
await page.goto(BASE + PATH, { waitUntil: 'networkidle' })
await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), THEME)
await page.waitForTimeout(1600)
const m = await page.evaluate(() => {
  const cs = el => (el ? getComputedStyle(el) : null)
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number)
  const sat = s => { const [r, g, b] = rgb(s).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; return mx === mn ? 0 : +((mx - mn) / (1 - Math.abs(2 * l - 1))).toFixed(2) }
  const q = s => document.querySelector(s)
  const title = q('.fx-title'), huge = q('.fx-huge') || q('.fx-kpi-t > b'), tile = q('.fx-tile'), h2 = q('.fx-tile-h h2')
  const root = q('.tp')
  const tokens = ['--accent', '--ov-data-a', '--ov-data-b', '--ov-warn', '--ov-up', '--danger'].map(t => {
    const probe = document.createElement('i'); probe.style.color = `var(${t})`; root.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return `${t} ${c} s${sat(c)}`
  })
  // largest weight on text bigger than 12px
  const heavy = new Set()
  for (const el of document.querySelectorAll('.tp *')) { const s = cs(el); if (el.childElementCount === 0 && el.textContent.trim() && +s.fontWeight >= 700 && parseFloat(s.fontSize) > 12 && el.offsetParent) heavy.add(`${el.className || el.tagName} ${s.fontWeight}/${s.fontSize}`) }
  return {
    font: cs(root).fontFamily.split(',')[0], bodyWeight: cs(root).fontWeight, bodySize: cs(root).fontSize,
    title: title && `${cs(title).fontSize} ${cs(title).fontWeight} ${cs(title).letterSpacing}`,
    biggestNumber: huge && cs(huge).fontSize, tileHeading: h2 && cs(h2).fontSize,
    primaryText: cs(q('.fx-line + .fx-line') || title).color, secondaryText: cs(q('.fx-tile-h p') || q('.fx-kpi-t > span')).color,
    page: cs(q('.tp-sky')).backgroundColor,
    cardFill: tile && cs(tile).backgroundColor, cardBorder: tile && cs(tile).borderTopColor,
    cardPad: tile && cs(tile).padding, cardRadius: tile && cs(tile).borderRadius,
    accents: tokens, heavyText: [...heavy].slice(0, 12),
    sideScroll: document.documentElement.scrollWidth > innerWidth,
  }
})
console.log(JSON.stringify(m, null, 1))
await browser.close()
