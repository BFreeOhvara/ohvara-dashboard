// P860 proof: the live clock is ONE line on the page-title row of every page in all three portals, with no zone chip.
//   node scripts/clock-860-check.mjs --base-url http://localhost:5860 [--portal agent|va|admin] [--width 390] [--shots] [--out qa/clock-860]
// Per page and width: the clock reads "Thursday, Nov 5 · 10:57:29 PM", is a single line (height under 1.5 lines), has no
// zone text or dropdown, is NOT in the top bar, ticks (the text changes), sits level with the title's last line and
// right-aligned beside it at 1440+, or directly under the title, left-aligned, below that. Backend calls are refused.
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/clock-860'
const SHOTS = args.includes('--shots')
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const PORTALS = {
  agent: ['/template', '/template/leads', '/template/calendar', '/template/clients', '/template/submit', '/template/request-service', '/template/activity', '/template/billing', '/template/more', '/template/settings'],
  va: ['/template/fulfillment', '/template/fulfillment/leads', '/template/fulfillment/schedule', '/template/fulfillment/pipeline', '/template/fulfillment/servicing', '/template/fulfillment/pay', '/template/fulfillment/settings'],
  admin: ['/preview/admin', '/preview/admin/agents', '/preview/admin/fulfillment', '/preview/admin/inbounds', '/preview/admin/pipeline', '/preview/admin/billing', '/preview/admin/settings', '/preview/admin/connect'],
}
const VIEWS = [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 1100, h: 800 }, { w: 390, h: 844 }].filter(v => !flag('--width') || String(v.w) === flag('--width'))
const SHOT_PAGES = new Set(['/template', '/template/fulfillment', '/preview/admin'])
const LINE = /^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2}:\d{2} [AP]M$/

const probe = () => {
  const c = document.querySelector('.fx-clock')
  if (!c) return { missing: true }
  const r = c.getBoundingClientRect()
  const head = document.querySelector('.fx-head')?.getBoundingClientRect()
  const title = document.querySelector('.fx-head .fx-title')
  const tr = title?.getBoundingClientRect()
  const cs = getComputedStyle(c)
  return {
    text: [...c.children].map(x => x.textContent).join(' ').replace(/\s+/g, ' ').trim(),
    h: r.height, lh: parseFloat(cs.fontSize) * 1.5, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    titleRight: tr?.right, titleBottom: tr?.bottom, titleLeft: tr?.left, headRight: head?.right,
    fs: parseFloat(cs.fontSize), fw: cs.fontWeight, tnum: cs.fontVariantNumeric,
    inBars: !!c.closest('.fx-ptop, .fx-top, .fx-tr'),
    zoneChip: !!document.querySelector('.fx-clock select, .fx-clock button, .ad-clock'),
    kpisTop: document.querySelector('.fx-head .fx-kpis')?.getBoundingClientRect().top,
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
  }
}

const failures = []
const browser = await chromium.launch()
for (const view of VIEWS) {
  for (const [portal, pages] of Object.entries(PORTALS)) {
    if (flag('--portal') && flag('--portal') !== portal) continue
    for (const path of pages) {
      const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: 'dark' })
      await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', e => errs.push(e.message.slice(0, 120)))
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
      const tag = `${portal} ${view.w} ${path}`
      try { await page.waitForSelector('.fx-head', { timeout: 15000 }) } catch { failures.push(`${tag}: no title row`); console.log(`FAIL ${tag} no title row`); await ctx.close(); continue }
      await page.waitForTimeout(1300)
      const a = await page.evaluate(probe)
      await page.waitForTimeout(1100)
      const b = await page.evaluate(probe)
      const bad = []
      if (a.missing) bad.push('no clock')
      else {
        if (!LINE.test(a.text)) bad.push(`text "${a.text}"`)
        if (/\b(CT|ET|PT|MT)\b/.test(a.text) || a.zoneChip) bad.push('zone chip')
        if (a.inBars) bad.push('still in the top bar')
        if (a.h > a.lh) bad.push(`wraps (${a.h.toFixed(0)}px)`)
        if (a.text === b.text) bad.push('does not tick')
        if (a.fs < 18 || a.fs > 23) bad.push(`size ${a.fs}`)
        if (!/tabular-nums/.test(a.tnum)) bad.push('not tabular')
        if (a.scrollW > a.innerW + 1) bad.push('page scrolls sideways')
        if (a.right > a.innerW - 8) bad.push('off the right edge')
        if (view.w >= 1440) {
          if (a.left < a.titleRight) bad.push('overlaps title')
          if (Math.abs(a.right - a.headRight) > 2) bad.push(`not right-aligned (${(a.headRight - a.right).toFixed(0)}px short)`)
          if (a.bottom > a.titleBottom + 8 || a.bottom < a.titleBottom - 24) bad.push(`not level with title (clock bottom ${a.bottom.toFixed(0)}, title bottom ${a.titleBottom.toFixed(0)})`)
        } else if (view.w >= 1000) {
          const under = a.top >= a.titleBottom - 4
          if (under && Math.abs(a.left - a.titleLeft) > 2) bad.push('under the title but not left-aligned')
          if (!under && (a.left < a.titleRight || Math.abs(a.right - a.headRight) > 2)) bad.push('beside the title but misplaced')
        } else {
          if (a.top < a.titleBottom - 4) bad.push('not under the title')
          if (a.kpisTop != null && a.kpisTop < a.top) bad.push('the numbers come before the clock')
          if (Math.abs(a.left - a.titleLeft) > 2) bad.push('not left-aligned under the title')
        }
      }
      if (errs.length) bad.push(`page errors ${errs.join(' | ')}`)
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${tag}  ${a.text || ''}${bad.length ? '  <- ' + bad.join('; ') : ''}`)
      if (bad.length) failures.push(`${tag}: ${bad.join('; ')}`)
      if (SHOTS && SHOT_PAGES.has(path) && [1440, 390].includes(view.w)) {
        for (const scheme of ['dark', 'light']) {
          await page.evaluate(s => { try { localStorage.setItem('ohvara-theme', s) } catch { /* ignore */ } document.documentElement.dataset.theme = s; document.documentElement.classList.toggle('dark', s === 'dark'); document.documentElement.classList.toggle('light', s === 'light') }, scheme)
          await page.emulateMedia({ colorScheme: scheme })
          await page.waitForTimeout(400)
          await page.screenshot({ path: `${OUT}/${portal}-${view.w}-${scheme}.png` })
        }
      }
      await ctx.close()
    }
  }
}
await browser.close()
if (failures.length) { console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`); process.exit(1) }
console.log('\nOne-line clock on every title row, all three portals.')
