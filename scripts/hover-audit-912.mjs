// P912: static hover audit. For every element on each page, force :hover on it (CDP CSS.forcePseudoState) and list what
// changes. Flags: (1) an element that is not clickable but changes on hover; (2) a hover that paints a light, see-through
// fill (the dark-mode "film"); (3) a hover that moves the element (transform) — it then paints outside its own box.
//   node scripts/hover-audit-912.mjs --base-url http://localhost:5912 [--theme dark] [--roles agent,fulfill,admin] [--width 1440]
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', '').replace(/\/$/, '')
const THEME = flag('--theme', 'dark')
const W = Number(flag('--width', '1440'))
const ROLES = flag('--roles', 'agent,fulfill,admin').split(',')
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const AGENT = process.env.ONLY ? [process.env.ONLY] : ['/agent', '/agent/leads', '/agent/inbounds/sample-lead-1', '/agent/calendar', '/agent/clients', '/agent/clients/sample-client-1', '/agent/submit',
  '/agent/request-service', '/agent/activity', '/agent/billing', '/agent/more', '/settings', '/messages']
const FUL = ['/fulfillment', '/fulfillment/desk', '/fulfillment/schedule', '/fulfillment/pipeline', '/fulfillment/servicing', '/fulfillment/pay', '/fulfillment/more', '/fulfillment/training', '/messages', '/settings']
const ADM = ['/admin', '/admin/agents', '/admin/setup', '/admin/fulfillment', '/admin/inbounds', '/admin/pipeline', '/admin/billing', '/admin/messages', '/admin/settings', '/admin/connect']
const PROPS = ['background-color', 'background-image', 'transform', 'translate', 'scale', 'box-shadow', 'opacity', 'filter', 'backdrop-filter', 'outline-color', 'outline-style', 'border-top-color']
const browser = await chromium.launch()
const out = new Map()

async function audit(page, where) {
  // settled values only: no transitions, animations frozen
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
  await page.evaluate(() => { document.querySelectorAll('*').forEach((e, i) => e.setAttribute('data-h912', i)) })
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body [data-h912]' })
  const snap = (props) => page.evaluate(({ props }) => {
    const r = {}
    document.querySelectorAll('body [data-h912]').forEach(e => {
      const b = e.getBoundingClientRect(); if (!b.width || !b.height) return
      const s = (x, p) => props.map(k => x.getPropertyValue(k)).join('|') + (p ? '' : '')
      r[e.getAttribute('data-h912')] = s(getComputedStyle(e)) + '#' + s(getComputedStyle(e, '::before'), 1) + '#' + s(getComputedStyle(e, '::after'), 1)
    })
    return r
  }, { props })
  const before = await snap(PROPS)
  for (const nodeId of nodeIds) {
    let id
    try { const { attributes } = await cdp.send('DOM.getAttributes', { nodeId }); id = attributes[attributes.indexOf('data-h912') + 1] } catch { continue }
    if (!(id in before)) continue
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] })
    const res = await page.evaluate(({ id, props }) => {
      const e = document.querySelector(`[data-h912="${id}"]`)
      const one = x => props.map(k => x.getPropertyValue(k)).join('|')
      const now = one(getComputedStyle(e)) + '#' + one(getComputedStyle(e, '::before')) + '#' + one(getComputedStyle(e, '::after'))
      const name = `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`
      const SEM = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],input,select,textarea,label,summary'
      const clickable = !!(e.closest(SEM) || e.querySelector(':scope > .fx-cover') || getComputedStyle(e).cursor === 'pointer')
      const b = e.getBoundingClientRect()
      return { now, name, clickable, area: Math.round(b.width * b.height) }
    }, { id, props: PROPS })
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
    if (res.now === before[id]) continue
    const [a, b] = [before[id], res.now].map(s => s.split('#').map(p => p.split('|')))
    const changed = []
    for (let part = 0; part < 3; part++) PROPS.forEach((k, i) => { if (a[part][i] !== b[part][i]) changed.push(`${['', '::before ', '::after '][part]}${k}: ${a[part][i]} -> ${b[part][i]}`) })
    const flags = []
    if (!res.clickable) flags.push('NOT-CLICKABLE')
    if (changed.some(c => /(^|\s)(transform|translate|scale):/.test(c) && !/-> (none|1)$/.test(c))) flags.push('MOVES')
    if (changed.some(c => /background-(color|image):.*-> .*(rgba\((2[0-9]{2}|1[5-9][0-9]), ?(2[0-9]{2}|1[5-9][0-9]), ?(2[0-9]{2}|1[5-9][0-9]), ?0?\.\d+\)|color-mix|oklab|srgb [01]?\.?[0-9]* [01]?\.?[0-9]* [01]?\.?[0-9]* \/ 0?\.\d+)/.test(c))) flags.push('LIGHT-FILL')
    const key = `${res.name}|${flags.join(',')}`
    if (!out.has(key)) out.set(key, { where, name: res.name, flags, area: res.area, changed })
  }
  await cdp.detach()
}

for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, colorScheme: THEME })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* private mode */ } }, THEME)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="you@email.com"]', logins[role].email)
  await page.fill('input[placeholder="Your password"]', logins[role].password)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 })
  await page.waitForLoadState('networkidle')
  const pages = { agent: AGENT, fulfill: FUL, admin: ADM }[role]
  for (const url of pages) {
    try { await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); await audit(page, `${role} ${url}`); console.error(`done ${role} ${url}`) } catch (e) { console.error(`${role} ${url}: ERROR ${e.message.slice(0, 120)}`) }
  }
  await ctx.close()
}
await browser.close()
for (const v of out.values()) if (v.flags.length || args.includes('--all')) console.log(`[${v.flags.join(',') || 'ok'}] ${v.where} ${v.name} (${v.area}px²)\n    ${v.changed.join('\n    ')}`)
console.log(`\n${[...out.values()].filter(v => v.flags.length).length} flagged hover rules`)
