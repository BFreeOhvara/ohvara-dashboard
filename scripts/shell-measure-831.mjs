// P831: the extra numbers P831 asks for (top-bar weights and gaps, fill saturation, card fill, backdrop spread,
// rail sizes, faintest text contrast) plus a Settings tab switch / Discard / Save check. Sample /template only.
//   node scripts/shell-measure-831.mjs --base-url http://localhost:5173 [--theme dark|light]
import process from 'node:process'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', 'http://localhost:5173').replace(/\/$/, '')
const THEME = flag('--theme', 'dark')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, THEME)

const measure = () => page.evaluate(() => {
  const cs = el => getComputedStyle(el)
  const nums = s => (s.match(/[\d.]+/g) || []).map(Number)
  const hsl = s => { const [r, g, b] = nums(s).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; return { s: mx === mn ? 0 : +((mx - mn) / (1 - Math.abs(2 * l - 1))).toFixed(2), l: +l.toFixed(2) } }
  const lin = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const lum = s => { const [r, g, b] = nums(s).map(v => lin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(1) }
  const q = s => document.querySelector(s)
  const tab = q('.fx-tab:not(.is-on)'), tabs = [...document.querySelectorAll('.fx-tab')]
  const gap = tabs.length > 1 ? Math.round(tabs[1].getBoundingClientRect().left - tabs[0].getBoundingClientRect().right) : null
  const rail = q('.fx-rail'), ri = q('.fx-ri'), ris = [...document.querySelectorAll('.fx-rail > .fx-ri')]
  const fills = [...document.querySelectorAll('.fx-card, .tp-chip, .fx-delta, .fx-tab.is-on, .fx-accent')].filter(e => e.offsetParent).slice(0, 40).map(e => `${e.className.split(' ')[0]} ${cs(e).backgroundColor} s${hsl(cs(e).backgroundColor).s} l${hsl(cs(e).backgroundColor).l}`)
  const tile = q('.fx-tile')
  // faintest text: lowest contrast of small text vs the page colour under glass
  const page = getComputedStyle(document.documentElement).getPropertyValue('--sh-base').trim()
  const probe = document.createElement('i'); probe.style.color = page; document.body.append(probe); const pageRgb = cs(probe).color; probe.remove()
  let worst = 99, worstEl = ''
  for (const el of document.querySelectorAll('.fx-main *, .fx-head *')) {
    if (el.childElementCount || !el.textContent.trim() || !el.offsetParent || el.closest('.fx-card, .tp-chip, .fx-delta, .fx-accent, .fx-usage, .fx-tab, .fx-tb, .fx-badge, .tp-tag, .fx-date, .fx-row-ic')) continue
    const c = cr(cs(el).color, pageRgb); if (c < worst) { worst = c; worstEl = `${el.className || el.tagName} ${cs(el).color}` }
  }
  return {
    tabWeight: tab && cs(tab).fontWeight, tabSize: tab && cs(tab).fontSize, tabHeight: tab && cs(tab).height, tabPad: tab && cs(tab).paddingLeft, tabGap: gap,
    activeTab: cs(q('.fx-tab.is-on')).backgroundColor,
    rail: rail && `${Math.round(rail.getBoundingClientRect().width)}px wide, buttons ${Math.round(ri.getBoundingClientRect().width)}px, gap ${Math.round(ris[1].getBoundingClientRect().top - ris[0].getBoundingClientRect().bottom)}px, separators ${document.querySelectorAll('.fx-rail > .fx-hair').length}`,
    card: tile && `${cs(tile).backgroundColor} border ${cs(tile).borderTopColor}`,
    backdrop: cs(q('.tp-sky')).backgroundImage.slice(0, 120), worstText: `${worst}:1 ${worstEl}`, fills,
  }
})

await page.goto(`${BASE}/template`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1800)
console.log('OVERVIEW', JSON.stringify(await measure(), null, 1))
await page.goto(`${BASE}/template/leads`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1800)
console.log('LEADS fills', JSON.stringify((await measure()).fills.filter(f => f.startsWith('fx-card')).slice(0, 5)))

// backdrop spread: lightness range of the backdrop image across the screen, tiles hidden
await page.addStyleTag({ content: '.fx-col, .fx-top, .fx-rail { visibility: hidden !important; }' })
await page.waitForTimeout(300)
const shot = await page.screenshot({ type: 'png' })
console.log('backdrop png bytes', shot.length)

// Settings: tabs switch sections; Save starts off, turns on after an edit, Discard puts it back
await page.goto(`${BASE}/template/settings`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500)
const st = async () => page.evaluate(() => ({ heading: document.querySelector('.fx-form-h h2')?.textContent, save: !document.querySelector('.fx-form-f .tp-primary')?.disabled, tabs: [...document.querySelectorAll('.fx-ptab')].map(t => t.textContent) }))
const r = [await st()]
await page.click('.fx-ptab >> text=Notifications'); await page.waitForTimeout(400); r.push(await st())
await page.click('.fx-alerts .tp-switch >> nth=0'); await page.waitForTimeout(200); r.push(await st())
await page.click('.fx-form-f >> text=Discard'); await page.waitForTimeout(200); r.push(await st())
await page.click('.fx-ptab >> text=Active and calls'); await page.waitForTimeout(400); r.push(await st())
console.log('SETTINGS', JSON.stringify(r.map(x => `${x.heading} save=${x.save}`)), 'tabs:', r[0].tabs.join(' | '))
await browser.close()
