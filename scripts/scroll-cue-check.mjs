import process from 'node:process'
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

// P867 — does every page that scrolls SHOW that it scrolls?
//   node scripts/scroll-cue-check.mjs --base-url http://localhost:5867 [--portal admin|agent|va] [--size 1440x900] [--page overview]
//        [--theme dark|light] [--ubo <uBlock Origin Lite folder>] [--shots qa/scroll-867] [--json qa/scroll-867/scroll.json] [--dump]
// For each page x size: does the page scroll, and how much of the first block cut by the fold is above it?
// Pass = the page does not scroll, or a block cut by the fold shows 25-60% of its height with its heading above the fold.
// Fail = the fold lands in a gap between cards or on a section boundary (no block cut), or the cut block shows too little/too much.
// The fold is the bottom of the viewport minus the phone tab bar when one is pinned there.
const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || 'http://localhost:5867').replace(/\/$/, '')
const UBO = flag('--ubo')
const SHOTS = flag('--shots')
const JSON_OUT = flag('--json')
const THEME = flag('--theme') || 'dark'
const DUMP = args.includes('--dump')
if (UBO && !existsSync(join(UBO, 'manifest.json'))) { console.error('--ubo must be the folder holding manifest.json'); process.exit(2) }

export const PORTALS = {
  admin: {
    overview: '/preview/admin', agents: '/preview/admin/agents', setup: '/preview/admin/setup', fulfillment: '/preview/admin/fulfillment',
    leads: '/preview/admin/inbounds', clients: '/preview/admin/pipeline', revenue: '/preview/admin/billing', messages: '/preview/admin/messages',
    settings: '/preview/admin/settings', connect: '/preview/admin/connect',
  },
  agent: {
    overview: '/template', leads: '/template/leads', calendar: '/template/calendar', clients: '/template/clients', submit: '/template/submit',
    'request-service': '/template/request-service', activity: '/template/activity', billing: '/template/billing', messages: '/template/messages',
    settings: '/template/settings',
  },
  va: {
    today: '/template/fulfillment', queue: '/template/fulfillment/leads', schedule: '/template/fulfillment/schedule', clients: '/template/fulfillment/pipeline',
    servicing: '/template/fulfillment/servicing', pay: '/template/fulfillment/pay', messages: '/template/fulfillment/messages', settings: '/template/fulfillment/settings',
  },
}
export const SIZES = [[1366, 768], [1440, 900], [1536, 864], [1920, 1080], [390, 844]]

// Runs in the page: find the blocks (outermost cards), the fold, and the first block the fold cuts.
function measure(dump) {
  const se = document.scrollingElement
  const F = window.__fold
  const fold = F.foldLine()
  const main = document.querySelector('.fx-main, .tp-main')
  if (!main) return { error: 'no main' }
  const isCard = F.isCard
  const blocks = F.blocksIn(main)
  // Scrolls = a card continues below the fold (the "Sample info" footer line alone does not count), as fold.js.
  const scrolls = blocks.some(el => F.docTop(el) + el.offsetHeight > fold + 8)
  const sy = window.scrollY
  const firstText = el => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) })
    const n = w.nextNode()
    if (!n) return null
    const range = document.createRange(); range.selectNodeContents(n)
    const rr = [...range.getClientRects()][0]
    return rr ? { text: n.textContent.trim().slice(0, 40), bottom: rr.bottom } : null
  }
  // A section heading sitting just above a card (outside it) belongs to that block. Not a sibling that holds a card
  // itself (the row above in a list of cards is not a heading).
  const headAbove = (el, top) => {
    let p = el
    for (let d = 0; d < 4 && p; d++) {
      let s = p.previousElementSibling
      while (s && getComputedStyle(s).display === 'none') s = s.previousElementSibling
      if (s) {
        const r = s.getBoundingClientRect()
        if (r.height > 0 && r.height < 80 && top - r.bottom < 40 && top - r.bottom > -2 && !isCard(s) && ![...s.querySelectorAll('*')].some(isCard)) return { top: r.top, text: (s.innerText || '').trim().slice(0, 40), bottom: r.bottom }
        return null
      }
      p = p.parentElement
      if (!p || p === main) return null
    }
    return null
  }
  const out = blocks.map(el => {
    const r = el.getBoundingClientRect()
    const ha = headAbove(el, r.top)
    const top = ha ? ha.top : r.top
    const head = ha || firstText(el)
    return { cls: String(el.className).split(' ').slice(0, 3).join('.'), top: Math.round(top + sy), bottom: Math.round(r.bottom + sy), head: head?.text || '', headBottom: head ? Math.round(head.bottom + sy) : null }
  })
  const cut = out.filter(b => b.top < fold && b.bottom > fold).map(b => ({ ...b, share: (fold - b.top) / (b.bottom - b.top), headOk: b.headBottom != null && b.headBottom <= fold }))
  const below = out.filter(b => b.top >= fold).sort((a, b) => a.top - b.top)
  const res = { scrolls, fold, scrollH: se.scrollHeight, cut, nextBelow: below[0] || null }
  if (dump) res.blocks = out
  return res
}

const judge = r => {
  if (r.error) return { ok: false, why: r.error }
  if (!r.scrolls) return { ok: true, why: 'fits' }
  if (!r.cut.length) return { ok: false, why: r.nextBelow ? `fold in a gap (next block "${r.nextBelow.head}" starts ${r.nextBelow.top - r.fold}px below)` : 'no block at the fold' }
  const good = r.cut.filter(b => b.share >= 0.25 && b.share <= 0.6 && b.headOk)
  const pick = (good.length ? good : r.cut).sort((a, b) => Math.abs(a.share - 0.3) - Math.abs(b.share - 0.3))[0]
  if (good.length) return { ok: true, why: `${Math.round(pick.share * 100)}% of "${pick.head}"`, share: pick.share }
  return { ok: false, why: `${Math.round(pick.share * 100)}% of "${pick.head}"${pick.headOk ? '' : ' (heading below the fold)'}`, share: pick.share }
}

const main = async () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const launch = { headless: !UBO, colorScheme: THEME, args: UBO ? [`--disable-extensions-except=${UBO}`, `--load-extension=${UBO}`] : [] }
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'scroll867-')), launch)
  if (UBO) {
    let sw = ctx.serviceWorkers()[0]
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null)
    if (!sw) { console.error('blocker did not load'); process.exit(1) }
    const ext = await ctx.newPage()
    await ext.goto(`chrome-extension://${new URL(sw.url()).host}/dashboard.html`)
    await ext.evaluate(() => chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: 3 }))
    await ext.close()
    console.log('uBlock Origin Lite ON (complete mode)')
  }
  // The same block and fold rules the app uses (src/template/fold.js), loaded into every page.
  const foldSrc = readFileSync(new URL('../src/template/fold.js', import.meta.url), 'utf8').replace(/^export /gm, '')
  await ctx.addInitScript({ content: `window.__fold = (() => { ${foldSrc}; return { blocksIn, docTop, foldLine, isCard, continuesBelow } })()` })
  await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private */ } }, THEME)
  const sizes = SIZES.filter(([w, h]) => !flag('--size') || flag('--size') === `${w}x${h}`)
  const rows = []
  let fails = 0
  for (const [portal, pages] of Object.entries(PORTALS)) {
    if (flag('--portal') && flag('--portal') !== portal) continue
    for (const [name, path] of Object.entries(pages)) {
      if (flag('--page') && flag('--page') !== name) continue
      for (const [w, h] of sizes) {
        const page = await ctx.newPage()
        await page.setViewportSize({ width: w, height: h })
        await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
        try { await page.waitForSelector('.fx-main, .tp-main', { timeout: 15000 }) } catch { /* reported below */ }
        await page.waitForTimeout(2600)
        const r = await page.evaluate(measure, DUMP)
        const j = judge(r)
        if (!j.ok) fails++
        rows.push({ portal, page: name, size: `${w}x${h}`, scrolls: r.scrolls, share: j.share ?? null, ok: j.ok, why: j.why })
        console.log(`${j.ok ? 'ok  ' : 'FAIL'} ${portal.padEnd(5)} ${name.padEnd(16)} ${`${w}x${h}`.padEnd(9)} ${j.why}`)
        if (DUMP) console.log(JSON.stringify({ fold: r.fold, scrollH: r.scrollH, blocks: r.blocks }, null, 1))
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${portal}-${name}-${w}-${THEME}.png` })
        await page.close()
      }
    }
  }
  await ctx.close()
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1))
  console.log(`\n${rows.length} checks, ${fails} failure(s)`)
  process.exit(fails ? 1 : 0)
}
main()
