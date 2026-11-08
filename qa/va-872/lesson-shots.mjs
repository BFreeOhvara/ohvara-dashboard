// P872 — the "What to click" pictures for the training lessons: each sample VA screen, plus where the named buttons sit
// (as % of the picture) so a lesson can number them. Writes public/training/<key>.jpg and src/fulshell/training/shots.json.
//   node qa/va-872/lesson-shots.mjs http://localhost:4872
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:4872'
const W = 1280, H = 800
const F = path => `${BASE}/template/fulfillment${path}`
const plus = async p => { await p.click('.fx-rplus'); await p.waitForSelector('[role=menuitem]') }
const SHOTS = {
  schedule: { label: 'Schedule', go: F('/schedule'), spots: { onshift: '[aria-label="Who is on shift"]', dayoff: 'button:has-text("Request a day off")', cal: '.fs-sched .tp-tgrid, .fs-sched [class*="grid"]' } },
  servicing: { label: 'Servicing', go: F('/servicing'), spots: { lane0: '.fx-board .fx-lane >> nth=0', card: '.fx-board .fx-lane >> nth=0 >> [aria-label^="Open "] >> nth=0' } },
  task: { label: 'servicing step', go: F('/servicing/st-1'), spots: { start: '.fx-rec button:has-text("Start")', move: '.fx-rec button:has-text("Move")', sendagent: '.fx-rec button:has-text("Send to agent")' } },
  'task-on': { label: 'servicing step, started', go: F('/servicing/st-1'), prep: async p => { await p.click('.fx-rec button:has-text("Start")'); await p.waitForTimeout(600) }, spots: { record: '.fx-rec button:has-text("Record the result"), .fx-rec button:has-text("Save result")', sendagent: '.fx-rec button:has-text("Send to agent")' } },
  call: { label: 'cancellation call', go: F('/schedule/cl-8'), spots: { start: '.fx-rec button:has-text("Start call")', cancelled: '.fx-rec button:has-text("Cancelled")' } },
  phone: { label: 'phone', go: F(''), prep: async p => { await p.click('.fx-rail .fs-ri-phone'); await p.waitForTimeout(500) }, spots: { phone: '.fs-call', plus: '.fx-rplus' } },
  'phone-ring': { label: 'phone, ringing', go: F(''), prep: async p => { await plus(p); await p.click('[role=menuitem]:has-text("Live call")'); await p.waitForTimeout(600) }, spots: { answer: '.fs-call [aria-label^="Answer"]', opencall: '.fs-call .fs-cs-rec' } },
  messages: { label: 'Messages', go: F('/messages'), spots: { thread: '.tp-threads-b > * >> nth=0', conv: '.tp-conv' } },
}

mkdirSync('public/training', { recursive: true })
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: W, height: H }, colorScheme: 'light' })
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
const out = {}
for (const [key, s] of Object.entries(SHOTS)) {
  const p = await ctx.newPage()
  await p.goto(s.go, { waitUntil: 'networkidle' })
  await p.evaluate(() => { try { localStorage.setItem('theme', 'light') } catch { /* ignore */ } document.documentElement.setAttribute('data-theme', 'light') })
  await p.waitForTimeout(1300)
  if (s.prep) await s.prep(p)
  const spots = {}
  for (const [name, sel] of Object.entries(s.spots)) {
    const loc = p.locator(sel).first()
    const box = await loc.boundingBox().catch(() => null)
    if (!box || box.width < 2 || box.y > H || box.y + box.height < 0) { console.log('  no spot', key, name); continue }
    const pad = 4
    const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad)
    const w = Math.min(W - x, box.width + pad * 2), h = Math.min(H - y, box.height + pad * 2)
    spots[name] = [x / W * 100, y / H * 100, w / W * 100, h / H * 100].map(n => Math.round(n * 10) / 10)
  }
  await p.screenshot({ path: `public/training/${key}.jpg`, type: 'jpeg', quality: 68 })
  out[key] = { label: s.label, spots }
  console.log(key, Object.keys(spots).join(','))
  await p.close()
}
writeFileSync('src/fulshell/training/shots.json', `${JSON.stringify(out, null, 1)}\n`)
await b.close()
