// P877 Phase 2 — every lesson in the player: the video loads at the length the manifest says, its captions load,
// chapters show, the page has no sideways scroll and no errors; Home shows a video on all 17 rows.
//   node qa/va-877/all-lessons.mjs http://localhost:4877
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:4877'
const V = JSON.parse(readFileSync('src/fulshell/training/videos.json', 'utf8'))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
const p = await ctx.newPage()
const errs = []; p.on('pageerror', e => errs.push(String(e)))
const bad = []
const rows = []
for (const [id, v] of Object.entries(V.lessons)) {
  await p.goto(`${BASE}/template/fulfillment/training/${id}`, { waitUntil: 'networkidle' })
  const m = await p.evaluate(async () => {
    const vid = document.querySelector('.tr-video video')
    if (!vid) return { none: true }
    for (let i = 0; i < 40 && vid.readyState < 1; i++) await new Promise(r => setTimeout(r, 100))
    vid.muted = true; vid.currentTime = 30; await vid.play().catch(() => {}); await new Promise(r => setTimeout(r, 900))
    return { dur: vid.duration, cc: !!document.querySelector('.tr-cc'), chapters: document.querySelectorAll('.tr-chap li').length, overflow: document.documentElement.scrollWidth > innerWidth, cta: document.querySelector('.tr-cta h2')?.textContent }
  })
  rows.push(`${id}: ${Math.round(m.dur)}s cc=${m.cc} chapters=${m.chapters} cta="${m.cta}"`)
  if (m.none || Math.abs(m.dur - v.duration) > 1 || !m.cc || m.chapters !== v.chapters.length || m.overflow) bad.push(id)
}
await p.goto(`${BASE}/template/fulfillment/training`, { waitUntil: 'networkidle' })
const withVideo = await p.locator('.tr-hasvid').count()
console.log(rows.join('\n'))
console.log(JSON.stringify({ lessons: Object.keys(V.lessons).length, homeRowsWithVideo: withVideo, bad, errors: errs }))
await b.close()
