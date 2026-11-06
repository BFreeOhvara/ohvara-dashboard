import process from 'node:process'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

// P862 proof: with a real content blocker ON (uBlock Origin, default lists), every portal page still renders.
//   node scripts/blocker-862-check.mjs --base-url http://localhost:5862 --ubo <unzipped uBlock0.chromium dir> [--out qa/admin-862] [--no-shots] [--portal admin|agent|va] [--width 1440]
// Step 0 is a control: elements wearing the OLD admin class names (ad-main, ad-tabs ...) must be hidden by the blocker
// (proves it is really running), and the same names under the new prefix (adm-main ...) must not be.
const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const UBO = flag('--ubo')
const OUT = flag('--out') || 'qa/admin-862'
const SHOTS = !args.includes('--no-shots')
if (!BASE || (!args.includes('--no-ubo') && (!UBO || !existsSync(join(UBO, 'manifest.json'))))) { console.error('--base-url and --ubo (folder holding manifest.json) are required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const PORTALS = {
  admin: ['/preview/admin', '/preview/admin/agents', '/preview/admin/fulfillment', '/preview/admin/inbounds', '/preview/admin/pipeline', '/preview/admin/billing', '/preview/admin/messages', '/preview/admin/settings', '/preview/admin/connect'],
  agent: ['/template', '/template/leads', '/template/calendar', '/template/clients', '/template/submit', '/template/request-service', '/template/activity', '/template/billing', '/template/more', '/template/messages', '/template/settings'],
  va: ['/template/fulfillment', '/template/fulfillment/leads', '/template/fulfillment/schedule', '/template/fulfillment/pipeline', '/template/fulfillment/servicing', '/template/fulfillment/pay', '/template/fulfillment/settings'],
}
const VIEWS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }].filter(v => !flag('--width') || String(v.w) === flag('--width'))

// Runs in the page. Counts elements the blocker (or anything) display:none's inside the shell, plus the shell body height.
const audit = () => {
  const hidden = []
  const root = document.querySelector('.tp-app') || document.body
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName !== 'svg') continue
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none') {
      // A by-design hide has a class rule of ours; a blocker rule is an inline-less !important with no author source. We list everything and compare against a no-blocker baseline.
      hidden.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`)
    }
  }
  const main = document.querySelector('.fx-main')
  const head = document.querySelector('.fx-head')
  return { hidden, mainH: Math.round(main?.getBoundingClientRect().height || 0), mainDisplay: main ? getComputedStyle(main).display : 'missing', headDisplay: head ? getComputedStyle(head).display : 'missing', tabsDisplay: document.querySelector('.fx-tabs') ? getComputedStyle(document.querySelector('.fx-tabs')).display : 'missing', crash: !!document.querySelector('.ov-crash') }
}

const profile = mkdtempSync(join(tmpdir(), 'ubo862-profile-'))
const NO_UBO = args.includes('--no-ubo') // baseline run: same pages, no blocker, to compare hidden-node counts
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
  args: NO_UBO ? [] : [`--disable-extensions-except=${UBO}`, `--load-extension=${UBO}`],
})
await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
const failures = []

// Wait for the extension's background page, so we know it loaded and has its lists.
if (!NO_UBO) {
  // uBlock Origin Lite (the Manifest V3 build of uBO: Chromium 148 no longer loads the old Manifest V2 uBlock Origin).
  let sw = ctx.serviceWorkers()[0]
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null)
  console.log(sw ? `blocker extension loaded: ${sw.url()}` : 'FAIL blocker extension did not load')
  if (!sw) { await ctx.close(); process.exit(1) }
  const id = new URL(sw.url()).host
  const ext = await ctx.newPage()
  await ext.goto(`chrome-extension://${id}/dashboard.html`, { waitUntil: 'load' })
  // Complete mode = generic + specific cosmetic filtering on every site (the strictest setting).
  const lvl = await ext.evaluate(() => chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: 3 }))
  console.log(`blocker filtering mode set to level ${lvl} (3 = complete)`)
  await ext.close()
  await new Promise(r => setTimeout(r, 4000))
}

// Step 0: control.
if (!NO_UBO) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/preview/admin`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const res = await page.evaluate(() => {
    const out = {}
    const add = (cls) => { const d = document.createElement('div'); d.className = cls; d.textContent = 'x'; d.style.cssText = 'width:50px;height:20px'; document.body.appendChild(d); return d }
    const olds = ['ad-main', 'ad-tabs', 'ad-ov', 'ad-banner', 'ads', 'adsbox'].map(c => [c, add(c)])
    const news = ['adm-main', 'adm-tabs', 'adm-ov', 'adm'].map(c => [c, add(c)])
    return new Promise(r => setTimeout(() => {
      for (const [c, d] of [...olds, ...news]) out[c] = getComputedStyle(d).display
      r(out)
    }, 2500))
  })
  console.log('control (display of probe elements):', JSON.stringify(res))
  const oldHidden = ['ad-main', 'ad-tabs', 'ad-ov', 'ad-banner', 'ads', 'adsbox'].filter(c => res[c] === 'none')
  const newHidden = ['adm-main', 'adm-tabs', 'adm-ov', 'adm'].filter(c => res[c] === 'none')
  console.log(`blocker active: hides ${oldHidden.length} of the old-style names (${oldHidden.join(', ') || 'none'}); hides ${newHidden.length} of the new names (${newHidden.join(', ') || 'none'})`)
  if (!oldHidden.length) failures.push('control: the blocker hid none of the old ad- style names, so it is not proven to be running')
  if (newHidden.length) failures.push(`control: the blocker hides adm- names: ${newHidden.join(', ')}`)
  await page.close()
}

for (const view of VIEWS) {
  for (const [portal, pages] of Object.entries(PORTALS)) {
    if (flag('--portal') && flag('--portal') !== portal) continue
    for (const path of pages) {
      const page = await ctx.newPage()
      await page.setViewportSize({ width: view.w, height: view.h })
      const errs = []
      page.on('pageerror', e => errs.push(e.message.slice(0, 120)))
      const tag = `${portal} ${view.w} ${path}`
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
      try { await page.waitForSelector('.fx-head', { timeout: 15000 }) } catch { failures.push(`${tag}: no title row`); console.log(`FAIL ${tag} no title row`); await page.close(); continue }
      await page.waitForTimeout(2200)
      const r = await page.evaluate(audit)
      const bad = []
      if (r.mainDisplay === 'none' || r.mainDisplay === 'missing') bad.push(`main ${r.mainDisplay}`)
      if (r.headDisplay === 'none' || r.headDisplay === 'missing') bad.push(`head ${r.headDisplay}`)
      if (portal === 'admin' && view.w >= 1000 && r.tabsDisplay === 'none') bad.push('tabs hidden')
      if (r.mainH < 150) bad.push(`body only ${r.mainH}px tall`)
      if (r.crash) bad.push('crash panel')
      if (errs.length) bad.push(`page errors ${errs.join(' | ')}`)
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${tag}  body ${r.mainH}px  hiddenNodes=${r.hidden.length}${bad.length ? '  ' + bad.join('; ') : ''}`)
      if (bad.length) failures.push(`${tag}: ${bad.join('; ')}`)
      if (SHOTS) await page.screenshot({ path: `${OUT}/${portal}-${view.w}-${path.replace(/^\//, '').replace(/\//g, '_')}.png` })
      await page.close()
    }
  }
}
await ctx.close()
if (failures.length) { console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`); process.exit(1) }
console.log('\nAll pages render with uBlock Origin ON.')
