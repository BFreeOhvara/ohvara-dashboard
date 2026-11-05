// P842 proof: (1) frame strips of the tab stretch (top bar Overview -> Billing, Leads All -> Live calls), with the
// pill's span measured at each frame; (2) Overview + Clients at 1440/390 x light/dark; (3) colour reads: avatars,
// own avatar, badges, every selected tab item. Writes qa/shell-842/.
//   node scripts/shell-shots-842.mjs [--base-url http://localhost:5173]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || 'http://localhost:5173').replace(/\/$/, '')
const OUT = 'qa/shell-842'
mkdirSync(`${OUT}/stretch-842`, { recursive: true })
const report = { stretch: {}, colours: {}, errs: [], overflow: {} }
const b = await chromium.launch()
const theme = async (ctx, t) => ctx.addInitScript(x => { try { localStorage.setItem('theme', x); localStorage.setItem('ohvara-theme', x) } catch { /* private */ } }, t)

// 1. Stretch frames: animations slowed 10x through DevTools (timers and the page keep real time), the row shot at
// each step with the flight's own clock read off the pill, so every frame is a real moment of a real flight.
async function strip(p, name, rowSel, clickSel) {
  const row = p.locator(rowSel).first()
  const cdp = await p.context().newCDPSession(p)
  await cdp.send('Animation.enable')
  await p.waitForTimeout(400)
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
  await p.locator(clickSel).first().click()
  const frames = []
  for (let k = 0; k < 400; k++) {
    await p.waitForTimeout(60)
    const at = await p.evaluate(rowSel => {
      const layer = document.querySelector(`${rowSel} .sp-pill .sp-layer`)
      const anim = layer?.getAnimations()[0]
      if (!anim) return null
      const m = /inset\(([\d.]+)px calc\(100% - ([\d.]+)px\) calc\(100% - ([\d.]+)px\) ([\d.]+)px/.exec(getComputedStyle(layer).clipPath)
      return { t: Math.round(anim.currentTime), left: m ? +m[4] : null, right: m ? +m[2] : null }
    }, rowSel)
    if (!at) { if (frames.length) break; continue }
    if (!frames.length || at.t - frames.at(-1).t >= 30) {
      await row.screenshot({ path: `${OUT}/stretch-842/${name}-${String(at.t).padStart(3, '0')}.png` })
      frames.push(at)
    }
  }
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
  await p.waitForTimeout(300)
  await row.screenshot({ path: `${OUT}/stretch-842/${name}-end.png` })
  report.stretch[name] = frames
}

for (const t of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await theme(ctx, t)
  const p = await ctx.newPage()
  p.on('pageerror', e => report.errs.push(`${t} ${e.message}`))
  p.on('console', m => { if (m.type() === 'error') report.errs.push(`${t} ${m.text()}`) })
  await p.goto(`${BASE}/template/`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  if (t === 'dark') {
    await strip(p, 'topbar-overview-to-billing', 'nav.fx-tabs', 'nav.fx-tabs a:has-text("Billing")')
    await p.goto(`${BASE}/template/leads`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    await strip(p, 'leads-all-to-live', '.tp-seg', '.tp-seg button:has-text("Live calls")')
  }
  for (const [path, label] of [['', 'overview'], ['leads', 'leads'], ['clients', 'clients'], ['activity', 'activity'], ['settings', 'settings'], ['billing', 'billing']]) {
    await p.goto(`${BASE}/template/${path}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1200)
    report.colours[`${t}/${label}`] = await p.evaluate(() => {
      const bg = el => getComputedStyle(el).backgroundColor
      const avs = [...document.querySelectorAll('.tp-av')].map(a => [a.textContent, a.className.match(/av-\w+/)?.[0], bg(a)])
      const me = [...document.querySelectorAll('.fx-me')].filter(e => e.offsetParent).map(e => [e.className.match(/av-\w+/)?.[0], bg(e)])
      const badges = [...document.querySelectorAll('.fx-badge')].filter(e => e.offsetParent).map(e => [e.closest('a,button')?.getAttribute('aria-label'), bg(e)])
      const on = [...document.querySelectorAll('.is-on')].filter(e => e.offsetParent && e.matches('[role=tab],[role=radio],a[aria-current]')).map(e => [e.textContent.trim().slice(0, 18), e.classList.contains('fx-pt'), bg(e)])
      const offPt = [...document.querySelectorAll('[role=tablist] > :not(.fx-pt):not(.sp-pill), [role=radiogroup] > :not(.fx-pt):not(.sp-pill)')].length
      return { avatars: avs.length, avatarHues: [...new Set(avs.map(a => a[1]))], noHue: avs.filter(a => !a[1]).length, me, badges, selected: on, tabItemsNotShared: offPt }
    })
  }
  await ctx.close()
}

// 2. Screens
for (const t of ['dark', 'light']) {
  for (const w of [1440, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 } })
    await theme(ctx, t)
    const p = await ctx.newPage()
    p.on('pageerror', e => report.errs.push(`${t} ${w} ${e.message}`))
    for (const pg of ['overview', 'clients']) {
      await p.goto(`${BASE}/template/${pg === 'overview' ? '' : pg}`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(2200)
      report.overflow[`${t}/${w}/${pg}`] = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      await p.screenshot({ path: `${OUT}/${pg}-${w}-${t}.png`, fullPage: w === 390 })
    }
    await ctx.close()
  }
}
console.log(JSON.stringify(report, null, 1))
await b.close()
