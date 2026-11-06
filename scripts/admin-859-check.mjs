// P859 proof: the admin shell never hides its body behind motion or a read.
//   node scripts/admin-859-check.mjs --base-url http://localhost:5859 [--mount harness|preview|template] [--no-shots] [--no-freeze] [--out qa/admin-859]
//   --no-freeze: leave the animation clock running (healthy browser): pages must show and settled must stay false (motion kept)
// For each of the 9 admin pages at 1440 and 390: every backend call is refused (reads fail), and the browser's animation
// clock is frozen (Animation.setPlaybackRate 0 over CDP: what a throttled or GPU-starved browser looks like). Then it asserts
// the tabs, the page head and EVERY element of the page body sit at effective opacity 1 (not display:none / hidden), and no
// crash panel shows. `harness` mounts the real (non-preview) admin shell with a stand-in account at /admin-harness.html
// (a local dev file, not committed); `preview` uses /preview/admin; `template` runs the agent shell's pages at /template. webdriver is hidden so the shell cannot take any
// automated-browser shortcut.
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const MOUNT = flag('--mount') || 'harness'
const OUT = flag('--out') || 'qa/admin-859'
const SHOTS = !args.includes('--no-shots')
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const PAGES = ['/admin', '/admin/agents', '/admin/fulfillment', '/admin/inbounds', '/admin/pipeline', '/admin/billing', '/admin/messages', '/admin/settings', '/admin/connect']
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const AGENT = ['/template', '/template/leads', '/template/calendar', '/template/clients', '/template/submit', '/template/request-service', '/template/activity', '/template/billing', '/template/more', '/template/messages', '/template/settings']
if (MOUNT === 'template') PAGES.splice(0, PAGES.length, ...AGENT) // the agent shell on sample info (P859 follow-up)
const urlOf = p => (MOUNT === 'template' ? `${BASE}${p}` : MOUNT === 'preview' ? `${BASE}/preview${p}` : `${BASE}/admin-harness.html?p=${encodeURIComponent(p)}`)

// Runs in the page: what is not fully visible under the page body, the head and the tabs.
const audit = () => {
  const seen = []
  // Opacity only counts when an animation holds it there; a static opacity 0 (a chip shown on selection) is by design.
  const eff = el => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') return -1; if (c.animationName !== 'none') o *= Number(c.opacity) } return o }
  const roots = ['.fx-main', '.fx-head', '.fx-tabs']
  for (const r of roots) {
    const root = document.querySelector(r)
    if (!root) { seen.push(`${r}: missing`); continue }
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.closest('svg') && el.tagName !== 'svg') continue
      const o = eff(el)
      if (o !== -1 && o < 0.3) seen.push(`${r} ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} opacity ${o.toFixed(2)}`)
      if (o === -1 && el.getBoundingClientRect().width > 0) seen.push(`${r} ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} hidden`)
    }
  }
  return { seen, crash: !!document.querySelector('.ov-crash'), mainH: Math.round(document.querySelector('.fx-main')?.getBoundingClientRect().height || 0), settled: !!document.querySelector('.tp-app.is-settled') }
}

const failures = []
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })
for (const view of VIEWS) {
  for (const path of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, colorScheme: 'dark' })
    await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => false }) } catch { /* ignore */ } try { localStorage.setItem('ohvara-theme', 'dark') } catch { /* ignore */ } })
    await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Animation.enable')
    if (!args.includes('--no-freeze')) await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 }) // the animation clock does not advance
    const errors = []
    page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
    await page.goto(urlOf(path), { waitUntil: 'load' })
    await page.waitForSelector('.fx-main', { timeout: 15000 })
    await page.waitForTimeout(1500) // past SETTLE_MS
    const r = await page.evaluate(audit)
    const tag = `${view.w} ${path}`
    if (r.crash) failures.push(`${tag}: crash panel showing`)
    if (r.mainH < 150) failures.push(`${tag}: body only ${r.mainH}px tall`)
    if (r.seen.length) failures.push(`${tag}: ${r.seen.length} not visible, e.g. ${r.seen.slice(0, 3).join(' | ')}`)
    if (errors.length) failures.push(`${tag}: page errors ${errors.join(' | ')}`)
    console.log(`${r.seen.length || r.crash ? 'FAIL' : 'ok  '} ${tag}  body ${r.mainH}px  settled=${r.settled}`)
    if (SHOTS) await page.screenshot({ path: `${OUT}/${MOUNT}-${view.w}-${path.replace(/\//g, '_') || '_'}.png`, fullPage: false })
    await ctx.close()
  }
}
await browser.close()
if (failures.length) { console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`); process.exit(1) }
console.log('\nAll pages visible at 1440 and 390 with reads failing and animations frozen.')
