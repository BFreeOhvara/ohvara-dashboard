// P840: screens of Overview, Leads, Activity and Billing at 1440/390 x light/dark into qa/shell-840/,
// plus a computed-colour scan: every element's colours on every shell page, flagging anything mint-like
// (hue 150-190, saturated) and listing where the apricot accent shows up.
//   node scripts/shell-shots-836.mjs [--base-url http://localhost:5173] [--scan-only]
import process from 'node:process'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const i = args.indexOf('--base-url')
const BASE = (i >= 0 ? args[i + 1] : 'http://localhost:5173').replace(/\/$/, '')
const SCAN_ONLY = args.includes('--scan-only')
const SHOTS = ['overview', 'leads', 'activity', 'billing']
const ALL = ['', 'leads', 'clients', 'calendar', 'activity', 'billing', 'settings', 'messages', 'submit', 'more', 'welcome', 'signup']
const b = await chromium.launch()
const report = { mint: [], apricot: {}, errs: [], overflow: {} }

async function scan(p, tag) {
  return p.evaluate(tag => {
    const hits = []; const acc = new Set()
    const parse = s => [...s.matchAll(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)|color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g)].map(m => m[1] ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : [m[5] * 255, m[6] * 255, m[7] * 255, m[8] === undefined ? 1 : +m[8]])
    const hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; return [h, s, l] }
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor', 'fill', 'stroke', 'backgroundImage', 'boxShadow']) {
        if (prop === 'color' && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
        if (prop === 'borderTopColor' && parseFloat(cs.borderTopWidth) === 0) continue
        if (prop === 'outlineColor' && cs.outlineStyle === 'none') continue
        for (const c of parse(cs[prop] || '')) {
          if (c[3] < 0.08) continue
          const [h, s, l] = hsl(c)
          const name = (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 40) || el.tagName
          if (h >= 150 && h <= 190 && s > 0.25 && l > 0.15 && l < 0.92) hits.push(`${tag} ${name} ${prop} rgb(${c.slice(0, 3).map(Math.round)})`)
          if (h >= 22 && h <= 40 && s > 0.35 && l > 0.2) acc.add(`${name}:${prop}`)
        }
      }
    }
    return { hits: [...new Set(hits)].slice(0, 20), acc: [...acc] }
  }, tag)
}

for (const theme of (args.includes('--theme') ? [args[args.indexOf('--theme') + 1]] : ['dark', 'light'])) {
  for (const w of (args.includes('--w') ? [+args[args.indexOf('--w') + 1]] : [1440, 390])) {
    const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : (w === 1920 ? 1080 : 900) }, deviceScaleFactor: 1 })
    const p = await ctx.newPage()
    p.on('pageerror', e => report.errs.push(`${theme} ${w} ${e.message}`))
    p.on('console', m => { if (m.type() === 'error') report.errs.push(`${theme} ${w} ${m.text()}`) })
    await p.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, theme)
    const pages = SCAN_ONLY || w !== 1440 ? (SCAN_ONLY ? ALL : SHOTS.map(s => (s === 'overview' ? '' : s))) : ALL
    for (const pg of pages) {
      await p.goto(`${BASE}/template/${pg}`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(2200)
      const tag = `${theme}/${w}/${pg || 'overview'}`
      const s = await scan(p, tag)
      report.mint.push(...s.hits); report.apricot[tag] = [...new Set(s.acc.map(a => a.split(":")[0]))]
      report.overflow[tag] = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      if (!SCAN_ONLY && SHOTS.includes(pg || 'overview')) await p.screenshot({ path: `qa/shell-840/${pg || 'overview'}-${w}-${theme}.png`, fullPage: w === 390 })
    }
    await ctx.close()
  }
}
console.log(JSON.stringify(report, null, 1))
await b.close()
