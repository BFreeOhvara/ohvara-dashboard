// Your book boxes show their full words from 640 to 1439 wide, checked with every Supabase call mocked
// (no real project, no login, no live data).
//   node scripts/overview-book-fit.mjs [outDir]            assert, print the per-width table, save the 1100 shots
//   node scripts/overview-book-fit.mjs --parity [outDir]   only screenshot [data-ov="book"] at 1440 and 390, light and dark,
//                                                          with sha256 hashes (run on master and on a branch, then compare)
// Exits 1 on any failure.
//
// Asserted at 1024, 1100, 1180, 1280, 1366, 1439 and 1440 wide (900 tall, sidebar open), light and dark, for the normal
// lines, the zero-state lines ("All caught up", "None open") and a three-digit count in every box:
//   - every visible .ov-bk-t b and .ov-bk-t span has scrollWidth <= clientWidth (no ellipsis)
//   - document.documentElement.scrollWidth <= window.innerWidth (no sideways scroll)
// And at 1280 / 1366 / 1439 wide, 700-819 tall (the short-screen rule hides the small line): the label b shows in full.
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const PARITY = process.argv.includes('--parity')
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || 'qa/overview-book-fit'
const SB = 'https://mock.supabase.co'
const PORT = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 400)
mkdirSync(OUT, { recursive: true })

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A fixed clock (Fri Oct 30, 10:24 AM Central), the same one overview-fit-shots.mjs uses.
const BASE = Date.UTC(2026, 9, 30, 15, 24)
const iso = ms => new Date(ms).toISOString()
const AGENT = '11111111-1111-4111-8111-111111111111'
const PROFILE = {
  id: AGENT, role: 'agent', full_name: 'Test Agent', email: 'test.agent@example.com', timezone: 'America/Chicago',
  is_active: true, billing_exempt: true, billing_status: 'exempt', billing_tier: 'standard', membership_tier: 'standard',
  has_servicing: true, leads_weekly_cents: 0,
}
const rowsOf = (stage, n, open = 0) => Array.from({ length: n }, () => ({ stage, open_requests: open }))
// normal: 6 / 2 / 2 / 2.  zero: Needs attention and Requests open at 0 ("All caught up", "None open").
// big: a three-digit count in every box (Requests open is the sum of open_requests).
const BOOKS = {
  normal: [...rowsOf('protected', 6), ...rowsOf('setting_up', 1, 1), ...rowsOf('setting_up', 1), ...rowsOf('needs_attention', 1, 1), ...rowsOf('needs_attention', 1)],
  zero: [...rowsOf('protected', 6), ...rowsOf('setting_up', 2)],
  big: [...rowsOf('protected', 128), ...rowsOf('setting_up', 104), ...rowsOf('needs_attention', 112, 1)],
}
const WIDTHS = [640, 768, 1024, 1100, 1180, 1280, 1366, 1439, 1440]
const SHORT = [[1280, 700], [1280, 760], [1366, 780], [1439, 819]]

// ── Mock ─────────────────────────────────────────────────────────────────────
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const nowS = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: AGENT, role: 'authenticated', aal: 'aal1', exp: nowS + 36000, iat: nowS })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 36000, expires_at: nowS + 36000,
  user: { id: AGENT, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: iso(BASE - 1000 * 864e5) },
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function mock(page, clients) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    const reply = all => json(route, 200, single ? all[0] ?? null : all)
    if (path.startsWith('/functions/v1/')) return json(route, 200, { configured: true })
    if (path.startsWith('/auth/v1/')) return json(route, 200, {})
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, 200, PROFILE)
    if (path === '/rest/v1/rpc/agent_weekly_usage') return json(route, 200, [{ used: 2, weekly_cap: 7, week_end: iso(Date.UTC(2026, 10, 2, 6, 0)), tier_name: 'Standard', enforced: true }])
    if (path === '/rest/v1/rpc/agent_inbounds') return json(route, 200, [])
    const table = path.replace('/rest/v1/', '')
    if (table === 'agent_clients') return reply(clients)
    if (table === 'membership_tiers') return json(route, 200, [{ key: 'standard', name: 'Standard', monthly_appointments: 12, is_active: true, sort_order: 1 }])
    if (table === 'app_settings') return reply([{ id: 1, agent_billing_enforced: false }])
    return single ? json(route, 200, {}) : json(route, 200, [])
  })
}

// ── Run ──────────────────────────────────────────────────────────────────────
process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })

async function open(w, h, theme, books) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme })
  await ctx.addInitScript(([session, th]) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session))
    localStorage.setItem('ohvara-theme', th)
  }, [SESSION, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.clock.setFixedTime(BASE)
  await mock(page, BOOKS[books])
  await page.goto(`${base}/agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const n = [...document.querySelectorAll('[data-ov="book"] .ov-bk-n')].map(e => e.innerText.trim())
    return n.length === 4 && n.every(t => /^\d+$/.test(t))
  }, null, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900) // fade-in, fonts
  return { ctx, page, errors }
}

// scrollWidth / clientWidth of each visible label (b) and small line (span), the page width and the tile boxes.
const measure = page => page.evaluate(() => {
  const els = [...document.querySelectorAll('[data-ov="book"] .ov-bk-t b, [data-ov="book"] .ov-bk-t span')]
    .filter(e => e.getClientRects().length > 0)
    .map(e => ({ kind: e.tagName === 'B' ? 'b' : 'span', text: e.textContent, natural: (() => { const r = document.createRange(); r.selectNodeContents(e); return Math.max(...[...r.getClientRects()].map(q => q.width)) })(), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }))
  const tiles = [...document.querySelectorAll('[data-ov="book"] .ov-bk-tile')].map(e => { const r = e.getBoundingClientRect(); return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) } })
  return { els, tiles, scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth }
})

const fails = []
const rowsOut = []
const notes = []
const check = (cond, msg) => { if (!cond) fails.push(msg) }

try {
  if (PARITY) {
    const hashes = {}
    for (const w of [1440, 390]) for (const theme of ['light', 'dark']) {
      const { ctx, page, errors } = await open(w, w === 390 ? 844 : 900, theme, 'normal')
      const buf = await page.locator('[data-ov="book"]').screenshot()
      const file = `book-${w}-${theme}.png`
      writeFileSync(join(OUT, file), buf)
      hashes[file] = createHash('sha256').update(buf).digest('hex')
      check(errors.length === 0, `page errors at ${w} ${theme}: ${errors.join(' | ')}`)
      await ctx.close()
    }
    writeFileSync(join(OUT, 'parity-hashes.json'), JSON.stringify(hashes, null, 2))
    console.log(JSON.stringify(hashes, null, 2))
  } else {
    for (const theme of ['light', 'dark']) {
      for (const w of WIDTHS) {
        for (const books of ['normal', 'zero', 'big']) {
          const { ctx, page, errors } = await open(w, 900, theme, books)
          const m = await measure(page)
          const tag = `${w} ${theme} ${books}`
          check(m.els.length >= 4, `${tag}: only ${m.els.length} book texts found`)
          check(m.scrollWidth <= m.innerWidth, `${tag}: sideways scroll (${m.scrollWidth} > ${m.innerWidth})`)
          check(errors.length === 0, `${tag}: page errors ${errors.join(' | ')}`)
          if (books === 'zero') {
            const spans = m.els.filter(e => e.kind === 'span').map(e => e.text)
            check(spans.includes('All caught up') && spans.includes('None open'), `${tag}: zero-state lines missing (${spans.join(' | ')})`)
          }
          const bad = m.els.filter(e => e.scrollWidth > e.clientWidth)
          // 1440 is deliberately left exactly as it was (the fix is only for 640-1439.98), so a three-digit count in
          // Needs attention still clips its label there by 8px. Reported as a note, not a failure.
          const known = w === 1440 && books === 'big'
          for (const e of bad) {
            const msg = `${tag}: "${e.text}" ${e.kind} cut off (scrollWidth ${e.scrollWidth} > clientWidth ${e.clientWidth})`
            if (known) notes.push(msg); else fails.push(msg)
          }
          const widest = m.els.reduce((a, e) => (e.natural > a.natural ? e : a), m.els[0])
          rowsOut.push({ w, theme, books, texts: m.els.length, maxScroll: Math.round(widest.natural), widest: widest.text, minSlack: Math.min(...m.els.map(e => e.clientWidth - e.scrollWidth)), docScroll: m.scrollWidth, inner: m.innerWidth, tiles: m.tiles, ok: (known || !bad.length) && m.scrollWidth <= m.innerWidth, known: known && bad.length > 0 })
          if (w === 1100 && books === 'normal') await page.locator('[data-ov="book"]').screenshot({ path: join(OUT, `book-1100-${theme}.png`) })
          await ctx.close()
        }
      }
      // Short screens (700-819 tall, 1280+ wide): the small line is hidden on purpose; the label shows in full.
      for (const [w, h] of SHORT) {
        for (const books of ['normal', 'big']) {
          const { ctx, page } = await open(w, h, theme, books)
          const m = await measure(page)
          const tag = `${w}x${h} ${theme} ${books} (short screen)`
          const labels = m.els.filter(e => e.kind === 'b')
          check(labels.length === 4, `${tag}: ${labels.length} labels visible, expected 4`)
          for (const e of labels) check(e.scrollWidth <= e.clientWidth, `${tag}: label "${e.text}" cut off (scrollWidth ${e.scrollWidth} > clientWidth ${e.clientWidth})`)
          check(m.scrollWidth <= m.innerWidth, `${tag}: sideways scroll`)
          rowsOut.push({ w: `${w}x${h}`, theme, books, texts: m.els.length, maxScroll: Math.round(Math.max(...labels.map(e => e.natural))), widest: '(labels only)', minSlack: Math.min(...labels.map(e => e.clientWidth - e.scrollWidth)), docScroll: m.scrollWidth, inner: m.innerWidth, ok: labels.every(e => e.scrollWidth <= e.clientWidth) })
          await ctx.close()
        }
      }
    }
    console.log('width        theme  data    texts  widest text (px)          min slack  doc/inner   ok')
    for (const r of rowsOut) console.log(`${String(r.w).padEnd(12)} ${r.theme.padEnd(6)} ${r.books.padEnd(7)} ${String(r.texts).padEnd(6)} ${String(r.maxScroll).padStart(4)} ${r.widest.padEnd(16)} ${String(r.minSlack).padStart(8)}   ${`${r.docScroll}/${r.inner}`.padEnd(9)}  ${r.ok ? (r.known ? 'ok (known: 1440 unchanged)' : 'ok') : 'FAIL'}`)
    writeFileSync(join(OUT, 'book-fit-measurements.json'), JSON.stringify(rowsOut, null, 2))
  }
} finally {
  await browser.close()
  await server.close()
}
for (const n of [...new Set(notes)]) console.log(`NOTE  ${n}`)
if (fails.length) { for (const f of fails) console.log(`FAIL  ${f}`); console.log(`\n${fails.length} failures`) } else if (!PARITY) console.log('\nAll book-fit checks pass')
process.exit(fails.length ? 1 : 0)
