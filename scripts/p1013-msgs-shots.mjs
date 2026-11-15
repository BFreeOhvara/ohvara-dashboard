// P1013 follow-up proof: Messages with no conversations keeps its full box, every role, desktop + phone, light + dark.
//   node scripts/p1013-msgs-shots.mjs <outdir>   (needs a sample-mode dev server; EMPTY=1 uses a throwaway harness flag)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const BASE = process.env.BASE || 'http://localhost:5014'
const OUT = process.argv[2] || 'qa/p1013-msgs'
const EMPTY = process.env.EMPTY === '1'
mkdirSync(OUT, { recursive: true })
const PAGES = { admin: '/preview/admin/messages', agent: '/template/messages', va: '/template/fulfillment/messages' }
const rows = []
const b = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 500 })
  await ctx.addInitScript(([t, e]) => { try { localStorage.setItem('ohvara-theme', t) } catch {} if (e) globalThis.__P1013_EMPTY = true }, [scheme, EMPTY])
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)))
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|127\.0\.0\.1:1/.test(m.text())) errs.push(m.text().slice(0, 140)) })
  for (const [who, path] of Object.entries(PAGES)) {
    errs.length = 0
    await p.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1300)
    const r = await p.evaluate(() => {
      const txt = document.body.innerText
      const vis = s => [...document.querySelectorAll(s)].some(e => e.getBoundingClientRect().height > 0)
      return {
        box: vis('.tp-msgs') || vis('.ma-threads'), search: vis('.tp-threads-find input, .va-find input, .ma-search input'),
        list: vis('.tp-threads') || vis('.ma-threads'), pane: vis('.tp-conv'),
        noConv: /No conversations yet/.test(txt), pick: /Pick a conversation/.test(txt), support: /Ohvara Support/.test(txt),
        rows: document.querySelectorAll('.tp-thread, .ma-thread').length, oldBare: /Nobody has written yet/.test(txt),
        ox: document.documentElement.scrollWidth - innerWidth,
      }
    })
    rows.push({ who, w, scheme, ...r, errors: errs.length })
    await p.screenshot({ path: `${OUT}/${who}-${w}-${scheme}.png` })
  }
  await ctx.close()
}
await b.close()
console.table(rows)
