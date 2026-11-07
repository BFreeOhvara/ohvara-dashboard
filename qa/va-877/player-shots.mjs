// P877 — the lesson video player in Training, on sample data: shots at 1440 and 390 plus measurements (video loads and
// plays, captions show and follow the voice, speed, resume, the "?" on booking opens the video at its moment).
//   node qa/va-877/player-shots.mjs http://localhost:4877
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:4877'
const OUT = 'qa/va-877'
mkdirSync(OUT, { recursive: true })
const F = p => `${BASE}/template/fulfillment${p}`
const b = await chromium.launch()
const res = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: 'dark' })
  await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(String(e)))
  const m = {}
  for (const id of ['booking', 'never']) {
    await p.goto(F(`/training/${id}`), { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
    m[id] = await p.evaluate(async () => {
      const v = document.querySelector('.tr-video video')
      v.muted = true; await v.play()
      await new Promise(r => setTimeout(r, 2500))
      const cc = document.querySelector('.tr-cc')
      const vr = v.getBoundingClientRect()
      return { ready: v.readyState, dur: Math.round(v.duration), t: Math.round(v.currentTime * 10) / 10, cc: cc?.innerText, ccInside: cc ? cc.getBoundingClientRect().right <= vr.right + 1 : null,
        videoW: Math.round(vr.width), overflow: document.documentElement.scrollWidth > innerWidth, chapters: document.querySelectorAll('.tr-chap li').length }
    })
    // speed 1.5x, captions off
    await p.click('.tr-speed >> text=1.5x'); await p.click('.tr-ccbtn')
    m[id].rate = await p.evaluate(() => document.querySelector('.tr-video video').playbackRate)
    m[id].ccOff = await p.evaluate(() => !document.querySelector('.tr-cc'))
    await p.click('.tr-ccbtn')
    await p.evaluate(() => document.querySelector('.tr-video video').pause())
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${OUT}/lesson-${id}-${w}.png` })
  }
  // resume: reopen booking, it starts where it stopped
  await p.goto(F('/training/never'), { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  await p.goto(F('/training/booking'), { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  m.resumeLabel = await p.locator('.tr-vid-resume').innerText().catch(() => null)
  // the "?" in Book for an agent opens the booking video at "Pick the agent"
  if (w === 1440) {
    await p.goto(F('/leads'), { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
    await p.click('.fx-rplus'); await p.click('[role=menuitem]:has-text("Book for an agent")'); await p.waitForTimeout(600)
    await p.click('.tp-sheet a.tr-help'); await p.waitForTimeout(1500)
    m.help = { url: p.url().replace(BASE, ''), label: await p.locator('.tr-vid-resume').innerText().catch(() => null), t: await p.evaluate(() => Math.round(document.querySelector('.tr-video video').currentTime * 10) / 10) }
    await p.goto(F('/training'), { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
    m.homeVideoRows = await p.locator('.tr-hasvid').count()
    await p.screenshot({ path: `${OUT}/training-home-${w}.png` })
  }
  m.pageErrors = errs
  res[w] = m
  await ctx.close()
}
writeFileSync(`${OUT}/measure.json`, JSON.stringify(res, null, 1))
console.log(JSON.stringify(res, null, 1))
await b.close()
