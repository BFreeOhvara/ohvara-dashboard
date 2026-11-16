// P1016 — starter static ads: 3 per lead type, 1080×1080 and 1080×1350, Deedstone Insurance branding.
// Honest claims only: no rates, no "you qualify", no guaranteed approval, no government or lender look, and no copy
// that asserts the viewer's personal traits (Meta's personal-attributes rule; insurance runs in the Financial products
// and services special ad category). RUN: node scripts/p1016-ads.mjs <outDir>  → <outDir>/<type>/<type>-<n>-<size>.png
import process from 'node:process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const OUT = process.argv[2] || '.p1016-ads'
const FONTS = new URL('../node_modules/@fontsource/', import.meta.url)
const font = (fam, w) => `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(new URL(`${fam.toLowerCase()}/files/${fam.toLowerCase()}-latin-${w}-normal.woff2`, FONTS)).toString('base64')}) format('woff2')}`
const FACES = [font('Urbanist', 700), font('Urbanist', 800), font('Manrope', 500), font('Manrope', 600), font('Manrope', 700)].join('')

// Deedstone Insurance look (ads only; the app keeps its own tokens): ink navy, warm stone, muted gold.
const C = { ink: '#13233d', ink2: '#1d3354', stone: '#f3efe7', stone2: '#e6dfd2', gold: '#c49a3a', text: '#13233d', mute: '#55627a', onInk: '#f3efe7', onInkMute: '#b9c2d3' }

const ICON = {
  house: '<path d="M10 30 L32 12 L54 30" /><path d="M16 26 V52 H48 V26" /><path d="M27 52 V38 H37 V52" />',
  candle: '<path d="M26 26 H38 V52 H26 Z" /><path d="M32 26 V20" /><path d="M32 8 C36 13 36 17 32 19 C28 17 28 13 32 8 Z" /><path d="M18 52 H46" />',
  chart: '<path d="M10 52 H54" /><path d="M14 44 L26 34 L34 40 L50 22" /><path d="M42 22 H50 V30" /><path d="M14 48 H50" stroke-dasharray="2 5" />',
  truck: '<path d="M8 20 H38 V44 H8 Z" /><path d="M38 28 H48 L56 36 V44 H38" /><circle cx="18" cy="46" r="5" /><circle cx="46" cy="46" r="5" />',
  star: '<path d="M32 8 L38 25 L56 25 L41 36 L47 54 L32 43 L17 54 L23 36 L8 25 L26 25 Z" />',
  calendar: '<rect x="10" y="14" width="44" height="40" rx="4" /><path d="M10 24 H54" /><path d="M22 8 V18 M42 8 V18" /><path d="M22 38 L29 45 L43 31" />',
}

// The three ads per type. `a` = headline ad, `b` = plain-words checklist, `c` = how it works (same for every type).
const TYPES = [
  { key: 'mortgage_protection', name: 'Mortgage protection', icon: 'house',
    a: { h: 'Keep the house in the family.', s: 'Mortgage protection is life insurance that can help pay off your home if you pass away.' },
    b: { h: 'Mortgage protection, in plain words', items: ['Life cover sized to what you owe on your home', 'Paid to the people you name if you pass away', 'They choose how to use it, like paying off the mortgage'] },
    fine: 'Deedstone Insurance is not your lender or a government program. Coverage depends on eligibility and underwriting.' },
  { key: 'final_expense', name: 'Final expense', icon: 'candle',
    a: { h: 'Spare your family the funeral bill.', s: 'Final expense life insurance helps cover funeral costs and final bills.' },
    b: { h: 'Final expense, in plain words', items: ['A smaller policy made for end-of-life costs', 'Paid to the person you name', 'A licensed agent helps you find an amount that fits your budget'] },
    fine: 'Coverage depends on eligibility and underwriting. Not a government program.' },
  { key: 'iul', name: 'IUL', icon: 'chart',
    a: { h: 'Life insurance that can also build cash value.', s: 'Indexed universal life (IUL) ties cash value growth to a market index, with limits on gains and losses.' },
    b: { h: 'IUL, in plain words', items: ['A death benefit for the people you name', 'Cash value that can grow over time', 'Growth linked to an index, with a cap and a floor'] },
    fine: 'Cash value growth is not guaranteed and depends on the policy, its fees and the index. Coverage depends on eligibility and underwriting.' },
  { key: 'truckers', name: 'Truckers', icon: 'truck',
    a: { h: 'Life insurance for life on the road.', s: 'Coverage options for CDL drivers and owner-operators, with phone appointments that fit your schedule.' },
    b: { h: 'Built around driving schedules', items: ['Options for long-haul and local drivers', 'Talk to a licensed agent by phone, between loads', 'Coverage for the people waiting at home'] },
    fine: 'Coverage depends on eligibility and underwriting.' },
  { key: 'veterans', name: 'Veterans', icon: 'star',
    a: { h: 'Life insurance options for veterans and military families.', s: 'Compare private life insurance with a licensed agent, by phone.' },
    b: { h: 'Private coverage, explained simply', items: ['Private life insurance, not a VA program', 'Can sit alongside coverage you already have', 'A licensed agent walks you through it by phone'] },
    fine: 'Deedstone Insurance is not affiliated with the VA or any government agency. Coverage depends on eligibility and underwriting.' },
  { key: 'term_life', name: 'Term life', icon: 'calendar',
    a: { h: 'Coverage for the years your family needs it most.', s: 'Term life insurance pays the people you name if you pass away during the term you choose.' },
    b: { h: 'Term life, in plain words', items: ['Pick a term, like 10, 20 or 30 years', 'A set amount paid to the people you name', 'Simple to compare with a licensed agent'] },
    fine: 'Coverage depends on eligibility and underwriting.' },
]
const STEPS = ['Answer a few short questions', 'We call to set up a time', 'A licensed agent walks you through your options']

const css = `${FACES}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:var(--h);font-family:Manrope,sans-serif;-webkit-font-smoothing:antialiased}
.ad{width:1080px;height:var(--h);display:flex;flex-direction:column;padding:84px 84px 64px;position:relative;overflow:hidden}
.ad.ink{background:${C.ink};color:${C.onInk}}
.ad.stone{background:${C.stone};color:${C.text}}
.brand{display:flex;align-items:center;gap:16px;font-family:Urbanist;font-weight:800;font-size:34px;letter-spacing:.01em}
.brand i{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;background:${C.gold};color:${C.ink};font-style:normal;font-size:28px}
.brand small{font-family:Manrope;font-weight:600;font-size:22px;opacity:.75;margin-left:2px}
.tag{display:inline-block;align-self:flex-start;margin-top:auto;padding:10px 22px;border-radius:999px;font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase}
.ink .tag{background:rgba(196,154,58,.16);color:${C.gold}}
.stone .tag{background:${C.stone2};color:${C.ink2}}
h1{font-family:Urbanist;font-weight:800;line-height:1.04;letter-spacing:-.015em;margin-top:28px}
.a h1{font-size:var(--hA)}
.b h1,.c h1{font-size:var(--hB)}
.sub{margin-top:28px;font-size:36px;line-height:1.35;font-weight:500;max-width:880px}
.ink .sub{color:${C.onInkMute}}
.stone .sub{color:${C.mute}}
ul,ol{list-style:none;margin-top:44px;display:flex;flex-direction:column;gap:26px}
li{display:flex;gap:24px;align-items:flex-start;font-size:36px;line-height:1.3;font-weight:600}
li b{flex:none;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-family:Urbanist;font-size:28px;font-weight:800}
.ink li b{background:${C.gold};color:${C.ink}}
.stone li b{background:${C.ink};color:${C.stone}}
.cta{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:24px;padding-top:40px}
.btn{padding:24px 40px;border-radius:16px;font-weight:700;font-size:32px}
.ink .btn{background:${C.gold};color:${C.ink}}
.stone .btn{background:${C.ink};color:${C.stone}}
.cta span{font-size:24px;font-weight:600;opacity:.8}
.fine{margin-top:28px;font-size:19px;line-height:1.4;opacity:.62}
.art{margin-top:auto;width:var(--art);height:var(--art);color:${C.gold}}
.stone .art{color:${C.ink2}}
.art svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.art + .tag{margin-top:28px !important}
.cta{margin-top:44px;padding-top:0}
.gold{color:${C.gold}}`

const brand = '<div class="brand"><i>D</i>Deedstone<small>Insurance</small></div>'
const art = t => `<div class="art"><svg viewBox="0 0 64 64">${ICON[t.icon]}</svg></div>`
const cta = (label = 'See your options') => `<div class="cta"><div class="btn">${label}</div><span>No cost to ask. No obligation.</span></div>`
const ads = t => [
  `<div class="ad ink a">${brand}${art(t)}<span class="tag">${t.name}</span><h1>${t.a.h}</h1><p class="sub">${t.a.s}</p>${cta()}<p class="fine">${t.fine}</p></div>`,
  `<div class="ad stone b">${brand}${art(t)}<span class="tag">${t.name}</span><h1>${t.b.h}</h1><ul>${t.b.items.map(i => `<li><b>✓</b><span>${i}</span></li>`).join('')}</ul>${cta('Request information')}<p class="fine">${t.fine}</p></div>`,
  `<div class="ad ink c">${brand}${art(t)}<span class="tag">${t.name}</span><h1>How it works</h1><ol>${STEPS.map((s, i) => `<li><b>${i + 1}</b><span>${s}</span></li>`).join('')}</ol>${cta('Get started')}<p class="fine">${t.fine}</p></div>`,
]
const SIZES = { '1080x1080': { h: 1080, hA: '84px', hB: '68px', art: '96px' }, '1080x1350': { h: 1350, hA: '100px', hB: '76px', art: '120px' } }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } })
const problems = []
for (const t of TYPES) {
  const dir = join(OUT, t.key)
  mkdirSync(dir, { recursive: true })
  for (const [size, v] of Object.entries(SIZES)) {
    await page.setViewportSize({ width: 1080, height: v.h })
    for (const [i, html] of ads(t).entries()) {
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="--h:${v.h}px;--hA:${v.hA};--hB:${v.hB};--art:${v.art}">${html}</body></html>`)
      await page.evaluate(() => document.fonts.ready)
      // Nothing may spill past the frame: the last line (fine print) must end inside it.
      const fit = await page.evaluate(() => { const ad = document.querySelector('.ad'), f = document.querySelector('.fine'); return { over: f.getBoundingClientRect().bottom - ad.getBoundingClientRect().bottom, sh: ad.scrollHeight, ch: ad.clientHeight } })
      if (fit.over > -20 || fit.sh > fit.ch) problems.push(`${t.key} ${i + 1} ${size}: ${JSON.stringify(fit)}`)
      await page.screenshot({ path: join(dir, `${t.key}-${i + 1}-${size}.png`), clip: { x: 0, y: 0, width: 1080, height: v.h } })
    }
  }
}
await browser.close()
console.log(problems.length ? `OVERFLOW:\n${problems.join('\n')}` : 'all 36 ads fit their frames')
